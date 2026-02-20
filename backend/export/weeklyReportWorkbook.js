/**
 * Single source of truth for weekly "Raport" XLSX layout.
 * Used by backend (Node + ExcelJS) and frontend (Browser + window.ExcelJS).
 * buildWeeklyRaportWorkbook(data, ExcelJS) returns a workbook; caller writes buffer and filename.
 */

import { DateTime } from 'luxon';

const safeVal = (v) => (typeof v === 'number' && !isNaN(v) ? v : 0);
const formatNumber = (val, decimals = 1) => (typeof val === 'number' && !isNaN(val) ? val.toFixed(decimals) : '0.0');

const thinBorder = {
  top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' },
};
const fontBold = { bold: true };
const alignCenter = { vertical: 'middle', horizontal: 'center' };
const fillStyle = (color) => ({
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FF' + color },
});

function writeHeaderCell(sheet, r1, c1, r2, c2, value, fillHex, extra = {}) {
  sheet.mergeCells(r1, c1, r2, c2);
  const cell = sheet.getCell(r1, c1);
  cell.value = value;
  if (fillHex) cell.fill = fillStyle(fillHex);
  cell.border = thinBorder;
  cell.font = extra.font || fontBold;
  cell.alignment = extra.alignment || alignCenter;
  return cell;
}

