/**
 * Garmin Connect provider — the unofficial route.
 *
 * ## What this is, and what it is not
 *
 * This signs in to Garmin Connect with your ordinary email and password, the
 * same credentials you use on the website, and reads your own data. It uses the
 * community-maintained `garmin-connect` package rather than any endpoint
 * invented here.
 *
 * It is **not** the official Garmin Connect Developer Program API. That one is
 * in `GarminProvider.ts` and needs approval from Garmin. The differences matter:
 *
 *   - These endpoints are undocumented and reverse-engineered. Garmin can change
 *     them without notice, and this connector will simply stop working when they
 *     do. It will say so rather than fail silently.
 *   - Automated access this way is likely to be contrary to Garmin's terms of
 *     service. It is your account and your data, and this is your decision.
 *   - Your password is read from `.env`, which is git-ignored. It is never
 *     logged, never stored in the database, and never leaves your machine.
 *
 * ## Session caching
 *
 * Signing in on every sync would be slow and would hammer Garmin's login. After
 * the first sign-in the session tokens are cached to a git-ignored file and
 * reused, so the password is normally only sent once. An expired session falls
 * back to a fresh sign-in automatically.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { GarminConnect } from 'garmin-connect';
import { env } from '@/lib/env';
import type { Sport } from '@/lib/constants';
import { ProviderNotConfiguredError, type GarminDataProvider } from '../provider';
import type {
  DateRange,
  NormalizedActivity,
  NormalizedHealth,
  ProviderData,
} from '../types';
import { parseFitFile } from './FitProvider';

/** Where the cached session lives. Git-ignored; contains tokens, not the password. */
const SESSION_FILE = path.join(process.cwd(), '.garmin-session.json');

/**
 * How many days of daily health data to fetch.
 *
 * Health has to be requested one day at a time, so this is deliberately modest:
 * the recovery analysis only ever looks at the last few weeks against a 14-day
 * baseline, and fetching a year would mean a thousand requests for data nothing
 * reads.
 */
const HEALTH_DAYS = 30;

/**
 * How many new activities to enrich with their original FIT file per sync.
 *
 * The activity list gives summary figures only. Downloading the original file
 * adds per-kilometre splits and the sample stream that the detail charts and
 * personal-record detection need — but it is one request per activity, so it is
 * bounded and only ever applied to activities that are new.
 */
const FIT_ENRICH_LIMIT = 15;

/** A courteous pause between requests, so a sync does not hammer Garmin. */
const REQUEST_DELAY_MS = 250;

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// Field mapping
// ---------------------------------------------------------------------------

type Raw = Record<string, unknown>;

/** A finite number, or null. Garmin uses null, 0 and absent fairly loosely. */
function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Garmin's `activityType.typeKey` mapped onto our sports. */
export function mapConnectSport(typeKey: unknown): Sport {
  const key = String(typeKey ?? '').toLowerCase();
  if (key.includes('run')) return 'running';
  if (key.includes('cycl') || key.includes('bik')) return 'cycling';
  if (key.includes('swim')) return 'swimming';
  return 'other';
}

/**
 * Convert one Garmin Connect activity summary into our shape.
 *
 * Exported so it can be tested against recorded payloads without a live login.
 */
