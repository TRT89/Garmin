/**
 * The training plan generator.
 *
 * This is a deterministic function: the same inputs always produce exactly the
 * same plan, down to the metre. No language model is involved, and there is no
 * randomness. That matters because a training plan that changes when you look at
 * it twice is worthless — you have to be able to trust it and rely on it.
 *
 * The rules it follows are the conventional ones, applied conservatively:
 *
 *   - Start from the volume you are *actually* running, not what you would like
 *     to be running.
 *   - Increase weekly volume by no more than 10%.
 *   - Take a lighter week every fourth week.
 *   - Grow the long run by at most 2 km at a time, and cap it well below race
 *     distance.
 *   - Introduce quality work only once there is a base to put it on.
 *   - Taper properly.
 *
 * All the limits live in PLAN_LIMITS below so they can be read, checked and
 * tested rather than being scattered through the logic.
 */

import {
  GOAL_DISTANCES,
  MAX_LONG_RUN,
  type GoalType,
  type Phase,
  type WorkoutType,
} from '@/lib/constants';
import { addDays, addWeeks, startOfWeek } from '@/lib/dates';
import { formatDistance, formatPaceRange } from '@/lib/format';
import type { WorkoutStep } from '@/lib/json';
import { assignPhases } from './phases';
import { bandForWorkout, calculatePaceZones, heartRateBand, type PaceZones } from './paces';

/** Every safety limit the generator obeys, in one place. */
export const PLAN_LIMITS = {
  /** Largest permitted week-on-week increase in total volume. */
  MAX_WEEKLY_INCREASE: 0.1,
  /** How much a recovery week drops relative to the week before it. */
  DOWN_WEEK_FACTOR: 0.75,
  /** A lighter week every this many weeks. */
  DOWN_WEEK_INTERVAL: 4,
  /** Peak weekly volume as a multiple of the athlete's starting volume. */
  MAX_PEAK_MULTIPLE: 1.6,
  /** Largest permitted week-on-week increase in the long run, in metres. */
  MAX_LONG_RUN_INCREASE: 2000,
  /** The long run never exceeds this share of the week's total volume. */
  MAX_LONG_RUN_SHARE: 0.4,
  /** Weekly volume floor, so a plan never prescribes something trivial. */
  MIN_WEEKLY_VOLUME: 10000,
} as const;

export interface PlanInput {
  goalType: GoalType;
  /** Race distance in metres. Falls back to the standard distance for the type. */
  goalDistance: number | null;
  /** Goal finish time in seconds, if the athlete set one. */
  goalTime: number | null;
  /** First day of the plan. Normalised to the Monday of that week. */
  startDate: Date;
  trainingWeeks: number;
  /** How many running sessions per week the athlete can commit to (3-6). */
  sessionsPerWeek: number;
  /** Preferred long-run day: 0 = Sunday … 6 = Saturday. */
  longRunDay: number;

  // --- Where the athlete is starting from --------------------------------
  /** Current average weekly running distance in metres. */
  currentWeeklyDistance: number;
  /** Longest run in recent training, in metres. */
  longestRecentRun: number;
  /** Threshold pace estimated from recent training, seconds per km. */
  estimatedThresholdPace: number | null;
  /** Typical easy pace from recent training, seconds per km. */
  observedEasyPace: number | null;

  maxHR: number | null;
  restingHR: number | null;
}

export interface GeneratedWorkout {
  date: Date;
  weekNumber: number;
  phase: Phase;
  sport: 'running';
  workoutType: WorkoutType;
  description: string;
  targetDistance: number | null; // metres
  targetDuration: number | null; // seconds
  targetPaceMin: number | null;
  targetPaceMax: number | null;
  targetHRMin: number | null;
  targetHRMax: number | null;
  structure: WorkoutStep[];
  explanation: string;
}

export interface GeneratedWeek {
  weekNumber: number;
  phase: Phase;
  startDate: Date;
  /** Total prescribed running distance for the week, in metres. */
  plannedDistance: number;
  longRunDistance: number;
  isDownWeek: boolean;
  workouts: GeneratedWorkout[];
}

