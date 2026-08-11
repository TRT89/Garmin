/**
 * Training load — our own, deliberately transparent model.
 *
 * This is NOT an attempt to reproduce Garmin's proprietary training-load or
 * Training Effect figures. It is a simple, published, checkable method, and the
 * interface always labels it as ours ("AI Coach calculated") so the two are
 * never confused.
 *
 * ## How a session's load is calculated
 *
 * When heart rate is available we use Banister's TRIMP (training impulse):
 *
 *     HRR  = (avgHR − restingHR) / (maxHR − restingHR)     "heart-rate reserve"
 *     load = minutes × HRR × 0.64 × e^(1.92 × HRR)          (men)
 *     load = minutes × HRR × 0.86 × e^(1.67 × HRR)          (women)
 *
 * The exponential term is what makes hard minutes count for much more than easy
 * ones, which is the entire point: an hour of intervals is not the same stress
 * as an hour of jogging.
 *
 * When heart rate is missing but pace is not, we fall back to a duration ×
 * intensity² estimate against an assumed threshold pace. It is cruder, and is
 * reported as such via the `method` field.
 *
 * When neither is available the load is `null`. We do not guess.
 *
 * ## Accumulated load
 *
 *   acute (7-day)    how much work you have done recently — fatigue
 *   chronic (28-day) the base you have built up over time — fitness
 *   ratio            acute ÷ (chronic ÷ 4) — a rough measure of how much you
 *                    are asking of yourself relative to what you are used to
 *
 * These are ordinary rolling sums. Sports-science convention treats a ratio far
 * above 1.5 as a period of unusually sharp load increase; we surface the number
 * and say what it means rather than making medical claims about it.
 */

import { addDays, dateKey, daysBetween, startOfDay } from '@/lib/dates';

/** Fallback threshold pace (seconds per km) when we cannot estimate one. */
const ASSUMED_THRESHOLD_PACE = 300; // 5:00/km

export interface SessionLoadInput {
  duration: number; // seconds
  avgHR: number | null;
  distance: number | null; // metres
  avgPace: number | null; // seconds per km
  sport: string;
}

export interface AthleteHR {
  maxHR: number | null;
  restingHR: number | null;
  sex: string | null;
}

export interface SessionLoad {
  /** The load figure, or null when the data does not support one. */
  value: number | null;
  /** Which method produced it, so the interface can be honest about precision. */
  method: 'trimp' | 'pace' | null;
  /** One-line explanation shown in tooltips. */
  explanation: string;
}

/**
 * Calculate the training load of a single session.
 *
 * Pure function — no database access — so it can be unit tested and reused by
 * the AI tool layer.
 */
export function calculateSessionLoad(
  activity: SessionLoadInput,
  athlete: AthleteHR,
  thresholdPace: number = ASSUMED_THRESHOLD_PACE,
): SessionLoad {
  const minutes = activity.duration / 60;

  if (minutes <= 0) {
    return { value: null, method: null, explanation: 'The session has no recorded duration.' };
  }

  // --- Preferred method: heart-rate based TRIMP ---------------------------
  const { avgHR } = activity;
  const maxHR = athlete.maxHR;
  const restingHR = athlete.restingHR;

  if (avgHR != null && maxHR != null && restingHR != null && maxHR > restingHR) {
    const hrr = Math.max(0, Math.min(1, (avgHR - restingHR) / (maxHR - restingHR)));
    // Women's coefficients differ; anything else uses the men's values, which is
    // stated here rather than hidden.
    const female = athlete.sex === 'female';
    const k = female ? 0.86 : 0.64;
    const exp = female ? 1.67 : 1.92;
    const value = minutes * hrr * k * Math.exp(exp * hrr);

    return {
      value: Math.round(value * 10) / 10,
      method: 'trimp',
      explanation: `${Math.round(minutes)} min at an average of ${avgHR} bpm, which is ${Math.round(
        hrr * 100,
      )}% of your heart-rate reserve.`,
    };
  }

  // --- Fallback: pace based -----------------------------------------------
  if (activity.avgPace != null && activity.avgPace > 0) {
    // Intensity as a fraction of threshold pace, squared so that harder running
    // counts disproportionately — the same principle as the TRIMP exponential.
    const intensity = thresholdPace / activity.avgPace;
    const value = minutes * Math.pow(Math.max(0.4, Math.min(1.3, intensity)), 2) * 1.6;

    return {
      value: Math.round(value * 10) / 10,
      method: 'pace',
      explanation: `Estimated from pace because this session has no heart-rate data. ${Math.round(
        minutes,
      )} min at an intensity of ${Math.round(intensity * 100)}% of your estimated threshold pace.`,
    };
  }

  return {
    value: null,
    method: null,
    explanation:
      'This session has neither heart-rate nor pace data, so a training load cannot be calculated.',
  };
}

