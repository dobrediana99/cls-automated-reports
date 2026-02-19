/**
 * Sync guard: fail if src/config/org.js and backend/config/org.js diverge on TIMEZONE, DEPARTMENTS, or ORG.
 * Run from repo root (npm test, npm run test:org-sync). Intentionally changing one field in one file will fail this test.
 * Backend Docker context is unchanged: only this test reads src/; runtime code does not.
 */

import { describe, it, expect } from 'vitest';
import * as backendOrg from './org.js';

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
  return {
    MANAGEMENT: dep.MANAGEMENT,
    SALES: dep.SALES,
    OPERATIONS: dep.OPERATIONS,
  };
}

describe('org config sync (src vs backend)', () => {
  // Intentionally changing one field in one file (e.g. TIMEZONE or one ORG entry) will fail this test.
  it('TIMEZONE, DEPARTMENTS, and ORG match between src/config/org.js and backend/config/org.js', async () => {
    const frontendOrg = await import('../../src/config/org.js');
    const bTz = backendOrg.TIMEZONE;
    const fTz = frontendOrg.TIMEZONE;
    expect(bTz, `TIMEZONE mismatch: backend="${bTz}" frontend="${fTz}"`).toBe(fTz);

    const bDep = normalizeDepartments(backendOrg.DEPARTMENTS);
    const fDep = normalizeDepartments(frontendOrg.DEPARTMENTS);
    expect(bDep, 'DEPARTMENTS mismatch').toEqual(fDep);

    const bOrg = normalizeOrg(backendOrg.ORG);
    const fOrg = normalizeOrg(frontendOrg.ORG);
    expect(bOrg?.length, 'ORG length mismatch').toBe(fOrg?.length);
    expect(bOrg, 'ORG content mismatch (order and fields must match)').toEqual(fOrg);
  });
});
