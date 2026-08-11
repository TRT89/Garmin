/**
 * Personal records.
 *
 * The important rule here is restraint. A 10 km personal best means "the
 * fastest 10 km you have actually run", and inferring one from an activity that
 * does not genuinely contain that effort would be misleading.
 *
 * So:
 *   - A distance record is only claimed when an activity covered at least that
 *     distance, and the best continuous stretch is measured from the recorded
 *     stream where one exists.
 *   - Without a stream, an activity only counts if its total distance is close
 *     to the record distance (within 5%), so a 5 km split cannot be invented
 *     from the average pace of a 30 km long run.
 *   - Anything that cannot be established is simply absent, with a note saying
 *     why.
 */

import type { StreamPoint } from '@/lib/json';

/** The distances a record is tracked for, in metres. */
export const RECORD_DISTANCES = [
  { key: '1k', label: '1 km', metres: 1000 },
  { key: '5k', label: '5 km', metres: 5000 },
  { key: '10k', label: '10 km', metres: 10000 },
  { key: 'half_marathon', label: 'Half Marathon', metres: 21097.5 },
  { key: 'marathon', label: 'Marathon', metres: 42195 },
] as const;

export interface RecordActivity {
  id: string;
  date: Date;
  sport: string;
  title: string;
  distance: number | null;
  duration: number;
  stream: StreamPoint[];
}

export interface PersonalRecord {
  key: string;
  label: string;
  distance: number;
  /** Best time in seconds. */
  time: number;
  pace: number; // seconds per km
  activityId: string;
  activityTitle: string;
  date: Date;
  /** How the record was established, shown alongside it for transparency. */
  method: 'stream' | 'full-activity';
}

/**
 * Find the fastest continuous `targetDistance` inside a recorded stream.
 *
 * A sliding window over the distance/time samples: for every starting sample,
 * find the first sample at least `targetDistance` further on, and keep the
 * smallest elapsed time. Returns null when the stream never covers the distance.
 */
export function fastestSegment(
  stream: StreamPoint[],
  targetDistance: number,
): number | null {
  const points = stream.filter((p) => p.distance != null);
  if (points.length < 2) return null;

  const total = points[points.length - 1].distance!;
  if (total < targetDistance) return null;

  let best: number | null = null;
  let end = 0;

  for (let start = 0; start < points.length; start++) {
    if (end < start) end = start;
    while (
      end < points.length &&
      points[end].distance! - points[start].distance! < targetDistance
    ) {
      end++;
    }
    if (end >= points.length) break;

    const elapsed = points[end].t - points[start].t;
    if (best === null || elapsed < best) best = elapsed;
  }

  return best;
}

export interface PersonalRecordSet {
  records: PersonalRecord[];
  longestRun: { distance: number; activityId: string; date: Date } | null;
  longestRide: { distance: number; activityId: string; date: Date } | null;
  /** Explanations for any distance where no record could be established. */
  notes: string[];
}

/**
 * Work out the athlete's bests from their activity history.
 *
 * Only running activities are considered for the distance records.
 */
export function findPersonalRecords(activities: RecordActivity[]): PersonalRecordSet {
  const runs = activities.filter((a) => a.sport === 'running');
  const records: PersonalRecord[] = [];
  const notes: string[] = [];

  for (const target of RECORD_DISTANCES) {
    let best: PersonalRecord | null = null;

    for (const run of runs) {
      if (run.distance == null || run.distance < target.metres) continue;

      // Preferred: measure the actual fastest stretch inside the activity.
      if (run.stream.length > 0) {
        const time = fastestSegment(run.stream, target.metres);
        if (time != null && (best === null || time < best.time)) {
          best = {
            key: target.key,
            label: target.label,
            distance: target.metres,
            time,
            pace: Math.round((time / target.metres) * 1000),
            activityId: run.id,
            activityTitle: run.title,
            date: run.date,
            method: 'stream',
          };
        }
        continue;
      }

      // No stream: only usable if the whole activity is essentially this
      // distance. Otherwise we would be inventing a split that was never run.
      const ratio = run.distance / target.metres;
      if (ratio <= 1.05) {
        // Scale the total time to exactly the record distance.
        const time = Math.round(run.duration * (target.metres / run.distance));
        if (best === null || time < best.time) {
          best = {
            key: target.key,
            label: target.label,
            distance: target.metres,
            time,
            pace: Math.round((time / target.metres) * 1000),
            activityId: run.id,
            activityTitle: run.title,
            date: run.date,
            method: 'full-activity',
          };
        }
      }
    }

    if (best) {
      records.push(best);
    } else {
      const everFarEnough = runs.some((r) => (r.distance ?? 0) >= target.metres);
      notes.push(
        everFarEnough
          ? `No ${target.label} record: your runs over that distance have no recorded split data, and estimating one from a longer run's average pace would not be a real result.`
          : `No ${target.label} record: you have no recorded run of at least that distance.`,
      );
    }
  }

  // --- Longest efforts ----------------------------------------------------
  const longestOf = (sport: string) => {
    const candidates = activities.filter((a) => a.sport === sport && a.distance != null);
    if (candidates.length === 0) return null;
    const longest = candidates.reduce((max, a) => (a.distance! > max.distance! ? a : max));
    return { distance: longest.distance!, activityId: longest.id, date: longest.date };
  };

  return {
    records,
    longestRun: longestOf('running'),
    longestRide: longestOf('cycling'),
    notes,
  };
}

export const RECORDS_EXPLANATION =
  'Records are taken from the fastest continuous stretch inside each recorded activity. Where an activity has no detailed recording, it only counts if its full distance matches the record distance — an estimate pulled from a longer run would not be a result you actually ran.';
