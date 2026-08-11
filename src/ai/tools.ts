/**
 * The AI Coach's data tools.
 *
 * This is the layer that keeps the coach honest. The language model never sees
 * the database and never does arithmetic — it is given the *result* of one of
 * these tools and asked to put it into words.
 *
 * Every tool:
 *   - wraps an existing analytics function rather than reimplementing anything,
 *     so a figure quoted in chat is the same figure shown on screen;
 *   - returns `provenance` naming which activities and which dates the answer
 *     came from, and how any calculated value was derived;
 *   - returns `unavailable` with a reason instead of guessing when the data
 *     cannot support an answer.
 */

import { z } from 'zod';
import { prisma } from '@/lib/db';
import { addDays, dateKey, startOfDay, startOfWeek } from '@/lib/dates';
import { parseJSON, type ActivityRawData, type WorkoutStep } from '@/lib/json';
import {
  formatDistance,
  formatDuration,
  formatPace,
  formatPaceRange,
} from '@/lib/format';
import { LOAD_EXPLANATION, summariseLoad, ACWR_EXPLANATION } from '@/analytics/trainingLoad';
import { compareActivities, efficiencyFactor } from '@/analytics/activityMetrics';
import { loadActivities, loadHealth, toActivityLike } from '@/analytics/queries';
import { volumeForPeriod, weeklyVolumes } from '@/analytics/volume';
import { assessRecovery, RECOVERY_EXPLANATION } from '@/analytics/recovery';
import {
  efficiencyTrend,
  paceAtComparableHR,
  EFFICIENCY_EXPLANATION,
} from '@/analytics/trends';
import { findPersonalRecords, RECORDS_EXPLANATION } from '@/analytics/personalRecords';
import { complianceToDate, currentWeekNumber } from '@/analytics/compliance';
import { getActivePlan } from '@/training/planService';
import { getAdaptationHistory } from '@/training/adaptationService';

// ---------------------------------------------------------------------------
// Result shape
// ---------------------------------------------------------------------------

export interface Provenance {
  /** Activities the answer was computed from, so the athlete can check them. */
  activityIds: string[];
  /** The period considered, as ISO dates. */
  dateRange: { from: string; to: string } | null;
  /** How any calculated figure was derived. */
  howCalculated: string[];
}

export interface ToolResult<T = unknown> {
  tool: string;
  args: Record<string, unknown>;
  /** The structured answer, or null when the data could not support one. */
  data: T | null;
  /** Set when there is no answer; explains why, in plain language. */
  unavailable: string | null;
  provenance: Provenance;
}

function result<T>(
  tool: string,
  args: Record<string, unknown>,
  data: T | null,
  provenance: Partial<Provenance> = {},
  unavailable: string | null = null,
): ToolResult<T> {
  return {
    tool,
    args,
    data,
    unavailable,
    provenance: {
      activityIds: provenance.activityIds ?? [],
      dateRange: provenance.dateRange ?? null,
      howCalculated: provenance.howCalculated ?? [],
    },
  };
}

const range = (from: Date, to: Date) => ({ from: dateKey(from), to: dateKey(to) });

// ---------------------------------------------------------------------------
// Argument schemas
// ---------------------------------------------------------------------------

const DaysSchema = z.object({ days: z.number().int().min(1).max(730).default(28) });
const ActivityIdSchema = z.object({ activityId: z.string().min(1) });

export const TOOL_SCHEMAS = {
  get_activity: ActivityIdSchema,
  search_activities: z.object({
    sport: z.enum(['running', 'cycling', 'swimming', 'other']).nullable().default(null),
    minDistance: z.number().nullable().default(null),
    maxDistance: z.number().nullable().default(null),
    days: z.number().int().min(1).max(730).default(90),
    titleContains: z.string().nullable().default(null),
    limit: z.number().int().min(1).max(50).default(20),
    sortBy: z.enum(['date', 'distance', 'pace', 'avgHR']).default('date'),
    ascending: z.boolean().default(false),
  }),
  compare_activities: z.object({
    activityId1: z.string().min(1),
    activityId2: z.string().min(1),
  }),
  get_week_summary: z.object({ weeksAgo: z.number().int().min(0).max(52).default(0) }),
  get_training_load: DaysSchema,
  get_health_metrics: DaysSchema,
  get_training_plan: z.object({ week: z.number().int().min(1).max(52).nullable().default(null) }),
  get_goal: z.object({}),
  get_personal_bests: z.object({}),
  get_running_trend: DaysSchema,
  get_plan_changes: DaysSchema,
  calculate_pace_hr_efficiency: ActivityIdSchema,
  get_weekly_volume: z.object({ weeks: z.number().int().min(1).max(52).default(8) }),
} as const;

