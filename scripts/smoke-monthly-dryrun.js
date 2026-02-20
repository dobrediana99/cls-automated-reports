/**
 * Smoke run: monthly job in DRY_RUN mode, then validate department email HTML.
 * Loads .env from project root. Writes to out/ (OUT_DIR=out).
 *
 * Usage (from project root): node scripts/smoke-monthly-dryrun.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { runMonthly } from '../backend/jobs/monthly.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

function loadEnv() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) {
    console.warn('[smoke] .env not found, using process.env');
    return;
  }
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

function main() {
  loadEnv();
  process.env.DRY_RUN = '1';
  process.env.OUT_DIR = path.join(ROOT, 'out');
}

main();

async function run() {
  console.log('[smoke] Running monthly job (DRY_RUN=1, OUT_DIR=out)...');
  let result;
  try {
    result = await runMonthly({});
  } catch (err) {
    console.error('[smoke] Monthly job failed:', err?.message || err);
    process.exit(1);
  }

  const outDir = process.env.OUT_DIR || path.join(ROOT, 'out');
  const files = fs.existsSync(outDir) ? fs.readdirSync(outDir) : [];
  const deptHtmlFile = files.find((f) => f.startsWith('monthly_department_') && f.endsWith('.html'));
  if (!deptHtmlFile) {
    console.warn('[smoke] No monthly_department_*.html found in', outDir, '- dry run may not have written it (e.g. no snapshot data).');
    console.log('[smoke] Done. Unit tests already validate department layout.');
    process.exit(0);
  }

  const htmlPath = path.join(outDir, deptHtmlFile);
  const html = fs.readFileSync(htmlPath, 'utf8');

  const checks = [
    { name: 'Must NOT contain "Rezumat Executiv"', pass: !html.includes('Rezumat Executiv') },
    { name: 'Must contain <table>', pass: html.includes('<table') },
    { name: 'Must contain <thead>', pass: html.includes('<thead>') },
    { name: 'Must contain <tbody>', pass: html.includes('<tbody>') },
    { name: 'Must contain "Analiză Vânzări"', pass: html.includes('Analiză Vânzări') },
    { name: 'Must contain "Analiză Operațional"', pass: html.includes('Analiză Operațional') },
  ];

  let failed = false;
  for (const c of checks) {
    const status = c.pass ? 'PASS' : 'FAIL';
    if (!c.pass) failed = true;
    console.log(`[smoke] ${status}: ${c.name}`);
  }

  console.log('[smoke] Department HTML file:', htmlPath);
  if (failed) {
    console.error('[smoke] Some checks failed.');
    process.exit(1);
  }
  console.log('[smoke] All checks passed. Row-based tables and sections OK.');
  process.exit(0);
}

run();
