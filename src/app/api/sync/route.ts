import { NextResponse } from 'next/server';
import { env, isGarminConfigured } from '@/lib/env';
import { syncPipeline } from '@/garmin/syncPipeline';
import { DemoSyncProvider } from '@/garmin/providers/DemoSyncProvider';
import { GarminProvider } from '@/garmin/providers/GarminProvider';

/**
 * Runs the sync pipeline.
 *
 * The real Garmin connector is used when it has been configured; otherwise, in
 * demo mode, the simulated provider stands in — and the response says clearly
 * which one ran, so a simulated sync is never mistaken for a real one.
 */
export async function POST() {
  try {
    const useGarmin = isGarminConfigured();

    if (!useGarmin && !env.demoMode) {
      return NextResponse.json(
        {
          ok: false,
          error:
            'No data source is available. Configure the Garmin API in your .env file, upload a FIT file, or switch on demo mode.',
        },
        { status: 400 },
      );
    }

    const provider = useGarmin ? new GarminProvider() : new DemoSyncProvider();
    const report = await syncPipeline(provider);

    return NextResponse.json({
      ok: report.status === 'success',
      simulated: !useGarmin,
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
