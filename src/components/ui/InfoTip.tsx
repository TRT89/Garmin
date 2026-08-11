import { clsx } from 'clsx';

/**
 * A hover explanation for a calculated metric.
 *
 * Every number this application derives itself carries one of these, so the
 * athlete can always find out how it was worked out. Implemented with pure CSS
 * (group-hover + focus-within) so it stays a server component and needs no
 * JavaScript.
 */
export function InfoTip({ text, className }: { text: string; className?: string }) {
  return (
    <span className={clsx('group relative inline-flex align-middle', className)}>
      <button
        type="button"
        aria-label={text}
        className="flex h-4 w-4 items-center justify-center rounded-full border border-line text-[9px] font-bold text-ink-faint transition-colors hover:border-ink-muted hover:text-ink-muted"
      >
        i
      </button>
      <span
        role="tooltip"
        className="pointer-events-none absolute left-1/2 top-6 z-50 w-64 -translate-x-1/2 rounded-lg border border-line bg-surface-raised p-3 text-xs font-normal leading-relaxed text-ink-muted opacity-0 shadow-card transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100"
      >
        {text}
      </span>
    </span>
  );
}
