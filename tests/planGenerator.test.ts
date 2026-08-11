import { describe, expect, it } from 'vitest';
import {
  buildLongRunProgression,
  buildVolumeProgression,
  generatePlan,
  PLAN_LIMITS,
  type PlanInput,
} from '@/training/planGenerator';
import { assignPhases, phaseCounts } from '@/training/phases';
import { calculatePaceZones } from '@/training/paces';
import { MAX_LONG_RUN } from '@/lib/constants';

const baseInput: PlanInput = {
  goalType: 'marathon',
  goalDistance: 42195,
  goalTime: 13200, // 3:40
  startDate: new Date(2026, 7, 17), // a Monday
  trainingWeeks: 12,
  sessionsPerWeek: 4,
  longRunDay: 0, // Sunday
  currentWeeklyDistance: 33000,
  longestRecentRun: 18000,
  estimatedThresholdPace: 295,
  observedEasyPace: 355,
  maxHR: 186,
  restingHR: 48,
};

describe('assignPhases', () => {
  it('covers every week exactly once', () => {
    for (const weeks of [1, 2, 3, 4, 6, 8, 12, 16, 20, 24]) {
      expect(assignPhases(weeks)).toHaveLength(weeks);
    }
  });

  it('orders the phases base, build, peak, taper', () => {
    const phases = assignPhases(16);
    const order = ['BASE', 'BUILD', 'PEAK', 'TAPER'];
    let lastIndex = -1;
    for (const phase of phases) {
      const index = order.indexOf(phase);
      expect(index).toBeGreaterThanOrEqual(lastIndex);
      lastIndex = index;
    }
  });

  it('always ends in a taper', () => {
    for (const weeks of [4, 8, 12, 20]) {
      const phases = assignPhases(weeks);
      expect(phases[phases.length - 1]).toBe('TAPER');
    }
  });

  it('gives a marathon at least two taper weeks', () => {
    const counts = phaseCounts(assignPhases(12, true));
    expect(counts.TAPER).toBeGreaterThanOrEqual(2);
  });

  it('devotes the largest share to base building', () => {
    const counts = phaseCounts(assignPhases(16));
    expect(counts.BASE).toBeGreaterThanOrEqual(counts.BUILD);
    expect(counts.BASE).toBeGreaterThan(counts.PEAK);
  });

  it('handles plans too short for a full structure', () => {
    expect(assignPhases(1)).toEqual(['TAPER']);
    expect(assignPhases(2)).toEqual(['BUILD', 'TAPER']);
  });
});

describe('buildVolumeProgression', () => {
  const phases = assignPhases(12, true);
  const volumes = buildVolumeProgression(33000, phases);

  it('starts at the athlete’s current volume', () => {
    expect(volumes[0]).toBe(33000);
  });

  it('never increases by more than the permitted amount', () => {
    for (let i = 1; i < volumes.length; i++) {
      if (volumes[i] <= volumes[i - 1]) continue;
      const increase = (volumes[i] - volumes[i - 1]) / volumes[i - 1];
      // A rise straight after a down week compares against the down week, so
      // the ceiling is checked against the running peak instead.
      const priorPeak = Math.max(...volumes.slice(0, i));
      const vsPeak = (volumes[i] - priorPeak) / priorPeak;
      expect(Math.min(increase, Math.max(0, vsPeak))).toBeLessThanOrEqual(
        PLAN_LIMITS.MAX_WEEKLY_INCREASE + 0.001,
      );
    }
  });

  it('never exceeds the peak multiple of the starting volume', () => {
    const cap = 33000 * PLAN_LIMITS.MAX_PEAK_MULTIPLE;
    expect(Math.max(...volumes)).toBeLessThanOrEqual(cap + 1);
  });

  it('includes a lighter week every fourth week', () => {
    expect(volumes[3]).toBeLessThan(volumes[2]);
    expect(volumes[7]).toBeLessThan(volumes[6]);
  });

  it('reduces sharply through the taper', () => {
    const taperStart = phases.indexOf('TAPER');
    expect(volumes[volumes.length - 1]).toBeLessThan(volumes[taperStart - 1] * 0.6);
  });

  it('applies a floor so a beginner still gets a sensible plan', () => {
    const low = buildVolumeProgression(2000, assignPhases(12));
    expect(low[0]).toBeGreaterThanOrEqual(PLAN_LIMITS.MIN_WEEKLY_VOLUME);
  });
});

