/**
 * The adaptive training engine.
 *
 * After training data arrives, this decides whether the *upcoming* sessions
 * should change. It is rule-based rather than model-based, because a plan that
 * changes unpredictably is worse than no plan at all — the athlete has to be
 * able to understand and trust every adjustment.
 *
 * ## The design rules
 *
 * 1. **Never act on a single data point.** At least two independent indicators
 *    must agree before anything changes. One bad night's sleep, or one slow run,
 *    is noise.
 * 2. **Bound every change.** Volume moves by at most 15% down or 10% up.
 *    Interval sessions lose at most a third of their repetitions.
 * 3. **Never touch what the athlete has taken control of.** A session edited by
 *    hand is left alone.
 * 4. **Never change the same session twice in quick succession.** A cooldown
 *    prevents the plan from oscillating.
 * 5. **Explain everything.** Every decision carries the numbers behind it, which
 *    are stored in the audit trail and shown in "why did my plan change?".
 *
 * The engine returns *proposals*. Writing them to the database, and recording
 * the audit trail, happens in `adaptationService.ts`.
 */

import {
  ADAPTATION_LIMITS,
  HARD_WORKOUT_TYPES,
  type AdaptationOutcome,
  type WorkoutType,
} from '@/lib/constants';
import { daysBetween } from '@/lib/dates';
import { formatDistance } from '@/lib/format';
import type { WorkoutStep } from '@/lib/json';
import type { RecoveryStatus } from '@/analytics/recovery';
import type { LoadSummary } from '@/analytics/trainingLoad';
import type { WeekCompliance } from '@/analytics/compliance';

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/** One completed session, compared against what was asked for. */
export interface ExecutedWorkout {
  workoutId: string;
  date: Date;
  workoutType: string;
  targetDistance: number | null;
  targetPaceMin: number | null;
  targetPaceMax: number | null;
  actualDistance: number | null;
  actualPace: number | null;
  actualHR: number | null;
  /** Average heart rate across comparable recent sessions, for reference. */
  comparableHR: number | null;
}

export interface UpcomingWorkout {
  id: string;
  date: Date;
  weekNumber: number;
  workoutType: string;
  description: string;
  targetDistance: number | null;
  targetPaceMin: number | null;
  targetPaceMax: number | null;
  structure: WorkoutStep[];
  userModified: boolean;
  /** When this session was last changed automatically, for the cooldown rule. */
  lastAdaptedAt: Date | null;
}

export interface AdaptationContext {
  recovery: RecoveryStatus;
  load: LoadSummary;
  /** Recent completed sessions, most recent last. */
  executed: ExecutedWorkout[];
  /** Compliance over the last two weeks. */
  recentCompliance: WeekCompliance[];
  upcoming: UpcomingWorkout[];
  asOf: Date;
}

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

/** One piece of evidence: a statement, and the number that supports it. */
export interface Indicator {
  key: string;
  /** Which direction this points: fatigue, freshness, or neither. */
  direction: 'fatigue' | 'progress' | 'neutral';
  statement: string;
  /** The raw values, stored in the audit trail so the claim is checkable. */
  values: Record<string, number | string | null>;
}

export interface WorkoutChange {
  workoutId: string;
  before: {
    workoutType: string;
    description: string;
    targetDistance: number | null;
    structure: WorkoutStep[];
  };
  after: {
    workoutType: string;
    description: string;
    targetDistance: number | null;
    structure: WorkoutStep[];
  };
}

export interface AdaptationDecision {
  outcome: AdaptationOutcome;
  /** The sentence shown to the athlete. */
  reason: string;
  /** Every indicator considered, including the ones that pointed the other way. */
  indicators: Indicator[];
  /** The concrete changes to make. Empty for KEEP_PLAN. */
  changes: WorkoutChange[];
}

// ---------------------------------------------------------------------------
// Gathering the evidence
// ---------------------------------------------------------------------------

