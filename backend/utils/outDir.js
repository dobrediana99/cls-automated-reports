/**
 * Output directory for job artifacts (DRY_RUN JSON/HTML/XLSX).
 * Cloud Run filesystem is read-only except /tmp; use OUT_DIR env or /tmp/out when DRY_RUN.
 */

import fs from 'fs';
import path from 'path';

/**
 * Resolve output directory for job writes.
 * - If OUT_DIR env is set and non-empty, use it.
 * - Else if dryRun is true, default to /tmp/out (Cloud Run safe).
 * - Else default to process.cwd()/out for local dev.
 * @param {{ dryRun?: boolean }} opts
 * @returns {string} Absolute path to output directory
 */
export function getOutDir(opts = {}) {
  const dryRun = opts.dryRun === true;
  const envOut = process.env.OUT_DIR;
  if (envOut != null && String(envOut).trim() !== '') {
    return path.resolve(envOut.trim());
  }
  if (dryRun) {
    return '/tmp/out';
  }
  return path.join(process.cwd(), 'out');
}

/**
 * Ensure directory exists (recursive). Throws with a helpful message on failure.
 * @param {string} dir - Absolute or relative path
 * @throws {Error} If mkdirSync fails
 */
export function ensureOutDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (e) {
    const message = e?.message ?? String(e);
    throw new Error(`Failed to create output directory ${dir}: ${message}`);
  }
}