export function normaliseConnectActivity(activity: Raw): NormalizedActivity {
  const sport = mapConnectSport((activity.activityType as Raw)?.typeKey);

  // `duration` includes pauses; `movingDuration` is what a runner means. Prefer
  // the latter where Garmin provides it.
  const duration = num(activity.movingDuration) ?? num(activity.duration) ?? 0;
  const distance = num(activity.distance);
  const speed = num(activity.averageSpeed);

  // Derive pace from distance and time rather than trusting a separate field,
  // so the three can never disagree with each other.
  const pace =
    distance && distance > 0 && duration > 0
      ? Math.round((duration / distance) * 1000)
      : null;

  // Garmin reports running cadence already doubled, and cycling cadence in
  // revolutions. Take whichever matches the sport.
  const cadence =
    sport === 'cycling'
      ? num(activity.averageBikingCadenceInRevPerMinute)
      : sport === 'swimming'
        ? num(activity.averageSwimCadenceInStrokesPerMinute)
        : num(activity.averageRunningCadenceInStepsPerMinute);

  // Garmin gives local and GMT start times. The local one is what the athlete
  // remembers, and everything else in this application works in local days.
  const startedAt = activity.startTimeLocal ?? activity.startTimeGMT;

  return {
    externalId: String(activity.activityId ?? ''),
    source: 'garmin_api',
    // Garmin returns "2026-08-11 06:30:00"; make it unambiguous for Date.
    date: startedAt ? new Date(String(startedAt).replace(' ', 'T')) : new Date(),
    sport,
    title: String(activity.activityName ?? 'Garmin activity'),
    duration: Math.round(duration),
    distance: distance === null ? null : Math.round(distance),
    avgHR: num(activity.averageHR),
    maxHR: num(activity.maxHR),
    avgPace: pace,
    avgSpeed: speed === null ? null : Number(speed.toFixed(3)),
    elevationGain: num(activity.elevationGain),
    calories: num(activity.calories),
    cadence: cadence === null ? null : Math.round(cadence),
    averagePower: num(activity.avgPower) ?? num(activity.averagePower),
    normalizedPower: num(activity.normPower),
    // Garmin's own metrics, carried through only when Garmin reported them.
    aerobicTrainingEffect: num(activity.aerobicTrainingEffect),
    anaerobicTrainingEffect: num(activity.anaerobicTrainingEffect),
    // Summaries carry neither; the FIT enrichment below fills them in.
    splits: [],
    stream: [],
    providerPayload: activity,
  };
}

/** Convert a day's sleep, heart-rate and step data into one health record. */
export function normaliseConnectHealth(
  date: Date,
  sleep: Raw | null,
  heartRate: Raw | null,
  steps: number | null,
): NormalizedHealth {
  const dto = (sleep?.dailySleepDTO ?? {}) as Raw;
  const scores = (dto.sleepScores ?? {}) as Raw;
  const overall = (scores.overall ?? {}) as Raw;

  const sleepSeconds = num(dto.sleepTimeSeconds);

  return {
    date,
    restingHR: num(heartRate?.restingHeartRate),
    avgHR: null, // Garmin Connect does not expose an all-day average here.
    sleepDuration: sleepSeconds === null ? null : Math.round(sleepSeconds / 60),
    sleepScore: num(overall.value),
    // Stress and Body Battery are not available through these endpoints, so
    // they stay null rather than being approximated from something else.
    stress: null,
    bodyBattery: null,
    steps: steps === null ? null : Math.round(steps),
    weight: null,
    source: 'garmin_api',
  };
}

// ---------------------------------------------------------------------------
// The provider
// ---------------------------------------------------------------------------

export class GarminConnectProvider implements GarminDataProvider {
  readonly id = 'garmin_api' as const;
  readonly label = 'Garmin Connect';

  /** Non-fatal problems worth telling the athlete about after a sync. */
  readonly warnings: string[] = [];

  private client: GarminConnect | null = null;

  isConfigured(): boolean {
    return Boolean(env.garminConnect.email && env.garminConnect.password);
  }

  unavailableReason(): string | null {
    if (this.isConfigured()) return null;
    return 'Your Garmin Connect email and password are not set. Add GARMIN_CONNECT_EMAIL and GARMIN_CONNECT_PASSWORD to your .env file.';
  }

  // --- Signing in --------------------------------------------------------

