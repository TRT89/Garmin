/**
 * The running fitness snapshot.
 *
 * Answers "where am I right now?" from the last six to twelve weeks of running,
 * and produces the numbers the training-plan generator needs as its starting
 * point.
 *
 * Everything here is deliberately conservative. These are estimates from
 * ordinary training data, not laboratory measurements, and the interface says
 * so. Where the data cannot support an estimate, the field is null rather than
 * a guess.
 */

import { addDays, daysBetween, startOfWeek } from '@/lib/dates';
import { weeklyVolumes, type VolumeActivity } from './volume';

export interface FitnessActivity extends VolumeActivity {
  id: string;
  avgHR: number | null;
  avgPace: number | null; // seconds per km
  title: string;
}

export interface FitnessSnapshot {
  /** How much running history this snapshot is based on. */
  weeksAnalysed: number;
  runCount: number;

  /** Average weekly running distance in metres over the analysed period. */
  avgWeeklyDistance: number;
  /** The largest single run in the period, in metres. */
  longestRun: number;
  /** Average number of runs per week. */
  avgRunsPerWeek: number;

  /** Typical easy-run pace band, in seconds per km. Null when undeterminable. */
  easyPaceMin: number | null;
  easyPaceMax: number | null;
  /** Estimated lactate-threshold pace, in seconds per km. */
  thresholdPace: number | null;

  /** Average heart rate across easy runs, for the pace/heart-rate baseline. */
  easyAvgHR: number | null;

  /**
   * Proportion of weeks in the period containing at least two runs — a simple,
   * honest consistency measure. 0-1.
   */
  consistency: number;

  /** Notes explaining anything that could not be calculated. */
  notes: string[];
}

/**
 * Split runs into "easy" and "hard" by pace, relative to the athlete's own
 * median pace.
 *
 * Using the athlete's own distribution rather than fixed thresholds means this
 * works for a 3:00 marathoner and a 5:30 marathoner alike.
 */
function partitionByEffort(runs: FitnessActivity[]): {
  easy: FitnessActivity[];
  hard: FitnessActivity[];
} {
  const paced = runs.filter((r) => r.avgPace != null && r.avgPace > 0);
  if (paced.length < 3) return { easy: paced, hard: [] };

  const sorted = [...paced].sort((a, b) => a.avgPace! - b.avgPace!);
  const median = sorted[Math.floor(sorted.length / 2)].avgPace!;

  // Anything more than 6% quicker than the median is treated as a quality session.
  const threshold = median * 0.94;
  return {
    easy: paced.filter((r) => r.avgPace! > threshold),
    hard: paced.filter((r) => r.avgPace! <= threshold),
  };
}

/**
 * Estimate threshold pace — roughly the pace sustainable for an hour.
 *
 * Taken from the athlete's fastest sustained efforts of at least 20 minutes,
 * adjusted for the fact that a shorter hard effort is run faster than true
 * threshold. Returns null when there is nothing fast and long enough.
 */
function estimateThresholdPace(runs: FitnessActivity[]): number | null {
  const candidates = runs.filter(
    (r) => r.avgPace != null && r.avgPace > 0 && r.duration >= 20 * 60,
  );
  if (candidates.length === 0) return null;

  // The single best sustained effort in the period.
  const best = candidates.reduce((fastest, run) =>
    run.avgPace! < fastest.avgPace! ? run : fastest,
  );

  // A 20-30 minute hard effort sits a little faster than one-hour pace; a
  // longer one sits a little slower. Adjust conservatively toward slower.
  const minutes = best.duration / 60;
  const adjustment = minutes < 35 ? 1.04 : minutes < 60 ? 1.01 : 0.99;

  return Math.round(best.avgPace! * adjustment);
}

/**
 * Build the fitness snapshot from recent activity.
 *
 * @param activities every activity (all sports); running is filtered out here
 * @param asOf       the reference date, defaulting to today
 * @param weeks      how far back to look
 */
