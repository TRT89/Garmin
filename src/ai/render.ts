/**
 * Turning tool results into an answer, without a language model.
 *
 * This is the coach's floor. When Ollama is not running, these templates produce
 * the answer from exactly the same structured results the model would have been
 * given — so the numbers are identical and only the prose is plainer.
 *
 * That matters for two reasons. The athlete gets a working coach without
 * installing anything, and every figure in an answer is traceable to a tool
 * result rather than to a model's memory.
 *
 * Output is Markdown, which the chat view renders.
 */

import {
  formatDistance,
  formatDuration,
  formatPace,
  formatPercentChange,
  formatDelta,
} from '@/lib/format';
import { WORKOUT_TYPE_LABELS, type WorkoutType } from '@/lib/constants';
import type { ToolResult } from './tools';

/** Format one comparison value according to the metric's own unit. */
function metricValue(value: number | null, format: string): string {
  if (value === null) return '—';
  switch (format) {
    case 'distance':
      return formatDistance(value);
    case 'duration':
      return formatDuration(value);
    case 'pace':
      return formatPace(value);
    case 'speed':
      return `${(value * 3.6).toFixed(1)} km/h`;
    case 'load':
      return value.toFixed(0);
    default:
      // Whole numbers (heart rate, cadence) print plainly. Aerobic efficiency is
      // a small fraction where the interesting digits are well past the third,
      // so it needs the extra precision to be worth showing at all.
      if (Number.isInteger(value)) return String(value);
      return value.toFixed(Math.abs(value) < 1 ? 5 : 1);
  }
}

function metricChange(change: number | null, format: string): string {
  if (change === null) return '—';

  switch (format) {
    case 'distance':
      return formatDelta(change / 1000, 'km', 1);
    case 'duration':
      return formatDelta(change, 's', 0);
    case 'pace':
      return formatDelta(change, 's/km', 0);
    case 'load':
      return formatDelta(change, '', 0);
    default:
      // "No change" should read as "0", never as "0.000".
      if (change === 0) return '0';
      if (Number.isInteger(change)) return formatDelta(change, '', 0);
      return formatDelta(change, '', Math.abs(change) < 0.01 ? 5 : 1);
  }
}

// ---------------------------------------------------------------------------
// Per-tool renderers
// ---------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-explicit-any */

function renderComparison(data: any): string {
  const lines: string[] = [];

  lines.push(
    `Comparing **${data.earlier.title}** (${data.earlier.date}) with **${data.later.title}** (${data.later.date}):`,
    '',
    '| Metric | Earlier | Later | Change |',
    '| --- | --- | --- | --- |',
  );

  for (const metric of data.metrics) {
    // A row where neither side has a value tells the reader nothing.
    if (metric.earlier === null && metric.later === null) continue;
    lines.push(
      `| ${metric.label} | ${metricValue(metric.earlier, metric.format)} | ${metricValue(
        metric.later,
        metric.format,
      )} | ${metricChange(metric.change, metric.format)} |`,
    );
  }

  lines.push('');
  if (!data.comparable && data.comparabilityNote) {
    lines.push(`⚠️ ${data.comparabilityNote}`, '');
  }
  for (const observation of data.observations) lines.push(observation);

  return lines.join('\n');
}

function renderTrend(data: any): string {
  const lines: string[] = [data.efficiencySummary];

  const paceAtHR = data.paceAtComparableHeartRate;
  if (paceAtHR) {
    const faster = paceAtHR.secondsPerKmChange < 0;
    lines.push(
      '',
      `At a comparable heart rate of about **${paceAtHR.heartRate} bpm**, your average pace over the last four weeks was **${paceAtHR.recentPaceText}**, against **${paceAtHR.earlierPaceText}** before that — ${
        faster ? 'a gain of' : 'slower by'
      } **${Math.abs(paceAtHR.secondsPerKmChange)} seconds per kilometre**.`,
      `That compares ${paceAtHR.recentRuns} recent runs with ${paceAtHR.earlierRuns} earlier ones.`,
    );
  }

  if (!data.isMeaningfulTrend) {
    lines.push(
      '',
      `The run-to-run variation is larger than the underlying trend, so this is not yet strong evidence either way (trend strength r² = ${data.trendStrengthR2 ?? 0}).`,
    );
  }

  return lines.join('\n');
}

