import { describe, expect, it } from 'vitest';
import { compareActivities, efficiencyFactor, heartRateDrift } from '@/analytics/activityMetrics';
import { volumeForPeriod, weeklyVolumes, percentChange } from '@/analytics/volume';
import { buildFitnessSnapshot, riegelProjection, requiredPace } from '@/analytics/runningFitness';
import { assessRecovery } from '@/analytics/recovery';
import { fastestSegment, findPersonalRecords } from '@/analytics/personalRecords';
import { efficiencyTrend, linearRegression } from '@/analytics/trends';
import {
  formatDuration,
  formatPace,
  formatDistance,
  parseTimeToSeconds,
  paceToSpeed,
  speedToPace,
} from '@/lib/format';

const day = (offset: number, base = new Date(2026, 5, 15)) => {
  const d = new Date(base);
  d.setDate(d.getDate() + offset);
  d.setHours(7, 0, 0, 0);
  return d;
};

const run = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: 'a1',
  date: day(0),
  sport: 'running',
  title: 'Easy Run',
  duration: 3000,
  distance: 10000,
  avgHR: 145,
  maxHR: 165,
  avgPace: 300,
  avgSpeed: 3.33,
  elevationGain: 40,
  cadence: 172,
  averagePower: null,
  calories: 600,
  trainingLoad: 90,
  ...overrides,
}) as never;

// ---------------------------------------------------------------------------

describe('formatting', () => {
  it('formats durations with and without hours', () => {
    expect(formatDuration(3661)).toBe('1:01:01');
    expect(formatDuration(1425)).toBe('23:45');
    expect(formatDuration(null)).toBe('—');
  });

  it('formats pace and rolls 60 seconds over into the next minute', () => {
    expect(formatPace(331)).toBe('5:31/km');
    expect(formatPace(359.7)).toBe('6:00/km');
    expect(formatPace(null)).toBe('—');
  });

  it('formats distance in kilometres and miles', () => {
    expect(formatDistance(12400)).toBe('12.4 km');
    expect(formatDistance(1609.344, 'imperial')).toBe('1.0 mi');
  });

  it('parses a goal time in hours and minutes', () => {
    expect(parseTimeToSeconds('3:40')).toBe(13200);
    expect(parseTimeToSeconds('3:40:30')).toBe(13230);
    expect(parseTimeToSeconds('nonsense')).toBeNull();
  });

  it('converts between pace and speed reversibly', () => {
    expect(speedToPace(paceToSpeed(300))).toBeCloseTo(300, 6);
  });
});

// ---------------------------------------------------------------------------

describe('efficiencyFactor', () => {
  it('rises when the same pace is run at a lower heart rate', () => {
    const tired = efficiencyFactor({ distance: 10000, duration: 3000, avgHR: 155 })!;
    const fresh = efficiencyFactor({ distance: 10000, duration: 3000, avgHR: 145 })!;
    expect(fresh).toBeGreaterThan(tired);
  });

  it('returns null when heart rate is missing', () => {
    expect(efficiencyFactor({ distance: 10000, duration: 3000, avgHR: null })).toBeNull();
  });
});

