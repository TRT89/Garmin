/**
 * The bridge between the database and the analytics functions.
 *
 * The analytics modules are deliberately pure — they take plain objects and
 * return plain objects, which is what makes them testable and reusable by the
 * AI tool layer. This file is where database rows are turned into those plain
 * objects, and it is the only place in `analytics/` that touches Prisma.
 */

import { prisma } from '@/lib/db';
import { parseJSON, type ActivityRawData, type StreamPoint } from '@/lib/json';
import { addDays, startOfDay } from '@/lib/dates';
import type { ActivityLike } from './activityMetrics';
import type { FitnessActivity } from './runningFitness';
import type { HealthRecord } from './recovery';
import type { RecordActivity } from './personalRecords';

/** The columns every analytics function needs. Selected once, reused everywhere. */
const ACTIVITY_FIELDS = {
  id: true,
  externalId: true,
  date: true,
  sport: true,
  title: true,
  duration: true,
  distance: true,
  avgHR: true,
  maxHR: true,
  avgPace: true,
  avgSpeed: true,
  elevationGain: true,
  calories: true,
  cadence: true,
  averagePower: true,
  normalizedPower: true,
  aerobicTrainingEffect: true,
  anaerobicTrainingEffect: true,
  trainingLoad: true,
  trainingLoadMethod: true,
  source: true,
} as const;

export type ActivityRow = {
  [K in keyof typeof ACTIVITY_FIELDS]: K extends 'date'
    ? Date
    : K extends 'id' | 'externalId' | 'sport' | 'title' | 'source'
      ? string
      : K extends 'duration'
        ? number
        : K extends 'trainingLoadMethod'
          ? string | null
          : number | null;
};

/** Every activity for an athlete, newest last. */
export async function loadActivities(userId: string, since?: Date): Promise<ActivityRow[]> {
  return prisma.activity.findMany({
    where: { userId, ...(since ? { date: { gte: since } } : {}) },
    orderBy: { date: 'asc' },
    select: ACTIVITY_FIELDS,
  }) as Promise<ActivityRow[]>;
}

/** Daily health records for an athlete. */
export async function loadHealth(userId: string, since?: Date): Promise<HealthRecord[]> {
  const rows = await prisma.dailyHealth.findMany({
    where: { userId, ...(since ? { date: { gte: since } } : {}) },
    orderBy: { date: 'asc' },
    select: {
      date: true,
      restingHR: true,
      sleepDuration: true,
      sleepScore: true,
      stress: true,
      bodyBattery: true,
      steps: true,
    },
  });
  return rows;
}

/** The recorded sample stream for one activity, or an empty array. */
export async function loadStream(activityId: string): Promise<StreamPoint[]> {
  const row = await prisma.activity.findUnique({
    where: { id: activityId },
    select: { rawData: true },
  });
  if (!row) return [];
  return parseJSON<ActivityRawData>(row.rawData, {}).stream ?? [];
}

/**
 * Activities with their streams attached, for personal-record detection.
 *
 * Streams are large, so this is only used where it is genuinely needed and is
 * limited to running.
 */
export async function loadActivitiesWithStreams(
  userId: string,
  sport?: string,
): Promise<RecordActivity[]> {
  const rows = await prisma.activity.findMany({
    where: { userId, ...(sport ? { sport } : {}) },
    orderBy: { date: 'asc' },
    select: {
      id: true,
      date: true,
      sport: true,
      title: true,
      distance: true,
      duration: true,
      rawData: true,
    },
  });

  return rows.map((row) => ({
    id: row.id,
    date: row.date,
    sport: row.sport,
    title: row.title,
    distance: row.distance,
    duration: row.duration,
    stream: parseJSON<ActivityRawData>(row.rawData, {}).stream ?? [],
  }));
}

/** Convert a database row into the shape the comparison functions expect. */
export function toActivityLike(row: ActivityRow): ActivityLike {
  return {
    id: row.id,
    date: row.date,
    sport: row.sport,
    title: row.title,
    duration: row.duration,
    distance: row.distance,
    avgHR: row.avgHR,
    maxHR: row.maxHR,
    avgPace: row.avgPace,
    avgSpeed: row.avgSpeed,
    elevationGain: row.elevationGain,
    cadence: row.cadence,
    averagePower: row.averagePower,
    calories: row.calories,
    trainingLoad: row.trainingLoad,
  };
}

/** Convert a database row into the shape the fitness snapshot expects. */
export function toFitnessActivity(row: ActivityRow): FitnessActivity {
  return {
    id: row.id,
    date: row.date,
    sport: row.sport,
    title: row.title,
    duration: row.duration,
    distance: row.distance,
    avgHR: row.avgHR,
    avgPace: row.avgPace,
    trainingLoad: row.trainingLoad,
  };
}

/**
 * Everything the dashboard needs, loaded in one place.
 *
 * A dashboard that issued a query per card would be both slow and prone to
 * showing figures calculated over slightly different windows.
 */
export async function loadDashboardData(userId: string, asOf: Date = new Date()) {
  // A year of history covers every range the charts offer, plus the 28 days of
  // lead-in that the rolling load calculations need.
  const since = addDays(startOfDay(asOf), -400);

  const [activities, health] = await Promise.all([
    loadActivities(userId, since),
    loadHealth(userId, since),
  ]);

  return { activities, health };
}
