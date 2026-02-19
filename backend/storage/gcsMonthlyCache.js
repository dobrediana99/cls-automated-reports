/**
 * GCS-backed monthly report cache. Path: gs://bucket/prefix/YYYY-MM.json
 * Used when REPORTS_BUCKET is set; on read failure logs and returns null (fallback to recompute).
 * Atomic write: tmp object -> copy to final -> delete tmp. Retry on 429/5xx/network.
 */

import { randomUUID } from 'crypto';
import { Storage } from '@google-cloud/storage';
import { validateMonthlyCacheEnvelope } from './schemas/monthlyCacheEnvelopeSchema.js';

const SCHEMA_VERSION = 1;
const WRITE_MAX_ATTEMPTS = 4;
const WRITE_INITIAL_BACKOFF_MS = 1000;

function isRetryableGcsError(err) {
  const code = err?.code ?? err?.status;
  if (code === 429 || (typeof code === 'number' && code >= 500 && code < 600)) return true;
  const msg = String(err?.message ?? '');
  if (/ECONNRESET|ETIMEDOUT|timeout|UNAVAILABLE|DEADLINE_EXCEEDED/i.test(msg)) return true;
  return false;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

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

    const { valid, errors } = validateMonthlyCacheEnvelope(doc);
    if (!valid) {
      const reason = (errors && errors.length) ? errors.join('; ') : 'invalid envelope shape';
      console.warn('[monthly][cache] invalid envelope, key=', monthKey, 'reason:', reason);
      return null;
    }
    const { meta, reportSummary, report } = doc.data;
    return { meta, reportSummary, report };
  } catch (err) {
    if (err?.code === 404) return null;
    console.error('[monthly][cache] GCS read failed', monthKey, err?.message || err);
    return null;
  }
}

/**
 * Write monthly report to GCS atomically: tmp object -> copy to final -> delete tmp.
 * Retries on 429, 5xx, and network errors.
 * @param {{ bucket: string, prefix?: string, monthKey: string, payload: { meta: object, reportSummary: object, report: object } }} opts
 * @returns {Promise<void>}
 */
export async function writeMonthlyCacheAtomic({ bucket, prefix = '', monthKey, payload }) {
  const storage = new Storage();
  const normalizedPrefix = prefix.replace(/\/?$/, '') + '/';
  const finalPath = (normalizedPrefix + monthKey).replace(/^\//, '');
  const tmpPath = (normalizedPrefix + monthKey.replace(/\.json$/, '') + '.tmp-' + randomUUID() + '.json').replace(/^\//, '');

  const envelope = {
    schemaVersion: SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    periodStart: payload.meta?.periodStart ?? null,
    periodEnd: payload.meta?.periodEnd ?? null,
    data: payload,
  };
  const body = JSON.stringify(envelope, null, 2);
  const opts = { metadata: { contentType: 'application/json' } };

  const bucketObj = storage.bucket(bucket);
  const tmpFile = bucketObj.file(tmpPath);
  const destFile = bucketObj.file(finalPath);

  let lastErr;
  for (let attempt = 1; attempt <= WRITE_MAX_ATTEMPTS; attempt++) {
    try {
      await tmpFile.save(body, opts);
      await tmpFile.copy(destFile);
      try {
        await tmpFile.delete();
      } catch (_) {}
      return;
    } catch (err) {
      lastErr = err;
      if (!isRetryableGcsError(err) || attempt >= WRITE_MAX_ATTEMPTS) {
        throw err;
      }
      await sleep(WRITE_INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1));
    }
  }
  throw lastErr;
}

/**
 * Write monthly report to GCS (application/json). Uses atomic write internally.
 * @param {{ bucket: string, prefix?: string, monthKey: string, payload: { meta: object, reportSummary: object, report: object } }} opts
 * @returns {Promise<void>}
 */
export async function writeMonthlyCache({ bucket, prefix = '', monthKey, payload }) {
  await writeMonthlyCacheAtomic({ bucket, prefix, monthKey, payload });
}
