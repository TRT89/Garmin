import { describe, expect, it } from 'vitest';
import {
  CONFIDENCE_THRESHOLD,
  findMissedWorkouts,
  matchActivities,
  scoreMatch,
  type MatchableActivity,
  type MatchablePlannedWorkout,
} from '@/training/workoutMatcher';
import {
  decideAdaptation,
  gatherIndicators,
  type AdaptationContext,
  type UpcomingWorkout,
} from '@/training/adaptationEngine';
import { ADAPTATION_LIMITS } from '@/lib/constants';
import type { RecoveryStatus } from '@/analytics/recovery';
import type { LoadSummary } from '@/analytics/trainingLoad';

const day = (offset: number) => {
  const d = new Date(2026, 5, 15, 7, 0, 0, 0);
  d.setDate(d.getDate() + offset);
  return d;
};

// ---------------------------------------------------------------------------
// Workout matching
// ---------------------------------------------------------------------------

const activity = (over: Partial<MatchableActivity> = {}): MatchableActivity => ({
  id: 'act1',
  date: day(0),
  sport: 'running',
  distance: 10200,
  duration: 3060,
  title: 'Morning Run',
  ...over,
});

const planned = (over: Partial<MatchablePlannedWorkout> = {}): MatchablePlannedWorkout => ({
  id: 'w1',
  date: day(0),
  sport: 'running',
  workoutType: 'TEMPO',
  targetDistance: 10000,
  targetDuration: null,
  completionStatus: 'planned',
  linkedActivityId: null,
  ...over,
});

describe('scoreMatch', () => {
  it('matches a same-day run of the right distance with high confidence', () => {
    const score = scoreMatch(activity(), planned())!;
    expect(score.score).toBeGreaterThan(CONFIDENCE_THRESHOLD);
    expect(score.reasons.join(' ')).toContain('Same day');
  });

  it('refuses to match a different sport', () => {
    expect(scoreMatch(activity({ sport: 'cycling' }), planned())).toBeNull();
  });

  it('refuses to match across too many days', () => {
    expect(scoreMatch(activity({ date: day(5) }), planned())).toBeNull();
  });

  it('never matches anything to a rest day', () => {
    expect(scoreMatch(activity(), planned({ workoutType: 'REST' }))).toBeNull();
  });

  it('scores a nearby day lower than the same day', () => {
    const same = scoreMatch(activity(), planned())!;
    const nextDay = scoreMatch(activity({ date: day(1) }), planned())!;
    expect(nextDay.score).toBeLessThan(same.score);
  });

  it('scores a very different distance low', () => {
    const close = scoreMatch(activity({ distance: 10200 }), planned())!;
    const far = scoreMatch(activity({ distance: 30000 }), planned())!;
    expect(far.score).toBeLessThan(close.score);
  });

  it('takes the activity name as a supporting hint', () => {
    const generic = scoreMatch(activity({ title: 'Morning Run' }), planned())!;
    const named = scoreMatch(activity({ title: 'Tempo Run' }), planned())!;
    expect(named.score).toBeGreaterThan(generic.score);
  });
});

describe('matchActivities', () => {
  it('matches each activity to at most one workout', () => {
    const result = matchActivities(
      [activity({ id: 'a1' }), activity({ id: 'a2', date: day(1) })],
      [planned({ id: 'w1' }), planned({ id: 'w2', date: day(1) })],
    );

    expect(result.matches).toHaveLength(2);
    expect(new Set(result.matches.map((m) => m.activityId)).size).toBe(2);
    expect(new Set(result.matches.map((m) => m.workoutId)).size).toBe(2);
  });

  it('reports activities it could not confidently match', () => {
    const result = matchActivities(
      [activity({ id: 'a1', date: day(10) })],
      [planned({ id: 'w1' })],
    );

    expect(result.matches).toHaveLength(0);
    expect(result.unmatchedActivityIds).toEqual(['a1']);
  });

  it('ignores workouts that are already linked', () => {
    const result = matchActivities(
      [activity()],
      [planned({ linkedActivityId: 'somethingElse' })],
    );
    expect(result.matches).toHaveLength(0);
  });

  it('produces the same result regardless of input order', () => {
    const activities = [activity({ id: 'a1' }), activity({ id: 'a2', date: day(1) })];
    const workouts = [planned({ id: 'w1' }), planned({ id: 'w2', date: day(1) })];

    const forward = matchActivities(activities, workouts);
    const reversed = matchActivities([...activities].reverse(), [...workouts].reverse());

    expect(forward.matches.map((m) => `${m.workoutId}:${m.activityId}`).sort()).toEqual(
      reversed.matches.map((m) => `${m.workoutId}:${m.activityId}`).sort(),
    );
  });
});

