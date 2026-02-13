/**
 * Monthly employee email template. Single source of truth: prompt from backend/prompts/monthlyEmployeePrompt.md.
 * Loads prompt at runtime (fs.readFileSync); no hardcoded instructions in code.
 */

import { loadMonthlyEmployeePrompt } from '../../prompts/loadPrompts.js';
import { getMonthlyEmployeeSubject, getMonthlySalutation } from '../content/monthlyTexts.js';
import { buildEmployeeDetailsTable, escapeHtml } from './weeklyEmployeeDetails.js';
import { sanitizeReportHtml } from '../sanitize.js';

const safeVal = (v) => (typeof v === 'number' && !isNaN(v) ? v : 0);

/** Sub standard = sub 80% target (conform prompt: check-in doar dacă angajatul e sub standard). */
function isSubStandard(monthData, department) {
  if (!monthData || typeof monthData !== 'object') return false;
  const target = safeVal(monthData.target);
  if (target <= 0) return false;
  const totalProfit =
    safeVal(monthData.ctr_principalProfitEur) +
    safeVal(monthData.ctr_secondaryProfitEur) +
    safeVal(monthData.livr_principalProfitEur) +
    safeVal(monthData.livr_secondaryProfitEur);
  const ratio = totalProfit / target;
  return ratio < 0.8;
}

const BODY_STYLE = 'font-family: Arial, sans-serif; font-size: 14px; max-width: 600px; margin: 0 auto; padding: 16px;';
const SECTION_STYLE = 'margin: 1em 0 0 0;';
const H3_STYLE = 'font-size: 15px; font-weight: bold; margin: 1em 0 0.4em 0;';

/**
 * Loads monthly employee prompt from repo (single source of truth). Used every time we build employee email.
 * @returns {string} Raw prompt content (for LLM when integrated)
 * @throws {Error} If file is missing
 */
export function loadMonthlyEmployeePromptFromRepo() {
  return loadMonthlyEmployeePrompt();
}

/**
 * Builds full HTML for monthly employee email. Structure from monthlyEmployeePrompt.md.
 * Table is deterministic (from code). Interpretare/Concluzii/Acțiuni/Plan come from LLM (llmSections required).
 * @param {object} opts - { person, department, data3Months, deptAverages3Months, periodStart, llmSections }
 * @param {object} opts.llmSections - { interpretareHtml, concluziiHtml, actiuniHtml, planHtml } from OpenRouter LLM; required, no placeholder
 * @returns {string} Full HTML document
 */
export function buildMonthlyEmployeeEmailHtml({ person, department, data3Months, deptAverages3Months, periodStart, llmSections }) {
  loadMonthlyEmployeePromptFromRepo(); // Ensure prompt exists (throw if missing)

  const required = ['interpretareHtml', 'concluziiHtml', 'actiuniHtml', 'planHtml'];
  if (!llmSections || typeof llmSections !== 'object') {
    throw new Error('Monthly employee email requires llmSections from OpenRouter LLM. Job fails without valid analysis.');
  }
  for (const key of required) {
    const val = llmSections[key];
    if (val == null || typeof val !== 'string' || !String(val).trim()) {
      throw new Error(`Monthly employee email missing LLM section: ${key}. Job fails without valid analysis.`);
    }
  }

  const current = data3Months?.current ?? null;
  const salutation = getMonthlySalutation(person?.name);
  const tableHtml = current
    ? buildEmployeeDetailsTable(current, department)
    : '<p style="margin: 1em 0 0 0;">Nu există date pentru această perioadă.</p>';

  const showCheckIn = isSubStandard(current, department);
  const checkInPlaceholder = 'Se recomandă un check-in intermediar cu managerul direct pentru aliniere și suport (data/periodicitate în funcție de disponibilitate).';

  const checkInSection = showCheckIn
    ? `
  <h3 style="${H3_STYLE}">Check-in intermediar</h3>
  <p style="${SECTION_STYLE}">${escapeHtml(checkInPlaceholder)}</p>
`
    : '';

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Raport performanță – ${escapeHtml(person?.name || '')}</title></head>
<body style="${BODY_STYLE}">
  <p style="margin: 0 0 1em 0;">${escapeHtml(salutation)}</p>

  <h3 style="${H3_STYLE}">Tabel date performanță</h3>
  ${tableHtml}

  <h3 style="${H3_STYLE}">Interpretare date</h3>
  <div style="${SECTION_STYLE}">${sanitizeReportHtml(llmSections.interpretareHtml)}</div>

  <h3 style="${H3_STYLE}">Concluzii</h3>
  <div style="${SECTION_STYLE}">${sanitizeReportHtml(llmSections.concluziiHtml)}</div>

  <h3 style="${H3_STYLE}">Acțiuni prioritare</h3>
  <div style="${SECTION_STYLE}">${sanitizeReportHtml(llmSections.actiuniHtml)}</div>

  <h3 style="${H3_STYLE}">Plan săptămânal</h3>
  <div style="${SECTION_STYLE}">${sanitizeReportHtml(llmSections.planHtml)}</div>
${checkInSection}
  <p style="margin: 1.5em 0 0 0;">Pentru orice nelămuriri legate de datele afișate, vă rugăm să luați legătura cu managerul direct.</p>
  <p style="margin: 0.5em 0 0 0;">Vă mulțumim.</p>
</body>
</html>`;
}

/**
 * Builds monthly employee email. Uses prompt from file. Requires llmSections (from OpenRouter LLM); no placeholder fallback.
 * @param {object} opts - { person, data3Months, deptAverages3Months, periodStart, llmSections }
 * @param {object} opts.llmSections - { interpretareHtml, concluziiHtml, actiuniHtml, planHtml }; required
 * @returns {{ subject: string, html: string }}
 */
export function buildMonthlyEmployeeEmail({ person, data3Months, deptAverages3Months, periodStart, llmSections }) {
  loadMonthlyEmployeePromptFromRepo();
  const subject = getMonthlyEmployeeSubject(person?.name, periodStart);
  const html = buildMonthlyEmployeeEmailHtml({
    person,
    department: person?.department,
    data3Months: data3Months ?? { current: null },
    deptAverages3Months,
    periodStart,
    llmSections,
  });
  return { subject, html };
}
