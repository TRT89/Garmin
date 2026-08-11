/**
 * Ollama client.
 *
 * Ollama runs language models locally and is free. Nothing here costs money and
 * no data leaves the machine.
 *
 * The client speaks the standard OpenAI chat-completions format, which Ollama
 * serves at `/v1/chat/completions`. Because the base URL is configurable, the
 * same code also works against any other server speaking that format — LM
 * Studio, for instance — by changing `OLLAMA_BASE_URL` alone. No paid service is
 * configured by default, and none is required.
 */

import { env } from '@/lib/env';
import type { LLMMessage, LLMProvider, LLMStatus } from './provider';

/** Probes are short: a slow answer here should not hold up the interface. */
const STATUS_TIMEOUT_MS = 2500;
/** Generation on a local model can legitimately take a while. */
const COMPLETION_TIMEOUT_MS = 120_000;

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export class OllamaProvider implements LLMProvider {
  readonly id = 'ollama';

  constructor(
    private readonly baseUrl: string = env.ollama.baseUrl,
    private readonly model: string = env.ollama.model,
  ) {}

  /**
   * Check whether the server is running and has the configured model.
   *
   * Never throws: an unreachable server is an expected state, not an error, and
   * the interface simply shows that the coach is answering without a model.
   */
  async status(): Promise<LLMStatus> {
    const base: LLMStatus = {
      available: false,
      model: this.model,
      baseUrl: this.baseUrl,
      reason: null,
    };

    if (!this.model) {
      return {
        ...base,
        reason:
          'No model is configured. Set OLLAMA_MODEL in your .env file — for example OLLAMA_MODEL="llama3.1:8b".',
      };
    }

    try {
      // Ollama's native endpoint for listing installed models.
      const response = await fetchWithTimeout(
        `${this.baseUrl}/api/tags`,
        { method: 'GET' },
        STATUS_TIMEOUT_MS,
      );

      if (!response.ok) {
        return {
          ...base,
          reason: `The server at ${this.baseUrl} responded with status ${response.status}.`,
        };
      }

      const body = (await response.json()) as { models?: { name?: string }[] };
      const installed = (body.models ?? [])
        .map((m) => m.name)
        .filter((n): n is string => typeof n === 'string');

      // Ollama reports "llama3.1:8b"; a configured "llama3.1" should still match.
      const hasModel = installed.some(
        (name) => name === this.model || name.split(':')[0] === this.model.split(':')[0],
      );

      if (!hasModel) {
        return {
          ...base,
          modelMissing: true,
          availableModels: installed,
          reason: `Ollama is running, but the model "${this.model}" is not installed. Install it with "ollama pull ${this.model}".`,
        };
      }

      return { ...base, available: true };
    } catch (error) {
      const timedOut = error instanceof Error && error.name === 'AbortError';
      return {
        ...base,
        reason: timedOut
          ? `The server at ${this.baseUrl} did not respond in time.`
          : `Ollama is not running at ${this.baseUrl}. Start it with "ollama serve".`,
      };
    }
  }

  async complete(
    messages: LLMMessage[],
    options: { temperature?: number } = {},
  ): Promise<string> {
    const response = await fetchWithTimeout(
      `${this.baseUrl}/v1/chat/completions`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          messages,
          // Low by default: this job is faithful description, not creativity.
          temperature: options.temperature ?? 0.2,
          stream: false,
        }),
      },
      COMPLETION_TIMEOUT_MS,
    );

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(
        `The language model returned status ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`,
      );
    }

    const body = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };

    const content = body.choices?.[0]?.message?.content;
    if (!content) throw new Error('The language model returned an empty response.');

    return content.trim();
  }
}

/** The provider the application uses. One place to change if another is added. */
export function getLLMProvider(): LLMProvider {
  return new OllamaProvider();
}
