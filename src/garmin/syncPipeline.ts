/**
 * The sync pipeline.
 *
 * Every route into the application — a Garmin sync, a FIT upload, or the demo
 * simulation — runs through these same eight steps, so the training state is
 * always brought fully up to date rather than partially:
 *
 *   1. fetch data from the provider
 *   2. normalise and store it
 *   3. calculate metrics
 *   4. match activities to planned workouts
 *   5. evaluate the completed sessions
 *   6. update the training state
 *   7. evaluate whether the plan should adapt
 *   8. report what happened
 *
 * "Real time" here means what it sensibly can for a local application: the
 * moment new data arrives, everything downstream is recalculated. There is no
 * background polling and no streaming.
 *
 * The step-by-step report is returned and shown in the interface, so a sync is
 * never an opaque spinner.
 */

import { prisma, getUser } from '@/lib/db';
import { stringifyJSON } from '@/lib/json';
import { addDays, startOfDay } from '@/lib/dates';
import type { GarminDataProvider } from './provider';
import { ingestActivities, ingestHealth, ingestProfile } from './ingest';
import { matchActivities, findMissedWorkouts } from '@/training/workoutMatcher';
import { runAdaptation } from '@/training/adaptationService';
import { getActivePlan } from '@/training/planService';

export interface SyncStep {
  name: string;
  status: 'done' | 'skipped' | 'failed';
  detail: string;
}

export interface SyncReport {
  syncLogId: string;
  source: string;
  status: 'success' | 'failed';
  steps: SyncStep[];
  activitiesImported: number;
  healthRecordsImported: number;
  workoutsMatched: number;
  adaptationsMade: number;
  /** The adaptation decision, when a plan exists to adapt. */
  adaptationReason: string | null;
  finishedAt: Date;
}

/**
 * Run the full pipeline for one provider.
 *
 * @param provider  where the data comes from
 * @param days      how far back to look
 */
