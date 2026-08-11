import { describe, expect, it } from 'vitest';
import {
  buildLoadSeries,
  calculateSessionLoad,
  summariseLoad,
} from '@/analytics/trainingLoad';

const athlete = { maxHR: 186, restingHR: 48, sex: 'male' };

describe('calculateSessionLoad', () => {
  it('uses the heart-rate method when heart rate is available', () => {
    const result = calculateSessionLoad(
      { duration: 3600, avgHR: 150, distance: 12000, avgPace: 300, sport: 'running' },
      athlete,
    );

    expect(result.method).toBe('trimp');
    expect(result.value).toBeGreaterThan(0);
  });

  it('scores a harder session above an easier one of the same length', () => {
    const easy = calculateSessionLoad(
      { duration: 3600, avgHR: 130, distance: null, avgPace: null, sport: 'running' },
      athlete,
    );
    const hard = calculateSessionLoad(
      { duration: 3600, avgHR: 170, distance: null, avgPace: null, sport: 'running' },
      athlete,
    );

    expect(hard.value!).toBeGreaterThan(easy.value!);
  });

  it('scales with duration at a fixed intensity', () => {
    const short = calculateSessionLoad(
      { duration: 1800, avgHR: 150, distance: null, avgPace: null, sport: 'running' },
      athlete,
    );
    const long = calculateSessionLoad(
      { duration: 3600, avgHR: 150, distance: null, avgPace: null, sport: 'running' },
      athlete,
    );

    // Precision 0 (within 0.5) because each value is rounded to one decimal
    // before being returned, so doubling the shorter one can differ by 0.1.
    expect(long.value!).toBeCloseTo(short.value! * 2, 0);
  });

  it('falls back to the pace method when heart rate is missing', () => {
    const result = calculateSessionLoad(
      { duration: 3600, avgHR: null, distance: 12000, avgPace: 300, sport: 'running' },
      athlete,
    );

    expect(result.method).toBe('pace');
    expect(result.value).toBeGreaterThan(0);
    expect(result.explanation).toContain('no heart-rate data');
  });

  it('returns null rather than guessing when neither heart rate nor pace exists', () => {
    const result = calculateSessionLoad(
      { duration: 3600, avgHR: null, distance: null, avgPace: null, sport: 'other' },
      athlete,
    );

    expect(result.value).toBeNull();
    expect(result.method).toBeNull();
  });

  it('returns null when the athlete has no heart-rate profile and no pace', () => {
    const result = calculateSessionLoad(
      { duration: 3600, avgHR: 150, distance: null, avgPace: null, sport: 'running' },
      { maxHR: null, restingHR: null, sex: null },
    );

    expect(result.value).toBeNull();
  });

  it('clamps heart rates above maximum instead of producing runaway values', () => {
    const atMax = calculateSessionLoad(
      { duration: 3600, avgHR: 186, distance: null, avgPace: null, sport: 'running' },
      athlete,
    );
    const aboveMax = calculateSessionLoad(
      { duration: 3600, avgHR: 210, distance: null, avgPace: null, sport: 'running' },
      athlete,
    );

    expect(aboveMax.value).toBe(atMax.value);
  });
});

describe('buildLoadSeries', () => {
  const day = (offset: number) => {
    const d = new Date(2026, 0, 15);
    d.setDate(d.getDate() + offset);
    return d;
  };

  it('accumulates a rolling 7-day and 28-day total', () => {
    // 100 units of load every day for 40 days.
    const activities = Array.from({ length: 40 }, (_, i) => ({
      date: day(i - 39),
      trainingLoad: 100,
    }));

    const series = buildLoadSeries(activities, day(-6), day(0));
    const today = series[series.length - 1];

    expect(today.acute).toBe(700);
    expect(today.chronic).toBe(2800);
    // 700 against an average week of 700 is a ratio of exactly 1.
    expect(today.ratio).toBe(1);
  });

  it('detects a sharp increase as a ratio above 1', () => {
    const activities = [
      ...Array.from({ length: 21 }, (_, i) => ({ date: day(i - 27), trainingLoad: 50 })),
      ...Array.from({ length: 7 }, (_, i) => ({ date: day(i - 6), trainingLoad: 150 })),
    ];

    const series = buildLoadSeries(activities, day(0), day(0));
    expect(series[0].ratio).toBeGreaterThan(1.4);
  });

  it('ignores activities with no load rather than treating them as zero effort', () => {
    const activities = [
      { date: day(-1), trainingLoad: 100 },
      { date: day(-1), trainingLoad: null },
    ];

    const series = buildLoadSeries(activities, day(0), day(0));
    expect(series[0].acute).toBe(100);
  });

  it('leaves the ratio null when there is too little history to be meaningful', () => {
    const series = buildLoadSeries([{ date: day(-1), trainingLoad: 20 }], day(0), day(0));
    expect(series[0].ratio).toBeNull();
  });

  it('covers every day in the range, including rest days', () => {
    const series = buildLoadSeries([], day(-6), day(0));
    expect(series).toHaveLength(7);
    expect(series.every((point) => point.daily === 0)).toBe(true);
  });
});

describe('summariseLoad', () => {
  const day = (offset: number) => {
    const d = new Date(2026, 5, 10);
    d.setDate(d.getDate() + offset);
    return d;
  };

  it('compares this week against the week before it', () => {
    const activities = [
      ...Array.from({ length: 7 }, (_, i) => ({ date: day(i - 13), trainingLoad: 100 })),
      ...Array.from({ length: 7 }, (_, i) => ({ date: day(i - 6), trainingLoad: 120 })),
    ];

    const summary = summariseLoad(activities, day(0));

    expect(summary.acute).toBe(840);
    expect(summary.previousAcute).toBe(700);
    expect(summary.acuteChange).toBeCloseTo(0.2, 2);
  });

  it('says so plainly when there is not enough history', () => {
    const summary = summariseLoad([], day(0));
    expect(summary.ratio).toBeNull();
    expect(summary.interpretation).toContain('not yet enough');
  });
});
