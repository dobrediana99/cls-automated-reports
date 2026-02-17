/**
 * Monthly employee email template. Builds HTML from full validated LLM output (antet, sectiuni, incheiere).
 * Single source of truth: prompt from backend/prompts/monthlyEmployeePrompt.md.
 */

import { loadMonthlyEmployeePrompt } from '../../prompts/loadPrompts.js';
import { getMonthlyEmployeeSubject, getMonthlySalutation } from '../content/monthlyTexts.js';
import { escapeHtml } from './weeklyEmployeeDetails.js';
import { sanitizeReportHtml } from '../sanitize.js';
import { DEPARTMENTS } from '../../config/org.js';

/** Normalize LLM section HTML: sanitize and strip redundant leading headings. Exported for tests. */
function innerText(html) {
  if (!html || typeof html !== 'string') return '';
  return html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}
function normLabel(s) {
  return String(s).toLowerCase().replace(/\s+/g, ' ').trim();
}
export function normalizeLlmSection(html, opts = {}) {
  if (!html || typeof html !== 'string') return '';
  const removeLabels = Array.isArray(opts?.removeLabels) ? opts.removeLabels.map(normLabel) : [];
  let s = String(html);
  s = s.replace(/^\s*<p[^>]*>\s*(<strong[^>]*>)?\s*SUBIECT:[\s\S]*?<\/p>\s*/gi, '');
  s = s.replace(/^\s*<p[^>]*>\s*Bun[ăa][^<]*<\/p>\s*/i, '');
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
  return sanitizeReportHtml(s.trim()).trim();
}

const BODY_STYLE =
  'font-family: Arial, sans-serif; font-size: 14px; max-width: 600px; margin: 0 auto; padding: 16px;';
const SECTION_STYLE = 'margin: 1em 0 0 0;';
const H3_STYLE = 'font-size: 15px; font-weight: bold; margin: 1em 0 0.4em 0;';

const REQUIRED_TOP_KEYS = [
  'antet',
  'sectiunea_1_tabel_date_performanta',
  'sectiunea_2_interpretare_date',
  'sectiunea_3_concluzii',
  'sectiunea_4_actiuni_prioritare',
  'sectiunea_5_plan_saptamanal',
  'incheiere',
];

function assertFullStructure(llmSections) {
  if (!llmSections || typeof llmSections !== 'object') {
    throw new Error(
      'Monthly employee email requires llmSections (full validated structure from LLM). Job fails without valid analysis.'
    );
  }
  for (const key of REQUIRED_TOP_KEYS) {
    if (!(key in llmSections) || llmSections[key] == null) {
      throw new Error(
        `Monthly employee email missing LLM key: ${key}. Job fails without valid analysis.`
      );
    }
  }
}

/**
 * Builds full HTML for monthly employee email from the full validated LLM object.
 * @param {object} opts - { person, data3Months, deptAverages3Months, periodStart, llmSections }
 * @param {object} opts.llmSections - Full validated output: antet, sectiunea_1_*, ..., incheiere (optional sectiunea_6)
 * @returns {string} Full HTML document
 */
