import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getUser, prisma } from '@/lib/db';
import { UNITS } from '@/lib/constants';

/**
 * Athlete profile.
 *
 * Maximum and resting heart rate matter more than they look: the training-load
 * calculation and all heart-rate guidance are derived from them, so the bounds
 * below reject values that would produce nonsense downstream.
 */
const ProfileSchema = z
  .object({
    name: z.string().min(1).max(80),
    age: z.number().int().min(10).max(100).nullable(),
    sex: z.enum(['male', 'female', 'other']).nullable(),
    height: z.number().min(100).max(250).nullable(),
    weight: z.number().min(30).max(250).nullable(),
    maxHR: z.number().int().min(120).max(230).nullable(),
    restingHR: z.number().int().min(25).max(110).nullable(),
    preferredUnits: z.enum(UNITS),
  })
  .refine(
    (data) => data.maxHR === null || data.restingHR === null || data.maxHR > data.restingHR,
    { message: 'Your maximum heart rate must be higher than your resting heart rate.' },
  );

export async function PUT(request: Request) {
  try {
    const parsed = ProfileSchema.safeParse(await request.json());

    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: parsed.error.issues[0]?.message ?? 'Those details are not valid.' },
        { status: 400 },
      );
    }

    const user = await getUser();
    await prisma.user.update({ where: { id: user.id }, data: parsed.data });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Failed to save the profile:', error);
    return NextResponse.json(
      { ok: false, error: 'Your profile could not be saved.' },
      { status: 500 },
    );
  }
}
