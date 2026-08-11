/**
 * Volume aggregation — distance, time and session counts over periods.
 *
 * Used by the dashboard summary cards, the training-volume chart, the fitness
 * snapshot and the AI Coach's week-summary tool. One implementation so all four
 * always report the same numbers.
 */

import { addDays, dateKey, isWithin, startOfWeek } from '@/lib/dates';
import type { Sport } from '@/lib/constants';

export interface VolumeActivity {
  date: Date;
  sport: string;
  duration: number; // seconds
  distance: number | null; // metres
  trainingLoad: number | null;
}

export interface PeriodVolume {
  start: Date;
  end: Date;
  /** Total moving time across all sports, in seconds. */
  totalDuration: number;
  /** Distance per sport, in metres. */
  distanceBySport: Record<string, number>;
  /** Moving time per sport, in seconds. */
  durationBySport: Record<string, number>;
  activityCount: number;
  countBySport: Record<string, number>;
  totalLoad: number;
}

const EMPTY_SPORTS = (): Record<string, number> => ({
  running: 0,
  cycling: 0,
  swimming: 0,
  other: 0,
});

/** Aggregate every activity that falls inside [start, end]. */
export function volumeForPeriod(
  activities: VolumeActivity[],
  start: Date,
  end: Date,
): PeriodVolume {
  const result: PeriodVolume = {
    start,
    end,
    totalDuration: 0,
    distanceBySport: EMPTY_SPORTS(),
    durationBySport: EMPTY_SPORTS(),
    activityCount: 0,
    countBySport: EMPTY_SPORTS(),
    totalLoad: 0,
  };

  for (const activity of activities) {
    if (!isWithin(activity.date, start, end)) continue;

    const sport = activity.sport in result.distanceBySport ? activity.sport : 'other';

    result.totalDuration += activity.duration;
    result.durationBySport[sport] += activity.duration;
    result.distanceBySport[sport] += activity.distance ?? 0;
    result.activityCount += 1;
    result.countBySport[sport] += 1;
    result.totalLoad += activity.trainingLoad ?? 0;
  }

  result.totalLoad = Math.round(result.totalLoad * 10) / 10;
  return result;
}

export interface WeeklyVolume {
  /** Monday of the week, as a "YYYY-MM-DD" key. */
  weekStart: string;
  weekStartDate: Date;
  running: number; // metres
  cycling: number;
  swimming: number;
  other: number;
  totalDistance: number;
  totalHours: number;
  totalLoad: number;
  activityCount: number;
}

/**
 * Break a date range into Monday-to-Sunday weeks.
 *
 * Weeks with no training are still included, as zero — an honest volume chart
 * has to show the gaps.
 */
export function weeklyVolumes(
  activities: VolumeActivity[],
  start: Date,
  end: Date,
): WeeklyVolume[] {
  const weeks: WeeklyVolume[] = [];
  let cursor = startOfWeek(start);
  const last = startOfWeek(end);

  while (cursor.getTime() <= last.getTime()) {
    const weekEnd = addDays(cursor, 6);
    weekEnd.setHours(23, 59, 59, 999);
    const period = volumeForPeriod(activities, cursor, weekEnd);

    weeks.push({
      weekStart: dateKey(cursor),
      weekStartDate: new Date(cursor),
      running: Math.round(period.distanceBySport.running),
      cycling: Math.round(period.distanceBySport.cycling),
      swimming: Math.round(period.distanceBySport.swimming),
      other: Math.round(period.distanceBySport.other),
      totalDistance: Math.round(
        Object.values(period.distanceBySport).reduce((a, b) => a + b, 0),
      ),
      totalHours: Math.round((period.totalDuration / 3600) * 100) / 100,
      totalLoad: period.totalLoad,
      activityCount: period.activityCount,
    });

    cursor = addDays(cursor, 7);
  }

  return weeks;
}

/**
 * Compare a period against the one immediately before it, and against a longer
 * baseline — the two comparisons the dashboard shows for every headline number.
 */
export interface VolumeComparison {
  current: PeriodVolume;
  previous: PeriodVolume;
  /** Average of the four weeks before the current one, scaled to one week. */
  fourWeekAverage: PeriodVolume;
}

export function compareRecentVolume(
  activities: VolumeActivity[],
  asOf: Date = new Date(),
): VolumeComparison {
  const currentEnd = asOf;
  const currentStart = addDays(asOf, -6);
  const previousEnd = addDays(currentStart, -1);
  const previousStart = addDays(previousEnd, -6);

  const baselineEnd = previousEnd;
  const baselineStart = addDays(baselineEnd, -27);
  const baseline = volumeForPeriod(activities, baselineStart, baselineEnd);

  // Scale the 28-day totals down to a single average week.
  const perWeek = <T extends Record<string, number>>(record: T): T => {
    const scaled = {} as T;
    for (const key of Object.keys(record) as (keyof T)[]) {
      scaled[key] = (record[key] / 4) as T[keyof T];
    }
    return scaled;
  };

  return {
    current: volumeForPeriod(activities, currentStart, currentEnd),
    previous: volumeForPeriod(activities, previousStart, previousEnd),
    fourWeekAverage: {
      ...baseline,
      totalDuration: baseline.totalDuration / 4,
      distanceBySport: perWeek(baseline.distanceBySport),
      durationBySport: perWeek(baseline.durationBySport),
      activityCount: baseline.activityCount / 4,
      countBySport: perWeek(baseline.countBySport),
      totalLoad: baseline.totalLoad / 4,
    },
  };
}

/** (current − previous) / previous, or null when there is no baseline. */
export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return (current - previous) / previous;
}

/** Distance covered in one sport over a period, in metres. */
export function distanceFor(volume: PeriodVolume, sport: Sport): number {
  return volume.distanceBySport[sport] ?? 0;
}
