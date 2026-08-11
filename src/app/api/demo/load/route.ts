import { NextResponse } from 'next/server';
import { loadDemoAthlete } from '@/demo/load';
import { ProviderNotConfiguredError } from '@/garmin/provider';

/**
 * Populates the database with the demo athlete.
 *
 * Safe to call repeatedly — the ingest layer keys on the activity identifier, so
 * a second call updates rather than duplicates.
 */
export async function POST() {
  try {
    const result = await loadDemoAthlete();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof ProviderNotConfiguredError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    }
    console.error('Failed to load the demo athlete:', error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'The demo athlete could not be loaded.',
      },
      { status: 500 },
    );
  }
}
