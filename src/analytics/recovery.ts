/**
 * Recovery and readiness.
 *
 * Every judgement here is made against the athlete's *own* recent baseline
 * rather than any population norm. A resting heart rate of 52 means nothing on
 * its own; 52 when your fortnightly average is 46 means something.
 *
 * This is explicitly not medical assessment. The functions describe deviations
 * from a personal baseline and nothing more.
 */

import { addDays, dateKey, endOfDay, isWithin, startOfDay } from '@/lib/dates';

export interface HealthRecord {
  date: Date;
  restingHR: number | null;
  sleepDuration: number | null; // minutes
  sleepScore: number | null;
  stress: number | null;
  bodyBattery: number | null;
  steps: number | null;
}

/** How a current value compares with a personal baseline. */
export interface BaselineComparison {
  current: number | null;
  baseline: number | null;
  /** current − baseline. Null when either side is unavailable. */
  delta: number | null;
  /** How many days of data the baseline is built from. */
  baselineDays: number;
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Compare the most recent `recentDays` against the `baselineDays` before them.
 *
 * Using a recent *window* rather than a single day is deliberate: one bad
 * night's sleep is noise, three in a row is a signal.
 */
function compareToBaseline(
  records: HealthRecord[],
  field: keyof HealthRecord,
  asOf: Date,
  recentDays = 3,
  baselineDays = 14,
): BaselineComparison {
  // Snap every boundary to whole days. Health records are dated at midnight
  // while `asOf` is usually the current time, and comparing the two directly
  // would drop the day on the seam between the two windows — it would fall
  // after the baseline ended but before the recent window began, and be counted
  // in neither.
  const recentStart = startOfDay(addDays(asOf, -(recentDays - 1)));
  const recentEnd = endOfDay(asOf);
  const baselineStart = startOfDay(addDays(recentStart, -baselineDays));
  const baselineEnd = endOfDay(addDays(recentStart, -1));

  const valueOf = (record: HealthRecord): number | null => {
    const value = record[field];
    return typeof value === 'number' ? value : null;
  };

  const recentValues = records
    .filter((r) => isWithin(r.date, recentStart, recentEnd))
    .map(valueOf)
    .filter((v): v is number => v != null);

  const baselineValues = records
    .filter((r) => isWithin(r.date, baselineStart, baselineEnd))
    .map(valueOf)
    .filter((v): v is number => v != null);

  const current = average(recentValues);
  const baseline = average(baselineValues);

  return {
    current: current == null ? null : Math.round(current * 10) / 10,
    baseline: baseline == null ? null : Math.round(baseline * 10) / 10,
    delta: current != null && baseline != null ? Math.round((current - baseline) * 10) / 10 : null,
    baselineDays: baselineValues.length,
  };
}

export interface RecoveryStatus {
  restingHR: BaselineComparison;
  sleepDuration: BaselineComparison;
  sleepScore: BaselineComparison;
  stress: BaselineComparison;
  bodyBattery: BaselineComparison;

  /**
   * How many independent recovery indicators are currently worse than baseline.
   * The adaptation engine requires several before it will change anything.
   */
  negativeIndicators: number;
  positiveIndicators: number;

