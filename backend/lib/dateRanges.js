import { DateTime } from 'luxon';

const TZ = 'Europe/Bucharest';

/**
 * Returns the previous calendar week (Monday 00:00:00 to Sunday 23:59:59) in Europe/Bucharest
 * given a "now" date. All interpretation is in the given timezone.
 * @param {Date} [now=new Date()] - Reference instant (default: current time)
 * @returns {{ periodStart: string, periodEnd: string, label: string }} ISO strings and human-friendly label (e.g. 2026-01-19..2026-01-25)
 */
export function getPreviousCalendarWeekRange(now = new Date()) {
  const dt = DateTime.fromJSDate(now, { zone: TZ });
  const today = dt.startOf('day');
  const weekday = dt.weekday; // 1 = Monday, 7 = Sunday
  const daysToCurrentWeekMonday = weekday === 1 ? 0 : weekday - 1;
  const currentWeekMonday = today.minus({ days: daysToCurrentWeekMonday });
  const prevWeekMonday = currentWeekMonday.minus({ days: 7 });
  const prevWeekSunday = prevWeekMonday.plus({ days: 6 });
  const periodStart = prevWeekMonday.toISO();
  const periodEnd = prevWeekSunday.endOf('day').toISO();
  const label = `${prevWeekMonday.toISODate()}..${prevWeekSunday.toISODate()}`;
  return { periodStart, periodEnd, label };
}

/**
 * Returns the previous calendar month (1st 00:00:00 to last day 23:59:59) in Europe/Bucharest
 * given a "now" date.
 * @param {Date} [now=new Date()] - Reference instant (default: current time)
 * @returns {{ periodStart: string, periodEnd: string, label: string }} ISO strings and human-friendly label (e.g. 2025-12-01..2025-12-31)
 */
export function getPreviousCalendarMonthRange(now = new Date()) {
  return getMonthRangeOffset(now, 0);
}

/**
 * Returns the calendar month at offset from "previous month". Used for monthly reports (3 periods).
 * offset 0 = previous calendar month (report month), -1 = 2 months ago, -2 = 3 months ago.
 * @param {Date} [now=new Date()] - Reference instant
 * @param {number} offset - 0 = previous month, -1 = 2 months ago, -2 = 3 months ago
 * @returns {{ periodStart: string, periodEnd: string, label: string }}
 */
export function getMonthRangeOffset(now = new Date(), offset = 0) {
  const dt = DateTime.fromJSDate(now, { zone: TZ });
  const firstOfThisMonth = dt.startOf('month');
  const targetMonth = firstOfThisMonth.minus({ months: 1 + Math.abs(offset) });
  const firstOfMonth = targetMonth.startOf('month');
  const lastOfMonth = targetMonth.endOf('month');
  const periodStart = firstOfMonth.toISO();
  const periodEnd = lastOfMonth.toISO();
  const label = `${firstOfMonth.toISODate()}..${lastOfMonth.toISODate()}`;
  return { periodStart, periodEnd, label };
}
