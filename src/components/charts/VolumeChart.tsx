'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
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
import type { WeeklyVolume } from '@/analytics/volume';

/**
 * Weekly distance, stacked by sport.
 *
 * Stacking is the right choice here because total weekly volume is the number
 * that matters, with the split between sports as secondary detail.
 */
export function VolumeChart({ data }: { data: WeeklyVolume[] }) {
  const chartData = data.map((week) => ({
    week: week.weekStart,
    Running: Math.round((week.running / 1000) * 10) / 10,
    Cycling: Math.round((week.cycling / 1000) * 10) / 10,
    Swimming: Math.round((week.swimming / 1000) * 10) / 10,
  }));

  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={chartData} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
        <CartesianGrid {...GRID} />
        <XAxis
          dataKey="week"
          tickFormatter={shortDate}
          {...AXIS}
          minTickGap={20}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          {...AXIS}
          axisLine={false}
          tickLine={false}
          width={44}
          label={{
            value: 'km',
            angle: -90,
            position: 'insideLeft',
            offset: 22,
            style: { fill: '#616b7c', fontSize: 11 },
          }}
        />
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          labelStyle={TOOLTIP_LABEL_STYLE}
          itemStyle={TOOLTIP_ITEM_STYLE}
          labelFormatter={(week) => `Week of ${shortDate(String(week))}`}
          formatter={formatTooltip((value, name) => [`${value} km`, name])}
          cursor={{ fill: '#ffffff08' }}
        />
        <Legend
          verticalAlign="top"
          height={28}
          iconType="square"
          wrapperStyle={{ fontSize: 11, color: '#9aa3b2' }}
        />

        <Bar dataKey="Running" stackId="v" fill={CHART_COLOURS.running} radius={[0, 0, 0, 0]} />
        <Bar dataKey="Cycling" stackId="v" fill={CHART_COLOURS.cycling} radius={[0, 0, 0, 0]} />
        <Bar dataKey="Swimming" stackId="v" fill={CHART_COLOURS.swimming} radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
