/**
 * The data-source abstraction.
 *
 * Nothing outside this folder knows whether data came from Garmin's API, a FIT
 * file or the demo generator. Adding a new source means implementing this
 * interface and registering it — no other part of the application changes.
 */

import type { DateRange, ProviderData } from './types';

export interface GarminDataProvider {
  /** Stable identifier, matching the `source` value written to the database. */
  readonly id: 'garmin_api' | 'fit_upload' | 'demo';

  /** Name shown in the interface. */
  readonly label: string;

  /**
   * Whether this provider can actually be used right now. A provider that is
   * missing credentials returns false and explains itself via
   * {@link unavailableReason} — it must never quietly return invented data.
   */
  isConfigured(): boolean;

  /** Why the provider cannot be used, in plain language. Null when it can. */
  unavailableReason(): string | null;

  /** Fetch everything available in the given window. */
  fetch(range: DateRange): Promise<ProviderData>;
}

/**
 * Thrown when something asks a provider to do work it has not been configured
 * for. Callers catch this and surface the message rather than substituting data.
 */
export class ProviderNotConfiguredError extends Error {
  constructor(
    readonly providerId: string,
    message: string,
  ) {
    super(message);
    this.name = 'ProviderNotConfiguredError';
  }
}
