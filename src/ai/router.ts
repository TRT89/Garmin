/**
 * Question → tool selection.
 *
 * The coach answers by running a data tool and describing its result. Choosing
 * *which* tool is done here, deterministically, by matching the question against
 * known shapes.
 *
 * Doing it this way rather than leaving the choice entirely to a language model
 * has two benefits: the common questions are answered identically every time,
 * and the coach still works when no model is running at all. When a model *is*
 * available it gets a chance to handle anything this router does not recognise
 * (see `chat.ts`).
 */

import { prisma } from '@/lib/db';
import { addDays, startOfDay } from '@/lib/dates';
import type { ToolName } from './tools';

export interface ToolCall {
  name: ToolName;
  args: Record<string, unknown>;
}

export interface RoutedIntent {
  calls: ToolCall[];
  /** How the question was understood, shown to the athlete. */
  interpretation: string;
  /** False when nothing matched and the question needs a model, or a shrug. */
  matched: boolean;
}

// ---------------------------------------------------------------------------
// Small parsing helpers
// ---------------------------------------------------------------------------

/** Any period mentioned in the question, in days. */
function extractDays(text: string, fallback: number): number {
  const weeks = text.match(/(\d+)\s*week/);
  if (weeks) return Math.min(730, Number(weeks[1]) * 7);

  const months = text.match(/(\d+)\s*month/);
  if (months) return Math.min(730, Number(months[1]) * 30);

  const days = text.match(/(\d+)\s*day/);
  if (days) return Math.min(730, Number(days[1]));

  if (/\byear\b/.test(text)) return 365;
  if (/\bthis week\b/.test(text)) return 7;
  if (/\blast week\b/.test(text)) return 14;
  if (/\brecent(ly)?\b/.test(text)) return 28;

  return fallback;
}

/** A distance in kilometres mentioned in the question, in metres. */
function extractDistance(text: string): number | null {
  const km = text.match(/(\d+(?:\.\d+)?)\s*(?:km|kilometre|kilometer|k\b)/);
  if (km) return Number(km[1]) * 1000;

  const miles = text.match(/(\d+(?:\.\d+)?)\s*(?:mi|mile)/);
  if (miles) return Number(miles[1]) * 1609.344;

  return null;
}

/** A count like "last five long runs" — words as well as digits. */
const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

function extractCount(text: string, fallback: number): number {
  const digits = text.match(/\b(\d+)\b/);
  if (digits) {
    const value = Number(digits[1]);
    if (value >= 1 && value <= 50) return value;
  }
  for (const [word, value] of Object.entries(NUMBER_WORDS)) {
    if (new RegExp(`\\b${word}\\b`).test(text)) return value;
  }
  return fallback;
}

function mentionedSport(text: string): 'running' | 'cycling' | 'swimming' | null {
  if (/\b(run|runs|running|ran|jog)\b/.test(text)) return 'running';
  if (/\b(ride|rides|cycling|bike|biking|cycle)\b/.test(text)) return 'cycling';
  if (/\b(swim|swims|swimming|swam)\b/.test(text)) return 'swimming';
  return null;
}

// ---------------------------------------------------------------------------
// Finding activities a question refers to
// ---------------------------------------------------------------------------

/** Words that identify a kind of session, mapped to a title fragment. */
function titleFilter(text: string): string | null {
  if (/\blong run/.test(text)) return 'Long';
  if (/\binterval|\brepeat/.test(text)) return 'Interval';
  if (/\btempo|\bthreshold/.test(text)) return 'Tempo';
  if (/\brecovery run/.test(text)) return 'Recovery';
  if (/\beasy run/.test(text)) return 'Easy';
  return null;
}

/**
 * Resolve the two activities a comparison question refers to.
 *
 * Handles "my last two long runs", "Sunday's run against last Sunday's", and the
 * general "my last two runs".
 */
async function resolveComparison(
  userId: string,
  text: string,
): Promise<{ ids: [string, string]; description: string } | null> {
  const sport = mentionedSport(text) ?? 'running';
  const title = titleFilter(text);

  // A specific weekday, as in "compare Sunday's run with last Sunday's".
  const weekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const weekdayIndex = weekdays.findIndex((d) => new RegExp(`\\b${d}\\b`).test(text));

  const rows = await prisma.activity.findMany({
    where: {
      userId,
      sport,
      ...(title ? { title: { contains: title } } : {}),
      ...(weekdayIndex >= 0 ? {} : {}),
    },
    orderBy: { date: 'desc' },
    select: { id: true, date: true, title: true },
    take: 60,
  });

  const candidates =
    weekdayIndex >= 0 ? rows.filter((r) => r.date.getDay() === weekdayIndex) : rows;

  if (candidates.length < 2) return null;

  const label = title ? `${title.toLowerCase()} runs` : `${sport} sessions`;
  return {
    ids: [candidates[1].id, candidates[0].id],
    description:
      weekdayIndex >= 0
        ? `your two most recent ${weekdays[weekdayIndex]} ${label}`
        : `your last two ${label}`,
  };
}

