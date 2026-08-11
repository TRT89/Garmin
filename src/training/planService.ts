/**
 * Turning a goal into a stored training plan.
 *
 * This is the only place that writes plans. It gathers the athlete's current
 * fitness from the analytics layer, hands it to the deterministic generator, and
 * persists the result — including a permanent, untouched copy of the original so
 * "what did my plan originally say?" is always answerable.
 */

import { prisma } from '@/lib/db';
import { stringifyJSON } from '@/lib/json';
import { addDays, startOfWeek } from '@/lib/dates';
import { GOAL_DISTANCES, type GoalType } from '@/lib/constants';
import { loadActivities, toFitnessActivity } from '@/analytics/queries';
import { buildFitnessSnapshot, type FitnessSnapshot } from '@/analytics/runningFitness';
import { generatePlan, type GeneratedPlan, type PlanInput } from './planGenerator';

export interface CreateGoalInput {
  sport: string;
  goalType: GoalType;
  eventName: string;
  targetDate: Date;
  targetDistance: number | null;
  targetTime: number | null;
  trainingWeeks: number;
  sessionsPerWeek: number;
  longRunDay: number;
}

/**
 * Assemble the generator's inputs from the athlete's actual training history.
 *
 * Returns the snapshot alongside the input so the interface can show the athlete
 * exactly what the plan was based on.
 */
export async function buildPlanInput(
  userId: string,
  goal: CreateGoalInput,
  startDate: Date,
): Promise<{ input: PlanInput; snapshot: FitnessSnapshot }> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });

  // Twelve weeks of history is the window the fitness snapshot uses.
  const since = addDays(startDate, -84);
  const activities = await loadActivities(userId, since);
  const snapshot = buildFitnessSnapshot(activities.map(toFitnessActivity), startDate, 12);

  const input: PlanInput = {
    goalType: goal.goalType,
    goalDistance: goal.targetDistance ?? GOAL_DISTANCES[goal.goalType],
    goalTime: goal.targetTime,
    startDate,
    trainingWeeks: goal.trainingWeeks,
    sessionsPerWeek: goal.sessionsPerWeek,
    longRunDay: goal.longRunDay,
    currentWeeklyDistance: snapshot.avgWeeklyDistance,
    longestRecentRun: snapshot.longestRun,
    estimatedThresholdPace: snapshot.thresholdPace,
    observedEasyPace:
      snapshot.easyPaceMin != null && snapshot.easyPaceMax != null
        ? Math.round((snapshot.easyPaceMin + snapshot.easyPaceMax) / 2)
        : null,
    maxHR: user.maxHR,
    restingHR: user.restingHR,
  };

  return { input, snapshot };
}

/**
 * Create a goal and generate its plan.
 *
 * Any previously active goal is stood down first — the athlete has one goal at a
 * time, and leaving two active would make "what should I do today?" ambiguous.
 */
export async function createGoalWithPlan(userId: string, goal: CreateGoalInput) {
  await prisma.trainingGoal.updateMany({
    where: { userId, isActive: true },
    data: { isActive: false },
  });

  const created = await prisma.trainingGoal.create({
    data: {
      userId,
      sport: goal.sport,
      goalType: goal.goalType,
      eventName: goal.eventName,
      targetDate: goal.targetDate,
      targetDistance: goal.targetDistance,
      targetTime: goal.targetTime,
      trainingWeeks: goal.trainingWeeks,
      sessionsPerWeek: goal.sessionsPerWeek,
      longRunDay: goal.longRunDay,
      isActive: true,
    },
  });

  const plan = await generateAndStorePlan(userId, created.id, goal);
  return { goal: created, plan };
}

/**
 * Generate a plan for a goal and store it.
 *
 * The plan is counted back from the event date, so the final week of training is
 * race week. If that would start in the past, it starts this week instead.
 */
export async function generateAndStorePlan(
  userId: string,
  goalId: string,
  goal: CreateGoalInput,
) {
  const countBack = startOfWeek(addDays(goal.targetDate, -(goal.trainingWeeks - 1) * 7));
  const thisWeek = startOfWeek(new Date());
  const startDate = countBack.getTime() < thisWeek.getTime() ? thisWeek : countBack;

  const { input, snapshot } = await buildPlanInput(userId, goal, startDate);
  const generated = generatePlan(input);

  return storePlan(goalId, generated, snapshot);
}

/**
 * Write a generated plan to the database.
 *
 * Two rows are written: the working plan the athlete follows, and an immutable
 * copy marked `isOriginal`. The adaptation engine only ever touches the working
 * plan, so the original stays available for comparison for the life of the goal.
 */
export async function storePlan(
  goalId: string,
  generated: GeneratedPlan,
  snapshot: FitnessSnapshot,
) {
  // Any earlier plans for this goal are superseded rather than deleted, so the
  // history remains inspectable.
  await prisma.trainingPlan.updateMany({
    where: { goalId, status: 'active' },
    data: { status: 'superseded' },
  });

  const generatorInput = stringifyJSON({
    input: generated.input,
    snapshot,
    notes: generated.notes,
    zones: generated.zones,
  });

  const workoutRows = generated.weeks.flatMap((week) =>
    week.workouts.map((workout) => ({
      date: workout.date,
      weekNumber: workout.weekNumber,
      phase: workout.phase,
      sport: workout.sport,
      workoutType: workout.workoutType,
      description: workout.description,
      targetDuration: workout.targetDuration,
      targetDistance: workout.targetDistance,
      targetPaceMin: workout.targetPaceMin,
      targetPaceMax: workout.targetPaceMax,
      targetHRMin: workout.targetHRMin,
      targetHRMax: workout.targetHRMax,
      structureJSON: stringifyJSON(workout.structure),
      explanation: workout.explanation,
    })),
  );

  // The working plan.
  const plan = await prisma.trainingPlan.create({
    data: {
      goalId,
      startDate: generated.startDate,
      endDate: generated.endDate,
      status: 'active',
      version: 1,
      isOriginal: false,
      generatorInput,
      workouts: { create: workoutRows },
    },
  });

  // The permanent record of what was first prescribed.
  await prisma.trainingPlan.create({
    data: {
      goalId,
      startDate: generated.startDate,
      endDate: generated.endDate,
      status: 'superseded',
      version: 0,
      isOriginal: true,
      generatorInput,
      workouts: { create: workoutRows },
    },
  });

  return plan;
}

/** The athlete's current goal and its working plan, or null if there is none. */
export async function getActivePlan(userId: string) {
  const goal = await prisma.trainingGoal.findFirst({
    where: { userId, isActive: true },
    orderBy: { createdAt: 'desc' },
  });
  if (!goal) return null;

  const plan = await prisma.trainingPlan.findFirst({
    where: { goalId: goal.id, status: 'active' },
    orderBy: { createdAt: 'desc' },
    include: {
      workouts: {
        orderBy: { date: 'asc' },
        include: { linkedActivity: true },
      },
    },
  });
  if (!plan) return null;

  return { goal, plan };
}

/** The untouched original plan for a goal, for "what changed?" comparisons. */
export async function getOriginalPlan(goalId: string) {
  return prisma.trainingPlan.findFirst({
    where: { goalId, isOriginal: true },
    include: { workouts: { orderBy: { date: 'asc' } } },
  });
}