export function buildMonthlyEmployeeEmailHtml({
  person,
  department,
  data3Months,
  deptAverages3Months,
  periodStart,
  llmSections,
}) {
  loadMonthlyEmployeePrompt(); // Ensure prompt exists (throw if missing)
  assertFullStructure(llmSections);

  const antet = llmSections.antet;
  const s1 = llmSections.sectiunea_1_tabel_date_performanta;
  const s2 = llmSections.sectiunea_2_interpretare_date;
  const s3 = llmSections.sectiunea_3_concluzii;
  const s4 = llmSections.sectiunea_4_actiuni_prioritare;
  const s5 = llmSections.sectiunea_5_plan_saptamanal;
  const s6 = llmSections.sectiunea_6_check_in_intermediar;
  const incheiere = llmSections.incheiere;

  const greeting =
    antet?.greeting != null
      ? escapeHtml(String(antet.greeting).trim())
      : escapeHtml(getMonthlySalutation(person?.name));
  const intro =
    antet?.intro_message != null ? String(antet.intro_message).trim() : '';

  const continutRows =
    Array.isArray(s1?.continut) && s1.continut.length > 0
      ? s1.continut.map((line) => `<li>${escapeHtml(String(line))}</li>`).join('')
      : '';
  const sect1Html =
    continutRows !== ''
      ? `<h3 style="${H3_STYLE}">Tabel date performanță</h3><ul style="${SECTION_STYLE}">${continutRows}</ul>`
      : '';

  const includeList =
    Array.isArray(s2?.include) && s2.include.length > 0
      ? s2.include.map((item) => `<li>${escapeHtml(String(item))}</li>`).join('')
      : '';
  const stilText = s2?.stil != null ? escapeHtml(String(s2.stil)) : '';
  const sect2Html =
    `<h3 style="${H3_STYLE}">Interpretare date</h3><p style="${SECTION_STYLE}"><strong>Stil:</strong> ${stilText}</p>` +
    (includeList ? `<ul style="${SECTION_STYLE}">${includeList}</ul>` : '');

  const ceMerge = s3?.ce_merge_bine != null ? escapeHtml(String(s3.ce_merge_bine)) : '';
  const ceNuMerge = s3?.ce_nu_merge_si_necesita_interventie_urgenta != null ? escapeHtml(String(s3.ce_nu_merge_si_necesita_interventie_urgenta)) : '';
  const focus = s3?.focus_luna_urmatoare != null ? escapeHtml(String(s3.focus_luna_urmatoare)) : '';
  const sect3Html =
    `<h3 style="${H3_STYLE}">Concluzii</h3><p style="${SECTION_STYLE}"><strong>Ce merge bine:</strong> ${ceMerge}</p>` +
    `<p style="${SECTION_STYLE}"><strong>Ce nu merge și necesită intervenție urgentă:</strong> ${ceNuMerge}</p>` +
    `<p style="${SECTION_STYLE}"><strong>Focus luna următoare:</strong> ${focus}</p>`;

  const formatActiune = s4?.format_actiune != null ? escapeHtml(String(s4.format_actiune)) : '';
  const struct = s4?.structura;
  const structHtml =
    struct && typeof struct === 'object'
      ? `<p style="${SECTION_STYLE}"><strong>Ce:</strong> ${escapeHtml(String(struct.ce ?? ''))}</p>` +
        `<p style="${SECTION_STYLE}"><strong>De ce:</strong> ${escapeHtml(String(struct.de_ce ?? ''))}</p>` +
        `<p style="${SECTION_STYLE}"><strong>Măsurabil:</strong> ${escapeHtml(String(struct.masurabil ?? ''))}</p>` +
        `<p style="${SECTION_STYLE}"><strong>Deadline:</strong> ${escapeHtml(String(struct.deadline ?? ''))}</p>`
      : '';
  const roleKey =
    department === DEPARTMENTS.OPERATIONS ? 'freight_forwarder' : 'sales_freight_agent';
  const actiuniRol = s4?.actiuni_specifice_per_rol?.[roleKey];
  const actiuniList =
    Array.isArray(actiuniRol) && actiuniRol.length > 0
      ? actiuniRol.map((a) => `<li>${escapeHtml(String(a))}</li>`).join('')
      : '';
  const sect4Html =
    `<h3 style="${H3_STYLE}">Acțiuni prioritare</h3><p style="${SECTION_STYLE}">${formatActiune}</p>${structHtml}` +
    (actiuniList ? `<ul style="${SECTION_STYLE}">${actiuniList}</ul>` : '');

  const fmt = s5?.format;
  const sapt1 = fmt?.saptamana_1 != null ? escapeHtml(String(fmt.saptamana_1)) : '';
  const sapt24 = fmt?.saptamana_2_4 != null ? escapeHtml(String(fmt.saptamana_2_4)) : '';
  const sect5Html =
    `<h3 style="${H3_STYLE}">Plan săptămânal</h3><p style="${SECTION_STYLE}"><strong>Săptămâna 1:</strong> ${sapt1}</p><p style="${SECTION_STYLE}"><strong>Săptămâna 2–4:</strong> ${sapt24}</p>`;

  const showCheckIn = s6 != null && typeof s6 === 'object';
  const sect6Html =
    showCheckIn && s6.format
      ? `<h3 style="${H3_STYLE}">Check-in intermediar</h3><p style="${SECTION_STYLE}">${escapeHtml(String(s6.format))}</p>`
      : '';

  const raportUrmator = incheiere?.raport_urmator != null ? escapeHtml(String(incheiere.raport_urmator)) : '';
  const mesaj = showCheckIn
    ? (incheiere?.mesaj_sub_80 != null ? escapeHtml(String(incheiere.mesaj_sub_80)) : '')
    : (incheiere?.mesaj_peste_80 != null ? escapeHtml(String(incheiere.mesaj_peste_80)) : '');
  const semn = incheiere?.semnatura;
  const semnaturaHtml =
    semn && typeof semn === 'object'
      ? `<p style="margin: 1em 0 0 0;">${escapeHtml(String(semn.nume ?? ''))}<br/>${escapeHtml(String(semn.functie ?? ''))}<br/>${escapeHtml(String(semn.companie ?? ''))}</p>`
      : '';

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>${escapeHtml(antet?.subiect ?? 'Raport performanță')}</title></head>
<body style="${BODY_STYLE}">
  <p style="margin: 0 0 1em 0;">${greeting}</p>
  ${intro ? `<p style="${SECTION_STYLE}">${escapeHtml(intro)}</p>` : ''}
  ${sect1Html}
  ${sect2Html}
  ${sect3Html}
  ${sect4Html}
  ${sect5Html}
  ${sect6Html}
  ${raportUrmator ? `<p style="${SECTION_STYLE}"><strong>Raport următor:</strong> ${raportUrmator}</p>` : ''}
  ${mesaj ? `<p style="${SECTION_STYLE}">${mesaj}</p>` : ''}
  ${semnaturaHtml}
  <p style="margin: 1.5em 0 0 0;">Pentru orice nelămuriri legate de datele afișate, vă rugăm să luați legătura cu managerul direct.</p>
  <p style="margin: 0.5em 0 0 0;">Vă mulțumim.</p>
</body>
</html>`;
}

/**
 * Builds monthly employee email. Subject from antet.subiect when available, else from getMonthlyEmployeeSubject.
 * @param {object} opts - { person, data3Months, deptAverages3Months, periodStart, llmSections }
 * @param {object} opts.llmSections - Full validated structure (antet, sectiuni, incheiere)
 * @returns {{ subject: string, html: string }}
 */
export function buildMonthlyEmployeeEmail({
  person,
  data3Months,
  deptAverages3Months,
  periodStart,
  llmSections,
}) {
  loadMonthlyEmployeePrompt();
  assertFullStructure(llmSections);
  const subject =
    llmSections.antet?.subiect != null && String(llmSections.antet.subiect).trim() !== ''
      ? String(llmSections.antet.subiect).trim()
      : getMonthlyEmployeeSubject(person?.name, periodStart);
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

/** Exported for tests (backward compat). */
export function loadMonthlyEmployeePromptFromRepo() {
  return loadMonthlyEmployeePrompt();
}
