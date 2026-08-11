'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';

interface SyncStep {
  name: string;
  status: 'done' | 'skipped' | 'failed';
  detail: string;
}

interface SyncResponse {
  ok: boolean;
  error?: string;
  simulated?: boolean;
  steps?: SyncStep[];
  activitiesImported?: number;
  workoutsMatched?: number;
  adaptationsMade?: number;
}

const STATUS_MARKS = {
  done: { symbol: '✓', className: 'text-good' },
  skipped: { symbol: '–', className: 'text-ink-faint' },
  failed: { symbol: '✕', className: 'text-alert' },
} as const;

/**
 * Runs the sync pipeline and shows what each of its steps did.
 *
 * The step-by-step report is deliberate: a sync that silently changes the
 * training plan would be unsettling, so the athlete sees exactly what happened —
 * what was imported, what was matched, and whether the plan was adjusted.
 */
export function SyncButton({ lastSynced }: { lastSynced: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SyncResponse | null>(null);

  async function sync() {
    setBusy(true);
    setResult(null);

    try {
      const response = await fetch('/api/sync', { method: 'POST' });
      const body: SyncResponse = await response.json();
      setResult(body);
      if (body.ok) router.refresh();
    } catch {
      setResult({ ok: false, error: 'Could not reach the application server.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" onClick={sync} disabled={busy}>
          {busy ? 'Syncing…' : 'Sync Garmin'}
        </Button>
        <span className="text-xs text-ink-faint">Last synced: {lastSynced}</span>
      </div>

      {busy && (
        <p className="mt-3 animate-pulse-soft text-xs text-ink-muted">
          Retrieving data, calculating metrics, matching workouts and evaluating your plan…
        </p>
      )}

      {result && !result.ok && (
        <p className="mt-3 rounded-lg border border-alert/30 bg-alert/5 p-3 text-xs leading-relaxed text-alert">
          {result.error ?? 'The sync did not complete.'}
        </p>
      )}

      {result?.ok && result.steps && (
        <div className="mt-4 rounded-lg border border-line bg-surface-raised p-4">
          <div className="mb-3 flex items-center gap-2">
            <p className="text-xs font-semibold text-ink">Sync complete</p>
            {result.simulated && <Badge tone="neutral">Simulated demo sync</Badge>}
          </div>

          <ol className="space-y-2">
            {result.steps.map((step, i) => {
              const mark = STATUS_MARKS[step.status];
              return (
                <li key={i} className="flex items-start gap-2 text-xs">
                  <span className={`mt-0.5 shrink-0 font-bold ${mark.className}`}>
                    {mark.symbol}
                  </span>
                  <span>
                    <span className="text-ink">{step.name}</span>
                    <span className="block leading-relaxed text-ink-muted">{step.detail}</span>
                  </span>
                </li>
              );
            })}
          </ol>

          {result.simulated && (
            <p className="mt-3 border-t border-line pt-3 text-xs leading-relaxed text-ink-faint">
              This was a simulated sync using generated demo data, not a connection to Garmin.
              Configure the Garmin API in your .env file to sync real data.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
