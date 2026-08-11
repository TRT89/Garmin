/**
 * The `.FIT` file provider.
 *
 * FIT is the format Garmin devices actually record in, and it is what you get
 * when you export an activity from Garmin Connect. Parsing it here means the
 * whole application works with your real data without any API access at all.
 *
 * Decoding uses Garmin's own free JavaScript SDK (`@garmin/fitsdk`), so nothing
 * about the format is reverse-engineered or guessed.
 *
 * The guiding rule throughout: **a field that the file does not contain becomes
 * `null`.** Different devices record wildly different subsets — a basic watch
 * has no power meter, wrist heart rate is not recorded while swimming — and an
 * absent metric must stay absent rather than being filled in with a default or
 * an estimate.
 */

import { Decoder, Stream } from '@garmin/fitsdk';
import type { Sport } from '@/lib/constants';
import type { StreamPoint } from '@/lib/json';
import { ProviderNotConfiguredError, type GarminDataProvider } from '../provider';
import type {
  DateRange,
  NormalizedActivity,
  NormalizedSplit,
  ProviderData,
} from '../types';

/** One uploaded file. */
export interface FitUpload {
  filename: string;
  data: Buffer | Uint8Array;
}

/** How often the record stream is sampled when stored, in seconds. */
const STREAM_SAMPLE_SECONDS = 15;

// ---------------------------------------------------------------------------
// Field reading helpers
//
// FIT messages are plain objects whose keys vary by device and firmware, so
// every read goes through these: try the known field names in order, and give
// up with null rather than guessing.
// ---------------------------------------------------------------------------

type FitMessage = Record<string, unknown>;

