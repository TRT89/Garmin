'use client';

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  AXIS,
  GRID,
  TOOLTIP_ITEM_STYLE,
  TOOLTIP_LABEL_STYLE,
  TOOLTIP_STYLE,
  formatTooltip,
} from './chartTheme';
import { formatDuration, formatPaceShort } from '@/lib/format';
import type { StreamPoint } from '@/lib/json';

type Metric = 'pace' | 'hr' | 'altitude' | 'cadence' | 'power';

const CONFIG: Record<
  Metric,
  { label: string; colour: string; unit: string; reversed: boolean }
> = {
  pace: { label: 'Pace', colour: '#4ade80', unit: '/km', reversed: true },
  hr: { label: 'Heart rate', colour: '#fb7185', unit: ' bpm', reversed: false },
  altitude: { label: 'Elevation', colour: '#8b93a5', unit: ' m', reversed: false },
  cadence: { label: 'Cadence', colour: '#fbbf24', unit: ' spm', reversed: false },
  power: { label: 'Power', colour: '#a78bfa', unit: ' W', reversed: false },
};

/**
 * One metric across the duration of a single activity.
 *
 * Renders nothing at all when the metric was not recorded — an empty axis
 * would imply the data exists and is zero, which would be misleading.
 */
export function ActivityStreamChart({
  stream,
  metric,
  height = 160,
}: {
  stream: StreamPoint[];
  metric: Metric;
  height?: number;
}) {
  const config = CONFIG[metric];

  const data = stream
    .filter((point) => point[metric] != null)
    .map((point) => ({ t: point.t, value: point[metric] as number }));

  if (data.length < 5) return null;

  // Pace spikes when standing still would flatten the whole chart, so the axis
  // is clipped to the meaningful range rather than the absolute extremes.
  const values = [...data.map((d) => d.value)].sort((a, b) => a - b);
  const low = values[Math.floor(values.length * 0.02)];
  const high = values[Math.floor(values.length * 0.98)];
  const pad = (high - low) * 0.12 || 1;

  const gradientId = `stream-${metric}`;

  return (
    <div>
      <p className="eyebrow mb-1.5">{config.label}</p>
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={config.colour} stopOpacity={0.35} />
              <stop offset="100%" stopColor={config.colour} stopOpacity={0.02} />
            </linearGradient>
          </defs>

          <CartesianGrid {...GRID} />
          <XAxis
            dataKey="t"
            tickFormatter={(t: number) => formatDuration(t)}
            {...AXIS}
            minTickGap={50}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            domain={[low - pad, high + pad]}
            reversed={config.reversed}
            tickFormatter={(v: number) =>
              metric === 'pace' ? formatPaceShort(v) : String(Math.round(v))
            }
            {...AXIS}
            axisLine={false}
            tickLine={false}
            width={56}
          />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            labelStyle={TOOLTIP_LABEL_STYLE}
            itemStyle={TOOLTIP_ITEM_STYLE}
            labelFormatter={(t) => `At ${formatDuration(Number(t))}`}
            formatter={formatTooltip((value) => [
              metric === 'pace'
                ? `${formatPaceShort(value)}${config.unit}`
                : `${Math.round(value)}${config.unit}`,
              config.label,
            ])}
          />
          <Area
            type="monotone"
            dataKey="value"
            stroke={config.colour}
            strokeWidth={1.5}
            fill={`url(#${gradientId})`}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