// ---------------------------------------------------------------------------
// Accumulated load over time
// ---------------------------------------------------------------------------

export interface LoadDataPoint {
  date: Date;
  trainingLoad: number | null;
}

export interface LoadSeriesPoint {
  date: string; // "YYYY-MM-DD"
  /** Load from sessions on this day. */
  daily: number;
  /** Rolling 7-day total — recent work, i.e. fatigue. */
  acute: number;
  /** Rolling 28-day total — the base you have built, i.e. fitness. */
  chronic: number;
  /** acute ÷ (chronic ÷ 4). Null until there is enough history to mean anything. */
  ratio: number | null;
}

/**
 * Build a day-by-day load series across a date range.
 *
 * Activities before `start` are still used, because a 28-day rolling total on
 * the first day of the range needs the 28 days preceding it.
 */
export function buildLoadSeries(
  activities: LoadDataPoint[],
  start: Date,
  end: Date,
): LoadSeriesPoint[] {
  // Sum each day's load once, up front.
  const byDay = new Map<string, number>();
  for (const activity of activities) {
    if (activity.trainingLoad == null) continue;
    const key = dateKey(activity.date);
    byDay.set(key, (byDay.get(key) ?? 0) + activity.trainingLoad);
  }

  const series: LoadSeriesPoint[] = [];
  const first = startOfDay(start);
  const last = startOfDay(end);
  const totalDays = daysBetween(first, last);

  for (let i = 0; i <= totalDays; i++) {
    const day = addDays(first, i);

    let acute = 0;
    for (let back = 0; back < 7; back++) {
      acute += byDay.get(dateKey(addDays(day, -back))) ?? 0;
    }

    let chronic = 0;
    for (let back = 0; back < 28; back++) {
      chronic += byDay.get(dateKey(addDays(day, -back))) ?? 0;
    }

    // A ratio computed against almost no history is noise, so it stays null.
    const weeklyChronic = chronic / 4;
    const ratio = weeklyChronic > 10 ? Math.round((acute / weeklyChronic) * 100) / 100 : null;

    series.push({
      date: dateKey(day),
      daily: Math.round((byDay.get(dateKey(day)) ?? 0) * 10) / 10,
      acute: Math.round(acute * 10) / 10,
      chronic: Math.round(chronic * 10) / 10,
      ratio,
    });
  }

  return series;
}

export interface LoadSummary {
  acute: number;
  chronic: number;
  chronicWeekly: number;
  ratio: number | null;
  /** How the acute load compares with the seven days before it. */
  previousAcute: number;
  acuteChange: number | null;
  interpretation: string;
}

/** Summarise the current load position as of `asOf`. */
export function summariseLoad(activities: LoadDataPoint[], asOf: Date = new Date()): LoadSummary {
  const series = buildLoadSeries(activities, addDays(asOf, -7), asOf);
  const today = series[series.length - 1];
  const weekAgo = series[0];

  const acute = today?.acute ?? 0;
  const chronic = today?.chronic ?? 0;
  const chronicWeekly = chronic / 4;
  const ratio = today?.ratio ?? null;
  const previousAcute = weekAgo?.acute ?? 0;

  const acuteChange = previousAcute > 0 ? (acute - previousAcute) / previousAcute : null;

  let interpretation: string;
  if (ratio === null) {
    interpretation =
      'There is not yet enough training history to compare this week against your longer-term base.';
  } else if (ratio > 1.5) {
    interpretation =
      'This week is a large step up from what you have been used to over the past four weeks.';
  } else if (ratio > 1.3) {
    interpretation = 'This week is meaningfully harder than your recent four-week average.';
  } else if (ratio < 0.8) {
    interpretation = 'This week is lighter than your recent four-week average.';
  } else {
    interpretation = 'This week is in line with what you have been doing over the past four weeks.';
  }

  return {
    acute: Math.round(acute * 10) / 10,
    chronic: Math.round(chronic * 10) / 10,
    chronicWeekly: Math.round(chronicWeekly * 10) / 10,
    ratio,
    previousAcute: Math.round(previousAcute * 10) / 10,
    acuteChange,
    interpretation,
  };
}

/** The wording used wherever the load model is explained in the interface. */
export const LOAD_EXPLANATION =
  'Training load is calculated by this application from your duration and heart rate using the published TRIMP method, not taken from Garmin. Harder minutes count for disproportionately more than easy ones.';

export const ACWR_EXPLANATION =
  'The ratio compares the last 7 days of training against the average week of the last 28 days. Around 1.0 means this week matches what you are used to; well above 1.5 means a sharp increase.';
