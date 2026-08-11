import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Card } from '@/components/ui/Card';
import { Stat } from '@/components/ui/Stat';
import { Badge, SportBadge, CalculatedBadge, DeviceBadge } from '@/components/ui/Badge';
import { MissingData } from '@/components/ui/EmptyState';
import { ActivityStreamChart } from '@/components/charts/ActivityStreamChart';
import { prisma } from '@/lib/db';
import { parseJSON, type ActivityRawData } from '@/lib/json';
import { addDays } from '@/lib/dates';
import {
  EMPTY,
  formatDate,
  formatDateTime,
  formatDistance,
  formatDuration,
  formatNumber,
  formatPace,
  formatSpeed,
} from '@/lib/format';
import { heartRateDrift, usesPace } from '@/analytics/activityMetrics';
import { LOAD_EXPLANATION } from '@/analytics/trainingLoad';
import { workoutInsights } from '@/analytics/insights';
import { loadActivities, toActivityLike } from '@/analytics/queries';

export const dynamic = 'force-dynamic';

const TONE_STYLES = {
  positive: 'border-good/25 bg-good/5',
  caution: 'border-caution/25 bg-caution/5',
  neutral: 'border-line bg-surface-raised',
} as const;

export default async function ActivityDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const activity = await prisma.activity.findUnique({
    where: { id },
    include: { splits: { orderBy: { splitNumber: 'asc' } } },
  });

  if (!activity) notFound();

  const raw = parseJSON<ActivityRawData>(activity.rawData, {});
  const stream = raw.stream ?? [];
  const drift = heartRateDrift(stream);
  const paceBased = usesPace(activity.sport);

  // The comparison baseline: recent activities of the same sport.
  const history = await loadActivities(activity.userId, addDays(activity.date, -120));
  const comparable = history
    .filter((row) => row.sport === activity.sport && row.date <= activity.date)
    .map(toActivityLike);

  const insights = workoutInsights({
    activity: {
      id: activity.id,
      date: activity.date,
      sport: activity.sport,
      title: activity.title,
      duration: activity.duration,
      distance: activity.distance,
      avgHR: activity.avgHR,
      maxHR: activity.maxHR,
      avgPace: activity.avgPace,
      avgSpeed: activity.avgSpeed,
      elevationGain: activity.elevationGain,
      cadence: activity.cadence,
      averagePower: activity.averagePower,
      calories: activity.calories,
      trainingLoad: activity.trainingLoad,
    },
    comparable,
    drift,
  });

  return (
    <div className="space-y-6">
      {/* --- Header ------------------------------------------------------- */}
      <div>
        <Link href="/activities" className="text-xs text-ink-muted hover:text-ink">
          ← All activities
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{activity.title}</h1>
          <SportBadge sport={activity.sport} />
          {activity.source === 'demo' && <Badge tone="neutral">Demo data</Badge>}
        </div>
        <p className="mt-1 text-sm text-ink-muted">{formatDateTime(activity.date)}</p>
      </div>

      {/* --- Headline metrics --------------------------------------------- */}
      <Card bodyClassName="p-5">
        <div className="grid gap-6 sm:grid-cols-3 lg:grid-cols-6">
          <Stat size="sm" label="Distance" value={formatDistance(activity.distance)} />
          <Stat size="sm" label="Duration" value={formatDuration(activity.duration)} />
          <Stat
            size="sm"
            label={paceBased ? 'Average pace' : 'Average speed'}
            value={paceBased ? formatPace(activity.avgPace) : formatSpeed(activity.avgSpeed)}
          />
          <Stat
            size="sm"
            label="Average HR"
            value={activity.avgHR != null ? formatNumber(activity.avgHR) : EMPTY}
            unit={activity.avgHR != null ? 'bpm' : undefined}
          />
          <Stat
            size="sm"
            label="Maximum HR"
            value={activity.maxHR != null ? formatNumber(activity.maxHR) : EMPTY}
            unit={activity.maxHR != null ? 'bpm' : undefined}
          />
          <Stat
            size="sm"
            label="Training load"
            value={formatNumber(activity.trainingLoad, 0)}
            info={LOAD_EXPLANATION}
          />
        </div>

        <div className="mt-6 grid gap-6 border-t border-line pt-5 sm:grid-cols-3 lg:grid-cols-6">
          <Stat
            size="sm"
            label="Elevation gain"
            value={activity.elevationGain != null ? formatNumber(activity.elevationGain) : EMPTY}
            unit={activity.elevationGain != null ? 'm' : undefined}
          />
          <Stat
            size="sm"
            label="Cadence"
            value={activity.cadence != null ? formatNumber(activity.cadence) : EMPTY}
            unit={activity.cadence != null ? 'spm' : undefined}
          />
          <Stat
            size="sm"
            label="Average power"
            value={activity.averagePower != null ? formatNumber(activity.averagePower) : EMPTY}
            unit={activity.averagePower != null ? 'W' : undefined}
          />
          <Stat
            size="sm"
            label="Calories"
            value={activity.calories != null ? formatNumber(activity.calories) : EMPTY}
            unit={activity.calories != null ? 'kcal' : undefined}
          />
          <Stat
            size="sm"
            label="Aerobic Training Effect"
            value={
              activity.aerobicTrainingEffect != null
                ? formatNumber(activity.aerobicTrainingEffect, 1)
                : EMPTY
            }
            footer={activity.aerobicTrainingEffect != null ? 'Reported by device' : undefined}
          />
          <Stat
            size="sm"
            label="Heart-rate drift"
            value={drift != null ? `${drift > 0 ? '+' : ''}${drift.toFixed(1)}%` : EMPTY}
            info="How much your speed-to-heart-rate ratio changed between the first and second half of the session. A small number means the effort held together well."
          />
        </div>

        {raw.notes && raw.notes.length > 0 && (
          <div className="mt-5 border-t border-line pt-4">
            {raw.notes.map((note, i) => (
              <p key={i} className="text-xs text-ink-faint">
                {note}
              </p>
            ))}
          </div>
        )}
      </Card>

      {/* --- Workout insights --------------------------------------------- */}
      <Card
        title="Workout Insights"
        subtitle="Compared against your recent similar sessions"
        info="These observations are calculated by comparing this session with your own recent training. Each one lists the numbers it is based on."
        action={<CalculatedBadge />}
      >
        <ul className="space-y-3">
          {insights.map((insight, index) => (
            <li key={index} className={`rounded-lg border p-4 ${TONE_STYLES[insight.tone]}`}>
              <p className="text-sm leading-relaxed text-ink">{insight.text}</p>
              <ul className="mt-2 space-y-0.5">
                {insight.evidence.map((item, i) => (
                  <li key={i} className="tnum text-xs text-ink-muted">
                    {item}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </Card>

      {/* --- Streams ------------------------------------------------------- */}
      <Card title="During the session" subtitle="Recorded every 15 seconds">
        {stream.length > 0 ? (
          <div className="space-y-5">
            <ActivityStreamChart stream={stream} metric="pace" />
            <ActivityStreamChart stream={stream} metric="hr" />
            <ActivityStreamChart stream={stream} metric="altitude" />
            <ActivityStreamChart stream={stream} metric="cadence" />
            <ActivityStreamChart stream={stream} metric="power" />
          </div>
        ) : (
          <MissingData
            what="A second-by-second recording"
            why="this activity was imported without detailed sample data"
          />
        )}
      </Card>

      {/* --- Splits -------------------------------------------------------- */}
      <Card
        title="Splits"
        subtitle={
          activity.sport === 'swimming' ? 'Per 100 metres' : 'Per kilometre'
        }
        action={activity.aerobicTrainingEffect != null ? <DeviceBadge /> : undefined}
      >
        {activity.splits.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left">
                  <th className="py-2 pr-4 font-medium text-ink-faint">
                    {activity.sport === 'swimming' ? '100 m' : 'KM'}
                  </th>
                  <th className="py-2 pr-4 text-right font-medium text-ink-faint">Pace</th>
                  <th className="py-2 pr-4 text-right font-medium text-ink-faint">HR</th>
                  <th className="py-2 text-right font-medium text-ink-faint">Elevation</th>
                </tr>
              </thead>
              <tbody>
                {activity.splits.map((split) => (
                  <tr key={split.id} className="border-b border-line/50 last:border-0">
                    <td className="tnum py-2 pr-4 text-ink-muted">{split.splitNumber}</td>
                    <td className="tnum py-2 pr-4 text-right text-ink">
                      {split.duration != null ? formatDuration(split.duration) : EMPTY}
                    </td>
                    <td className="tnum py-2 pr-4 text-right text-ink-muted">
                      {split.avgHR != null ? `${split.avgHR}` : EMPTY}
                    </td>
                    <td className="tnum py-2 text-right text-ink-muted">
                      {split.elevation != null
                        ? `${split.elevation > 0 ? '+' : ''}${split.elevation.toFixed(0)} m`
                        : EMPTY}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <MissingData
            what="Split data"
            why="this activity was imported without per-kilometre breakdowns"
          />
        )}
      </Card>

      <p className="text-xs text-ink-faint">
        Imported from {activity.source === 'demo' ? 'demo data' : activity.source} on{' '}
        {formatDate(activity.createdAt)}.
      </p>
    </div>
  );
}