function renderLoad(data: any): string {
  const lines = [
    `Your training load over the last 7 days is **${data.acute7Day}**, against an average week of **${data.averageWeek}** across the last 28 days.`,
  ];

  if (data.ratio != null) lines.push(`That is a ratio of **${data.ratio}**.`);

  if (data.changeVsPreviousWeek != null) {
    lines.push(
      `Compared with the previous week (${data.previousWeek}), this week is **${formatPercentChange(
        data.changeVsPreviousWeek,
      )}**.`,
    );
  }

  lines.push('', data.interpretation);
  return lines.join('\n');
}

function renderHealth(data: any): string {
  const lines = [data.summary];

  const rows: string[] = [];
  const add = (label: string, value: any, unit: string) => {
    if (!value || value.current === null) return;
    rows.push(
      `| ${label} | ${value.current}${unit} | ${value.baseline ?? '—'}${unit} | ${
        value.delta != null ? formatDelta(value.delta, unit.trim(), 0) : '—'
      } |`,
    );
  };

  add('Resting heart rate', data.restingHR, ' bpm');
  add('Sleep', data.sleepDuration, ' min');
  add('Sleep score', data.sleepScore, '');
  add('Stress', data.stress, '');
  add('Readiness', data.readiness, '');

  if (rows.length > 0) {
    lines.push(
      '',
      '| Indicator | Recent | 14-day baseline | Difference |',
      '| --- | --- | --- | --- |',
      ...rows,
    );
  }

  if (data.evidence?.length > 0) {
    lines.push('', ...data.evidence.map((e: string) => `- ${e}`));
  }

  return lines.join('\n');
}

function renderPlan(data: any): string {
  const lines = [
    `**Week ${data.week} of ${data.totalWeeks}** — ${data.phase} phase, ${formatDistance(
      data.plannedDistance,
    )} planned.`,
    '',
    '| Day | Session | Distance | Pace | Status |',
    '| --- | --- | --- | --- | --- |',
  ];

  for (const workout of data.workouts) {
    lines.push(
      `| ${workout.weekday} | ${
        WORKOUT_TYPE_LABELS[workout.type as WorkoutType] ?? workout.type
      } | ${workout.distanceText} | ${workout.paceRange} | ${workout.status} |`,
    );
  }

  // The hardest session is a common question, so name it explicitly.
  const order: Record<string, number> = { INTERVAL: 4, TEMPO: 3, LONG_RUN: 2, EASY: 1, RECOVERY: 0, REST: -1 };
  const hardest = [...data.workouts].sort(
    (a, b) => (order[b.type] ?? 0) - (order[a.type] ?? 0),
  )[0];

  if (hardest) {
    lines.push(
      '',
      `The most demanding session this week is **${hardest.weekday}** — ${hardest.description}.`,
    );
  }

  const adjusted = data.workouts.filter((w: any) => w.wasAdjusted);
  for (const workout of adjusted) {
    lines.push('', `⚠️ ${workout.weekday} was adjusted: ${workout.adjustmentReason}`);
  }

  return lines.join('\n');
}

function renderPlanChanges(data: any): string {
  if (data.changeCount === 0) {
    const lines = ['No automatic changes have been made to your plan in this period.'];
    if (data.latestReviewWithoutChange) {
      lines.push('', `The most recent review concluded: ${data.latestReviewWithoutChange}`);
    }
    return lines.join('\n');
  }

  const lines = [
    `${data.changeCount} change${data.changeCount === 1 ? '' : 's'} ${
      data.changeCount === 1 ? 'has' : 'have'
    } been made to your plan:`,
  ];

  for (const change of data.changes) {
    lines.push('', `**${change.when}** — ${change.outcome.replace(/_/g, ' ').toLowerCase()}`);
    if (change.before && change.after) {
      lines.push(`- Before: ${change.before.description}`);
      lines.push(`- After: ${change.after.description}`);
    }
    lines.push(`- Reason: ${change.reason}`);
    if (change.reverted) lines.push('- You have since reverted this change.');
  }

  return lines.join('\n');
}

