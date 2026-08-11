/**
 * Shared chart styling.
 *
 * Every chart in the application pulls its colours and axis styling from here,
 * so a sport is always the same colour and the charts read as one system rather
 * than a collection of separate widgets.
 */

export const CHART_COLOURS = {
  running: '#4ade80',
  cycling: '#60a5fa',
  swimming: '#22d3ee',
  other: '#a78bfa',
  acute: '#fb7185',
  chronic: '#60a5fa',
  form: '#a78bfa',
  hr: '#fb7185',
  pace: '#4ade80',
  elevation: '#8b93a5',
  cadence: '#fbbf24',
  sleep: '#818cf8',
  stress: '#fb923c',
  readiness: '#4ade80',
  neutral: '#616b7c',
} as const;

export const AXIS = {
  stroke: '#31374280',
  tick: { fill: '#9aa3b2', fontSize: 11 },
  line: false as const,
};

export const GRID = {
  stroke: '#22262f',
  strokeDasharray: '3 3',
  vertical: false,
};

/** Tooltip container styling, applied via Recharts' `contentStyle`. */
export const TOOLTIP_STYLE = {
  backgroundColor: '#14171e',
  border: '1px solid #22262f',
  borderRadius: 10,
  fontSize: 12,
  padding: '8px 10px',
  boxShadow: '0 8px 24px -12px rgba(0,0,0,0.8)',
};

export const TOOLTIP_LABEL_STYLE = {
  color: '#f2f4f8',
  fontWeight: 600,
  marginBottom: 4,
};

export const TOOLTIP_ITEM_STYLE = {
  color: '#9aa3b2',
};

/**
 * Adapter for Recharts tooltip formatters.
 *
 * Recharts types the formatter's arguments very loosely — a value may be a
 * string, a number, an array or undefined. Rather than repeat that noise in
 * every chart, formatters are written in terms of a number and a name, and this
 * wrapper does the narrowing once.
 */
export function formatTooltip(
  render: (value: number, name: string) => [string, string],
) {
  return (value: unknown, name: unknown): [string, string] =>
    render(Number(value ?? 0), String(name ?? ''));
}

/**
 * "2026-08-11" → "11 Aug", for chart axes and tooltips.
 *
 * Accepts `unknown` because Recharts types its tick and label formatters loosely
 * (a tooltip label is a ReactNode). Anything that is not a date key is returned
 * as-is rather than throwing inside a render.
 */
export function shortDate(key: unknown): string {
  if (typeof key !== 'string') return String(key ?? '');
  const [y, m, d] = key.split('-').map(Number);
  if (!y || !m || !d) return key;
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
  });
}
