/**
 * Trends over time — the evidence behind "am I actually getting faster?".
 *
 * The honest way to answer that question is not "is my pace quicker", because
 * pace depends on how hard you ran. It is "am I covering ground faster for the
 * same cardiovascular cost". That is what these functions measure.
 */

import { addDays, dateKey } from '@/lib/dates';
import { efficiencyFactor } from './activityMetrics';

export interface TrendActivity {
  id: string;
  date: Date;
  sport: string;
  title: string;
  duration: number;
  distance: number | null;
  avgHR: number | null;
  avgPace: number | null;
}

// ---------------------------------------------------------------------------
// Simple linear regression
// ---------------------------------------------------------------------------

export interface Regression {
  /** Change in y per day. */
  slope: number;
  intercept: number;
  /** Coefficient of determination, 0-1. How well the line fits the points. */
  r2: number;
  points: number;
}

/**
 * Least-squares fit of y against x.
 *
 * `r2` matters as much as the slope: a steep trend through scattered points is
 * not evidence of anything, and the interface refuses to call it a trend when
 * the fit is poor.
 */
export function linearRegression(data: { x: number; y: number }[]): Regression | null {
  const n = data.length;
  if (n < 3) return null;

  const meanX = data.reduce((s, p) => s + p.x, 0) / n;
  const meanY = data.reduce((s, p) => s + p.y, 0) / n;

  let numerator = 0;
  let denominator = 0;
  for (const p of data) {
    numerator += (p.x - meanX) * (p.y - meanY);
    denominator += (p.x - meanX) ** 2;
  }
  if (denominator === 0) return null;

  const slope = numerator / denominator;
  const intercept = meanY - slope * meanX;

  let ssTotal = 0;
  let ssResidual = 0;
  for (const p of data) {
    ssTotal += (p.y - meanY) ** 2;
    ssResidual += (p.y - (slope * p.x + intercept)) ** 2;
  }
  const r2 = ssTotal === 0 ? 0 : 1 - ssResidual / ssTotal;

  return { slope, intercept, r2: Math.round(r2 * 1000) / 1000, points: n };
}

// ---------------------------------------------------------------------------
// Aerobic efficiency trend
// ---------------------------------------------------------------------------

export interface EfficiencyPoint {
  date: string;
  activityId: string;
  title: string;
  /** Metres per second per heartbeat. */
  efficiency: number;
  pace: number | null;
  avgHR: number;
}

export interface EfficiencyTrend {
  points: EfficiencyPoint[];
  regression: Regression | null;
  /** Total percentage change implied by the fitted line across the period. */
  percentChange: number | null;
  /** Whether the fit is good enough to describe as a trend at all. */
  meaningful: boolean;
  summary: string;
}

/**
 * Track aerobic efficiency across easy runs.
 *
 * Only easy running is used, because efficiency is not comparable across
 * intensities — a hard interval session will always look "less efficient".
 */
export function efficiencyTrend(
  activities: TrendActivity[],
  start: Date,
  end: Date,
): EfficiencyTrend {
  const runs = activities.filter(
    (a) =>
      a.sport === 'running' &&
      a.date >= start &&
      a.date <= end &&
      a.avgHR != null &&
      a.distance != null &&
      a.distance > 3000,
  );

  if (runs.length < 4) {
    return {
      points: [],
      regression: null,
      percentChange: null,
      meaningful: false,
      summary:
        'There are not yet enough runs with heart-rate data in this period to judge a trend.',
    };
  }

  // Restrict to easier running: slower than the 35th percentile of pace.
  const paces = runs.map((r) => r.avgPace ?? Infinity).sort((a, b) => a - b);
  const easyCutoff = paces[Math.floor(paces.length * 0.35)];
  const easyRuns = runs.filter((r) => (r.avgPace ?? Infinity) >= easyCutoff);

  const points: EfficiencyPoint[] = [];
  for (const run of easyRuns) {
    const ef = efficiencyFactor(run);
    if (ef == null) continue;
    points.push({
      date: dateKey(run.date),
      activityId: run.id,
      title: run.title,
      efficiency: ef,
      pace: run.avgPace,
      avgHR: run.avgHR!,
    });
  }

  if (points.length < 4) {
    return {
      points,
      regression: null,
      percentChange: null,
      meaningful: false,
      summary: 'There are not yet enough comparable easy runs to judge a trend.',
    };
  }

  const startTime = start.getTime();
  const regression = linearRegression(
    points.map((p) => ({
      x: (new Date(p.date).getTime() - startTime) / (24 * 60 * 60 * 1000),
      y: p.efficiency,
    })),
  );

  if (!regression) {
    return {
      points,
      regression: null,
      percentChange: null,
      meaningful: false,
      summary: 'A trend could not be fitted to the available runs.',
    };
  }

  // Read the fitted line at the first and last runs that actually exist, rather
  // than at the edges of the requested window. Extrapolating a noisy fit out to
  // dates with no data behind them overstates the change.
  const xs = points.map((p) => (new Date(p.date).getTime() - startTime) / (24 * 60 * 60 * 1000));
  const firstX = Math.min(...xs);
  const lastX = Math.max(...xs);

  const startValue = regression.intercept + regression.slope * firstX;
  const endValue = regression.intercept + regression.slope * lastX;
  const percentChange = startValue > 0 ? (endValue - startValue) / startValue : null;

  // A weak fit is not a trend. Saying so is more useful than a confident wrong
  // answer.
  const meaningful = regression.r2 >= 0.15 && points.length >= 5;

  let summary: string;
  if (!meaningful) {
    summary = `Across ${points.length} easy runs there is no clear direction — the run-to-run variation is larger than any underlying trend.`;
  } else if (percentChange != null && percentChange > 0.015) {
    summary = `Across ${points.length} easy runs, your speed at a given heart rate has improved by about ${(
      percentChange * 100
    ).toFixed(1)}%.`;
  } else if (percentChange != null && percentChange < -0.015) {
    summary = `Across ${points.length} easy runs, your speed at a given heart rate has fallen by about ${Math.abs(
      percentChange * 100,
    ).toFixed(1)}%.`;
  } else {
    summary = `Across ${points.length} easy runs, your speed at a given heart rate has been essentially stable.`;
  }

  return { points, regression, percentChange, meaningful, summary };
}

