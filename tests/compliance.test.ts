import { describe, expect, it } from 'vitest';
import {
  complianceToDate,
  currentWeekNumber,
  planCompliance,
  weekCompliance,
  type PlannedWorkoutLike,
} from '@/analytics/compliance';

const day = (offset: number) => {
  const d = new Date(2026, 5, 15); // a Monday
  d.setDate(d.getDate() + offset);
  return d;
};

const workout = (over: Partial<PlannedWorkoutLike> = {}): PlannedWorkoutLike => ({
  id: Math.random().toString(36).slice(2),
  date: day(0),
  weekNumber: 1,
  workoutType: 'EASY',
  targetDistance: 10000,
  completionStatus: 'planned',
  linkedActivityId: null,
  linkedActivity: null,
  ...over,
});

describe('weekCompliance', () => {
  it('reports full compliance when everything was done', () => {
    const workouts = Array.from({ length: 4 }, (_, i) =>
      workout({
        date: day(i),
        completionStatus: 'completed',
        linkedActivityId: `a${i}`,
        linkedActivity: { distance: 10000, duration: 3000 },
      }),
    );

    const result = weekCompliance(workouts, 1)!;

    expect(result.sessionsCompleted).toBe(4);
    expect(result.sessionsPlanned).toBe(4);
    expect(result.sessionCompliance).toBe(1);
    expect(result.volumeCompliance).toBe(1);
  });

  it('reports a shortfall in volume as well as sessions', () => {
    const workouts = [
      workout({
        completionStatus: 'completed',
        linkedActivity: { distance: 9000, duration: 2700 },
        linkedActivityId: 'a',
      }),
      workout({ date: day(2), completionStatus: 'missed' }),
    ];

    const result = weekCompliance(workouts, 1)!;

    expect(result.sessionsCompleted).toBe(1);
    expect(result.sessionsMissed).toBe(1);
    expect(result.sessionCompliance).toBe(0.5);
    expect(result.volumeCompliance).toBeCloseTo(9000 / 20000, 5);
  });

  it('leaves deliberately skipped sessions out of the denominator', () => {
    const workouts = [
      workout({
        completionStatus: 'completed',
        linkedActivity: { distance: 10000, duration: 3000 },
        linkedActivityId: 'a',
      }),
      workout({ date: day(2), completionStatus: 'skipped' }),
    ];

    const result = weekCompliance(workouts, 1)!;

    expect(result.sessionsPlanned).toBe(1);
    expect(result.sessionCompliance).toBe(1);
    expect(result.sessionsSkipped).toBe(1);
  });

  it('does not count rest days as sessions', () => {
    const workouts = [
      workout({ completionStatus: 'completed', linkedActivityId: 'a', linkedActivity: { distance: 10000, duration: 3000 } }),
      workout({ date: day(1), workoutType: 'REST', targetDistance: null }),
    ];

    expect(weekCompliance(workouts, 1)!.sessionsPlanned).toBe(1);
  });

  it('returns null for a week that has no sessions', () => {
    expect(weekCompliance([workout()], 7)).toBeNull();
  });
});

describe('complianceToDate', () => {
  it('ignores weeks that have not happened yet', () => {
    const workouts = [
      workout({
        date: day(-7),
        weekNumber: 1,
        completionStatus: 'completed',
        linkedActivityId: 'a',
        linkedActivity: { distance: 10000, duration: 3000 },
      }),
      // Next week — not due yet, so it must not count as a failure.
      workout({ date: day(7), weekNumber: 2 }),
    ];

    const result = complianceToDate(workouts, day(0));

    expect(result.sessionsPlanned).toBe(1);
    expect(result.overallSessionCompliance).toBe(1);
    expect(result.weeks).toHaveLength(1);
  });

  it('returns null compliance when nothing has been due yet', () => {
    const result = complianceToDate([workout({ date: day(14), weekNumber: 3 })], day(0));
    expect(result.overallSessionCompliance).toBeNull();
  });
});

describe('planCompliance', () => {
  it('covers every week that has sessions', () => {
    const workouts = [
      workout({ weekNumber: 1, date: day(0) }),
      workout({ weekNumber: 2, date: day(7) }),
      workout({ weekNumber: 3, date: day(14) }),
    ];
    expect(planCompliance(workouts)).toHaveLength(3);
  });
});

describe('currentWeekNumber', () => {
  it('finds the training week containing today', () => {
    const workouts = [
      workout({ weekNumber: 1, date: day(0) }),
      workout({ weekNumber: 2, date: day(7) }),
    ];
    expect(currentWeekNumber(workouts, day(8))).toBe(2);
  });

  it('returns null when the date falls outside the plan', () => {
    expect(currentWeekNumber([workout({ weekNumber: 1, date: day(0) })], day(60))).toBeNull();
  });
});
