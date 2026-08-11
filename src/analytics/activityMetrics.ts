/**
 * Per-activity derived values and activity-to-activity comparison.
 *
 * Everything here is a pure function over already-normalised data, so the same
 * code serves the activity detail page, the dashboard and the AI Coach's
 * `compare_activities` tool. There is exactly one implementation of "what
 * changed between these two runs", which is why the chat answers and the screen
 * can never disagree.
 */

import { PACE_SPORTS, type Sport } from '@/lib/constants';

export interface ActivityLike {
  id: string;
  date: Date;
  sport: string;
  title: string;
  duration: number;
  distance: number | null;
  avgHR: number | null;
  maxHR: number | null;
  avgPace: number | null;
  avgSpeed: number | null;
  elevationGain: number | null;
  cadence: number | null;
  averagePower: number | null;
  calories: number | null;
  trainingLoad: number | null;
}

/** Whether this sport is normally described by pace rather than speed. */
export function usesPace(sport: string): boolean {
  return PACE_SPORTS.includes(sport as Sport);
}

/**
 * Aerobic efficiency: metres travelled per second, per heartbeat.
 *
 * The useful property is that it rises when you cover the same ground at a
 * lower heart rate. Comparing it between similar easy runs is one of the
 * clearest signals that aerobic fitness is improving. It is meaningless across
 * different sports or intensities, so callers must compare like with like.
 *
 * Returns null when either speed or heart rate is missing.
 */
export function efficiencyFactor(activity: {
  distance: number | null;
  duration: number;
  avgHR: number | null;
}): number | null {
  if (activity.avgHR == null || activity.avgHR <= 0) return null;
  if (activity.distance == null || activity.distance <= 0 || activity.duration <= 0) return null;
  const speed = activity.distance / activity.duration; // metres per second
  return Math.round((speed / activity.avgHR) * 100000) / 100000;
}

/**
 * Heart-rate drift ("decoupling"): how much the relationship between pace and
 * heart rate deteriorates from the first half of a session to the second.
 *
 * A steady run where heart rate climbs while pace holds indicates the effort
 * cost more than it looked. Around 5% or less is normal on a long run.
 *
 * Returns null unless the stream has enough usable samples.
 */
export function heartRateDrift(
  stream: { t: number; hr?: number | null; speed?: number | null }[],
): number | null {
  const usable = stream.filter(
    (p) => p.hr != null && p.hr > 0 && p.speed != null && p.speed > 0,
  );
  if (usable.length < 20) return null;

  const midpoint = Math.floor(usable.length / 2);
  const halves = [usable.slice(0, midpoint), usable.slice(midpoint)];

  const ratios = halves.map((half) => {
    const meanSpeed = half.reduce((sum, p) => sum + (p.speed ?? 0), 0) / half.length;
    const meanHR = half.reduce((sum, p) => sum + (p.hr ?? 0), 0) / half.length;
    return meanHR > 0 ? meanSpeed / meanHR : null;
  });

  const [first, second] = ratios;
  if (first == null || second == null || first === 0) return null;

  // Positive means efficiency fell away in the second half.
  return Math.round(((first - second) / first) * 1000) / 10;
}

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

export interface MetricComparison {
  key: string;
  label: string;
  a: number | null;
  b: number | null;
  /** b − a, in the metric's own unit. Null when either side is missing. */
  delta: number | null;
  /** (b − a) / a. Null when `a` is missing or zero. */
  percentChange: number | null;
  /** How the value should be formatted for display. */
  format: 'distance' | 'duration' | 'pace' | 'speed' | 'number' | 'load';
  /** Whether an increase is normally a good thing, for colouring. */
  higherIsBetter: boolean | null;
}

export interface ActivityComparison {
  a: ActivityLike;
  b: ActivityLike;
  metrics: MetricComparison[];
  /** Factual observations, each traceable to one of the metrics above. */
  observations: string[];
  /** True when the two activities are similar enough to compare meaningfully. */
  comparable: boolean;
  comparabilityNote: string | null;
}

