/**
 * Training pace zones.
 *
 * Every prescribed pace in a plan comes from here, derived from two independent
 * sources and reconciled conservatively:
 *
 *   1. **The goal.** If you want a 3:40 marathon, that implies a race pace, and
 *      the training paces follow from it.
 *   2. **Current fitness.** Estimated from what you have actually been running.
 *
 * Where the two disagree, the slower of the two is used. Prescribing paces from
 * an ambitious goal that current fitness does not support is how people get hurt,
 * so the plan trains what you *are*, while aiming at what you want to be.
 *
 * The ratios below are the widely used proportional relationships between
 * training intensities (Daniels' training-intensity framework and its
 * descendants). They are expressed as plain multipliers of threshold pace so
 * they can be read and checked, rather than hidden in a lookup table.
 */

import { GOAL_DISTANCES, type GoalType, type WorkoutType } from '@/lib/constants';
import { riegelProjection, requiredPace } from '@/analytics/runningFitness';

/**
 * Multipliers applied to threshold pace to obtain each training pace.
 *
 * Threshold pace is 1.0 by definition — roughly the pace you could hold for an
 * hour flat out. Anything above 1 is slower.
 */
const RATIOS = {
  interval: 0.94, // faster than threshold: 3-5 minute repetitions
  tempo: 1.02, // just either side of threshold
  marathon: 1.06, // marathon race pace
  long: 1.19, // long-run pace
  easy: 1.24, // conversational running
  recovery: 1.34, // deliberately very slow
} as const;

/** Width of each prescribed band, as a fraction of the pace. */
const BAND = {
  interval: 0.018,
  tempo: 0.02,
  marathon: 0.02,
  long: 0.035,
  easy: 0.04,
  recovery: 0.05,
} as const;

export interface PaceBand {
  /** Fastest end of the band, in seconds per kilometre. */
  min: number;
  /** Slowest end of the band, in seconds per kilometre. */
  max: number;
}

export interface PaceZones {
  interval: PaceBand;
  tempo: PaceBand;
  marathon: PaceBand;
  long: PaceBand;
  easy: PaceBand;
  recovery: PaceBand;
  /** The threshold pace everything was derived from. */
  thresholdPace: number;
  /** Which input determined the zones, for display. */
  basis: 'goal' | 'fitness' | 'both';
  explanation: string;
}

function band(pace: number, key: keyof typeof BAND): PaceBand {
  const width = pace * BAND[key];
  return { min: Math.round(pace - width), max: Math.round(pace + width) };
}

export interface PaceZoneInput {
  /** Goal race distance in metres, if there is one. */
  goalDistance: number | null;
  /** Goal finish time in seconds, if there is one. */
  goalTime: number | null;
  /** Threshold pace estimated from recent training, in seconds per km. */
  estimatedThresholdPace: number | null;
  /** Typical easy pace observed in recent training, in seconds per km. */
  observedEasyPace: number | null;
}

/**
 * Work out the athlete's training paces.
 *
 * Deterministic: the same inputs always produce the same zones.
 */
