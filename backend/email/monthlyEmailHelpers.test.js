/**
 * Tests for monthlyEmailHelpers, including buildDeterministicPerformanceTable (CTR-only).
 */

import { describe, it, expect } from 'vitest';
import { buildDeterministicPerformanceTable } from './monthlyEmailHelpers.js';

describe('buildDeterministicPerformanceTable', () => {
  it('CTR-only: when livr_* has large values, profit and % target use only CTR', () => {
    const data3Months = {
      current: {
        target: 10000,
        ctr_principalProfitEur: 1000,
        ctr_secondaryProfitEur: 0,
        livr_principalProfitEur: 90000,
        livr_secondaryProfitEur: 5000,
        callsCount: 100,
        contactat: 50,
        calificat: 10,
      },
      prev: { target: 5000, ctr_principalProfitEur: 400, livr_principalProfitEur: 80000 },
    };
    const html = buildDeterministicPerformanceTable(data3Months, null, 20);
    expect(html).toContain('1000 EUR');
    expect(html).toContain('10%');
    expect(html).toContain('400 EUR');
    expect(html).toContain('8%');
  });
});
