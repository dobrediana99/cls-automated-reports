/**
 * Weekly / monthly report XLSX for email attachments. Uses shared weeklyReportWorkbook.
 * Weekly attachment omits TARGET, PROFIT PESTE TARGET, PROFITABILITATE % (see meta.xlsxReportType).
 */

import ExcelJS from 'exceljs';
import { buildWeeklyRaportWorkbook } from './weeklyReportWorkbook.js';

/**
 * Build weekly email attachment XLSX. Department tables exclude target/profitability columns.
 * @param {object} report - { opsStats, salesStats, mgmtStats, companyStats }
 * @param {object} meta - { label, periodStart, periodEnd }
 * @returns {Promise<Buffer>}
 */
export async function buildWeeklyXlsx(report, meta) {
  const workbook = buildWeeklyRaportWorkbook(
    { ...report, meta: { ...meta, xlsxReportType: 'weekly' } },
    ExcelJS,
  );
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

/**
 * Build monthly management email XLSX (full department columns, including target metrics).
 * @param {object} report - { opsStats, salesStats, mgmtStats, companyStats }
 * @param {object} meta - { label, periodStart, periodEnd }
 * @returns {Promise<Buffer>}
 */
export async function buildMonthlyXlsx(report, meta) {
  const workbook = buildWeeklyRaportWorkbook({ ...report, meta }, ExcelJS);
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
