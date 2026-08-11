/**
 * Shared vocabulary for the whole application.
 *
 * SQLite (via Prisma) has no `enum` type, so every "enum-like" database column
 * is a plain `String`. These constants and the TypeScript union types derived
 * from them are what keep those columns honest.
 */

// ---------------------------------------------------------------------------
// Sports
// ---------------------------------------------------------------------------

export const SPORTS = ['running', 'cycling', 'swimming', 'other'] as const;
export type Sport = (typeof SPORTS)[number];

export const SPORT_LABELS: Record<Sport, string> = {
  running: 'Running',
  cycling: 'Cycling',
  swimming: 'Swimming',
  other: 'Other',
};

/** Sports measured in pace (time per km) rather than speed (km/h). */
export const PACE_SPORTS: Sport[] = ['running', 'swimming'];

// ---------------------------------------------------------------------------
// Data sources
// ---------------------------------------------------------------------------

export const SOURCES = ['garmin_api', 'fit_upload', 'demo'] as const;
export type Source = (typeof SOURCES)[number];

export const SOURCE_LABELS: Record<Source, string> = {
  garmin_api: 'Garmin API',
  fit_upload: 'FIT upload',
  demo: 'Demo data',
};

// ---------------------------------------------------------------------------
// Workouts
// ---------------------------------------------------------------------------

export const WORKOUT_TYPES = [
  'EASY',
  'LONG_RUN',
  'TEMPO',
  'INTERVAL',
  'RECOVERY',
  'REST',
] as const;
export type WorkoutType = (typeof WORKOUT_TYPES)[number];

export const WORKOUT_TYPE_LABELS: Record<WorkoutType, string> = {
  EASY: 'Easy Run',
  LONG_RUN: 'Long Run',
  TEMPO: 'Tempo Run',
  INTERVAL: 'Intervals',
  RECOVERY: 'Recovery Run',
  REST: 'Rest Day',
};

/** Sessions that carry meaningful intensity — used by the adaptation engine. */
export const HARD_WORKOUT_TYPES: WorkoutType[] = ['TEMPO', 'INTERVAL'];

export const COMPLETION_STATUSES = [
  'planned',
  'completed',
  'missed',
  'skipped',
] as const;
export type CompletionStatus = (typeof COMPLETION_STATUSES)[number];

// ---------------------------------------------------------------------------
// Training phases
// ---------------------------------------------------------------------------

export const PHASES = ['BASE', 'BUILD', 'PEAK', 'TAPER'] as const;
export type Phase = (typeof PHASES)[number];

export const PHASE_DESCRIPTIONS: Record<Phase, string> = {
  BASE: 'Building aerobic foundation with mostly easy running and a steadily growing long run.',
  BUILD: 'Adding tempo and interval work on top of the aerobic base to raise your sustainable pace.',
  PEAK: 'The most demanding weeks — highest volume and the most race-specific quality sessions.',
  TAPER: 'Volume drops sharply while a little intensity is kept, so you arrive at the start line fresh.',
};

// ---------------------------------------------------------------------------
// Goals
// ---------------------------------------------------------------------------

export const GOAL_SPORTS = [
  'running',
  'cycling',
  'triathlon',
  'general_fitness',
] as const;
export type GoalSport = (typeof GOAL_SPORTS)[number];

export const GOAL_TYPES = [
  '5k',
  '10k',
  'half_marathon',
  'marathon',
  'custom',
  'general',
] as const;
export type GoalType = (typeof GOAL_TYPES)[number];

/** Official race distances in metres. `custom`/`general` have no fixed distance. */
export const GOAL_DISTANCES: Record<GoalType, number | null> = {
  '5k': 5000,
  '10k': 10000,
  half_marathon: 21097.5,
  marathon: 42195,
  custom: null,
  general: null,
};

export const GOAL_TYPE_LABELS: Record<GoalType, string> = {
  '5k': '5K',
  '10k': '10K',
  half_marathon: 'Half Marathon',
  marathon: 'Marathon',
  custom: 'Custom distance',
  general: 'General fitness',
};

/**
 * Longest single run a plan will ever prescribe, per goal distance (metres).
 * Deliberately conservative — for the marathon most plans cap well below race
 * distance because the cost of a 42 km training run outweighs the benefit.
 */
export const MAX_LONG_RUN: Record<GoalType, number> = {
  '5k': 14000,
  '10k': 18000,
  half_marathon: 22000,
  marathon: 32000,
  custom: 25000,
  general: 20000,
};

// ---------------------------------------------------------------------------
// Adaptation outcomes
// ---------------------------------------------------------------------------

export const ADAPTATION_OUTCOMES = [
  'KEEP_PLAN',
  'REDUCE_INTENSITY',
  'REDUCE_VOLUME',
  'INCREASE_VOLUME_SLIGHTLY',
  'CHANGE_TO_RECOVERY',
  'MOVE_WORKOUT',
  'ADD_REST',
] as const;
export type AdaptationOutcome = (typeof ADAPTATION_OUTCOMES)[number];

export const ADAPTATION_OUTCOME_LABELS: Record<AdaptationOutcome, string> = {
  KEEP_PLAN: 'Plan unchanged',
  REDUCE_INTENSITY: 'Intensity reduced',
  REDUCE_VOLUME: 'Volume reduced',
  INCREASE_VOLUME_SLIGHTLY: 'Volume increased slightly',
  CHANGE_TO_RECOVERY: 'Changed to recovery',
  MOVE_WORKOUT: 'Workout moved',
  ADD_REST: 'Rest day added',
};

// ---------------------------------------------------------------------------
// Safety limits for the adaptation engine (spec §16)
//
// These exist so the plan can never swing wildly from one data point. They are
// deliberately strict: a training plan that changes unpredictably is useless.
// ---------------------------------------------------------------------------

export const ADAPTATION_LIMITS = {
  /** Minimum number of independent indicators before any change is made. */
  MIN_INDICATORS: 2,
  /** Largest permitted week-over-week volume reduction. */
  MAX_VOLUME_DECREASE: 0.15,
  /** Largest permitted week-over-week volume increase. */
  MAX_VOLUME_INCREASE: 0.1,
  /** Largest permitted reduction in interval repetitions (as a fraction). */
  MAX_INTERVAL_REDUCTION: 0.34,
  /** A workout will not be auto-changed twice within this many days. */
  COOLDOWN_DAYS: 3,
  /** Consecutive good weeks required before volume is nudged upward. */
  PROGRESSION_WEEKS_REQUIRED: 3,
} as const;

// ---------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------

export const UNITS = ['metric', 'imperial'] as const;
export type Units = (typeof UNITS)[number];

export const METRES_PER_KM = 1000;
export const METRES_PER_MILE = 1609.344;

// ---------------------------------------------------------------------------
// Time ranges offered by the chart controls
// ---------------------------------------------------------------------------

export const TIME_RANGES = {
  '7d': { label: '7 days', days: 7 },
  '4w': { label: '4 weeks', days: 28 },
  '12w': { label: '12 weeks', days: 84 },
  '6m': { label: '6 months', days: 182 },
  '1y': { label: '1 year', days: 365 },
} as const;
export type TimeRangeKey = keyof typeof TIME_RANGES;

// ---------------------------------------------------------------------------
// Wording used wherever we show a number we calculated ourselves
// ---------------------------------------------------------------------------

/**
 * Metrics we compute are always labelled with this, never presented as Garmin's
 * own figures. Garmin's proprietary values (Training Effect, Body Battery,
 * sleep score) are only ever shown when Garmin actually supplied them.
 */
export const CALCULATED_LABEL = 'AI Coach calculated';