// ---------------------------------------------------------------------------
// Pace against heart rate
// ---------------------------------------------------------------------------

export interface PaceHrPoint {
  date: string;
  activityId: string;
  title: string;
  pace: number; // seconds per km
  avgHR: number;
  distance: number | null;
}

/**
 * Every run that has both a pace and a heart rate, ready to be plotted against
 * each other. The scatter of these two values over time is the clearest single
 * picture of aerobic progress.
 */
export function paceHrSeries(
  activities: TrendActivity[],
  start: Date,
  end: Date,
  /**
   * Restrict to easier running. Strongly recommended when the chart is meant to
   * show progress: mixing interval sessions in makes the heart-rate line swing
   * between 140 and 180 and hides the very trend the chart exists to show.
   */
  easyOnly = false,
): PaceHrPoint[] {
  const runs = activities.filter(
    (a) =>
      a.sport === 'running' &&
      a.date >= start &&
      a.date <= end &&
      a.avgHR != null &&
      a.avgPace != null,
  );

  let selected = runs;
  if (easyOnly && runs.length >= 5) {
    // Anything slower than the 35th percentile of pace counts as easy running,
    // the same cut-off the efficiency trend uses.
    const paces = runs.map((r) => r.avgPace!).sort((a, b) => a - b);
    const cutoff = paces[Math.floor(paces.length * 0.35)];
    selected = runs.filter((r) => r.avgPace! >= cutoff);
  }

  return selected
    .map((a) => ({
      date: dateKey(a.date),
      activityId: a.id,
      title: a.title,
      pace: a.avgPace!,
      avgHR: a.avgHR!,
      distance: a.distance,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Compare average pace within a narrow heart-rate band between two periods.
 *
 * This is the most direct like-for-like comparison available: same effort, so
 * any pace difference is a fitness difference. Returns null when either period
 * lacks enough runs inside the band.
 */
export function paceAtComparableHR(
  activities: TrendActivity[],
  asOf: Date = new Date(),
  bandWidth = 5,
): {
  targetHR: number;
  recentPace: number;
  earlierPace: number;
  deltaSeconds: number;
  recentCount: number;
  earlierCount: number;
} | null {
  const runs = activities.filter(
    (a) => a.sport === 'running' && a.avgHR != null && a.avgPace != null && a.date <= asOf,
  );
  if (runs.length < 8) return null;

  // Centre the band on the athlete's median easy heart rate.
  const hrs = runs.map((r) => r.avgHR!).sort((a, b) => a - b);
  const targetHR = hrs[Math.floor(hrs.length * 0.4)];

  const inBand = runs.filter((r) => Math.abs(r.avgHR! - targetHR) <= bandWidth);
  if (inBand.length < 6) return null;

  const midpoint = addDays(asOf, -28);
  const recent = inBand.filter((r) => r.date >= midpoint);
  const earlier = inBand.filter((r) => r.date < midpoint);

  if (recent.length < 2 || earlier.length < 2) return null;

  const mean = (list: TrendActivity[]) =>
    list.reduce((s, r) => s + r.avgPace!, 0) / list.length;

  const recentPace = Math.round(mean(recent));
  const earlierPace = Math.round(mean(earlier));

  return {
    targetHR,
    recentPace,
    earlierPace,
    deltaSeconds: recentPace - earlierPace,
    recentCount: recent.length,
    earlierCount: earlier.length,
  };
}

export const EFFICIENCY_EXPLANATION =
  'Aerobic efficiency is your speed divided by your heart rate on easy runs. When it rises you are covering ground faster for the same cardiovascular effort, which is the clearest everyday sign that aerobic fitness is improving.';
