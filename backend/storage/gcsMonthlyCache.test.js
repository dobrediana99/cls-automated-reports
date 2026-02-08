import { describe, it, expect } from 'vitest';
import { getMonthlyCacheKey } from './gcsMonthlyCache.js';

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
});
