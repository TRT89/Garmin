/**
 * Training compliance — planned against actual.
 *
 * Compliance is reported two ways, because they answer different questions:
 *
 *   - **Sessions**: did you turn up? 3 of 4 is a different problem from 4 of 4.
 *   - **Volume**: did you do the work? 38 km of a planned 42 km is 90%.
 *
 * Sessions the athlete deliberately skipped are excluded from the denominator —
 * counting a session you chose to drop as a failure would make the figure
 * meaningless.
 */

import { isWithin, startOfWeek, addDays } from '@/lib/dates';

export interface PlannedWorkoutLike {
  id: string;
  date: Date;
  weekNumber: number;
  workoutType: string;
  targetDistance: number | null;
  completionStatus: string;
  linkedActivityId: string | null;
  linkedActivity?: { distance: number | null; duration: number } | null;
}

export interface WeekCompliance {
  weekNumber: number;
  weekStart: Date;
  sessionsPlanned: number;
  sessionsCompleted: number;
  sessionsMissed: number;
  sessionsSkipped: number;
  plannedDistance: number; // metres
  actualDistance: number; // metres
  /** Distance completed as a fraction of distance planned. Null if nothing planned. */
  volumeCompliance: number | null;
  /** Sessions completed as a fraction of sessions planned. Null if nothing planned. */
  sessionCompliance: number | null;
}

/** Compliance for one training week. */
export function weekCompliance(
  workouts: PlannedWorkoutLike[],
  weekNumber: number,
): WeekCompliance | null {
  const inWeek = workouts.filter((w) => w.weekNumber === weekNumber);
  if (inWeek.length === 0) return null;

  const running = inWeek.filter((w) => w.workoutType !== 'REST');

  const completed = running.filter((w) => w.completionStatus === 'completed');
  const missed = running.filter((w) => w.completionStatus === 'missed');
  const skipped = running.filter((w) => w.completionStatus === 'skipped');

  // Skipped sessions leave the denominator: they were a decision, not a failure.
  const counted = running.filter((w) => w.completionStatus !== 'skipped');

  const plannedDistance = counted.reduce((sum, w) => sum + (w.targetDistance ?? 0), 0);
  const actualDistance = completed.reduce(
    (sum, w) => sum + (w.linkedActivity?.distance ?? 0),
    0,
  );

  return {
    weekNumber,
    weekStart: startOfWeek(inWeek[0].date),
    sessionsPlanned: counted.length,
    sessionsCompleted: completed.length,
    sessionsMissed: missed.length,
    sessionsSkipped: skipped.length,
    plannedDistance: Math.round(plannedDistance),
    actualDistance: Math.round(actualDistance),
    volumeCompliance: plannedDistance > 0 ? actualDistance / plannedDistance : null,
    sessionCompliance: counted.length > 0 ? completed.length / counted.length : null,
  };
}

/** Compliance for every week of a plan. */
export function planCompliance(workouts: PlannedWorkoutLike[]): WeekCompliance[] {
  const weekNumbers = [...new Set(workouts.map((w) => w.weekNumber))].sort((a, b) => a - b);
  return weekNumbers
    .map((n) => weekCompliance(workouts, n))
    .filter((w): w is WeekCompliance => w !== null);
}

/**
 * Compliance across the weeks that have actually happened.
 *
 * Future weeks are excluded — a plan is not "0% compliant" for work that is not
 * due yet.
 */
export function complianceToDate(
  workouts: PlannedWorkoutLike[],
  asOf: Date = new Date(),
): {
  weeks: WeekCompliance[];
  sessionsPlanned: number;
  sessionsCompleted: number;
  overallSessionCompliance: number | null;
  overallVolumeCompliance: number | null;
} {
  const past = workouts.filter((w) => w.date <= asOf);
  const weeks = planCompliance(past);

  const sessionsPlanned = weeks.reduce((sum, w) => sum + w.sessionsPlanned, 0);
  const sessionsCompleted = weeks.reduce((sum, w) => sum + w.sessionsCompleted, 0);
  const plannedDistance = weeks.reduce((sum, w) => sum + w.plannedDistance, 0);
  const actualDistance = weeks.reduce((sum, w) => sum + w.actualDistance, 0);

  return {
    weeks,
    sessionsPlanned,
    sessionsCompleted,
    overallSessionCompliance: sessionsPlanned > 0 ? sessionsCompleted / sessionsPlanned : null,
    overallVolumeCompliance: plannedDistance > 0 ? actualDistance / plannedDistance : null,
  };
}

/** Which training week a date falls in, or null if outside the plan. */
export function currentWeekNumber(
  workouts: PlannedWorkoutLike[],
  asOf: Date = new Date(),
): number | null {
  const weekStart = startOfWeek(asOf);
  const weekEnd = addDays(weekStart, 6);

  const match = workouts.find((w) => isWithin(w.date, weekStart, weekEnd));
  return match?.weekNumber ?? null;
}

export const COMPLIANCE_EXPLANATION =
  'Compliance compares what your plan asked for against what you actually did. Sessions you deliberately skipped are left out of the calculation, so the figure reflects training you intended to do.';