function compare(
  key: string,
  label: string,
  a: number | null,
  b: number | null,
  format: MetricComparison['format'],
  higherIsBetter: boolean | null,
): MetricComparison {
  const delta = a != null && b != null ? b - a : null;
  const percentChange = a != null && b != null && a !== 0 ? (b - a) / a : null;
  return { key, label, a, b, delta, percentChange, format, higherIsBetter };
}

/**
 * Compare two activities metric by metric.
 *
 * `a` is treated as the earlier/reference activity and `b` as the later one, so
 * a negative pace delta means "b was faster".
 */
export function compareActivities(a: ActivityLike, b: ActivityLike): ActivityComparison {
  const paceBased = usesPace(a.sport);

  const metrics: MetricComparison[] = [
    compare('distance', 'Distance', a.distance, b.distance, 'distance', true),
    compare('duration', 'Duration', a.duration, b.duration, 'duration', null),
    paceBased
      ? // Lower pace is faster, so a fall is an improvement.
        compare('pace', 'Average pace', a.avgPace, b.avgPace, 'pace', false)
      : compare('speed', 'Average speed', a.avgSpeed, b.avgSpeed, 'speed', true),
    compare('avgHR', 'Average heart rate', a.avgHR, b.avgHR, 'number', null),
    compare('maxHR', 'Maximum heart rate', a.maxHR, b.maxHR, 'number', null),
    compare('elevation', 'Elevation gain', a.elevationGain, b.elevationGain, 'number', null),
    compare('cadence', 'Cadence', a.cadence, b.cadence, 'number', null),
    compare('trainingLoad', 'Training load', a.trainingLoad, b.trainingLoad, 'load', null),
  ];

  const efficiencyA = efficiencyFactor(a);
  const efficiencyB = efficiencyFactor(b);
  metrics.push(
    compare('efficiency', 'Aerobic efficiency', efficiencyA, efficiencyB, 'number', true),
  );

  // --- Is this comparison fair? ------------------------------------------
  let comparable = true;
  let comparabilityNote: string | null = null;

  if (a.sport !== b.sport) {
    comparable = false;
    comparabilityNote = `These are different sports (${a.sport} and ${b.sport}), so most metrics cannot be compared directly.`;
  } else if (a.distance != null && b.distance != null) {
    const ratio = b.distance / a.distance;
    if (ratio < 0.7 || ratio > 1.43) {
      comparable = false;
      comparabilityNote =
        'These sessions differ substantially in distance, so pace and heart rate are not directly comparable.';
    }
  }

  // --- Observations, strictly derived from the numbers above --------------
  const observations: string[] = [];
  const paceMetric = metrics.find((m) => m.key === 'pace');
  const hrMetric = metrics.find((m) => m.key === 'avgHR');

  if (paceMetric?.delta != null && Math.abs(paceMetric.delta) >= 3) {
    const faster = paceMetric.delta < 0;
    observations.push(
      `The later run was ${Math.abs(Math.round(paceMetric.delta))} seconds per kilometre ${
        faster ? 'faster' : 'slower'
      }.`,
    );
  }

  if (hrMetric?.delta != null && Math.abs(hrMetric.delta) >= 2) {
    observations.push(
      `Average heart rate was ${Math.abs(Math.round(hrMetric.delta))} bpm ${
        hrMetric.delta > 0 ? 'higher' : 'lower'
      }.`,
    );
  }

  // The combination that actually means something: faster at the same or lower
  // heart rate. Only stated when both numbers are present.
  if (
    paceMetric?.delta != null &&
    hrMetric?.delta != null &&
    paceMetric.delta <= -3 &&
    hrMetric.delta <= 1 &&
    comparable
  ) {
    observations.push(
      'The later run was faster at the same or a lower heart rate, which is consistent with improved aerobic fitness.',
    );
  }

  if (
    paceMetric?.delta != null &&
    hrMetric?.delta != null &&
    paceMetric.delta >= 3 &&
    hrMetric.delta >= 3 &&
    comparable
  ) {
    observations.push(
      'The later run was both slower and at a higher heart rate, which can indicate accumulated fatigue, heat, or simply a harder day.',
    );
  }

  if (observations.length === 0) {
    observations.push('The two sessions were closely matched across the recorded metrics.');
  }

  return { a, b, metrics, observations, comparable, comparabilityNote };
}
