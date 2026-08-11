/**
 * The demo athlete.
 *
 * Generates roughly twelve weeks of believable training and health data so that
 * every feature of the application can be tried without a Garmin account.
 *
 * Two properties matter:
 *
 * 1. **It is reproducible.** All variation comes from a seeded pseudo-random
 *    generator, so the same seed always produces byte-identical data. Tests rely
 *    on this, and it means a demo database can always be recreated exactly.
 *
 * 2. **It is honest.** The data is shaped like a real athlete's — including
 *    weeks that go badly — and everything it produces is stored with
 *    `source: "demo"` so it is never confused with real Garmin data. Metrics a
 *    device would not record (heart rate while swimming, power while running)
 *    are left null rather than invented.
 *
 * The athlete is Alex: 38, training for a marathon off a 30-35 km/week base,
 * improving slowly. Four deliberate scenarios are written into the twelve weeks
 * so the adaptive engine has something real to react to — see SCENARIOS below.
 */

import { addDays, startOfDay } from '@/lib/dates';
import type { StreamPoint } from '@/lib/json';
import type {
  NormalizedActivity,
  NormalizedHealth,
  NormalizedProfile,
  NormalizedSplit,
} from '@/garmin/types';

// ---------------------------------------------------------------------------
// Seeded randomness
// ---------------------------------------------------------------------------

