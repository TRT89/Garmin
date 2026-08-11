'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';

/**
 * Export and import the whole database as one JSON file.
 *
 * Import replaces everything rather than merging, which the confirmation makes
 * explicit — a half-merged database would be worse than either state.
 */
export function DataTransfer() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null);

  async function importFile(files: FileList | null) {
    if (!files || files.length === 0) return;

    const confirmed = window.confirm(
      'Importing replaces everything currently in your database — activities, health records, goals, plans and chat history. This cannot be undone. Continue?',
    );
    if (!confirmed) {
      if (inputRef.current) inputRef.current.value = '';
      return;
    }

    setBusy(true);
    setMessage(null);

    const form = new FormData();
    form.append('file', files[0]);

    try {
      const response = await fetch('/api/data/import', { method: 'POST', body: form });
      const body = await response.json();

      if (!response.ok || !body.ok) {
        setMessage({ tone: 'bad', text: body.error ?? 'The import failed.' });
      } else {
        setMessage({
          tone: 'good',
          text: `Restored ${body.activities} activities and ${body.healthRecords} health records.`,
        });
        router.refresh();
      }
    } catch {
      setMessage({ tone: 'bad', text: 'Could not reach the application server.' });
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => void importFile(e.target.files)}
      />

      <div className="flex flex-wrap gap-3">
        <a
          href="/api/data/export"
          download
          className="inline-flex h-10 items-center justify-center rounded-lg border border-line bg-surface-raised px-4 text-sm text-ink transition-colors hover:border-line-strong hover:bg-surface-hover"
        >
          Export data
        </a>
        <Button variant="secondary" disabled={busy} onClick={() => inputRef.current?.click()}>
          {busy ? 'Importing…' : 'Import data'}
        </Button>
      </div>

      <p className="mt-3 text-xs leading-relaxed text-ink-muted">
        Export writes a single readable JSON file containing everything the application holds.
        Keep it as a backup, or use it to move your training to another computer.
      </p>

      {message && (
        <p
          className={`mt-3 rounded-lg border p-3 text-xs ${
            message.tone === 'good'
              ? 'border-good/25 bg-good/5 text-good'
              : 'border-alert/30 bg-alert/5 text-alert'
          }`}
        >
          {message.text}
        </p>
      )}
    </div>
  );
}
