import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import { ButtonLink } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Stat } from '@/components/ui/Stat';
import { Badge, PhaseBadge } from '@/components/ui/Badge';
import { Progress } from '@/components/ui/Progress';
import { WorkoutCard } from '@/components/plan/WorkoutCard';
import { AdaptationHistory } from '@/components/plan/AdaptationHistory';
import { SyncButton } from '@/components/SyncButton';
import { findUser } from '@/lib/db';
import { daysBetween, startOfWeek, addDays } from '@/lib/dates';
import { formatDate, formatDistance, formatNumber, formatPaceRange } from '@/lib/format';
import { parseJSON } from '@/lib/json';
import { getActivePlan } from '@/training/planService';
import { getAdaptationHistory } from '@/training/adaptationService';
import { getLastSync, describeSyncAge } from '@/garmin/syncPipeline';
import { phaseGoal } from '@/training/phases';
import {
  complianceToDate,
  currentWeekNumber,
  planCompliance,
  COMPLIANCE_EXPLANATION,
} from '@/analytics/compliance';
import type { Phase } from '@/lib/constants';
import type { PaceZones } from '@/training/paces';

export const dynamic = 'force-dynamic';

export default async function PlanPage() {
  const user = await findUser();
  const active = user ? await getActivePlan(user.id) : null;

  if (!active) {
    return (
      <Card title="Training Plan">
        <EmptyState
          icon="◎"
          title="No training goal set"
          description="Tell the coach what you are training for — a race, a distance and a target time — and it will build a week-by-week plan from your recent running."
          action={
            <ButtonLink href="/plan/new" variant="primary">
              Set a goal
            </ButtonLink>
          }
        />
      </Card>
    );
  }

  const { goal, plan } = active;
  const workouts = plan.workouts;
  const now = new Date();

  const [adaptations, lastSync] = await Promise.all([
    getAdaptationHistory(plan.id),
    getLastSync(),
  ]);

  // The plan may not have started yet — it is counted back from the event date,
  // so training often begins next week rather than today. Saying "Week 1, now"
  // before it has begun would be wrong.
  const hasStarted = now >= plan.startDate;
  const thisWeekNumber = currentWeekNumber(workouts, now) ?? 1;
  const compliance = complianceToDate(workouts, now);
  const allWeeks = planCompliance(workouts);

  const thisWeekWorkouts = workouts.filter((w) => w.weekNumber === thisWeekNumber);
  const thisWeekCompliance = allWeeks.find((w) => w.weekNumber === thisWeekNumber);
  const currentPhase = (thisWeekWorkouts[0]?.phase ?? 'BASE') as Phase;

  const weeksRemaining = Math.max(0, Math.ceil(daysBetween(now, goal.targetDate) / 7));

  // The pace zones the plan was generated with, stored alongside it.
  const generator = parseJSON<{ zones?: PaceZones; notes?: string[] }>(
    plan.generatorInput,
    {},
  );

  const nextWorkout = workouts.find(
    (w) => w.date >= startOfWeek(now) && w.completionStatus === 'planned' && w.date >= addDays(now, -1),
  );

  return (
    <div className="space-y-6">
      {/* --- Header ------------------------------------------------------- */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Training for</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{goal.eventName}</h1>
          <p className="mt-1 text-sm text-ink-muted">
            {formatDate(goal.targetDate)} · {weeksRemaining} week
            {weeksRemaining === 1 ? '' : 's'} remaining
          </p>
        </div>
        <div className="flex items-center gap-3">
          <ButtonLink href="/plan/new" size="sm">
            Change goal
          </ButtonLink>
        </div>
      </div>

      {/* --- Sync --------------------------------------------------------- */}
      <Card
        title="Sync"
        subtitle="Import new training, then re-evaluate the plan"
        info="A sync retrieves new data, recalculates your metrics, matches completed sessions to your plan, and considers whether upcoming sessions should change."
      >
        <SyncButton lastSynced={describeSyncAge(lastSync?.startedAt ?? null)} />
      </Card>

      {/* --- Where you are in the plan ------------------------------------ */}
      <Card bodyClassName="p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="eyebrow">
              {hasStarted
                ? `Week ${thisWeekNumber} of ${goal.trainingWeeks}`
                : `Starts ${formatDate(plan.startDate)}`}
            </p>
            <div className="mt-1.5 flex items-center gap-2">
              <PhaseBadge phase={currentPhase} />
              <span className="text-sm text-ink-muted">
                {formatDistance(
                  thisWeekWorkouts.reduce((s, w) => s + (w.targetDistance ?? 0), 0),
                )}{' '}
                planned in week {thisWeekNumber}
              </span>
            </div>
          </div>

          {hasStarted && thisWeekCompliance && (
            <div className="min-w-[220px]">
              <div className="flex items-baseline justify-between gap-3">
                <span className="eyebrow">This week</span>
                <span className="tnum text-sm text-ink">
                  {formatNumber(thisWeekCompliance.actualDistance / 1000, 1)} /{' '}
                  {formatNumber(thisWeekCompliance.plannedDistance / 1000, 1)} km
                </span>
              </div>
              <Progress
                className="mt-2"
                value={thisWeekCompliance.actualDistance}
                max={thisWeekCompliance.plannedDistance || 1}
              />
              <p className="mt-1.5 text-xs text-ink-faint">
                {thisWeekCompliance.sessionsCompleted} of{' '}
                {thisWeekCompliance.sessionsPlanned} sessions completed
              </p>
            </div>
          )}
        </div>

        <p className="mt-4 border-t border-line pt-4 text-xs leading-relaxed text-ink-muted">
          {phaseGoal(currentPhase)}
        </p>
      </Card>

      {/* --- Summary numbers ---------------------------------------------- */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card bodyClassName="p-5">
          <Stat
            size="sm"
            label="Sessions completed"
            value={`${compliance.sessionsCompleted} / ${compliance.sessionsPlanned}`}
            info={COMPLIANCE_EXPLANATION}
            footer="Across the plan so far"
          />
        </Card>
        <Card bodyClassName="p-5">
          <Stat
            size="sm"
            label="Volume compliance"
            value={
              compliance.overallVolumeCompliance != null
                ? `${Math.round(compliance.overallVolumeCompliance * 100)}%`
                : '—'
            }
            info={COMPLIANCE_EXPLANATION}
            footer="Distance done against distance planned"
          />
        </Card>
        <Card bodyClassName="p-5">
          <Stat
            size="sm"
            label="Weeks remaining"
            value={weeksRemaining}
            footer={`Plan ends ${formatDate(plan.endDate)}`}
          />
        </Card>
        <Card bodyClassName="p-5">
          <Stat
            size="sm"
            label="Goal pace"
            value={
              generator.zones
                ? formatPaceRange(generator.zones.marathon.min, generator.zones.marathon.max)
                : '—'
            }
            footer="Race pace for your target"
          />
        </Card>
      </div>

      {/* --- Next session -------------------------------------------------- */}
      {nextWorkout && (
        <Card title="Next session">
          <WorkoutCard workout={nextWorkout} />
        </Card>
      )}

      {/* --- This week ----------------------------------------------------- */}
      <Card
        title={hasStarted ? `Week ${thisWeekNumber}` : `Week ${thisWeekNumber} — first week`}
        subtitle="Monday to Sunday"
        action={<PhaseBadge phase={currentPhase} />}
      >
        <div className="grid gap-3 md:grid-cols-2">
          {thisWeekWorkouts.map((workout) => (
            <WorkoutCard key={workout.id} workout={workout} />
          ))}
        </div>
      </Card>

      {/* --- Whole plan ---------------------------------------------------- */}
      <Card
        title="Plan overview"
        subtitle="Every week, with planned volume and long run"
        info="Planned volume is what the generator prescribed. Actual volume comes from the activities matched to those sessions."
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left">
                <th className="py-2 pr-4 font-medium text-ink-faint">Week</th>
                <th className="py-2 pr-4 font-medium text-ink-faint">Phase</th>
                <th className="py-2 pr-4 text-right font-medium text-ink-faint">Planned</th>
                <th className="py-2 pr-4 text-right font-medium text-ink-faint">Actual</th>
                <th className="py-2 pr-4 text-right font-medium text-ink-faint">Long run</th>
                <th className="py-2 text-right font-medium text-ink-faint">Sessions</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: goal.trainingWeeks }, (_, i) => i + 1).map((weekNumber) => {
                const weekWorkouts = workouts.filter((w) => w.weekNumber === weekNumber);
                if (weekWorkouts.length === 0) return null;

                const phase = weekWorkouts[0].phase as Phase;
                const planned = weekWorkouts.reduce((s, w) => s + (w.targetDistance ?? 0), 0);
                const longRun = weekWorkouts
                  .filter((w) => w.workoutType === 'LONG_RUN')
                  .reduce((max, w) => Math.max(max, w.targetDistance ?? 0), 0);
                const week = allWeeks.find((w) => w.weekNumber === weekNumber);
                const isCurrent = hasStarted && weekNumber === thisWeekNumber;

                return (
                  <tr
                    key={weekNumber}
                    className={`border-b border-line/50 last:border-0 ${
                      isCurrent ? 'bg-accent/5' : ''
                    }`}
                  >
                    <td className="tnum py-2 pr-4 text-ink">
                      {weekNumber}
                      {isCurrent && (
                        <Badge tone="accent" className="ml-2">
                          Now
                        </Badge>
                      )}
                    </td>
                    <td className="py-2 pr-4">
                      <PhaseBadge phase={phase} />
                    </td>
                    <td className="tnum py-2 pr-4 text-right text-ink">
                      {formatDistance(planned)}
                    </td>
                    <td className="tnum py-2 pr-4 text-right text-ink-muted">
                      {week && week.actualDistance > 0
                        ? formatDistance(week.actualDistance)
                        : '—'}
                    </td>
                    <td className="tnum py-2 pr-4 text-right text-ink-muted">
                      {longRun > 0 ? formatDistance(longRun) : '—'}
                    </td>
                    <td className="tnum py-2 text-right text-ink-muted">
                      {week ? `${week.sessionsCompleted} / ${week.sessionsPlanned}` : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* --- Why the plan changed ------------------------------------------ */}
      <AdaptationHistory records={adaptations} />

      {/* --- How this plan was built --------------------------------------- */}
      {generator.notes && generator.notes.length > 0 && (
        <Card title="How this plan was built" subtitle="The decisions behind your schedule">
          <ul className="space-y-2">
            {generator.notes.map((note, i) => (
              <li key={i} className="text-xs leading-relaxed text-ink-muted">
                {note}
              </li>
            ))}
          </ul>
          <p className="mt-4 border-t border-line pt-3 text-xs text-ink-faint">
            The plan is generated by a fixed set of rules, not by a language model — the same
            inputs always produce the same plan.{' '}
            <Link href="/activities" className="text-ink-muted hover:text-ink">
              Review the training it was based on →
            </Link>
          </p>
        </Card>
      )}
    </div>
  );
}
