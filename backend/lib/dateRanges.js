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

/**
 * Count working days (Monday=1 to Friday=5) in the period. Start/end are inclusive at date level.
 * @param {string} periodStart - ISO date string (YYYY-MM-DD or full ISO)
 * @param {string} periodEnd - ISO date string
 * @returns {number} Working days in [periodStart, periodEnd]
 */
export function getWorkingDaysInPeriod(periodStart, periodEnd) {
  const start = DateTime.fromISO(String(periodStart).slice(0, 10), { zone: TZ }).startOf('day');
  const end = DateTime.fromISO(String(periodEnd).slice(0, 10), { zone: TZ }).startOf('day');
  if (end < start) return 0;
  let count = 0;
  let cur = start;
  while (cur <= end) {
    if (cur.weekday >= 1 && cur.weekday <= 5) count += 1;
    cur = cur.plus({ days: 1 });
  }
  return count;
}

/**
 * First calendar day of the month that is a working day (Mon–Fri) and >= 5th.
 * Used for "monthly report send day": 5th if weekday, else next Monday (6th or 7th).
 * @param {Date} [now=new Date()] - Reference instant
 * @param {string} [timezone='Europe/Bucharest'] - IANA timezone
 * @returns {string} ISO date YYYY-MM-DD of that day
 */
export function getMonthlyReportSendDay(now = new Date(), timezone = TZ) {
  return getMonthlyReportSendDayForWindow(now, timezone, 5, 3);
}

/**
 * First working day inside a fixed calendar window [windowStartDay, windowStartDay + windowLength - 1].
 * Example:
 *  - windowStartDay=5, windowLength=3  => 5..7
 *  - windowStartDay=15, windowLength=3 => 15..17
 * @param {Date} [now=new Date()] - Reference instant
 * @param {string} [timezone='Europe/Bucharest'] - IANA timezone
 * @param {number} [windowStartDay=5] - Start day of month (1..31)
 * @param {number} [windowLength=3] - Number of calendar days in window (>=1)
 * @returns {string} ISO date YYYY-MM-DD of first working day in the window
 */
export function getMonthlyReportSendDayForWindow(
  now = new Date(),
  timezone = TZ,
  windowStartDay = 5,
  windowLength = 3
) {
  const dt = DateTime.fromJSDate(now, { zone: timezone });
  const year = dt.year;
  const month = dt.month;
  const startDay = Number(windowStartDay);
  const len = Number(windowLength);
  if (!Number.isInteger(startDay) || startDay < 1 || startDay > 31) {
    throw new Error(`windowStartDay must be integer 1..31, got: ${windowStartDay}`);
  }
  if (!Number.isInteger(len) || len < 1) {
    throw new Error(`windowLength must be integer >= 1, got: ${windowLength}`);
  }

  const endDay = startDay + len - 1;
  for (let day = startDay; day <= endDay; day++) {
    const d = DateTime.fromObject({ year, month, day }, { zone: timezone });
    if (!d.isValid) continue;
    if (d.weekday >= 1 && d.weekday <= 5) return d.toISODate();
  }
  // Fallback (should not happen for normal 3-day windows like 5..7 / 15..17).
  const start = DateTime.fromObject({ year, month, day: startDay }, { zone: timezone });
  if (start.isValid) return start.toISODate();
  throw new Error(`No valid calendar day found for window ${startDay}..${endDay} in ${year}-${String(month).padStart(2, '0')}`);
}

/**
 * True if today (in timezone) is the day when the monthly report should be sent:
 * first working day on or after the 5th of the current month.
 * @param {Date} [now=new Date()] - Reference instant
 * @param {string} [timezone='Europe/Bucharest'] - IANA timezone
 * @returns {boolean}
 */
export function isMonthlyReportSendDay(now = new Date(), timezone = TZ) {
  return isMonthlyReportSendDayForWindow(now, timezone, 5, 3);
}

/**
 * True if today (in timezone) is the first working day inside [windowStartDay, windowStartDay+windowLength-1].
 * @param {Date} [now=new Date()] - Reference instant
 * @param {string} [timezone='Europe/Bucharest'] - IANA timezone
 * @param {number} [windowStartDay=5] - Start day of month (1..31)
 * @param {number} [windowLength=3] - Number of calendar days in window (>=1)
 * @returns {boolean}
 */
export function isMonthlyReportSendDayForWindow(
  now = new Date(),
  timezone = TZ,
  windowStartDay = 5,
  windowLength = 3
) {
  const dt = DateTime.fromJSDate(now, { zone: timezone });
  const today = dt.toISODate();
  const sendDay = getMonthlyReportSendDayForWindow(now, timezone, windowStartDay, windowLength);
  return today === sendDay;
}
