import { clsx } from 'clsx';
import type { ReactNode } from 'react';
import { InfoTip } from './InfoTip';

/**
 * The single card shell used across the whole application. Keeping one
 * component means padding, borders and header rhythm stay identical everywhere.
 */
export function Card({
  title,
  subtitle,
  info,
  action,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  /** Optional "how is this calculated?" text shown behind an ⓘ next to the title. */
  info?: string;
  /** Controls rendered on the right of the header (range switchers, links…). */
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={clsx('card flex flex-col', className)}>
      {(title || action) && (
        <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
              {title}
              {info && <InfoTip text={info} />}
            </h2>
            {subtitle && <p className="mt-0.5 text-xs text-ink-muted">{subtitle}</p>}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </header>
      )}
      <div className={clsx('flex-1 p-5', bodyClassName)}>{children}</div>
    </section>
  );
}
