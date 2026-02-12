/**
 * Monthly email rendering. Uses prompts from backend/prompts/ as single source of truth (loaded at runtime).
 * Employee emails: backend/email/templates/monthlyEmployee.js (prompt from monthlyEmployeePrompt.md).
 * Management email: department prompt from monthlyDepartmentPrompt.md; Total Company doar tabel.
 */

import { DEPARTMENTS } from '../config/org.js';
import { loadMonthlyDepartmentPrompt } from '../prompts/loadPrompts.js';
import { getMonthlyDepartmentSubject } from './content/monthlyTexts.js';
import { escapeHtml } from './templates/weeklyEmployeeDetails.js';
import { buildMonthlyEmployeeEmail, buildMonthlyEmployeeEmailHtml as buildEmployeeEmailHtmlFromTemplate } from './templates/monthlyEmployee.js';
import { sanitizeReportHtml } from './sanitize.js';

/** Get person row from report by department (used by job to build data3Months). */
export function getPersonRow(report, person) {
  const { opsStats, salesStats, mgmtStats } = report;
  const list =
    person.department === DEPARTMENTS.MANAGEMENT
      ? mgmtStats
      : person.department === DEPARTMENTS.SALES
        ? salesStats
        : person.department === DEPARTMENTS.OPERATIONS
          ? opsStats
          : [];

  if (!list || list.length === 0) {
    console.warn('[getPersonRow] empty list for department', { person: person.name, department: person.department });
    return null;
  }

  const hasMondayId = person.mondayUserId != null && String(person.mondayUserId).trim() !== '';
  if (hasMondayId) {
    const byMondayId = list.find((r) => String(r.mondayId) === String(person.mondayUserId));
    if (byMondayId) return byMondayId;
    console.warn('[getPersonRow] no row for mondayUserId', { name: person.name, mondayUserId: person.mondayUserId, department: person.department });
  }

  const byName = list.filter((r) => r.name === person.name);
  if (byName.length === 1) return byName[0];
  if (byName.length > 1) {
    console.warn('[getPersonRow] ambiguous match by name', { name: person.name, department: person.department });
    return null;
  }

  console.warn('[getPersonRow] no match', { name: person.name, department: person.department });
  return null;
}

const BODY_STYLE = 'font-family: Arial, sans-serif; font-size: 14px; max-width: 600px; margin: 0 auto; padding: 16px;';
const SECTION_STYLE = 'margin: 1em 0 0 0;';
const H2_STYLE = 'font-size: 16px; font-weight: bold; margin: 1.2em 0 0.4em 0;';

function getDepartmentPrompt() {
  return loadMonthlyDepartmentPrompt();
}

/** Re-export for callers that need { subject, html } with data3Months. */
export { buildMonthlyEmployeeEmail };

/** Builds full HTML for monthly employee (single report). Requires llmSections (from Vertex LLM); no placeholder. */
export function buildMonthlyEmployeeEmailHtml({ personName, stats, department, periodStart, showCheckIn = false, llmSections }) {
  return buildEmployeeEmailHtmlFromTemplate({
    person: { name: personName, department },
    department,
    data3Months: { current: stats },
    deptAverages3Months: null,
    periodStart,
    llmSections,
  });
}

/**
 * Builds full HTML for monthly management email. Structure from monthlyDepartmentPrompt.md.
 * LLM sections required (rezumatExecutivHtml, vanzariHtml, operationalHtml, comparatiiHtml, recomandariHtml); no placeholder.
 * Total Company = doar tabel (generat în cod).
 * @param {object} opts - { periodStart, reportSummary?, report?, llmSections }
 * @param {object} opts.llmSections - { rezumatExecutivHtml, vanzariHtml, operationalHtml, comparatiiHtml, recomandariHtml }; required
 * @returns {string} Full HTML document
 */