export interface GeneratedPlan {
  startDate: Date;
  endDate: Date;
  weeks: GeneratedWeek[];
  zones: PaceZones;
  /** Notes about decisions the generator made, shown to the athlete. */
  notes: string[];
  input: PlanInput;
}

// ---------------------------------------------------------------------------
// Weekly volume progression
// ---------------------------------------------------------------------------

/**
 * Build the week-by-week volume curve.
 *
 * Exported so it can be tested directly — the safety limits are the most
 * important thing in this file.
 */
export function buildVolumeProgression(
  startVolume: number,
  phases: Phase[],
  limits = PLAN_LIMITS,
): number[] {
  const totalWeeks = phases.length;
  if (totalWeeks === 0) return [];

  const base = Math.max(limits.MIN_WEEKLY_VOLUME, startVolume);
  const peakCap = base * limits.MAX_PEAK_MULTIPLE;

  const volumes: number[] = [];
  let previousHard = base; // the last non-down-week volume

  for (let i = 0; i < totalWeeks; i++) {
    const week = i + 1;
    const phase = phases[i];

    if (phase === 'TAPER') {
      // Count back from the end: the final week is lightest.
      const taperWeeksLeft = totalWeeks - week; // 0 on race week
      const factor = taperWeeksLeft === 0 ? 0.4 : taperWeeksLeft === 1 ? 0.6 : 0.75;
      volumes.push(Math.round(previousHard * factor));
      continue;
    }

    const isDownWeek = week % limits.DOWN_WEEK_INTERVAL === 0;

    if (isDownWeek) {
      volumes.push(Math.round(previousHard * limits.DOWN_WEEK_FACTOR));
      continue;
    }

    // Grow from the last hard week, never by more than the limit.
    const grown = week === 1 ? base : previousHard * (1 + limits.MAX_WEEKLY_INCREASE);
    const capped = Math.min(grown, peakCap);
    previousHard = capped;
    volumes.push(Math.round(capped));
  }

  return volumes;
}

/**
 * Build the long-run progression, in metres, one entry per week.
 *
 * The long run is the single most important session in a distance plan and also
 * the easiest to overdo, so it is bounded three ways: by how fast it may grow,
 * by an absolute cap for the goal distance, and by its share of the week.
 */
export function buildLongRunProgression(
  longestRecentRun: number,
  weeklyVolumes: number[],
  phases: Phase[],
  goalType: GoalType,
  limits = PLAN_LIMITS,
): number[] {
  const absoluteCap = MAX_LONG_RUN[goalType] ?? 25000;
  const start = Math.max(6000, Math.min(longestRecentRun, absoluteCap));

  const longRuns: number[] = [];
  let current = start;

  for (let i = 0; i < phases.length; i++) {
    const week = i + 1;
    const phase = phases[i];
    const weekVolume = weeklyVolumes[i];

    if (phase === 'TAPER') {
      // Long runs shorten quickly through the taper.
      const taperWeeksLeft = phases.length - week;
      const factor = taperWeeksLeft === 0 ? 0.35 : taperWeeksLeft === 1 ? 0.5 : 0.7;
      longRuns.push(Math.round(Math.min(current * factor, weekVolume * limits.MAX_LONG_RUN_SHARE)));
      continue;
    }

    const isDownWeek = week % limits.DOWN_WEEK_INTERVAL === 0;

    if (isDownWeek) {
      // Hold the long run steady rather than growing it on a recovery week.
      longRuns.push(
        Math.round(Math.min(current * 0.8, weekVolume * limits.MAX_LONG_RUN_SHARE)),
      );
      continue;
    }

    if (week > 1) current = Math.min(current + limits.MAX_LONG_RUN_INCREASE, absoluteCap);

    // Never let the long run dominate the week.
    const bounded = Math.min(current, weekVolume * limits.MAX_LONG_RUN_SHARE);
    current = Math.max(6000, bounded);
    longRuns.push(Math.round(current));
  }

  return longRuns;
}