/** The most recent activity, for questions like "how was my last run?". */
async function latestActivity(userId: string, text: string) {
  const sport = mentionedSport(text);
  const title = titleFilter(text);

  return prisma.activity.findFirst({
    where: {
      userId,
      ...(sport ? { sport } : {}),
      ...(title ? { title: { contains: title } } : {}),
    },
    orderBy: { date: 'desc' },
    select: { id: true, title: true, date: true },
  });
}

// ---------------------------------------------------------------------------
// The router
// ---------------------------------------------------------------------------

/**
 * Work out which tools answer a question.
 *
 * Order matters: the more specific patterns are tested first, so "am I getting
 * faster on my long runs?" is treated as a trend question rather than a search.
 */
export async function routeQuestion(userId: string, question: string): Promise<RoutedIntent> {
  const text = question.toLowerCase().trim();

  const no = (): RoutedIntent => ({ calls: [], interpretation: '', matched: false });

  // --- Why did the plan change? ------------------------------------------
  if (
    /\bwhy\b/.test(text) &&
    /(chang|adjust|reduc|modif|alter|different)/.test(text)
  ) {
    return {
      calls: [{ name: 'get_plan_changes', args: { days: extractDays(text, 60) } }],
      interpretation: 'Looking up the automatic changes made to your plan, and their reasons.',
      matched: true,
    };
  }

  if (/(plan change|changes to my plan|adapt)/.test(text)) {
    return {
      calls: [{ name: 'get_plan_changes', args: { days: extractDays(text, 60) } }],
      interpretation: 'Looking up recent changes to your training plan.',
      matched: true,
    };
  }

  // --- Comparison ---------------------------------------------------------
  if (/\b(compare|versus|vs\.?|against|difference between)\b/.test(text)) {
    const pair = await resolveComparison(userId, text);
    if (pair) {
      return {
        calls: [
          {
            name: 'compare_activities',
            args: { activityId1: pair.ids[0], activityId2: pair.ids[1] },
          },
        ],
        interpretation: `Comparing ${pair.description}.`,
        matched: true,
      };
    }

    // "Compare my last five long runs" is a listing question, not a pairwise one.
    const count = extractCount(text, 5);
    if (count > 2) {
      return {
        calls: [
          {
            name: 'search_activities',
            args: {
              sport: mentionedSport(text) ?? 'running',
              titleContains: titleFilter(text),
              limit: count,
              days: 365,
            },
          },
        ],
        interpretation: `Listing your last ${count} matching sessions so they can be compared.`,
        matched: true,
      };
    }

    return no();
  }

  // --- Am I improving? ----------------------------------------------------
  if (
    /(getting faster|am i improving|improving|progress|getting fitter|fitness trend|faster than)/.test(
      text,
    )
  ) {
    return {
      calls: [
        { name: 'get_running_trend', args: { days: extractDays(text, 84) } },
        { name: 'get_weekly_volume', args: { weeks: 8 } },
      ],
      interpretation:
        'Checking your pace at a comparable heart rate, your aerobic efficiency and your recent volume.',
      matched: true,
    };
  }

  // --- Heart rate at easy pace -------------------------------------------
  if (/heart rate/.test(text) && /(chang|easy|trend|over time)/.test(text)) {
    return {
      calls: [{ name: 'get_running_trend', args: { days: extractDays(text, 84) } }],
      interpretation: 'Checking how your heart rate relates to your pace over time.',
      matched: true,
    };
  }

  // --- Training load ------------------------------------------------------
  if (/(training load|too high|too hard|overtrain|acute|chronic|load this week)/.test(text)) {
    return {
      calls: [
        { name: 'get_training_load', args: { days: extractDays(text, 28) } },
        { name: 'get_health_metrics', args: { days: 28 } },
      ],
      interpretation:
        'Comparing this week against your previous week and your four-week baseline, alongside your recovery data.',
      matched: true,
    };
  }

  // --- Recovery -----------------------------------------------------------
  if (/(recovery|recovered|sleep|resting heart rate|readiness|stress|tired|fatigue)/.test(text)) {
    return {
      calls: [{ name: 'get_health_metrics', args: { days: extractDays(text, 28) } }],
      interpretation: 'Checking your recovery indicators against your own baseline.',
      matched: true,
    };
  }

  // --- The plan -----------------------------------------------------------
  if (
    /(hardest workout|what do i need to do|what should i do|this week'?s? (training|plan|workout)|my plan|training plan|next (session|workout|run))/.test(
      text,
    )
  ) {
    return {
      calls: [
        { name: 'get_training_plan', args: { week: null } },
        { name: 'get_goal', args: {} },
      ],
      interpretation: 'Reading your training plan for this week.',
      matched: true,
    };
  }

  // --- Goal ---------------------------------------------------------------
  if (/(goal|race|event|marathon|target time|how long until)/.test(text)) {
    return {
      calls: [{ name: 'get_goal', args: {} }],
      interpretation: 'Reading your current training goal.',
      matched: true,
    };
  }

  // --- Personal bests -----------------------------------------------------
  if (/(personal best|personal record|\bpb\b|\bpr\b|fastest ever|best time|longest run)/.test(text)) {
    return {
      calls: [{ name: 'get_personal_bests', args: {} }],
      interpretation: 'Looking up your best recorded performances.',
      matched: true,
    };
  }

  // --- Weekly mileage -----------------------------------------------------
  if (/(weekly (mileage|volume|distance)|how (much|far) (do|have) i (run|ran)|average.*week)/.test(text)) {
    const days = extractDays(text, 56);
    return {
      calls: [{ name: 'get_weekly_volume', args: { weeks: Math.ceil(days / 7) } }],
      interpretation: `Adding up your weekly distance over the last ${Math.ceil(days / 7)} weeks.`,
      matched: true,
    };
  }

  // --- Week summary -------------------------------------------------------
  if (/(this week|last week|week summary|how was my week)/.test(text)) {
    return {
      calls: [{ name: 'get_week_summary', args: { weeksAgo: /last week/.test(text) ? 1 : 0 } }],
      interpretation: /last week/.test(text)
        ? 'Summarising last week’s training.'
        : 'Summarising this week’s training.',
      matched: true,
    };
  }

  // --- Finding activities -------------------------------------------------
  if (/(show me|find|list|which run|what runs|any runs|all runs|longer than|shorter than|lowest|highest)/.test(text)) {
    const distance = extractDistance(text);
    const longerThan = /(longer than|more than|over|above|at least)/.test(text);
    const shorterThan = /(shorter than|less than|under|below)/.test(text);

    const sortBy: 'date' | 'distance' | 'pace' | 'avgHR' = /lowest heart rate|lowest hr/.test(text)
      ? 'avgHR'
      : /fastest|quickest/.test(text)
        ? 'pace'
        : /longest/.test(text)
          ? 'distance'
          : 'date';

    return {
      calls: [
        {
          name: 'search_activities',
          args: {
            sport: mentionedSport(text),
            minDistance: distance != null && longerThan ? distance : null,
            maxDistance: distance != null && shorterThan ? distance : null,
            titleContains: titleFilter(text),
            days: extractDays(text, 90),
            limit: extractCount(text, 20),
            sortBy,
            ascending: sortBy === 'avgHR' || sortBy === 'pace',
          },
        },
      ],
      interpretation: 'Searching your activities.',
      matched: true,
    };
  }

  // --- A single recent activity ------------------------------------------
  if (/(my last|latest|most recent|yesterday|how was my)/.test(text)) {
    const activity = await latestActivity(userId, text);
    if (activity) {
      return {
        calls: [
          { name: 'get_activity', args: { activityId: activity.id } },
          { name: 'calculate_pace_hr_efficiency', args: { activityId: activity.id } },
        ],
        interpretation: `Looking at your most recent matching session (${activity.title}).`,
        matched: true,
      };
    }
  }

  return no();
}

/**
 * A fallback for questions nothing matched.
 *
 * Rather than refusing outright, the coach offers the athlete's current
 * position — which answers a surprising number of vague questions — and says
 * plainly that it did not understand.
 */
export async function fallbackIntent(userId: string): Promise<RoutedIntent> {
  const hasPlan = await prisma.trainingGoal.count({ where: { userId, isActive: true } });
  const since = addDays(startOfDay(new Date()), -7);
  const recent = await prisma.activity.count({ where: { userId, date: { gte: since } } });

  const calls: ToolCall[] = [{ name: 'get_week_summary', args: { weeksAgo: 0 } }];
  if (hasPlan > 0) calls.push({ name: 'get_training_plan', args: { week: null } });
  if (recent > 0) calls.push({ name: 'get_training_load', args: { days: 28 } });

  return {
    calls,
    interpretation: 'Showing where your training currently stands.',
    matched: false,
  };
}