export function buildMonthlyDepartmentEmailHtml({ periodStart, reportSummary, report, llmSections }) {
  getDepartmentPrompt(); // Use prompt (throw if missing)

  const required = ['rezumatExecutivHtml', 'vanzariHtml', 'operationalHtml', 'comparatiiHtml', 'recomandariHtml'];
  if (!llmSections || typeof llmSections !== 'object') {
    throw new Error('Monthly management email requires llmSections from Vertex LLM. Job fails without valid analysis.');
  }
  for (const key of required) {
    const val = llmSections[key];
    if (val == null || typeof val !== 'string' || !String(val).trim()) {
      throw new Error(`Monthly management email missing LLM section: ${key}. Job fails without valid analysis.`);
    }
  }

  let tableHtml = '';
  if (reportSummary && reportSummary.departments) {
    tableHtml = '<table style="border-collapse: collapse; width: 100%; max-width: 560px; font-family: Arial, sans-serif; font-size: 13px;">';
    tableHtml += '<thead><tr><th style="padding: 8px 10px; border: 1px solid #ccc; background: #f2f2f2;">Departament / Indicator</th><th style="padding: 8px 10px; border: 1px solid #ccc; background: #f2f2f2;">Valoare</th></tr></thead><tbody>';
    const deps = [
      { key: 'operational', label: 'Operațiuni' },
      { key: 'sales', label: 'Vânzări' },
      { key: 'management', label: 'Management' },
    ];
    for (const { key, label } of deps) {
      const d = reportSummary.departments[key];
      if (d && typeof d === 'object') {
        tableHtml += `<tr><td style="padding: 8px 10px; border: 1px solid #ccc; font-weight: bold;" colspan="2">${escapeHtml(label)}</td></tr>`;
        for (const [k, v] of Object.entries(d)) {
          if (v !== undefined && v !== null && typeof v === 'number' && !Number.isNaN(v)) {
            tableHtml += `<tr><td style="padding: 8px 10px; border: 1px solid #ccc;">${escapeHtml(k)}</td><td style="padding: 8px 10px; border: 1px solid #ccc;">${v}</td></tr>`;
          }
        }
      }
    }
    tableHtml += '</tbody></table>';
  } else {
    tableHtml = '<p style="margin: 1em 0 0 0;">Date agregate vor fi afișate aici.</p>';
  }

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Raport performanță departamentală</title></head>
<body style="${BODY_STYLE}">
  <h2 style="${H2_STYLE}">Rezumat executiv</h2>
  <div style="${SECTION_STYLE}">${sanitizeReportHtml(llmSections.rezumatExecutivHtml)}</div>

  <h2 style="${H2_STYLE}">Analiză Vânzări</h2>
  <div style="${SECTION_STYLE}">${sanitizeReportHtml(llmSections.vanzariHtml)}</div>

  <h2 style="${H2_STYLE}">Analiză Operațional</h2>
  <div style="${SECTION_STYLE}">${sanitizeReportHtml(llmSections.operationalHtml)}</div>

  <h2 style="${H2_STYLE}">Comparații</h2>
  <div style="${SECTION_STYLE}">${sanitizeReportHtml(llmSections.comparatiiHtml)}</div>

  <h2 style="${H2_STYLE}">Recomandări</h2>
  <div style="${SECTION_STYLE}">${sanitizeReportHtml(llmSections.recomandariHtml)}</div>

  <h2 style="${H2_STYLE}">Date agregate (tabel)</h2>
  ${tableHtml}

  <p style="margin: 1.5em 0 0 0;">Pentru orice nelămuriri, contactați echipa de raportare.</p>
  <p style="margin: 0.5em 0 0 0;">Vă mulțumim.</p>
</body>
</html>`;
}

/**
 * Builds monthly department/management email. Structure from monthlyDepartmentPrompt.md.
 * Requires llmSections from Vertex LLM (rezumatExecutivHtml, vanzariHtml, operationalHtml, comparatiiHtml, recomandariHtml); no placeholder.
 * @param {object} opts - { periodStart, reportSummary?, monthExcelCurrent?, monthExcelPrev?, monthExcelPrev2?, llmSections }
 * @param {object} opts.llmSections - Required; from generateMonthlyDepartmentSections
 * @returns {{ subject: string, html: string, attachments: Array<{ filename: string, content: Buffer }> }}
 */
export function buildMonthlyDepartmentEmail({ periodStart, reportSummary, monthExcelCurrent, monthExcelPrev, monthExcelPrev2, llmSections }) {
  getDepartmentPrompt(); // Use prompt (throw if missing)
  const subject = getMonthlyDepartmentSubject(periodStart);
  const html = buildMonthlyDepartmentEmailHtml({
    periodStart,
    reportSummary: reportSummary ?? null,
    report: null,
    llmSections,
  });
  const attachments = [];
  if (monthExcelCurrent && Buffer.isBuffer(monthExcelCurrent)) {
    attachments.push({ filename: `Raport_lunar_${periodStart?.slice(0, 7) || 'luna'}.xlsx`, content: monthExcelCurrent });
  }
  if (monthExcelPrev && Buffer.isBuffer(monthExcelPrev)) {
    attachments.push({ filename: `Raport_lunar_prev.xlsx`, content: monthExcelPrev });
  }
  if (monthExcelPrev2 && Buffer.isBuffer(monthExcelPrev2)) {
    attachments.push({ filename: `Raport_lunar_prev2.xlsx`, content: monthExcelPrev2 });
  }
  return { subject, html, attachments };
}

/**
 * Returns HTML for monthly employee email. Requires llmSections (from Vertex LLM); no placeholder.
 * Uses monthlyEmployeePrompt.md; structure: salut, tabel, interpretare, concluzii, acțiuni, plan [+ check-in dacă sub standard].
 */
export function renderMonthlyEmployeeEmail(report, person, meta, llmSections) {
  const stats = getPersonRow(report, person);
  const result = buildMonthlyEmployeeEmail({
    person,
    data3Months: { current: stats },
    periodStart: meta?.periodStart,
    llmSections,
  });
  return result.html;
}

/**
 * Returns HTML for monthly management email. Requires llmSections (from Vertex LLM); no placeholder.
 * Uses monthlyDepartmentPrompt.md; structure: rezumat executiv, analiză vânzări, operațional, comparații, recomandări, tabel.
 */
export function renderMonthlyManagerEmail(report, meta, reportSummary, llmSections) {
  return buildMonthlyDepartmentEmailHtml({
    periodStart: meta?.periodStart,
    reportSummary: reportSummary ?? null,
    report: report ?? null,
    llmSections,
  });
}

/** Alias for renderMonthlyManagerEmail. data = { report, meta, reportSummary, llmSections }. */
export function renderMonthlyManagementEmail(data) {
  return renderMonthlyManagerEmail(data.report, data.meta, data.reportSummary, data.llmSections);
}
