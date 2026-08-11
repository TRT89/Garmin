import { clsx } from 'clsx';
import type { ReactNode } from 'react';
import { formatPercentChange } from '@/lib/format';
import { InfoTip } from './InfoTip';

/**
 * Whether a rising number is good, bad, or simply neutral.
 *
 * This matters because "up" is not universally positive: more weekly distance
 * is usually good, a higher resting heart rate usually is not.
 */
export type DeltaDirection = 'up-good' | 'up-bad' | 'neutral';

function deltaTone(change: number, direction: DeltaDirection): string {
  if (direction === 'neutral' || change === 0) return 'text-ink-muted';
  const positive = change > 0;
  const isGood = direction === 'up-good' ? positive : !positive;
  return isGood ? 'text-good' : 'text-alert';
}

/**
 * The large KPI readout used throughout the dashboard.
 *
 * `change` is a fraction (0.08 = +8%) and is always accompanied by
 * `changeLabel` naming what it is compared against — a percentage with no
 * baseline is meaningless.
 */
export function Stat({
  label,
  value,
  unit,
  change,
  changeLabel,
  direction = 'up-good',
  info,
  size = 'md',
  accent,
  footer,
  className,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  change?: number | null;
  changeLabel?: string;
  direction?: DeltaDirection;
  info?: string;
  size?: 'sm' | 'md' | 'lg';
  /** Tints the value — used sparingly, for status readouts. */
  accent?: 'good' | 'caution' | 'alert' | 'info';
  footer?: ReactNode;
  className?: string;
}) {
  const accentClass = accent
    ? { good: 'text-good', caution: 'text-caution', alert: 'text-alert', info: 'text-info' }[accent]
    : 'text-ink';

  return (
    <div className={clsx('flex flex-col', className)}>
      <div className="flex items-center gap-1.5">
        <span className="eyebrow">{label}</span>
        {info && <InfoTip text={info} />}
      </div>

      <div className="mt-1.5 flex items-baseline gap-1.5">
        <span
          className={clsx(
            'tnum font-semibold',
            accentClass,
            size === 'lg' && 'text-kpi-lg',
            size === 'md' && 'text-kpi',
            size === 'sm' && 'text-xl',
          )}
        >
          {value}
        </span>
        {unit && <span className="text-sm font-medium text-ink-faint">{unit}</span>}
      </div>

      {change !== undefined && change !== null && (
        <div className="mt-1.5 flex items-center gap-1.5 text-xs">
          <span className={clsx('tnum font-medium', deltaTone(change, direction))}>
            {change > 0 ? '↑' : change < 0 ? '↓' : '→'} {formatPercentChange(change)}
          </span>
          {changeLabel && <span className="text-ink-faint">{changeLabel}</span>}
        </div>
      )}

      {footer && <div className="mt-1.5 text-xs text-ink-faint">{footer}</div>}
    </div>
  );
}
