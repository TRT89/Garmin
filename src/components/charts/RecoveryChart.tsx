'use client';

import {
  Bar,
  CartesianGrid,
  ComposedChart,
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
import type { RecoveryPoint } from '@/analytics/recovery';

/**
 * Sleep, resting heart rate and readiness on one timeline.
 *
 * Putting them together is the point: the days where sleep drops and resting
 * heart rate rises at the same time are exactly the ones worth noticing, and
 * that pattern is invisible when the three are shown on separate charts.
 */
export function RecoveryChart({ data }: { data: RecoveryPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
        <CartesianGrid {...GRID} />
        <XAxis
          dataKey="date"
          tickFormatter={shortDate}
          {...AXIS}
          minTickGap={40}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          yAxisId="sleep"
          domain={[0, 12]}
          {...AXIS}
          axisLine={false}
          tickLine={false}
          width={36}
        />
        <YAxis
          yAxisId="hr"
          orientation="right"
          domain={['dataMin - 4', 'dataMax + 4']}
          {...AXIS}
          axisLine={false}
          tickLine={false}
          width={36}
        />
        {/* Readiness is a 0-100 score, so it gets its own scale. The axis itself
            is hidden to keep the chart uncluttered — the tooltip reports the
            real value. */}
        <YAxis yAxisId="readiness" domain={['dataMin - 12', 'dataMax + 12']} hide />

        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          labelStyle={TOOLTIP_LABEL_STYLE}
          itemStyle={TOOLTIP_ITEM_STYLE}
          labelFormatter={shortDate}
          formatter={formatTooltip((value, name) => {
            if (name === 'Sleep') return [`${value} h`, name];
            if (name === 'Resting HR') return [`${value} bpm`, name];
            return [String(value), name];
          })}
          cursor={{ fill: '#ffffff08' }}
        />
        <Legend
          verticalAlign="top"
          height={28}
          wrapperStyle={{ fontSize: 11, color: '#9aa3b2' }}
        />

        <Bar
          yAxisId="sleep"
          dataKey="sleepHours"
          name="Sleep"
          fill={CHART_COLOURS.sleep}
          fillOpacity={0.55}
          radius={[3, 3, 0, 0]}
        />
        <Line
          yAxisId="hr"
          type="monotone"
          dataKey="restingHR"
          name="Resting HR"
          stroke={CHART_COLOURS.hr}
          strokeWidth={2}
          dot={false}
          connectNulls
        />
        <Line
          yAxisId="readiness"
          type="monotone"
          dataKey="bodyBattery"
          name="Readiness"
          stroke={CHART_COLOURS.readiness}
          strokeWidth={1.5}
          strokeDasharray="4 3"
          dot={false}
          connectNulls
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
