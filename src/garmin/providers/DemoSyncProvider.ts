import { env } from '@/lib/env';
import { prisma } from '@/lib/db';
import { startOfDay, addDays } from '@/lib/dates';
import { generateDemoSyncActivity } from '@/demo/generator';
import type { GarminDataProvider } from '../provider';
import type { DateRange, NormalizedActivity, ProviderData } from '../types';

/**
 * Simulates new data arriving from a watch, for demo mode.
 *
 * This exists so the complete loop — finish a session, have it matched to the
 * plan, see the plan react — can be demonstrated without waiting a week for real
 * training to happen.
 *
 * It is honest about what it is: everything it produces is stored with
 * `source: "demo"` and labelled as demo data in the interface. It is never
 * presented as data that came from Garmin, and it is only ever reachable when
 * DEMO_MODE is on.
 */
export class DemoSyncProvider implements GarminDataProvider {
  readonly id = 'demo' as const;
  readonly label = 'Demo athlete (simulated sync)';

  isConfigured(): boolean {
    return env.demoMode;
  }

  unavailableReason(): string | null {
    return this.isConfigured()
      ? null
      : 'Demo mode is switched off. Set DEMO_MODE="true" in your .env file to simulate a sync.';
  }

  /**
   * Produce the next simulated session.
   *
   * It is dated to fill the earliest planned session that is due but has nothing
   * matched to it, so the sync has something meaningful to match. When there is
   * no such session — or no plan at all — it falls back to a run dated today.
   */
  async fetch(_range: DateRange): Promise<ProviderData> {
    // How many simulated sessions have already been produced, so each one gets a
    // distinct identifier and repeated syncs stay deterministic.
    const alreadySimulated = await prisma.activity.count({
      where: { source: 'demo', externalId: { startsWith: 'demo-run-1' } },
    });

    const today = startOfDay(new Date());

    const dueWorkout = await prisma.plannedWorkout.findFirst({
      where: {
        completionStatus: 'planned',
        linkedActivityId: null,
        workoutType: { not: 'REST' },
        date: { lte: addDays(today, 1), gte: addDays(today, -14) },
      },
      orderBy: { date: 'asc' },
    });

    const date = dueWorkout ? dueWorkout.date : today;
    const activity: NormalizedActivity = generateDemoSyncActivity(alreadySimulated, date);

    // Match the session to what the plan actually asked for, so the comparison
    // of planned against actual is meaningful rather than arbitrary.
    if (dueWorkout?.targetDistance) {
      const scale = dueWorkout.targetDistance / (activity.distance ?? dueWorkout.targetDistance);
      activity.distance = Math.round((activity.distance ?? 0) * scale);
      activity.duration = Math.round(activity.duration * scale);
      activity.avgPace = Math.round((activity.duration / activity.distance) * 1000);
      activity.avgSpeed = Number((activity.distance / activity.duration).toFixed(3));
      activity.title = titleFor(dueWorkout.workoutType);
    }

    return { activities: [activity], health: [] };
  }
}

function titleFor(workoutType: string): string {
  switch (workoutType) {
    case 'LONG_RUN':
      return 'Long Run';
    case 'INTERVAL':
      return 'Interval Session';
    case 'TEMPO':
      return 'Tempo Run';
    case 'RECOVERY':
      return 'Recovery Run';
    default:
      return 'Easy Run';
  }
}