/** The first of `keys` present on `message` as a finite number, else null. */
function num(message: FitMessage, ...keys: string[]): number | null {
  for (const key of keys) {
    const value = message[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return null;
}

/** The first of `keys` present as a Date, else null. */
function date(message: FitMessage, ...keys: string[]): Date | null {
  for (const key of keys) {
    const value = message[key];
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
    if (typeof value === 'number' && Number.isFinite(value)) {
      // FIT timestamps count seconds from 1989-12-31 UTC.
      return new Date((value + 631065600) * 1000);
    }
  }
  return null;
}

/** Round to a sensible number of decimals, preserving null. */
function round(value: number | null, decimals = 0): number | null {
  if (value === null) return null;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/** Map FIT's sport names onto ours. */
export function mapFitSport(sport: unknown, subSport?: unknown): Sport {
  const name = String(sport ?? '').toLowerCase();
  const sub = String(subSport ?? '').toLowerCase();

  if (name.includes('running') || sub.includes('running')) return 'running';
  if (name.includes('cycling') || name.includes('biking')) return 'cycling';
  if (name.includes('swimming')) return 'swimming';
  return 'other';
}

/**
 * Running cadence, normalised to steps per minute.
 *
 * FIT records running cadence as one leg's cadence — around 85 — while runners
 * and every other part of this application talk about total steps per minute,
 * around 170. Values that are implausibly low for total cadence are doubled,
 * and the fractional part is added when the device recorded it.
 */
function normaliseCadence(message: FitMessage, sport: Sport): number | null {
  const cadence = num(message, 'avgCadence', 'avgRunningCadence', 'averageCadence');
  if (cadence === null) return null;

  if (sport !== 'running') return round(cadence, 0);

  const fractional = num(message, 'avgFractionalCadence') ?? 0;
  const total = cadence + fractional;
  // A running cadence below 120 spm is one-leg cadence, not total.
  return round(total < 120 ? total * 2 : total, 0);
}

// ---------------------------------------------------------------------------
// Building the pieces
// ---------------------------------------------------------------------------

/** Convert record messages into a sampled stream. */
function buildStream(records: FitMessage[], startTime: Date | null): StreamPoint[] {
  if (records.length === 0 || !startTime) return [];

  const start = startTime.getTime();
  const points: StreamPoint[] = [];
  let lastSampleAt = -Infinity;

  for (const record of records) {
    const timestamp = date(record, 'timestamp');
    if (!timestamp) continue;

    const elapsed = Math.round((timestamp.getTime() - start) / 1000);
    if (elapsed < 0) continue;

    // Keep the file's full resolution out of the database: a three-hour ride at
    // one sample per second is 10,000 points, and the charts cannot show that
    // much detail anyway.
    if (elapsed - lastSampleAt < STREAM_SAMPLE_SECONDS) continue;
    lastSampleAt = elapsed;

    const speed = num(record, 'enhancedSpeed', 'speed');

    points.push({
      t: elapsed,
      distance: round(num(record, 'distance'), 0),
      hr: num(record, 'heartRate'),
      // Pace is derived from speed rather than read separately, so the two can
      // never disagree. A stationary sample has no meaningful pace.
      pace: speed && speed > 0.3 ? Math.round(1000 / speed) : null,
      speed: round(speed, 3),
      altitude: round(num(record, 'enhancedAltitude', 'altitude'), 1),
      cadence: num(record, 'cadence'),
      power: num(record, 'power'),
    });
  }

  return points;
}

/** Convert lap messages into splits. */
function buildSplits(laps: FitMessage[]): NormalizedSplit[] {
  return laps.map((lap, index) => {
    const distance = num(lap, 'totalDistance');
    const duration = num(lap, 'totalTimerTime', 'totalElapsedTime');

    const ascent = num(lap, 'totalAscent');
    const descent = num(lap, 'totalDescent');

    return {
      splitNumber: index + 1,
      distance: round(distance, 0),
      duration: duration === null ? null : Math.round(duration),
      pace:
        distance && distance > 0 && duration
          ? Math.round((duration / distance) * 1000)
          : null,
      avgHR: num(lap, 'avgHeartRate'),
      // Net elevation change, which is what a splits table shows.
      elevation:
        ascent === null && descent === null ? null : round((ascent ?? 0) - (descent ?? 0), 1),
    };
  });
}

/** A stable identifier for a FIT activity, so re-uploading the same file updates it. */
function buildExternalId(session: FitMessage, filename: string, startTime: Date | null): string {
  // Prefer something intrinsic to the activity over the filename, which the
  // athlete may well have renamed.
  const serial = num(session, 'serialNumber');
  if (startTime) {
    return `fit-${startTime.toISOString()}${serial != null ? `-${serial}` : ''}`;
  }
  return `fit-${filename}`;
}

const SPORT_TITLES: Record<Sport, string> = {
  running: 'Run',
  cycling: 'Ride',
  swimming: 'Swim',
  other: 'Activity',
};

// ---------------------------------------------------------------------------
// Parsing one file
// ---------------------------------------------------------------------------

export interface FitParseResult {
  activity: NormalizedActivity | null;
  /** Anything the file could not supply, or that needed interpreting. */
  notes: string[];
  error: string | null;
}

/**
 * Parse a single `.FIT` file into a normalised activity.
 *
 * Exported separately from the provider so it can be tested directly against
 * fixture files.
 */
export function parseFitFile(upload: FitUpload): FitParseResult {
  const notes: string[] = [];

  const bytes =
    upload.data instanceof Uint8Array ? upload.data : new Uint8Array(upload.data);
  const stream = Stream.fromByteArray(bytes);

  if (!Decoder.isFIT(stream)) {
    return {
      activity: null,
      notes,
      error: `${upload.filename} is not a FIT file.`,
    };
  }

  const decoder = new Decoder(stream);
  if (!decoder.checkIntegrity()) {
    // A failed integrity check usually means a truncated download. Parsing
    // anyway would silently produce a partial activity.
    return {
      activity: null,
      notes,
      error: `${upload.filename} appears to be incomplete or corrupted, so it has not been imported.`,
    };
  }

  const { messages, errors } = decoder.read({
    applyScaleAndOffset: true,
    convertTypesToStrings: true,
    convertDateTimesToDates: true,
    expandSubFields: true,
    expandComponents: true,
    mergeHeartRates: true,
  });

  if (errors?.length) {
    notes.push(`${errors.length} message(s) in the file could not be decoded and were skipped.`);
  }

  const sessions = (messages.sessionMesgs ?? []) as FitMessage[];
  if (sessions.length === 0) {
    return {
      activity: null,
      notes,
      error: `${upload.filename} contains no activity session, so there is nothing to import.`,
    };
  }

  // A file can hold several sessions (a triathlon); the first is the activity.
  const session = sessions[0];
  if (sessions.length > 1) {
    notes.push(
      `The file contains ${sessions.length} sessions. Only the first has been imported — multi-sport files are not split automatically yet.`,
    );
  }

  const sport = mapFitSport(session.sport, session.subSport);
  const startTime = date(session, 'startTime', 'timestamp');

  // Timer time excludes pauses, which is what "duration" means to a runner.
  const duration = num(session, 'totalTimerTime', 'totalElapsedTime');
  if (duration === null) {
    return {
      activity: null,
      notes,
      error: `${upload.filename} has no recorded duration, so it cannot be imported.`,
    };
  }

  const distance = num(session, 'totalDistance');
  const speed = num(session, 'enhancedAvgSpeed', 'avgSpeed');

  const records = (messages.recordMesgs ?? []) as FitMessage[];
  const laps = (messages.lapMesgs ?? []) as FitMessage[];

  const streamPoints = buildStream(records, startTime);
  const splits = buildSplits(laps);

  if (records.length === 0) {
    notes.push('The file has no per-second recording, so the in-session charts are unavailable.');
  }
  if (laps.length === 0) {
    notes.push('The file has no lap data, so no splits are shown.');
  }

  const avgHR = num(session, 'avgHeartRate');
  if (avgHR === null) {
    notes.push('No heart-rate data was recorded, so training load is estimated from pace instead.');
  }

  const power = num(session, 'avgPower');

  // Derive pace from distance and time so it always agrees with them.
  const pace =
    distance && distance > 0 && duration > 0 ? Math.round((duration / distance) * 1000) : null;

  const activity: NormalizedActivity = {
    externalId: buildExternalId(session, upload.filename, startTime),
    source: 'fit_upload',
    date: startTime ?? new Date(),
    sport,
    title: String(session.sportProfileName ?? '') || SPORT_TITLES[sport],
    duration: Math.round(duration),
    distance: round(distance, 0),
    avgHR,
    maxHR: num(session, 'maxHeartRate'),
    avgPace: pace,
    avgSpeed: round(speed, 3),
    elevationGain: round(num(session, 'totalAscent'), 0),
    calories: num(session, 'totalCalories'),
    cadence: normaliseCadence(session, sport),
    averagePower: power,
    normalizedPower: num(session, 'normalizedPower', 'avgPower'),
    // The device's own Training Effect values, carried through only when the
    // device actually recorded them. We never compute a substitute.
    aerobicTrainingEffect: round(num(session, 'totalTrainingEffect'), 1),
    anaerobicTrainingEffect: round(num(session, 'totalAnaerobicTrainingEffect'), 1),
    splits,
    stream: streamPoints,
    notes,
  };

  return { activity, notes, error: null };
}

// ---------------------------------------------------------------------------
// The provider
// ---------------------------------------------------------------------------

/**
 * Wraps a batch of uploaded files so they flow through the same sync pipeline
 * as every other data source — meaning an upload also triggers metric
 * calculation, workout matching and a plan review.
 */
export class FitProvider implements GarminDataProvider {
  readonly id = 'fit_upload' as const;
  readonly label = 'FIT file upload';

  /** Files that failed to parse, with the reason, surfaced to the athlete. */
  readonly failures: { filename: string; error: string }[] = [];

  constructor(private readonly uploads: FitUpload[]) {}

  isConfigured(): boolean {
    return this.uploads.length > 0;
  }

  unavailableReason(): string | null {
    return this.isConfigured() ? null : 'No FIT files were provided.';
  }

  async fetch(_range: DateRange): Promise<ProviderData> {
    if (!this.isConfigured()) {
      throw new ProviderNotConfiguredError('fit_upload', this.unavailableReason()!);
    }

    const activities: NormalizedActivity[] = [];

    for (const upload of this.uploads) {
      try {
        const result = parseFitFile(upload);
        if (result.activity) {
          activities.push(result.activity);
        } else if (result.error) {
          this.failures.push({ filename: upload.filename, error: result.error });
        }
      } catch (error) {
        // One bad file must not abandon the rest of the batch.
        this.failures.push({
          filename: upload.filename,
          error:
            error instanceof Error
              ? `Could not read this file: ${error.message}`
              : 'Could not read this file.',
        });
      }
    }

    // FIT files carry no daily health data — that comes from the Garmin API.
    return { activities, health: [] };
  }
}
