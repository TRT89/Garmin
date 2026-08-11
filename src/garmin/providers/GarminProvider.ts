/**
 * The Garmin Connect Developer API connector.
 *
 * ## Status: architected, not yet completed
 *
 * Garmin's Activity and Health APIs are not public. Access requires an
 * application to the **Garmin Connect Developer Program**, after which Garmin
 * issues a consumer key and secret and supplies the endpoint documentation for
 * the specific APIs granted.
 *
 * Because that documentation is not public, this file deliberately does **not**
 * guess at endpoint paths or payload shapes. Doing so would produce a connector
 * that looks finished and fails in confusing ways. Instead:
 *
 *   - The full structure is here: configuration, OAuth token storage, request
 *     signing, the fetch flow, and the normalisation layer that converts Garmin's
 *     payloads into this application's own shapes.
 *   - The three places that need Garmin's actual documentation are marked
 *     `TODO(garmin-api)` and throw a clear, explanatory error.
 *   - `isConfigured()` returns false without credentials, so the rest of the
 *     application routes around this connector rather than breaking.
 *
 * **It never returns invented data.** If it cannot do the real thing, it says so.
 *
 * ## Completing this connector
 *
 * 1. Apply at https://developer.garmin.com/gc-developer-program/
 * 2. Put the issued credentials in `.env` as GARMIN_CLIENT_ID and
 *    GARMIN_CLIENT_SECRET, and set GARMIN_ENABLED="true".
 * 3. Fill in ENDPOINTS below from the documentation Garmin provides.
 * 4. Complete the three `TODO(garmin-api)` sections.
 *
 * Everything downstream — storage, analytics, planning, the AI coach — already
 * works, because it only ever sees the normalised shapes in `../types.ts`.
 */

import { env, garminDisabledReason, isGarminConfigured } from '@/lib/env';
import { ProviderNotConfiguredError, type GarminDataProvider } from '../provider';
import type {
  DateRange,
  NormalizedActivity,
  NormalizedHealth,
  ProviderData,
} from '../types';

/**
 * Endpoint configuration.
 *
 * Left blank on purpose: these come from the documentation Garmin supplies on
 * approval, and inventing plausible-looking URLs would be worse than useless.
 */
const ENDPOINTS = {
  /** OAuth authorisation URL the athlete is redirected to. */
  authorize: '',
  /** OAuth token exchange URL. */
  token: '',
  /** Activity summaries within a time window. */
  activities: '',
  /** Detailed samples for one activity. */
  activityDetails: '',
  /** Daily health summaries (resting heart rate, sleep, stress, steps). */
  dailyHealth: '',
} as const;

/** True once the endpoint configuration above has actually been filled in. */
function hasEndpoints(): boolean {
  return Boolean(ENDPOINTS.activities && ENDPOINTS.token);
}

export class GarminProvider implements GarminDataProvider {
  readonly id = 'garmin_api' as const;
  readonly label = 'Garmin Connect API';

  /**
   * Whether this connector can be used.
   *
   * Requires both credentials *and* the endpoint configuration. Credentials
   * alone are not enough, and reporting otherwise would produce a button that
   * fails when pressed.
   */
  isConfigured(): boolean {
    return isGarminConfigured() && hasEndpoints();
  }

  unavailableReason(): string | null {
    if (this.isConfigured()) return null;

    const credentialProblem = garminDisabledReason();
    if (credentialProblem) return credentialProblem;

    return (
      'Garmin credentials are present, but the API endpoint configuration has not been filled in yet. ' +
      'Garmin supplies these details when it approves an application to the Garmin Connect Developer Program. ' +
      'See the instructions at the top of src/garmin/providers/GarminProvider.ts.'
    );
  }

  async fetch(range: DateRange): Promise<ProviderData> {
    if (!this.isConfigured()) {
      throw new ProviderNotConfiguredError('garmin_api', this.unavailableReason()!);
    }

    const token = await this.getAccessToken();

    const [activities, health] = await Promise.all([
      this.fetchActivities(range, token),
      this.fetchHealth(range, token),
    ]);

    return { activities, health };
  }

  // -------------------------------------------------------------------------
  // OAuth
  // -------------------------------------------------------------------------

  /**
   * The URL to send the athlete to in order to authorise this application.
   *
   * Used by the settings page once the connector is configured.
   */
  authorizationUrl(state: string): string {
    if (!ENDPOINTS.authorize) {
      throw new ProviderNotConfiguredError(
        'garmin_api',
        'The Garmin authorisation URL has not been configured.',
      );
    }

    const params = new URLSearchParams({
      client_id: env.garmin.clientId,
      redirect_uri: env.garmin.redirectUri,
      response_type: 'code',
      state,
    });

    return `${ENDPOINTS.authorize}?${params.toString()}`;
  }

