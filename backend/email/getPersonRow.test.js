/**
 * Tests for shared getPersonRow helper: edge cases (empty list, mondayUserId mismatch + fallback by name, ambiguous name).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getPersonRow } from './getPersonRow.js';
import { DEPARTMENTS } from '../config/org.js';

describe('getPersonRow', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns null and warns when department list is empty', () => {
    const report = {
      opsStats: [],
      salesStats: [],
      mgmtStats: [],
    };
    const person = { name: 'Alice', department: DEPARTMENTS.OPERATIONS, mondayUserId: 1 };
    const row = getPersonRow(report, person);
    expect(row).toBeNull();
    expect(console.warn).toHaveBeenCalledWith(
      '[getPersonRow] empty list for department',
      expect.objectContaining({ person: 'Alice', department: DEPARTMENTS.OPERATIONS })
    );
  });

  it('falls back to name when mondayUserId has no match and returns single name match', () => {
    const report = {
      opsStats: [{ name: 'Bob', mondayId: 999, target: 100 }],
      salesStats: [],
      mgmtStats: [],
    };
    const person = { name: 'Bob', department: DEPARTMENTS.OPERATIONS, mondayUserId: 111 };
    const row = getPersonRow(report, person);
    expect(row).toEqual({ name: 'Bob', mondayId: 999, target: 100 });
    expect(console.warn).toHaveBeenCalledWith(
      '[getPersonRow] no row for mondayUserId',
      expect.objectContaining({ name: 'Bob', mondayUserId: 111, department: DEPARTMENTS.OPERATIONS })
    );
  });

  it('returns null and warns on ambiguous name match (multiple rows same name)', () => {
    const report = {
      opsStats: [
        { name: 'Carol', mondayId: 1, target: 100 },
        { name: 'Carol', mondayId: 2, target: 200 },
      ],
      salesStats: [],
      mgmtStats: [],
    };
    const person = { name: 'Carol', department: DEPARTMENTS.OPERATIONS };
    const row = getPersonRow(report, person);
    expect(row).toBeNull();
    expect(console.warn).toHaveBeenCalledWith(
      '[getPersonRow] ambiguous match by name',
      expect.objectContaining({ name: 'Carol', department: DEPARTMENTS.OPERATIONS })
    );
  });

  it('returns row when mondayUserId matches', () => {
    const report = {
      opsStats: [{ name: 'Dave', mondayId: 42, target: 50 }],
      salesStats: [],
      mgmtStats: [],
    };
    const person = { name: 'Dave', department: DEPARTMENTS.OPERATIONS, mondayUserId: 42 };
    const row = getPersonRow(report, person);
    expect(row).toEqual({ name: 'Dave', mondayId: 42, target: 50 });
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('returns null and warns when no match by id or name', () => {
    const report = {
      opsStats: [{ name: 'Eve', mondayId: 1, target: 10 }],
      salesStats: [],
      mgmtStats: [],
    };
    const person = { name: 'Unknown', department: DEPARTMENTS.OPERATIONS, mondayUserId: 99 };
    const row = getPersonRow(report, person);
    expect(row).toBeNull();
    expect(console.warn).toHaveBeenCalledWith(
      '[getPersonRow] no row for mondayUserId',
      expect.any(Object)
    );
    expect(console.warn).toHaveBeenCalledWith(
      '[getPersonRow] no match',
      expect.objectContaining({ name: 'Unknown', department: DEPARTMENTS.OPERATIONS })
    );
  });
});
