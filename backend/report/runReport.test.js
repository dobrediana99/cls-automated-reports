import { describe, it, expect } from 'vitest';
import { computeTotals } from './runReport.js';

describe('computeTotals', () => {
  it('profitTotal is CTR only (ctr_principalProfitEur + ctr_secondaryProfitEur), Report_monday parity', () => {
    const rows = [
      {
        ctr_principalProfitEur: 100,
        ctr_secondaryProfitEur: 50,
        livr_principalProfitEur: 200,
        livr_secondaryProfitEur: 100,
        websiteProfit: 10,
        websiteProfitSec: 5,
        target: 80,
      },
      {
        ctr_principalProfitEur: 60,
        ctr_secondaryProfitEur: 40,
        livr_principalProfitEur: 0,
        livr_secondaryProfitEur: 0,
        websiteProfit: 0,
        websiteProfitSec: 0,
        target: 100,
      },
    ];
    const totals = computeTotals(rows);
    expect(totals.profitTotal).toBe(100 + 50 + 60 + 40);
    expect(totals.profitTotal).toBe(250);
    expect(totals.targetTotal).toBe(80 + 100);
  });
});
