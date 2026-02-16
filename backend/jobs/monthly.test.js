/**
 * Monthly job tests. OpenRouter hardening (400 fallback, JSON retry, schema repair, timeout)
 * is covered in backend/llm/openrouterClient.test.js with mocked fetch.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runReport } from '../report/runReport.js';
import { requireOpenRouter, generateMonthlySections, generateMonthlyDepartmentSections } from '../llm/openrouterClient.js';
import { loadOrComputeMonthlyReport } from '../report/runMonthlyPeriods.js';
import { runMonthly } from './monthly.js';

vi.mock('../report/runReport.js', () => ({
  runReport: vi.fn().mockResolvedValue({
    meta: { periodStart: '2025-12-01', periodEnd: '2025-12-31', label: '2025-12-01..2025-12-31' },
    reportSummary: { departments: { operational: {}, sales: {}, management: {} }, company: {} },
    report: { opsStats: [], salesStats: [], mgmtStats: [], companyStats: {} },
  }),
}));
vi.mock('../report/runMonthlyPeriods.js', () => {
  const mockMeta = { periodStart: '2025-12-01', periodEnd: '2025-12-31', label: '2025-12-01..2025-12-31' };
  const mockSummary = { departments: { operational: {}, sales: {}, management: {} }, company: {} };
  const mockReport = { opsStats: [], salesStats: [], mgmtStats: [], companyStats: {} };
  const mockResult = { meta: mockMeta, reportSummary: mockSummary, report: mockReport };
  return {
    getMonthlyPeriods: vi.fn().mockReturnValue([
      { yyyyMm: '2025-12', start: '2025-12-01', end: '2025-12-31', label: '2025-12-01..2025-12-31' },
      { yyyyMm: '2025-11', start: '2025-11-01', end: '2025-11-30', label: '2025-11-01..2025-11-30' },
      { yyyyMm: '2025-10', start: '2025-10-01', end: '2025-10-31', label: '2025-10-01..2025-10-31' },
    ]),
    loadOrComputeMonthlyReport: vi.fn().mockResolvedValue(mockResult),
  };
});
vi.mock('../cache/monthlyReportCache.js', () => ({
  ensureMonthlyCacheDir: vi.fn(),
  getMonthlyCachePath: vi.fn((yyyyMm) => `/out/cache/monthly/${yyyyMm}.json`),
  loadMonthlyReportFromCache: vi.fn().mockReturnValue(null),
  saveMonthlyReportToCache: vi.fn(),
}));
vi.mock('../llm/openrouterClient.js', () => ({
  requireOpenRouter: vi.fn(),
  generateMonthlySections: vi.fn().mockResolvedValue({
    interpretareHtml: '<p>Interpretare</p>',
    concluziiHtml: '<p>Concluzii</p>',
    actiuniHtml: '<p>Acțiuni</p>',
    planHtml: '<p>Plan</p>',
  }),
  generateMonthlyDepartmentSections: vi.fn().mockResolvedValue({
    rezumatExecutivHtml: '<p>Rezumat</p>',
    vanzariHtml: '<p>Vânzări</p>',
    operationalHtml: '<p>Operațional</p>',
    comparatiiHtml: '<p>Comparații</p>',
    recomandariHtml: '<p>Recomandări</p>',
  }),
}));
vi.mock('../prompts/loadPrompts.js', () => ({
  loadMonthlyEmployeePrompt: vi.fn().mockReturnValue('Employee prompt'),
  loadMonthlyDepartmentPrompt: vi.fn().mockReturnValue('Department prompt'),
}));
vi.mock('./dryRun.js', () => ({ writeDryRunFile: vi.fn().mockReturnValue('/out/monthly_2025-12-01..2025-12-31.json') }));
vi.mock('../store/monthlySnapshots.js', () => ({
  readMonthlySnapshotFromGCS: vi.fn().mockResolvedValue(null),
  writeMonthlySnapshotToGCS: vi.fn().mockResolvedValue(undefined),
  writeMonthlyRunManifestToGCS: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('nodemailer', () => ({ default: { createTransport: () => ({ sendMail: vi.fn().mockResolvedValue({}) }) } }));

const mockReport = { opsStats: [], salesStats: [], mgmtStats: [], companyStats: {} };
const mockMeta = { periodStart: '2025-12-01', periodEnd: '2025-12-31', label: '2025-12-01..2025-12-31' };
const mockSummary = { departments: { operational: {}, sales: {}, management: {} }, company: {} };

describe('runMonthly', () => {
  beforeEach(() => {
    delete process.env.DRY_RUN;
    process.env.MONDAY_API_TOKEN = 'test-token';
    vi.mocked(runReport).mockResolvedValue({
      meta: mockMeta,
      reportSummary: mockSummary,
      report: mockReport,
    });
  });

  it('runs and returns dryRunPath when DRY_RUN=1 (loads or computes 3 months)', async () => {
    process.env.DRY_RUN = '1';

    const result = await runMonthly({ now: new Date('2026-01-15T09:30:00') });

    expect(result).toHaveProperty('dryRunPath');
    expect(result.payload).toBeDefined();
    expect(loadOrComputeMonthlyReport).toHaveBeenCalledTimes(3);
  });

  it('when DRY_RUN != 1 throws if GMAIL credentials missing', async () => {
    process.env.DRY_RUN = '0';
    delete process.env.GMAIL_USER;
    delete process.env.GMAIL_APP_PASSWORD;

    await expect(runMonthly({ now: new Date('2026-01-15T09:30:00') })).rejects.toThrow(
      'GMAIL_USER and GMAIL_APP_PASSWORD must be set for monthly email send'
    );
  });

  it('throws when OpenRouter is not configured (requireOpenRouter fails)', async () => {
    process.env.DRY_RUN = '1';
    vi.mocked(requireOpenRouter).mockImplementationOnce(() => {
      throw new Error('OpenRouter requires an API key. Set OPENROUTER_API_KEY (get one at https://openrouter.ai).');
    });
    await expect(runMonthly({ now: new Date('2026-01-15T09:30:00') })).rejects.toThrow(
      'OPENROUTER_API_KEY'
    );
  });

  it('throws when MONDAY_API_TOKEN is missing', async () => {
    delete process.env.MONDAY_API_TOKEN;
    await expect(runMonthly({ now: new Date('2026-01-15T09:30:00') })).rejects.toThrow(
      'MONDAY_API_TOKEN'
    );
  });

  it('NON-DRY RUN: fails fast on first employee LLM error, does not call department LLM', async () => {
    process.env.DRY_RUN = '0';
    process.env.GMAIL_USER = 'test@example.com';
    process.env.GMAIL_APP_PASSWORD = 'secret';
    process.env.TEST_EMAILS = 'test@example.com';

    vi.mocked(generateMonthlySections).mockClear();
    vi.mocked(generateMonthlyDepartmentSections).mockClear();

    const validSections = {
      interpretareHtml: '<p>I</p>',
      concluziiHtml: '<p>C</p>',
      actiuniHtml: '<p>A</p>',
      planHtml: '<p>P</p>',
    };
    vi.mocked(generateMonthlySections)
      .mockResolvedValueOnce(validSections)
      .mockRejectedValueOnce(new Error('LLM failed'));

    await expect(runMonthly({ now: new Date('2026-01-15T09:30:00') })).rejects.toThrow('LLM failed');

    expect(generateMonthlySections).toHaveBeenCalledTimes(2);
    expect(generateMonthlyDepartmentSections).not.toHaveBeenCalled();
  });

  it('department LLM inputJson has only 2 months (current + prev1), no prev2', async () => {
    process.env.DRY_RUN = '1';

    await runMonthly({ now: new Date('2026-01-15T09:30:00') });

    expect(generateMonthlyDepartmentSections).toHaveBeenCalledTimes(1);
    const call = vi.mocked(generateMonthlyDepartmentSections).mock.calls[0][0];
    const inputJson = call.inputJson;

    expect(inputJson).toHaveProperty('periodStart');
    expect(inputJson).toHaveProperty('analytics');
    expect(inputJson).toHaveProperty('rawSummaries');
    expect(inputJson.rawSummaries).toHaveProperty('current');
    expect(inputJson.rawSummaries).toHaveProperty('prev1');
    expect(inputJson.rawSummaries.prev2).toBeUndefined();
    expect(inputJson.rawSummaries).not.toHaveProperty('prev2');
    expect(JSON.stringify(inputJson)).not.toContain('prev2');
  });
});
