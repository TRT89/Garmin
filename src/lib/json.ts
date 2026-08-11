/**
 * Helpers for the JSON-in-a-text-column pattern.
 *
 * SQLite has no native JSON type in Prisma, so structured fields (workout
 * steps, adaptation snapshots, record streams…) are stored as serialised
 * strings. These helpers keep that detail in one place and make sure a corrupt
 * or empty column degrades to a fallback instead of throwing at render time.
 */

/** Parse a JSON text column, returning `fallback` if it is empty or invalid. */
export function parseJSON<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

/** Serialise a value for storage, returning null for null/undefined input. */
export function stringifyJSON(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return JSON.stringify(value);
}

// ---------------------------------------------------------------------------
// Shapes stored inside JSON columns
// ---------------------------------------------------------------------------

/** One step of a structured workout (`PlannedWorkout.structureJSON`). */
export interface WorkoutStep {
  type: 'warmup' | 'interval' | 'recovery' | 'steady' | 'cooldown';
  /** Number of times this step repeats. 1 for everything except interval sets. */
  repeat?: number;
  distance?: number | null; // metres
  duration?: number | null; // seconds
  paceMin?: number | null; // seconds per km, fastest end of the band
  paceMax?: number | null; // seconds per km, slowest end of the band
  note?: string;
}

/** A single sample from an activity's recorded stream (`Activity.rawData`). */
export interface StreamPoint {
  t: number; // seconds since the activity started
  distance?: number | null; // cumulative metres
  hr?: number | null;
  pace?: number | null; // seconds per km at this moment
  speed?: number | null; // metres per second
  altitude?: number | null; // metres
  cadence?: number | null;
  power?: number | null; // watts
}

/** Everything we keep in `Activity.rawData`. */
export interface ActivityRawData {
  /** Sampled record stream powering the activity detail charts. */
  stream?: StreamPoint[];
  /** Untouched payload from the provider, for transparency and debugging. */
  provider?: Record<string, unknown>;
  /** Notes about what the source did or did not supply. */
  notes?: string[];
}
