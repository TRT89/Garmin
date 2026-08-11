/**
 * Typed access to the environment configuration.
 *
 * Nothing in here ever throws: a missing or malformed value falls back to a
 * safe default so the application always starts. Optional integrations (Garmin
 * API, Ollama) report themselves as "not configured" rather than breaking the
 * app — that is the whole point of the fallbacks described in the README.
 *
 * Secrets are only ever read on the server. Never import this from a component
 * marked `'use client'`.
 */

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  return value.toLowerCase() === 'true' || value === '1';
}

function str(value: string | undefined, fallback = ''): string {
  return value === undefined || value.trim() === '' ? fallback : value.trim();
}

export const env = {
  databaseUrl: str(process.env.DATABASE_URL, 'file:./dev.db'),

  /** Enables the demo athlete and the simulated sync. */
  demoMode: bool(process.env.DEMO_MODE, true),

  garmin: {
    enabled: bool(process.env.GARMIN_ENABLED, false),
    clientId: str(process.env.GARMIN_CLIENT_ID),
    clientSecret: str(process.env.GARMIN_CLIENT_SECRET),
    redirectUri: str(
      process.env.GARMIN_REDIRECT_URI,
      'http://localhost:3000/api/garmin/callback',
    ),
  },

  ollama: {
    baseUrl: str(process.env.OLLAMA_BASE_URL, 'http://localhost:11434'),
    model: str(process.env.OLLAMA_MODEL, 'llama3.1:8b'),
  },
} as const;

/**
 * True only when every credential the Garmin connector needs is present *and*
 * the connector has been explicitly switched on. Without all of this the
 * connector stays disabled and the UI says so plainly — it never falls back to
 * invented data.
 */
export function isGarminConfigured(): boolean {
  return Boolean(env.garmin.enabled && env.garmin.clientId && env.garmin.clientSecret);
}

/** A human-readable explanation of why the Garmin connector is unavailable. */
export function garminDisabledReason(): string | null {
  if (isGarminConfigured()) return null;
  if (!env.garmin.enabled) {
    return 'The Garmin Connect API connector is switched off. Set GARMIN_ENABLED="true" in your .env file once you have been approved for the Garmin Connect Developer Program.';
  }
  if (!env.garmin.clientId || !env.garmin.clientSecret) {
    return 'GARMIN_CLIENT_ID and GARMIN_CLIENT_SECRET are missing from your .env file. Garmin issues these after approving your application for the Garmin Connect Developer Program.';
  }
  return 'The Garmin Connect API connector is not configured.';
}