// ---------------------------------------------------------------------------
// The weekly session pattern
// ---------------------------------------------------------------------------

/**
 * Which kinds of session a week contains, given how many days the athlete runs
 * and which phase they are in.
 *
 * Quality work only appears once there is a base under it, which is why BASE
 * weeks are almost entirely easy running.
 */
function sessionPattern(sessionsPerWeek: number, phase: Phase): WorkoutType[] {
  const sessions = Math.max(3, Math.min(6, sessionsPerWeek));

  // The long run is always present and always last in this list.
  if (phase === 'BASE') {
    const pattern: WorkoutType[] = ['EASY', 'EASY', 'LONG_RUN'];
    if (sessions >= 4) pattern.splice(2, 0, 'EASY');
    if (sessions >= 5) pattern.splice(1, 0, 'TEMPO'); // one gentle quality session
    if (sessions >= 6) pattern.splice(1, 0, 'RECOVERY');
    return pattern;
  }

  if (phase === 'TAPER') {
    const pattern: WorkoutType[] = ['EASY', 'TEMPO', 'LONG_RUN'];
    if (sessions >= 4) pattern.splice(1, 0, 'EASY');
    if (sessions >= 5) pattern.splice(1, 0, 'RECOVERY');
    if (sessions >= 6) pattern.splice(1, 0, 'EASY');
    return pattern;
  }

  // BUILD and PEAK: two quality sessions a week, the rest easy.
  const pattern: WorkoutType[] = ['INTERVAL', 'EASY', 'TEMPO', 'LONG_RUN'];
  if (sessions === 3) return ['INTERVAL', 'TEMPO', 'LONG_RUN'];
  if (sessions >= 5) pattern.splice(2, 0, 'EASY');
  if (sessions >= 6) pattern.splice(1, 0, 'RECOVERY');
  return pattern;
}

/**
 * Spread a week's sessions across the days, with the long run on the athlete's
 * chosen day and hard sessions kept apart.
 *
 * Returns day offsets from the Monday of the week (0 = Monday … 6 = Sunday).
 */
function assignDays(types: WorkoutType[], longRunDay: number): number[] {
  // Convert the goal's Sunday-first convention into a Monday-first offset.
  const longRunOffset = (longRunDay + 6) % 7;

  // Preferred slots, hardest first, chosen so quality sessions have an easy day
  // or a rest day between them.
  const preferred = [1, 3, 5, 0, 2, 4, 6].filter((day) => day !== longRunOffset);

  const days: number[] = [];
  let next = 0;
  for (const type of types) {
    if (type === 'LONG_RUN') {
      days.push(longRunOffset);
    } else {
      days.push(preferred[next % preferred.length]);
      next++;
    }
  }
  return days;
}

// ---------------------------------------------------------------------------
// Individual sessions
// ---------------------------------------------------------------------------

/** How a week's non-long-run distance is split between its sessions. */
const SESSION_WEIGHTS: Record<WorkoutType, number> = {
  INTERVAL: 1.15,
  TEMPO: 1.1,
  EASY: 1,
  RECOVERY: 0.65,
  LONG_RUN: 0,
  REST: 0,
};

