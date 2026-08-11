/**
 * The one shape every data source must produce.
 *
 * Whether an activity arrives from the Garmin API, a `.FIT` file or the demo
 * generator, it is converted into these types before anything else touches it.
 * That is what keeps the analytics, the plan engine and the AI tools completely
 * independent of where the data came from.
 *
 * Every metric is optional. `null` means "this source did not provide it" and is
 * carried through to the database and the screen as such — a missing value is
 * never replaced by an estimate.
 */

import type { Sport, Source } from '@/lib/constants';
import type { StreamPoint } from '@/lib/json';

/** One lap or split as reported by the source. */
export interface NormalizedSplit {
  splitNumber: number;
  distance: number | null; // metres
  duration: number | null; // seconds
  pace: number | null; // seconds per kilometre
  avgHR: number | null;
  elevation: number | null; // net elevation change, metres
}

/** A single training session, normalised. */
export interface NormalizedActivity {
  /** Stable identifier from the source system. Together with `source` this is unique. */
  externalId: string;
  source: Source;

  date: Date;
  sport: Sport;
  title: string;

  /** Seconds. The only field a source must always provide. */
  duration: number;

  distance: number | null; // metres
  avgHR: number | null;
  maxHR: number | null;
  avgPace: number | null; // seconds per kilometre
  avgSpeed: number | null; // metres per second
  elevationGain: number | null; // metres
  calories: number | null;
  cadence: number | null;
  averagePower: number | null; // watts
  normalizedPower: number | null; // watts

  /**
   * Values the device itself computed. These stay null unless the source really
   * reported them — we never derive them ourselves and present them as Garmin's.
   */
  aerobicTrainingEffect: number | null;
  anaerobicTrainingEffect: number | null;

  splits: NormalizedSplit[];
  /** Sampled record stream, if the source has one. Powers the detail charts. */
  stream: StreamPoint[];

  /** The untouched source payload, kept for transparency. */
  providerPayload?: Record<string, unknown>;
  /** Notes about what the source did or did not supply. */
  notes?: string[];
}

/** One day of health and recovery data, normalised. */
export interface NormalizedHealth {
  date: Date;
  restingHR: number | null;
  avgHR: number | null;
  sleepDuration: number | null; // minutes
  sleepScore: number | null; // 0-100, as reported by the device
  stress: number | null; // 0-100, as reported by the device
  bodyBattery: number | null; // 0-100, as reported by the device
  steps: number | null;
  weight: number | null; // kilograms
  source: Source;
}

/** An athlete profile supplied by a source (only the demo provider has one). */
export interface NormalizedProfile {
  name: string;
  age: number | null;
  sex: string | null;
  height: number | null; // centimetres
  weight: number | null; // kilograms
  maxHR: number | null;
  restingHR: number | null;
}

/** The window of time a sync should cover. */
export interface DateRange {
  start: Date;
  end: Date;
}

/** Everything a provider returns from one fetch. */
export interface ProviderData {
  activities: NormalizedActivity[];
  health: NormalizedHealth[];
  profile?: NormalizedProfile;
}
