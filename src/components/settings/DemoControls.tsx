'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';

type State =
  | { kind: 'idle' }
  | { kind: 'working'; what: string }
  | { kind: 'done'; message: string }
  | { kind: 'error'; message: string };

/**
 * The demo data controls.
 *
 * Both actions really do what they say — loading writes twelve weeks of records
 * into the database, resetting deletes everything. The reset asks for
 * confirmation first because it cannot be undone.
 */
export function DemoControls({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: 'idle' });

  async function call(path: string, working: string, success: string) {
    setState({ kind: 'working', what: working });
    try {
      const response = await fetch(path, { method: 'POST' });
      const body = await response.json();

      if (!response.ok || !body.ok) {
        setState({ kind: 'error', message: body.error ?? 'Something went wrong.' });
        return;
      }

      setState({
        kind: 'done',
        message:
          body.activitiesCreated !== undefined
            ? `${success} ${body.activitiesCreated} activities and ${body.healthRecords} daily health records for ${body.athlete}.`
            : success,
      });
      router.refresh();
    } catch {
      setState({
        kind: 'error',
        message: 'Could not reach the application server. Is it still running?',
      });
    }
  }

  const busy = state.kind === 'working';

  return (
    <div>
      <div className="flex flex-wrap gap-3">
        <Button
          variant="primary"
          disabled={!enabled || busy}
          onClick={() => call('/api/demo/load', 'Generating twelve weeks of data…', 'Loaded')}
        >
          {busy && state.what.startsWith('Generating') ? 'Loading…' : 'Load Demo Athlete'}
        </Button>

        <Button
          variant="danger"
          disabled={busy}
          onClick={() => {
            const confirmed = window.confirm(
              'This deletes every activity, health record, goal, training plan and chat message in your local database. This cannot be undone. Continue?',
            );
            if (confirmed) {
              void call('/api/demo/reset', 'Clearing the database…', 'The database has been reset.');
            }
          }}
        >
          Reset Database
        </Button>
      </div>

      {!enabled && (
        <p className="mt-3 text-xs leading-relaxed text-caution">
          Demo mode is switched off. Set <code className="font-mono">DEMO_MODE=&quot;true&quot;</code>{' '}
          in your <code className="font-mono">.env</code> file to enable it.
        </p>
      )}

      {state.kind === 'working' && (
        <p className="mt-3 animate-pulse-soft text-xs text-ink-muted">{state.what}</p>
      )}
      {state.kind === 'done' && <p className="mt-3 text-xs text-good">{state.message}</p>}
      {state.kind === 'error' && <p className="mt-3 text-xs text-alert">{state.message}</p>}
    </div>
  );
}
