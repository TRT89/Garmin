/**
 * Matching completed activities to planned workouts.
 *
 * When new data arrives, each activity needs to be associated with the session
 * it fulfilled — that association is what makes "planned against actual"
 * possible at all.
 *
 * The matcher scores candidates rather than using rigid rules, because real
 * training is messy: sessions get moved a day, distances come out slightly
 * short, and a runner may do something entirely different from what was planned.
 * A low-confidence match is left unmade rather than forced, and the athlete can
 * always assign one by hand.
 */

import { daysBetween } from '@/lib/dates';

export interface MatchableActivity {
  id: string;
  date: Date;
  sport: string;
  distance: number | null;
  duration: number;
  title: string;
}

export interface MatchablePlannedWorkout {
  id: string;
  date: Date;
  sport: string;
  workoutType: string;
  targetDistance: number | null;
  targetDuration: number | null;
  completionStatus: string;
  linkedActivityId: string | null;
}

export interface MatchScore {
  workoutId: string;
  activityId: string;
  /** 0-1. Above CONFIDENCE_THRESHOLD the match is made automatically. */
  score: number;
  reasons: string[];
}

/** Below this, a match is not made automatically. */
export const CONFIDENCE_THRESHOLD = 0.6;

/** How many days either side of the planned date a session may be matched. */
export const MAX_DAY_DIFFERENCE = 2;

/**
 * Score how well one activity fits one planned workout.
 *
 * Returns null when the pairing is impossible — a different sport, or too far
 * apart in time. Scoring only continues for pairings that could genuinely be
 * the same session.
 */
export function scoreMatch(
  activity: MatchableActivity,
  workout: MatchablePlannedWorkout,
): MatchScore | null {
  // Sport must agree. A ride never fulfils a planned run.
  if (activity.sport !== workout.sport) return null;

  // Rest days are never fulfilled by an activity.
  if (workout.workoutType === 'REST') return null;

  const dayDiff = Math.abs(daysBetween(workout.date, activity.date));
  if (dayDiff > MAX_DAY_DIFFERENCE) return null;

  const reasons: string[] = [];

  // --- Date proximity: the strongest signal ------------------------------
  const dateScore = dayDiff === 0 ? 1 : dayDiff === 1 ? 0.7 : 0.4;
  reasons.push(
    dayDiff === 0
      ? 'Same day as the planned session.'
      : `${dayDiff} day${dayDiff === 1 ? '' : 's'} from the planned date.`,
  );

  // --- Distance agreement -------------------------------------------------
  let distanceScore = 0.5; // neutral when there is nothing to compare
  if (workout.targetDistance != null && activity.distance != null && workout.targetDistance > 0) {
    const ratio = activity.distance / workout.targetDistance;
    // Within 15% is a strong match; beyond 50% out it is almost certainly a
    // different session.
    if (ratio >= 0.85 && ratio <= 1.15) {
      distanceScore = 1;
      reasons.push(
        `Distance within 15% of the ${(workout.targetDistance / 1000).toFixed(1)} km planned.`,
      );
    } else if (ratio >= 0.7 && ratio <= 1.4) {
      distanceScore = 0.6;
      reasons.push(
        `Distance somewhat different from the ${(workout.targetDistance / 1000).toFixed(1)} km planned.`,
      );
    } else {
      distanceScore = 0.15;
      reasons.push(
        `Distance very different from the ${(workout.targetDistance / 1000).toFixed(1)} km planned.`,
      );
    }
  }

  // --- Duration agreement, where a target exists --------------------------
  let durationScore = 0.5;
  if (workout.targetDuration != null && workout.targetDuration > 0) {
    const ratio = activity.duration / workout.targetDuration;
    durationScore = ratio >= 0.8 && ratio <= 1.2 ? 1 : ratio >= 0.6 && ratio <= 1.5 ? 0.6 : 0.2;
  }

  // --- Does the activity look like the kind of session planned? -----------
  // The title a device assigns is a weak but genuine hint.
  let characterScore = 0.5;
  const title = activity.title.toLowerCase();
  const type = workout.workoutType;
  const looksLike =
    (type === 'LONG_RUN' && title.includes('long')) ||
    (type === 'INTERVAL' && (title.includes('interval') || title.includes('repeat'))) ||
    (type === 'TEMPO' && (title.includes('tempo') || title.includes('threshold'))) ||
    (type === 'EASY' && title.includes('easy')) ||
    (type === 'RECOVERY' && title.includes('recovery'));

  if (looksLike) {
    characterScore = 1;
    reasons.push('The activity name matches the kind of session planned.');
  }

  // Weighted so date and distance dominate — they are the reliable signals.
  const score =
    dateScore * 0.4 + distanceScore * 0.35 + durationScore * 0.1 + characterScore * 0.15;

  return {
    workoutId: workout.id,
    activityId: activity.id,
    score: Math.round(score * 1000) / 1000,
    reasons,
  };
}

export interface MatchResult {
  matches: MatchScore[];
  /** Activities that could not be confidently matched to any planned session. */
  unmatchedActivityIds: string[];
}

/**
 * Match a set of activities against a set of planned workouts.
 *
 * Greedy by descending score, and each activity and workout is used at most
 * once — two runs cannot both fulfil the same Tuesday session.
 */
export function matchActivities(
  activities: MatchableActivity[],
  workouts: MatchablePlannedWorkout[],
): MatchResult {
  // Workouts already linked to something are out of the running.
  const available = workouts.filter((w) => w.linkedActivityId === null);

  const candidates: MatchScore[] = [];
  for (const activity of activities) {
    for (const workout of available) {
      const score = scoreMatch(activity, workout);
      if (score && score.score >= CONFIDENCE_THRESHOLD) candidates.push(score);
    }
  }

  // Best matches win; ties are broken deterministically by identifier so the
  // result never depends on iteration order.
  candidates.sort(
    (a, b) =>
      b.score - a.score ||
      a.workoutId.localeCompare(b.workoutId) ||
      a.activityId.localeCompare(b.activityId),
  );

  const usedWorkouts = new Set<string>();
  const usedActivities = new Set<string>();
  const matches: MatchScore[] = [];

  for (const candidate of candidates) {
    if (usedWorkouts.has(candidate.workoutId)) continue;
    if (usedActivities.has(candidate.activityId)) continue;
    usedWorkouts.add(candidate.workoutId);
    usedActivities.add(candidate.activityId);
    matches.push(candidate);
  }

  const matchedActivityIds = new Set(matches.map((m) => m.activityId));

  return {
    matches,
    unmatchedActivityIds: activities
      .map((a) => a.id)
      .filter((id) => !matchedActivityIds.has(id)),
  };
}

/**
 * Planned sessions whose date has passed without anything being matched to them.
 *
 * A one-day grace period avoids marking today's session missed before the day is
 * over.
 */
export function findMissedWorkouts(
  workouts: MatchablePlannedWorkout[],
  asOf: Date = new Date(),
): MatchablePlannedWorkout[] {
  return workouts.filter(
    (w) =>
      w.completionStatus === 'planned' &&
      w.linkedActivityId === null &&
      w.workoutType !== 'REST' &&
      daysBetween(w.date, asOf) > 1,
  );
}