export function buildFitnessSnapshot(
  activities: FitnessActivity[],
  asOf: Date = new Date(),
  weeks = 12,
): FitnessSnapshot {
  const notes: string[] = [];
  const start = startOfWeek(addDays(asOf, -(weeks * 7 - 1)));

  const runs = activities.filter(
    (a) => a.sport === 'running' && a.date >= start && a.date <= asOf,
  );

  if (runs.length === 0) {
    return {
      weeksAnalysed: 0,
      runCount: 0,
      avgWeeklyDistance: 0,
      longestRun: 0,
      avgRunsPerWeek: 0,
      easyPaceMin: null,
      easyPaceMax: null,
      thresholdPace: null,
      easyAvgHR: null,
      consistency: 0,
      notes: ['No running activities were found in the analysed period.'],
    };
  }

  // Only count weeks from the athlete's first run onward, so a new user is not
  // penalised for weeks before they started recording.
  const firstRun = runs[0].date;
  const analysisStart = startOfWeek(firstRun < start ? start : firstRun);
  const weeksOfData = Math.max(1, Math.ceil((daysBetween(analysisStart, asOf) + 1) / 7));

  const weekly = weeklyVolumes(runs, analysisStart, asOf);
  const totalDistance = weekly.reduce((sum, w) => sum + w.running, 0);
  const avgWeeklyDistance = Math.round(totalDistance / weeksOfData);

  const longestRun = runs.reduce((max, r) => Math.max(max, r.distance ?? 0), 0);
  const avgRunsPerWeek = Math.round((runs.length / weeksOfData) * 10) / 10;

  const weeksWithTraining = weekly.filter((w) => w.activityCount >= 2).length;
  const consistency = Math.round((weeksWithTraining / weeksOfData) * 100) / 100;

  // --- Pace estimates ------------------------------------------------------
  const { easy } = partitionByEffort(runs);

  let easyPaceMin: number | null = null;
  let easyPaceMax: number | null = null;
  let easyAvgHR: number | null = null;

  if (easy.length >= 3) {
    const paces = easy.map((r) => r.avgPace!).sort((a, b) => a - b);
    // The middle of the distribution, ignoring the extremes at both ends.
    const lower = paces[Math.floor(paces.length * 0.2)];
    const upper = paces[Math.floor(paces.length * 0.8)];
    easyPaceMin = Math.round(lower);
    easyPaceMax = Math.round(upper);

    const withHR = easy.filter((r) => r.avgHR != null);
    if (withHR.length >= 3) {
      easyAvgHR = Math.round(
        withHR.reduce((sum, r) => sum + r.avgHR!, 0) / withHR.length,
      );
    } else {
      notes.push('Too few easy runs have heart-rate data to establish a reliable baseline.');
    }
  } else {
    notes.push('Too few easy runs to estimate a typical easy pace band.');
  }

  const thresholdPace = estimateThresholdPace(runs);
  if (thresholdPace === null) {
    notes.push(
      'No sustained effort of at least 20 minutes was found, so threshold pace could not be estimated.',
    );
  }

  return {
    weeksAnalysed: weeksOfData,
    runCount: runs.length,
    avgWeeklyDistance,
    longestRun: Math.round(longestRun),
    avgRunsPerWeek,
    easyPaceMin,
    easyPaceMax,
    thresholdPace,
    easyAvgHR,
    consistency,
    notes,
  };
}

// ---------------------------------------------------------------------------
// Race-time projection
// ---------------------------------------------------------------------------

/**
 * Riegel's formula for predicting a race time over one distance from a known
 * time over another:
 *
 *     T₂ = T₁ × (D₂ / D₁) ^ 1.06
 *
 * The exponent 1.06 is Peter Riegel's published value. It is a rough guide, not
 * a promise — it assumes appropriate training for the target distance, which is
 * exactly what a plan is for. The interface presents it as an estimate.
 */
export function riegelProjection(
  knownDistance: number,
  knownTime: number,
  targetDistance: number,
  exponent = 1.06,
): number {
  if (knownDistance <= 0 || knownTime <= 0 || targetDistance <= 0) return 0;
  return Math.round(knownTime * Math.pow(targetDistance / knownDistance, exponent));
}

/** Seconds per kilometre needed to finish `distance` metres in `time` seconds. */
export function requiredPace(distance: number, time: number): number {
  if (distance <= 0) return 0;
  return Math.round((time / distance) * 1000);
}

export const FITNESS_DISCLAIMER =
  'These figures are estimated from your recent training data. They are a practical guide for setting training paces, not a laboratory measurement.';
