/**
 * Determinism test: run weekly job 3 times with the same period and compare
 * JSON payload (company totals + department totals). All 3 runs must be identical.
 *
 * Usage (from project root):
 *   DRY_RUN=1 node scripts/test-determinism.js
 * Or with .env loaded (set MONDAY_API_TOKEN etc. in .env):
 *   node scripts/test-determinism.js
 *
 * Uses a fixed "now" so the period (previous calendar week) is the same for all 3 runs.
 * DRY_RUN=1 is set by the script so idempotency is skipped and no email is sent.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { runWeekly } from '../backend/jobs/weekly.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

function loadEnv() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function comparablePayload(result) {
  if (!result?.payload) return null;
  const { reportSummary, meta } = result.payload;
  return {
    reportSummary,
    periodLabel: meta?.label,
    periodStart: meta?.periodStart,
    periodEnd: meta?.periodEnd,
  };
}

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

async function main() {
  loadEnv();
  process.env.DRY_RUN = '1';

  // Fixed "now": Monday 2026-02-03 12:00 UTC => previous week = 2026-01-26..2026-02-01
  const fixedNow = new Date('2026-02-03T12:00:00.000Z');
  const runs = 3;
  const payloads = [];

  console.log('Running weekly job', runs, 'times with fixed period (previous week of', fixedNow.toISOString().slice(0, 10), ')...');
  for (let i = 0; i < runs; i++) {
    const result = await runWeekly(fixedNow);
    const comp = comparablePayload(result);
    if (!comp) {
      console.error('Run', i + 1, 'returned no payload');
      process.exit(1);
    }
    payloads.push(comp);
    console.log('Run', i + 1, 'OK, label:', comp.periodLabel);
  }

  const first = payloads[0];
  for (let i = 1; i < payloads.length; i++) {
    if (!deepEqual(first.reportSummary, payloads[i].reportSummary)) {
      console.error('Determinism FAIL: run 1 and run', i + 1, 'have different reportSummary');
      console.error('Run 1 reportSummary:', JSON.stringify(first.reportSummary, null, 2).slice(0, 500), '...');
      console.error('Run', i + 1, 'reportSummary:', JSON.stringify(payloads[i].reportSummary, null, 2).slice(0, 500), '...');
      process.exit(1);
    }
  }

  console.log('Determinism OK: all', runs, 'runs produced identical reportSummary (company + dept totals).');
  process.exit(0);
}

main().catch((err) => {
  console.error('Script error:', err);
  process.exit(1);
});
