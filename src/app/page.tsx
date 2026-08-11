import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import { ButtonLink } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Stat } from '@/components/ui/Stat';
import { Badge } from '@/components/ui/Badge';
import { CoachSummaryCard } from '@/components/dashboard/CoachSummaryCard';
import { TrainingLoadChart } from '@/components/charts/TrainingLoadChart';
import { PaceHrChart } from '@/components/charts/PaceHrChart';
import { RecoveryChart } from '@/components/charts/RecoveryChart';
import { findUser, prisma } from '@/lib/db';
import { addDays, startOfDay } from '@/lib/dates';
import {
  formatDistance,
  formatDurationLong,
  formatMinutes,
  formatNumber,
} from '@/lib/format';
import { loadDashboardData } from '@/analytics/queries';
import { buildLoadSeries, summariseLoad, LOAD_EXPLANATION, ACWR_EXPLANATION } from '@/analytics/trainingLoad';
import { compareRecentVolume, percentChange } from '@/analytics/volume';
import { assessRecovery, recoverySeries, RECOVERY_EXPLANATION } from '@/analytics/recovery';
import { efficiencyTrend, paceHrSeries, EFFICIENCY_EXPLANATION } from '@/analytics/trends';
import { buildCoachSummary } from '@/analytics/insights';

export const dynamic = 'force-dynamic';

