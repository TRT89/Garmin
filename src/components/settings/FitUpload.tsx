'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';

interface SyncStep {
  name: string;
  status: 'done' | 'skipped' | 'failed';
  detail: string;
}

interface UploadResponse {
  ok: boolean;
  error?: string;
  steps?: SyncStep[];
  failures?: { filename: string; error: string }[];
  filesAccepted?: number;
  filesRejected?: number;
  activitiesImported?: number;
  workoutsMatched?: number;
  adaptationReason?: string | null;
}

/**
 * Upload `.FIT` files exported from Garmin Connect or copied from a watch.
 *
 * Files that cannot be read are listed individually with the reason — a bad
 * file never fails the whole batch, and is never quietly replaced with
 * placeholder data.
 */
export function FitUpload() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<UploadResponse | null>(null);

  async function upload(files: FileList | null) {
    if (!files || files.length === 0) return;

    setBusy(true);
    setResult(null);

    const form = new FormData();
    for (const file of Array.from(files)) form.append('files', file);

    try {
      const response = await fetch('/api/fit/upload', { method: 'POST', body: form });
      const body: UploadResponse = await response.json();
      setResult(body);
      if (body.ok) router.refresh();
    } catch {
      setResult({ ok: false, error: 'Could not reach the application server.' });
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
        accept=".fit,application/octet-stream"
        multiple
        className="hidden"
        onChange={(e) => void upload(e.target.files)}
      />

      <Button variant="secondary" disabled={busy} onClick={() => inputRef.current?.click()}>
        {busy ? 'Importing…' : 'Choose FIT files'}
      </Button>

      <p className="mt-3 text-xs leading-relaxed text-ink-muted">
        In Garmin Connect, open an activity, then use the settings menu and choose{' '}
        <span className="text-ink">Export Original</span> to download its <code>.fit</code>{' '}
        file. Importing runs the same steps as a sync, so your plan is updated too.
      </p>

      {busy && (
        <p className="mt-3 animate-pulse-soft text-xs text-ink-muted">
          Decoding your files and updating your training…
        </p>
      )}

      {result && !result.ok && result.error && (
        <p className="mt-3 rounded-lg border border-alert/30 bg-alert/5 p-3 text-xs text-alert">
          {result.error}
        </p>
      )}

      {result?.ok && (
        <div className="mt-4 rounded-lg border border-line bg-surface-raised p-4">
          <p className="text-xs font-semibold text-ink">
            {result.filesAccepted === 0
              ? 'No files could be imported'
              : `Imported ${result.activitiesImported} ${
                  result.activitiesImported === 1 ? 'activity' : 'activities'
                }`}
          </p>

          {result.workoutsMatched != null && result.workoutsMatched > 0 && (
            <p className="mt-1 text-xs text-ink-muted">
              {result.workoutsMatched} matched a planned session.
            </p>
          )}

          {result.adaptationReason && (
            <p className="mt-2 text-xs leading-relaxed text-ink-muted">
              {result.adaptationReason}
            </p>
          )}

          {result.failures && result.failures.length > 0 && (
            <ul className="mt-3 space-y-1.5 border-t border-line pt-3">
              {result.failures.map((failure, i) => (
                <li key={i} className="text-xs leading-relaxed text-caution">
                  <span className="font-medium">{failure.filename}</span>: {failure.error}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
