import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  ensureMonthlyCacheDir,
  getMonthlyCachePath,
  loadMonthlyReportFromCache,
  saveMonthlyReportToCache,
} from './monthlyReportCache.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const CACHE_DIR = path.join(ROOT, 'out', 'cache', 'monthly');

describe('monthlyReportCache', () => {
  const testYyyyMm = '2026-01';
  const testReport = {
    meta: { periodStart: '2026-01-01', periodEnd: '2026-01-31', label: '2026-01-01..2026-01-31' },
    reportSummary: { departments: { operational: {}, sales: {}, management: {} }, company: {} },
    report: { opsStats: [], salesStats: [], mgmtStats: [], companyStats: {} },
  };

  afterEach(() => {
    const p = path.join(CACHE_DIR, `${testYyyyMm}.json`);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  });

  it('getMonthlyCachePath returns path with YYYY-MM.json', () => {
    const p = getMonthlyCachePath(testYyyyMm);
    expect(p).toContain('out');
    expect(p).toContain('cache');
    expect(p).toContain('monthly');
    expect(p.endsWith('2026-01.json')).toBe(true);
  });

  it('getMonthlyCachePath throws for invalid yyyyMm', () => {
    expect(() => getMonthlyCachePath('invalid')).toThrow(/Invalid yyyyMm/);
    expect(() => getMonthlyCachePath('202601')).toThrow(/Invalid yyyyMm/);
  });

  it('loadMonthlyReportFromCache returns null when file does not exist', () => {
    const result = loadMonthlyReportFromCache('2099-12');
    expect(result).toBeNull();
  });

  it('saveMonthlyReportToCache then loadMonthlyReportFromCache returns same data', () => {
    saveMonthlyReportToCache(testYyyyMm, testReport);
    const loaded = loadMonthlyReportFromCache(testYyyyMm);
    expect(loaded).not.toBeNull();
    expect(loaded.meta.periodStart).toBe(testReport.meta.periodStart);
    expect(loaded.reportSummary).toEqual(testReport.reportSummary);
    expect(loaded.report).toEqual(testReport.report);
  });

  it('ensureMonthlyCacheDir creates out/cache/monthly', () => {
    if (fs.existsSync(CACHE_DIR)) fs.rmSync(CACHE_DIR, { recursive: true });
    ensureMonthlyCacheDir();
    expect(fs.existsSync(CACHE_DIR)).toBe(true);
  });
});
