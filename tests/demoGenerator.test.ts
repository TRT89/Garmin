import { describe, expect, it } from 'vitest';
import { DEMO_SEED, generateDemoData, generateDemoSyncActivity } from '@/demo/generator';
import { assessRecovery } from '@/analytics/recovery';
import { buildFitnessSnapshot } from '@/analytics/runningFitness';
import { addDays, startOfDay } from '@/lib/dates';

const END = new Date(2026, 7, 11); // fixed date so the tests are stable

describe('demo generator', () => {
  const data = generateDemoData({ weeks: 12, endDate: END, seed: DEMO_SEED });

  it('produces identical data for the same seed', () => {
    const again = generateDemoData({ weeks: 12, endDate: END, seed: DEMO_SEED });
    expect(JSON.stringify(again)).toBe(JSON.stringify(data));
  });

  it('produces different data for a different seed', () => {
    const other = generateDemoData({ weeks: 12, endDate: END, seed: DEMO_SEED + 1 });
    expect(JSON.stringify(other)).not.toBe(JSON.stringify(data));
  });

  it('covers twelve weeks ending on the requested date', () => {
    const dates = data.activities.map((a) => a.date.getTime());
    const earliest = new Date(Math.min(...dates));
    const latest = new Date(Math.max(...dates));

    expect(latest.getTime()).toBeLessThanOrEqual(END.getTime() + 24 * 60 * 60 * 1000);
    expect(earliest.getTime()).toBeGreaterThanOrEqual(addDays(END, -85).getTime());
  });

  it('never generates activities in the future', () => {
    const cutoff = addDays(startOfDay(END), 1).getTime();
    expect(data.activities.every((a) => a.date.getTime() < cutoff)).toBe(true);
  });

  it('includes running, cycling and swimming', () => {
    const sports = new Set(data.activities.map((a) => a.sport));
    expect(sports.has('running')).toBe(true);
    expect(sports.has('cycling')).toBe(true);
    expect(sports.has('swimming')).toBe(true);
  });

  it('includes easy, interval, tempo and long runs', () => {
    const titles = new Set(
      data.activities.filter((a) => a.sport === 'running').map((a) => a.title),
    );
    expect(titles.has('Easy Run')).toBe(true);
    expect(titles.has('Long Run')).toBe(true);
    expect(titles.has('Interval Session')).toBe(true);
    expect(titles.has('Tempo Run')).toBe(true);
  });

  it('gives every activity a unique identifier', () => {
    const ids = data.activities.map((a) => a.externalId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('marks every record as demo data', () => {
    expect(data.activities.every((a) => a.source === 'demo')).toBe(true);
    expect(data.health.every((h) => h.source === 'demo')).toBe(true);
  });

  it('leaves metrics the device cannot record as null instead of inventing them', () => {
    const swim = data.activities.find((a) => a.sport === 'swimming')!;
    expect(swim.avgHR).toBeNull();
    expect(swim.cadence).toBeNull();

    const anyRun = data.activities.find((a) => a.sport === 'running')!;
    expect(anyRun.averagePower).toBeNull();
  });

  it('produces per-kilometre splits and a record stream for runs', () => {
    const longRun = data.activities.find((a) => a.title === 'Long Run')!;
    expect(longRun.splits.length).toBeGreaterThan(10);
    expect(longRun.stream.length).toBeGreaterThan(100);
    expect(longRun.splits[0].pace).toBeGreaterThan(0);
  });

  it('records a health entry for every day', () => {
    // 12 weeks of daily records, minus any days beyond the end date.
    expect(data.health.length).toBeGreaterThanOrEqual(80);
    const dates = new Set(data.health.map((h) => h.date.toDateString()));
    expect(dates.size).toBe(data.health.length);
  });

  it('has internally consistent duration, distance and pace on every run', () => {
    for (const run of data.activities.filter((a) => a.sport === 'running')) {
      const impliedPace = (run.duration / run.distance!) * 1000;
      expect(run.avgPace!).toBeCloseTo(impliedPace, 0);
    }
  });

  describe('scripted scenarios', () => {
    it('contains a week where recovery indicators fall together', () => {
      // Week 5 of 12, so roughly 56 days before the end.
      const weekFiveEnd = addDays(END, -7 * 7 - 1);
      const status = assessRecovery(
        data.health.map((h) => ({ ...h, steps: h.steps })),
        weekFiveEnd,
      );

      expect(status.negativeIndicators).toBeGreaterThanOrEqual(3);
      expect(status.status).toBe('compromised');
    });

    it('contains an unusually long and hard long run', () => {
      const longRuns = data.activities.filter((a) => a.title === 'Long Run');
      const longest = longRuns.reduce((max, r) => (r.distance! > max.distance! ? r : max));
      const others = longRuns.filter((r) => r.externalId !== longest.externalId);
      const typicalHR =
        others.reduce((sum, r) => sum + r.avgHR!, 0) / others.length;

      expect(longest.distance!).toBeGreaterThan(21000);
      expect(longest.avgHR!).toBeGreaterThan(typicalHR + 3);
    });

    it('shows aerobic fitness improving across the block', () => {
      const easyRuns = data.activities
        .filter((a) => a.title === 'Easy Run')
        .sort((a, b) => a.date.getTime() - b.date.getTime());

      const early = easyRuns.slice(0, 6);
      const late = easyRuns.slice(-6);

      const meanEfficiency = (runs: typeof easyRuns) =>
        runs.reduce((sum, r) => sum + r.distance! / r.duration / r.avgHR!, 0) / runs.length;

      expect(meanEfficiency(late)).toBeGreaterThan(meanEfficiency(early));
    });

    it('builds a fitness snapshot in the intended 30-40 km per week range', () => {
      const snapshot = buildFitnessSnapshot(
        data.activities.map((a, i) => ({
          id: String(i),
          date: a.date,
          sport: a.sport,
          title: a.title,
          duration: a.duration,
          distance: a.distance,
          avgHR: a.avgHR,
          avgPace: a.avgPace,
          trainingLoad: null,
        })),
        END,
        12,
      );

      expect(snapshot.avgWeeklyDistance).toBeGreaterThan(28000);
      expect(snapshot.avgWeeklyDistance).toBeLessThan(45000);
      expect(snapshot.easyPaceMin).not.toBeNull();
      expect(snapshot.thresholdPace).not.toBeNull();
    });
  });
});

describe('generateDemoSyncActivity', () => {
  it('is reproducible for the same index', () => {
    const a = generateDemoSyncActivity(1, END);
    const b = generateDemoSyncActivity(1, END);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('gives each simulated sync a distinct identifier', () => {
    expect(generateDemoSyncActivity(1, END).externalId).not.toBe(
      generateDemoSyncActivity(2, END).externalId,
    );
  });
});

describe('splits', () => {
  const data = generateDemoData({ weeks: 4, endDate: END, seed: DEMO_SEED });
  const longRun = data.activities.find((a) => a.title === 'Long Run')!;

  it('does not quantise split times to the sampling interval', () => {
    // Samples are 15 s apart. If split boundaries snapped to samples, every
    // duration would be a multiple of 15 — which no real watch reports.
    const durations = longRun.splits.map((s) => s.duration!);
    const multiplesOf15 = durations.filter((d) => d % 15 === 0).length;
    expect(multiplesOf15).toBeLessThan(durations.length / 2);
  });

  it('produces split times that add up to roughly the activity duration', () => {
    const splitTotal = longRun.splits.reduce((sum, s) => sum + (s.duration ?? 0), 0);
    const wholeKm = Math.floor(longRun.distance! / 1000);
    const expected = longRun.duration * (wholeKm * 1000) / longRun.distance!;
    expect(Math.abs(splitTotal - expected)).toBeLessThan(20);
  });

  it('gives every split a plausible pace', () => {
    for (const split of longRun.splits) {
      expect(split.pace!).toBeGreaterThan(180);
      expect(split.pace!).toBeLessThan(600);
    }
  });
});

describe('recent fatigue scenario', () => {
  const data = generateDemoData({ weeks: 12, endDate: END, seed: DEMO_SEED });

  it('leaves the adaptive engine exactly two indicators to act on', () => {
    // Two is the engine's minimum for changing anything, and it produces a
    // proportionate adjustment rather than the drastic one three would.
    const status = assessRecovery(data.health, END);

    expect(status.negativeIndicators).toBe(2);
    expect(status.status).toBe('moderate');
  });

  it('raises resting heart rate and shortens sleep, and nothing else', () => {
    const status = assessRecovery(data.health, END);
    const evidence = status.evidence.join(' ');

    expect(evidence).toContain('Resting heart rate');
    expect(evidence).toContain('Sleep');
    expect(evidence).not.toContain('stress');
  });

  it('does not disturb the earlier poor-recovery week', () => {
    const weekFiveEnd = addDays(END, -7 * 7 - 1);
    expect(assessRecovery(data.health, weekFiveEnd).status).toBe('compromised');
  });
});