/**
 * Collect every signal worth considering, each as a discrete indicator.
 *
 * Exported so tests can check the signals independently of the decision.
 */
export function gatherIndicators(context: AdaptationContext): Indicator[] {
  const indicators: Indicator[] = [];
  const { recovery, load, executed, recentCompliance } = context;

  // --- Recovery ----------------------------------------------------------
  if (recovery.restingHR.delta != null && recovery.restingHR.delta >= 3) {
    indicators.push({
      key: 'resting_hr_elevated',
      direction: 'fatigue',
      statement: `your resting heart rate is ${recovery.restingHR.delta.toFixed(
        0,
      )} bpm above your 14-day average`,
      values: {
        current: recovery.restingHR.current,
        baseline: recovery.restingHR.baseline,
        delta: recovery.restingHR.delta,
      },
    });
  }

  if (recovery.sleepDuration.delta != null && recovery.sleepDuration.delta <= -45) {
    const minutes = Math.abs(Math.round(recovery.sleepDuration.delta));
    indicators.push({
      key: 'sleep_short',
      direction: 'fatigue',
      statement: `you have been sleeping ${Math.floor(minutes / 60) > 0 ? `${Math.floor(minutes / 60)}h ` : ''}${minutes % 60}m less than your 14-day average`,
      values: {
        current: recovery.sleepDuration.current,
        baseline: recovery.sleepDuration.baseline,
        delta: recovery.sleepDuration.delta,
      },
    });
  }

  if (recovery.bodyBattery.delta != null && recovery.bodyBattery.delta <= -10) {
    indicators.push({
      key: 'readiness_low',
      direction: 'fatigue',
      statement: `your device's readiness score is ${Math.abs(
        recovery.bodyBattery.delta,
      ).toFixed(0)} points below your 14-day average`,
      values: {
        current: recovery.bodyBattery.current,
        baseline: recovery.bodyBattery.baseline,
        delta: recovery.bodyBattery.delta,
      },
    });
  }

  if (recovery.restingHR.delta != null && recovery.restingHR.delta <= -2) {
    indicators.push({
      key: 'resting_hr_low',
      direction: 'progress',
      statement: `your resting heart rate is ${Math.abs(recovery.restingHR.delta).toFixed(
        0,
      )} bpm below your 14-day average`,
      values: { delta: recovery.restingHR.delta },
    });
  }

  // --- Load --------------------------------------------------------------
  if (load.ratio != null && load.ratio > 1.5) {
    indicators.push({
      key: 'load_spike',
      direction: 'fatigue',
      statement: `your last 7 days of training (${load.acute}) are well above your average week of ${load.chronicWeekly}`,
      values: { acute: load.acute, chronicWeekly: load.chronicWeekly, ratio: load.ratio },
    });
  }

  if (load.ratio != null && load.ratio < 0.8 && load.chronic > 0) {
    indicators.push({
      key: 'load_light',
      direction: 'progress',
      statement: `your last 7 days (${load.acute}) are lighter than your average week of ${load.chronicWeekly}`,
      values: { acute: load.acute, chronicWeekly: load.chronicWeekly, ratio: load.ratio },
    });
  }

  // --- How recent sessions actually went ---------------------------------
  const recent = executed.slice(-3);

  const elevated = recent.filter(
    (w) => w.actualHR != null && w.comparableHR != null && w.actualHR - w.comparableHR >= 5,
  );
  if (elevated.length >= 2) {
    const worst = elevated[elevated.length - 1];
    indicators.push({
      key: 'hr_elevated_in_training',
      direction: 'fatigue',
      statement: `your heart rate has been running above normal for the effort in ${elevated.length} of your last ${recent.length} sessions`,
      values: {
        sessions: elevated.length,
        latestHR: worst.actualHR,
        comparableHR: worst.comparableHR,
      },
    });
  }

  const slower = recent.filter(
    (w) =>
      w.actualPace != null &&
      w.targetPaceMax != null &&
      w.actualPace > w.targetPaceMax * 1.06,
  );
  if (slower.length >= 2) {
    indicators.push({
      key: 'pace_below_target',
      direction: 'fatigue',
      statement: `you have been running slower than the prescribed range in ${slower.length} of your last ${recent.length} sessions`,
      values: { sessions: slower.length },
    });
  }

  const strong = recent.filter(
    (w) =>
      w.actualPace != null &&
      w.targetPaceMin != null &&
      w.actualPace <= w.targetPaceMin &&
      w.actualHR != null &&
      w.comparableHR != null &&
      w.actualHR <= w.comparableHR + 1,
  );
  if (strong.length >= 2) {
    indicators.push({
      key: 'executing_strongly',
      direction: 'progress',
      statement: `you have hit or beaten the prescribed pace at a normal heart rate in ${strong.length} of your last ${recent.length} sessions`,
      values: { sessions: strong.length },
    });
  }

  // --- Compliance --------------------------------------------------------
  const complete = recentCompliance.filter(
    (w) => w.sessionCompliance != null && w.sessionCompliance >= 0.9,
  );
  if (complete.length >= 2 && complete.length === recentCompliance.length) {
    indicators.push({
      key: 'compliance_high',
      direction: 'progress',
      statement: `you have completed nearly every planned session for ${complete.length} weeks running`,
      values: { weeks: complete.length },
    });
  }

  const poor = recentCompliance.filter(
    (w) => w.sessionCompliance != null && w.sessionCompliance < 0.6,
  );
  if (poor.length >= 2) {
    indicators.push({
      key: 'compliance_low',
      direction: 'fatigue',
      statement: `you have completed fewer than 60% of planned sessions in ${poor.length} recent weeks`,
      values: { weeks: poor.length },
    });
  }

  return indicators;
}

