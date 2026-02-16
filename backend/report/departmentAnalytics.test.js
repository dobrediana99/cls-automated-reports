import { describe, it, expect } from 'vitest';
import { buildDepartmentAnalytics } from './departmentAnalytics.js';

describe('buildDepartmentAnalytics', () => {
  it('computes high/low performers determinist when data exists', () => {
    const baseRow = (overrides) => ({
      id: overrides.id,
      name: overrides.name,
      mondayId: overrides.mondayId ?? overrides.id,
      target: overrides.target ?? 1000,
      ctr_principalCount: overrides.ctr_principalCount ?? 0,
      ctr_secondaryCount: overrides.ctr_secondaryCount ?? 0,
      ctr_principalProfitEur: overrides.ctr_principalProfitEur ?? 0,
      ctr_secondaryProfitEur: overrides.ctr_secondaryProfitEur ?? 0,
      livr_principalCount: overrides.livr_principalCount ?? 0,
      livr_principalProfitEur: overrides.livr_principalProfitEur ?? 0,
      livr_secondaryCount: overrides.livr_secondaryCount ?? 0,
      livr_secondaryProfitEur: overrides.livr_secondaryProfitEur ?? 0,
      profitRonRaw: 0,
      websiteCount: 0,
      websiteProfit: 0,
      solicitariCount: 0,
      contactat: 0,
      calificat: 0,
      emailsCount: 0,
      callsCount: 0,
      sumClientTerms: 0,
      countClientTerms: 0,
      sumSupplierTerms: 0,
      countSupplierTerms: 0,
      overdueInvoicesCount: 0,
      supplierTermsUnder30: 0,
      supplierTermsOver30: 0,
      sumProfitability: 0,
      countProfitability: 0,
      websiteCountSec: 0,
      websiteProfitSec: 0,
      burseCountCtrPrincipal: 0,
      burseCountCtrSecondary: 0,
      burseCountLivrPrincipal: 0,
      burseCountLivrSecondary: 0,
      burseCount: overrides.burseCount ?? 0,
    });

    const currentRows = {
      operational: [
        baseRow({ id: 'A', name: 'A', ctr_principalCount: 20, ctr_principalProfitEur: 2000, target: 1500 }), // high
        baseRow({ id: 'B', name: 'B', ctr_principalCount: 5, ctr_principalProfitEur: 300, target: 1000 }), // low
        baseRow({ id: 'C', name: 'C', ctr_principalCount: 10, ctr_principalProfitEur: 1000, target: 1000 }),
      ],
      sales: [],
    };

    const analytics = buildDepartmentAnalytics({
      current: { rows: currentRows, summary: null },
      prev1: { rows: currentRows, summary: null },
      periodStart: '2026-01-01',
    });

    expect(analytics).toHaveProperty('meta');
    expect(analytics.meta).toHaveProperty('periodStart', '2026-01-01');
    expect(analytics).toHaveProperty('sales');
    expect(analytics).toHaveProperty('operational');
    expect(analytics.sales).toMatchObject({
      headcount: expect.any(Object),
      averages: expect.any(Object),
      highPerformers: expect.any(Array),
      lowPerformers: expect.any(Array),
      volatility: expect.any(Array),
      employeeIssues: expect.any(Array),
      systemicIssues: expect.any(Array),
    });
    expect(analytics.operational).toMatchObject({
      headcount: expect.any(Object),
      averages: expect.any(Object),
      highPerformers: expect.any(Array),
      lowPerformers: expect.any(Array),
      volatility: expect.any(Array),
      employeeIssues: expect.any(Array),
      systemicIssues: expect.any(Array),
    });

    expect(analytics.operational.highPerformers.length).toBeGreaterThanOrEqual(1);
    expect(analytics.operational.lowPerformers.length).toBeGreaterThanOrEqual(1);
    const highNames = analytics.operational.highPerformers.map((p) => p.name);
    const lowNames = analytics.operational.lowPerformers.map((p) => p.name);
    expect(highNames).toContain('A');
    expect(lowNames).toContain('B');
  });

  it('buildDepartmentAnalytics accepts only current, prev1, periodStart (2 luni, fără prev2)', () => {
    const analytics = buildDepartmentAnalytics({
      current: { rows: { operational: [], sales: [] }, summary: null },
      prev1: { rows: { operational: [], sales: [] }, summary: null },
      periodStart: '2026-02-01',
    });
    expect(analytics.meta.periodStart).toBe('2026-02-01');
    expect(analytics.sales.headcount.totalEmployees).toBe(0);
    expect(analytics.operational.headcount.totalEmployees).toBe(0);
  });
});

