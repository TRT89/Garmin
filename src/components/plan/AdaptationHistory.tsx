import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { parseJSON, type WorkoutStep } from '@/lib/json';
import { formatDateTime, formatDistance } from '@/lib/format';
import { ADAPTATION_OUTCOME_LABELS, type AdaptationOutcome } from '@/lib/constants';

interface Indicator {
  key: string;
  direction: string;
  statement: string;
  values: Record<string, unknown>;
}

interface WorkoutSnapshot {
  workoutType: string;
  description: string;
  targetDistance: number | null;
  structure: WorkoutStep[];
}

export interface AdaptationRecord {
  id: string;
  timestamp: Date;
  outcome: string;
  reason: string;
  previousWorkout: string | null;
  updatedWorkout: string | null;
  metricsUsed: string | null;
  revertedAt: Date | null;
  affectedWorkout: { date: Date; workoutType: string } | null;
}

const OUTCOME_TONES: Record<string, 'good' | 'caution' | 'alert' | 'info' | 'neutral'> = {
  KEEP_PLAN: 'neutral',
  REDUCE_INTENSITY: 'caution',
  REDUCE_VOLUME: 'caution',
  CHANGE_TO_RECOVERY: 'alert',
  INCREASE_VOLUME_SLIGHTLY: 'good',
  MOVE_WORKOUT: 'info',
  ADD_REST: 'caution',
};

/**
 * "Why did my plan change?"
 *
 * Shows what the session was before, what it is now, the sentence explaining
 * the decision, and — expandable — the exact metric values behind it. This is
 * the accountability record for everything the adaptive engine does.
 */
export function AdaptationHistory({ records }: { records: AdaptationRecord[] }) {
  // Reviews that changed nothing are useful context but should not dominate the
  // list, so only the most recent one is shown.
  const changes = records.filter((r) => r.previousWorkout !== null);
  const latestNoChange = records.find((r) => r.previousWorkout === null);
  const shown = latestNoChange ? [...changes, latestNoChange] : changes;
  shown.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

  if (shown.length === 0) {
    return (
      <Card title="Why did my plan change?" subtitle="Every automatic adjustment, with its reasons">
        <EmptyState
          title="No adjustments yet"
          description="When the coach changes an upcoming session, the change and the numbers behind it appear here. Nothing has been changed so far."
        />
      </Card>
    );
  }

  return (
    <Card
      title="Why did my plan change?"
      subtitle="Every automatic adjustment, with its reasons"
      info="The coach only changes your plan when at least two independent indicators agree, and every change is bounded. This is the complete record of what it did and why."
    >
      <ol className="space-y-4">
        {shown.map((record) => {
          const before = parseJSON<WorkoutSnapshot | null>(record.previousWorkout, null);
          const after = parseJSON<WorkoutSnapshot | null>(record.updatedWorkout, null);
          const metrics = parseJSON<{ indicators?: Indicator[] }>(record.metricsUsed, {});

          return (
            <li key={record.id} className="rounded-lg border border-line bg-surface-raised p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={OUTCOME_TONES[record.outcome] ?? 'neutral'}>
                    {ADAPTATION_OUTCOME_LABELS[record.outcome as AdaptationOutcome] ??
                      record.outcome}
                  </Badge>
                  {record.revertedAt && <Badge tone="neutral">Reverted by you</Badge>}
                </div>
                <span className="text-xs text-ink-faint">{formatDateTime(record.timestamp)}</span>
              </div>

              {/* --- Before and after ------------------------------------ */}
              {before && after && (
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <div className="rounded-md border border-line bg-surface p-3">
                    <p className="eyebrow">Before</p>
                    <p className="mt-1 text-sm text-ink-muted line-through decoration-ink-faint">
                      {before.description}
                    </p>
                    {before.targetDistance != null && (
                      <p className="tnum mt-0.5 text-xs text-ink-faint">
                        {formatDistance(before.targetDistance)}
                      </p>
                    )}
                  </div>
                  <div className="rounded-md border border-accent/25 bg-accent/5 p-3">
                    <p className="eyebrow text-accent/80">After</p>
                    <p className="mt-1 text-sm text-ink">{after.description}</p>
                    {after.targetDistance != null && (
                      <p className="tnum mt-0.5 text-xs text-ink-muted">
                        {formatDistance(after.targetDistance)}
                      </p>
                    )}
                  </div>
                </div>
              )}

              <p className="mt-3 text-sm leading-relaxed text-ink">{record.reason}</p>

              {/* --- The numbers behind it -------------------------------- */}
              {metrics.indicators && metrics.indicators.length > 0 && (
                <details className="group mt-3">
                  <summary className="cursor-pointer list-none text-xs text-ink-muted hover:text-ink marker:content-none">
                    Show the data behind this decision{' '}
                    <span className="inline-block transition-transform group-open:rotate-90">▶</span>
                  </summary>
                  <ul className="mt-2 space-y-1.5 border-l border-line pl-3">
                    {metrics.indicators.map((indicator, i) => (
                      <li key={i} className="text-xs">
                        <span className="text-ink-muted">{indicator.statement}</span>
                        <span className="tnum ml-1 text-ink-faint">
                          (
                          {Object.entries(indicator.values)
                            .filter(([, v]) => v !== null && v !== undefined)
                            .map(([k, v]) => `${k}: ${v}`)
                            .join(', ')}
                          )
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