  /**
   * Get a signed-in client, reusing a cached session where possible.
   *
   * The password is only sent when there is no usable cached session.
   */
  private async connect(): Promise<GarminConnect> {
    if (this.client) return this.client;

    const client = new GarminConnect({
      username: env.garminConnect.email,
      password: env.garminConnect.password,
    });

    // Try the cached session first.
    try {
      const cached = await readFile(SESSION_FILE, 'utf8');
      const tokens = JSON.parse(cached) as { oauth1?: never; oauth2?: never };
      if (tokens.oauth1 && tokens.oauth2) {
        client.loadToken(tokens.oauth1, tokens.oauth2);
        // Prove the session actually works before relying on it.
        await client.getUserProfile();
        this.client = client;
        return client;
      }
    } catch {
      // No cached session, or it has expired. Sign in properly below.
    }

    try {
      await client.login(env.garminConnect.email, env.garminConnect.password);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      // Distinguish "could not reach Garmin" from "Garmin said no". These look
      // alike in a stack trace but mean completely different things, and sending
      // someone to re-check their password when the real problem is a firewall
      // wastes their time.
      //
      // Rather than guess from the error text — a blocking proxy often returns a
      // 403 of its own, which reads exactly like a rejected sign-in — actually
      // check whether Garmin is reachable at all.
      const reachability = await this.canReachGarmin();

      if (reachability === 'blocked') {
        throw new ProviderNotConfiguredError(
          'garmin_api',
          `Could not reach Garmin at all, so the sign-in never got as far as being checked — your credentials may be perfectly fine. Check your internet connection, and whether a VPN, firewall or corporate network is blocking connect.garmin.com. (Underlying error: ${message})`,
        );
      }

      if (reachability === 'unknown') {
        throw new ProviderNotConfiguredError(
          'garmin_api',
          `Signing in to Garmin failed, and it is not clear whether the cause was your credentials or the connection. Check GARMIN_CONNECT_EMAIL and GARMIN_CONNECT_PASSWORD in your .env file first, then your network. Note this connector cannot sign in to accounts with two-factor authentication enabled. (Underlying error: ${message})`,
        );
      }

      // Garmin actively rejecting the sign-in.
      if (/401|403|credential|password|unauthor|invalid.*(user|login)/i.test(message)) {
        throw new ProviderNotConfiguredError(
          'garmin_api',
          'Garmin rejected those credentials. Check GARMIN_CONNECT_EMAIL and GARMIN_CONNECT_PASSWORD in your .env file. If your account has two-factor authentication enabled, this unofficial connector cannot sign in — use FIT file upload instead.',
        );
      }

      throw new ProviderNotConfiguredError(
        'garmin_api',
        `Could not sign in to Garmin Connect: ${message}. These endpoints are unofficial, so this can also mean Garmin has changed something on their side.`,
      );
    }

    // Cache the session so the password is not needed again next time.
    try {
      const tokens = client.exportToken();
      await mkdir(path.dirname(SESSION_FILE), { recursive: true });
      await writeFile(SESSION_FILE, JSON.stringify(tokens), { mode: 0o600 });
    } catch {
      this.warnings.push(
        'Signed in successfully, but the session could not be cached, so your password will be sent again on the next sync.',
      );
    }

    this.client = client;
    return client;
  }

