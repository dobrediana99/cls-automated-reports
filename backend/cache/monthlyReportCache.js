/**
 * Disk cache for monthly report data. Files under out/cache/monthly/<YYYY-MM>.json.
 * Used by the monthly job to avoid re-fetching Monday data when cache is valid.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const CACHE_DIR = path.join(ROOT, 'out', 'cache', 'monthly');

/**
 * Ensure out/cache/monthly/ exists. Creates directory recursively if needed.
 */
export function ensureMonthlyCacheDir() {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    if (process.env.NODE_ENV !== 'production') {
      console.log('[monthly-cache] created dir:', CACHE_DIR);
    }
  }
}

/**
 * Get the cache file path for a month.
 * @param {string} yyyyMm - Year-month key, e.g. "2026-01"
 * @returns {string} Absolute path to out/cache/monthly/<YYYY-MM>.json
 */
export function getMonthlyCachePath(yyyyMm) {
  const safe = String(yyyyMm).replace(/[^0-9-]/g, '');
  if (!safe || !/^\d{4}-\d{2}$/.test(safe)) {
    throw new Error(`Invalid yyyyMm for cache: ${yyyyMm}`);
  }
  ensureMonthlyCacheDir();
  return path.join(CACHE_DIR, `${safe}.json`);
}

/**
 * Load a cached monthly report from disk. Returns null if file does not exist or parse fails.
 * @param {string} yyyyMm - Year-month key, e.g. "2026-01"
 * @returns {{ meta: object, reportSummary: object, report: object } | null}
 */
export function loadMonthlyReportFromCache(yyyyMm) {
  const filePath = getMonthlyCachePath(yyyyMm);
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(raw);
    if (data && typeof data.meta === 'object' && typeof data.reportSummary === 'object' && typeof data.report === 'object') {
      return data;
    }
    return null;
  } catch (_) {
    return null;
  }
}

/**
 * Save a monthly report to disk. Overwrites existing file.
 * @param {string} yyyyMm - Year-month key, e.g. "2026-01"
 * @param {{ meta: object, reportSummary: object, report: object }} report - Full report (meta, reportSummary, report)
 */
export function saveMonthlyReportToCache(yyyyMm, report) {
  const filePath = getMonthlyCachePath(yyyyMm);
  const payload = {
    meta: report.meta,
    reportSummary: report.reportSummary,
    report: report.report,
  };
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
  if (process.env.NODE_ENV !== 'production') {
    console.log('[monthly-cache] saved:', filePath);
  }
}
