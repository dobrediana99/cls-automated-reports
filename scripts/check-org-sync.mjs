#!/usr/bin/env node
/**
 * Check that src/config/org.js and backend/config/org.js have identical TIMEZONE, DEPARTMENTS, and ORG.
 * Exit 0 if in sync, 1 with message if not. Run from repo root: node scripts/check-org-sync.mjs
 */
import { pathToFileURL } from 'url';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const ORG_KEYS = ['name', 'email', 'mondayUserId', 'department', 'role', 'target', 'isActive'];

function normalizeOrg(org) {
  if (!Array.isArray(org)) return null;
  return org.map((p) => {
    const o = {};
    for (const k of ORG_KEYS) o[k] = p[k];
    return o;
  });
}

function normalizeDepartments(dep) {
  if (!dep || typeof dep !== 'object') return null;
  return { MANAGEMENT: dep.MANAGEMENT, SALES: dep.SALES, OPERATIONS: dep.OPERATIONS };
}

async function main() {
  const backendUrl = pathToFileURL(path.join(root, 'backend/config/org.js')).href;
  const frontendUrl = pathToFileURL(path.join(root, 'src/config/org.js')).href;

  const backendOrg = await import(backendUrl);
  const frontendOrg = await import(frontendUrl);

  if (backendOrg.TIMEZONE !== frontendOrg.TIMEZONE) {
    console.error('org sync check failed: TIMEZONE mismatch', {
      backend: backendOrg.TIMEZONE,
      frontend: frontendOrg.TIMEZONE,
    });
    process.exit(1);
  }
  const bDep = normalizeDepartments(backendOrg.DEPARTMENTS);
  const fDep = normalizeDepartments(frontendOrg.DEPARTMENTS);
  if (JSON.stringify(bDep) !== JSON.stringify(fDep)) {
    console.error('org sync check failed: DEPARTMENTS mismatch', { backend: bDep, frontend: fDep });
    process.exit(1);
  }
  const bOrg = normalizeOrg(backendOrg.ORG);
  const fOrg = normalizeOrg(frontendOrg.ORG);
  if (JSON.stringify(bOrg) !== JSON.stringify(fOrg)) {
    console.error('org sync check failed: ORG mismatch (length or content)');
    process.exit(1);
  }
  console.log('org sync check ok: src/config/org.js and backend/config/org.js match.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
