import { describe, it, expect } from 'vitest';
import { getSnapshotPath, isValidSnapshotSchema } from './monthlySnapshots.js';
import { validateMonthlySnapshot } from './schemas/monthlySnapshotSchema.js';

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
    const validMeta = {
      periodStart: '2026-01-01',
      periodEnd: '2026-01-31',
      label: '2026-01-01..2026-01-31',
    };
    const validMock = {
      schemaVersion: '1.0',
      kind: 'cls.monthlyReportSnapshot',
      period: { month: '2026-01' },
      derived: { meta: validMeta, reportSummary: {}, report: {} },
    };

    it('accepts valid snapshot with schemaVersion, kind, period.month, derived.meta (periodStart/periodEnd/label), reportSummary, report', () => {
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

    it('rejects if derived.meta missing periodStart/periodEnd/label', () => {
      const doc = { ...validMock, derived: { meta: {}, reportSummary: {}, report: {} } };
      expect(isValidSnapshotSchema(doc, '2026-01')).toBe(false);
    });

    it('rejects if derived.report missing', () => {
      const doc = { ...validMock, derived: { meta: validMeta, reportSummary: {} } };
      expect(isValidSnapshotSchema(doc, '2026-01')).toBe(false);
    });

    it('rejects non-object document', () => {
      expect(isValidSnapshotSchema(null, '2026-01')).toBe(false);
      expect(isValidSnapshotSchema(42, '2026-01')).toBe(false);
    });
  });

  describe('validateMonthlySnapshot (defensive)', () => {
    const validMeta = {
      periodStart: '2025-12-01',
      periodEnd: '2025-12-31',
      label: '2025-12-01..2025-12-31',
    };
    const validSnapshot = {
      schemaVersion: '1.0',
      kind: 'cls.monthlyReportSnapshot',
      period: { month: '2025-12' },
      derived: { meta: validMeta, reportSummary: { departments: {} }, report: { opsStats: [] } },
    };

    it('valid snapshot passes validation', () => {
      const result = validateMonthlySnapshot(validSnapshot, '2025-12');
      expect(result.valid).toBe(true);
      expect(result.errors).toBeUndefined();
    });

    it('invalid or missing nested keys rejected with errors array', () => {
      expect(validateMonthlySnapshot({ ...validSnapshot, derived: undefined }, '2025-12').valid).toBe(false);
      expect(validateMonthlySnapshot({ ...validSnapshot, derived: { meta: validMeta } }, '2025-12').valid).toBe(false);
      const noLabel = validateMonthlySnapshot(
        { ...validSnapshot, derived: { ...validSnapshot.derived, meta: { periodStart: 'x', periodEnd: 'y' } } },
        '2025-12'
      );
      expect(noLabel.valid).toBe(false);
      expect(Array.isArray(noLabel.errors)).toBe(true);
    });

    it('malformed JSON shape does not throw (defensive)', () => {
      expect(() => validateMonthlySnapshot(null, '2025-12')).not.toThrow();
      expect(() => validateMonthlySnapshot(undefined, '2025-12')).not.toThrow();
      expect(() => validateMonthlySnapshot('not an object', '2025-12')).not.toThrow();
      expect(validateMonthlySnapshot(null, '2025-12').valid).toBe(false);
    });
  });
});
