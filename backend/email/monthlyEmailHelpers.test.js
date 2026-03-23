/**
 * Tests for monthlyEmailHelpers, including buildDeterministicPerformanceTable (CTR-only).
 */

import { describe, it, expect } from 'vitest';
import { buildDeterministicPerformanceTable } from './monthlyEmailHelpers.js';

describe('buildDeterministicPerformanceTable', () => {
  it('omits CTR summary rows requested by business', () => {
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
    expect(html).not.toContain('Profit contracte (CTR)');
    expect(html).not.toContain('Realizare target');
    expect(html).not.toContain('Curse contracte (CTR)');
    expect(html).toContain('Curse livrate principal');
  });

  it('includes average offer/close time rows with requested labels', () => {
    const data3Months = {
      current: { avgOfferTime: 25, avgCloseTime: 40 },
      prev: { avgOfferTime: 20, avgCloseTime: 35 },
    };
    const html = buildDeterministicPerformanceTable(data3Months, null, 20);
    expect(html).toContain('Timp mediu de ofertare');
    expect(html).toContain('Timp mediu de inchidere');
  });
});
