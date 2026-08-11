import { describe, expect, it } from 'vitest';
import { Encoder, Profile } from '@garmin/fitsdk';
import { FitProvider, mapFitSport, parseFitFile } from '@/garmin/providers/FitProvider';

/**
 * Builds a genuine FIT file with Garmin's own encoder, so these tests exercise
 * the real binary format rather than a hand-made stand-in.
 */
function encodeFit(options: {
  sport?: string;
  distance?: number;
  duration?: number;
  avgHeartRate?: number | null;
  avgCadence?: number | null;
  records?: number;
  laps?: number;
  avgPower?: number | null;
}): Uint8Array {
  const {
    sport = 'running',
    distance = 10000,
    duration = 3000,
    avgHeartRate = 148,
    avgCadence = 85,
    records = 200,
    laps = 10,
    avgPower = null,
  } = options;

  const start = new Date('2026-06-15T06:30:00Z');
  const encoder = new Encoder();

  encoder.onMesg(Profile.MesgNum.FILE_ID, {
    type: 'activity',
    manufacturer: 'garmin',
    timeCreated: start,
  });

  // Per-second-ish samples at a constant speed.
  const speed = distance / duration;
  for (let i = 0; i < records; i++) {
    const elapsed = Math.round((i / records) * duration);
    encoder.onMesg(Profile.MesgNum.RECORD, {
      timestamp: new Date(start.getTime() + elapsed * 1000),
      distance: speed * elapsed,
      speed,
      heartRate: avgHeartRate ?? undefined,
      cadence: avgCadence ?? undefined,
      altitude: 100 + Math.sin(i / 10) * 20,
      power: avgPower ?? undefined,
    });
  }

  for (let i = 0; i < laps; i++) {
    encoder.onMesg(Profile.MesgNum.LAP, {
      timestamp: new Date(start.getTime() + ((i + 1) * duration * 1000) / laps),
      startTime: new Date(start.getTime() + (i * duration * 1000) / laps),
      totalDistance: distance / laps,
      totalTimerTime: duration / laps,
      totalElapsedTime: duration / laps,
      avgHeartRate: avgHeartRate ?? undefined,
      totalAscent: 12,
      totalDescent: 8,
    });
  }

  encoder.onMesg(Profile.MesgNum.SESSION, {
    timestamp: new Date(start.getTime() + duration * 1000),
    startTime: start,
    sport,
    totalElapsedTime: duration,
    totalTimerTime: duration,
    totalDistance: distance,
    avgSpeed: speed,
    avgHeartRate: avgHeartRate ?? undefined,
    maxHeartRate: avgHeartRate ? avgHeartRate + 14 : undefined,
    avgCadence: avgCadence ?? undefined,
    totalAscent: 120,
    totalCalories: 620,
    avgPower: avgPower ?? undefined,
    totalTrainingEffect: 3.4,
  });

  return encoder.close();
}

const upload = (data: Uint8Array, filename = 'activity.fit') => ({ filename, data });

describe('mapFitSport', () => {
  it('recognises the three sports the application supports', () => {
    expect(mapFitSport('running')).toBe('running');
    expect(mapFitSport('cycling')).toBe('cycling');
    expect(mapFitSport('swimming')).toBe('swimming');
  });

  it('falls back to "other" for anything else', () => {
    expect(mapFitSport('rowing')).toBe('other');
    expect(mapFitSport(undefined)).toBe('other');
  });
});

