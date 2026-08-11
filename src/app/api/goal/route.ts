import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getUser } from '@/lib/db';
import { GOAL_SPORTS, GOAL_TYPES } from '@/lib/constants';
import { createGoalWithPlan } from '@/training/planService';

/**
 * Validation for the goal wizard.
 *
 * The bounds are deliberate: a plan shorter than four weeks cannot be
 * periodised, and more than six running days a week is not something this
 * application will prescribe.
 */
const GoalSchema = z.object({
  sport: z.enum(GOAL_SPORTS),
  goalType: z.enum(GOAL_TYPES),
  eventName: z.string().min(1).max(120),
  targetDate: z.string(),
  targetDistance: z.number().positive().nullable(),
  targetTime: z.number().positive().nullable(),
  trainingWeeks: z.number().int().min(4).max(40),
  sessionsPerWeek: z.number().int().min(3).max(6),
  longRunDay: z.number().int().min(0).max(6),
});

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = GoalSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: parsed.error.issues[0]?.message ?? 'Those goal details are not valid.' },
        { status: 400 },
      );
    }

    const targetDate = new Date(parsed.data.targetDate);
    if (Number.isNaN(targetDate.getTime())) {
      return NextResponse.json({ ok: false, error: 'That event date is not valid.' }, { status: 400 });
    }

    const user = await getUser();
    const { goal, plan } = await createGoalWithPlan(user.id, {
      ...parsed.data,
      targetDate,
    });

    return NextResponse.json({ ok: true, goalId: goal.id, planId: plan.id });
  } catch (error) {
    console.error('Failed to create the goal:', error);
    return NextResponse.json(
      { ok: false, error: 'The training plan could not be generated.' },
      { status: 500 },
    );
  }
}
