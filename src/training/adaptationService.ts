/**
 * Applying adaptation decisions and recording the audit trail.
 *
 * The engine decides; this file writes. Every change produces a
 * `TrainingAdaptation` row holding the workout before and after, the sentence
 * shown to the athlete, and the exact metric values behind the decision — so
 * "why did my plan change?" can always be answered from stored data rather than
 * regenerated after the fact.
 */

import { prisma } from '@/lib/db';
import { parseJSON, stringifyJSON, type WorkoutStep } from '@/lib/json';
import { addDays } from '@/lib/dates';
import { loadActivities, loadHealth, toActivityLike } from '@/analytics/queries';
import { assessRecovery } from '@/analytics/recovery';
import { summariseLoad } from '@/analytics/trainingLoad';
import { planCompliance } from '@/analytics/compliance';
import {
  decideAdaptation,
  type AdaptationContext,
  type AdaptationDecision,
  type ExecutedWorkout,
  type UpcomingWorkout,
} from './adaptationEngine';

/**
 * Build the engine's input from stored data.
 *
 * Everything the engine sees comes from the database and the analytics layer —
 * it never reaches for anything itself, which is what keeps it a pure function.
 */
export async function buildAdaptationContext(
  userId: string,
  planId: string,
  asOf: Date = new Date(),
): Promise<AdaptationContext> {
  const [activities, health, workouts] = await Promise.all([
    loadActivities(userId, addDays(asOf, -60)),
    loadHealth(userId, addDays(asOf, -40)),
    prisma.plannedWorkout.findMany({
      where: { planId },
      orderBy: { date: 'asc' },
      include: { linkedActivity: true },
    }),
  ]);

  const recovery = assessRecovery(health, asOf);
  const load = summariseLoad(activities, asOf);

  // How the recently completed sessions actually went.
  const completed = workouts
    .filter((w) => w.completionStatus === 'completed' && w.linkedActivity)
    .filter((w) => w.date >= addDays(asOf, -21))
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  const executed: ExecutedWorkout[] = completed.map((workout) => {
    const linked = workout.linkedActivity!;

    // The comparison baseline: similar recent sessions of the same sport.
    const peers = activities
      .map(toActivityLike)
      .filter(
        (a) =>
          a.sport === linked.sport &&
          a.id !== linked.id &&
          a.date < linked.date &&
          a.date >= addDays(linked.date, -42) &&
          a.avgHR != null &&
          a.distance != null &&
          linked.distance != null &&
          a.distance / linked.distance >= 0.75 &&
          a.distance / linked.distance <= 1.33,
      );

    const comparableHR =
      peers.length >= 2
        ? Math.round(peers.reduce((sum, p) => sum + (p.avgHR ?? 0), 0) / peers.length)
        : null;

    return {
      workoutId: workout.id,
      date: workout.date,
      workoutType: workout.workoutType,
      targetDistance: workout.targetDistance,
      targetPaceMin: workout.targetPaceMin,
      targetPaceMax: workout.targetPaceMax,
      actualDistance: linked.distance,
      actualPace: linked.avgPace,
      actualHR: linked.avgHR,
      comparableHR,
    };
  });

  // Compliance over the two most recent weeks that have happened.
  const allCompliance = planCompliance(
    workouts.filter((w) => w.date <= asOf),
  );
  const recentCompliance = allCompliance.slice(-2);

  // When was each upcoming session last changed automatically?
  const adaptations = await prisma.trainingAdaptation.findMany({
    where: { planId, revertedAt: null },
    orderBy: { timestamp: 'desc' },
    select: { affectedWorkoutId: true, timestamp: true },
  });
  const lastAdapted = new Map<string, Date>();
  for (const record of adaptations) {
    if (record.affectedWorkoutId && !lastAdapted.has(record.affectedWorkoutId)) {
      lastAdapted.set(record.affectedWorkoutId, record.timestamp);
    }
  }

  const upcoming: UpcomingWorkout[] = workouts
    .filter((w) => w.date > asOf && w.completionStatus === 'planned')
    .map((w) => ({
      id: w.id,
      date: w.date,
      weekNumber: w.weekNumber,
      workoutType: w.workoutType,
      description: w.description,
      targetDistance: w.targetDistance,
      targetPaceMin: w.targetPaceMin,
      targetPaceMax: w.targetPaceMax,
      structure: parseJSON<WorkoutStep[]>(w.structureJSON, []),
      userModified: w.userModified,
      lastAdaptedAt: lastAdapted.get(w.id) ?? null,
    }));

  return { recovery, load, executed, recentCompliance, upcoming, asOf };
}