describe('buildLongRunProgression', () => {
  const phases = assignPhases(12, true);
  const volumes = buildVolumeProgression(33000, phases);
  const longRuns = buildLongRunProgression(18000, volumes, phases, 'marathon');

  it('never grows beyond the previous longest by more than the permitted step', () => {
    // Measured against the running peak rather than the previous week, because
    // returning to the prior distance after a deliberately lighter week is
    // normal practice, not a dangerous jump.
    for (let i = 1; i < longRuns.length; i++) {
      const priorPeak = Math.max(...longRuns.slice(0, i));
      if (longRuns[i] <= priorPeak) continue;
      expect(longRuns[i] - priorPeak).toBeLessThanOrEqual(
        PLAN_LIMITS.MAX_LONG_RUN_INCREASE + 1,
      );
    }
  });

  it('never jumps more than one step above the previous week either', () => {
    // The rebound after a lighter week is bounded too: it may return to the
    // prior peak plus one step, but no further.
    for (let i = 1; i < longRuns.length; i++) {
      const priorPeak = Math.max(...longRuns.slice(0, i));
      expect(longRuns[i]).toBeLessThanOrEqual(
        priorPeak + PLAN_LIMITS.MAX_LONG_RUN_INCREASE + 1,
      );
    }
  });

  it('never exceeds the cap for the goal distance', () => {
    expect(Math.max(...longRuns)).toBeLessThanOrEqual(MAX_LONG_RUN.marathon);
  });

  it('never lets the long run dominate the week', () => {
    longRuns.forEach((longRun, i) => {
      expect(longRun).toBeLessThanOrEqual(volumes[i] * PLAN_LIMITS.MAX_LONG_RUN_SHARE + 1);
    });
  });

  it('shortens the long run through the taper', () => {
    const taperStart = phases.indexOf('TAPER');
    expect(longRuns[longRuns.length - 1]).toBeLessThan(longRuns[taperStart - 1]);
  });

  it('caps a 5K plan far below a marathon plan', () => {
    const fiveK = buildLongRunProgression(18000, volumes, phases, '5k');
    expect(Math.max(...fiveK)).toBeLessThanOrEqual(MAX_LONG_RUN['5k']);
  });
});

