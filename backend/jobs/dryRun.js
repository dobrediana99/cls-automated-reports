import fs from 'fs';
import path from 'path';
import { getOutDir, ensureOutDir } from '../utils/outDir.js';

/**
 * If DRY_RUN=1, writes payload to out dir (OUT_DIR env, or /tmp/out on Cloud Run) and returns the absolute path; otherwise returns undefined.
 * Creates directory if it does not exist.
 * @param {string} jobType - e.g. 'weekly', 'monthly'
 * @param {string} label - e.g. '2026-01-20..2026-01-26'
 * @param {object} payload - JSON-serializable payload
 * @returns {string|undefined} Absolute path of written file, or undefined if not DRY_RUN
 */
export function writeDryRunFile(jobType, label, payload) {
  if (process.env.DRY_RUN !== '1') return undefined;
  const outDir = getOutDir({ dryRun: true });
  ensureOutDir(outDir);
  const filename = `${jobType}_${label}.json`;
  const filePath = path.join(outDir, filename);
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
  return path.resolve(filePath);
}
