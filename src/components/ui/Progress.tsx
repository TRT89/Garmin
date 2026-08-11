import { clsx } from 'clsx';

/**
 * A horizontal progress bar (weekly volume completed, compliance, goal
 * progress). Values above 100% are shown full but the label still reports the
 * true figure, so overshooting a target is visible rather than hidden.
 */
export function Progress({
  value,
  max = 1,
  tone = 'accent',
  className,
  showBlocks = false,
}: {
  value: number;
  max?: number;
  tone?: 'accent' | 'good' | 'caution' | 'alert' | 'info';
  className?: string;
  /** Renders the segmented "████████░░" style used on the dashboard. */
  showBlocks?: boolean;
}) {
  const raw = max > 0 ? value / max : 0;
  const fraction = Math.max(0, Math.min(1, raw));

  const fill = {
    accent: 'bg-accent',
    good: 'bg-good',
    caution: 'bg-caution',
    alert: 'bg-alert',
    info: 'bg-info',
  }[tone];

  if (showBlocks) {
    const filled = Math.round(fraction * 10);
    const text = {
      accent: 'text-accent',
      good: 'text-good',
      caution: 'text-caution',
      alert: 'text-alert',
      info: 'text-info',
    }[tone];
    return (
      <span className={clsx('tnum font-mono text-sm tracking-tight', text, className)}>
        {'█'.repeat(filled)}
        <span className="text-line">{'░'.repeat(10 - filled)}</span>
      </span>
    );
  }

  return (
    <div
      className={clsx('h-2 w-full overflow-hidden rounded-full bg-line', className)}
      role="progressbar"
      aria-valuenow={Math.round(raw * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={clsx('h-full rounded-full transition-[width] duration-500', fill)}
        style={{ width: `${fraction * 100}%` }}
      />
    </div>
  );
}