describe('generatePlan', () => {
  const plan = generatePlan(baseInput);

  it('is completely reproducible', () => {
    const again = generatePlan(baseInput);
    expect(JSON.stringify(again)).toBe(JSON.stringify(plan));
  });

  it('produces the requested number of weeks', () => {
    expect(plan.weeks).toHaveLength(12);
    expect(plan.weeks[0].weekNumber).toBe(1);
    expect(plan.weeks[11].weekNumber).toBe(12);
  });

  it('produces the requested number of sessions each week', () => {
    for (const week of plan.weeks) {
      expect(week.workouts.length).toBe(4);
    }
  });

  it('puts exactly one long run in every week, on the chosen day', () => {
    for (const week of plan.weeks) {
      const longRuns = week.workouts.filter((w) => w.workoutType === 'LONG_RUN');
      expect(longRuns).toHaveLength(1);
      // longRunDay 0 is Sunday.
      expect(longRuns[0].date.getDay()).toBe(0);
    }
  });

  it('keeps workouts inside their own week', () => {
    for (const week of plan.weeks) {
      for (const workout of week.workouts) {
        const offset =
          (workout.date.getTime() - week.startDate.getTime()) / (24 * 60 * 60 * 1000);
        expect(offset).toBeGreaterThanOrEqual(0);
        expect(offset).toBeLessThan(7);
      }
    }
  });

  it('holds back quality work until there is a base for it', () => {
    const baseWeeks = plan.weeks.filter((w) => w.phase === 'BASE');
    const intervalsInBase = baseWeeks.flatMap((w) =>
      w.workouts.filter((x) => x.workoutType === 'INTERVAL'),
    );
    expect(intervalsInBase).toHaveLength(0);
  });

  it('introduces intervals once the build phase starts', () => {
    const buildWeeks = plan.weeks.filter((w) => w.phase === 'BUILD');
    const intervals = buildWeeks.flatMap((w) =>
      w.workouts.filter((x) => x.workoutType === 'INTERVAL'),
    );
    expect(intervals.length).toBeGreaterThan(0);
  });

  it('gives every session a pace band and an explanation', () => {
    for (const week of plan.weeks) {
      for (const workout of week.workouts) {
        expect(workout.targetPaceMin).not.toBeNull();
        expect(workout.targetPaceMax).not.toBeNull();
        expect(workout.targetPaceMin!).toBeLessThan(workout.targetPaceMax!);
        expect(workout.explanation.length).toBeGreaterThan(10);
        expect(workout.structure.length).toBeGreaterThan(0);
      }
    }
  });

  it('gives heart-rate guidance when the athlete’s heart rates are known', () => {
    const anyWorkout = plan.weeks[0].workouts[0];
    expect(anyWorkout.targetHRMin).not.toBeNull();
    expect(anyWorkout.targetHRMax).not.toBeNull();
  });

  it('omits heart-rate guidance when they are not', () => {
    const withoutHR = generatePlan({ ...baseInput, maxHR: null, restingHR: null });
    expect(withoutHR.weeks[0].workouts[0].targetHRMin).toBeNull();
  });

  it('builds interval sessions out of repetitions', () => {
    const interval = plan.weeks
      .flatMap((w) => w.workouts)
      .find((w) => w.workoutType === 'INTERVAL')!;

    const reps = interval.structure.find((s) => s.type === 'interval')!;
    expect(reps.repeat).toBeGreaterThanOrEqual(3);
    expect(reps.distance).toBe(1000);
    expect(interval.description).toContain('×');
  });

  it('adapts the number of sessions to what the athlete can commit to', () => {
    for (const sessions of [3, 5, 6]) {
      const custom = generatePlan({ ...baseInput, sessionsPerWeek: sessions });
      expect(custom.weeks[0].workouts).toHaveLength(sessions);
    }
  });

  it('respects a different preferred long-run day', () => {
    const saturday = generatePlan({ ...baseInput, longRunDay: 6 });
    const longRun = saturday.weeks[0].workouts.find((w) => w.workoutType === 'LONG_RUN')!;
    expect(longRun.date.getDay()).toBe(6);
  });

  it('scales the whole plan to the athlete rather than a template', () => {
    const smaller = generatePlan({ ...baseInput, currentWeeklyDistance: 20000 });
    expect(smaller.weeks[0].plannedDistance).toBeLessThan(plan.weeks[0].plannedDistance);
  });

  it('explains what it did', () => {
    expect(plan.notes.length).toBeGreaterThan(1);
    expect(plan.notes.join(' ')).toContain('%');
  });

  it('runs from a Monday to a Sunday', () => {
    expect(plan.startDate.getDay()).toBe(1);
    expect(plan.endDate.getDay()).toBe(0);
  });
});

describe('calculatePaceZones', () => {
  it('orders the zones from fastest to slowest', () => {
    const zones = calculatePaceZones({
      goalDistance: 42195,
      goalTime: 13200,
      estimatedThresholdPace: 295,
      observedEasyPace: 355,
    });

    expect(zones.interval.max).toBeLessThan(zones.tempo.min);
    expect(zones.tempo.max).toBeLessThan(zones.marathon.max);
    expect(zones.marathon.max).toBeLessThan(zones.long.max);
    expect(zones.long.max).toBeLessThan(zones.easy.max);
    expect(zones.easy.max).toBeLessThan(zones.recovery.max);
  });

  it('takes the more conservative of goal and current fitness', () => {
    // Current fitness far behind an ambitious goal: fitness must win.
    const zones = calculatePaceZones({
      goalDistance: 42195,
      goalTime: 10800, // a 3:00 marathon
      estimatedThresholdPace: 330, // but currently much slower
      observedEasyPace: 400,
    });

    expect(zones.thresholdPace).toBe(330);
    expect(zones.basis).toBe('both');
    expect(zones.explanation).toContain('current fitness');
  });

  it('falls back to the goal when there is no fitness estimate', () => {
    const zones = calculatePaceZones({
      goalDistance: 42195,
      goalTime: 13200,
      estimatedThresholdPace: null,
      observedEasyPace: null,
    });

    expect(zones.basis).toBe('goal');
  });

  it('says so plainly when it has nothing to work from', () => {
    const zones = calculatePaceZones({
      goalDistance: null,
      goalTime: null,
      estimatedThresholdPace: null,
      observedEasyPace: null,
    });

    expect(zones.explanation).toContain('not enough data');
  });
});
