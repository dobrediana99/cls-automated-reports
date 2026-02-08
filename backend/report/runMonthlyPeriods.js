/**
 * Monthly report for 3 periods (current month, month-1, month-2).
 * Cache: GCS when REPORTS_BUCKET is set (gs://bucket/prefix/YYYY-MM.json), else disk (out/cache/monthly/).
 */

import { getMonthRangeOffset } from '../lib/dateRanges.js';
import { runReport } from './runReport.js';
import {
  ensureMonthlyCacheDir,
  loadMonthlyReportFromCache,
  saveMonthlyReportToCache,
} from '../cache/monthlyReportCache.js';
import {
  getMonthlyCacheKey,
  readMonthlyCache,
  writeMonthlyCache,
} from '../storage/gcsMonthlyCache.js';

const TIMEZONE = 'Europe/Bucharest';

function getGcsCacheConfig() {
  const bucket = process.env.REPORTS_BUCKET?.trim();
  const prefix = (process.env.REPORTS_PREFIX?.trim() || 'monthly-cache/').replace(/\/?$/, '') + '/';
  return { bucket: bucket || null, prefix };
}

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
 * When REPORTS_BUCKET is set: GCS cache (read/write). On GCS read failure: log and fallback to recompute.
 * When REPORTS_BUCKET is not set: disk cache only (out/cache/monthly/).
 * @param {{ period: { yyyyMm: string, start: string, end: string, label: string }, refresh?: boolean }} opts
 * @returns {Promise<{ meta: object, reportSummary: object, report: object }>}
 */
export async function loadOrComputeMonthlyReport(opts) {
  const { period, refresh = false } = opts;
  const { yyyyMm, start, end, label } = period;
  const { bucket, prefix } = getGcsCacheConfig();

  if (bucket) {
    // GCS path: try read unless refresh
    if (!refresh) {
      const monthKey = getMonthlyCacheKey(start);
      const cached = await readMonthlyCache({ bucket, prefix, monthKey });
      if (cached) {
        console.log('[monthly][cache] hit', yyyyMm);
        return cached;
      }
    }
    console.log('[monthly][cache] miss', yyyyMm, '(compute)');
    const runAt = new Date().toISOString();
    const result = await runReport({
      periodStart: start,
      periodEnd: end,
      label,
      timezone: TIMEZONE,
      jobType: 'monthly',
      runAt,
    });
    const monthKey = getMonthlyCacheKey(start);
    await writeMonthlyCache({ bucket, prefix, monthKey, payload: result });
    console.log('[monthly][cache] write', yyyyMm, 'ok');
    return result;
  }

  // Disk cache path (no GCS bucket)
  if (!refresh) {
    const cached = loadMonthlyReportFromCache(yyyyMm);
    if (cached) {
      console.log('[monthly][cache] hit', yyyyMm);
      return cached;
    }
  }
  console.log('[monthly][cache] miss', yyyyMm, '(compute)');
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
  console.log('[monthly][cache] write', yyyyMm, 'ok');
  return result;
}
