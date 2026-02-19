import { describe, it, expect } from 'vitest';
import { getMonthlyCacheKey } from './gcsMonthlyCache.js';
import { validateMonthlyCacheEnvelope } from './schemas/monthlyCacheEnvelopeSchema.js';

describe('gcsMonthlyCache', () => {
  describe('getMonthlyCacheKey', () => {
    it('returns YYYY-MM.json for ISO period start string', () => {
      expect(getMonthlyCacheKey('2026-01-01T00:00:00.000Z')).toBe('2026-01.json');
      expect(getMonthlyCacheKey('2025-12-15T12:00:00+02:00')).toBe('2025-12.json');
    });

    it('returns YYYY-MM.json for Date', () => {
      expect(getMonthlyCacheKey(new Date('2026-03-01T00:00:00Z'))).toBe('2026-03.json');
    });

    it('uses first 7 chars (YYYY-MM) only', () => {
      expect(getMonthlyCacheKey('2026-01-31T23:59:59.999Z')).toBe('2026-01.json');
    });

    it('throws for invalid periodStartDate', () => {
      expect(() => getMonthlyCacheKey('invalid')).toThrow(/Invalid periodStartDate/);
      expect(() => getMonthlyCacheKey('202601')).toThrow(/Invalid periodStartDate/);
      expect(() => getMonthlyCacheKey('')).toThrow(/Invalid periodStartDate/);
    });
  });

  describe('validateMonthlyCacheEnvelope (defensive)', () => {
    const validMeta = {
      periodStart: '2026-01-01',
      periodEnd: '2026-01-31',
      label: '2026-01-01..2026-01-31',
    };
    const validEnvelope = {
      schemaVersion: 1,
      data: {
        meta: validMeta,
        reportSummary: { departments: {}, company: {} },
        report: { opsStats: [], salesStats: [], mgmtStats: [], companyStats: {} },
      },
    };

    it('valid cache envelope passes', () => {
      const result = validateMonthlyCacheEnvelope(validEnvelope);
      expect(result.valid).toBe(true);
      expect(result.errors).toBeUndefined();
    });

    it('invalid or missing nested keys rejected as miss', () => {
      expect(validateMonthlyCacheEnvelope(null).valid).toBe(false);
      expect(validateMonthlyCacheEnvelope({}).valid).toBe(false);
      expect(validateMonthlyCacheEnvelope({ schemaVersion: 1 }).valid).toBe(false);
      expect(validateMonthlyCacheEnvelope({ schemaVersion: 1, data: {} }).valid).toBe(false);
      expect(validateMonthlyCacheEnvelope({ schemaVersion: 1, data: { meta: validMeta } }).valid).toBe(false);
      const missingLabel = validateMonthlyCacheEnvelope({
        schemaVersion: 1,
        data: {
          meta: { periodStart: 'x', periodEnd: 'y' },
          reportSummary: {},
          report: {},
        },
      });
      expect(missingLabel.valid).toBe(false);
      expect(Array.isArray(missingLabel.errors)).toBe(true);
    });

    it('malformed envelope does not throw', () => {
      expect(() => validateMonthlyCacheEnvelope(null)).not.toThrow();
      expect(() => validateMonthlyCacheEnvelope(undefined)).not.toThrow();
      expect(() => validateMonthlyCacheEnvelope('string')).not.toThrow();
      expect(validateMonthlyCacheEnvelope(null).valid).toBe(false);
    });
  });
});