function renderSearch(data: any): string {
  const lines = [
    `Found **${data.totalMatching}** matching ${
      data.totalMatching === 1 ? 'activity' : 'activities'
    }${data.count < data.totalMatching ? `, showing ${data.count}` : ''}:`,
    '',
    '| Date | Activity | Distance | Time | Pace | Avg HR |',
    '| --- | --- | --- | --- | --- | --- |',
  ];

  for (const activity of data.activities) {
    lines.push(
      `| ${activity.date} | ${activity.title} | ${activity.distanceText} | ${activity.durationText} | ${activity.paceText} | ${
        activity.avgHR ?? '—'
      } |`,
    );
  }

  return lines.join('\n');
}

function renderWeekSummary(data: any): string {
  const lines = [
    `Week beginning ${data.weekStart}: **${data.activityCount}** ${
      data.activityCount === 1 ? 'activity' : 'activities'
    }, **${data.totalDurationText}** of training, training load **${data.totalLoad.toFixed(0)}**.`,
    '',
    `- Running: ${formatDistance(data.distanceBySport.running)}`,
    `- Cycling: ${formatDistance(data.distanceBySport.cycling)}`,
    `- Swimming: ${formatDistance(data.distanceBySport.swimming)}`,
  ];

  if (data.activities.length > 0) {
    lines.push('', '| Date | Activity | Distance | Pace |', '| --- | --- | --- | --- |');
    for (const activity of data.activities) {
      lines.push(
        `| ${activity.date} | ${activity.title} | ${activity.distanceText} | ${activity.paceText} |`,
      );
    }
  }

  return lines.join('\n');
}

function renderGoal(data: any): string {
  const lines = [
    `You are training for **${data.eventName}** on ${data.targetDate} — **${data.weeksAway} week${
      data.weeksAway === 1 ? '' : 's'
    }** away.`,
  ];

  if (data.targetTimeText) lines.push(`Target time: **${data.targetTimeText}**.`);
  if (data.currentWeek) {
    lines.push(`You are in week **${data.currentWeek}** of ${data.trainingWeeks}.`);
  }
  if (data.sessionsPlanned > 0) {
    lines.push(
      `So far you have completed **${data.sessionsCompleted} of ${data.sessionsPlanned}** planned sessions${
        data.volumeCompliance != null
          ? `, covering ${Math.round(data.volumeCompliance * 100)}% of the planned distance`
          : ''
      }.`,
    );
  }

  return lines.join('\n');
}

function renderRecords(data: any): string {
  const lines: string[] = [];

  if (data.records.length > 0) {
    lines.push('| Distance | Time | Pace | Date |', '| --- | --- | --- | --- |');
    for (const record of data.records) {
      lines.push(
        `| ${record.distance} | ${record.timeText} | ${record.paceText} | ${record.date} |`,
      );
    }
  }

  if (data.longestRun) {
    lines.push('', `Longest run: **${data.longestRun.distanceText}** on ${data.longestRun.date}.`);
  }
  if (data.longestRide) {
    lines.push(`Longest ride: **${data.longestRide.distanceText}** on ${data.longestRide.date}.`);
  }

  // Being explicit about what could *not* be established matters as much as the
  // records themselves.
  if (data.whereNoRecordExists?.length > 0) {
    lines.push('', ...data.whereNoRecordExists.map((note: string) => `- ${note}`));
  }

  return lines.join('\n');
}

