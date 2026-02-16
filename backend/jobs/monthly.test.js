/**
 * Monthly job tests. OpenRouter hardening (400 fallback, JSON retry, schema repair, timeout)
 * is covered in backend/llm/openrouterClient.test.js with mocked fetch.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runReport } from '../report/runReport.js';
import { requireOpenRouter } from '../llm/openrouterClient.js';
import { runMonthly } from './monthly.js';

vi.mock('../report/runReport.js', () => ({
  runReport: vi.fn().mockResolvedValue({
    meta: { periodStart: '2025-12-01', periodEnd: '2025-12-31', label: '2025-12-01..2025-12-31' },
    reportSummary: { departments: { operational: {}, sales: {}, management: {} }, company: {} },
    report: { opsStats: [], salesStats: [], mgmtStats: [], companyStats: {} },
  }),
}));
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
    expect(runReport).toHaveBeenCalledTimes(3);
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
});