describe('parseFitFile', () => {
  it('reads the core metrics from a real FIT file', () => {
    const { activity, error } = parseFitFile(upload(encodeFit({})));

    expect(error).toBeNull();
    expect(activity).not.toBeNull();
    expect(activity!.sport).toBe('running');
    expect(activity!.duration).toBe(3000);
    expect(activity!.distance).toBe(10000);
    expect(activity!.avgHR).toBe(148);
    expect(activity!.maxHR).toBe(162);
    expect(activity!.elevationGain).toBe(120);
    expect(activity!.calories).toBe(620);
    expect(activity!.source).toBe('fit_upload');
  });

  it('derives pace so it always agrees with distance and time', () => {
    const { activity } = parseFitFile(upload(encodeFit({ distance: 10000, duration: 3000 })));
    expect(activity!.avgPace).toBe(300); // 3000 s over 10 km is 5:00/km
  });

  it('carries through the device’s own Training Effect', () => {
    const { activity } = parseFitFile(upload(encodeFit({})));
    expect(activity!.aerobicTrainingEffect).toBeCloseTo(3.4, 1);
  });

  it('converts running cadence to total steps per minute', () => {
    // FIT stores 85 (one leg); runners mean 170.
    const { activity } = parseFitFile(upload(encodeFit({ avgCadence: 85 })));
    expect(activity!.cadence).toBe(170);
  });

  it('leaves cycling cadence alone', () => {
    const { activity } = parseFitFile(
      upload(encodeFit({ sport: 'cycling', avgCadence: 88 })),
    );
    expect(activity!.cadence).toBe(88);
  });

  it('records null for metrics the device did not capture', () => {
    const { activity } = parseFitFile(
      upload(encodeFit({ avgHeartRate: null, avgPower: null })),
    );

    expect(activity!.avgHR).toBeNull();
    expect(activity!.maxHR).toBeNull();
    expect(activity!.averagePower).toBeNull();
  });

  it('explains what was missing rather than silently filling it in', () => {
    const { activity } = parseFitFile(upload(encodeFit({ avgHeartRate: null })));
    expect(activity!.notes!.join(' ')).toContain('No heart-rate data');
  });

  it('builds splits from the lap messages', () => {
    const { activity } = parseFitFile(upload(encodeFit({ laps: 10, distance: 10000 })));

    expect(activity!.splits).toHaveLength(10);
    expect(activity!.splits[0].distance).toBe(1000);
    expect(activity!.splits[0].avgHR).toBe(148);
    // 12 m up and 8 m down is a net gain of 4 m.
    expect(activity!.splits[0].elevation).toBeCloseTo(4, 1);
  });

  it('samples the record stream rather than storing every point', () => {
    const { activity } = parseFitFile(upload(encodeFit({ records: 600, duration: 3000 })));

    expect(activity!.stream.length).toBeGreaterThan(10);
    // 3000 s sampled every 15 s is about 200 points, far fewer than 600.
    expect(activity!.stream.length).toBeLessThan(250);
    expect(activity!.stream[0].hr).toBe(148);
  });

  it('gives the same file the same identifier, so re-uploading updates it', () => {
    const data = encodeFit({});
    const first = parseFitFile(upload(data));
    const second = parseFitFile(upload(data, 'renamed.fit'));

    expect(first.activity!.externalId).toBe(second.activity!.externalId);
  });

  it('rejects a file that is not FIT at all', () => {
    const { activity, error } = parseFitFile(
      upload(new TextEncoder().encode('this is not a FIT file')),
    );

    expect(activity).toBeNull();
    expect(error).toContain('not a FIT file');
  });

  it('refuses a truncated file rather than importing a partial activity', () => {
    const data = encodeFit({});
    const truncated = data.slice(0, Math.floor(data.length / 2));
    const { activity, error } = parseFitFile(upload(truncated));

    expect(activity).toBeNull();
    expect(error).not.toBeNull();
  });

  it('handles cycling and swimming files', () => {
    const ride = parseFitFile(upload(encodeFit({ sport: 'cycling', avgPower: 210 })));
    expect(ride.activity!.sport).toBe('cycling');
    expect(ride.activity!.averagePower).toBe(210);

    const swim = parseFitFile(
      upload(encodeFit({ sport: 'swimming', distance: 1500, duration: 1900, avgCadence: null })),
    );
    expect(swim.activity!.sport).toBe('swimming');
    expect(swim.activity!.cadence).toBeNull();
  });
});

describe('FitProvider', () => {
  const range = { start: new Date(2026, 0, 1), end: new Date(2026, 11, 31) };

  it('parses a batch of files', async () => {
    const provider = new FitProvider([
      upload(encodeFit({}), 'a.fit'),
      upload(encodeFit({ sport: 'cycling', distance: 40000 }), 'b.fit'),
    ]);

    const { activities } = await provider.fetch(range);

    expect(activities).toHaveLength(2);
    expect(provider.failures).toHaveLength(0);
  });

  it('keeps going when one file in a batch is bad', async () => {
    const provider = new FitProvider([
      upload(encodeFit({}), 'good.fit'),
      upload(new TextEncoder().encode('rubbish'), 'bad.fit'),
    ]);

    const { activities } = await provider.fetch(range);

    expect(activities).toHaveLength(1);
    expect(provider.failures).toHaveLength(1);
    expect(provider.failures[0].filename).toBe('bad.fit');
  });

  it('reports itself unavailable when given nothing', () => {
    const provider = new FitProvider([]);
    expect(provider.isConfigured()).toBe(false);
    expect(provider.unavailableReason()).toContain('No FIT files');
  });

  it('returns no health data, because FIT activity files contain none', async () => {
    const provider = new FitProvider([upload(encodeFit({}))]);
    const { health } = await provider.fetch(range);
    expect(health).toHaveLength(0);
  });
});
