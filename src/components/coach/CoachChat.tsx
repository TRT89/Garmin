'use client';

import { useEffect, useRef, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Markdown } from './Markdown';

interface Provenance {
  activityIds: string[];
  dateRange: { from: string; to: string } | null;
  howCalculated: string[];
}

interface ToolResult {
  tool: string;
  args: Record<string, unknown>;
  data: unknown;
  unavailable: string | null;
  provenance: Provenance;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  answeredBy?: 'ollama' | 'deterministic';
  interpretation?: string;
  toolResults?: ToolResult[];
  llmNotice?: string | null;
  failed?: boolean;
}

/** Questions that showcase what the coach can actually answer. */
const SUGGESTIONS = [
  'Compare my last two long runs',
  'Am I improving?',
  'Was my training load too high this week?',
  'What do I need to do this week?',
  'Why did my plan change?',
  'Show me all runs longer than 15 km from the last 3 months',
];

/**
 * The data behind an answer.
 *
 * Always available, never opened by default. The point is that any figure the
 * coach quotes can be traced to the tool call and raw result that produced it.
 */
function DataUsed({ results }: { results: ToolResult[] }) {
  if (results.length === 0) return null;

  return (
    <details className="group mt-3">
      <summary className="cursor-pointer list-none text-xs text-ink-faint hover:text-ink-muted marker:content-none">
        Data used{' '}
        <span className="inline-block transition-transform group-open:rotate-90">▶</span>
      </summary>

      <div className="mt-2 space-y-3 border-l border-line pl-3">
        {results.map((result, i) => (
          <div key={i}>
            <p className="font-mono text-xs text-ink-muted">
              {result.tool}({JSON.stringify(result.args)})
            </p>

            {result.provenance.dateRange && (
              <p className="mt-0.5 text-xs text-ink-faint">
                Period: {result.provenance.dateRange.from} to {result.provenance.dateRange.to}
              </p>
            )}

            {result.provenance.activityIds.length > 0 && (
              <p className="mt-0.5 text-xs text-ink-faint">
                {result.provenance.activityIds.length}{' '}
                {result.provenance.activityIds.length === 1 ? 'activity' : 'activities'} used —{' '}
                {result.provenance.activityIds.slice(0, 5).map((id, index) => (
                  <span key={id}>
                    {index > 0 && ', '}
                    <a href={`/activities/${id}`} className="underline hover:text-ink-muted">
                      view
                    </a>
                  </span>
                ))}
              </p>
            )}

            {result.provenance.howCalculated.map((note, index) => (
              <p key={index} className="mt-1 text-xs leading-relaxed text-ink-faint">
                {note}
              </p>
            ))}

            {result.unavailable && (
              <p className="mt-1 text-xs text-caution">{result.unavailable}</p>
            )}

            <details className="mt-1">
              <summary className="cursor-pointer text-xs text-ink-faint hover:text-ink-muted">
                Raw result
              </summary>
              <pre className="mt-1 max-h-64 overflow-auto rounded border border-line bg-base p-2 text-[10px] leading-relaxed text-ink-faint">
                {JSON.stringify(result.data, null, 2)}
              </pre>
            </details>
          </div>
        ))}
      </div>
    </details>
  );
}

export function CoachChat({ compact = false }: { compact?: boolean }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, busy]);

  async function send(question: string) {
    const trimmed = question.trim();
    if (!trimmed || busy) return;

    setMessages((prev) => [...prev, { role: 'user', content: trimmed }]);
    setInput('');
    setBusy(true);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: trimmed }),
      });
      const body = await response.json();

      setMessages((prev) => [
        ...prev,
        body.ok
          ? {
              role: 'assistant',
              content: body.answer,
              answeredBy: body.answeredBy,
              interpretation: body.interpretation,
              toolResults: body.toolResults,
              llmNotice: body.llmNotice,
            }
          : {
              role: 'assistant',
              content: body.error ?? 'Something went wrong answering that.',
              failed: true,
            },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: 'Could not reach the application server. Is it still running?',
          failed: true,
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className={`flex-1 space-y-4 overflow-y-auto ${compact ? 'max-h-[52vh]' : ''}`}>
        {messages.length === 0 && (
          <div>
            <p className="text-sm leading-relaxed text-ink-muted">
              Ask about your training. Every answer is calculated from your own data, and you can
              always see exactly which activities it came from.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => void send(suggestion)}
                  className="rounded-lg border border-line px-2.5 py-1.5 text-left text-xs text-ink-muted transition-colors hover:border-line-strong hover:text-ink"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((message, i) =>
          message.role === 'user' ? (
            <div key={i} className="flex justify-end">
              <p className="max-w-[85%] rounded-lg rounded-br-sm bg-accent/10 px-3 py-2 text-sm text-ink">
                {message.content}
              </p>
            </div>
          ) : (
            <div key={i} className="rounded-lg border border-line bg-surface-raised p-4">
              {message.llmNotice && (
                <p className="mb-3 rounded-md border border-caution/25 bg-caution/5 p-2.5 text-xs leading-relaxed text-caution">
                  {message.llmNotice}
                </p>
              )}

              {message.interpretation && (
                <p className="mb-2 text-xs text-ink-faint">{message.interpretation}</p>
              )}

              {message.failed ? (
                <p className="text-sm text-alert">{message.content}</p>
              ) : (
                <Markdown content={message.content} />
              )}

              {message.toolResults && <DataUsed results={message.toolResults} />}

              {message.answeredBy && (
                <div className="mt-3 flex items-center gap-2">
                  <Badge tone="neutral">
                    {message.answeredBy === 'ollama'
                      ? 'Worded by a local language model'
                      : 'Generated from your data without a language model'}
                  </Badge>
                </div>
              )}
            </div>
          ),
        )}

        {busy && (
          <p className="animate-pulse-soft text-xs text-ink-muted">
            Running the calculations on your data…
          </p>
        )}

        <div ref={endRef} />
      </div>

      <form
        className="mt-4 flex gap-2 border-t border-line pt-4"
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about your training…"
          disabled={busy}
          className="flex-1 rounded-lg border border-line bg-surface-raised px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-accent/50"
        />
        <Button type="submit" variant="primary" disabled={busy || input.trim() === ''}>
          Ask
        </Button>
      </form>
    </div>
  );
}