  /**
   * Exchange an authorisation code for tokens, or refresh an expired one.
   *
   * TODO(garmin-api): complete once Garmin's token endpoint and grant types are
   * known. Tokens should be stored in the database rather than held in memory so
   * they survive a restart.
   */
  private async getAccessToken(): Promise<string> {
    throw new ProviderNotConfiguredError(
      'garmin_api',
      'Garmin OAuth token exchange has not been implemented. It requires the token endpoint and grant details that Garmin provides on approval to the Garmin Connect Developer Program.',
    );
  }

  // -------------------------------------------------------------------------
  // Fetching
  // -------------------------------------------------------------------------

  /**
   * TODO(garmin-api): call the activity endpoint and pass each result through
   * {@link normaliseActivity}. The request shape (date parameters, paging,
   * signing) comes from Garmin's documentation.
   */
  private async fetchActivities(
    _range: DateRange,
    _token: string,
  ): Promise<NormalizedActivity[]> {
    throw new ProviderNotConfiguredError(
      'garmin_api',
      'Fetching activities from the Garmin API has not been implemented yet.',
    );
  }

  /**
   * TODO(garmin-api): call the daily health endpoint and pass each result
   * through {@link normaliseHealth}.
   */
  private async fetchHealth(_range: DateRange, _token: string): Promise<NormalizedHealth[]> {
    throw new ProviderNotConfiguredError(
      'garmin_api',
      'Fetching health data from the Garmin API has not been implemented yet.',
    );
  }
}

// ---------------------------------------------------------------------------
// Normalisation
//
// These are written against the field names Garmin uses in its published
// developer materials. They are defensive: any field that is absent becomes
// null rather than a default, so a change in Garmin's payload degrades into
// missing data rather than wrong data.
// ---------------------------------------------------------------------------

/** A number, or null if the value is absent or not numeric. */
function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Garmin's sport names mapped onto ours. */
export function mapGarminSport(activityType: unknown): NormalizedActivity['sport'] {
  const type = String(activityType ?? '').toLowerCase();
  if (type.includes('run')) return 'running';
  if (type.includes('cycl') || type.includes('bik')) return 'cycling';
  if (type.includes('swim')) return 'swimming';
  return 'other';
}

/**
 * Convert one Garmin activity summary into this application's shape.
 *
 * Exported so it can be unit tested against recorded payloads without needing
 * live API access.
 */
export function normaliseActivity(payload: Record<string, unknown>): NormalizedActivity {
  const duration = num(payload.durationInSeconds) ?? 0;
  const distance = num(payload.distanceInMeters);
  const speed = num(payload.averageSpeedInMetersPerSecond);

  const sport = mapGarminSport(payload.activityType);

  // Pace is derived from distance and time rather than taken on trust, so it is
  // always internally consistent with the other two.
  const pace = distance && distance > 0 && duration > 0 ? Math.round((duration / distance) * 1000) : null;

  const startedAt = num(payload.startTimeInSeconds);

  return {
    externalId: String(payload.summaryId ?? payload.activityId ?? ''),
    source: 'garmin_api',
    date: startedAt ? new Date(startedAt * 1000) : new Date(),
    sport,
    title: String(payload.activityName ?? 'Garmin activity'),
    duration,
    distance,
    avgHR: num(payload.averageHeartRateInBeatsPerMinute),
    maxHR: num(payload.maxHeartRateInBeatsPerMinute),
    avgPace: pace,
    avgSpeed: speed,
    elevationGain: num(payload.totalElevationGainInMeters),
    calories: num(payload.activeKilocalories),
    cadence: num(payload.averageRunCadenceInStepsPerMinute) ?? num(payload.averageBikeCadenceInRoundsPerMinute),
    averagePower: num(payload.averagePowerInWatts),
    normalizedPower: num(payload.normalizedPowerInWatts),
    // Garmin's own metrics — carried through only when Garmin supplied them.
    aerobicTrainingEffect: num(payload.aerobicTrainingEffect),
    anaerobicTrainingEffect: num(payload.anaerobicTrainingEffect),
    splits: [],
    stream: [],
    providerPayload: payload,
  };
}

/** Convert one Garmin daily health summary into this application's shape. */
export function normaliseHealth(payload: Record<string, unknown>): NormalizedHealth {
  const startedAt = num(payload.startTimeInSeconds);
  const sleepSeconds = num(payload.sleepTimeInSeconds);

  return {
    date: startedAt ? new Date(startedAt * 1000) : new Date(),
    restingHR: num(payload.restingHeartRateInBeatsPerMinute),
    avgHR: num(payload.averageHeartRateInBeatsPerMinute),
    sleepDuration: sleepSeconds != null ? Math.round(sleepSeconds / 60) : null,
    sleepScore: num(payload.overallSleepScore),
    stress: num(payload.averageStressLevel),
    bodyBattery: num(payload.bodyBatteryChargedValue),
    steps: num(payload.steps),
    weight: num(payload.weightInGrams) != null ? num(payload.weightInGrams)! / 1000 : null,
    source: 'garmin_api',
  };
}
