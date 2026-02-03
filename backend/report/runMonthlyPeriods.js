/**
 * Monthly report for 3 periods (current month, month-1, month-2) with disk cache.
 * Reuses runReport/buildReport; cache in out/cache/monthly/<YYYY-MM>.json.
 */

import { getMonthRangeOffset } from '../lib/dateRanges.js';
import { runReport } from './runReport.js';
import {
  ensureMonthlyCacheDir,
  getMonthlyCachePath,
  loadMonthlyReportFromCache,
  saveMonthlyReportToCache,
} from '../cache/monthlyReportCache.js';

const TIMEZONE = 'Europe/Bucharest';

/**
 * Build the 3 period descriptors for monthly job: current (previous month), month-1, month-2.
 * @param {{ baseDate?: Date, timezone?: string }} opts - baseDate defaults to now; timezone for future use (Europe/Bucharest used in dateRanges)
 * @returns {{ yyyyMm: string, start: string, end: string, label: string }[]} periods[0]=current, [1]=prev1, [2]=prev2
 */
export function getMonthlyPeriods(opts = {}) {
  const baseDate = opts.baseDate ?? new Date();
  const range0 = getMonthRangeOffset(baseDate, 0);
  const range1 = getMonthRangeOffset(baseDate, -1);
  const range2 = getMonthRangeOffset(baseDate, -2);

  const toPeriod = (range) => ({
    yyyyMm: range.periodStart.slice(0, 7),
    start: range.periodStart,
    end: range.periodEnd,
    label: range.label,
  });

  return [toPeriod(range0), toPeriod(range1), toPeriod(range2)];
}

/**
 * Load report from cache or compute via runReport and save to cache.
 * @param {{ period: { yyyyMm: string, start: string, end: string, label: string }, refresh?: boolean }} opts
 * @returns {Promise<{ meta: object, reportSummary: object, report: object }>}
 */
export async function loadOrComputeMonthlyReport(opts) {
  const { period, refresh = false } = opts;
  const { yyyyMm, start, end, label } = period;

  if (refresh) {
    if (process.env.NODE_ENV !== 'production') {
      console.log('[monthly-periods] refresh=1, recompute:', yyyyMm);
    }
  } else {
    const cached = loadMonthlyReportFromCache(yyyyMm);
    if (cached) {
      if (process.env.NODE_ENV !== 'production') {
        console.log('[monthly-periods] cache hit:', yyyyMm);
      }
      return cached;
    }
    if (process.env.NODE_ENV !== 'production') {
      console.log('[monthly-periods] cache miss:', yyyyMm);
    }
  }

  const runAt = new Date().toISOString();
  const result = await runReport({
    periodStart: start,
    periodEnd: end,
    label,
    timezone: TIMEZONE,
    jobType: 'monthly',
    runAt,
  });

  ensureMonthlyCacheDir();
  saveMonthlyReportToCache(yyyyMm, result);
  if (process.env.NODE_ENV !== 'production') {
    console.log('[monthly-periods] cache written:', getMonthlyCachePath(yyyyMm));
  }

  return result;
}
