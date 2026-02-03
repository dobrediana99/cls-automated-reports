/**
 * Local file-based idempotency store. Prevents duplicate sends for the same jobType+label
 * by writing marker files under backend/state/<jobType>-<label>.sent.
 * No Firestore or cloud credentials required.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_DIR = path.join(__dirname, '..', 'state');

function ensureStateDir() {
  if (!fs.existsSync(STATE_DIR)) {
    fs.mkdirSync(STATE_DIR, { recursive: true });
  }
}

/**
 * Safe filename segment: no path separators or reserved chars.
 * @param {string} jobType - e.g. 'weekly' | 'monthly'
 * @param {string} label - e.g. '2026-01-19..2026-01-25'
 * @returns {string} filename without extension
 */
function safeFilename(jobType, label) {
  const safe = String(label).replace(/[/\\?*:]/g, '_');
  return `${jobType}-${safe}.sent`;
}

function markerPath(jobType, label) {
  ensureStateDir();
  return path.join(STATE_DIR, safeFilename(jobType, label));
}

/**
 * Check if this jobType+label was already marked as sent.
 * @param {string} jobType - 'weekly' | 'monthly'
 * @param {string} label - period label (e.g. 2026-01-19..2026-01-25)
 * @returns {boolean}
 */
export function wasAlreadySent(jobType, label) {
  const filePath = markerPath(jobType, label);
  return fs.existsSync(filePath);
}

/**
 * Mark jobType+label as sent. Writes a marker file with JSON { createdAt }.
 * Uses 'wx' flag to create only if not exists (avoids accidental overwrite).
 * If file already exists (e.g. concurrent run), treat as no-op (idempotent).
 * @param {string} jobType - 'weekly' | 'monthly'
 * @param {string} label - period label
 */
export function markAsSent(jobType, label) {
  const filePath = markerPath(jobType, label);
  const payload = {
    createdAt: new Date().toISOString(),
    jobType,
    label,
  };
  try {
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), { flag: 'wx', encoding: 'utf8' });
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
    // Already marked by another process; idempotent success
  }
}

/**
 * Remove the sent marker (for testing or manual reset).
 * @param {string} jobType - 'weekly' | 'monthly'
 * @param {string} label - period label
 */
export function clearSent(jobType, label) {
  const filePath = markerPath(jobType, label);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}