export type ToolName = keyof typeof TOOL_SCHEMAS;

/** Descriptions given to the language model when it selects a tool. */
export const TOOL_DESCRIPTIONS: Record<ToolName, string> = {
  get_activity: 'Get every recorded detail of one specific activity by its id.',
  search_activities:
    'Find activities matching filters: sport, distance range, how far back to look, words in the title. Use this for questions like "runs longer than 15 km" or "my last five long runs".',
  compare_activities: 'Compare two activities metric by metric.',
  get_week_summary:
    'Summarise one training week. weeksAgo 0 is the current week, 1 is last week.',
  get_training_load:
    'Training load over a period: the 7-day total, the 28-day total, and how they compare.',
  get_health_metrics:
    'Sleep, resting heart rate, stress and readiness against the athlete’s own baseline.',
  get_training_plan:
    'The prescribed sessions for a training week, and whether each was completed.',
  get_goal: 'The current training goal: event, date, target time and how far away it is.',
  get_personal_bests: 'Best times over standard distances, and longest run and ride.',
  get_running_trend:
    'Whether running is improving: pace at a comparable heart rate, and aerobic efficiency over time.',
  get_plan_changes:
    'Automatic changes made to the training plan, with the reasons and the numbers behind them.',
  calculate_pace_hr_efficiency:
    'The pace, heart rate and aerobic efficiency of one activity, against comparable recent sessions.',
  get_weekly_volume: 'Weekly distance and training time, broken down by sport.',
};

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

const activitySummary = (row: {
  id: string;
  date: Date;
  sport: string;
  title: string;
  duration: number;
  distance: number | null;
  avgHR: number | null;
  avgPace: number | null;
  trainingLoad: number | null;
}) => ({
  id: row.id,
  date: dateKey(row.date),
  sport: row.sport,
  title: row.title,
  distance: row.distance,
  distanceText: formatDistance(row.distance),
  duration: row.duration,
  durationText: formatDuration(row.duration),
  avgPace: row.avgPace,
  paceText: formatPace(row.avgPace),
  avgHR: row.avgHR,
  trainingLoad: row.trainingLoad,
});

async function getActivity(userId: string, args: { activityId: string }) {
  const row = await prisma.activity.findFirst({
    where: { id: args.activityId, userId },
    include: { splits: { orderBy: { splitNumber: 'asc' } } },
  });

  if (!row) {
    return result('get_activity', args, null, {}, 'No activity with that id was found.');
  }

  const raw = parseJSON<ActivityRawData>(row.rawData, {});

  return result(
    'get_activity',
    args,
    {
      ...activitySummary(row),
      maxHR: row.maxHR,
      elevationGain: row.elevationGain,
      cadence: row.cadence,
      averagePower: row.averagePower,
      calories: row.calories,
      aerobicTrainingEffect: row.aerobicTrainingEffect,
      source: row.source,
      efficiency: efficiencyFactor(row),
      splits: row.splits.map((s) => ({
        km: s.splitNumber,
        pace: s.pace,
        paceText: formatPace(s.pace),
        avgHR: s.avgHR,
        elevation: s.elevation,
      })),
      missingMetrics: raw.notes ?? [],
    },
    {
      activityIds: [row.id],
      dateRange: range(row.date, row.date),
      howCalculated: [LOAD_EXPLANATION],
    },
  );
}

