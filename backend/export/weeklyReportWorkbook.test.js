import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { buildWeeklyRaportWorkbook } from './weeklyReportWorkbook.js';

describe('weeklyReportWorkbook bonus (Report_monday parity)', () => {
  it('bonus per row and bonus total use CTR profit, not LIVR', () => {
    const data = {
      opsStats: [
        {
          name: 'Op1',
          target: 80,
          ctr_principalCount: 1,
          ctr_principalProfitEur: 100,
          ctr_secondaryCount: 0,
          ctr_secondaryProfitEur: 0,
          livr_principalCount: 1,
          livr_principalProfitEur: 50,
          livr_secondaryCount: 0,
          livr_secondaryProfitEur: 0,
          suppliersAdded: 0,
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
      mgmtStats: [],
      companyStats: { ctr: {}, livr: {} },
    };
    const workbook = buildWeeklyRaportWorkbook(data, ExcelJS);
    const sheet = workbook.getWorksheet('Raport');
    // First table: Management empty, then Operațiuni. Headers at 3-4, first data row 5. Target col 15, Bonus col 16.
    const firstDataRow = 5;
    const targetCol = 15;
    const bonusCol = 16;
    const targetVal = sheet.getRow(firstDataRow).getCell(targetCol).value;
    const bonusVal = sheet.getRow(firstDataRow).getCell(bonusCol).value;
    expect(Number(targetVal)).toBe(80);
    // bonus = totalProfitEurCtr - target = 100 - 80 = 20 (CTR, not LIVR 50)
    expect(Number(bonusVal)).toBe(20);

    // TOTAL row: bonusTotal = totalCtrProfit - targetTotal. totalCtrProfit=100, targetTotal=80 => 20
    const totalRow = 6;
    const bonusTotalVal = sheet.getRow(totalRow).getCell(bonusCol).value;
    expect(Number(bonusTotalVal)).toBe(20);
  });

  it('uses average offer/close time headers and h:mm format cells', () => {
    const data = {
      opsStats: [
        {
          name: 'Op1',
          target: 0,
          suppliersAdded: 0,
          ctr_principalCount: 0,
          ctr_principalProfitEur: 0,
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
          avgOfferTime: 75, // 1:15
          avgCloseTime: 135, // 2:15
          sumOfferTime: 150,
          countOfferTime: 2,
          sumCloseTime: 270,
          countCloseTime: 2,
        },
      ],
      salesStats: [],
      mgmtStats: [],
      companyStats: { ctr: {}, livr: {} },
    };
    const workbook = buildWeeklyRaportWorkbook(data, ExcelJS);
    const sheet = workbook.getWorksheet('Raport');

    const headerValues = [];
    for (let col = 1; col <= sheet.columnCount; col++) {
      headerValues.push(String(sheet.getRow(3).getCell(col).value ?? ''));
      headerValues.push(String(sheet.getRow(4).getCell(col).value ?? ''));
    }
    const headersText = headerValues.join(' | ');
    expect(headersText).toContain('TIMP MEDIU OFERTARE (h:m)');
    expect(headersText).toContain('TIMP MEDIU ÎNCHIDERE (h:m)');
    expect(headersText).not.toContain('TIMP OFERTARE (h:m)');
    expect(headersText).not.toContain('TIMP ÎNCHIDERE (h:m)');

    // time columns in first data row (based on fixed table layout)
    const firstDataRow = 5;
    const avgOfferCol = 30;
    const avgCloseCol = 31;
    const offerCell = sheet.getRow(firstDataRow).getCell(avgOfferCol);
    const closeCell = sheet.getRow(firstDataRow).getCell(avgCloseCol);

    expect(Number(offerCell.value)).toBeCloseTo(75 / (24 * 60), 8);
    expect(Number(closeCell.value)).toBeCloseTo(135 / (24 * 60), 8);
    expect(offerCell.numFmt).toBe('h:mm');
    expect(closeCell.numFmt).toBe('h:mm');
  });
});