// ---------------------------------------------------------------------------
// Changing a session
// ---------------------------------------------------------------------------

/** Reduce an interval session's repetitions, within the permitted limit. */
function reduceIntervals(workout: UpcomingWorkout): WorkoutChange | null {
  const repStep = workout.structure.find((s) => s.type === 'interval');
  if (!repStep?.repeat || repStep.repeat < 3) return null;

  const minimum = Math.ceil(repStep.repeat * (1 - ADAPTATION_LIMITS.MAX_INTERVAL_REDUCTION));
  const reduced = Math.max(3, minimum);
  if (reduced >= repStep.repeat) return null;

  const structure = workout.structure.map((step) => {
    if (step.type === 'interval') return { ...step, repeat: reduced };
    if (step.type === 'recovery') return { ...step, repeat: Math.max(1, reduced - 1) };
    return step;
  });

  // The session shortens by however many repetitions were removed.
  const removed = repStep.repeat - reduced;
  const perRep = (repStep.distance ?? 1000) + 400;
  const distance =
    workout.targetDistance != null
      ? Math.max(3000, workout.targetDistance - removed * perRep)
      : null;

  return {
    workoutId: workout.id,
    before: {
      workoutType: workout.workoutType,
      description: workout.description,
      targetDistance: workout.targetDistance,
      structure: workout.structure,
    },
    after: {
      workoutType: workout.workoutType,
      description: workout.description.replace(
        /^\d+ ×/,
        `${reduced} ×`,
      ),
      targetDistance: distance,
      structure,
    },
  };
}

