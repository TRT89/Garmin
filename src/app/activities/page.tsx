import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import { ButtonLink } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { SportBadge, Badge } from '@/components/ui/Badge';
import { findUser, prisma } from '@/lib/db';
import { SPORTS, SPORT_LABELS, type Sport } from '@/lib/constants';
import {
  formatDate,
  formatDistance,
  formatDuration,
  formatNumber,
  formatPace,
  formatSpeed,
  EMPTY,
} from '@/lib/format';
import { usesPace } from '@/analytics/activityMetrics';
import { LOAD_EXPLANATION } from '@/analytics/trainingLoad';
import { InfoTip } from '@/components/ui/InfoTip';

export const dynamic = 'force-dynamic';

const RANGES = {
  all: { label: 'All time', days: null },
  '4w': { label: 'Last 4 weeks', days: 28 },
  '12w': { label: 'Last 12 weeks', days: 84 },
  '6m': { label: 'Last 6 months', days: 182 },
} as const;

type RangeKey = keyof typeof RANGES;

interface SearchParams {
  sport?: string;
  range?: string;
}

/** A filter chip row. Filtering happens server-side through the query string. */
function FilterRow({
  label,
  options,
  active,
  paramName,
  current,
}: {
  label: string;
  options: { value: string; label: string }[];
  active: string;
  paramName: string;
  current: SearchParams;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="eyebrow w-12 shrink-0">{label}</span>
      {options.map((option) => {
        const params = new URLSearchParams({
          ...(current.sport ? { sport: current.sport } : {}),
          ...(current.range ? { range: current.range } : {}),
          [paramName]: option.value,
        });
        const isActive = active === option.value;
        return (
          <Link
            key={option.value}
            href={`/activities?${params.toString()}`}
            className={`rounded-lg border px-2.5 py-1 text-xs transition-colors ${
              isActive
                ? 'border-accent/40 bg-accent/10 text-accent'
                : 'border-line text-ink-muted hover:border-line-strong hover:text-ink'
            }`}
          >
            {option.label}
          </Link>
        );
      })}
    </div>
  );
}

export default async function ActivitiesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const user = await findUser();

  if (!user) {
    return (
      <Card title="Activities">
        <EmptyState
          icon="◷"
          title="No activities yet"
          description="Activities appear here once you load the demo athlete, upload a FIT file, or sync from Garmin."
          action={
            <ButtonLink href="/settings" variant="primary">
              Go to Settings
            </ButtonLink>
          }
        />
      </Card>
    );
  }

  const sportFilter = SPORTS.includes(params.sport as Sport) ? (params.sport as Sport) : 'all';
  const rangeKey: RangeKey = params.range && params.range in RANGES ? (params.range as RangeKey) : 'all';
  const rangeDays = RANGES[rangeKey].days;

  const since = rangeDays
    ? new Date(Date.now() - rangeDays * 24 * 60 * 60 * 1000)
    : undefined;

  const activities = await prisma.activity.findMany({
    where: {
      userId: user.id,
      ...(sportFilter !== 'all' ? { sport: sportFilter } : {}),
      ...(since ? { date: { gte: since } } : {}),
    },
    orderBy: { date: 'desc' },
    select: {
      id: true,
      date: true,
      sport: true,
      title: true,
      duration: true,
      distance: true,
      avgHR: true,
      avgPace: true,
      avgSpeed: true,
      trainingLoad: true,
      source: true,
    },
  });

  const totalDistance = activities.reduce((sum, a) => sum + (a.distance ?? 0), 0);
  const totalDuration = activities.reduce((sum, a) => sum + a.duration, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Activities</h1>
          <p className="mt-1 text-sm text-ink-muted">
            {activities.length} {activities.length === 1 ? 'activity' : 'activities'} ·{' '}
            {formatDistance(totalDistance)} · {formatDuration(totalDuration)}
          </p>
        </div>
      </div>

      <Card bodyClassName="p-5 space-y-3">
        <FilterRow
          label="Sport"
          paramName="sport"
          active={sportFilter}
          current={params}
          options={[
            { value: 'all', label: 'All' },
            ...SPORTS.map((sport) => ({ value: sport, label: SPORT_LABELS[sport] })),
          ]}
        />
        <FilterRow
          label="Date"
          paramName="range"
          active={rangeKey}
          current={params}
          options={Object.entries(RANGES).map(([value, { label }]) => ({ value, label }))}
        />
      </Card>

      <Card bodyClassName="p-0">
        {activities.length === 0 ? (
          <EmptyState
            icon="◷"
            title="No activities match these filters"
            description="Try widening the date range or selecting a different sport."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left">
                  <th className="px-5 py-3 font-medium text-ink-faint">Date</th>
                  <th className="px-3 py-3 font-medium text-ink-faint">Sport</th>
                  <th className="px-3 py-3 font-medium text-ink-faint">Activity</th>
                  <th className="px-3 py-3 text-right font-medium text-ink-faint">Distance</th>
                  <th className="px-3 py-3 text-right font-medium text-ink-faint">Duration</th>
                  <th className="px-3 py-3 text-right font-medium text-ink-faint">Pace / Speed</th>
                  <th className="px-3 py-3 text-right font-medium text-ink-faint">Avg HR</th>
                  <th className="px-5 py-3 text-right font-medium text-ink-faint">
                    <span className="inline-flex items-center gap-1">
                      Load
                      <InfoTip text={LOAD_EXPLANATION} />
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {activities.map((activity) => (
                  <tr
                    key={activity.id}
                    className="border-b border-line/60 transition-colors last:border-0 hover:bg-surface-raised"
                  >
                    <td className="whitespace-nowrap px-5 py-3 text-ink-muted">
                      <Link href={`/activities/${activity.id}`} className="hover:text-ink">
                        {formatDate(activity.date)}
                      </Link>
                    </td>
                    <td className="px-3 py-3">
                      <SportBadge sport={activity.sport} />
                    </td>
                    <td className="px-3 py-3">
                      <Link
                        href={`/activities/${activity.id}`}
                        className="font-medium text-ink hover:text-accent"
                      >
                        {activity.title}
                      </Link>
                      {activity.source === 'demo' && (
                        <Badge tone="neutral" className="ml-2">
                          Demo
                        </Badge>
                      )}
                    </td>
                    <td className="tnum whitespace-nowrap px-3 py-3 text-right text-ink">
                      {formatDistance(activity.distance)}
                    </td>
                    <td className="tnum whitespace-nowrap px-3 py-3 text-right text-ink">
                      {formatDuration(activity.duration)}
                    </td>
                    <td className="tnum whitespace-nowrap px-3 py-3 text-right text-ink">
                      {usesPace(activity.sport)
                        ? formatPace(activity.avgPace)
                        : formatSpeed(activity.avgSpeed)}
                    </td>
                    <td className="tnum whitespace-nowrap px-3 py-3 text-right text-ink-muted">
                      {activity.avgHR != null ? `${activity.avgHR} bpm` : EMPTY}
                    </td>
                    <td className="tnum whitespace-nowrap px-5 py-3 text-right text-ink-muted">
                      {formatNumber(activity.trainingLoad, 0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