const STATUS_TONES = {
  'On Track': 'good',
  Progressing: 'good',
  Building: 'info',
  'Ease Back': 'caution',
  'Insufficient Data': 'neutral',
} as const;

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export default async function DashboardPage() {
  const user = await findUser();
  const activityCount = user ? await prisma.activity.count({ where: { userId: user.id } }) : 0;

  if (!user || activityCount === 0) {
    return (
      <Card>
        <EmptyState
          icon="◷"
          title="No training data yet"
          description="Load the demo athlete to explore every feature with twelve weeks of realistic training data, or connect your own data from the settings page."
          action={
            <ButtonLink href="/settings" variant="primary">
              Go to Settings
            </ButtonLink>
          }
        />
      </Card>
    );
  }

  const now = new Date();
  const { activities, health } = await loadDashboardData(user.id, now);

  // --- Everything below is computed, never estimated in the view ----------
  const volume = compareRecentVolume(activities, now);
  const load = summariseLoad(activities, now);
  const recovery = assessRecovery(health, now);
  const twelveWeeksAgo = addDays(startOfDay(now), -83);
  const efficiency = efficiencyTrend(activities, twelveWeeksAgo, now);

  const summary = buildCoachSummary({ volume, load, recovery, efficiency });

  const loadSeries = buildLoadSeries(activities, twelveWeeksAgo, now);
  // Easy runs only: this chart is about progress at a comparable effort, and
  // interval sessions would swamp it.
  const paceHr = paceHrSeries(activities, twelveWeeksAgo, now, true);
  const recoveryPoints = recoverySeries(health, addDays(startOfDay(now), -41), now);

  const runningNow = volume.current.distanceBySport.running;
  const runningBefore = volume.previous.distanceBySport.running;
  const runningBaseline = volume.fourWeekAverage.distanceBySport.running;

  const cyclingNow = volume.current.distanceBySport.cycling;
  const swimmingNow = volume.current.distanceBySport.swimming;

  const recentSleep = recovery.sleepDuration.current;
  const recentRHR = recovery.restingHR.current;

  return (
    <div className="space-y-6">
      {/* --- Header ------------------------------------------------------- */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">{greeting()}</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{user.name}</h1>
        </div>
        <div className="flex items-center gap-3">
          <Badge tone={STATUS_TONES[summary.status]}>{summary.status}</Badge>
          <ButtonLink href="/plan" size="sm">
            Training plan
          </ButtonLink>
        </div>
      </div>

      {/* --- Headline numbers --------------------------------------------- */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card bodyClassName="p-5">
          <Stat
            label="Running · last 7 days"
            value={formatNumber(runningNow / 1000, 1)}
            unit="km"
            change={percentChange(runningNow, runningBefore)}
            changeLabel="vs previous week"
            direction="up-good"
            footer={`4-week average: ${formatDistance(runningBaseline)}`}
          />
        </Card>

        <Card bodyClassName="p-5">
          <Stat
            label="Training time"
            value={formatDurationLong(volume.current.totalDuration)}
            change={percentChange(volume.current.totalDuration, volume.previous.totalDuration)}
            changeLabel="vs previous week"
            footer={`${volume.current.activityCount} activities`}
          />
        </Card>

        <Card bodyClassName="p-5">
          <Stat
            label="Training load · 7 days"
            value={formatNumber(load.acute, 0)}
            change={load.acuteChange}
            changeLabel="vs previous week"
            direction="neutral"
            info={LOAD_EXPLANATION}
            footer={
              load.ratio != null
                ? `Ratio to your 4-week average: ${load.ratio}`
                : 'Not enough history for a ratio yet'
            }
          />
        </Card>

        <Card bodyClassName="p-5">
          <Stat
            label="Recovery"
            value={
              recovery.status === 'good'
                ? 'Good'
                : recovery.status === 'moderate'
                  ? 'Moderate'
                  : recovery.status === 'compromised'
                    ? 'Low'
                    : 'Unknown'
            }
            accent={
              recovery.status === 'good'
                ? 'good'
                : recovery.status === 'compromised'
                  ? 'alert'
                  : 'caution'
            }
            info={RECOVERY_EXPLANATION}
            footer={
              recovery.negativeIndicators > 0
                ? `${recovery.negativeIndicators} indicator${
                    recovery.negativeIndicators === 1 ? '' : 's'
                  } below baseline`
                : 'All indicators near baseline'
            }
          />
        </Card>
      </div>

      {/* --- Coach summary ------------------------------------------------ */}
      <CoachSummaryCard summary={summary} />

      {/* --- Charts ------------------------------------------------------- */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card
          title="Training load"
          subtitle="Last 12 weeks"
          info={`${LOAD_EXPLANATION} ${ACWR_EXPLANATION}`}
        >
          <TrainingLoadChart data={loadSeries} />
        </Card>

        <Card
          title="Pace and heart rate"
          subtitle="Easy runs, last 12 weeks"
          info={EFFICIENCY_EXPLANATION}
        >
          {paceHr.length > 0 ? (
            <>
              <PaceHrChart data={paceHr} />
              <p className="mt-3 text-xs leading-relaxed text-ink-muted">{efficiency.summary}</p>
            </>
          ) : (
            <EmptyState
              title="No runs with heart-rate data"
              description="This chart compares your pace against your heart rate over time. It needs runs that recorded both."
            />
          )}
        </Card>
      </div>

      {/* --- Last 7 days breakdown ---------------------------------------- */}
      <Card title="Last 7 days" subtitle="Compared with the previous 7 days">
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            size="sm"
            label="Running"
            value={formatNumber(runningNow / 1000, 1)}
            unit="km"
            change={percentChange(runningNow, runningBefore)}
            changeLabel="vs last week"
          />
          <Stat
            size="sm"
            label="Cycling"
            value={formatNumber(cyclingNow / 1000, 1)}
            unit="km"
            change={percentChange(cyclingNow, volume.previous.distanceBySport.cycling)}
            changeLabel="vs last week"
          />
          <Stat
            size="sm"
            label="Swimming"
            value={formatNumber(swimmingNow / 1000, 2)}
            unit="km"
            change={percentChange(swimmingNow, volume.previous.distanceBySport.swimming)}
            changeLabel="vs last week"
          />
          <Stat
            size="sm"
            label="Activities"
            value={volume.current.activityCount}
            change={percentChange(
              volume.current.activityCount,
              volume.previous.activityCount,
            )}
            changeLabel="vs last week"
          />
          <Stat
            size="sm"
            label="Average sleep"
            value={recentSleep != null ? formatMinutes(recentSleep) : '—'}
            footer="3-day average"
          />
          <Stat
            size="sm"
            label="Resting heart rate"
            value={recentRHR != null ? formatNumber(recentRHR, 0) : '—'}
            unit="bpm"
            change={
              recovery.restingHR.baseline && recovery.restingHR.delta != null
                ? recovery.restingHR.delta / recovery.restingHR.baseline
                : null
            }
            changeLabel="vs 14-day average"
            direction="up-bad"
          />
          <Stat
            size="sm"
            label="Training load"
            value={formatNumber(volume.current.totalLoad, 0)}
            change={percentChange(volume.current.totalLoad, volume.previous.totalLoad)}
            changeLabel="vs last week"
            direction="neutral"
            info={LOAD_EXPLANATION}
          />
          <Stat
            size="sm"
            label="4-week average week"
            value={formatNumber(runningBaseline / 1000, 1)}
            unit="km"
            footer="Running only"
          />
        </div>
      </Card>

      {/* --- Recovery ------------------------------------------------------ */}
      <Card
        title="Sleep and recovery"
        subtitle="Last 6 weeks"
        info={RECOVERY_EXPLANATION}
        action={
          <Link href="/activities" className="text-xs text-ink-muted hover:text-ink">
            View activities →
          </Link>
        }
      >
        {recoveryPoints.length > 0 ? (
          <RecoveryChart data={recoveryPoints} />
        ) : (
          <EmptyState
            title="No health data"
            description="Sleep, resting heart rate and readiness appear here once daily health records are available from your data source."
          />
        )}
      </Card>
    </div>
  );
}