function renderActivity(data: any): string {
  const lines = [
    `**${data.title}** — ${data.date}`,
    '',
    `- Distance: ${data.distanceText}`,
    `- Duration: ${data.durationText}`,
    `- Pace: ${data.paceText}`,
    `- Average heart rate: ${data.avgHR ?? '—'}${data.avgHR ? ' bpm' : ''}`,
    `- Maximum heart rate: ${data.maxHR ?? '—'}${data.maxHR ? ' bpm' : ''}`,
    `- Elevation gain: ${data.elevationGain != null ? `${data.elevationGain} m` : '—'}`,
    `- Training load: ${data.trainingLoad?.toFixed(0) ?? '—'}`,
  ];

  if (data.splits?.length > 0) {
    lines.push('', '| KM | Pace | HR | Elevation |', '| --- | --- | --- | --- |');
    for (const split of data.splits.slice(0, 30)) {
      lines.push(
        `| ${split.km} | ${split.paceText} | ${split.avgHR ?? '—'} | ${
          split.elevation != null ? `${split.elevation > 0 ? '+' : ''}${split.elevation} m` : '—'
        } |`,
      );
    }
  }

  if (data.missingMetrics?.length > 0) {
    lines.push('', ...data.missingMetrics.map((note: string) => `- ${note}`));
  }

  return lines.join('\n');
}

function renderEfficiency(data: any): string {
  const lines = [
    `**${data.activity.title}** on ${data.activity.date}: ${data.activity.distanceText} at ${data.activity.paceText}, average heart rate ${data.activity.avgHR ?? '—'} bpm.`,
  ];

  if (data.comparableAverage != null) {
    const better = data.percentVsComparable > 0;
    lines.push(
      '',
      `Aerobic efficiency was **${data.efficiency.toFixed(5)}** metres per second per heartbeat, against **${data.comparableAverage.toFixed(
        5,
      )}** across ${data.comparableSessions} comparable recent sessions — ${
        better ? 'better' : 'lower'
      } by **${Math.abs(data.percentVsComparable * 100).toFixed(1)}%**.`,
    );
  }

  return lines.join('\n');
}

function renderWeeklyVolume(data: any): string {
  const lines = [
    `Your average weekly running distance is **${data.averageWeeklyRunningText}** across ${data.weeks.length} weeks.`,
    '',
    '| Week beginning | Running | Cycling | Swimming | Hours | Load |',
    '| --- | --- | --- | --- | --- | --- |',
  ];

  for (const week of data.weeks) {
    lines.push(
      `| ${week.weekStart} | ${week.runningText} | ${formatDistance(week.cycling)} | ${formatDistance(
        week.swimming,
      )} | ${week.totalHours} | ${week.trainingLoad.toFixed(0)} |`,
    );
  }

  return lines.join('\n');
}

const RENDERERS: Record<string, (data: any) => string> = {
  compare_activities: renderComparison,
  get_running_trend: renderTrend,
  get_training_load: renderLoad,
  get_health_metrics: renderHealth,
  get_training_plan: renderPlan,
  get_plan_changes: renderPlanChanges,
  search_activities: renderSearch,
  get_week_summary: renderWeekSummary,
  get_goal: renderGoal,
  get_personal_bests: renderRecords,
  get_activity: renderActivity,
  calculate_pace_hr_efficiency: renderEfficiency,
  get_weekly_volume: renderWeeklyVolume,
};

/* eslint-enable @typescript-eslint/no-explicit-any */

// ---------------------------------------------------------------------------
// Assembling the answer
// ---------------------------------------------------------------------------

/**
 * Render one tool's result.
 *
 * A tool that could not answer returns its reason, which is always more useful
 * than a generic apology.
 */
export function renderToolResult(result: ToolResult): string {
  if (result.unavailable && result.data === null) return result.unavailable;
  if (result.data === null) return 'No data was available for that.';

  const renderer = RENDERERS[result.tool];
  if (!renderer) return '```json\n' + JSON.stringify(result.data, null, 2) + '\n```';

  try {
    return renderer(result.data);
  } catch {
    // A rendering failure must not lose the data itself.
    return '```json\n' + JSON.stringify(result.data, null, 2) + '\n```';
  }
}

/** Render a whole answer from every tool that ran. */
export function renderAnswer(results: ToolResult[]): string {
  const sections = results.map(renderToolResult).filter((s) => s.trim().length > 0);

  if (sections.length === 0) {
    return 'I could not find any data to answer that.';
  }

  return sections.join('\n\n');
}