describe('heartRateDrift', () => {
  it('detects heart rate climbing at a steady pace', () => {
    const stream = Array.from({ length: 60 }, (_, i) => ({
      t: i * 30,
      speed: 3.3,
      hr: 140 + i * 0.3, // climbing steadily
    }));
    expect(heartRateDrift(stream)!).toBeGreaterThan(3);
  });

  it('reports near zero when pace and heart rate hold together', () => {
    const stream = Array.from({ length: 60 }, (_, i) => ({ t: i * 30, speed: 3.3, hr: 145 }));
    expect(Math.abs(heartRateDrift(stream)!)).toBeLessThan(0.5);
  });

  it('returns null when there are too few samples to judge', () => {
    expect(heartRateDrift([{ t: 0, speed: 3, hr: 140 }])).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe('compareActivities', () => {
  it('reports a faster second run as a negative pace delta', () => {
    const a = run({ avgPace: 340, duration: 3400 });
    const b = run({ id: 'a2', avgPace: 328, duration: 3280 });

    const result = compareActivities(a, b);
    const pace = result.metrics.find((m) => m.key === 'pace')!;

    expect(pace.delta).toBe(-12);
    expect(result.observations.join(' ')).toContain('12 seconds per kilometre faster');
  });

  it('identifies faster running at a lower heart rate as improved fitness', () => {
    const a = run({ avgPace: 340, avgHR: 150 });
    const b = run({ id: 'a2', avgPace: 328, avgHR: 146 });

    const result = compareActivities(a, b);
    expect(result.observations.join(' ')).toContain('improved aerobic fitness');
  });

  it('refuses to compare different sports', () => {
    const result = compareActivities(run(), run({ id: 'a2', sport: 'cycling' }));
    expect(result.comparable).toBe(false);
    expect(result.comparabilityNote).toContain('different sports');
  });

  it('flags sessions of very different length as not directly comparable', () => {
    const result = compareActivities(run({ distance: 10000 }), run({ id: 'a2', distance: 25000 }));
    expect(result.comparable).toBe(false);
  });

  it('leaves deltas null when a metric is missing rather than assuming zero', () => {
    const result = compareActivities(run({ avgHR: null }), run({ id: 'a2' }));
    const hr = result.metrics.find((m) => m.key === 'avgHR')!;
    expect(hr.delta).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe('volume', () => {
  const activities = [
    { date: day(-1), sport: 'running', duration: 3000, distance: 10000, trainingLoad: 90 },
    { date: day(-2), sport: 'running', duration: 2400, distance: 8000, trainingLoad: 70 },
    { date: day(-3), sport: 'cycling', duration: 3600, distance: 30000, trainingLoad: 80 },
    { date: day(-40), sport: 'running', duration: 3000, distance: 10000, trainingLoad: 90 },
  ];

  it('totals distance per sport inside the period only', () => {
    const result = volumeForPeriod(activities, day(-7), day(0));

    expect(result.distanceBySport.running).toBe(18000);
    expect(result.distanceBySport.cycling).toBe(30000);
    expect(result.activityCount).toBe(3);
  });

  it('sums training load across the period', () => {
    const result = volumeForPeriod(activities, day(-7), day(0));
    expect(result.totalLoad).toBe(240);
  });

  it('includes weeks with no training as zero', () => {
    const weeks = weeklyVolumes([], day(-20), day(0));
    expect(weeks.length).toBeGreaterThanOrEqual(3);
    expect(weeks.every((w) => w.running === 0)).toBe(true);
  });

  it('groups activities into Monday-to-Sunday weeks', () => {
    const weeks = weeklyVolumes(activities, day(-7), day(0));
    const total = weeks.reduce((sum, w) => sum + w.running, 0);
    expect(total).toBe(18000);
  });

  it('returns null percent change when there is no baseline to compare against', () => {
    expect(percentChange(100, 0)).toBeNull();
    expect(percentChange(110, 100)).toBeCloseTo(0.1, 5);
  });
});

// ---------------------------------------------------------------------------

describe('buildFitnessSnapshot', () => {
  // Twelve weeks of four runs a week at a consistent 8 km.
  const history = Array.from({ length: 48 }, (_, i) => ({
    id: `r${i}`,
    date: day(-(83 - Math.floor(i / 4) * 7 - (i % 4) * 2)),
    sport: 'running',
    title: 'Easy Run',
    duration: 2800,
    distance: 8000,
    avgHR: 143,
    avgPace: 350,
    trainingLoad: 80,
  }));

  it('reports average weekly distance and the longest run', () => {
    const snapshot = buildFitnessSnapshot(history, day(0), 12);

    expect(snapshot.runCount).toBe(48);
    expect(snapshot.avgWeeklyDistance).toBeGreaterThan(20000);
    expect(snapshot.longestRun).toBe(8000);
  });

  it('reports a high consistency figure for uninterrupted training', () => {
    const snapshot = buildFitnessSnapshot(history, day(0), 12);
    expect(snapshot.consistency).toBeGreaterThan(0.8);
  });

  it('explains itself instead of inventing numbers when there is no data', () => {
    const snapshot = buildFitnessSnapshot([], day(0), 12);

    expect(snapshot.runCount).toBe(0);
    expect(snapshot.easyPaceMin).toBeNull();
    expect(snapshot.thresholdPace).toBeNull();
    expect(snapshot.notes[0]).toContain('No running activities');
  });

  it('ignores other sports when judging running fitness', () => {
    const withCycling = [
      ...history,
      {
        id: 'bike',
        date: day(-1),
        sport: 'cycling',
        title: 'Ride',
        duration: 7200,
        distance: 60000,
        avgHR: 140,
        avgPace: null,
        trainingLoad: 120,
      },
    ];

    const snapshot = buildFitnessSnapshot(withCycling, day(0), 12);
    expect(snapshot.runCount).toBe(48);
    expect(snapshot.longestRun).toBe(8000);
  });
});

describe('race projection', () => {
  it('projects a slower average pace over a longer distance', () => {
    // A 50-minute 10 km projects to a marathon well over 3:30.
    const marathon = riegelProjection(10000, 3000, 42195);
    expect(marathon).toBeGreaterThan(3000 * 4.2);
    expect(marathon).toBeLessThan(3000 * 5);
  });

  it('returns the same time for the same distance', () => {
    expect(riegelProjection(10000, 3000, 10000)).toBe(3000);
  });

  it('computes the pace a goal time requires', () => {
    // 3:40 marathon is a shade over 5:12/km.
    expect(requiredPace(42195, 13200)).toBe(313);
  });
});

// ---------------------------------------------------------------------------

describe('assessRecovery', () => {
  const baseline = (offset: number, overrides = {}) => ({
    date: day(offset),
    restingHR: 48,
    sleepDuration: 440,
    sleepScore: 82,
    stress: 30,
    bodyBattery: 76,
    steps: 10000,
    ...overrides,
  });

  it('reports good recovery when everything sits at baseline', () => {
    const records = Array.from({ length: 20 }, (_, i) => baseline(-i));
    const status = assessRecovery(records, day(0));

    expect(status.status).toBe('good');
    expect(status.negativeIndicators).toBe(0);
  });

  it('detects several indicators falling together', () => {
    const records = [
      ...Array.from({ length: 17 }, (_, i) => baseline(-i - 3)),
      ...Array.from({ length: 3 }, (_, i) =>
        baseline(-i, { restingHR: 55, sleepDuration: 360, sleepScore: 64, bodyBattery: 55 }),
      ),
    ];

    const status = assessRecovery(records, day(0));

    expect(status.status).toBe('compromised');
    expect(status.negativeIndicators).toBeGreaterThanOrEqual(3);
    expect(status.evidence.join(' ')).toContain('Resting heart rate');
  });

  it('treats a single moved indicator as normal variation', () => {
    const records = [
      ...Array.from({ length: 17 }, (_, i) => baseline(-i - 3)),
      ...Array.from({ length: 3 }, (_, i) => baseline(-i, { restingHR: 53 })),
    ];

    const status = assessRecovery(records, day(0));
    expect(status.negativeIndicators).toBe(1);
    expect(status.status).toBe('moderate');
  });

  it('says recovery is unknown when there is no health data at all', () => {
    const status = assessRecovery([], day(0));
    expect(status.status).toBe('unknown');
    expect(status.summary).toContain('No recent health data');
  });
});

// ---------------------------------------------------------------------------

describe('personal records', () => {
  /** A stream running at a constant 3 m/s. */
  const evenStream = (seconds: number, speed = 3) =>
    Array.from({ length: Math.floor(seconds / 5) + 1 }, (_, i) => ({
      t: i * 5,
      distance: i * 5 * speed,
      hr: 150,
    }));

  it('finds the fastest continuous stretch in a stream', () => {
    const time = fastestSegment(evenStream(2000), 5000);
    // 5000 m at 3 m/s is 1667 s; sampling granularity allows a few seconds either way.
    expect(time).toBeGreaterThan(1650);
    expect(time).toBeLessThan(1690);
  });

  it('returns null when the activity never covers the distance', () => {
    expect(fastestSegment(evenStream(600), 10000)).toBeNull();
  });

  it('picks the faster of two qualifying activities', () => {
    const set = findPersonalRecords([
      {
        id: 'slow',
        date: day(-10),
        sport: 'running',
        title: 'Steady',
        distance: 6000,
        duration: 2000,
        stream: evenStream(2000, 3),
      },
      {
        id: 'fast',
        date: day(-2),
        sport: 'running',
        title: 'Race',
        distance: 6000,
        duration: 1700,
        stream: evenStream(1700, 3.5),
      },
    ]);

    const fiveK = set.records.find((r) => r.key === '5k');
    expect(fiveK?.activityId).toBe('fast');
  });

  it('will not invent a 5 km best from the average pace of a long run', () => {
    const set = findPersonalRecords([
      {
        id: 'long',
        date: day(-2),
        sport: 'running',
        title: 'Long Run',
        distance: 30000,
        duration: 10800,
        stream: [], // no detailed recording
      },
    ]);

    expect(set.records.find((r) => r.key === '5k')).toBeUndefined();
    expect(set.notes.join(' ')).toContain('no recorded split data');
  });

  it('accepts a full activity as a record when its distance matches', () => {
    const set = findPersonalRecords([
      {
        id: 'tenk',
        date: day(-2),
        sport: 'running',
        title: '10K Race',
        distance: 10050,
        duration: 2700,
        stream: [],
      },
    ]);

    const tenK = set.records.find((r) => r.key === '10k');
    expect(tenK?.method).toBe('full-activity');
  });

  it('tracks the longest run and ride', () => {
    const set = findPersonalRecords([
      { id: 'r', date: day(-3), sport: 'running', title: 'Long', distance: 32000, duration: 11000, stream: [] },
      { id: 'b', date: day(-4), sport: 'cycling', title: 'Ride', distance: 90000, duration: 11000, stream: [] },
    ]);

    expect(set.longestRun?.distance).toBe(32000);
    expect(set.longestRide?.distance).toBe(90000);
  });
});

// ---------------------------------------------------------------------------

describe('trends', () => {
  it('fits a line through a clean upward series', () => {
    const result = linearRegression([
      { x: 0, y: 1 },
      { x: 1, y: 2 },
      { x: 2, y: 3 },
      { x: 3, y: 4 },
    ])!;

    expect(result.slope).toBeCloseTo(1, 5);
    expect(result.r2).toBeCloseTo(1, 3);
  });

  it('needs at least three points', () => {
    expect(linearRegression([{ x: 0, y: 1 }, { x: 1, y: 2 }])).toBeNull();
  });

  it('reports improving efficiency when pace quickens at a fixed heart rate', () => {
    const runs = Array.from({ length: 12 }, (_, i) => ({
      id: `e${i}`,
      date: day(-(77 - i * 7)),
      sport: 'running',
      title: 'Easy Run',
      duration: 3000 - i * 20, // steadily quicker over the same distance
      distance: 10000,
      avgHR: 145,
      avgPace: 300 - i * 2,
    }));

    const trend = efficiencyTrend(runs, day(-84), day(0));

    expect(trend.meaningful).toBe(true);
    expect(trend.percentChange!).toBeGreaterThan(0);
    expect(trend.summary).toContain('improved');
  });

  it('declines to call a trend when there is too little data', () => {
    const trend = efficiencyTrend([], day(-84), day(0));
    expect(trend.meaningful).toBe(false);
    expect(trend.summary).toContain('not yet enough');
  });
});
