/**
 * Persistence for normalised provider data.
 *
 * This is the single doorway through which every activity and health record
 * enters the database, whatever produced it. Two things happen here and nowhere
 * else:
 *
 *  - **Deduplication.** Activities are keyed on `(externalId, source)`, so
 *    syncing the same period twice updates rather than duplicates.
 *  - **Load calculation.** Our own training-load figure is computed on the way
 *    in, so every stored activity carries it and the analytics never have to
 *    recompute it from scratch.
 */

import { prisma } from '@/lib/db';
import { stringifyJSON } from '@/lib/json';
import { startOfDay } from '@/lib/dates';
import { calculateSessionLoad } from '@/analytics/trainingLoad';
import type { NormalizedActivity, NormalizedHealth, NormalizedProfile } from './types';

export interface IngestResult {
  activitiesCreated: number;
  activitiesUpdated: number;
  healthRecordsWritten: number;
}

/** Create or update the athlete profile from a provider that supplies one. */
export async function ingestProfile(userId: string, profile: NormalizedProfile) {
  return prisma.user.update({
    where: { id: userId },
    data: {
      name: profile.name,
      age: profile.age,
      sex: profile.sex,
      height: profile.height,
      weight: profile.weight,
      maxHR: profile.maxHR,
      restingHR: profile.restingHR,
    },
  });
}

/**
 * Write activities to the database.
 *
 * Returns counts rather than the rows themselves — callers that need the data
 * back read it through the analytics layer.
 */
export async function ingestActivities(
  userId: string,
  activities: NormalizedActivity[],
  athlete: { maxHR: number | null; restingHR: number | null; sex: string | null },
): Promise<{ created: number; updated: number }> {
  let created = 0;
  let updated = 0;

  for (const activity of activities) {
    // Our transparent training-load figure, calculated once on the way in.
    const load = calculateSessionLoad(
      {
        duration: activity.duration,
        avgHR: activity.avgHR,
        distance: activity.distance,
        avgPace: activity.avgPace,
        sport: activity.sport,
      },
      athlete,
    );

    const rawData = stringifyJSON({
      stream: activity.stream,
      provider: activity.providerPayload,
      notes: activity.notes,
    });

    const data = {
      userId,
      date: activity.date,
      sport: activity.sport,
      title: activity.title,
      duration: activity.duration,
      distance: activity.distance,
      avgHR: activity.avgHR,
      maxHR: activity.maxHR,
      avgPace: activity.avgPace,
      avgSpeed: activity.avgSpeed,
      elevationGain: activity.elevationGain,
      calories: activity.calories,
      cadence: activity.cadence,
      averagePower: activity.averagePower,
      normalizedPower: activity.normalizedPower,
      aerobicTrainingEffect: activity.aerobicTrainingEffect,
      anaerobicTrainingEffect: activity.anaerobicTrainingEffect,
      trainingLoad: load.value,
      trainingLoadMethod: load.method,
      rawData,
    };

    const existing = await prisma.activity.findUnique({
      where: {
        externalId_source: { externalId: activity.externalId, source: activity.source },
      },
      select: { id: true },
    });

    if (existing) {
      await prisma.activity.update({ where: { id: existing.id }, data });
      // Splits are replaced wholesale: the source is authoritative.
      await prisma.activitySplit.deleteMany({ where: { activityId: existing.id } });
      if (activity.splits.length > 0) {
        await prisma.activitySplit.createMany({
          data: activity.splits.map((s) => ({ ...s, activityId: existing.id })),
        });
      }
      updated++;
    } else {
      const row = await prisma.activity.create({
        data: { ...data, externalId: activity.externalId, source: activity.source },
        select: { id: true },
      });
      if (activity.splits.length > 0) {
        await prisma.activitySplit.createMany({
          data: activity.splits.map((s) => ({ ...s, activityId: row.id })),
        });
      }
      created++;
    }
  }

  return { created, updated };
}

/** Write daily health records, one row per day, replacing any existing day. */
export async function ingestHealth(
  userId: string,
  records: NormalizedHealth[],
): Promise<number> {
  let written = 0;

  for (const record of records) {
    const date = startOfDay(record.date);
    const data = {
      restingHR: record.restingHR,
      avgHR: record.avgHR,
      sleepDuration: record.sleepDuration,
      sleepScore: record.sleepScore,
      stress: record.stress,
      bodyBattery: record.bodyBattery,
      steps: record.steps,
      weight: record.weight,
      source: record.source,
    };

    await prisma.dailyHealth.upsert({
      where: { userId_date: { userId, date } },
      create: { userId, date, ...data },
      update: data,
    });
    written++;
  }

  return written;
}