async function searchActivities(
  userId: string,
  args: z.infer<typeof TOOL_SCHEMAS.search_activities>,
) {
  const since = addDays(startOfDay(new Date()), -args.days);

  let rows = await prisma.activity.findMany({
    where: {
      userId,
      date: { gte: since },
      ...(args.sport ? { sport: args.sport } : {}),
      ...(args.minDistance != null ? { distance: { gte: args.minDistance } } : {}),
      ...(args.titleContains ? { title: { contains: args.titleContains } } : {}),
    },
    orderBy: { date: 'desc' },
    select: {
      id: true,
      date: true,
      sport: true,
      title: true,
      duration: true,
      distance: true,
      avgHR: true,
      avgPace: true,
      trainingLoad: true,
    },
  });

  // Applied here rather than in the query so a null distance is excluded rather
  // than treated as zero.
  if (args.maxDistance != null) {
    rows = rows.filter((r) => r.distance != null && r.distance <= args.maxDistance!);
  }

  const direction = args.ascending ? 1 : -1;
  rows.sort((a, b) => {
    switch (args.sortBy) {
      case 'distance':
        return ((a.distance ?? 0) - (b.distance ?? 0)) * direction;
      case 'pace':
        // Missing paces sort last whichever direction is asked for.
        return ((a.avgPace ?? Infinity) - (b.avgPace ?? Infinity)) * direction;
      case 'avgHR':
        return ((a.avgHR ?? Infinity) - (b.avgHR ?? Infinity)) * direction;
      default:
        return (a.date.getTime() - b.date.getTime()) * direction;
    }
  });

  const limited = rows.slice(0, args.limit);

  return result(
    'search_activities',
    args,
    {
      count: limited.length,
      totalMatching: rows.length,
      activities: limited.map(activitySummary),
    },
    {
      activityIds: limited.map((r) => r.id),
      dateRange: range(since, new Date()),
    },
    limited.length === 0 ? 'No activities matched those filters.' : null,
  );
}

async function compareTwo(
  userId: string,
  args: { activityId1: string; activityId2: string },
) {
  const rows = await prisma.activity.findMany({
    where: { userId, id: { in: [args.activityId1, args.activityId2] } },
  });

  const first = rows.find((r) => r.id === args.activityId1);
  const second = rows.find((r) => r.id === args.activityId2);

  if (!first || !second) {
    return result(
      'compare_activities',
      args,
      null,
      {},
      'One or both of those activities could not be found.',
    );
  }

  // Present them oldest first, so "the change" always reads forwards in time.
  const [earlier, later] =
    first.date <= second.date ? [first, second] : [second, first];

  const comparison = compareActivities(toActivityLike(earlier), toActivityLike(later));

  return result(
    'compare_activities',
    args,
    {
      earlier: activitySummary(earlier),
      later: activitySummary(later),
      comparable: comparison.comparable,
      comparabilityNote: comparison.comparabilityNote,
      metrics: comparison.metrics.map((m) => ({
        label: m.label,
        earlier: m.a,
        later: m.b,
        change: m.delta,
        percentChange: m.percentChange,
        format: m.format,
      })),
      observations: comparison.observations,
    },
    {
      activityIds: [earlier.id, later.id],
      dateRange: range(earlier.date, later.date),
      howCalculated: [EFFICIENCY_EXPLANATION],
    },
  );
}

async function getWeekSummary(userId: string, args: { weeksAgo: number }) {
  const start = addDays(startOfWeek(new Date()), -args.weeksAgo * 7);
  const end = addDays(start, 6);

  const activities = await loadActivities(userId, addDays(start, -1));
  const inWeek = activities.filter((a) => a.date >= start && a.date <= addDays(end, 1));
  const volume = volumeForPeriod(activities, start, addDays(end, 1));

  return result(
    'get_week_summary',
    args,
    {
      weekStart: dateKey(start),
      weekEnd: dateKey(end),
      activityCount: volume.activityCount,
      totalDuration: volume.totalDuration,
      totalDurationText: formatDuration(volume.totalDuration),
      totalLoad: volume.totalLoad,
      distanceBySport: volume.distanceBySport,
      runningDistanceText: formatDistance(volume.distanceBySport.running),
      activities: inWeek.map(activitySummary),
    },
    {
      activityIds: inWeek.map((a) => a.id),
      dateRange: range(start, end),
      howCalculated: [LOAD_EXPLANATION],
    },
    volume.activityCount === 0 ? 'No activities were recorded in that week.' : null,
  );
}

async function getTrainingLoad(userId: string, args: { days: number }) {
  const now = new Date();
  const activities = await loadActivities(userId, addDays(now, -(args.days + 28)));

  if (activities.length === 0) {
    return result('get_training_load', args, null, {}, 'No activities have been recorded.');
  }

  const summary = summariseLoad(activities, now);

  return result(
    'get_training_load',
    args,
    {
      acute7Day: summary.acute,
      chronic28Day: summary.chronic,
      averageWeek: summary.chronicWeekly,
      ratio: summary.ratio,
      previousWeek: summary.previousAcute,
      changeVsPreviousWeek: summary.acuteChange,
      interpretation: summary.interpretation,
    },
    {
      activityIds: activities.filter((a) => a.date >= addDays(now, -args.days)).map((a) => a.id),
      dateRange: range(addDays(now, -args.days), now),
      howCalculated: [LOAD_EXPLANATION, ACWR_EXPLANATION],
    },
  );
}