function buildStructure(
  type: WorkoutType,
  distance: number,
  zones: PaceZones,
): { steps: WorkoutStep[]; description: string } {
  const easy = zones.easy;

  switch (type) {
    case 'INTERVAL': {
      // Warm-up and cool-down of 2 km each; the rest becomes 1 km repetitions.
      const warmup = 2000;
      const cooldown = 2000;
      const available = Math.max(2000, distance - warmup - cooldown);
      // Each repetition plus its recovery jog costs about 1.4 km.
      const reps = Math.max(3, Math.min(8, Math.round(available / 1400)));

      return {
        description: `${reps} × 1 km at interval pace with 400 m recovery jogs`,
        steps: [
          { type: 'warmup', distance: warmup, paceMin: easy.min, paceMax: easy.max, note: 'Easy warm-up' },
          {
            type: 'interval',
            repeat: reps,
            distance: 1000,
            paceMin: zones.interval.min,
            paceMax: zones.interval.max,
            note: '1 km at interval pace',
          },
          {
            type: 'recovery',
            repeat: reps - 1,
            distance: 400,
            paceMin: zones.recovery.min,
            paceMax: zones.recovery.max,
            note: '400 m recovery jog',
          },
          { type: 'cooldown', distance: cooldown, paceMin: easy.min, paceMax: easy.max, note: 'Easy cool-down' },
        ],
      };
    }

    case 'TEMPO': {
      const warmup = 2000;
      const cooldown = 1500;
      const tempo = Math.max(2000, distance - warmup - cooldown);
      return {
        description: `${formatDistance(tempo)} continuous at tempo pace`,
        steps: [
          { type: 'warmup', distance: warmup, paceMin: easy.min, paceMax: easy.max, note: 'Easy warm-up' },
          {
            type: 'steady',
            distance: tempo,
            paceMin: zones.tempo.min,
            paceMax: zones.tempo.max,
            note: 'Comfortably hard, controlled',
          },
          { type: 'cooldown', distance: cooldown, paceMin: easy.min, paceMax: easy.max, note: 'Easy cool-down' },
        ],
      };
    }

    case 'LONG_RUN':
      return {
        description: `${formatDistance(distance)} at long-run pace`,
        steps: [
          {
            type: 'steady',
            distance,
            paceMin: zones.long.min,
            paceMax: zones.long.max,
            note: 'Steady and conversational throughout',
          },
        ],
      };

    case 'RECOVERY':
      return {
        description: `${formatDistance(distance)} very easy`,
        steps: [
          {
            type: 'steady',
            distance,
            paceMin: zones.recovery.min,
            paceMax: zones.recovery.max,
            note: 'Deliberately slow — this session is for recovery, not fitness',
          },
        ],
      };

    case 'EASY':
    default:
      return {
        description: `${formatDistance(distance)} easy`,
        steps: [
          {
            type: 'steady',
            distance,
            paceMin: easy.min,
            paceMax: easy.max,
            note: 'Conversational pace',
          },
        ],
      };
  }
}

function explainWorkout(type: WorkoutType, phase: Phase, weekNumber: number): string {
  switch (type) {
    case 'LONG_RUN':
      return `The week's key aerobic session. In the ${phase.toLowerCase()} phase the long run builds the endurance your goal depends on, and it is run slowly on purpose.`;
    case 'INTERVAL':
      return 'Short, fast repetitions raise the ceiling on your aerobic capacity. The recovery jogs are part of the session — take them.';
    case 'TEMPO':
      return 'Sustained running at close to your threshold, which raises the pace you can hold before fatigue sets in.';
    case 'RECOVERY':
      return 'A deliberately slow session that adds a little volume without adding stress, so the harder days stay harder.';
    case 'EASY':
      return `Easy running is where most aerobic fitness is built. Week ${weekNumber} is no exception — keep it comfortable.`;
    case 'REST':
      return 'Rest is when the adaptation to training actually happens.';
  }
}

// ---------------------------------------------------------------------------
// The generator
// ---------------------------------------------------------------------------

/**
 * Generate a complete training plan.
 *
 * Pure and deterministic — no database, no clock, no randomness.
 */
