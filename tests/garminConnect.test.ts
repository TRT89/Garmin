import { describe, expect, it } from 'vitest';
import {
  mapConnectSport,
  normaliseConnectActivity,
  normaliseConnectHealth,
} from '@/garmin/providers/GarminConnectProvider';

/**
 * A realistic Garmin Connect activity summary.
 *
 * Field names and shapes follow the `IActivity` type published by the
 * `garmin-connect` package, so these tests pin the mapping without needing a
 * live account.
 */
const activity = (over: Record<string, unknown> = {}) => ({
  activityId: 987654321,
  activityName: 'Morning Run',
  activityType: { typeId: 1, typeKey: 'running' },
  startTimeLocal: '2026-08-11 06:30:00',
  startTimeGMT: '2026-08-11 04:30:00',
  distance: 10050,
  duration: 3120,
  movingDuration: 3000,
  elevationGain: 118,
  averageSpeed: 3.35,
  calories: 640,
  averageHR: 148,
  maxHR: 163,
  averageRunningCadenceInStepsPerMinute: 172,
  averageBikingCadenceInRevPerMinute: null,
  aerobicTrainingEffect: 3.4,
  anaerobicTrainingEffect: 0.6,
  normPower: null,
  ...over,
});

describe('mapConnectSport', () => {
  it('maps the sports the application supports', () => {
    expect(mapConnectSport('running')).toBe('running');
    expect(mapConnectSport('trail_running')).toBe('running');
    expect(mapConnectSport('cycling')).toBe('cycling');
    expect(mapConnectSport('road_biking')).toBe('cycling');
    expect(mapConnectSport('lap_swimming')).toBe('swimming');
  });

  it('falls back to "other" for anything else', () => {
    expect(mapConnectSport('strength_training')).toBe('other');
    expect(mapConnectSport(undefined)).toBe('other');
  });
});

describe('normaliseConnectActivity', () => {
  it('reads the core metrics', () => {
    const result = normaliseConnectActivity(activity());

    expect(result.externalId).toBe('987654321');
    expect(result.source).toBe('garmin_api');
    expect(result.sport).toBe('running');
    expect(result.title).toBe('Morning Run');
    expect(result.distance).toBe(10050);
    expect(result.avgHR).toBe(148);
    expect(result.maxHR).toBe(163);
    expect(result.elevationGain).toBe(118);
    expect(result.calories).toBe(640);
  });

  it('prefers moving time over elapsed time', () => {
    // 3120 s elapsed includes pauses; 3000 s moving is what a runner means.
    expect(normaliseConnectActivity(activity()).duration).toBe(3000);
  });

  it('falls back to elapsed time when moving time is absent', () => {
    expect(normaliseConnectActivity(activity({ movingDuration: null })).duration).toBe(3120);
  });

  it('derives pace so it always agrees with distance and time', () => {
    const result = normaliseConnectActivity(
      activity({ distance: 10000, movingDuration: 3000 }),
    );
    expect(result.avgPace).toBe(300); // 5:00/km
  });

  it('parses the local start time rather than GMT', () => {
    const result = normaliseConnectActivity(activity());
    expect(result.date.getHours()).toBe(6);
    expect(result.date.getDate()).toBe(11);
  });

  it('takes running cadence for a run', () => {
    expect(normaliseConnectActivity(activity()).cadence).toBe(172);
  });

  it('takes cycling cadence for a ride', () => {
    const result = normaliseConnectActivity(
      activity({
        activityType: { typeKey: 'road_biking' },
        averageBikingCadenceInRevPerMinute: 88,
        averageRunningCadenceInStepsPerMinute: null,
      }),
    );
    expect(result.cadence).toBe(88);
  });

  it('records null for metrics Garmin did not report', () => {
    const result = normaliseConnectActivity(
      activity({ averageHR: null, maxHR: null, normPower: null, elevationGain: undefined }),
    );

    expect(result.avgHR).toBeNull();
    expect(result.maxHR).toBeNull();
    expect(result.normalizedPower).toBeNull();
    expect(result.elevationGain).toBeNull();
  });

  it('carries through Garmin’s own Training Effect only when present', () => {
    expect(normaliseConnectActivity(activity()).aerobicTrainingEffect).toBe(3.4);
    expect(
      normaliseConnectActivity(activity({ aerobicTrainingEffect: null }))
        .aerobicTrainingEffect,
    ).toBeNull();
  });

  it('leaves splits and stream empty, for the FIT download to fill in', () => {
    const result = normaliseConnectActivity(activity());
    expect(result.splits).toEqual([]);
    expect(result.stream).toEqual([]);
  });

  it('keeps the original payload for transparency', () => {
    expect(normaliseConnectActivity(activity()).providerPayload).toBeDefined();
  });

  it('survives a payload missing almost everything', () => {
    const result = normaliseConnectActivity({ activityId: 1 });

    expect(result.duration).toBe(0);
    expect(result.distance).toBeNull();
    expect(result.avgPace).toBeNull();
    expect(result.sport).toBe('other');
  });
});

describe('normaliseConnectHealth', () => {
  const date = new Date(2026, 7, 11);

  const sleep = {
    dailySleepDTO: {
      sleepTimeSeconds: 26400, // 7h 20m
      sleepScores: { overall: { value: 78 } },
    },
  };

  it('converts sleep seconds into minutes', () => {
    const result = normaliseConnectHealth(date, sleep, { restingHeartRate: 47 }, 11200);

    expect(result.sleepDuration).toBe(440);
    expect(result.sleepScore).toBe(78);
    expect(result.restingHR).toBe(47);
    expect(result.steps).toBe(11200);
  });

  it('records stress and readiness as missing, because this route cannot read them', () => {
    const result = normaliseConnectHealth(date, sleep, { restingHeartRate: 47 }, 11200);

    expect(result.stress).toBeNull();
    expect(result.bodyBattery).toBeNull();
  });

  it('handles a day with no data at all', () => {
    const result = normaliseConnectHealth(date, null, null, null);

    expect(result.sleepDuration).toBeNull();
    expect(result.sleepScore).toBeNull();
    expect(result.restingHR).toBeNull();
    expect(result.steps).toBeNull();
  });

  it('handles sleep recorded without a score', () => {
    const result = normaliseConnectHealth(
      date,
      { dailySleepDTO: { sleepTimeSeconds: 25200 } },
      null,
      null,
    );

    expect(result.sleepDuration).toBe(420);
    expect(result.sleepScore).toBeNull();
  });

  it('marks the record as coming from Garmin', () => {
    expect(normaliseConnectHealth(date, sleep, null, null).source).toBe('garmin_api');
  });
});