export function calculatePaceZones(input: PaceZoneInput): PaceZones {
  const { goalDistance, goalTime, estimatedThresholdPace, observedEasyPace } = input;

  // --- Threshold implied by the goal --------------------------------------
  let goalThreshold: number | null = null;
  if (goalDistance && goalTime && goalDistance > 0 && goalTime > 0) {
    // Project the goal to a one-hour effort, which is what threshold pace means.
    // Riegel converts between distances; an hour at threshold covers roughly
    // 15 km for most amateur runners, so that is the reference distance used.
    const projectedTime = riegelProjection(goalDistance, goalTime, 15000);
    goalThreshold = requiredPace(15000, projectedTime);
  }

  // --- Reconcile ----------------------------------------------------------
  let thresholdPace: number;
  let basis: PaceZones['basis'];
  let explanation: string;

  if (goalThreshold != null && estimatedThresholdPace != null) {
    // The slower (larger) number wins — train what you are, aim at what you want.
    thresholdPace = Math.max(goalThreshold, estimatedThresholdPace);
    basis = 'both';
    explanation =
      thresholdPace === estimatedThresholdPace
        ? 'Your training paces are set from your current fitness, which is currently the more conservative of the two. They will move towards your goal paces as your fitness improves.'
        : 'Your training paces are set from your goal time, which is currently more conservative than your recent training suggests.';
  } else if (estimatedThresholdPace != null) {
    thresholdPace = estimatedThresholdPace;
    basis = 'fitness';
    explanation =
      'Your training paces are estimated from your recent running. No goal time was available to cross-check them against.';
  } else if (goalThreshold != null) {
    thresholdPace = goalThreshold;
    basis = 'goal';
    explanation =
      'Your training paces are derived from your goal time. There was not enough recent running data to cross-check them against your current fitness.';
  } else if (observedEasyPace != null) {
    // Last resort: work backwards from observed easy running.
    thresholdPace = Math.round(observedEasyPace / RATIOS.easy);
    basis = 'fitness';
    explanation =
      'Your training paces are estimated from your typical easy-run pace, as no faster sustained efforts or goal time were available.';
  } else {
    // Nothing to go on at all. A neutral default, clearly flagged.
    thresholdPace = 300;
    basis = 'fitness';
    explanation =
      'There was not enough data to estimate your training paces, so a neutral default has been used. Record a few runs and regenerate the plan for paces matched to you.';
  }

  return {
    interval: band(thresholdPace * RATIOS.interval, 'interval'),
    tempo: band(thresholdPace * RATIOS.tempo, 'tempo'),
    marathon: band(thresholdPace * RATIOS.marathon, 'marathon'),
    long: band(thresholdPace * RATIOS.long, 'long'),
    easy: band(thresholdPace * RATIOS.easy, 'easy'),
    recovery: band(thresholdPace * RATIOS.recovery, 'recovery'),
    thresholdPace,
    basis,
    explanation,
  };
}

/** The pace band appropriate to a given kind of session. */
export function bandForWorkout(zones: PaceZones, type: WorkoutType): PaceBand | null {
  switch (type) {
    case 'INTERVAL':
      return zones.interval;
    case 'TEMPO':
      return zones.tempo;
    case 'LONG_RUN':
      return zones.long;
    case 'EASY':
      return zones.easy;
    case 'RECOVERY':
      return zones.recovery;
    case 'REST':
      return null;
  }
}

// ---------------------------------------------------------------------------
// Heart-rate guidance
// ---------------------------------------------------------------------------

export interface HRBand {
  min: number;
  max: number;
}

/**
 * Heart-rate guidance for a session, as a percentage of heart-rate reserve.
 *
 * Returns null unless both maximum and resting heart rate are known — a
 * percentage of an unknown maximum would be meaningless.
 */
export function heartRateBand(
  type: WorkoutType,
  maxHR: number | null,
  restingHR: number | null,
): HRBand | null {
  if (maxHR == null || restingHR == null || maxHR <= restingHR) return null;

  const reserve = maxHR - restingHR;
  const at = (fraction: number) => Math.round(restingHR + reserve * fraction);

  switch (type) {
    case 'RECOVERY':
      return { min: at(0.5), max: at(0.6) };
    case 'EASY':
      return { min: at(0.6), max: at(0.72) };
    case 'LONG_RUN':
      return { min: at(0.65), max: at(0.78) };
    case 'TEMPO':
      return { min: at(0.82), max: at(0.88) };
    case 'INTERVAL':
      return { min: at(0.88), max: at(0.95) };
    case 'REST':
      return null;
  }
}

// ---------------------------------------------------------------------------
// Race-pace helper
// ---------------------------------------------------------------------------

/** The pace a goal implies, in seconds per kilometre. */
export function goalRacePace(goalType: GoalType, goalTime: number | null, customDistance?: number | null): number | null {
  const distance = GOAL_DISTANCES[goalType] ?? customDistance ?? null;
  if (!distance || !goalTime) return null;
  return requiredPace(distance, goalTime);
}