  /**
   * Can this machine reach Garmin at all?
   *
   * Used only to explain a failed sign-in accurately. Any response — even an
   * error page — proves the network path works, and therefore that the problem
   * lies with the credentials rather than with connectivity.
   */
  private async canReachGarmin(): Promise<'reachable' | 'blocked' | 'unknown'> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);

    try {
      const response = await fetch('https://connect.garmin.com/', {
        method: 'HEAD',
        signal: controller.signal,
      });

      // `fetch` only throws when the request never completed, so an error status
      // still arrives here as a resolved response. Anything below 400 is Garmin
      // answering normally. A 403 or 407 is more likely a proxy or firewall
      // refusing on our behalf than Garmin itself, but it is not conclusive.
      if (response.status < 400) return 'reachable';
      if (response.status === 403 || response.status === 407) return 'blocked';
      return 'unknown';
    } catch {
      // Nothing came back at all: DNS failure, refused connection, timeout.
      return 'blocked';
    } finally {
      clearTimeout(timer);
    }
  }

  // --- Fetching ----------------------------------------------------------

  async fetch(range: DateRange): Promise<ProviderData> {
    if (!this.isConfigured()) {
      throw new ProviderNotConfiguredError('garmin_api', this.unavailableReason()!);
    }

    const client = await this.connect();

    const activities = await this.fetchActivities(client, range);
    const health = await this.fetchHealth(client, range);

    return { activities, health };
  }

  /**
   * Read the activity list, then enrich the most recent ones with their
   * original FIT file so they have splits and a sample stream.
   */
  private async fetchActivities(
    client: GarminConnect,
    range: DateRange,
  ): Promise<NormalizedActivity[]> {
    const collected: NormalizedActivity[] = [];
    const pageSize = 50;

    // Page backwards through the list until we pass the start of the range.
    for (let start = 0; start < 500; start += pageSize) {
      let page: Raw[];
      try {
        page = (await client.getActivities(start, pageSize)) as unknown as Raw[];
      } catch (error) {
        this.warnings.push(
          `Could not read the full activity list: ${error instanceof Error ? error.message : String(error)}`,
        );
        break;
      }

      if (!Array.isArray(page) || page.length === 0) break;

      let reachedStart = false;
      for (const raw of page) {
        const activity = normaliseConnectActivity(raw);
        if (activity.date < range.start) {
          reachedStart = true;
          continue;
        }
        if (activity.date > range.end) continue;
        collected.push(activity);
      }

      if (reachedStart || page.length < pageSize) break;
      await pause(REQUEST_DELAY_MS);
    }

    await this.enrichWithFitFiles(client, collected);
    return collected;
  }

  /**
   * Download the original FIT file for recent activities and merge in the
   * splits and stream it contains.
   *
   * Reuses the same parser as manual FIT upload, so an activity synced from
   * Garmin ends up identical to the same activity uploaded by hand. Failures
   * here are non-fatal: the summary data is still perfectly usable.
   */
  private async enrichWithFitFiles(
    client: GarminConnect,
    activities: NormalizedActivity[],
  ): Promise<void> {
    const newest = [...activities]
      .sort((a, b) => b.date.getTime() - a.date.getTime())
      .slice(0, FIT_ENRICH_LIMIT);

    let failures = 0;

    for (const activity of newest) {
      try {
        const data = (await client.downloadOriginalActivityData(
          { activityId: Number(activity.externalId) } as never,
          '/tmp',
        )) as unknown;

        // The library returns either a buffer or writes to disk depending on
        // version; only the buffer form is usable directly.
        if (!data || !(data instanceof Uint8Array || Buffer.isBuffer(data))) continue;

        const parsed = parseFitFile({
          filename: `${activity.externalId}.fit`,
          data: data as Uint8Array,
        });

        if (parsed.activity) {
          activity.splits = parsed.activity.splits;
          activity.stream = parsed.activity.stream;
          // Fill only gaps — Garmin's own summary figures stay authoritative.
          activity.cadence ??= parsed.activity.cadence;
          activity.averagePower ??= parsed.activity.averagePower;
          activity.elevationGain ??= parsed.activity.elevationGain;
        }
      } catch {
        failures++;
      }
      await pause(REQUEST_DELAY_MS);
    }

    if (failures > 0) {
      this.warnings.push(
        `${failures} of ${newest.length} activities could not have their detailed recording downloaded. Their summary figures are still complete, but they will have no splits or in-session charts.`,
      );
    }
  }

  /**
   * Read daily health data.
   *
   * One request per metric per day, so the window is bounded by HEALTH_DAYS and
   * paced. A day that fails is skipped rather than abandoning the whole sync.
   */
  private async fetchHealth(
    client: GarminConnect,
    range: DateRange,
  ): Promise<NormalizedHealth[]> {
    const records: NormalizedHealth[] = [];
    const end = range.end;

    let failures = 0;

    for (let dayOffset = 0; dayOffset < HEALTH_DAYS; dayOffset++) {
      const date = new Date(end);
      date.setDate(date.getDate() - dayOffset);
      date.setHours(0, 0, 0, 0);

      if (date < range.start) break;

      try {
        const [sleep, heartRate, steps] = await Promise.all([
          client.getSleepData(date).catch(() => null),
          client.getHeartRate(date).catch(() => null),
          client.getSteps(date).catch(() => null),
        ]);

        const record = normaliseConnectHealth(
          date,
          sleep as Raw | null,
          heartRate as Raw | null,
          typeof steps === 'number' ? steps : null,
        );

        // A day with nothing in it is not worth storing.
        if (
          record.restingHR !== null ||
          record.sleepDuration !== null ||
          record.steps !== null
        ) {
          records.push(record);
        }
      } catch {
        failures++;
      }

      await pause(REQUEST_DELAY_MS);
    }

    if (failures > 0) {
      this.warnings.push(
        `Health data could not be read for ${failures} of the last ${HEALTH_DAYS} days.`,
      );
    }

    if (records.length > 0) {
      this.warnings.push(
        'Stress and Body Battery are not available through this unofficial connection, so those readings are recorded as missing rather than estimated.',
      );
    }

    return records;
  }
}
