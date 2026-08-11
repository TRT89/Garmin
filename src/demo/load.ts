/**
 * Loading and clearing the demo athlete.
 *
 * Kept separate from the generator so the generator stays a pure function with
 * no database dependency, which is what lets the tests check it exhaustively.
 */

import { prisma, getUser } from '@/lib/db';
import { addDays, startOfDay } from '@/lib/dates';
import { ingestActivities, ingestHealth, ingestProfile } from '@/garmin/ingest';
import { DemoProvider } from '@/garmin/providers/DemoProvider';
import { ProviderNotConfiguredError } from '@/garmin/provider';

export interface DemoLoadResult {
  activitiesCreated: number;
  activitiesUpdated: number;
  healthRecords: number;
  athlete: string;
  from: Date;
  to: Date;
}

/**
 * Populate the database with the demo athlete's twelve weeks of history.
 *
 * Running this twice is safe: activities are keyed on their identifier and
 * source, so a second run updates the same rows rather than duplicating them.
 */
export async function loadDemoAthlete(weeks = 12): Promise<DemoLoadResult> {
  const provider = new DemoProvider();
  if (!provider.isConfigured()) {
    throw new ProviderNotConfiguredError('demo', provider.unavailableReason()!);
  }

  const end = new Date();
  const start = addDays(startOfDay(end), -(weeks * 7 - 1));

  const data = await provider.fetch({ start, end });

  // The profile has to be written first: the training-load calculation needs the
  // athlete's maximum and resting heart rates.
  const user = await getUser();
  const athlete = data.profile
    ? await ingestProfile(user.id, data.profile)
    : user;

  const { created, updated } = await ingestActivities(athlete.id, data.activities, {
    maxHR: athlete.maxHR,
    restingHR: athlete.restingHR,
    sex: athlete.sex,
  });

  const healthRecords = await ingestHealth(athlete.id, data.health);

  return {
    activitiesCreated: created,
    activitiesUpdated: updated,
    healthRecords,
    athlete: athlete.name,
    from: start,
    to: end,
  };
}

/**
 * Remove every demo record, leaving anything imported from a FIT file or the
 * Garmin API untouched.
 */
export async function clearDemoData(): Promise<{ activities: number; health: number }> {
  const activities = await prisma.activity.deleteMany({ where: { source: 'demo' } });
  const health = await prisma.dailyHealth.deleteMany({ where: { source: 'demo' } });
  return { activities: activities.count, health: health.count };
}

/**
 * Wipe everything and start again — the "Reset demo database" action.
 *
 * Deliberately thorough: goals, plans and the adaptation history go too, because
 * a plan built on data that no longer exists would be misleading.
 */
export async function resetDatabase(): Promise<void> {
  // Order matters only where a relation would block the delete; cascades handle
  // the rest.
  await prisma.trainingAdaptation.deleteMany();
  await prisma.plannedWorkout.deleteMany();
  await prisma.trainingPlan.deleteMany();
  await prisma.trainingGoal.deleteMany();
  await prisma.activitySplit.deleteMany();
  await prisma.activity.deleteMany();
  await prisma.dailyHealth.deleteMany();
  await prisma.chatMessage.deleteMany();
  await prisma.syncLog.deleteMany();
  await prisma.user.deleteMany();
}