function addDepartmentTable(sheet, ref, title, data, isSales) {
  let currentRow = ref.currentRow;
  const titleRow = sheet.getRow(currentRow);
  titleRow.getCell(1).value = title;
  titleRow.getCell(1).font = { size: 14, bold: true };
  currentRow += 2;

  const startRow = currentRow;
  let col = 1;

  writeHeaderCell(sheet, startRow, col, startRow + 1, col, 'ANGAJAT', 'F2F2F2');
  col++;
  writeHeaderCell(sheet, startRow, col, startRow + 1, col, 'FURNIZORI', null, { font: fontBold });
  sheet.getCell(startRow, col).border = thinBorder;
  sheet.getCell(startRow, col).alignment = alignCenter;
  col++;

  writeHeaderCell(sheet, startRow, col, startRow, col + 5, 'DUPĂ DATA CONTRACT', 'E3F2FD');
  ['Curse Pr.', 'Profit Pr.', 'Curse Sec.', 'Profit Sec.', 'Total Curse', 'Total Profit'].forEach((h, i) => {
    const c = sheet.getCell(startRow + 1, col + i);
    c.value = h;
    c.fill = fillStyle('E3F2FD');
    c.border = thinBorder;
    c.alignment = alignCenter;
  });
  col += 6;

  writeHeaderCell(sheet, startRow, col, startRow, col + 5, 'DUPĂ DATA LIVRARE', 'E8F5E9');
  ['Curse Pr.', 'Profit Pr.', 'Curse Sec.', 'Profit Sec.', 'Total Curse', 'Total Profit'].forEach((h, i) => {
    const c = sheet.getCell(startRow + 1, col + i);
    c.value = h;
    c.fill = fillStyle('E8F5E9');
    c.border = thinBorder;
    c.alignment = alignCenter;
  });
  col += 6;

  writeHeaderCell(sheet, startRow, col, startRow + 1, col, 'TARGET', 'E3F2FD', { font: fontBold });
  col++;
  writeHeaderCell(sheet, startRow, col, startRow + 1, col, 'PROFIT PESTE TARGET', 'E3F2FD', { font: fontBold });
  col++;

  const others = [
    { t: 'PROFITABILITATE %', c: 'E3F2FD' },
    { t: 'CURSE WEB PR.', c: 'FFFFFF' },
    { t: 'PROFIT WEB PR.', c: 'FFFFFF' },
    { t: 'CURSE WEB SEC.', c: 'F3E8FF' },
    { t: 'PROFIT WEB SEC.', c: 'F3E8FF' },
    { t: 'CURSE BURSE', c: 'FFF7ED' },
    { t: 'SOLICITĂRI WEB', c: 'F3E8FF' },
    { t: 'CONV WEB %', c: 'FFFFFF' },
    { t: 'TERMEN CLIENT', c: 'FFFFFF' },
    { t: 'TERMEN FURNIZOR', c: 'FFFFFF' },
    { t: 'INTARZIERI >15', c: 'FFFFFF', color: 'FFFF0000' },
    { t: 'FURN <30', c: 'FFF7ED' },
    { t: 'FURN >=30', c: 'FFF7ED' },
  ];
  others.forEach((o) => {
    const cell = writeHeaderCell(sheet, startRow, col, startRow + 1, col, o.t, o.c, { font: fontBold });
    if (o.color) cell.font = { color: { argb: o.color }, bold: true };
    col++;
  });

  const salesMetricsStartCol = col;
  if (isSales) {
    ['CONTACTATI', 'CALIFICATI', 'RATA CONV.', 'EMAILS', 'APELURI'].forEach((h, i) => {
      const fill = i < 3 ? 'FEF9C3' : 'E0E7FF';
      writeHeaderCell(sheet, startRow, col, startRow + 1, col, h, fill, { font: fontBold });
      col++;
    });
  }

  currentRow += 2;

  data.forEach((item) => {
    const target = safeVal(item.target);
    const row = sheet.getRow(currentRow);
    let c = 1;

    const totalCountCtr = safeVal(item.ctr_principalCount) + safeVal(item.ctr_secondaryCount);
    const totalProfitEurCtr = safeVal(item.ctr_principalProfitEur) + safeVal(item.ctr_secondaryProfitEur);
    const totalCountLivr = safeVal(item.livr_principalCount) + safeVal(item.livr_secondaryCount);
    const totalProfitEurLivr = safeVal(item.livr_principalProfitEur) + safeVal(item.livr_secondaryProfitEur);
    const bonus = totalProfitEurLivr - target;

    const qualified = safeVal(item.calificat);
    const contacted = safeVal(item.contactat);
    const rataConversie = (qualified + contacted) > 0
      ? ((qualified / (qualified + contacted)) * 100).toFixed(1)
      : '0.0';

    const solicitari = safeVal(item.solicitariCount);
    const websiteCount = safeVal(item.websiteCount);
    const convWeb = solicitari > 0
      ? ((websiteCount / solicitari) * 100).toFixed(1)
      : (websiteCount > 0 ? '100.0' : '0.0');

    const avgClientTerm = item.countClientTerms > 0 ? (item.sumClientTerms / item.countClientTerms) : 0;
    const avgSupplierTerm = item.countSupplierTerms > 0 ? (item.sumSupplierTerms / item.countSupplierTerms) : 0;
    const avgProfitability = item.countProfitability > 0 ? (item.sumProfitability / item.countProfitability) : 0;

    row.getCell(c).value = item.name ?? '';
    row.getCell(c).border = thinBorder;
    c++;

    row.getCell(c).value = safeVal(item.suppliersAdded);
    row.getCell(c).border = thinBorder;
    row.getCell(c).alignment = alignCenter;
    c++;

    [
      safeVal(item.ctr_principalCount),
      safeVal(item.ctr_principalProfitEur),
      safeVal(item.ctr_secondaryCount),
      safeVal(item.ctr_secondaryProfitEur),
      totalCountCtr,
      totalProfitEurCtr,
    ].forEach((v, i) => {
      const cell = row.getCell(c++);
      cell.value = v;
      cell.border = thinBorder;
      cell.alignment = alignCenter;
      cell.fill = fillStyle('E3F2FD');
      if (i === 1 || i === 3 || i === 5) cell.numFmt = '#,##0.00';
      if (i >= 4) cell.font = fontBold;
    });

    [
      safeVal(item.livr_principalCount),
      safeVal(item.livr_principalProfitEur),
      safeVal(item.livr_secondaryCount),
      safeVal(item.livr_secondaryProfitEur),
      totalCountLivr,
      totalProfitEurLivr,
    ].forEach((v, i) => {
      const cell = row.getCell(c++);
      cell.value = v;
      cell.border = thinBorder;
      cell.alignment = alignCenter;
      cell.fill = fillStyle('E8F5E9');
      if (i === 1 || i === 3 || i === 5) cell.numFmt = '#,##0.00';
      if (i >= 4) cell.font = fontBold;
    });

    let cell = row.getCell(c++);
    cell.value = target;
    cell.border = thinBorder;
    cell.numFmt = '#,##0.00';
    cell.fill = fillStyle('E3F2FD');

    cell = row.getCell(c++);
    cell.value = bonus;
    cell.border = thinBorder;
    cell.numFmt = '#,##0.00';
    cell.font = { color: { argb: 'FF008000' }, bold: true };
    cell.fill = fillStyle('E3F2FD');

    cell = row.getCell(c++);
    cell.value = formatNumber(avgProfitability) + '%';
    cell.border = thinBorder;
    cell.font = { color: { argb: 'FF1E40AF' }, bold: true };
    cell.fill = fillStyle('E3F2FD');

    cell = row.getCell(c++);
    cell.value = websiteCount;
    cell.border = thinBorder;

    cell = row.getCell(c++);
    cell.value = safeVal(item.websiteProfit);
    cell.border = thinBorder;
    cell.numFmt = '#,##0.00';

    cell = row.getCell(c++);
    cell.value = safeVal(item.websiteCountSec);
    cell.border = thinBorder;
    cell.fill = fillStyle('F3E8FF');

    cell = row.getCell(c++);
    cell.value = safeVal(item.websiteProfitSec);
    cell.border = thinBorder;
    cell.numFmt = '#,##0.00';
    cell.fill = fillStyle('F3E8FF');

    cell = row.getCell(c++);
    cell.value = safeVal(item.burseCount);
    cell.border = thinBorder;
    cell.fill = fillStyle('FFF7ED');
    cell.font = { color: { argb: 'FF9A3412' }, bold: true };

    cell = row.getCell(c++);
    cell.value = solicitari;
    cell.border = thinBorder;
    cell.fill = fillStyle('F3E8FF');

    cell = row.getCell(c++);
    cell.value = convWeb + '%';
    cell.border = thinBorder;

    cell = row.getCell(c++);
    cell.value = formatNumber(avgClientTerm);
    cell.border = thinBorder;

    cell = row.getCell(c++);
    cell.value = formatNumber(avgSupplierTerm);
    cell.border = thinBorder;

    cell = row.getCell(c++);
    cell.value = safeVal(item.overdueInvoicesCount);
    cell.border = thinBorder;
    cell.font = { color: { argb: 'FFFF0000' }, bold: true };

    cell = row.getCell(c++);
    cell.value = safeVal(item.supplierTermsUnder30);
    cell.border = thinBorder;
    cell.fill = fillStyle('FFF7ED');

    cell = row.getCell(c++);
    cell.value = safeVal(item.supplierTermsOver30);
    cell.border = thinBorder;
    cell.fill = fillStyle('FFF7ED');

    if (isSales) {
      const startC = salesMetricsStartCol;
      const metrics = [
        { v: contacted, fill: 'FEF9C3' },
        { v: qualified, fill: 'FEF9C3' },
        { v: rataConversie + '%', fill: 'FEF9C3' },
        { v: safeVal(item.emailsCount), fill: 'E0E7FF' },
        { v: safeVal(item.callsCount), fill: 'E0E7FF' },
      ];
      metrics.forEach((m, idx) => {
        const cc = row.getCell(startC + idx);
        cc.value = m.v;
        cc.border = thinBorder;
        cc.alignment = alignCenter;
        cc.fill = fillStyle(m.fill);
      });
    }

    currentRow++;
  });

  const totals = data.reduce((acc, item) => {
    acc.contactat += safeVal(item.contactat);
    acc.calificat += safeVal(item.calificat);
    acc.emailsCount += safeVal(item.emailsCount);
    acc.callsCount += safeVal(item.callsCount);
    acc.suppliersAdded += safeVal(item.suppliersAdded);
    acc.ctr_principalCount += safeVal(item.ctr_principalCount);
    acc.ctr_principalProfitEur += safeVal(item.ctr_principalProfitEur);
    acc.ctr_secondaryCount += safeVal(item.ctr_secondaryCount);
    acc.ctr_secondaryProfitEur += safeVal(item.ctr_secondaryProfitEur);
    acc.livr_principalCount += safeVal(item.livr_principalCount);
    acc.livr_principalProfitEur += safeVal(item.livr_principalProfitEur);
    acc.livr_secondaryCount += safeVal(item.livr_secondaryCount);
    acc.livr_secondaryProfitEur += safeVal(item.livr_secondaryProfitEur);
    acc.websiteCount += safeVal(item.websiteCount);
    acc.websiteProfit += safeVal(item.websiteProfit);
    acc.websiteCountSec += safeVal(item.websiteCountSec);
    acc.websiteProfitSec += safeVal(item.websiteProfitSec);
    acc.burseCount += safeVal(item.burseCount);
    acc.solicitariCount += safeVal(item.solicitariCount);
    acc.sumClientTerms += safeVal(item.sumClientTerms);
    acc.countClientTerms += safeVal(item.countClientTerms);
    acc.sumSupplierTerms += safeVal(item.sumSupplierTerms);
    acc.countSupplierTerms += safeVal(item.countSupplierTerms);
    acc.overdueInvoicesCount += safeVal(item.overdueInvoicesCount);
    acc.sumProfitability += safeVal(item.sumProfitability);
    acc.countProfitability += safeVal(item.countProfitability);
    acc.supplierTermsUnder30 += safeVal(item.supplierTermsUnder30);
    acc.supplierTermsOver30 += safeVal(item.supplierTermsOver30);
    acc.targetTotal += safeVal(item.target);
    return acc;
  }, {
    contactat: 0, calificat: 0, emailsCount: 0, callsCount: 0,
    suppliersAdded: 0,
    ctr_principalCount: 0, ctr_principalProfitEur: 0, ctr_secondaryCount: 0, ctr_secondaryProfitEur: 0,
    livr_principalCount: 0, livr_principalProfitEur: 0, livr_secondaryCount: 0, livr_secondaryProfitEur: 0,
    websiteCount: 0, websiteProfit: 0, websiteCountSec: 0, websiteProfitSec: 0,
    burseCount: 0, solicitariCount: 0,
    sumClientTerms: 0, countClientTerms: 0, sumSupplierTerms: 0, countSupplierTerms: 0,
    overdueInvoicesCount: 0, sumProfitability: 0, countProfitability: 0,
    supplierTermsUnder30: 0, supplierTermsOver30: 0, targetTotal: 0,
  });

  const count = data.length || 1;
  const totalCtrCount = totals.ctr_principalCount + totals.ctr_secondaryCount;
  const totalCtrProfit = totals.ctr_principalProfitEur + totals.ctr_secondaryProfitEur;
  const totalLivrCount = totals.livr_principalCount + totals.livr_secondaryCount;
  const totalLivrProfit = totals.livr_principalProfitEur + totals.livr_secondaryProfitEur;
  const bonusTotal = totalLivrProfit - totals.targetTotal;
  const avgProfitability = totals.countProfitability > 0 ? (totals.sumProfitability / totals.countProfitability) : 0;
  const avgClientTerm = totals.countClientTerms > 0 ? (totals.sumClientTerms / totals.countClientTerms) : 0;
  const avgSupplierTerm = totals.countSupplierTerms > 0 ? (totals.sumSupplierTerms / totals.countSupplierTerms) : 0;
  const rateConvWeb = totals.solicitariCount > 0 ? (totals.websiteCount / totals.solicitariCount) * 100 : 0;
  const totalLeads = totals.calificat + totals.contactat;
  const rateConvClients = totalLeads > 0 ? (totals.calificat / totalLeads) * 100 : 0;
  const avg = (v) => v / count;

  const writeFooterRow = (label, isAvg = false) => {
    const r = sheet.getRow(currentRow);
    let c = 1;
    let cell;

    const labelCell = r.getCell(c++);
    labelCell.value = label;
    labelCell.border = thinBorder;
    labelCell.font = { bold: true };
    labelCell.fill = fillStyle('E5E7EB');

    const furnCell = r.getCell(c++);
    furnCell.value = isAvg ? avg(totals.suppliersAdded) : totals.suppliersAdded;
    furnCell.border = thinBorder;
    furnCell.alignment = alignCenter;
    if (isAvg) furnCell.numFmt = '0.0';
    furnCell.fill = fillStyle('F3F4F6');

    const ctrVals = isAvg
      ? [avg(totals.ctr_principalCount), avg(totals.ctr_principalProfitEur), avg(totals.ctr_secondaryCount), avg(totals.ctr_secondaryProfitEur), avg(totalCtrCount), avg(totalCtrProfit)]
      : [totals.ctr_principalCount, totals.ctr_principalProfitEur, totals.ctr_secondaryCount, totals.ctr_secondaryProfitEur, totalCtrCount, totalCtrProfit];
    ctrVals.forEach((v, i) => {
      const cell = r.getCell(c++);
      cell.value = v;
      cell.border = thinBorder;
      cell.alignment = alignCenter;
      cell.fill = fillStyle('E3F2FD');
      if (i === 1 || i === 3 || i === 5) cell.numFmt = '#,##0.00';
      if (!isAvg && i >= 4) cell.font = fontBold;
      if (isAvg && (i === 0 || i === 2 || i === 4)) cell.numFmt = '0.0';
    });

    const livrVals = isAvg
      ? [avg(totals.livr_principalCount), avg(totals.livr_principalProfitEur), avg(totals.livr_secondaryCount), avg(totals.livr_secondaryProfitEur), avg(totalLivrCount), avg(totalLivrProfit)]
      : [totals.livr_principalCount, totals.livr_principalProfitEur, totals.livr_secondaryCount, totals.livr_secondaryProfitEur, totalLivrCount, totalLivrProfit];
    livrVals.forEach((v, i) => {
      const cell = r.getCell(c++);
      cell.value = v;
      cell.border = thinBorder;
      cell.alignment = alignCenter;
      cell.fill = fillStyle('E8F5E9');
      if (i === 1 || i === 3 || i === 5) cell.numFmt = '#,##0.00';
      if (!isAvg && i >= 4) cell.font = fontBold;
      if (isAvg && (i === 0 || i === 2 || i === 4)) cell.numFmt = '0.0';
    });

    const targetVal = isAvg ? (totals.targetTotal / count) : totals.targetTotal;
    cell = r.getCell(c++);
    cell.value = targetVal;
    cell.border = thinBorder;
    cell.numFmt = '#,##0.00';
    cell.fill = fillStyle('E3F2FD');

    const bonusVal = isAvg ? (bonusTotal / count) : bonusTotal;
    cell = r.getCell(c++);
    cell.value = bonusVal;
    cell.border = thinBorder;
    cell.numFmt = '#,##0.00';
    cell.fill = fillStyle('E3F2FD');
    cell.font = { color: { argb: 'FF008000' }, bold: true };

    cell = r.getCell(c++);
    cell.value = `${formatNumber(avgProfitability)}%`;
    cell.border = thinBorder;
    cell.fill = fillStyle('E3F2FD');
    cell.font = { color: { argb: 'FF1E40AF' }, bold: true };

    cell = r.getCell(c++);
    cell.value = isAvg ? avg(totals.websiteCount) : totals.websiteCount;
    cell.border = thinBorder;
    if (isAvg) cell.numFmt = '0.0';

    cell = r.getCell(c++);
    cell.value = isAvg ? avg(totals.websiteProfit) : totals.websiteProfit;
    cell.border = thinBorder;
    cell.numFmt = '#,##0.00';

    cell = r.getCell(c++);
    cell.value = isAvg ? avg(totals.websiteCountSec) : totals.websiteCountSec;
    cell.border = thinBorder;
    cell.fill = fillStyle('F3E8FF');
    if (isAvg) cell.numFmt = '0.0';

    cell = r.getCell(c++);
    cell.value = isAvg ? avg(totals.websiteProfitSec) : totals.websiteProfitSec;
    cell.border = thinBorder;
    cell.numFmt = '#,##0.00';
    cell.fill = fillStyle('F3E8FF');

    cell = r.getCell(c++);
    cell.value = isAvg ? avg(totals.burseCount) : totals.burseCount;
    cell.border = thinBorder;
    cell.fill = fillStyle('FFF7ED');
    if (isAvg) cell.numFmt = '0.0';

    cell = r.getCell(c++);
    cell.value = isAvg ? avg(totals.solicitariCount) : totals.solicitariCount;
    cell.border = thinBorder;
    cell.fill = fillStyle('F3E8FF');
    if (isAvg) cell.numFmt = '0.0';

    cell = r.getCell(c++);
    cell.value = isAvg ? '-' : `${formatNumber(rateConvWeb)}%`;
    cell.border = thinBorder;

    cell = r.getCell(c++);
    cell.value = isAvg ? '-' : formatNumber(avgClientTerm);
    cell.border = thinBorder;

    cell = r.getCell(c++);
    cell.value = isAvg ? '-' : formatNumber(avgSupplierTerm);
    cell.border = thinBorder;

    cell = r.getCell(c++);
    cell.value = isAvg ? avg(totals.overdueInvoicesCount) : totals.overdueInvoicesCount;
    cell.border = thinBorder;
    cell.font = { color: { argb: 'FFFF0000' }, bold: true };
    if (isAvg) cell.numFmt = '0.0';

    cell = r.getCell(c++);
    cell.value = isAvg ? avg(totals.supplierTermsUnder30) : totals.supplierTermsUnder30;
    cell.border = thinBorder;
    cell.fill = fillStyle('FFF7ED');
    if (isAvg) cell.numFmt = '0.0';

    cell = r.getCell(c++);
    cell.value = isAvg ? avg(totals.supplierTermsOver30) : totals.supplierTermsOver30;
    cell.border = thinBorder;
    cell.fill = fillStyle('FFF7ED');
    if (isAvg) cell.numFmt = '0.0';

    if (isSales) {
      const contactedVal = isAvg ? avg(totals.contactat) : totals.contactat;
      const qualifiedVal = isAvg ? avg(totals.calificat) : totals.calificat;
      const m = [
        contactedVal,
        qualifiedVal,
        isAvg ? '-' : `${formatNumber(rateConvClients)}%`,
        isAvg ? avg(totals.emailsCount) : totals.emailsCount,
        isAvg ? avg(totals.callsCount) : totals.callsCount,
      ];
      m.forEach((v, idx) => {
        const cc = r.getCell(c++);
        cc.value = v;
        cc.border = thinBorder;
        cc.alignment = alignCenter;
        cc.fill = fillStyle(idx < 3 ? 'FEF9C3' : 'E0E7FF');
        if (isAvg && typeof v === 'number') cc.numFmt = '0.0';
      });
    }

    currentRow++;
  };

  writeFooterRow('TOTAL', false);
  writeFooterRow('MEDIA', true);
  currentRow++;

  ref.currentRow = currentRow;
}