describe('findMissedWorkouts', () => {
  it('finds unfulfilled sessions whose day has passed', () => {
    const missed = findMissedWorkouts([planned({ date: day(-3) })], day(0));
    expect(missed).toHaveLength(1);
  });

  it('gives today’s session a grace period', () => {
    expect(findMissedWorkouts([planned({ date: day(0) })], day(0))).toHaveLength(0);
  });

  it('never marks a rest day as missed', () => {
    expect(
      findMissedWorkouts([planned({ date: day(-5), workoutType: 'REST' })], day(0)),
    ).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Adaptation engine
// ---------------------------------------------------------------------------

const goodRecovery: RecoveryStatus = {
  restingHR: { current: 48, baseline: 48, delta: 0, baselineDays: 14 },
  sleepDuration: { current: 440, baseline: 440, delta: 0, baselineDays: 14 },
  sleepScore: { current: 82, baseline: 82, delta: 0, baselineDays: 14 },
  stress: { current: 30, baseline: 30, delta: 0, baselineDays: 14 },
  bodyBattery: { current: 76, baseline: 76, delta: 0, baselineDays: 14 },
  negativeIndicators: 0,
  positiveIndicators: 0,
  status: 'good',
  evidence: [],
  summary: 'Fine.',
};

const tiredRecovery: RecoveryStatus = {
  ...goodRecovery,
  restingHR: { current: 55, baseline: 48, delta: 7, baselineDays: 14 },
  sleepDuration: { current: 370, baseline: 440, delta: -70, baselineDays: 14 },
  bodyBattery: { current: 55, baseline: 76, delta: -21, baselineDays: 14 },
  negativeIndicators: 3,
  status: 'compromised',
  summary: 'Run down.',
};

const steadyLoad: LoadSummary = {
  acute: 600,
  chronic: 2400,
  chronicWeekly: 600,
  ratio: 1,
  previousAcute: 590,
  acuteChange: 0.02,
  interpretation: 'Steady.',
};

const intervalWorkout: UpcomingWorkout = {
  id: 'up1',
  date: day(3),
  weekNumber: 5,
  workoutType: 'INTERVAL',
  description: '6 × 1 km at interval pace with 400 m recovery jogs',
  targetDistance: 12000,
  targetPaceMin: 275,
  targetPaceMax: 285,
  structure: [
    { type: 'warmup', distance: 2000 },
    { type: 'interval', repeat: 6, distance: 1000 },
    { type: 'recovery', repeat: 5, distance: 400 },
    { type: 'cooldown', distance: 2000 },
  ],
  userModified: false,
  lastAdaptedAt: null,
};

const easyWorkout: UpcomingWorkout = {
  id: 'up2',
  date: day(4),
  weekNumber: 5,
  workoutType: 'EASY',
  description: '8.0 km easy',
  targetDistance: 8000,
  targetPaceMin: 350,
  targetPaceMax: 370,
  structure: [{ type: 'steady', distance: 8000 }],
  userModified: false,
  lastAdaptedAt: null,
};

const context = (over: Partial<AdaptationContext> = {}): AdaptationContext => ({
  recovery: goodRecovery,
  load: steadyLoad,
  executed: [],
  recentCompliance: [],
  upcoming: [intervalWorkout, easyWorkout],
  asOf: day(0),
  ...over,
});

describe('gatherIndicators', () => {
  it('finds nothing when everything is at baseline', () => {
    expect(gatherIndicators(context())).toHaveLength(0);
  });

  it('finds each recovery signal separately', () => {
    const indicators = gatherIndicators(context({ recovery: tiredRecovery }));
    const keys = indicators.map((i) => i.key);

    expect(keys).toContain('resting_hr_elevated');
    expect(keys).toContain('sleep_short');
    expect(keys).toContain('readiness_low');
  });

  it('attaches the numbers behind every statement', () => {
    const indicators = gatherIndicators(context({ recovery: tiredRecovery }));
    const rhr = indicators.find((i) => i.key === 'resting_hr_elevated')!;

    expect(rhr.values.current).toBe(55);
    expect(rhr.values.baseline).toBe(48);
    expect(rhr.statement).toContain('7 bpm');
  });

  it('recognises a sharp jump in training load', () => {
    const indicators = gatherIndicators(
      context({ load: { ...steadyLoad, acute: 1000, chronicWeekly: 600, ratio: 1.67 } }),
    );
    expect(indicators.map((i) => i.key)).toContain('load_spike');
  });
});

describe('decideAdaptation', () => {
  it('keeps the plan when nothing is out of the ordinary', () => {
    const decision = decideAdaptation(context());

    expect(decision.outcome).toBe('KEEP_PLAN');
    expect(decision.changes).toHaveLength(0);
  });

  it('never changes the plan on a single indicator', () => {
    // Only resting heart rate has moved — genuinely common day-to-day variation.
    const oneSignal: RecoveryStatus = {
      ...goodRecovery,
      restingHR: { current: 52, baseline: 48, delta: 4, baselineDays: 14 },
      negativeIndicators: 1,
      status: 'moderate',
    };

    const decision = decideAdaptation(context({ recovery: oneSignal }));

    expect(decision.outcome).toBe('KEEP_PLAN');
    expect(decision.changes).toHaveLength(0);
    expect(decision.reason).toContain('normal variation');
  });

  it('reduces the next hard session when two indicators agree', () => {
    const twoSignals: RecoveryStatus = {
      ...goodRecovery,
      restingHR: { current: 52, baseline: 48, delta: 4, baselineDays: 14 },
      sleepDuration: { current: 380, baseline: 440, delta: -60, baselineDays: 14 },
      negativeIndicators: 2,
      status: 'moderate',
    };

    const decision = decideAdaptation(context({ recovery: twoSignals }));

    expect(decision.outcome).toBe('REDUCE_INTENSITY');
    expect(decision.changes).toHaveLength(1);
    expect(decision.changes[0].workoutId).toBe('up1');
  });

  it('replaces the hard session entirely when three indicators agree', () => {
    const decision = decideAdaptation(context({ recovery: tiredRecovery }));

    expect(decision.outcome).toBe('CHANGE_TO_RECOVERY');
    expect(decision.changes[0].after.workoutType).toBe('RECOVERY');
  });

  it('cuts interval repetitions by no more than a third', () => {
    const twoSignals: RecoveryStatus = {
      ...goodRecovery,
      restingHR: { current: 52, baseline: 48, delta: 4, baselineDays: 14 },
      sleepDuration: { current: 380, baseline: 440, delta: -60, baselineDays: 14 },
      negativeIndicators: 2,
    };

    const decision = decideAdaptation(context({ recovery: twoSignals }));
    const after = decision.changes[0].after.structure.find((s) => s.type === 'interval')!;
    const before = decision.changes[0].before.structure.find((s) => s.type === 'interval')!;

    const cut = (before.repeat! - after.repeat!) / before.repeat!;
    expect(cut).toBeLessThanOrEqual(ADAPTATION_LIMITS.MAX_INTERVAL_REDUCTION);
    expect(after.repeat).toBeGreaterThanOrEqual(3);
  });

  it('never touches a session the athlete edited by hand', () => {
    const decision = decideAdaptation(
      context({
        recovery: tiredRecovery,
        upcoming: [
          { ...intervalWorkout, userModified: true },
          { ...easyWorkout, userModified: true },
        ],
      }),
    );

    expect(decision.changes).toHaveLength(0);
    expect(decision.reason).toContain('edited by you');
  });

  it('respects the cooldown after a recent automatic change', () => {
    const decision = decideAdaptation(
      context({
        recovery: tiredRecovery,
        upcoming: [
          { ...intervalWorkout, lastAdaptedAt: day(-1) },
          { ...easyWorkout, lastAdaptedAt: day(-1) },
        ],
      }),
    );

    expect(decision.changes).toHaveLength(0);
  });

  it('never changes a session that has already happened', () => {
    const decision = decideAdaptation(
      context({
        recovery: tiredRecovery,
        upcoming: [{ ...intervalWorkout, date: day(-2) }],
      }),
    );

    expect(decision.changes).toHaveLength(0);
  });

  it('increases volume only slightly, and only when things are going well', () => {
    const decision = decideAdaptation(
      context({
        recovery: {
          ...goodRecovery,
          restingHR: { current: 45, baseline: 48, delta: -3, baselineDays: 14 },
        },
        load: { ...steadyLoad, acute: 400, chronicWeekly: 600, ratio: 0.67 },
        recentCompliance: [
          {
            weekNumber: 3,
            weekStart: day(-14),
            sessionsPlanned: 4,
            sessionsCompleted: 4,
            sessionsMissed: 0,
            sessionsSkipped: 0,
            plannedDistance: 40000,
            actualDistance: 40000,
            volumeCompliance: 1,
            sessionCompliance: 1,
          },
          {
            weekNumber: 4,
            weekStart: day(-7),
            sessionsPlanned: 4,
            sessionsCompleted: 4,
            sessionsMissed: 0,
            sessionsSkipped: 0,
            plannedDistance: 42000,
            actualDistance: 42000,
            volumeCompliance: 1,
            sessionCompliance: 1,
          },
        ],
      }),
    );

    expect(decision.outcome).toBe('INCREASE_VOLUME_SLIGHTLY');

    const change = decision.changes[0];
    const increase =
      (change.after.targetDistance! - change.before.targetDistance!) /
      change.before.targetDistance!;
    expect(increase).toBeLessThanOrEqual(ADAPTATION_LIMITS.MAX_VOLUME_INCREASE + 0.001);
  });

  it('always explains itself with the numbers behind the decision', () => {
    const decision = decideAdaptation(context({ recovery: tiredRecovery }));

    expect(decision.reason.length).toBeGreaterThan(30);
    expect(decision.reason).toContain('bpm');
    expect(decision.indicators.length).toBeGreaterThanOrEqual(2);
    expect(decision.indicators.every((i) => Object.keys(i.values).length > 0)).toBe(true);
  });

  it('is completely deterministic', () => {
    const input = context({ recovery: tiredRecovery });
    expect(JSON.stringify(decideAdaptation(input))).toBe(
      JSON.stringify(decideAdaptation(input)),
    );
  });

  it('reduces volume when there is no hard session to reduce', () => {
    const decision = decideAdaptation(
      context({
        recovery: {
          ...goodRecovery,
          restingHR: { current: 52, baseline: 48, delta: 4, baselineDays: 14 },
          sleepDuration: { current: 380, baseline: 440, delta: -60, baselineDays: 14 },
          negativeIndicators: 2,
        },
        upcoming: [easyWorkout],
      }),
    );

    expect(decision.outcome).toBe('REDUCE_VOLUME');
    const change = decision.changes[0];
    const cut =
      (change.before.targetDistance! - change.after.targetDistance!) /
      change.before.targetDistance!;
    expect(cut).toBeLessThanOrEqual(ADAPTATION_LIMITS.MAX_VOLUME_DECREASE + 0.001);
  });
});
