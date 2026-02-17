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

/** Builds full HTML for monthly employee (single report). Requires llmSections (from OpenRouter LLM); no placeholder. */
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

const DEPT_REQUIRED_KEYS = [
  'antet',
  'sectiunea_1_rezumat_executiv',
  'sectiunea_2_analiza_vanzari',
  'sectiunea_3_analiza_operational',
  'sectiunea_4_comparatie_departamente',
  'sectiunea_5_recomandari_management',
  'incheiere',
];

function esc(s) {
  return escapeHtml(String(s ?? ''));
}

/** Render object key-value as paragraphs; skip 'titlu'. */
function renderObj(obj, sectionStyle) {
  if (!obj || typeof obj !== 'object') return '';
  return Object.entries(obj)
    .filter(([k]) => k !== 'titlu')
    .map(([k, v]) => {
      if (v === undefined || v === null) return '';
      if (typeof v === 'object' && !Array.isArray(v)) return renderObj(v, sectionStyle);
      if (Array.isArray(v)) {
        const parts = v.map((i) => {
          if (typeof i === 'object' && i !== null) {
            const inner = Object.entries(i)
              .map(([kk, vv]) => (vv != null ? `${esc(kk)}: ${esc(vv)}` : ''))
              .filter(Boolean)
              .join('; ');
            return inner || esc(JSON.stringify(i));
          }
          return esc(String(i));
        });
        return parts.length ? `<ul style="${sectionStyle}">${parts.map((p) => `<li>${p}</li>`).join('')}</ul>` : '';
      }
      return `<p style="${sectionStyle}"><strong>${esc(k)}:</strong> ${esc(v)}</p>`;
    })
    .join('');
}

/** Build HTML for one department section (titlu + nested content). */
function renderDeptSection(section, sectionStyle, h2Style) {
  if (!section || typeof section !== 'object') return '';
  const titlu = section.titlu != null ? esc(section.titlu) : '';
  const body = renderObj(section, sectionStyle);
  return titlu ? `<h2 style="${h2Style}">${titlu}</h2>${body}` : body;
}

/**
 * Builds full HTML for monthly management email from full validated LLM structure.
 * @param {object} opts - { periodStart, reportSummary?, report?, llmSections }
 * @param {object} opts.llmSections - Full validated: antet, sectiunea_1_*, ..., incheiere
 * @returns {string} Full HTML document
 */
export function buildMonthlyDepartmentEmailHtml({ periodStart, reportSummary, report, llmSections }) {
  getDepartmentPrompt();
  if (!llmSections || typeof llmSections !== 'object') {
    throw new Error('Monthly management email requires llmSections (full validated structure). Job fails without valid analysis.');
  }
  for (const key of DEPT_REQUIRED_KEYS) {
    if (!(key in llmSections) || llmSections[key] == null) {
      throw new Error(`Monthly management email missing LLM key: ${key}. Job fails without valid analysis.`);
    }
  }

  const intro = llmSections.antet?.introducere != null ? esc(llmSections.antet.introducere) : '';
  const s1 = renderDeptSection(llmSections.sectiunea_1_rezumat_executiv, SECTION_STYLE, H2_STYLE);
  const s2 = renderDeptSection(llmSections.sectiunea_2_analiza_vanzari, SECTION_STYLE, H2_STYLE);
  const s3 = renderDeptSection(llmSections.sectiunea_3_analiza_operational, SECTION_STYLE, H2_STYLE);
  const s4 = renderDeptSection(llmSections.sectiunea_4_comparatie_departamente, SECTION_STYLE, H2_STYLE);
  const s5 = renderDeptSection(llmSections.sectiunea_5_recomandari_management, SECTION_STYLE, H2_STYLE);
  const incheiere = llmSections.incheiere;
  const urmatorulRaport = incheiere?.urmatorulRaport != null ? esc(incheiere.urmatorulRaport) : '';
  const semn = incheiere?.semnatura;
  const semnaturaHtml =
    semn && typeof semn === 'object'
      ? `<p style="margin: 1em 0 0 0;">${esc(semn.functie)}<br/>${esc(semn.companie)}</p>`
      : '';

  let tableHtml = '';
  if (reportSummary && reportSummary.departments) {
    tableHtml =
      '<table style="border-collapse: collapse; width: 100%; max-width: 560px; font-family: Arial, sans-serif; font-size: 13px;">';
    tableHtml +=
      '<thead><tr><th style="padding: 8px 10px; border: 1px solid #ccc; background: #f2f2f2;">Departament / Indicator</th><th style="padding: 8px 10px; border: 1px solid #ccc; background: #f2f2f2;">Valoare</th></tr></thead><tbody>';
    const deps = [
      { key: 'operational', label: 'Operațiuni' },
      { key: 'sales', label: 'Vânzări' },
      { key: 'management', label: 'Management' },
    ];
    for (const { key, label } of deps) {
      const d = reportSummary.departments[key];
      if (d && typeof d === 'object') {
        tableHtml += `<tr><td style="padding: 8px 10px; border: 1px solid #ccc; font-weight: bold;" colspan="2">${esc(label)}</td></tr>`;
        for (const [k, v] of Object.entries(d)) {
          if (v !== undefined && v !== null && typeof v === 'number' && !Number.isNaN(v)) {
            tableHtml += `<tr><td style="padding: 8px 10px; border: 1px solid #ccc;">${esc(k)}</td><td style="padding: 8px 10px; border: 1px solid #ccc;">${v}</td></tr>`;
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
<head><meta charset="utf-8"><title>${esc(llmSections.antet?.subiect ?? 'Raport performanță departamentală')}</title></head>
<body style="${BODY_STYLE}">
  ${intro ? `<p style="${SECTION_STYLE}">${intro}</p>` : ''}
  ${s1}
  ${s2}
  ${s3}
  ${s4}
  ${s5}
  <h2 style="${H2_STYLE}">Date agregate (tabel)</h2>
  ${tableHtml}
  ${urmatorulRaport ? `<p style="${SECTION_STYLE}"><strong>Următorul raport:</strong> ${urmatorulRaport}</p>` : ''}
  ${semnaturaHtml}
  <p style="margin: 1.5em 0 0 0;">Pentru orice nelămuriri, contactați echipa de raportare.</p>
  <p style="margin: 0.5em 0 0 0;">Vă mulțumim.</p>
</body>
</html>`;
}

/**
 * Builds monthly department/management email from full validated LLM structure.
 * @param {object} opts - { periodStart, reportSummary?, monthExcelCurrent?, monthExcelPrev?, monthExcelPrev2?, llmSections }
 * @param {object} opts.llmSections - Full validated structure (antet, sectiuni, incheiere)
 * @returns {{ subject: string, html: string, attachments: Array<{ filename: string, content: Buffer }> }}
 */
export function buildMonthlyDepartmentEmail({ periodStart, reportSummary, monthExcelCurrent, monthExcelPrev, monthExcelPrev2, llmSections }) {
  getDepartmentPrompt();
  const subject =
    llmSections?.antet?.subiect != null && String(llmSections.antet.subiect).trim() !== ''
      ? String(llmSections.antet.subiect).trim()
      : getMonthlyDepartmentSubject(periodStart);
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
 * Returns HTML for monthly employee email. Requires llmSections (from OpenRouter LLM); no placeholder.
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
 * Returns HTML for monthly management email. Requires llmSections (from OpenRouter LLM); no placeholder.
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