/**
 * Run the engine and apply whatever it decides.
 *
 * A `KEEP_PLAN` outcome is still recorded, so the audit trail shows that the
 * plan was reviewed and deliberately left alone rather than simply ignored.
 */
export async function runAdaptation(
  userId: string,
  planId: string,
  asOf: Date = new Date(),
): Promise<AdaptationDecision> {
  const context = await buildAdaptationContext(userId, planId, asOf);
  const decision = decideAdaptation(context);

  const metricsUsed = stringifyJSON({
    indicators: decision.indicators,
    recovery: {
      status: context.recovery.status,
      restingHR: context.recovery.restingHR,
      sleepDuration: context.recovery.sleepDuration,
      bodyBattery: context.recovery.bodyBattery,
    },
    load: context.load,
    compliance: context.recentCompliance,
    sessionsConsidered: context.executed.length,
  });

  if (decision.changes.length === 0) {
    await prisma.trainingAdaptation.create({
      data: {
        planId,
        outcome: decision.outcome,
        reason: decision.reason,
        metricsUsed,
      },
    });
    return decision;
  }

  for (const change of decision.changes) {
    await prisma.plannedWorkout.update({
      where: { id: change.workoutId },
      data: {
        workoutType: change.after.workoutType,
        description: change.after.description,
        targetDistance: change.after.targetDistance,
        structureJSON: stringifyJSON(change.after.structure),
        adaptationReason: decision.reason,
      },
    });

    await prisma.trainingAdaptation.create({
      data: {
        planId,
        affectedWorkoutId: change.workoutId,
        outcome: decision.outcome,
        previousWorkout: stringifyJSON(change.before),
        updatedWorkout: stringifyJSON(change.after),
        reason: decision.reason,
        metricsUsed,
      },
    });
  }

  return decision;
}

/**
 * Undo an adaptation, restoring the session to what it was before.
 *
 * The audit record is kept and marked as reverted rather than deleted — the
 * history of what the system did should not disappear.
 */
export async function revertAdaptation(adaptationId: string) {
  const record = await prisma.trainingAdaptation.findUnique({
    where: { id: adaptationId },
  });
  if (!record?.affectedWorkoutId || !record.previousWorkout) return null;

  const before = parseJSON<{
    workoutType: string;
    description: string;
    targetDistance: number | null;
    structure: WorkoutStep[];
  } | null>(record.previousWorkout, null);
  if (!before) return null;

  await prisma.plannedWorkout.update({
    where: { id: record.affectedWorkoutId },
    data: {
      workoutType: before.workoutType,
      description: before.description,
      targetDistance: before.targetDistance,
      structureJSON: stringifyJSON(before.structure),
      adaptationReason: null,
      // The athlete has taken control, so automation leaves this session alone.
      userModified: true,
    },
  });

  return prisma.trainingAdaptation.update({
    where: { id: adaptationId },
    data: { revertedAt: new Date() },
  });
}

/** The adaptation history for a plan, newest first. */
export async function getAdaptationHistory(planId: string) {
  return prisma.trainingAdaptation.findMany({
    where: { planId },
    orderBy: { timestamp: 'desc' },
    include: { affectedWorkout: true },
  });
}
