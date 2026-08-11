import type { ReactNode } from 'react';

/**
 * Shown wherever there is genuinely nothing to display.
 *
 * An empty state always explains *why* it is empty and offers the one action
 * that would fill it — never a blank panel the athlete has to interpret.
 */
export function EmptyState({
  icon = '○',
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full border border-line bg-surface-raised text-lg text-ink-faint">
        {icon}
      </div>
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      <p className="mt-1.5 max-w-sm text-xs leading-relaxed text-ink-muted">{description}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** A one-line note explaining that a metric is missing from the source data. */
export function MissingData({ what, why }: { what: string; why?: string }) {
  return (
    <p className="text-xs leading-relaxed text-ink-faint">
      {what} is not available{why ? ` — ${why}` : ''}.
    </p>
  );
}
