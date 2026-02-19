/**
 * Unit tests for deterministic KPI calculations.
 */

import { describe, it, expect } from 'vitest';
import {
  round2,
  totalProfitEur,
  calcTargetAchievementPct,
  assertValidPeriod,
  calcTargetAchievementCombined,
  calcTargetAchievementWithManagement,
  formatRealizareTargetForEmail,
  calcCallsPerWorkingDay,
  calcProspectingConversion,
  calcProspectingConversionPct,
  countWorkingDays,
  buildReportKpi,
} from './kpiCalc.js';

describe('round2', () => {
  it('rounds to 2 decimals', () => {
    expect(round2(23.234)).toBe(23.23);
    expect(round2(23.236)).toBe(23.24);
    expect(round2(28.81)).toBe(28.81);
  });
  it('returns null for non-finite', () => {
    expect(round2(NaN)).toBe(null);
    expect(round2(Infinity)).toBe(null);
    expect(round2(null)).toBe(null);
  });
});

describe('assertValidPeriod', () => {
  it('passes when periodStart <= periodEnd and workingDaysInPeriod > 0', () => {
    expect(() => assertValidPeriod({
      periodStart: '2026-01-01',
      periodEnd: '2026-01-31',
      workingDaysInPeriod: 22,
    })).not.toThrow();
  });
  it('throws when periodStart > periodEnd', () => {
    expect(() => assertValidPeriod({
      periodStart: '2026-01-31',
      periodEnd: '2026-01-01',
      workingDaysInPeriod: 22,
    })).toThrow(/periodStart.*periodEnd/);
  });
  it('throws when workingDaysInPeriod <= 0', () => {
    expect(() => assertValidPeriod({
      periodStart: '2026-01-01',
      periodEnd: '2026-01-31',
      workingDaysInPeriod: 0,
    })).toThrow(/workingDaysInPeriod/);
    expect(() => assertValidPeriod({
      periodStart: '2026-01-01',
      periodEnd: '2026-01-31',
      workingDaysInPeriod: -1,
    })).toThrow(/workingDaysInPeriod/);
  });
});

describe('calcTargetAchievementCombined', () => {
  it('returns 80% for salesProfit=12000, opsProfit=8000, salesTarget=15000, opsTarget=10000', () => {
    const departments = {
      sales: { profitTotal: 12000, targetTotal: 15000 },
      operational: { profitTotal: 8000, targetTotal: 10000 },
    };
    expect(calcTargetAchievementCombined(departments)).toBe(80);
  });
  it('returns null when combined target is 0', () => {
    const departments = {
      sales: { profitTotal: 0, targetTotal: 0 },
      operational: { profitTotal: 0, targetTotal: 0 },
    };
    expect(calcTargetAchievementCombined(departments)).toBe(null);
  });
  it('ignores management', () => {
    const departments = {
      sales: { profitTotal: 100, targetTotal: 100 },
      operational: { profitTotal: 100, targetTotal: 100 },
      management: { profitTotal: 9999, targetTotal: 1 },
    };
    expect(calcTargetAchievementCombined(departments)).toBe(100);
  });
});

describe('calcTargetAchievementWithManagement', () => {
  it('includes management in numerator and denominator', () => {
    const departments = {
      sales: { profitTotal: 12000, targetTotal: 15000 },
      operational: { profitTotal: 8000, targetTotal: 10000 },
      management: { profitTotal: 2000, targetTotal: 5000 },
    };
    // (12000+8000+2000)/(15000+10000+5000) = 22000/30000 = 73.33%
    expect(calcTargetAchievementWithManagement(departments)).toBe(73.33);
  });
  it('returns null when combined target is 0', () => {
    const departments = {
      sales: { profitTotal: 0, targetTotal: 0 },
      operational: { profitTotal: 0, targetTotal: 0 },
      management: { profitTotal: 0, targetTotal: 0 },
    };
    expect(calcTargetAchievementWithManagement(departments)).toBe(null);
  });
  it('treats missing management as 0', () => {
    const departments = {
      sales: { profitTotal: 12000, targetTotal: 15000 },
      operational: { profitTotal: 8000, targetTotal: 10000 },
    };
    expect(calcTargetAchievementWithManagement(departments)).toBe(80);
  });
});

describe('formatRealizareTargetForEmail', () => {
  it('formats number as XX.XX%', () => {
    expect(formatRealizareTargetForEmail(73.33)).toBe('73.33%');
    expect(formatRealizareTargetForEmail(100)).toBe('100%');
  });
  it('returns N/A for null or non-finite', () => {
    expect(formatRealizareTargetForEmail(null)).toBe('N/A');
    expect(formatRealizareTargetForEmail(undefined)).toBe('N/A');
    expect(formatRealizareTargetForEmail(NaN)).toBe('N/A');
  });
});