async function getHealthMetrics(userId: string, args: { days: number }) {
  const now = new Date();
  const health = await loadHealth(userId, addDays(now, -args.days));

  if (health.length === 0) {
    return result(
      'get_health_metrics',
      args,
      null,
      {},
      'No daily health data is available. Sleep, resting heart rate and readiness come from a Garmin sync or the demo data.',
    );
  }

  const status = assessRecovery(health, now);

  return result(
    'get_health_metrics',
    args,
    {
      status: status.status,
      summary: status.summary,
      indicatorsBelowBaseline: status.negativeIndicators,
      restingHR: status.restingHR,
      sleepDuration: status.sleepDuration,
      sleepScore: status.sleepScore,
      stress: status.stress,
      readiness: status.bodyBattery,
      evidence: status.evidence,
      daysOfData: health.length,
    },
    {
      dateRange: range(addDays(now, -args.days), now),
      howCalculated: [RECOVERY_EXPLANATION],
    },
  );
}

async function getTrainingPlan(userId: string, args: { week: number | null }) {
  const active = await getActivePlan(userId);
  if (!active) {
    return result(
      'get_training_plan',
      args,
      null,
      {},
      'No training plan exists yet. Set a goal to have one generated.',
    );
  }

  const { goal, plan } = active;
  const week = args.week ?? currentWeekNumber(plan.workouts, new Date()) ?? 1;
  const workouts = plan.workouts.filter((w) => w.weekNumber === week);

  if (workouts.length === 0) {
    return result(
      'get_training_plan',
      args,
      null,
      {},
      `The plan has no week ${week}. It runs from week 1 to week ${goal.trainingWeeks}.`,
    );
  }

  return result(
    'get_training_plan',
    args,
    {
      week,
      totalWeeks: goal.trainingWeeks,
      phase: workouts[0].phase,
      plannedDistance: workouts.reduce((s, w) => s + (w.targetDistance ?? 0), 0),
      workouts: workouts.map((w) => ({
        date: dateKey(w.date),
        weekday: w.date.toLocaleDateString('en-GB', { weekday: 'long' }),
        type: w.workoutType,
        description: w.description,
        distance: w.targetDistance,
        distanceText: formatDistance(w.targetDistance),
        paceRange: formatPaceRange(w.targetPaceMin, w.targetPaceMax),
        heartRateRange:
          w.targetHRMin != null ? `${w.targetHRMin}-${w.targetHRMax} bpm` : null,
        status: w.completionStatus,
        wasAdjusted: w.adaptationReason != null,
        adjustmentReason: w.adaptationReason,
        structure: parseJSON<WorkoutStep[]>(w.structureJSON, []),
      })),
    },
    { dateRange: range(workouts[0].date, workouts[workouts.length - 1].date) },
  );
}

async function getGoal(userId: string) {
  const active = await getActivePlan(userId);
  if (!active) {
    return result('get_goal', {}, null, {}, 'No training goal has been set.');
  }

  const { goal, plan } = active;
  const now = new Date();
  const daysAway = Math.ceil((goal.targetDate.getTime() - now.getTime()) / 86400000);
  const compliance = complianceToDate(plan.workouts, now);

  return result('get_goal', {}, {
    eventName: goal.eventName,
    goalType: goal.goalType,
    targetDate: dateKey(goal.targetDate),
    daysAway,
    weeksAway: Math.ceil(daysAway / 7),
    targetTime: goal.targetTime,
    targetTimeText: goal.targetTime ? formatDuration(goal.targetTime) : null,
    trainingWeeks: goal.trainingWeeks,
    sessionsPerWeek: goal.sessionsPerWeek,
    currentWeek: currentWeekNumber(plan.workouts, now),
    sessionsCompleted: compliance.sessionsCompleted,
    sessionsPlanned: compliance.sessionsPlanned,
    volumeCompliance: compliance.overallVolumeCompliance,
  });
}