/** Small, fast, well-distributed seeded PRNG (mulberry32). */
function makeRng(seed: number) {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rng = () => number;

/** A random number in [min, max). */
function between(rng: Rng, min: number, max: number): number {
  return min + rng() * (max - min);
}

/** Roughly normal noise in [-spread, +spread], clustered near zero. */
function jitter(rng: Rng, spread: number): number {
  return (rng() + rng() + rng() - 1.5) * (spread / 1.5);
}

// ---------------------------------------------------------------------------
// The athlete
// ---------------------------------------------------------------------------

export const DEMO_PROFILE: NormalizedProfile = {
  name: 'Alex Rivera',
  age: 38,
  sex: 'male',
  height: 178,
  weight: 74,
  maxHR: 186,
  restingHR: 48,
};

export const DEMO_SEED = 20260811;

/** Baseline paces in seconds per kilometre at the start of the twelve weeks. */
const BASE_PACE = {
  recovery: 382,
  easy: 356,
  long: 351,
  tempo: 289,
  interval: 276,
} as const;

/** Typical average heart rate for each kind of session. */
const BASE_HR = {
  recovery: 131,
  easy: 142,
  long: 149,
  tempo: 168,
  interval: 174,
} as const;

type RunType = keyof typeof BASE_PACE;

/**
 * The scenarios deliberately written into the twelve weeks, so the adaptive
 * engine and the analytics have something meaningful to find.
 *
 * Week numbers are 1-based and count from the *start* of the generated history.
 */
const SCENARIOS = {
  /** A run-down week: poor sleep, raised resting HR, higher HR at easy pace. */
  POOR_RECOVERY_WEEK: 5,
  /** An unusually long and hard long run that overreaches. */
  HARD_LONG_RUN_WEEK: 8,
  /** A notably strong tempo session — clear evidence of progress. */
  STRONG_TEMPO_WEEK: 10,
  /**
   * A dip in the final few days, so the adaptive engine has something to react
   * to as soon as the demo is loaded.
   *
   * Tuned deliberately to trip exactly two indicators — raised resting heart
   * rate and short sleep — and no more. Two is the engine's minimum for acting
   * at all, and it produces a proportionate adjustment rather than the drastic
   * one that three indicators would. Sleep score, stress and readiness are
   * moved by less than their thresholds on purpose.
   */
  RECENT_FATIGUE_DAYS: 4,
} as const;

/** Total aerobic-speed improvement across the whole block (4%). */
const FITNESS_GAIN = 0.04;

// ---------------------------------------------------------------------------
// Weekly structure
// ---------------------------------------------------------------------------

interface PlannedSession {
  /** 0 = Monday … 6 = Sunday. */
  dayOfWeek: number;
  kind: 'run' | 'bike' | 'swim';
  runType?: RunType;
  /** Kilometres for runs; used as a base before weekly scaling. */
  km?: number;
}

/**
 * The athlete's habitual week: four runs, a midweek ride, and a swim every
 * other week. Quality sessions sit on Tuesday and Thursday, the long run on
 * Sunday — the pattern most amateur marathon runners actually follow.
 */
function weekTemplate(week: number): PlannedSession[] {
  // Distances are chosen so the block averages roughly 33 km per week, building
  // from about 30 km to about 39 km — a realistic amateur marathon base.
  const sessions: PlannedSession[] = [
    { dayOfWeek: 1, kind: 'run', runType: 'easy', km: 6 },
    { dayOfWeek: 2, kind: 'bike' },
    { dayOfWeek: 3, kind: 'run', runType: week <= 3 ? 'easy' : week % 2 === 0 ? 'interval' : 'tempo', km: 7 },
    { dayOfWeek: 5, kind: 'run', runType: 'easy', km: 5 },
    { dayOfWeek: 6, kind: 'run', runType: 'long', km: 14 },
  ];
  if (week % 2 === 0) sessions.push({ dayOfWeek: 0, kind: 'swim' });
  return sessions;
}

/**
 * Weekly volume multiplier: a steady build with a lighter fourth week, plus the
 * dip that goes with the poor-recovery scenario.
 */
function weeklyVolumeFactor(week: number, totalWeeks: number): number {
  const progress = (week - 1) / Math.max(1, totalWeeks - 1);
  let factor = 0.92 + progress * 0.28; // roughly 30 km → 38 km per week
  if (week % 4 === 0) factor *= 0.82; // recovery week every fourth week
  if (week === SCENARIOS.POOR_RECOVERY_WEEK) factor *= 0.86; // the athlete backed off
  return factor;
}

// ---------------------------------------------------------------------------
// Streams and splits
// ---------------------------------------------------------------------------

const SAMPLE_SECONDS = 15;

/**
 * Builds a second-by-second-ish record stream for a run.
 *
 * The shape is what makes the activity detail charts worth looking at: heart
 * rate climbs during the first few minutes, interval sessions alternate hard and
 * easy, and long runs show cardiac drift — heart rate creeping up at a steady
 * pace as the run wears on.
 */
function buildRunStream(
  rng: Rng,
  runType: RunType,
  distanceM: number,
  avgPace: number,
  avgHR: number,
): { stream: StreamPoint[]; duration: number; elevationGain: number } {
  const stream: StreamPoint[] = [];
  const duration = Math.round((distanceM / 1000) * avgPace);

  let distance = 0;
  let altitude = 95 + jitter(rng, 8);
  let elevationGain = 0;

  for (let t = 0; t <= duration; t += SAMPLE_SECONDS) {
    const fraction = t / duration;

    // Pace shape over the session.
    let paceFactor = 1;
    if (runType === 'interval') {
      // 2 km warm-up, 5 × 1 km hard with 400 m float, then cool-down.
      const warmup = 0.18;
      const cooldown = 0.82;
      if (fraction < warmup || fraction > cooldown) {
        paceFactor = 1.22; // easy running either side of the work
      } else {
        // Alternate roughly 3:30 hard with 2:15 easy.
        const cycle = (t % 345) / 345;
        paceFactor = cycle < 0.62 ? 0.86 : 1.24;
      }
    } else if (runType === 'tempo') {
      const warmup = 0.2;
      const cooldown = 0.85;
      paceFactor = fraction < warmup || fraction > cooldown ? 1.18 : 0.93;
    } else {
      // Easy/long/recovery: start a little conservatively, settle in.
      paceFactor = 1 + Math.max(0, 0.06 * (1 - fraction * 6));
    }

    const pace = avgPace * paceFactor + jitter(rng, 6);
    const speed = 1000 / pace;
    distance += speed * SAMPLE_SECONDS;

    // Heart rate: rises over the first ~6 minutes, tracks effort, and drifts
    // upward on long runs as fatigue accumulates.
    const warmupCurve = Math.min(1, t / 360);
    const effort = 1 / paceFactor;
    const drift = runType === 'long' ? fraction * 7 : runType === 'tempo' ? fraction * 3 : 0;
    const hr = Math.round(
      (avgHR * (0.68 + 0.32 * warmupCurve)) * (0.72 + 0.28 * effort) + drift + jitter(rng, 3),
    );

    // Gentle rolling terrain. Two frequencies rather than one, so the profile
    // looks like a route rather than a sine wave.
    const climb =
      Math.sin(fraction * Math.PI * 6) * 1.2 +
      Math.sin(fraction * Math.PI * 15.7 + 1.1) * 0.7 +
      jitter(rng, 0.5);
    altitude += climb;
    if (climb > 0) elevationGain += climb;

    stream.push({
      t,
      distance: Math.round(distance),
      hr: Math.max(70, Math.min(198, hr)),
      pace: Math.round(pace),
      speed: Number(speed.toFixed(3)),
      altitude: Number(altitude.toFixed(1)),
      // Cadence varies far less than raw noise would suggest; a runner holds a
      // fairly steady rhythm and lifts it when the pace lifts.
      cadence: Math.round(172 + jitter(rng, 2.5) + (paceFactor < 1 ? 6 : 0)),
      power: null, // this athlete's watch does not record running power
    });
  }

  return { stream, duration, elevationGain: Math.round(elevationGain) };
}

/**
 * The exact moment a given cumulative distance was reached.
 *
 * Samples are 15 seconds apart, so simply taking the time of the first sample
 * past the marker would round every split to the nearest 15 seconds and produce
 * the tell-tale "5:45, 5:30, 5:45" pattern no real watch shows. Interpolating
 * between the two surrounding samples gives the second-level precision a watch
 * actually reports.
 */
function timeAtDistance(stream: StreamPoint[], target: number): number | null {
  for (let i = 1; i < stream.length; i++) {
    const previous = stream[i - 1];
    const current = stream[i];
    const from = previous.distance ?? 0;
    const to = current.distance ?? 0;
    if (to < target) continue;
    if (to === from) return current.t;
    const fraction = (target - from) / (to - from);
    return previous.t + (current.t - previous.t) * fraction;
  }
  return null;
}

/** Altitude at a given cumulative distance, interpolated the same way. */
function altitudeAtDistance(stream: StreamPoint[], target: number): number | null {
  for (let i = 1; i < stream.length; i++) {
    const previous = stream[i - 1];
    const current = stream[i];
    const from = previous.distance ?? 0;
    const to = current.distance ?? 0;
    if (to < target) continue;
    if (to === from) return current.altitude ?? null;
    const fraction = (target - from) / (to - from);
    const a = previous.altitude ?? 0;
    const b = current.altitude ?? 0;
    return a + (b - a) * fraction;
  }
  return null;
}

/** Per-kilometre splits derived from the record stream, exactly as a watch does. */
function splitsFromStream(stream: StreamPoint[]): NormalizedSplit[] {
  const splits: NormalizedSplit[] = [];
  if (stream.length < 2) return splits;

  const totalDistance = stream[stream.length - 1].distance ?? 0;
  const wholeKm = Math.floor(totalDistance / 1000);

  for (let km = 1; km <= wholeKm; km++) {
    const startDistance = (km - 1) * 1000;
    const endDistance = km * 1000;

    const startTime = km === 1 ? 0 : timeAtDistance(stream, startDistance);
    const endTime = timeAtDistance(stream, endDistance);
    if (startTime == null || endTime == null) continue;

    const inSplit = stream.filter(
      (p) => (p.distance ?? 0) >= startDistance && (p.distance ?? 0) < endDistance,
    );
    const hrValues = inSplit.map((p) => p.hr).filter((h): h is number => h != null);

    const duration = Math.round(endTime - startTime);
    const startAltitude = km === 1 ? (stream[0].altitude ?? 0) : altitudeAtDistance(stream, startDistance);
    const endAltitude = altitudeAtDistance(stream, endDistance);

    splits.push({
      splitNumber: km,
      distance: 1000,
      duration,
      pace: duration, // one kilometre, so seconds elapsed is the pace
      avgHR: hrValues.length
        ? Math.round(hrValues.reduce((a, b) => a + b, 0) / hrValues.length)
        : null,
      elevation:
        startAltitude != null && endAltitude != null
          ? Math.round((endAltitude - startAltitude) * 10) / 10
          : null,
    });
  }

  return splits;
}

// ---------------------------------------------------------------------------
// Activity builders
// ---------------------------------------------------------------------------

const RUN_TITLES: Record<RunType, string> = {
  recovery: 'Recovery Run',
  easy: 'Easy Run',
  long: 'Long Run',
  tempo: 'Tempo Run',
  interval: 'Interval Session',
};

function buildRun(
  rng: Rng,
  date: Date,
  index: number,
  runType: RunType,
  distanceKm: number,
  fitness: number,
  fatigueFactor: number,
  hrOffset: number,
): NormalizedActivity {
  const distanceM = Math.round(distanceKm * 1000 + jitter(rng, 180));

  // Pace improves with fitness and degrades when the athlete is run down.
  const avgPace = Math.round(
    (BASE_PACE[runType] / fitness) * fatigueFactor + jitter(rng, 3.5),
  );
  const avgHR = Math.round(BASE_HR[runType] + hrOffset + jitter(rng, 3));

  const { stream, duration, elevationGain } = buildRunStream(
    rng,
    runType,
    distanceM,
    avgPace,
    avgHR,
  );
  const splits = splitsFromStream(stream);
  const hrValues = stream.map((p) => p.hr).filter((h): h is number => h != null);

  // Training Effect is a Garmin device metric. The demo provider stands in for a
  // device, so it reports one — derived from intensity and duration the way a
  // watch would, and clearly attributed to the (simulated) device, not to us.
  const intensity = (avgHR - DEMO_PROFILE.restingHR!) / (DEMO_PROFILE.maxHR! - DEMO_PROFILE.restingHR!);
  const aerobic = Math.min(5, Math.round((intensity * 4.2 + duration / 3600) * 10) / 10);
  const anaerobic =
    runType === 'interval'
      ? Math.round(Math.min(3.5, intensity * 3.4) * 10) / 10
      : runType === 'tempo'
        ? Math.round(Math.min(2, intensity * 1.6) * 10) / 10
        : 0.2;

  return {
    externalId: `demo-run-${index}`,
    source: 'demo',
    date,
    sport: 'running',
    title: RUN_TITLES[runType],
    duration,
    distance: distanceM,
    avgHR,
    maxHR: hrValues.length ? Math.max(...hrValues) : null,
    avgPace: Math.round((duration / distanceM) * 1000),
    avgSpeed: Number((distanceM / duration).toFixed(3)),
    elevationGain,
    calories: Math.round((duration / 60) * between(rng, 11.5, 13.5)),
    cadence: Math.round(between(rng, 169, 176)),
    averagePower: null, // no running power meter on this athlete's watch
    normalizedPower: null,
    aerobicTrainingEffect: aerobic,
    anaerobicTrainingEffect: anaerobic,
    splits,
    stream,
    notes: ['Running power is not recorded by this device.'],
  };
}

function buildRide(rng: Rng, date: Date, index: number, fitness: number): NormalizedActivity {
  const duration = Math.round(between(rng, 55, 95) * 60);
  const speed = between(rng, 7.4, 8.6) * (0.99 + fitness * 0.01); // metres per second
  const distanceM = Math.round(duration * speed);
  const avgHR = Math.round(between(rng, 134, 146));
  const power = Math.round(between(rng, 178, 212));

  const stream: StreamPoint[] = [];
  let distance = 0;
  let altitude = 110;
  for (let t = 0; t <= duration; t += SAMPLE_SECONDS) {
    const s = speed * (1 + jitter(rng, 0.16));
    distance += s * SAMPLE_SECONDS;
    altitude += Math.sin(t / 420) * 2.2 + jitter(rng, 0.6);
    stream.push({
      t,
      distance: Math.round(distance),
      hr: Math.round(avgHR * (0.78 + 0.22 * Math.min(1, t / 300)) + jitter(rng, 5)),
      pace: null,
      speed: Number(s.toFixed(3)),
      altitude: Number(altitude.toFixed(1)),
      cadence: Math.round(between(rng, 82, 92)),
      power: Math.round(power * (1 + jitter(rng, 0.25))),
    });
  }

  const hrValues = stream.map((p) => p.hr).filter((h): h is number => h != null);

  return {
    externalId: `demo-ride-${index}`,
    source: 'demo',
    date,
    sport: 'cycling',
    title: 'Road Ride',
    duration,
    distance: distanceM,
    avgHR,
    maxHR: hrValues.length ? Math.max(...hrValues) : null,
    avgPace: null, // cycling is reported as speed, not pace
    avgSpeed: Number(speed.toFixed(3)),
    elevationGain: Math.round(between(rng, 180, 420)),
    calories: Math.round((duration / 60) * between(rng, 10, 12)),
    cadence: Math.round(between(rng, 84, 90)),
    averagePower: power,
    normalizedPower: Math.round(power * between(rng, 1.03, 1.09)),
    aerobicTrainingEffect: Math.round(between(rng, 2.1, 3.2) * 10) / 10,
    anaerobicTrainingEffect: 0.3,
    splits: [],
    stream,
  };
}

function buildSwim(rng: Rng, date: Date, index: number): NormalizedActivity {
  const distanceM = Math.round(between(rng, 1400, 2100) / 50) * 50;
  const pacePer100 = between(rng, 118, 132); // seconds per 100 m
  const duration = Math.round((distanceM / 100) * pacePer100);

  // Splits per 100 m, which is how a pool swim is actually recorded.
  const splits: NormalizedSplit[] = [];
  for (let i = 1; i <= Math.floor(distanceM / 100); i++) {
    splits.push({
      splitNumber: i,
      distance: 100,
      duration: Math.round(pacePer100 + jitter(rng, 5)),
      pace: Math.round((pacePer100 + jitter(rng, 5)) * 10),
      avgHR: null,
      elevation: null,
    });
  }

  return {
    externalId: `demo-swim-${index}`,
    source: 'demo',
    date,
    sport: 'swimming',
    title: 'Pool Swim',
    duration,
    distance: distanceM,
    // Wrist heart rate is unreliable in water, so this watch reports none.
    // Left null on purpose — the application must cope with missing metrics.
    avgHR: null,
    maxHR: null,
    avgPace: Math.round((duration / distanceM) * 1000),
    avgSpeed: Number((distanceM / duration).toFixed(3)),
    elevationGain: null,
    calories: Math.round((duration / 60) * between(rng, 8, 10)),
    cadence: null,
    averagePower: null,
    normalizedPower: null,
    aerobicTrainingEffect: Math.round(between(rng, 1.8, 2.6) * 10) / 10,
    anaerobicTrainingEffect: 0.2,
    splits,
    stream: [],
    notes: ['Heart rate is not recorded during swimming by this device.'],
  };
}

// ---------------------------------------------------------------------------
// The generator
// ---------------------------------------------------------------------------

export interface DemoData {
  profile: NormalizedProfile;
  activities: NormalizedActivity[];
  health: NormalizedHealth[];
}

export interface DemoOptions {
  /** How many weeks of history to produce. Defaults to 12. */
  weeks?: number;
  /** The last day of the generated history. Defaults to today. */
  endDate?: Date;
  /** Seed for the pseudo-random generator. The same seed gives identical data. */
  seed?: number;
}

/**
 * Produce the demo athlete's full history.
 *
 * Deterministic: identical options always produce identical output.
 */
export function generateDemoData(options: DemoOptions = {}): DemoData {
  const weeks = options.weeks ?? 12;
  const endDate = startOfDay(options.endDate ?? new Date());
  const rng = makeRng(options.seed ?? DEMO_SEED);

  // The history ends today and starts `weeks` weeks earlier, aligned so that the
  // final week is the one currently in progress.
  const startDate = addDays(endDate, -(weeks * 7 - 1));

  const activities: NormalizedActivity[] = [];
  const health: NormalizedHealth[] = [];

  let runIndex = 0;
  let rideIndex = 0;
  let swimIndex = 0;

  for (let week = 1; week <= weeks; week++) {
    const weekStart = addDays(startDate, (week - 1) * 7);
    const volumeFactor = weeklyVolumeFactor(week, weeks);

    // Fitness improves steadily across the block.
    const progress = (week - 1) / Math.max(1, weeks - 1);
    const fitness = 1 + FITNESS_GAIN * progress;

    const isPoorRecoveryWeek = week === SCENARIOS.POOR_RECOVERY_WEEK;

    for (const session of weekTemplate(week)) {
      const date = addDays(weekStart, session.dayOfWeek);
      // Do not generate anything in the future.
      if (date.getTime() > endDate.getTime()) continue;

      // Add a plausible time of day: early morning on weekdays, later at weekends.
      const isWeekend = session.dayOfWeek >= 5;
      const hour = isWeekend ? 9 : 6;
      const at = new Date(date);
      at.setHours(hour, Math.floor(between(rng, 0, 50)), 0, 0);

      if (session.kind === 'bike') {
        activities.push(buildRide(rng, at, rideIndex++, fitness));
        continue;
      }
      if (session.kind === 'swim') {
        activities.push(buildSwim(rng, at, swimIndex++));
        continue;
      }

      let runType = session.runType!;
      let km = (session.km ?? 8) * volumeFactor;
      let fatigueFactor = 1;
      let hrOffset = 0;

      // --- Scenario: a run-down week -------------------------------------
      // Higher heart rate at easy pace and slower running, the classic pattern
      // the adaptive engine should notice.
      if (isPoorRecoveryWeek) {
        fatigueFactor = 1.04;
        hrOffset = 7;
      }

      // --- Scenario: an unusually hard long run ---------------------------
      if (week === SCENARIOS.HARD_LONG_RUN_WEEK && runType === 'long') {
        km = 22;
        hrOffset = 9;
        fatigueFactor = 0.99;
      }

      // --- Scenario: a notably strong tempo session -----------------------
      if (week === SCENARIOS.STRONG_TEMPO_WEEK && runType === 'tempo') {
        fatigueFactor = 0.96; // clearly faster at the usual heart rate
      }

      // The long run grows through the block, but is capped below the scripted
      // overreach in HARD_LONG_RUN_WEEK so that session stands out as genuinely
      // unusual rather than being just another step in the progression.
      if (runType === 'long') {
        km = Math.min(18, (session.km ?? 14) * volumeFactor + progress * 3);
        if (week === SCENARIOS.HARD_LONG_RUN_WEEK) km = 22;
      }

      activities.push(
        buildRun(rng, at, runIndex++, runType, km, fitness, fatigueFactor, hrOffset),
      );
    }

    // --- Daily health for every day of the week ---------------------------
    for (let d = 0; d < 7; d++) {
      const date = addDays(weekStart, d);
      if (date.getTime() > endDate.getTime()) continue;

      // Resting heart rate drifts down slightly as fitness improves.
      let restingHR = DEMO_PROFILE.restingHR! - progress * 2 + jitter(rng, 1.5);
      let sleepMinutes = between(rng, 410, 465);
      let sleepScore = between(rng, 72, 88);
      let stress = between(rng, 24, 38);
      let bodyBattery = between(rng, 66, 84);

      if (isPoorRecoveryWeek) {
        // The scripted bad week: less sleep, higher resting heart rate, more
        // stress and a lower readiness score — all at once, which is what makes
        // it a genuine signal rather than noise.
        restingHR += 6;
        sleepMinutes -= 70;
        sleepScore -= 18;
        stress += 16;
        bodyBattery -= 21;
      }

      // The day after the unusually hard long run also shows a dent.
      if (week === SCENARIOS.HARD_LONG_RUN_WEEK && d === 6) {
        restingHR += 4;
        sleepMinutes -= 35;
        bodyBattery -= 14;
      }

      health.push({
        date,
        restingHR: Math.round(restingHR),
        avgHR: Math.round(between(rng, 62, 71)),
        sleepDuration: Math.round(sleepMinutes),
        sleepScore: Math.round(Math.max(0, Math.min(100, sleepScore))),
        stress: Math.round(Math.max(0, Math.min(100, stress))),
        bodyBattery: Math.round(Math.max(0, Math.min(100, bodyBattery))),
        steps: Math.round(between(rng, 7200, 13800)),
        weight: Number((DEMO_PROFILE.weight! + jitter(rng, 0.5)).toFixed(1)),
        source: 'demo',
      });
    }
  }

  activities.sort((a, b) => a.date.getTime() - b.date.getTime());
  health.sort((a, b) => a.date.getTime() - b.date.getTime());

  // --- Scenario: a dip over the last few days -----------------------------
  // Applied after the fact so it lands on whichever days are most recent,
  // whatever length of history was generated. See RECENT_FATIGUE_DAYS.
  const fatigueFrom = addDays(endDate, -(SCENARIOS.RECENT_FATIGUE_DAYS - 1));
  for (const record of health) {
    if (record.date.getTime() < fatigueFrom.getTime()) continue;

    if (record.restingHR != null) record.restingHR += 5; // threshold is 3
    // 70 rather than 45: the baseline window overlaps the dip by a day and
    // night-to-night variance is wide, so a smaller cut does not reliably clear
    // the threshold.
    if (record.sleepDuration != null) record.sleepDuration -= 70;
    // Deliberately under their thresholds, so they do not become indicators.
    if (record.sleepScore != null) record.sleepScore = Math.max(0, record.sleepScore - 5);
    if (record.stress != null) record.stress = Math.min(100, record.stress + 5);
    if (record.bodyBattery != null) record.bodyBattery = Math.max(0, record.bodyBattery - 6);
  }

  return { profile: DEMO_PROFILE, activities, health };
}

/**
 * One extra completed session, dated today, used by the simulated sync so the
 * "finish a workout → see the plan react" loop can be demonstrated.
 *
 * `nth` keeps repeated syncs from colliding and keeps the result deterministic.
 */
export function generateDemoSyncActivity(nth: number, date = new Date()): NormalizedActivity {
  const rng = makeRng(DEMO_SEED + 9973 + nth);
  const at = new Date(startOfDay(date));
  at.setHours(7, 15, 0, 0);
  return buildRun(rng, at, 1000 + nth, 'easy', 10, 1 + FITNESS_GAIN, 1, 0);
}
