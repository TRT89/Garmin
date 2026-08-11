import Link from 'next/link';
import { clsx } from 'clsx';
import { WorkoutBadge, Badge } from '@/components/ui/Badge';
import { parseJSON, type WorkoutStep } from '@/lib/json';
import {
  formatDistance,
  formatPaceRange,
  formatWeekday,
  formatDateShort,
  formatDuration,
} from '@/lib/format';
import type { WorkoutType } from '@/lib/constants';

export interface WorkoutCardData {
  id: string;
  date: Date;
  workoutType: string;
  description: string;
  targetDistance: number | null;
  targetPaceMin: number | null;
  targetPaceMax: number | null;
  targetHRMin: number | null;
  targetHRMax: number | null;
  structureJSON: string | null;
  explanation: string | null;
  completionStatus: string;
  adaptationReason: string | null;
  userModified: boolean;
  linkedActivity?: {
    id: string;
    title: string;
    distance: number | null;
    duration: number;
    avgHR: number | null;
    avgPace: number | null;
  } | null;
}

const STATUS_STYLES: Record<string, string> = {
  completed: 'border-good/25',
  missed: 'border-alert/25',
  skipped: 'border-line opacity-60',
  planned: 'border-line',
};

/** Renders a structured workout as readable steps rather than raw JSON. */
function Structure({ steps }: { steps: WorkoutStep[] }) {
  if (steps.length <= 1) return null;

  return (
    <ol className="mt-3 space-y-1 border-l border-line pl-3">
      {steps.map((step, i) => (
        <li key={i} className="text-xs text-ink-muted">
          <span className="text-ink">
            {step.repeat && step.repeat > 1 ? `${step.repeat} × ` : ''}
            {step.distance ? formatDistance(step.distance, 'metric', step.distance < 1000 ? 2 : 1) : ''}
            {step.duration ? formatDuration(step.duration) : ''}
          </span>
          {step.paceMin && step.paceMax
            ? ` at ${formatPaceRange(step.paceMin, step.paceMax)}`
            : ''}
          {step.note ? ` — ${step.note}` : ''}
        </li>
      ))}
    </ol>
  );
}

/**
 * A single prescribed session.
 *
 * When a session has been completed, the actual result is shown directly beneath
 * the target so planned and actual can be compared at a glance.
 */
export function WorkoutCard({
  workout,
  compact = false,
}: {
  workout: WorkoutCardData;
  compact?: boolean;
}) {
  const steps = parseJSON<WorkoutStep[]>(workout.structureJSON, []);
  const isRest = workout.workoutType === 'REST';

  return (
    <div
      className={clsx(
        'rounded-lg border bg-surface-raised p-4',
        STATUS_STYLES[workout.completionStatus] ?? 'border-line',
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs text-ink-faint">
            {formatWeekday(workout.date)} · {formatDateShort(workout.date)}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <WorkoutBadge type={workout.workoutType as WorkoutType} />
            {workout.completionStatus === 'completed' && <Badge tone="good">Completed</Badge>}
            {workout.completionStatus === 'missed' && <Badge tone="alert">Missed</Badge>}
            {workout.completionStatus === 'skipped' && <Badge tone="neutral">Skipped</Badge>}
            {workout.userModified && <Badge tone="info">Edited by you</Badge>}
            {workout.adaptationReason && <Badge tone="caution">Adjusted</Badge>}
          </div>
        </div>

        {!isRest && workout.targetDistance != null && (
          <p className="tnum text-lg font-semibold text-ink">
            {formatDistance(workout.targetDistance)}
          </p>
        )}
      </div>

      {!isRest && (
        <>
          <p className="mt-2 text-sm text-ink">{workout.description}</p>

          <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted">
            {workout.targetPaceMin != null && (
              <span className="tnum">
                Pace {formatPaceRange(workout.targetPaceMin, workout.targetPaceMax)}
              </span>
            )}
            {workout.targetHRMin != null && (
              <span className="tnum">
                HR {workout.targetHRMin}–{workout.targetHRMax} bpm
              </span>
            )}
          </div>

          {!compact && <Structure steps={steps} />}
        </>
      )}

      {isRest && <p className="mt-2 text-sm text-ink-muted">Rest day.</p>}

      {/* --- What actually happened --------------------------------------- */}
      {workout.linkedActivity && (
        <div className="mt-3 rounded-md border border-good/20 bg-good/5 p-3">
          <p className="eyebrow text-good/80">Completed</p>
          <Link
            href={`/activities/${workout.linkedActivity.id}`}
            className="mt-1 block text-sm font-medium text-ink hover:text-accent"
          >
            {workout.linkedActivity.title}
          </Link>
          <p className="tnum mt-1 text-xs text-ink-muted">
            {formatDistance(workout.linkedActivity.distance)} ·{' '}
            {formatDuration(workout.linkedActivity.duration)}
            {workout.linkedActivity.avgPace != null &&
              ` · ${formatPaceRange(workout.linkedActivity.avgPace, workout.linkedActivity.avgPace).split('–')[0]}`}
            {workout.linkedActivity.avgHR != null && ` · ${workout.linkedActivity.avgHR} bpm`}
          </p>
        </div>
      )}

      {/* --- Why this session changed ------------------------------------- */}
      {workout.adaptationReason && (
        <div className="mt-3 rounded-md border border-caution/25 bg-caution/5 p-3">
          <p className="eyebrow text-caution/80">Why this changed</p>
          <p className="mt-1 text-xs leading-relaxed text-ink-muted">
            {workout.adaptationReason}
          </p>
        </div>
      )}

      {!compact && workout.explanation && !isRest && (
        <p className="mt-3 text-xs leading-relaxed text-ink-faint">{workout.explanation}</p>
      )}
    </div>
  );
}
