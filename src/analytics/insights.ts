/**
 * Insight generation — turning calculated numbers into short factual statements.
 *
 * This is the layer the dashboard's "Coach Summary" and the activity page's
 * "Workout Insights" are built from, and it is deliberately **not** the language
 * model. Every statement produced here is assembled from a value that was
 * actually computed, and carries the evidence that produced it.
 *
 * The language model, when available, rewrites these statements more fluently.
 * It is never the thing that decides what is true.
 */

import { formatDistance, formatPace, formatPaceDelta } from '@/lib/format';
import type { ActivityLike } from './activityMetrics';
import { efficiencyFactor } from './activityMetrics';
import type { RecoveryStatus } from './recovery';
import type { LoadSummary } from './trainingLoad';
import type { VolumeComparison } from './volume';
import type { EfficiencyTrend } from './trends';

/**
 * A single finding. `text` is what the athlete reads; `evidence` lists the
 * specific numbers behind it, so nothing is ever asserted without support.
 */
export interface Insight {
  text: string;
  evidence: string[];
  tone: 'positive' | 'neutral' | 'caution';
}

// ---------------------------------------------------------------------------
// Workout insights (activity detail page)
// ---------------------------------------------------------------------------

export interface WorkoutInsightInput {
  activity: ActivityLike;
  /** Recent activities of the same sport, used as the comparison baseline. */
  comparable: ActivityLike[];
  /** Heart-rate drift across the session, if a stream was available. */
  drift: number | null;
}

/**
 * Analyse one completed session against the athlete's recent comparable work.
 *
 * Returns an empty list when there is nothing genuinely notable — an honest
 * "nothing to report" is better than manufactured commentary.
 */
export function workoutInsights({
  activity,
  comparable,
  drift,
}: WorkoutInsightInput): Insight[] {
  const insights: Insight[] = [];

  // Only compare against sessions of broadly similar length, otherwise the
  // baseline is meaningless.
  const peers = comparable.filter((other) => {
    if (other.id === activity.id) return false;
    if (other.sport !== activity.sport) return false;
    if (activity.distance == null || other.distance == null) return false;
    const ratio = other.distance / activity.distance;
    return ratio >= 0.75 && ratio <= 1.33;
  });

  if (peers.length < 2) {
    insights.push({
      text: 'There are not yet enough similar sessions to compare this one against.',
      evidence: [`${peers.length} comparable ${activity.sport} sessions found in your history.`],
      tone: 'neutral',
    });
    return insights;
  }

  const mean = (values: (number | null)[]): number | null => {
    const usable = values.filter((v): v is number => v != null);
    return usable.length === 0 ? null : usable.reduce((a, b) => a + b, 0) / usable.length;
  };

  const peerPace = mean(peers.map((p) => p.avgPace));
  const peerHR = mean(peers.map((p) => p.avgHR));

  // --- Pace against the recent baseline ----------------------------------
  if (peerPace != null && activity.avgPace != null) {
    const delta = activity.avgPace - peerPace;
    const percent = (delta / peerPace) * 100;

    if (Math.abs(percent) >= 2) {
      const faster = delta < 0;
      insights.push({
        text: `This session was ${Math.abs(percent).toFixed(0)}% ${
          faster ? 'faster' : 'slower'
        } than your recent average for similar ${activity.sport} sessions.`,
        evidence: [
          `This session: ${formatPace(activity.avgPace)}`,
          `Recent average over ${peers.length} sessions: ${formatPace(Math.round(peerPace))}`,
          `Difference: ${formatPaceDelta(Math.round(delta))}`,
        ],
        tone: faster ? 'positive' : 'neutral',
      });
    }
  }

  // --- The combination that actually means something ----------------------
  // Faster than usual while the heart rate stayed put is the clearest available
  // sign of improved aerobic efficiency.
  if (
    peerPace != null &&
    peerHR != null &&
    activity.avgPace != null &&
    activity.avgHR != null
  ) {
    const paceDelta = activity.avgPace - peerPace;
    const hrDelta = activity.avgHR - peerHR;
    const pacePercent = (paceDelta / peerPace) * 100;

    if (pacePercent <= -2 && Math.abs(hrDelta) <= 2) {
      insights.push({
        text: `Your pace was ${Math.abs(pacePercent).toFixed(
          0,
        )}% faster than your recent average while your average heart rate was essentially unchanged, which is consistent with improved aerobic efficiency.`,
        evidence: [
          `Pace: ${formatPace(activity.avgPace)} against a recent average of ${formatPace(Math.round(peerPace))}`,
          `Average heart rate: ${activity.avgHR} bpm against a recent average of ${Math.round(peerHR)} bpm`,
        ],
        tone: 'positive',
      });
    } else if (hrDelta >= 5 && pacePercent >= -1) {
      insights.push({
        text: `Your average heart rate was ${Math.round(
          hrDelta,
        )} bpm higher than usual for this kind of session without a matching increase in pace. That can follow from fatigue, heat, or simply a harder day.`,
        evidence: [
          `Average heart rate: ${activity.avgHR} bpm against a recent average of ${Math.round(peerHR)} bpm`,
          `Pace: ${formatPace(activity.avgPace)} against a recent average of ${formatPace(Math.round(peerPace))}`,
        ],
        tone: 'caution',
      });
    }
  }

  // --- Heart-rate drift ---------------------------------------------------
  if (drift != null) {
    if (drift > 8) {
      insights.push({
        text: `Your heart rate climbed noticeably relative to your pace over the course of this session (${drift.toFixed(
          1,
        )}%), which usually means the effort cost more in the second half than the first.`,
        evidence: [
          `Speed-to-heart-rate ratio fell ${drift.toFixed(1)}% from the first half to the second.`,
        ],
        tone: 'caution',
      });
    } else if (drift < 3 && (activity.duration ?? 0) > 3600) {
      insights.push({
        text: `Your pace and heart rate stayed well coupled throughout (${drift.toFixed(
          1,
        )}% drift), which indicates the effort was comfortably within your aerobic capability.`,
        evidence: [
          `Speed-to-heart-rate ratio changed only ${drift.toFixed(1)}% between halves.`,
        ],
        tone: 'positive',
      });
    }
  }

  // --- Efficiency against peers -------------------------------------------
  const ef = efficiencyFactor(activity);
  const peerEfs = peers.map((p) => efficiencyFactor(p)).filter((v): v is number => v != null);
  if (ef != null && peerEfs.length >= 3) {
    const peerEf = peerEfs.reduce((a, b) => a + b, 0) / peerEfs.length;
    const percent = ((ef - peerEf) / peerEf) * 100;
    if (percent >= 3) {
      insights.push({
        text: `Aerobic efficiency on this session was ${percent.toFixed(
          0,
        )}% above your recent average for comparable work.`,
        evidence: [
          `Efficiency here: ${ef.toFixed(5)} m/s per heartbeat`,
          `Recent average: ${peerEf.toFixed(5)} m/s per heartbeat`,
        ],
        tone: 'positive',
      });
    }
  }

  if (insights.length === 0) {
    insights.push({
      text: 'This session was closely in line with your recent comparable training — nothing stands out in either direction.',
      evidence: [`Compared against ${peers.length} similar recent sessions.`],
      tone: 'neutral',
    });
  }

  return insights;
}

