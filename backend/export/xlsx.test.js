import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { buildWeeklyXlsx } from './xlsx.js';
import { formatRaportFilename } from './weeklyReportWorkbook.js';

const mockReport = {
  opsStats: [
    {
      name: 'Op User',
      target: 80,
      suppliersAdded: 2,
      ctr_principalCount: 1,
      ctr_principalProfitEur: 100,
      ctr_secondaryCount: 0,
      ctr_secondaryProfitEur: 0,
      livr_principalCount: 1,
      livr_principalProfitEur: 50,
      livr_secondaryCount: 0,
      livr_secondaryProfitEur: 0,
      websiteCount: 0,
      websiteProfit: 0,
      websiteCountSec: 0,
      websiteProfitSec: 0,
      burseCount: 0,
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
    },
  ],
  salesStats: [],
  mgmtStats: [
    {
      name: 'Mgmt User',
      target: 100,
      suppliersAdded: 0,
      ctr_principalCount: 2,
      ctr_principalProfitEur: 200,
      ctr_secondaryCount: 0,
      ctr_secondaryProfitEur: 0,
      livr_principalCount: 0,
      livr_principalProfitEur: 0,
      livr_secondaryCount: 0,
      livr_secondaryProfitEur: 0,
      websiteCount: 0,
      websiteProfit: 0,
      websiteCountSec: 0,
      websiteProfitSec: 0,
      burseCount: 0,
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
    },
  ],
  companyStats: {
    ctr: { count: 3, profit: 300, websiteCount: 0, websiteProfit: 0, burseCount: 0, breakdowns: {} },
    livr: { count: 2, profit: 150, websiteCount: 0, websiteProfit: 0, burseCount: 0, breakdowns: {} },
  },
};
const mockMeta = { label: '2026-01-19..2026-01-25', periodStart: '2026-01-19T00:00:00.000+02:00', periodEnd: '2026-01-25T23:59:59.999+02:00' };

describe('buildWeeklyXlsx', () => {
  it('returns buffer with single sheet "Raport"', async () => {
    const buffer = await buildWeeklyXlsx(mockReport, mockMeta);
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer[0]).toBe(0x50);
    expect(buffer[1]).toBe(0x4b);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const sheetNames = workbook.worksheets.map((ws) => ws.name);
    expect(sheetNames).toEqual(['Raport']);
  });

  it('first table title is "Departament Management"', async () => {
    const buffer = await buildWeeklyXlsx(mockReport, mockMeta);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const sheet = workbook.getWorksheet('Raport');
    expect(sheet).toBeDefined();
    const a1 = sheet.getCell(1, 1).value;
    expect(String(a1)).toContain('Departament Management');
  });

  it('header row contains ANGAJAT, FURNIZORI, DUPĂ DATA CONTRACT', async () => {
    const buffer = await buildWeeklyXlsx(mockReport, mockMeta);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const sheet = workbook.getWorksheet('Raport');
    // First department table: title row 1, headers row 3-4, so row 3 has merged headers. Row 5 has "ANGAJAT" in col 1.
    const row3 = sheet.getRow(3);
    const values = [row3.getCell(1).value, row3.getCell(2).value];
    const str = values.map((v) => String(v ?? '')).join(' ');
    expect(str).toMatch(/ANGAJAT|FURNIZORI|DUPĂ DATA CONTRACT/);
  });
});

describe('formatRaportFilename', () => {
  it('returns Raport_DD.MM.YYYY_DD.MM.YYYY.xlsx for ISO period', () => {
    const name = formatRaportFilename('2026-01-19T00:00:00.000+02:00', '2026-01-25T23:59:59.999+02:00');
    expect(name).toBe('Raport_19.01.2026_25.01.2026.xlsx');
  });
});