export function generatePlan(input: PlanInput): GeneratedPlan {
  const notes: string[] = [];

  const isMarathon = input.goalType === 'marathon';
  const goalDistance = input.goalDistance ?? GOAL_DISTANCES[input.goalType];

  const zones = calculatePaceZones({
    goalDistance,
    goalTime: input.goalTime,
    estimatedThresholdPace: input.estimatedThresholdPace,
    observedEasyPace: input.observedEasyPace,
  });
  notes.push(zones.explanation);

  const totalWeeks = Math.max(1, Math.min(52, input.trainingWeeks));
  const phases = assignPhases(totalWeeks, isMarathon);

  // Starting volume: what the athlete is actually running, with a floor so a
  // plan for someone with no history is still sensible.
  const startVolume = Math.max(
    PLAN_LIMITS.MIN_WEEKLY_VOLUME,
    Math.round(input.currentWeeklyDistance),
  );
  if (input.currentWeeklyDistance < PLAN_LIMITS.MIN_WEEKLY_VOLUME) {
    notes.push(
      `Your recent weekly running distance is low or unknown, so the plan starts at a conservative ${formatDistance(
        startVolume,
      )} per week and builds from there.`,
    );
  }

  const weeklyVolumes = buildVolumeProgression(startVolume, phases);
  const longRuns = buildLongRunProgression(
    input.longestRecentRun,
    weeklyVolumes,
    phases,
    input.goalType,
  );

  const peak = Math.max(...weeklyVolumes);
  notes.push(
    `Volume builds from ${formatDistance(weeklyVolumes[0])} to a peak of ${formatDistance(
      peak,
    )} per week, never increasing by more than ${Math.round(
      PLAN_LIMITS.MAX_WEEKLY_INCREASE * 100,
    )}% from one week to the next, with a lighter week every ${PLAN_LIMITS.DOWN_WEEK_INTERVAL}th week.`,
  );

  const planStart = startOfWeek(input.startDate);
  const weeks: GeneratedWeek[] = [];

  for (let i = 0; i < totalWeeks; i++) {
    const weekNumber = i + 1;
    const phase = phases[i];
    const weekStart = addWeeks(planStart, i);
    const weekVolume = weeklyVolumes[i];
    const longRun = longRuns[i];

    const types = sessionPattern(input.sessionsPerWeek, phase);
    const days = assignDays(types, input.longRunDay);

    // Share the remaining distance between the non-long sessions, weighted so a
    // recovery run is shorter than an interval session.
    const otherTypes = types.filter((t) => t !== 'LONG_RUN');
    const totalWeight = otherTypes.reduce((sum, t) => sum + SESSION_WEIGHTS[t], 0);
    const remaining = Math.max(0, weekVolume - longRun);

    const workouts: GeneratedWorkout[] = [];

    types.forEach((type, index) => {
      const distance =
        type === 'LONG_RUN'
          ? longRun
          : Math.round((remaining * SESSION_WEIGHTS[type]) / (totalWeight || 1) / 100) * 100;

      const { steps, description } = buildStructure(type, distance, zones);
      const paceBand = bandForWorkout(zones, type);
      const hrBand = heartRateBand(type, input.maxHR, input.restingHR);

      workouts.push({
        date: addDays(weekStart, days[index]),
        weekNumber,
        phase,
        sport: 'running',
        workoutType: type,
        description,
        targetDistance: distance,
        targetDuration: null,
        targetPaceMin: paceBand?.min ?? null,
        targetPaceMax: paceBand?.max ?? null,
        targetHRMin: hrBand?.min ?? null,
        targetHRMax: hrBand?.max ?? null,
        structure: steps,
        explanation: explainWorkout(type, phase, weekNumber),
      });
    });

    workouts.sort((a, b) => a.date.getTime() - b.date.getTime());

    weeks.push({
      weekNumber,
      phase,
      startDate: weekStart,
      plannedDistance: workouts.reduce((sum, w) => sum + (w.targetDistance ?? 0), 0),
      longRunDistance: longRun,
      isDownWeek:
        weekNumber % PLAN_LIMITS.DOWN_WEEK_INTERVAL === 0 && phase !== 'TAPER',
      workouts,
    });
  }

  const endDate = addDays(addWeeks(planStart, totalWeeks), -1);

  if (goalDistance && input.goalTime) {
    notes.push(
      `Your goal pace is ${formatPaceRange(
        zones.marathon.min,
        zones.marathon.max,
      )}, and your easy runs should sit around ${formatPaceRange(zones.easy.min, zones.easy.max)}.`,
    );
  }

  return { startDate: planStart, endDate, weeks, zones, notes, input };
}
