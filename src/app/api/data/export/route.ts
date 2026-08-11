import { NextResponse } from 'next/server';
import { prisma, findUser } from '@/lib/db';

/**
 * Export everything as a single JSON file.
 *
 * The point is that your data stays yours: this is a complete, readable copy of
 * what the application holds, which you can archive or move to another machine.
 */
export async function GET() {
  const user = await findUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: 'There is no data to export.' }, { status: 404 });
  }

  const [activities, splits, health, goals, plans, workouts, adaptations] = await Promise.all([
    prisma.activity.findMany({ where: { userId: user.id }, orderBy: { date: 'asc' } }),
    prisma.activitySplit.findMany(),
    prisma.dailyHealth.findMany({ where: { userId: user.id }, orderBy: { date: 'asc' } }),
    prisma.trainingGoal.findMany({ where: { userId: user.id } }),
    prisma.trainingPlan.findMany(),
    prisma.plannedWorkout.findMany({ orderBy: { date: 'asc' } }),
    prisma.trainingAdaptation.findMany({ orderBy: { timestamp: 'asc' } }),
  ]);

  const payload = {
    formatVersion: 1,
    exportedAt: new Date().toISOString(),
    user,
    activities,
    splits,
    health,
    goals,
    plans,
    workouts,
    adaptations,
  };

  const filename = `garmin-ai-coach-${new Date().toISOString().slice(0, 10)}.json`;

  return new NextResponse(JSON.stringify(payload, null, 2), {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