function addCompanyTable(sheet, ref, companyStats) {
  let row = ref.currentRow;
  sheet.mergeCells(`A${row}:C${row}`);
  const title = sheet.getCell(`A${row}`);
  title.value = 'TOTAL COMPANIE (GLOBAL)';
  title.font = { size: 12, bold: true, color: { argb: 'FFFFFFFF' } };
  title.fill = fillStyle('1E293B');
  row++;

  sheet.getCell(`A${row}`).value = 'Metrică';
  sheet.getCell(`B${row}`).value = 'După Data Contract';
  sheet.getCell(`C${row}`).value = 'După Data Livrare';
  [1, 2, 3].forEach((c) => {
    sheet.getCell(row, c).font = fontBold;
    sheet.getCell(row, c).border = thinBorder;
    sheet.getCell(row, c).fill = fillStyle('F3F4F6');
  });
  row++;

  const addRow = (label, val1, val2, bold = false, color = null, bg = null) => {
    const r = sheet.getRow(row);
    r.getCell(1).value = label;
    r.getCell(2).value = val1;
    r.getCell(3).value = val2;
    [1, 2, 3].forEach((c) => {
      r.getCell(c).border = thinBorder;
      if (bg) r.getCell(c).fill = fillStyle(bg);
      if (bold) r.getCell(c).font = { bold: true, color: { argb: color || 'FF000000' } };
    });
    if (typeof val1 === 'number' && val1 > 1000) r.getCell(2).numFmt = '#,##0.00';
    if (typeof val2 === 'number' && val2 > 1000) r.getCell(3).numFmt = '#,##0.00';
    row++;
  };

  const ctr = companyStats?.ctr ?? {};
  const livr = companyStats?.livr ?? {};
  addRow('Număr Total Curse', ctr.count ?? 0, livr.count ?? 0, true, null, 'E3F2FD');
  addRow('Profit Total (EUR)', ctr.profit ?? 0, livr.profit ?? 0, true, 'FF008000');
  addRow('Website / Fix - Curse', ctr.websiteCount ?? 0, livr.websiteCount ?? 0);
  addRow('Website / Fix - Profit', ctr.websiteProfit ?? 0, livr.websiteProfit ?? 0);
  addRow('Burse - Curse', ctr.burseCount ?? 0, livr.burseCount ?? 0);

  const calcPct = (c, t) => (t > 0 ? ((c / t) * 100).toFixed(1) + '%' : '0.0%');
  const addBreakdown = (titleText, fieldKey) => {
    const ctrData = ctr.breakdowns?.[fieldKey] || {};
    const livrData = livr.breakdowns?.[fieldKey] || {};
    const keys = new Set([...Object.keys(ctrData), ...Object.keys(livrData)]);
    if (keys.size === 0) return;

    const r = sheet.getRow(row);
    sheet.mergeCells(`A${row}:C${row}`);
    r.getCell(1).value = titleText;
    r.getCell(1).font = { bold: true };
    r.getCell(1).fill = fillStyle('E5E7EB');
    r.getCell(1).border = thinBorder;
    row++;

    [...keys].sort().forEach((k) => {
      const v1 = ctrData[k] || 0;
      const v2 = livrData[k] || 0;
      const dr = sheet.getRow(row);
      dr.getCell(1).value = k;
      dr.getCell(2).value = `${v1} (${calcPct(v1, ctr.count ?? 0)})`;
      dr.getCell(3).value = `${v2} (${calcPct(v2, livr.count ?? 0)})`;
      [1, 2, 3].forEach((c) => dr.getCell(c).border = thinBorder);
      row++;
    });
  };

  addBreakdown('Tip serviciu', 'STATUS_CTR');
  addBreakdown('Dep', 'DEP');
  addBreakdown('Status Plata Client', 'STATUS_PLATA_CLIENT');
  addBreakdown('Moneda Cursa', 'MONEDA');
  addBreakdown('Sursa Client', 'SURSA');
  addBreakdown('Implicare', 'IMPLICARE');
  addBreakdown('Client Pe', 'CLIENT_PE');
  addBreakdown('Furnizor Pe', 'FURNIZ_PE');
  addBreakdown('Client/Furnizor Pe', 'CLIENT_FURNIZOR_PE');
  addBreakdown('Mod Transport', 'MOD_TRANSPORT');
  addBreakdown('Tip Marfa', 'TIP_MARFA');
  addBreakdown('Ocupare Mij Transport', 'OCUPARE');

  ref.currentRow = row;
}