async function getPersonalBests(userId: string) {
  const rows = await prisma.activity.findMany({
    where: { userId },
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

  const set = findPersonalRecords(
    rows.map((r) => ({
      id: r.id,
      date: r.date,
      sport: r.sport,
      title: r.title,
      distance: r.distance,
      duration: r.duration,
      stream: parseJSON<ActivityRawData>(r.rawData, {}).stream ?? [],
    })),
  );

  return result(
    'get_personal_bests',
    {},
    {
      records: set.records.map((r) => ({
        distance: r.label,
        time: r.time,
        timeText: formatDuration(r.time),
        pace: r.pace,
        paceText: formatPace(r.pace),
        date: dateKey(r.date),
        activityId: r.activityId,
        establishedFrom:
          r.method === 'stream'
            ? 'the fastest continuous stretch inside a recorded activity'
            : 'a whole activity of matching distance',
      })),
      longestRun: set.longestRun
        ? { distance: set.longestRun.distance, distanceText: formatDistance(set.longestRun.distance), date: dateKey(set.longestRun.date) }
        : null,
      longestRide: set.longestRide
        ? { distance: set.longestRide.distance, distanceText: formatDistance(set.longestRide.distance), date: dateKey(set.longestRide.date) }
        : null,
      whereNoRecordExists: set.notes,
    },
    {
      activityIds: set.records.map((r) => r.activityId),
      howCalculated: [RECORDS_EXPLANATION],
    },
  );
}

async function getRunningTrend(userId: string, args: { days: number }) {
  const now = new Date();
  const from = addDays(startOfDay(now), -args.days);
  const activities = await loadActivities(userId, from);

  const trend = efficiencyTrend(activities, from, now);
  const paceAtHR = paceAtComparableHR(activities, now);

  const hasAnything = trend.points.length > 0 || paceAtHR !== null;

  return result(
    'get_running_trend',
    args,
    hasAnything
      ? {
          efficiencySummary: trend.summary,
          isMeaningfulTrend: trend.meaningful,
          percentChange: trend.percentChange,
          trendStrengthR2: trend.regression?.r2 ?? null,
          runsAnalysed: trend.points.length,
          paceAtComparableHeartRate: paceAtHR
            ? {
                heartRate: paceAtHR.targetHR,
                recentPace: paceAtHR.recentPace,
                recentPaceText: formatPace(paceAtHR.recentPace),
                earlierPace: paceAtHR.earlierPace,
                earlierPaceText: formatPace(paceAtHR.earlierPace),
                secondsPerKmChange: paceAtHR.deltaSeconds,
                recentRuns: paceAtHR.recentCount,
                earlierRuns: paceAtHR.earlierCount,
              }
            : null,
        }
      : null,
    {
      activityIds: trend.points.map((p) => p.activityId),
      dateRange: range(from, now),
      howCalculated: [EFFICIENCY_EXPLANATION],
    },
    hasAnything
      ? null
      : 'There are not yet enough runs with heart-rate data to judge a trend.',
  );
}

async function getPlanChanges(userId: string, args: { days: number }) {
  const active = await getActivePlan(userId);
  if (!active) {
    return result('get_plan_changes', args, null, {}, 'No training plan exists yet.');
  }

  const since = addDays(startOfDay(new Date()), -args.days);
  const history = await getAdaptationHistory(active.plan.id);
  const recent = history.filter((h) => h.timestamp >= since);

  const changes = recent.filter((h) => h.previousWorkout !== null);

  return result(
    'get_plan_changes',
    args,
    {
      changeCount: changes.length,
      reviewCount: recent.length,
      changes: changes.map((h) => ({
        when: dateKey(h.timestamp),
        outcome: h.outcome,
        reason: h.reason,
        affectedWorkoutDate: h.affectedWorkout ? dateKey(h.affectedWorkout.date) : null,
        affectedWorkoutType: h.affectedWorkout?.workoutType ?? null,
        before: parseJSON<Record<string, unknown> | null>(h.previousWorkout, null),
        after: parseJSON<Record<string, unknown> | null>(h.updatedWorkout, null),
        metrics: parseJSON<Record<string, unknown>>(h.metricsUsed, {}),
        reverted: h.revertedAt !== null,
      })),
      // Reviews that deliberately changed nothing are part of the record too.
      latestReviewWithoutChange: recent.find((h) => h.previousWorkout === null)?.reason ?? null,
    },
    { dateRange: range(since, new Date()) },
    changes.length === 0
      ? 'No automatic changes have been made to the plan in that period.'
      : null,
  );
}

async function paceHrEfficiency(userId: string, args: { activityId: string }) {
  const row = await prisma.activity.findFirst({ where: { id: args.activityId, userId } });
  if (!row) {
    return result(
      'calculate_pace_hr_efficiency',
      args,
      null,
      {},
      'No activity with that id was found.',
    );
  }

  const efficiency = efficiencyFactor(row);
  if (efficiency === null) {
    return result(
      'calculate_pace_hr_efficiency',
      args,
      null,
      { activityIds: [row.id] },
      'That activity has no heart-rate or distance data, so aerobic efficiency cannot be calculated for it.',
    );
  }

  // Comparable sessions: same sport, similar distance, within the previous 6 weeks.
  const history = await loadActivities(userId, addDays(row.date, -42));
  const peers = history.filter(
    (a) =>
      a.sport === row.sport &&
      a.id !== row.id &&
      a.date < row.date &&
      a.distance != null &&
      row.distance != null &&
      a.distance / row.distance >= 0.75 &&
      a.distance / row.distance <= 1.33,
  );

  const peerEfficiencies = peers
    .map((p) => efficiencyFactor(p))
    .filter((v): v is number => v !== null);

  const peerAverage =
    peerEfficiencies.length > 0
      ? peerEfficiencies.reduce((a, b) => a + b, 0) / peerEfficiencies.length
      : null;

  return result(
    'calculate_pace_hr_efficiency',
    args,
    {
      activity: activitySummary(row),
      efficiency,
      comparableAverage: peerAverage,
      percentVsComparable:
        peerAverage != null ? (efficiency - peerAverage) / peerAverage : null,
      comparableSessions: peers.length,
    },
    {
      activityIds: [row.id, ...peers.map((p) => p.id)],
      dateRange: range(addDays(row.date, -42), row.date),
      howCalculated: [EFFICIENCY_EXPLANATION],
    },
    peerAverage === null
      ? 'There are no comparable recent sessions to measure this one against.'
      : null,
  );
}

async function getWeeklyVolume(userId: string, args: { weeks: number }) {
  const now = new Date();
  const from = addDays(startOfWeek(now), -(args.weeks - 1) * 7);
  const activities = await loadActivities(userId, from);
  const weeks = weeklyVolumes(activities, from, now);

  const runningTotal = weeks.reduce((s, w) => s + w.running, 0);

  return result(
    'get_weekly_volume',
    args,
    {
      weeks: weeks.map((w) => ({
        weekStart: w.weekStart,
        running: w.running,
        runningText: formatDistance(w.running),
        cycling: w.cycling,
        swimming: w.swimming,
        totalHours: w.totalHours,
        activityCount: w.activityCount,
        trainingLoad: w.totalLoad,
      })),
      averageWeeklyRunning: Math.round(runningTotal / Math.max(1, weeks.length)),
      averageWeeklyRunningText: formatDistance(runningTotal / Math.max(1, weeks.length)),
    },
    {
      activityIds: activities.map((a) => a.id),
      dateRange: range(from, now),
    },
    weeks.length === 0 ? 'No training data is available for that period.' : null,
  );
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

/**
 * Run one tool with unvalidated arguments.
 *
 * Arguments are parsed through the tool's schema first — the language model may
 * propose anything at all, and defaults are applied rather than the call
 * failing.
 */
export async function runTool(
  userId: string,
  name: string,
  rawArgs: unknown = {},
): Promise<ToolResult> {
  const schema = TOOL_SCHEMAS[name as ToolName];
  if (!schema) {
    return result(name, {}, null, {}, `There is no data tool called "${name}".`);
  }

  const parsed = schema.safeParse(rawArgs ?? {});
  if (!parsed.success) {
    return result(
      name,
      (rawArgs ?? {}) as Record<string, unknown>,
      null,
      {},
      `The arguments for ${name} were not valid: ${parsed.error.issues[0]?.message ?? 'unknown problem'}.`,
    );
  }

  const args = parsed.data as never;

  switch (name as ToolName) {
    case 'get_activity':
      return getActivity(userId, args);
    case 'search_activities':
      return searchActivities(userId, args);
    case 'compare_activities':
      return compareTwo(userId, args);
    case 'get_week_summary':
      return getWeekSummary(userId, args);
    case 'get_training_load':
      return getTrainingLoad(userId, args);
    case 'get_health_metrics':
      return getHealthMetrics(userId, args);
    case 'get_training_plan':
      return getTrainingPlan(userId, args);
    case 'get_goal':
      return getGoal(userId);
    case 'get_personal_bests':
      return getPersonalBests(userId);
    case 'get_running_trend':
      return getRunningTrend(userId, args);
    case 'get_plan_changes':
      return getPlanChanges(userId, args);
    case 'calculate_pace_hr_efficiency':
      return paceHrEfficiency(userId, args);
    case 'get_weekly_volume':
      return getWeeklyVolume(userId, args);
  }
}
