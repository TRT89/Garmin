/**
 * Display formatting.
 *
 * Every function here tolerates null/undefined and returns an em dash, because
 * a missing metric is a normal state in this application — we show "—" rather
 * than inventing a value.
 */

import { METRES_PER_KM, METRES_PER_MILE, type Units } from './constants';

export const EMPTY = '—';

// ---------------------------------------------------------------------------
// Distance
// ---------------------------------------------------------------------------

/** Metres → "12.4 km" (or miles when the athlete prefers imperial units). */
export function formatDistance(
  metres: number | null | undefined,
  units: Units = 'metric',
  decimals = 1,
): string {
  if (metres === null || metres === undefined || !Number.isFinite(metres)) return EMPTY;
  if (units === 'imperial') {
    return `${(metres / METRES_PER_MILE).toFixed(decimals)} mi`;
  }
  return `${(metres / METRES_PER_KM).toFixed(decimals)} km`;
}

/** Metres → kilometres as a number (no unit suffix). */
export function toKm(metres: number | null | undefined): number | null {
  if (metres === null || metres === undefined || !Number.isFinite(metres)) return null;
  return metres / METRES_PER_KM;
}

// ---------------------------------------------------------------------------
// Duration
// ---------------------------------------------------------------------------

/** Seconds → "1:23:45" or "23:45". */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return EMPTY;
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Seconds → "1h 23m" / "45m" — friendlier for summary cards. */
export function formatDurationLong(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return EMPTY;
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.round((total % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/** Minutes → "7h 12m". Used for sleep. */
export function formatMinutes(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes)) return EMPTY;
  return formatDurationLong(minutes * 60);
}

/** "3:40" or "3:40:00" → seconds. Returns null if it cannot be parsed. */
export function parseTimeToSeconds(input: string): number | null {
  const parts = input.trim().split(':').map((p) => Number(p));
  if (parts.some((p) => !Number.isFinite(p) || p < 0)) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 3600 + parts[1] * 60; // "3:40" means 3h40m
  return null;
}

// ---------------------------------------------------------------------------
// Pace and speed
// ---------------------------------------------------------------------------

/** Seconds per km → "5:31/km". */
export function formatPace(
  secondsPerKm: number | null | undefined,
  units: Units = 'metric',
): string {
  if (secondsPerKm === null || secondsPerKm === undefined || !Number.isFinite(secondsPerKm)) {
    return EMPTY;
  }
  if (secondsPerKm <= 0) return EMPTY;

  const perUnit =
    units === 'imperial' ? secondsPerKm * (METRES_PER_MILE / METRES_PER_KM) : secondsPerKm;
  const m = Math.floor(perUnit / 60);
  const s = Math.round(perUnit % 60);
  // Rounding 59.6s up must roll over into the next minute, not print "5:60".
  const mm = s === 60 ? m + 1 : m;
  const ss = s === 60 ? 0 : s;
  return `${mm}:${String(ss).padStart(2, '0')}/${units === 'imperial' ? 'mi' : 'km'}`;
}

/** Seconds per km, without the unit suffix — for axis labels. */
export function formatPaceShort(secondsPerKm: number | null | undefined): string {
  const full = formatPace(secondsPerKm);
  return full === EMPTY ? EMPTY : full.replace('/km', '');
}

/** A pace band → "5:40–6:00/km". */
export function formatPaceRange(
  minSecondsPerKm: number | null | undefined,
  maxSecondsPerKm: number | null | undefined,
  units: Units = 'metric',
): string {
  if (minSecondsPerKm == null && maxSecondsPerKm == null) return EMPTY;
  if (minSecondsPerKm == null) return formatPace(maxSecondsPerKm, units);
  if (maxSecondsPerKm == null) return formatPace(minSecondsPerKm, units);
  const suffix = units === 'imperial' ? '/mi' : '/km';
  return `${formatPace(minSecondsPerKm, units).replace(suffix, '')}–${formatPace(maxSecondsPerKm, units)}`;
}

/** Metres per second → "32.4 km/h". */
export function formatSpeed(
  metresPerSecond: number | null | undefined,
  units: Units = 'metric',
): string {
  if (
    metresPerSecond === null ||
    metresPerSecond === undefined ||
    !Number.isFinite(metresPerSecond)
  ) {
    return EMPTY;
  }
  if (units === 'imperial') return `${(metresPerSecond * 2.23694).toFixed(1)} mph`;
  return `${(metresPerSecond * 3.6).toFixed(1)} km/h`;
}

/** Convert a pace (s/km) to a speed (m/s), and back. */
export function paceToSpeed(secondsPerKm: number): number {
  return METRES_PER_KM / secondsPerKm;
}
export function speedToPace(metresPerSecond: number): number {
  return METRES_PER_KM / metresPerSecond;
}

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

export function formatNumber(
  value: number | null | undefined,
  decimals = 0,
  suffix = '',
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return EMPTY;
  return `${value.toFixed(decimals)}${suffix}`;
}

/** A signed percentage change, e.g. "+8%" / "−3%". */
export function formatPercentChange(fraction: number | null | undefined): string {
  if (fraction === null || fraction === undefined || !Number.isFinite(fraction)) return EMPTY;
  const pct = fraction * 100;
  const sign = pct > 0 ? '+' : pct < 0 ? '−' : '';
  return `${sign}${Math.abs(pct).toFixed(0)}%`;
}

/** A signed absolute delta, e.g. "+4 bpm" / "−12 s". */
export function formatDelta(
  value: number | null | undefined,
  unit = '',
  decimals = 0,
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return EMPTY;
  const sign = value > 0 ? '+' : value < 0 ? '−' : '';
  return `${sign}${Math.abs(value).toFixed(decimals)}${unit ? ` ${unit}` : ''}`;
}

/** A pace delta expressed in seconds per km, e.g. "−12 s/km". */
export function formatPaceDelta(secondsPerKm: number | null | undefined): string {
  return formatDelta(secondsPerKm, 's/km', 0);
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

export function formatDate(date: Date | string | null | undefined): string {
  if (!date) return EMPTY;
  const d = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return EMPTY;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function formatDateShort(date: Date | string | null | undefined): string {
  if (!date) return EMPTY;
  const d = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return EMPTY;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

export function formatDateTime(date: Date | string | null | undefined): string {
  if (!date) return EMPTY;
  const d = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return EMPTY;
  return `${formatDate(d)} — ${d.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
  })}`;
}

export function formatWeekday(date: Date | string | null | undefined): string {
  if (!date) return EMPTY;
  const d = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return EMPTY;
  return d.toLocaleDateString('en-GB', { weekday: 'long' });
}