/**
 * Build the weekly "Raport" workbook. Same layout as frontend export.
 * @param {object} data - { opsStats, salesStats, mgmtStats, companyStats, meta? }
 * @param {object} ExcelJS - ExcelJS constructor (from 'exceljs' in Node or window.ExcelJS in Browser)
 * @returns {object} ExcelJS Workbook (caller calls workbook.xlsx.writeBuffer() and sets filename)
 */
export function buildWeeklyRaportWorkbook(data, ExcelJS) {
  const { opsStats = [], salesStats = [], mgmtStats = [], companyStats = {} } = data;
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Raport', { sheetView: { showGridLines: true } });
  const ref = { currentRow: 1 };

  if (mgmtStats.length) addDepartmentTable(sheet, ref, 'Departament Management', mgmtStats, false);
  if (opsStats.length) addDepartmentTable(sheet, ref, 'Departament Operațiuni', opsStats, false);
  if (salesStats.length) addDepartmentTable(sheet, ref, 'Departament Vânzări', salesStats, true);
  addCompanyTable(sheet, ref, companyStats);

  sheet.columns.forEach((column) => { column.width = 15; });
  sheet.getColumn(1).width = 25;

  return workbook;
}

/**
 * Filename for weekly Raport attachment: Raport_DD.MM.YYYY_DD.MM.YYYY.xlsx
 * @param {string} periodStart - ISO date string
 * @param {string} periodEnd - ISO date string
 * @param {string} [tz] - timezone, default Europe/Bucharest
 */
export function formatRaportFilename(periodStart, periodEnd, tz = 'Europe/Bucharest') {
  const start = DateTime.fromISO(periodStart, { zone: tz });
  const end = DateTime.fromISO(periodEnd, { zone: tz });
  return `Raport_${start.toFormat('dd.MM.yyyy')}_${end.toFormat('dd.MM.yyyy')}.xlsx`;
}
