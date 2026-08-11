'use client';

import {
  Area,
  ComposedChart,
  CartesianGrid,
  Legend,
  Line,
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
import type { LoadSeriesPoint } from '@/analytics/trainingLoad';

/**
 * Fatigue against fitness over time.
 *
 * The 7-day total (recent work, i.e. fatigue) is drawn over the 28-day total
 * scaled to a week (the base you have built, i.e. fitness). When the red line
 * sits well above the blue band you are asking more of yourself than usual.
 */
export function TrainingLoadChart({ data }: { data: LoadSeriesPoint[] }) {
  const chartData = data.map((point) => ({
    date: point.date,
    acute: point.acute,
    chronicWeekly: Math.round((point.chronic / 4) * 10) / 10,
    ratio: point.ratio,
  }));

  return (
    <ResponsiveContainer width="100%" height={260}>
      <ComposedChart data={chartData} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
        <defs>
          <linearGradient id="chronicFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={CHART_COLOURS.chronic} stopOpacity={0.28} />
            <stop offset="100%" stopColor={CHART_COLOURS.chronic} stopOpacity={0.02} />
          </linearGradient>
        </defs>

        <CartesianGrid {...GRID} />
        <XAxis
          dataKey="date"
          tickFormatter={shortDate}
          {...AXIS}
          minTickGap={40}
          axisLine={false}
          tickLine={false}
        />
        <YAxis {...AXIS} axisLine={false} tickLine={false} width={44} />

        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          labelStyle={TOOLTIP_LABEL_STYLE}
          itemStyle={TOOLTIP_ITEM_STYLE}
          labelFormatter={shortDate}
          formatter={formatTooltip((value, name) => [value.toFixed(0), name])}
        />
        <Legend
          verticalAlign="top"
          height={28}
          iconType="plainline"
          wrapperStyle={{ fontSize: 11, color: '#9aa3b2' }}
        />

        <Area
          type="monotone"
          dataKey="chronicWeekly"
          name="Fitness (28-day average week)"
          stroke={CHART_COLOURS.chronic}
          strokeWidth={1.5}
          fill="url(#chronicFill)"
        />
        <Line
          type="monotone"
          dataKey="acute"
          name="Fatigue (last 7 days)"
          stroke={CHART_COLOURS.acute}
          strokeWidth={2}
          dot={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
