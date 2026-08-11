import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { resetDatabase } from '@/demo/load';

/**
 * Restore a previously exported file.
 *
 * This replaces everything currently stored — a partial merge would silently
 * produce a database that is half one athlete and half another. The interface
 * makes that consequence explicit before calling this.
 */
export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get('file');

    if (!(file instanceof File)) {
      return NextResponse.json({ ok: false, error: 'No file was uploaded.' }, { status: 400 });
    }

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(await file.text());
    } catch {
      return NextResponse.json(
        { ok: false, error: 'That file is not valid JSON.' },
        { status: 400 },
      );
    }

    if (payload.formatVersion !== 1 || !payload.user) {
      return NextResponse.json(
        {
          ok: false,
          error:
            'That file was not produced by this application, or it uses a format this version does not understand.',
        },
        { status: 400 },
      );
    }

    // Replace rather than merge — see the note above.
    await resetDatabase();

    const rows = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

    // Order matters: every table below references the one before it.
    await prisma.user.create({ data: payload.user as never });
    await prisma.activity.createMany({ data: rows(payload.activities) as never });
    await prisma.activitySplit.createMany({ data: rows(payload.splits) as never });
    await prisma.dailyHealth.createMany({ data: rows(payload.health) as never });
    await prisma.trainingGoal.createMany({ data: rows(payload.goals) as never });
    await prisma.trainingPlan.createMany({ data: rows(payload.plans) as never });
    await prisma.plannedWorkout.createMany({ data: rows(payload.workouts) as never });
    await prisma.trainingAdaptation.createMany({ data: rows(payload.adaptations) as never });

    return NextResponse.json({
      ok: true,
      activities: rows(payload.activities).length,
      healthRecords: rows(payload.health).length,
    });
  } catch (error) {
    console.error('Import failed:', error);
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? `The import failed: ${error.message}`
            : 'The import failed.',
      },
      { status: 500 },
    );
  }
}
