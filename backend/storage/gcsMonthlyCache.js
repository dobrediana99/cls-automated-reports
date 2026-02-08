/**
 * GCS-backed monthly report cache. Path: gs://bucket/prefix/YYYY-MM.json
 * Used when REPORTS_BUCKET is set; on read failure logs and returns null (fallback to recompute).
 */

import { Storage } from '@google-cloud/storage';

const SCHEMA_VERSION = 1;

/**
 * Get cache object key for a period (filename only).
 * @param {string|Date} periodStartDate - ISO date string (e.g. period.start) or Date; must resolve to a valid month
 * @returns {string} e.g. "2026-01.json"
 */
export function getMonthlyCacheKey(periodStartDate) {
  const s = typeof periodStartDate === 'string' ? periodStartDate : (periodStartDate instanceof Date ? periodStartDate.toISOString() : String(periodStartDate));
  const match = /^(\d{4})-(\d{2})/.exec(s);
  if (!match) {
    throw new Error(`Invalid periodStartDate for cache key: ${s}`);
  }
  return `${match[1]}-${match[2]}.json`;
}

/**
 * Read monthly report from GCS. Returns null if object does not exist or on error (logs and fallback).
 * @param {{ bucket: string, prefix?: string, monthKey: string }} opts
 * @returns {Promise<{ meta: object, reportSummary: object, report: object } | null>}
 */
export async function readMonthlyCache({ bucket, prefix = '', monthKey }) {
  const storage = new Storage();
  const path = (prefix.replace(/\/?$/, '') + '/' + monthKey).replace(/^\//, '');
  const file = storage.bucket(bucket).file(path);

  try {
    const [contents] = await file.download();
    const raw = contents.toString('utf8');
    const doc = JSON.parse(raw);

    if (!doc || doc.schemaVersion !== SCHEMA_VERSION || !doc.data) {
      console.warn('[monthly][cache] invalid schema or missing data, key=', monthKey);
      return null;
    }
    const { meta, reportSummary, report } = doc.data;
    if (!meta || !reportSummary || !report) {
      console.warn('[monthly][cache] cached data missing meta/reportSummary/report, key=', monthKey);
      return null;
    }
    return { meta, reportSummary, report };
  } catch (err) {
    if (err?.code === 404) return null;
    console.error('[monthly][cache] GCS read failed', monthKey, err?.message || err);
    return null;
  }
}

/**
 * Write monthly report to GCS (application/json). Simple overwrite; no precondition.
 * @param {{ bucket: string, prefix?: string, monthKey: string, payload: { meta: object, reportSummary: object, report: object } }} opts
 * @returns {Promise<void>}
 */
export async function writeMonthlyCache({ bucket, prefix = '', monthKey, payload }) {
  const storage = new Storage();
  const path = (prefix.replace(/\/?$/, '') + '/' + monthKey).replace(/^\//, '');
  const file = storage.bucket(bucket).file(path);

  const envelope = {
    schemaVersion: SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    periodStart: payload.meta?.periodStart ?? null,
    periodEnd: payload.meta?.periodEnd ?? null,
    data: payload,
  };

  const body = JSON.stringify(envelope, null, 2);

  await file.save(body, {
    metadata: { contentType: 'application/json' },
  });
}
