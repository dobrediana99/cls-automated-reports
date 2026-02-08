/**
 * GCS I/O for monthly report snapshots (v1).
 * Path: gs://{SNAPSHOT_BUCKET}/monthly_snapshots/YYYY-MM.json
 */

import { Storage } from '@google-cloud/storage';

const DEFAULT_BUCKET = 'cls-automated-reports-data';
const PREFIX = 'monthly_snapshots';

function getBucket() {
  return (process.env.SNAPSHOT_BUCKET || DEFAULT_BUCKET).trim();
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
 * Minimal schema validation: required keys for v1 hit.
 * @param {object} doc - Parsed snapshot
 * @param {string} month - YYYY-MM
 * @returns {boolean}
 */
export function isValidSnapshotSchema(doc, month) {
  if (!doc || typeof doc !== 'object') return false;
  if (doc.schemaVersion !== '1.0' || doc.kind !== 'cls.monthlyReportSnapshot') return false;
  if (!doc.period || doc.period.month !== month) return false;
  if (!doc.derived || typeof doc.derived !== 'object') return false;
  if (!doc.derived.meta || !doc.derived.report) return false;
  return true;
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
    if (!isValidSnapshotSchema(doc, month)) {
      console.log('[snapshot] read month=' + month + ' invalid');
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
 * Write snapshot to GCS (application/json).
 * @param {string} month - YYYY-MM
 * @param {object} snapshotObj - Full v1 snapshot object
 */
export async function writeMonthlySnapshotToGCS(month, snapshotObj) {
  const bucketName = getBucket();
  const path = getSnapshotPath(month);
  const storage = new Storage();
  const file = storage.bucket(bucketName).file(path);

  const body = JSON.stringify(snapshotObj, null, 2);
  await file.save(body, {
    metadata: { contentType: 'application/json' },
  });
  console.log('[snapshot] write month=' + month + ' ok');
}