export async function syncPipeline(
  provider: GarminDataProvider,
  days = 84,
): Promise<SyncReport> {
  const steps: SyncStep[] = [];
  const startedAt = new Date();

  const log = await prisma.syncLog.create({
    data: { source: provider.id, status: 'running' },
  });

  const fail = async (message: string): Promise<SyncReport> => {
    steps.push({ name: 'Sync', status: 'failed', detail: message });
    await prisma.syncLog.update({
      where: { id: log.id },
      data: {
        status: 'failed',
        message,
        finishedAt: new Date(),
        steps: stringifyJSON(steps),
      },
    });
    return {
      syncLogId: log.id,
      source: provider.id,
      status: 'failed',
      steps,
      activitiesImported: 0,
      healthRecordsImported: 0,
      workoutsMatched: 0,
      adaptationsMade: 0,
      adaptationReason: null,
      finishedAt: new Date(),
    };
  };

  // --- Step 1: fetch -----------------------------------------------------
  if (!provider.isConfigured()) {
    return fail(provider.unavailableReason() ?? `${provider.label} is not configured.`);
  }

  const end = new Date();
  const start = addDays(startOfDay(end), -days);

  let data;
  try {
    data = await provider.fetch({ start, end });
    steps.push({
      name: 'Retrieve data',
      status: 'done',
      detail: `${data.activities.length} activities and ${data.health.length} daily health records from ${provider.label}.`,
    });
  } catch (error) {
    return fail(
      error instanceof Error ? error.message : `${provider.label} could not be reached.`,
    );
  }

  // --- Step 2: normalise and store ---------------------------------------
  const user = data.profile
    ? await ingestProfile((await getUser()).id, data.profile)
    : await getUser();

  const { created, updated } = await ingestActivities(user.id, data.activities, {
    maxHR: user.maxHR,
    restingHR: user.restingHR,
    sex: user.sex,
  });

  const healthWritten = await ingestHealth(user.id, data.health);

  steps.push({
    name: 'Normalise and store',
    status: 'done',
    detail: `${created} new activities, ${updated} updated, ${healthWritten} health records written.`,
  });

  // --- Step 3: calculate metrics -----------------------------------------
  // Training load is computed during ingest, so every stored activity already
  // carries it. This step reports the outcome rather than repeating the work.
  const withLoad = await prisma.activity.count({
    where: { userId: user.id, trainingLoad: { not: null } },
  });
  const total = await prisma.activity.count({ where: { userId: user.id } });
  steps.push({
    name: 'Calculate metrics',
    status: 'done',
    detail: `Training load calculated for ${withLoad} of ${total} activities. The remainder lack both heart-rate and pace data.`,
  });

  // --- Steps 4-7 need a plan ---------------------------------------------
  const active = await getActivePlan(user.id);

  if (!active) {
    steps.push({
      name: 'Match planned workouts',
      status: 'skipped',
      detail: 'No training plan exists yet, so there is nothing to match against.',
    });
    steps.push({
      name: 'Evaluate the plan',
      status: 'skipped',
      detail: 'Set a training goal to have completed sessions evaluated against a plan.',
    });

    await prisma.syncLog.update({
      where: { id: log.id },
      data: {
        status: 'success',
        finishedAt: new Date(),
        steps: stringifyJSON(steps),
        activitiesImported: created,
        healthRecordsImported: healthWritten,
      },
    });

    return {
      syncLogId: log.id,
      source: provider.id,
      status: 'success',
      steps,
      activitiesImported: created,
      healthRecordsImported: healthWritten,
      workoutsMatched: 0,
      adaptationsMade: 0,
      adaptationReason: null,
      finishedAt: new Date(),
    };
  }

  // --- Step 4: match activities to planned workouts ----------------------
  const planWorkouts = await prisma.plannedWorkout.findMany({
    where: { planId: active.plan.id },
    orderBy: { date: 'asc' },
  });

  const recentActivities = await prisma.activity.findMany({
    where: { userId: user.id, date: { gte: addDays(startOfDay(end), -days) } },
    orderBy: { date: 'asc' },
    select: { id: true, date: true, sport: true, distance: true, duration: true, title: true },
  });

  // Activities already linked to a session are left alone.
  const linkedIds = new Set(
    planWorkouts.map((w) => w.linkedActivityId).filter((id): id is string => id !== null),
  );

  const { matches } = matchActivities(
    recentActivities.filter((a) => !linkedIds.has(a.id)),
    planWorkouts,
  );

  for (const match of matches) {
    await prisma.plannedWorkout.update({
      where: { id: match.workoutId },
      data: { completionStatus: 'completed', linkedActivityId: match.activityId },
    });
  }

  steps.push({
    name: 'Match planned workouts',
    status: 'done',
    detail:
      matches.length > 0
        ? `${matches.length} completed ${matches.length === 1 ? 'session was' : 'sessions were'} matched to your plan.`
        : 'No new activities matched a planned session.',
  });

  // --- Step 5-6: evaluate and update the training state -------------------
  const missed = findMissedWorkouts(
    await prisma.plannedWorkout.findMany({ where: { planId: active.plan.id } }),
    end,
  );

  for (const workout of missed) {
    await prisma.plannedWorkout.update({
      where: { id: workout.id },
      data: { completionStatus: 'missed' },
    });
  }

  steps.push({
    name: 'Update training state',
    status: 'done',
    detail:
      missed.length > 0
        ? `${missed.length} planned ${missed.length === 1 ? 'session was' : 'sessions were'} marked as missed.`
        : 'Every planned session to date is accounted for.',
  });

  // --- Step 7: consider adapting the plan ---------------------------------
  const decision = await runAdaptation(user.id, active.plan.id, end);

  steps.push({
    name: 'Evaluate the plan',
    status: 'done',
    detail:
      decision.changes.length > 0
        ? `${decision.changes.length} upcoming ${
            decision.changes.length === 1 ? 'session was' : 'sessions were'
          } adjusted. ${decision.reason}`
        : decision.reason,
  });

  // --- Step 8: report -----------------------------------------------------
  const finishedAt = new Date();
  await prisma.syncLog.update({
    where: { id: log.id },
    data: {
      status: 'success',
      finishedAt,
      steps: stringifyJSON(steps),
      activitiesImported: created,
      healthRecordsImported: healthWritten,
      workoutsMatched: matches.length,
      adaptationsMade: decision.changes.length,
      message: decision.reason,
    },
  });

  return {
    syncLogId: log.id,
    source: provider.id,
    status: 'success',
    steps,
    activitiesImported: created,
    healthRecordsImported: healthWritten,
    workoutsMatched: matches.length,
    adaptationsMade: decision.changes.length,
    adaptationReason: decision.reason,
    finishedAt,
  };
}

/** The most recent sync, for the "last synced" display. */
export async function getLastSync() {
  return prisma.syncLog.findFirst({
    where: { status: { not: 'running' } },
    orderBy: { startedAt: 'desc' },
  });
}

/** Elapsed time since a sync started, in words. */
export function describeSyncAge(date: Date | null): string {
  if (!date) return 'Never synced';
  const minutes = Math.floor((Date.now() - date.getTime()) / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}
