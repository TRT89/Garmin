import { clsx } from 'clsx';
import type { ReactNode } from 'react';
import { CALCULATED_LABEL, type Phase, type Sport, type WorkoutType } from '@/lib/constants';

export type BadgeTone =
  | 'neutral'
  | 'good'
  | 'caution'
  | 'alert'
  | 'info'
  | 'accent'
  | 'running'
  | 'cycling'
  | 'swimming';

const TONES: Record<BadgeTone, string> = {
  neutral: 'border-line bg-surface-raised text-ink-muted',
  good: 'border-good/30 bg-good/10 text-good',
  caution: 'border-caution/30 bg-caution/10 text-caution',
  alert: 'border-alert/30 bg-alert/10 text-alert',
  info: 'border-info/30 bg-info/10 text-info',
  accent: 'border-accent/30 bg-accent/10 text-accent',
  running: 'border-sport-running/30 bg-sport-running/10 text-sport-running',
  cycling: 'border-sport-cycling/30 bg-sport-cycling/10 text-sport-cycling',
  swimming: 'border-sport-swimming/30 bg-sport-swimming/10 text-sport-swimming',
};

export function Badge({
  children,
  tone = 'neutral',
  className,
}: {
  children: ReactNode;
  tone?: BadgeTone;
  className?: string;
}) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-2 py-0.5 text-[11px] font-medium',
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Sport badges always use the same colour as that sport's chart series. */
export function SportBadge({ sport }: { sport: string }) {
  const tone: BadgeTone =
    sport === 'running' || sport === 'cycling' || sport === 'swimming' ? sport : 'neutral';
  return <Badge tone={tone}>{sport.charAt(0).toUpperCase() + sport.slice(1)}</Badge>;
}

const WORKOUT_TONES: Record<WorkoutType, BadgeTone> = {
  EASY: 'good',
  LONG_RUN: 'info',
  TEMPO: 'caution',
  INTERVAL: 'alert',
  RECOVERY: 'accent',
  REST: 'neutral',
};

export function WorkoutBadge({ type, label }: { type: WorkoutType; label?: string }) {
  return <Badge tone={WORKOUT_TONES[type] ?? 'neutral'}>{label ?? type.replace('_', ' ')}</Badge>;
}

const PHASE_TONES: Record<Phase, BadgeTone> = {
  BASE: 'info',
  BUILD: 'accent',
  PEAK: 'caution',
  TAPER: 'good',
};

export function PhaseBadge({ phase }: { phase: Phase }) {
  return <Badge tone={PHASE_TONES[phase] ?? 'neutral'}>{phase}</Badge>;
}

/**
 * Marks a figure this application worked out itself.
 *
 * Used to keep a clear line between our transparent calculations and the
 * proprietary values a Garmin device reports (Training Effect, Body Battery…).
 */
export function CalculatedBadge({ className }: { className?: string }) {
  return (
    <Badge tone="neutral" className={clsx('font-normal', className)}>
      {CALCULATED_LABEL}
    </Badge>
  );
}

/** Explicit "the device reported this" marker, the counterpart to the above. */
export function DeviceBadge({ className }: { className?: string }) {
  return (
    <Badge tone="neutral" className={clsx('font-normal', className)}>
      Reported by device
    </Badge>
  );
}

export type { Sport };
