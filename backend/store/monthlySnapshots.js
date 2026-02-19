/**
 * GCS I/O for monthly report snapshots (v1).
 * Path: gs://{SNAPSHOT_BUCKET}/monthly_snapshots/YYYY-MM.json
 * Atomic write: tmp object then copy to final, then delete tmp. Retry on 429/5xx/network.
 */

import { randomUUID } from 'crypto';
import { Storage } from '@google-cloud/storage';
import { validateMonthlySnapshot } from './schemas/monthlySnapshotSchema.js';

const DEFAULT_BUCKET = 'cls-automated-reports-data';
const PREFIX = 'monthly_snapshots';
const WRITE_MAX_ATTEMPTS = 4;
const WRITE_INITIAL_BACKOFF_MS = 1000;

function getBucket() {
  return (process.env.SNAPSHOT_BUCKET || DEFAULT_BUCKET).trim();
}

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
 * Object path for a month (no leading slash).
 * @param {string} month - YYYY-MM
 * @returns {string} e.g. "monthly_snapshots/2026-01.json"
 */
export function getSnapshotPath(month) {
  const safe = String(month).replace(/[^0-9-]/g, '');
  if (!/^\d{4}-\d{2}$/.test(safe)) {
    throw new Error(`Invalid month for snapshot path: ${month}`);
  }
  return `${PREFIX}/${safe}.json`;
}

/**
 * Schema validation for v1 snapshot (schemaVersion, kind, period.month, derived.meta/reportSummary/report).
 * @param {object} doc - Parsed snapshot
 * @param {string} month - YYYY-MM
 * @returns {boolean}
 */
export function isValidSnapshotSchema(doc, month) {
  return validateMonthlySnapshot(doc, month).valid;
}

/**
 * Read snapshot from GCS. Returns null if not found or invalid (log + fallback).
 * @param {string} month - YYYY-MM
 * @returns {Promise<object|null>}
 */
export async function readMonthlySnapshotFromGCS(month) {
  const bucketName = getBucket();
  const path = getSnapshotPath(month);
  const storage = new Storage();
  const file = storage.bucket(bucketName).file(path);

  try {
    const [contents] = await file.download();
    const doc = JSON.parse(contents.toString('utf8'));
    const { valid, errors } = validateMonthlySnapshot(doc, month);
    if (!valid) {
      const reason = (errors && errors.length) ? errors.join('; ') : 'invalid shape';
      console.log('[snapshot] read month=' + month + ' invalid: ' + reason);
      return null;
    }
    console.log('[snapshot] read month=' + month + ' hit');
    return doc;
  } catch (err) {
    if (err?.code === 404) {
      console.log('[snapshot] read month=' + month + ' miss');
      return null;
    }
    const code = err?.code ?? err?.message ?? 'unknown';
    console.log('[snapshot] read month=' + month + ' miss err=' + code);
    return null;
  }
}

/**
 * Write snapshot to GCS atomically: tmp object -> copy to final -> delete tmp.
 * Retries on 429, 5xx, and network errors. No secrets in logs.
 * @param {string} month - YYYY-MM
 * @param {object} snapshotObj - Full v1 snapshot object
 */
export async function writeMonthlySnapshotToGCSAtomic(month, snapshotObj) {
  const bucketName = getBucket();
  const finalPath = getSnapshotPath(month);
  const tmpPath = `${PREFIX}/${month}.json.tmp-${randomUUID()}`;
  const storage = new Storage();
  const bucket = storage.bucket(bucketName);
  const tmpFile = bucket.file(tmpPath);
  const destFile = bucket.file(finalPath);
  const body = JSON.stringify(snapshotObj, null, 2);
  const opts = { metadata: { contentType: 'application/json' } };

  let lastErr;
  for (let attempt = 1; attempt <= WRITE_MAX_ATTEMPTS; attempt++) {
    try {
      await tmpFile.save(body, opts);
      await tmpFile.copy(destFile);
      try {
        await tmpFile.delete();
      } catch (_) {
        // best-effort cleanup
      }
      console.log('[snapshot][write] month=' + month + ' ok=true');
      return;
    } catch (err) {
      lastErr = err;
      const statusCode = err?.code ?? err?.status;
      const retryable = isRetryableGcsError(err);
      console.error('[snapshot][write-error] month=' + month + ' statusCode=' + (statusCode ?? '') + ' retryable=' + retryable);
      if (!retryable || attempt >= WRITE_MAX_ATTEMPTS) {
        throw err;
      }
      const delay = WRITE_INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1);
      await sleep(delay);
    }
  }
  throw lastErr;
}

/**
 * Write snapshot to GCS (application/json). Uses atomic write internally.
 * @param {string} month - YYYY-MM
 * @param {object} snapshotObj - Full v1 snapshot object
 */
export async function writeMonthlySnapshotToGCS(month, snapshotObj) {
  await writeMonthlySnapshotToGCSAtomic(month, snapshotObj);
  console.log('[snapshot] write month=' + month + ' ok');
}

const RUNS_PREFIX = 'monthly_runs';
const MANIFEST_VERSION = 1;

/**
 * Write run-level checkpoint manifest to GCS (no secrets). Path: monthly_runs/monthly-<label>.json
 * If write fails, log warning only; do not fail the job.
 * @param {{ jobType: string, label: string, months: string[], perMonth: Record<string, { source: 'hit'|'computed', wrote: boolean }> }} opts
 */
export async function writeMonthlyRunManifestToGCS(opts) {
  const { jobType, label, months, perMonth } = opts;
  const safeLabel = String(label).replace(/[/\\?*:]/g, '_');
  const objectName = `${RUNS_PREFIX}/${jobType}-${safeLabel}.json`;
  const manifest = {
    label: opts.label,
    months: months ?? [],
    perMonth: perMonth ?? {},
    createdAt: new Date().toISOString(),
    version: MANIFEST_VERSION,
  };
  try {
    const bucketName = getBucket();
    const storage = new Storage();
    const file = storage.bucket(bucketName).file(objectName);
    await file.save(JSON.stringify(manifest, null, 2), {
      metadata: { contentType: 'application/json' },
    });
  } catch (err) {
    console.warn('[snapshot][manifest] write failed', objectName, err?.message ?? err);
  }
}