  /** Overall reading: one of "good", "moderate", "compromised", or "unknown". */
  status: 'good' | 'moderate' | 'compromised' | 'unknown';
  /** Plain sentences, each tied to a number above. */
  evidence: string[];
  summary: string;
}

/**
 * What counts as a meaningful deviation for each indicator.
 *
 * These thresholds are deliberately wide, so ordinary day-to-day variation does
 * not trigger a change to the training plan.
 */
const THRESHOLDS = {
  restingHRUp: 3, // bpm above baseline
  sleepDown: 45, // minutes below baseline
  sleepScoreDown: 8, // points below baseline
  stressUp: 10, // points above baseline
  bodyBatteryDown: 10, // points below baseline
} as const;

/** Assess current recovery against the athlete's own baseline. */
export function assessRecovery(
  records: HealthRecord[],
  asOf: Date = new Date(),
): RecoveryStatus {
  const restingHR = compareToBaseline(records, 'restingHR', asOf);
  const sleepDuration = compareToBaseline(records, 'sleepDuration', asOf);
  const sleepScore = compareToBaseline(records, 'sleepScore', asOf);
  const stress = compareToBaseline(records, 'stress', asOf);
  const bodyBattery = compareToBaseline(records, 'bodyBattery', asOf);

  const evidence: string[] = [];
  let negative = 0;
  let positive = 0;

  if (restingHR.delta != null) {
    if (restingHR.delta >= THRESHOLDS.restingHRUp) {
      negative++;
      evidence.push(
        `Resting heart rate is ${restingHR.delta.toFixed(0)} bpm above your 14-day average (${restingHR.current} vs ${restingHR.baseline}).`,
      );
    } else if (restingHR.delta <= -2) {
      positive++;
      evidence.push(
        `Resting heart rate is ${Math.abs(restingHR.delta).toFixed(0)} bpm below your 14-day average.`,
      );
    }
  }

  if (sleepDuration.delta != null && sleepDuration.delta <= -THRESHOLDS.sleepDown) {
    negative++;
    const hours = Math.floor(Math.abs(sleepDuration.delta) / 60);
    const mins = Math.round(Math.abs(sleepDuration.delta) % 60);
    evidence.push(
      `Sleep is averaging ${hours > 0 ? `${hours}h ` : ''}${mins}m less than your 14-day average.`,
    );
  }

  if (sleepScore.delta != null && sleepScore.delta <= -THRESHOLDS.sleepScoreDown) {
    negative++;
    evidence.push(
      `Sleep score is ${Math.abs(sleepScore.delta).toFixed(0)} points below your 14-day average.`,
    );
  }

  if (stress.delta != null && stress.delta >= THRESHOLDS.stressUp) {
    negative++;
    evidence.push(
      `Recorded stress is ${stress.delta.toFixed(0)} points above your 14-day average.`,
    );
  }

  if (bodyBattery.delta != null) {
    if (bodyBattery.delta <= -THRESHOLDS.bodyBatteryDown) {
      negative++;
      evidence.push(
        `Your device's readiness score is ${Math.abs(bodyBattery.delta).toFixed(0)} points below your 14-day average.`,
      );
    } else if (bodyBattery.delta >= 8) {
      positive++;
      evidence.push(
        `Your device's readiness score is ${bodyBattery.delta.toFixed(0)} points above your 14-day average.`,
      );
    }
  }

  const anyData =
    restingHR.current != null ||
    sleepDuration.current != null ||
    bodyBattery.current != null ||
    stress.current != null;

  let status: RecoveryStatus['status'];
  let summary: string;

  if (!anyData) {
    status = 'unknown';
    summary =
      'No recent health data is available, so recovery cannot be assessed. Training decisions are being made from your activity data alone.';
  } else if (negative >= 3) {
    status = 'compromised';
    summary = `${negative} recovery indicators are below your personal baseline at the same time.`;
  } else if (negative === 2) {
    status = 'moderate';
    summary = 'Two recovery indicators are below your personal baseline.';
  } else if (negative === 1) {
    status = 'moderate';
    summary = 'One recovery indicator is below your personal baseline, which on its own is normal variation.';
  } else {
    status = 'good';
    summary = 'Your recovery indicators are in line with, or better than, your personal baseline.';
  }

  return {
    restingHR,
    sleepDuration,
    sleepScore,
    stress,
    bodyBattery,
    negativeIndicators: negative,
    positiveIndicators: positive,
    status,
    evidence,
    summary,
  };
}

// ---------------------------------------------------------------------------
// Series for the recovery charts
// ---------------------------------------------------------------------------

export interface RecoveryPoint {
  date: string;
  restingHR: number | null;
  sleepHours: number | null;
  sleepScore: number | null;
  stress: number | null;
  bodyBattery: number | null;
}

/** Daily recovery values across a range, ready to plot. */
export function recoverySeries(
  records: HealthRecord[],
  start: Date,
  end: Date,
): RecoveryPoint[] {
  return records
    .filter((r) => isWithin(r.date, start, end))
    .sort((a, b) => a.date.getTime() - b.date.getTime())
    .map((r) => ({
      date: dateKey(r.date),
      restingHR: r.restingHR,
      sleepHours: r.sleepDuration != null ? Math.round((r.sleepDuration / 60) * 100) / 100 : null,
      sleepScore: r.sleepScore,
      stress: r.stress,
      bodyBattery: r.bodyBattery,
    }));
}

export const RECOVERY_EXPLANATION =
  'Recovery is judged against your own 14-day average, not against any population norm. A single indicator moving is normal variation; several moving together is what this application treats as a signal.';