/** Reduce a session's distance, within the permitted limit. */
function reduceVolume(workout: UpcomingWorkout, fraction: number): WorkoutChange | null {
  if (workout.targetDistance == null) return null;

  const capped = Math.min(fraction, ADAPTATION_LIMITS.MAX_VOLUME_DECREASE);
  const reduced = Math.round((workout.targetDistance * (1 - capped)) / 100) * 100;
  if (reduced >= workout.targetDistance || reduced < 3000) return null;

  return {
    workoutId: workout.id,
    before: {
      workoutType: workout.workoutType,
      description: workout.description,
      targetDistance: workout.targetDistance,
      structure: workout.structure,
    },
    after: {
      workoutType: workout.workoutType,
      description: workout.description.replace(
        /[\d.]+ km/,
        formatDistance(reduced),
      ),
      targetDistance: reduced,
      structure: workout.structure.map((step) =>
        step.type === 'steady' && step.distance != null ? { ...step, distance: reduced } : step,
      ),
    },
  };
}

/** Turn a hard session into an easy one. */
function convertToRecovery(workout: UpcomingWorkout): WorkoutChange {
  const distance =
    workout.targetDistance != null ? Math.round(workout.targetDistance * 0.7) : null;

  return {
    workoutId: workout.id,
    before: {
      workoutType: workout.workoutType,
      description: workout.description,
      targetDistance: workout.targetDistance,
      structure: workout.structure,
    },
    after: {
      workoutType: 'RECOVERY' satisfies WorkoutType,
      description: distance
        ? `${formatDistance(distance)} very easy`
        : 'Easy recovery running',
      targetDistance: distance,
      structure: [
        {
          type: 'steady',
          distance,
          note: 'Deliberately slow — this replaces a harder session',
        },
      ],
    },
  };
}

/** Increase a session's distance, within the permitted limit. */
function increaseVolume(workout: UpcomingWorkout): WorkoutChange | null {
  if (workout.targetDistance == null) return null;

  const increased =
    Math.round((workout.targetDistance * (1 + ADAPTATION_LIMITS.MAX_VOLUME_INCREASE)) / 100) *
    100;
  if (increased <= workout.targetDistance) return null;

  return {
    workoutId: workout.id,
    before: {
      workoutType: workout.workoutType,
      description: workout.description,
      targetDistance: workout.targetDistance,
      structure: workout.structure,
    },
    after: {
      workoutType: workout.workoutType,
      description: workout.description.replace(/[\d.]+ km/, formatDistance(increased)),
      targetDistance: increased,
      structure: workout.structure.map((step) =>
        step.type === 'steady' && step.distance != null ? { ...step, distance: increased } : step,
      ),
    },
  };
}

// ---------------------------------------------------------------------------
// The decision
// ---------------------------------------------------------------------------

/** Sessions eligible to be changed automatically. */
function eligible(upcoming: UpcomingWorkout[], asOf: Date): UpcomingWorkout[] {
  return upcoming.filter((workout) => {
    // Rule 3: never override the athlete's own edits.
    if (workout.userModified) return false;
    // Only future sessions.
    if (workout.date <= asOf) return false;
    // Rule 4: cooldown since the last automatic change.
    if (
      workout.lastAdaptedAt != null &&
      daysBetween(workout.lastAdaptedAt, asOf) < ADAPTATION_LIMITS.COOLDOWN_DAYS
    ) {
      return false;
    }
    return true;
  });
}

function sentence(outcome: string, indicators: Indicator[], detail: string): string {
  const supporting = indicators.filter((i) => i.direction === 'fatigue' || i.direction === 'progress');
  const clauses = supporting.slice(0, 3).map((i) => i.statement);

  if (clauses.length === 0) return detail;
  if (clauses.length === 1) return `${detail} because ${clauses[0]}.`;

  const last = clauses.pop();
  return `${detail} because ${clauses.join(', ')} and ${last}.`;
}

/**
 * Decide what, if anything, should change.
 *
 * Pure and deterministic: the same context always produces the same decision.
 */
