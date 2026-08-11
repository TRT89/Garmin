/**
 * Chat orchestration.
 *
 * Ties the pieces together:
 *
 *     question
 *       → pick tools (deterministic router, with the model as a fallback)
 *       → run them against the database
 *       → structured results
 *       → put into words (the model if available, templates if not)
 *       → answer, plus the data it came from
 *
 * The answer's *content* is identical either way. Only the prose differs, which
 * is the whole point: the analytics are the source of truth and the model is a
 * presentation layer.
 */

import { prisma } from '@/lib/db';
import { getLLMProvider } from './llm/ollama';
import { SYSTEM_PROMPT, type LLMStatus } from './llm/provider';
import { fallbackIntent, routeQuestion, type ToolCall } from './router';
import { renderAnswer } from './render';
import { runTool, TOOL_DESCRIPTIONS, type ToolResult } from './tools';

export interface ChatAnswer {
  answer: string;
  /** "ollama" when a model worded it, "deterministic" when templates did. */
  answeredBy: 'ollama' | 'deterministic';
  /** How the question was understood. */
  interpretation: string;
  /** Every tool that ran, with its arguments and full result. */
  toolResults: ToolResult[];
  /** Present when the coach is running without a model. */
  llmNotice: string | null;
}

/**
 * Ask the model to choose a tool for a question the router did not recognise.
 *
 * Returns null on any difficulty at all — a failure here simply falls through to
 * the router's own fallback rather than breaking the answer.
 */
async function selectToolWithModel(question: string): Promise<ToolCall | null> {
  const provider = getLLMProvider();

  const catalogue = Object.entries(TOOL_DESCRIPTIONS)
    .map(([name, description]) => `- ${name}: ${description}`)
    .join('\n');

  const prompt = `The athlete asked: "${question}"

Choose the single most useful data tool from this list:

${catalogue}

Reply with JSON only, in the form {"name": "tool_name", "args": {}}. Do not explain.`;

  try {
    const raw = await provider.complete(
      [
        {
          role: 'system',
          content:
            'You select which data tool answers a question. You reply with JSON only, never prose.',
        },
        { role: 'user', content: prompt },
      ],
      { temperature: 0 },
    );

    // Models often wrap JSON in prose or a code fence, so take the first object.
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;

    const parsed = JSON.parse(match[0]) as { name?: string; args?: Record<string, unknown> };
    if (!parsed.name || !(parsed.name in TOOL_DESCRIPTIONS)) return null;

    return { name: parsed.name as ToolCall['name'], args: parsed.args ?? {} };
  } catch {
    return null;
  }
}

/** Ask the model to word an answer from the tool results. */
async function explainWithModel(
  question: string,
  results: ToolResult[],
): Promise<string | null> {
  const provider = getLLMProvider();

  // Only the tool output goes to the model — never the database, and never the
  // athlete's raw records beyond what the tools returned.
  const payload = results.map((r) => ({
    tool: r.tool,
    arguments: r.args,
    result: r.data,
    unavailable: r.unavailable,
    dataCameFrom: r.provenance,
  }));

  try {
    return await provider.complete([
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Question: ${question}

Here is the result computed by the application's analytics functions:

\`\`\`json
${JSON.stringify(payload, null, 2)}
\`\`\`

Answer the question using only these numbers.`,
      },
    ]);
  } catch {
    return null;
  }
}

/**
 * Answer one question.
 *
 * @param persist whether to store the exchange in the conversation history
 */
export async function ask(
  userId: string,
  question: string,
  persist = true,
): Promise<ChatAnswer> {
  const provider = getLLMProvider();
  const llmStatus: LLMStatus = await provider.status();

  // --- Pick the tools ----------------------------------------------------
  let intent = await routeQuestion(userId, question);

  if (!intent.matched && llmStatus.available) {
    const suggestion = await selectToolWithModel(question);
    if (suggestion) {
      intent = {
        calls: [suggestion],
        interpretation: `Interpreted as a question for ${suggestion.name.replace(/_/g, ' ')}.`,
        matched: true,
      };
    }
  }

  if (!intent.matched) {
    intent = await fallbackIntent(userId);
  }

  // --- Run them ----------------------------------------------------------
  const toolResults: ToolResult[] = [];
  for (const call of intent.calls) {
    toolResults.push(await runTool(userId, call.name, call.args));
  }

  // --- Word the answer ---------------------------------------------------
  const deterministic = renderAnswer(toolResults);
  let answer = deterministic;
  let answeredBy: ChatAnswer['answeredBy'] = 'deterministic';

  if (llmStatus.available) {
    const worded = await explainWithModel(question, toolResults);
    if (worded) {
      answer = worded;
      answeredBy = 'ollama';
    }
  }

  const llmNotice = llmStatus.available
    ? null
    : `Answering without a language model — ${llmStatus.reason ?? 'Ollama is not running.'} The figures below are calculated from your data either way; only the wording is plainer.`;

  if (persist) {
    await prisma.chatMessage.create({
      data: { userId, role: 'user', content: question },
    });
    await prisma.chatMessage.create({
      data: {
        userId,
        role: 'assistant',
        content: answer,
        answeredBy,
        toolTrace: JSON.stringify(
          toolResults.map((r) => ({
            tool: r.tool,
            args: r.args,
            provenance: r.provenance,
            unavailable: r.unavailable,
            data: r.data,
          })),
        ),
      },
    });
  }

  return {
    answer,
    answeredBy,
    interpretation: intent.interpretation,
    toolResults,
    llmNotice,
  };
}

/** The stored conversation, oldest first. */
export async function getConversation(userId: string, limit = 50) {
  const rows = await prisma.chatMessage.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
  return rows.reverse();
}

/** Clear the conversation. The training data itself is untouched. */
export async function clearConversation(userId: string) {
  await prisma.chatMessage.deleteMany({ where: { userId } });
}
