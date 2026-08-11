/**
 * Date helpers.
 *
 * The whole application treats a "day" as a local calendar day at midnight and
 * a "week" as Monday → Sunday, which is what endurance training plans assume.
 */

export const DAY_MS = 24 * 60 * 60 * 1000;

/** Midnight (local time) on the same calendar day as `date`. */
export function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** The last millisecond of the calendar day containing `date`. */
export function endOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

/** Midnight on the Monday of the week containing `date`. */
export function startOfWeek(date: Date): Date {
  const d = startOfDay(date);
  // getDay(): 0 = Sunday … 6 = Saturday. Shift so Monday is day 0.
  const offset = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - offset);
  return d;
}

/** End of the Sunday of the week containing `date`. */
export function endOfWeek(date: Date): Date {
  return endOfDay(addDays(startOfWeek(date), 6));
}

export function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

export function addWeeks(date: Date, weeks: number): Date {
  return addDays(date, weeks * 7);
}

/** Whole days between two dates, ignoring time of day. */
export function daysBetween(a: Date, b: Date): number {
  return Math.round((startOfDay(b).getTime() - startOfDay(a).getTime()) / DAY_MS);
}

export function isSameDay(a: Date, b: Date): boolean {
  return startOfDay(a).getTime() === startOfDay(b).getTime();
}

/** ISO calendar-date key ("2026-08-11"), safe to use as a map key or chart axis. */
export function dateKey(date: Date): string {
  const d = startOfDay(date);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

/** Parse a "YYYY-MM-DD" key back into a local midnight Date. */
export function parseDateKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

/** Every calendar day from `start` to `end`, inclusive. */
export function eachDay(start: Date, end: Date): Date[] {
  const days: Date[] = [];
  let cursor = startOfDay(start);
  const last = startOfDay(end);
  while (cursor.getTime() <= last.getTime()) {
    days.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return days;
}

/** Every Monday from the week of `start` to the week of `end`, inclusive. */
export function eachWeekStart(start: Date, end: Date): Date[] {
  const weeks: Date[] = [];
  let cursor = startOfWeek(start);
  const last = startOfWeek(end);
  while (cursor.getTime() <= last.getTime()) {
    weeks.push(cursor);
    cursor = addWeeks(cursor, 1);
  }
  return weeks;
}

/** Inclusive date-range check. */
export function isWithin(date: Date, start: Date, end: Date): boolean {
  const t = date.getTime();
  return t >= start.getTime() && t <= end.getTime();
}

/**
 * Day-of-week index using the plan convention (0 = Sunday … 6 = Saturday),
 * matching `TrainingGoal.longRunDay`.
 */
export function dayOfWeek(date: Date): number {
  return date.getDay();
}

/** The next occurrence of `targetDay` (0 = Sunday) on or after `from`. */
export function nextDayOfWeek(from: Date, targetDay: number): Date {
  const d = startOfDay(from);
  const diff = (targetDay - d.getDay() + 7) % 7;
  return addDays(d, diff);
}
