import { NextResponse } from 'next/server';
import { getLLMProvider } from '@/ai/llm/ollama';

/**
 * Whether a language model is available.
 *
 * The interface uses this to show honestly how answers are being produced. The
 * coach works either way.
 */
export async function GET() {
  const status = await getLLMProvider().status();
  return NextResponse.json(status);
}