describe('totalProfitEur', () => {
  it('sums ctr + livr principal and secondary', () => {
    const row = {
      ctr_principalProfitEur: 10000,
      ctr_secondaryProfitEur: 0,
      livr_principalProfitEur: 10000,
      livr_secondaryProfitEur: 0,
    };
    expect(totalProfitEur(row)).toBe(20000);
  });
  it('returns 0 for missing or non-numeric fields', () => {
    expect(totalProfitEur({})).toBe(0);
    expect(totalProfitEur(null)).toBe(0);
  });
});

describe('calcTargetAchievementPct', () => {
  it('returns 80.00 for profit 20000, target 25000', () => {
    const row = {
      ctr_principalProfitEur: 10000,
      ctr_secondaryProfitEur: 0,
      livr_principalProfitEur: 10000,
      livr_secondaryProfitEur: 0,
      target: 25000,
    };
    expect(calcTargetAchievementPct(row)).toBe(80);
  });
  it('returns null when target <= 0', () => {
    expect(calcTargetAchievementPct({ target: 0, ctr_principalProfitEur: 100 })).toBe(null);
    expect(calcTargetAchievementPct({ target: -1 })).toBe(null);
  });
});

describe('countWorkingDays', () => {
  it('2026-02-02..2026-02-06 => 5 (Mon-Fri)', () => {
    expect(countWorkingDays('2026-02-02', '2026-02-06')).toBe(5);
  });
  it('accepts optional timezone (default Europe/Bucharest)', () => {
    expect(countWorkingDays('2026-02-02', '2026-02-06', 'Europe/Bucharest')).toBe(5);
  });
  it('returns null for invalid or end < start', () => {
    expect(countWorkingDays('2026-02-06', '2026-02-02')).toBe(null);
    expect(countWorkingDays(null, '2026-02-02')).toBe(null);
    expect(countWorkingDays('2026-02-02', null)).toBe(null);
  });
});

describe('calcCallsPerWorkingDay', () => {
  it('calcCallsPerWorkingDay(605, 21) => 28.81', () => {
    expect(calcCallsPerWorkingDay(605, 21)).toBe(28.81);
  });
  it('returns null when workingDaysInPeriod invalid', () => {
    expect(calcCallsPerWorkingDay(100, 0)).toBe(null);
    expect(calcCallsPerWorkingDay(100, -1)).toBe(null);
  });
  it('returns null when callsCount negative or non-numeric', () => {
    expect(calcCallsPerWorkingDay(-1, 21)).toBe(null);
    expect(calcCallsPerWorkingDay(NaN, 21)).toBe(null);
  });
});

describe('calcProspectingConversion', () => {
  it('calcProspectingConversion(555, 129) ≈ 23.24', () => {
    const result = calcProspectingConversion(555, 129);
    expect(result).toBeGreaterThanOrEqual(23.2);
    expect(result).toBeLessThanOrEqual(23.3);
  });
  it('returns 0 when contactat is 0 (no NaN)', () => {
    expect(calcProspectingConversion(0, 100)).toBe(0);
  });
});

describe('calcProspectingConversionPct', () => {
  it('calcProspectingConversionPct(555, 129) => 23.24', () => {
    expect(calcProspectingConversionPct(555, 129)).toBe(23.24);
  });
  it('returns 0 when contactat is 0', () => {
    expect(calcProspectingConversionPct(0, 100)).toBe(0);
  });
  it('returns null when contactat or calificat negative', () => {
    expect(calcProspectingConversionPct(-1, 100)).toBe(null);
    expect(calcProspectingConversionPct(100, -1)).toBe(null);
  });
});

describe('buildReportKpi', () => {
  it('builds full kpi object with department data', () => {
    const meta = { periodStart: '2026-01-01', periodEnd: '2026-01-31', workingDaysInPeriod: 22 };
    const departments = {
      sales: { profitTotal: 12000, targetTotal: 15000, contactat: 555, calificat: 129, callsCount: 605 },
      operational: { profitTotal: 8000, targetTotal: 10000 },
    };
    const kpi = buildReportKpi(meta, departments);
    expect(kpi.periodStart).toBe('2026-01-01');
    expect(kpi.periodEnd).toBe('2026-01-31');
    expect(kpi.workingDaysInPeriod).toBe(22);
    expect(kpi.realizareTargetCombinatPct).toBe(80);
    expect(kpi.apeluriMediiZi).toBe(27.5); // 605/22 ≈ 27.5
    expect(kpi.conversieProspectarePct).toBeGreaterThanOrEqual(23.2);
    expect(kpi.conversieProspectarePct).toBeLessThanOrEqual(23.3);
    expect(kpi.conversionScope).toBe('department');
  });
  it('throws when meta invalid', () => {
    expect(() => buildReportKpi({ periodStart: '2026-01-31', periodEnd: '2026-01-01', workingDaysInPeriod: 22 }, { sales: {}, operational: {} })).toThrow();
    expect(() => buildReportKpi({ periodStart: '2026-01-01', periodEnd: '2026-01-31', workingDaysInPeriod: 0 }, { sales: {}, operational: {} })).toThrow();
  });
});
