import { NextResponse } from 'next/server';
import { env, isGarminConfigured, isGarminConnectConfigured } from '@/lib/env';
import { syncPipeline } from '@/garmin/syncPipeline';
import { DemoSyncProvider } from '@/garmin/providers/DemoSyncProvider';
import { GarminProvider } from '@/garmin/providers/GarminProvider';
import { GarminConnectProvider } from '@/garmin/providers/GarminConnectProvider';

/**
 * Runs the sync pipeline against the best available source.
 *
 * The order is deliberate — the official, supported connection is preferred
 * whenever it is available, and the simulated demo sync is only ever the last
 * resort. The response always says which one actually ran, so a simulated sync
 * can never be mistaken for real data.
 */
export async function POST() {
  try {
    const official = isGarminConfigured();
    const connect = isGarminConnectConfigured();

    if (!official && !connect && !env.demoMode) {
      return NextResponse.json(
        {
          ok: false,
          error:
            'No data source is available. Add your Garmin Connect sign-in to .env, configure the official Garmin API, upload a FIT file, or switch on demo mode.',
        },
        { status: 400 },
      );
    }

    const garminConnect = connect ? new GarminConnectProvider() : null;

    const provider = official
      ? new GarminProvider()
      : (garminConnect ?? new DemoSyncProvider());

    const report = await syncPipeline(provider);

    return NextResponse.json({
      ok: report.status === 'success',
      simulated: !official && !connect,
      // Named plainly so the interface can be honest about the route taken.
      connection: official ? 'garmin_official' : connect ? 'garmin_connect' : 'demo',
      warnings: garminConnect?.warnings ?? [],
      ...report,
    });
  } catch (error) {
    console.error('Sync failed:', error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'The sync failed.' },
      { status: 500 },
    );
  }
}
