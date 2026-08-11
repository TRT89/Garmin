import { NextResponse } from 'next/server';
import { resetDatabase } from '@/demo/load';

/**
 * Deletes everything: activities, health records, goals, plans and chat history.
 *
 * This is destructive and the interface confirms with the user before calling it.
 */
export async function POST() {
  try {
    await resetDatabase();
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Failed to reset the database:', error);
    return NextResponse.json(
      { ok: false, error: 'The database could not be reset.' },
      { status: 500 },
    );
  }
}
