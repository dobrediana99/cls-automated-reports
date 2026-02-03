/**
 * Weekly report XLSX export. Uses shared weeklyReportWorkbook for layout identical to frontend.
 * buildWeeklyXlsx(report, meta) returns Buffer for attachment (Node).
 */

import ExcelJS from 'exceljs';
import { buildWeeklyRaportWorkbook } from './weeklyReportWorkbook.js';

/**
 * Build weekly report XLSX buffer. Same workbook as frontend "Raport" export.
 * @param {object} report - { opsStats, salesStats, mgmtStats, companyStats }
 * @param {object} meta - { label, periodStart, periodEnd }
 * @returns {Promise<Buffer>}
 */
export async function buildWeeklyXlsx(report, meta) {
  const workbook = buildWeeklyRaportWorkbook({ ...report, meta }, ExcelJS);
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

/**
 * Build monthly report XLSX buffer for current month (same layout as weekly "Raport").
 * Used as attachment for monthly management email.
 * @param {object} report - { opsStats, salesStats, mgmtStats, companyStats }
 * @param {object} meta - { label, periodStart, periodEnd }
 * @returns {Promise<Buffer>}
 */
export async function buildMonthlyXlsx(report, meta) {
  return buildWeeklyXlsx(report, meta);
}