export function decideAdaptation(context: AdaptationContext): AdaptationDecision {
  const indicators = gatherIndicators(context);

  const fatigue = indicators.filter((i) => i.direction === 'fatigue');
  const progress = indicators.filter((i) => i.direction === 'progress');

  const candidates = eligible(context.upcoming, context.asOf);

  // Rule 1: at least two independent indicators before anything changes.
  const enoughFatigue = fatigue.length >= ADAPTATION_LIMITS.MIN_INDICATORS;
  const enoughProgress = progress.length >= ADAPTATION_LIMITS.MIN_INDICATORS;

  if (!enoughFatigue && !enoughProgress) {
    return {
      outcome: 'KEEP_PLAN',
      reason:
        fatigue.length + progress.length === 0
          ? 'Your training and recovery are both in line with your recent norms, so the plan is unchanged.'
          : `Only one indicator is away from your baseline, which is normal variation. At least ${ADAPTATION_LIMITS.MIN_INDICATORS} independent indicators must agree before this plan is changed, so it is unchanged.`,
      indicators,
      changes: [],
    };
  }

  if (candidates.length === 0) {
    return {
      outcome: 'KEEP_PLAN',
      reason:
        'There are no upcoming sessions eligible to change — they have either already happened, been edited by you, or been adjusted very recently.',
      indicators,
      changes: [],
    };
  }

  // --- Fatigue takes priority over progress -------------------------------
  if (enoughFatigue) {
    const severe = fatigue.length >= 3;

    // The next hard session is the one that matters most.
    const nextHard = candidates.find((w) =>
      HARD_WORKOUT_TYPES.includes(w.workoutType as WorkoutType),
    );

    if (severe && nextHard) {
      // Three or more indicators: replace the hard session outright.
      const change = convertToRecovery(nextHard);
      return {
        outcome: 'CHANGE_TO_RECOVERY',
        reason: sentence(
          'CHANGE_TO_RECOVERY',
          fatigue,
          `Your next hard session has been replaced with easy running`,
        ),
        indicators,
        changes: [change],
      };
    }

    if (nextHard) {
      // Two indicators: reduce the hard session rather than remove it.
      const change =
        nextHard.workoutType === 'INTERVAL'
          ? reduceIntervals(nextHard)
          : reduceVolume(nextHard, 0.15);

      if (change) {
        return {
          outcome: 'REDUCE_INTENSITY',
          reason: sentence(
            'REDUCE_INTENSITY',
            fatigue,
            `Your next hard session has been reduced`,
          ),
          indicators,
          changes: [change],
        };
      }
    }

    // No hard session ahead: trim the longest upcoming session instead.
    const longest = [...candidates]
      .filter((w) => w.targetDistance != null)
      .sort((a, b) => (b.targetDistance ?? 0) - (a.targetDistance ?? 0))[0];

    if (longest) {
      const change = reduceVolume(longest, 0.15);
      if (change) {
        return {
          outcome: 'REDUCE_VOLUME',
          reason: sentence(
            'REDUCE_VOLUME',
            fatigue,
            `Your next long session has been shortened`,
          ),
          indicators,
          changes: [change],
        };
      }
    }

    return {
      outcome: 'KEEP_PLAN',
      reason:
        'Fatigue indicators are raised, but no upcoming session could be safely adjusted. Consider taking an easier day yourself.',
      indicators,
      changes: [],
    };
  }

  // --- Progression --------------------------------------------------------
  // Rule 2 in spirit as well as letter: progression is deliberately timid, and
  // only ever touches one easy session.
  const nextEasy = candidates.find(
    (w) => w.workoutType === 'EASY' && w.targetDistance != null,
  );

  if (nextEasy) {
    const change = increaseVolume(nextEasy);
    if (change) {
      return {
        outcome: 'INCREASE_VOLUME_SLIGHTLY',
        reason: sentence(
          'INCREASE_VOLUME_SLIGHTLY',
          progress,
          `One upcoming easy run has been lengthened slightly`,
        ),
        indicators,
        changes: [change],
      };
    }
  }

  return {
    outcome: 'KEEP_PLAN',
    reason:
      'Your training is going well and the plan already reflects that, so nothing has been changed.',
    indicators,
    changes: [],
  };
}