// ---------------------------------------------------------------------------
// Coach summary (dashboard)
// ---------------------------------------------------------------------------

export interface CoachSummaryInput {
  volume: VolumeComparison;
  load: LoadSummary;
  recovery: RecoveryStatus;
  efficiency: EfficiencyTrend;
  compliance?: {
    sessionsCompleted: number;
    sessionsPlanned: number;
    plannedDistance: number;
    actualDistance: number;
  } | null;
  goal?: {
    eventName: string;
    targetDate: Date;
    weeksRemaining: number;
  } | null;
}

export interface CoachSummary {
  /** The findings, in the order they should be read. */
  insights: Insight[];
  /** A single sentence recommending what to do next. */
  recommendation: string;
  /** Why that recommendation was made, each item traceable to a number. */
  recommendationReasons: string[];
  /** Overall training status, shown as the headline. */
  status: 'On Track' | 'Progressing' | 'Ease Back' | 'Building' | 'Insufficient Data';
}

/**
 * Build the dashboard summary entirely from computed values.
 *
 * The wording is fixed and template-based on purpose. The language model may
 * later rephrase this text, but it cannot change which findings appear or what
 * the numbers are.
 */
export function buildCoachSummary(input: CoachSummaryInput): CoachSummary {
  const { volume, load, recovery, efficiency, compliance, goal } = input;
  const insights: Insight[] = [];

  const runningNow = volume.current.distanceBySport.running ?? 0;
  const runningBefore = volume.previous.distanceBySport.running ?? 0;

  // --- Not enough data ----------------------------------------------------
  if (volume.current.activityCount === 0 && volume.previous.activityCount === 0) {
    return {
      insights: [
        {
          text: 'There is no training recorded in the last two weeks, so there is nothing to assess yet.',
          evidence: ['0 activities in the last 14 days.'],
          tone: 'neutral',
        },
      ],
      recommendation: 'Load some training data to get started.',
      recommendationReasons: ['No activities have been recorded recently.'],
      status: 'Insufficient Data',
    };
  }

  // --- Volume -------------------------------------------------------------
  if (runningBefore > 0) {
    const change = (runningNow - runningBefore) / runningBefore;
    if (Math.abs(change) >= 0.08) {
      insights.push({
        text: `Your running volume ${change > 0 ? 'increased' : 'decreased'} from ${formatDistance(
          runningBefore,
        )} to ${formatDistance(runningNow)} this week.`,
        evidence: [
          `Last 7 days: ${formatDistance(runningNow)}`,
          `Previous 7 days: ${formatDistance(runningBefore)}`,
        ],
        tone: change > 0 ? 'positive' : 'neutral',
      });
    } else {
      insights.push({
        text: `Your running volume held steady at ${formatDistance(runningNow)} this week.`,
        evidence: [
          `Last 7 days: ${formatDistance(runningNow)}`,
          `Previous 7 days: ${formatDistance(runningBefore)}`,
        ],
        tone: 'neutral',
      });
    }
  }

  // --- Compliance ---------------------------------------------------------
  if (compliance && compliance.sessionsPlanned > 0) {
    insights.push({
      text: `You completed ${compliance.sessionsCompleted} of ${compliance.sessionsPlanned} planned sessions this week.`,
      evidence: [
        `Planned distance: ${formatDistance(compliance.plannedDistance)}`,
        `Actual distance: ${formatDistance(compliance.actualDistance)}`,
      ],
      tone:
        compliance.sessionsCompleted >= compliance.sessionsPlanned ? 'positive' : 'neutral',
    });
  }

  // --- Fitness trend ------------------------------------------------------
  if (efficiency.meaningful) {
    insights.push({
      text: efficiency.summary,
      evidence: [
        `Based on ${efficiency.points.length} easy runs with heart-rate data.`,
        `Trend strength (r²): ${efficiency.regression?.r2 ?? 0}`,
      ],
      tone:
        efficiency.percentChange != null && efficiency.percentChange > 0
          ? 'positive'
          : 'neutral',
    });
  }

  // --- Load ---------------------------------------------------------------
  if (load.ratio != null) {
    insights.push({
      text: load.interpretation,
      evidence: [
        `7-day load: ${load.acute}`,
        `28-day load: ${load.chronic} (an average week of ${load.chronicWeekly})`,
        `Ratio: ${load.ratio}`,
      ],
      tone: load.ratio > 1.5 ? 'caution' : 'neutral',
    });
  }

  // --- Recovery -----------------------------------------------------------
  insights.push({
    text: recovery.summary,
    evidence: recovery.evidence.length > 0 ? recovery.evidence : ['All indicators near baseline.'],
    tone:
      recovery.status === 'compromised'
        ? 'caution'
        : recovery.status === 'good'
          ? 'positive'
          : 'neutral',
  });

  // --- Goal ---------------------------------------------------------------
  if (goal) {
    insights.push({
      text: `${goal.eventName} is ${goal.weeksRemaining} week${
        goal.weeksRemaining === 1 ? '' : 's'
      } away.`,
      evidence: [`Event date: ${goal.targetDate.toDateString()}`],
      tone: 'neutral',
    });
  }

  // --- Recommendation -----------------------------------------------------
  // Deliberately cautious: the strongest signals win, and a recommendation is
  // only made when the numbers support it.
  const reasons: string[] = [];
  let recommendation: string;
  let status: CoachSummary['status'];

  if (recovery.status === 'compromised' && recovery.negativeIndicators >= 3) {
    recommendation = 'Consider an easier session today.';
    reasons.push(...recovery.evidence);
    status = 'Ease Back';
  } else if (load.ratio != null && load.ratio > 1.5) {
    recommendation = 'Hold your volume steady for a few days rather than adding more.';
    reasons.push(
      `Your 7-day load of ${load.acute} is well above your average week of ${load.chronicWeekly}.`,
    );
    status = 'Ease Back';
  } else if (
    recovery.status === 'good' &&
    efficiency.meaningful &&
    efficiency.percentChange != null &&
    efficiency.percentChange > 0.01
  ) {
    recommendation = 'Continue with your current plan.';
    reasons.push(
      'Recovery indicators are at or better than your baseline.',
      efficiency.summary,
    );
    status = 'Progressing';
  } else if (volume.current.activityCount >= 3) {
    recommendation = 'Continue with your current plan.';
    reasons.push(
      `${volume.current.activityCount} sessions completed in the last 7 days.`,
      recovery.summary,
    );
    status = 'On Track';
  } else {
    recommendation = 'Aim for consistency over the coming week.';
    reasons.push(`Only ${volume.current.activityCount} sessions in the last 7 days.`);
    status = 'Building';
  }

  return { insights, recommendation, recommendationReasons: reasons, status };
}
