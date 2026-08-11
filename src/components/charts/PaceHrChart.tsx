'use client';

import {
  CartesianGrid,
  Legend,
  Line,
  ComposedChart,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  formatTooltip,
  AXIS,
  CHART_COLOURS,
  GRID,
  TOOLTIP_ITEM_STYLE,
  TOOLTIP_LABEL_STYLE,
  TOOLTIP_STYLE,
  shortDate,
} from './chartTheme';
import { formatPaceShort } from '@/lib/format';
import type { PaceHrPoint } from '@/analytics/trends';

/**
 * Pace and heart rate for every run, over time.
 *
 * The question this chart answers is "can I run faster for the same effort?".
 * Pace is inverted on the axis so that *up means faster*, which is what a reader
 * intuitively expects from a progress chart.
 */
export function PaceHrChart({ data }: { data: PaceHrPoint[] }) {
  if (data.length === 0) return null;

  const chartData = data.map((point) => ({
    date: point.date,
    pace: point.pace,
    hr: point.avgHR,
    title: point.title,
  }));

  const paces = data.map((p) => p.pace);
  const padding = 15;
  const domain: [number, number] = [
    Math.min(...paces) - padding,
    Math.max(...paces) + padding,
  ];

  return (
    <ResponsiveContainer width="100%" height={260}>
      <ComposedChart data={chartData} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
        <CartesianGrid {...GRID} />
        <XAxis
          dataKey="date"
          tickFormatter={shortDate}
          {...AXIS}
          minTickGap={40}
          axisLine={false}
          tickLine={false}
        />
        {/* Reversed so a faster pace sits higher up the axis. */}
        <YAxis
          yAxisId="pace"
          domain={domain}
          reversed
          tickFormatter={(v: number) => formatPaceShort(v)}
          {...AXIS}
          axisLine={false}
          tickLine={false}
          width={48}
        />
        <YAxis
          yAxisId="hr"
          orientation="right"
          domain={['dataMin - 8', 'dataMax + 8']}
          {...AXIS}
          axisLine={false}
          tickLine={false}
          width={40}
        />

        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          labelStyle={TOOLTIP_LABEL_STYLE}
          itemStyle={TOOLTIP_ITEM_STYLE}
          labelFormatter={shortDate}
          formatter={formatTooltip((value, name) =>
            name === 'Pace' ? [formatPaceShort(value), 'Pace'] : [`${value} bpm`, 'Avg HR'],
          )}
        />
        <Legend
          verticalAlign="top"
          height={28}
          iconType="plainline"
          wrapperStyle={{ fontSize: 11, color: '#9aa3b2' }}
        />

        <Scatter yAxisId="pace" dataKey="pace" name="Pace" fill={CHART_COLOURS.pace} />
        <Line
          yAxisId="hr"
          type="monotone"
          dataKey="hr"
          name="Avg HR"
          stroke={CHART_COLOURS.hr}
          strokeWidth={1.5}
          dot={false}
          strokeDasharray="4 3"
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
