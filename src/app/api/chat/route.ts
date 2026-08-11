import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getUser } from '@/lib/db';
import { ask, clearConversation } from '@/ai/chat';

const AskSchema = z.object({ question: z.string().min(1).max(1000) });

/** Answer one question from the athlete's own data. */
export async function POST(request: Request) {
  try {
    const parsed = AskSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: 'Please enter a question.' },
        { status: 400 },
      );
    }

    const user = await getUser();
    const answer = await ask(user.id, parsed.data.question);

    return NextResponse.json({ ok: true, ...answer });
  } catch (error) {
    console.error('The coach failed to answer:', error);
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error ? error.message : 'The coach could not answer that question.',
      },
      { status: 500 },
    );
  }
}

/** Clear the conversation. Training data is not touched. */
export async function DELETE() {
  const user = await getUser();
  await clearConversation(user.id);
  return NextResponse.json({ ok: true });
}
