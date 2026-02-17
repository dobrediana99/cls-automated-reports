/**
 * Monthly employee email template. Single source of truth: prompt from backend/prompts/monthlyEmployeePrompt.md.
 * Loads prompt at runtime (fs.readFileSync); no hardcoded instructions in code.
 */

import { loadMonthlyEmployeePrompt } from '../../prompts/loadPrompts.js';
import { getMonthlyEmployeeSubject, getMonthlySalutation } from '../content/monthlyTexts.js';
import { escapeHtml } from './weeklyEmployeeDetails.js';
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

/** Extract inner text from HTML fragment (strip tags, collapse whitespace). */
function innerText(html) {
  if (!html || typeof html !== 'string') return '';
  return html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

/** Normalize for label comparison: lowercase, collapse spaces. */
function normLabel(s) {
  return String(s).toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Normalize LLM section HTML: sanitize and strip redundant leading SUBIECT, greetings, and duplicate section headings.
 * @param {string} html - Raw HTML from LLM
 * @param {{ removeLabels: string[] }} opts - Section title labels to strip if they appear as leading headings (e.g. 'interpretare date', 'concluzii')
 * @returns {string} Cleaned HTML
 */
function normalizeLlmSection(html, opts = {}) {
  if (!html || typeof html !== 'string') return '';
  const removeLabels = Array.isArray(opts?.removeLabels) ? opts.removeLabels.map(normLabel) : [];
  // Strip redundant content from raw HTML first (before sanitize may alter structure)
  let s = String(html);

  // Remove leading SUBIECT: paragraph(s)
  s = s.replace(/^\s*<p[^>]*>\s*(<strong[^>]*>)?\s*SUBIECT:[\s\S]*?<\/p>\s*/gi, '');

  // Remove leading greeting paragraph (Bună / Buna ...)
  s = s.replace(/^\s*<p[^>]*>\s*Bun[ăa][^<]*<\/p>\s*/i, '');

  // Remove leading headings or <p><strong>label</strong></p> that match removeLabels (repeat until no match)
  while (true) {
    const hMatch = s.match(/^\s*<h[1-4](?:\s[^>]*)?>([\s\S]*?)<\/h[1-4]>\s*/i);
    if (hMatch) {
      const text = normLabel(innerText(hMatch[1]));
      if (text && removeLabels.some((l) => text === l)) {
        s = s.slice(hMatch[0].length).trim();
        continue;
      }
    }
    const pStrongMatch = s.match(/^\s*<p[^>]*>\s*<strong[^>]*>([\s\S]*?)<\/strong>\s*<\/p>\s*/i);
    if (pStrongMatch) {
      const text = normLabel(innerText(pStrongMatch[1]));
      if (text && removeLabels.some((l) => text === l)) {
        s = s.slice(pStrongMatch[0].length).trim();
        continue;
      }
    }
    break;
  }

  s = sanitizeReportHtml(s.trim());
  return s.trim();
}

/** Exported for tests. */
export { normalizeLlmSection };

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
  const showCheckIn = isSubStandard(current, department);
  const checkInPlaceholder = 'Se recomandă un check-in intermediar cu managerul direct pentru aliniere și suport (data/periodicitate în funcție de disponibilitate).';

  const interpretareHtml = normalizeLlmSection(llmSections.interpretareHtml, {
    removeLabels: ['interpretare date'],
  });
  const concluziiHtml = normalizeLlmSection(llmSections.concluziiHtml, {
    removeLabels: ['concluzii'],
  });
  const actiuniHtml = normalizeLlmSection(llmSections.actiuniHtml, {
    removeLabels: ['acțiuni prioritare', 'actiuni prioritare'],
  });
  const planHtml = normalizeLlmSection(llmSections.planHtml, {
    removeLabels: ['plan săptămânal', 'plan saptamanal'],
  });

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

  <h3 style="${H3_STYLE}">Interpretare date</h3>
  <div style="${SECTION_STYLE}">${interpretareHtml}</div>

  <h3 style="${H3_STYLE}">Concluzii</h3>
  <div style="${SECTION_STYLE}">${concluziiHtml}</div>

  <h3 style="${H3_STYLE}">Acțiuni prioritare</h3>
  <div style="${SECTION_STYLE}">${actiuniHtml}</div>

  <h3 style="${H3_STYLE}">Plan săptămânal</h3>
  <div style="${SECTION_STYLE}">${planHtml}</div>
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
