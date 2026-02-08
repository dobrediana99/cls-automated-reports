import { describe, it, expect } from 'vitest';
import { getSnapshotPath, isValidSnapshotSchema } from './monthlySnapshots.js';

describe('monthlySnapshots', () => {
  describe('getSnapshotPath', () => {
    it('returns monthly_snapshots/2026-01.json for 2026-01', () => {
      expect(getSnapshotPath('2026-01')).toBe('monthly_snapshots/2026-01.json');
    });

    it('returns monthly_snapshots/YYYY-MM.json for other months', () => {
      expect(getSnapshotPath('2025-12')).toBe('monthly_snapshots/2025-12.json');
    });

    it('throws for invalid month', () => {
      expect(() => getSnapshotPath('invalid')).toThrow(/Invalid month/);
      expect(() => getSnapshotPath('202601')).toThrow(/Invalid month/);
      expect(() => getSnapshotPath('')).toThrow(/Invalid month/);
    });
  });

  describe('isValidSnapshotSchema', () => {
    const validMock = {
      schemaVersion: '1.0',
      kind: 'cls.monthlyReportSnapshot',
      period: { month: '2026-01' },
      derived: { meta: {}, reportSummary: {}, report: {} },
    };

    it('accepts mock with schemaVersion, kind, period.month, derived.meta, derived.report', () => {
      expect(isValidSnapshotSchema(validMock, '2026-01')).toBe(true);
    });

    it('rejects if schemaVersion missing', () => {
      const doc = { ...validMock, schemaVersion: undefined };
      expect(isValidSnapshotSchema(doc, '2026-01')).toBe(false);
    });

    it('rejects if kind missing', () => {
      const doc = { ...validMock, kind: undefined };
      expect(isValidSnapshotSchema(doc, '2026-01')).toBe(false);
    });

    it('rejects if period.month does not match', () => {
      expect(isValidSnapshotSchema(validMock, '2026-02')).toBe(false);
    });

    it('rejects if derived.meta missing', () => {
      const doc = { ...validMock, derived: { reportSummary: {}, report: {} } };
      expect(isValidSnapshotSchema(doc, '2026-01')).toBe(false);
    });

    it('rejects if derived.report missing', () => {
      const doc = { ...validMock, derived: { meta: {}, reportSummary: {} } };
      expect(isValidSnapshotSchema(doc, '2026-01')).toBe(false);
    });
  });
});
