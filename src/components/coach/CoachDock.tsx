'use client';

import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { CoachChat } from './CoachChat';

/**
 * The coach, reachable from every page.
 *
 * Collapsed to a single button until opened, so it never competes with the page
 * behind it. Hidden on the full coach page, where it would be redundant.
 */
export function CoachDock() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  if (pathname.startsWith('/coach')) return null;

  return (
    <>
      {open && (
        <div className="fixed bottom-20 right-5 z-50 flex max-h-[75vh] w-[min(30rem,calc(100vw-2.5rem))] flex-col rounded-card border border-line bg-surface shadow-card">
          <header className="flex items-center justify-between border-b border-line px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-md bg-accent text-xs font-bold text-base">
                AC
              </span>
              <h2 className="text-sm font-semibold">AI Coach</h2>
            </div>
            <div className="flex items-center gap-3">
              <a href="/coach" className="text-xs text-ink-faint hover:text-ink">
                Open full page
              </a>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close the coach"
                className="text-ink-faint transition-colors hover:text-ink"
              >
                ✕
              </button>
            </div>
          </header>

          <div className="flex-1 overflow-hidden p-4">
            <CoachChat compact />
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label={open ? 'Close the AI Coach' : 'Ask the AI Coach'}
        className="fixed bottom-5 right-5 z-50 flex h-12 items-center gap-2 rounded-full border border-line bg-surface-raised px-4 text-sm font-medium text-ink shadow-card transition-colors hover:border-line-strong hover:bg-surface-hover"
      >
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-accent text-xs font-bold text-base">
          AC
        </span>
        {open ? 'Close' : 'Ask the coach'}
      </button>
    </>
  );
}
