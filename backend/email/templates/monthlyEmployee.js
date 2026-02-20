/**
 * Monthly employee email template. Builds HTML from full validated LLM output (antet, sectiuni, incheiere).
 * Single source of truth: prompt from backend/prompts/monthlyEmployeePrompt.md.
 */

import { loadMonthlyEmployeePrompt } from '../../prompts/loadPrompts.js';
import { getMonthlyEmployeeSubject, getMonthlySalutation } from '../content/monthlyTexts.js';
import {
  escapeHtml,
  formatTextBlock,
  renderSectionTitle,
  renderHr,
  renderKeyValueTable,
  buildDeterministicPerformanceTable,
} from '../monthlyEmailHelpers.js';
import { sanitizeReportHtml } from '../sanitize.js';
import { employeeToSemanticPayload } from '../../llm/semanticAdapters.js';

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

const CONTAINER_STYLE = 'font-family:Arial,sans-serif;background:#ffffff;padding:0;margin:0;';
const INNER_TABLE_STYLE = 'width:100%;max-width:680px;margin:0 auto;padding:20px;';
const SECTION_STYLE = 'margin:1em 0 0 0;';
const BOX_STYLE = 'border:1px solid #e0e0e0;background:#fafafa;padding:10px 12px;margin:8px 0;';
const WARNING_BOX_STYLE = 'border:1px solid #e6c200;background:#fffde7;padding:12px;margin:12px 0;';

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
 * Builds full HTML for monthly employee email. Uses semantic payload (from LLM adapter); backend controls 100% structure (titles, order, tables).
 * Section 1 "Date de performanță" is deterministic (backend). Subject/title from backend.
 * @param {object} opts - { person, data3Months, deptAverages3Months, periodStart, workingDaysInPeriod, llmSections }
 * @param {object} opts.llmSections - Full validated output (passed through semantic adapter for content only)
 * @returns {string} Full HTML document
 */
export function buildMonthlyEmployeeEmailHtml({
  person,
  department,
  data3Months,
  deptAverages3Months,
  periodStart,
  workingDaysInPeriod,
  llmSections,
}) {
  loadMonthlyEmployeePrompt();
  assertFullStructure(llmSections);
  const payload = employeeToSemanticPayload(llmSections, person);

  const greeting =
    payload.greeting.length > 0
      ? escapeHtml(payload.greeting)
      : escapeHtml(getMonthlySalutation(person?.name));
  const intro = payload.introMessage.length > 0 ? formatTextBlock(payload.introMessage) : '';

  const sect1Body = buildDeterministicPerformanceTable(
    data3Months ?? { current: null, prev: null },
    deptAverages3Months ?? { current: null },
    workingDaysInPeriod ?? 0,
  );
  const sect1Html = renderSectionTitle('Date de performanță', 2) + (sect1Body || '');

  const includeList =
    payload.interpretare.include.length > 0
      ? payload.interpretare.include.map((item) => `<li>${escapeHtml(String(item))}</li>`).join('')
      : '';
  const stilText = payload.interpretare.stil ? escapeHtml(payload.interpretare.stil) : '';
  const sect2Html =
    renderSectionTitle('Interpretare', 2) +
    (stilText ? `<p style="margin:0 0 8px 0;font-size:12px;font-style:italic;color:#555;">${stilText}</p>` : '') +
    (includeList ? `<ul style="${SECTION_STYLE}">${includeList}</ul>` : '');

  const ceMerge = escapeHtml(payload.concluzii.ceMergeBine) || '–';
  const ceNuMerge = escapeHtml(payload.concluzii.ceNuMerge) || '–';
  const focus = escapeHtml(payload.concluzii.focusLunaUrmatoare) || '–';
  const sect3Html =
    renderSectionTitle('Concluzii', 2) +
    `<div style="${BOX_STYLE}"><strong>Ce merge bine</strong><p style="margin:6px 0 0 0;">${ceMerge}</p></div>` +
    `<div style="${BOX_STYLE}"><strong>Ce nu merge / necesită intervenție</strong><p style="margin:6px 0 0 0;">${ceNuMerge}</p></div>` +
    `<div style="${BOX_STYLE}"><strong>Focus luna următoare</strong><p style="margin:6px 0 0 0;">${focus}</p></div>`;

  const actiuniList = payload.actiuni.map((a) => `<li>${escapeHtml(String(a))}</li>`).join('');
  const actiuniBlock = actiuniList ? `<ul style="margin:4px 0 0 0;">${actiuniList}</ul>` : '';
  const sect4Html = renderSectionTitle('Acțiuni prioritare', 2) + (actiuniBlock || '');

  const planRows = [
    ['Săptămâna 1', payload.plan.saptamana_1],
    ['Săptămânile 2–4', payload.plan.saptamana_2_4],
  ];
  const sect5Html = renderSectionTitle('Plan săptămânal', 2) + renderKeyValueTable(planRows);

  const showCheckIn = payload.checkIn != null;
  const hasCheckInContent = showCheckIn && (String(payload.checkIn?.format ?? '').trim() || String(payload.checkIn?.regula ?? '').trim());
  const sect6Html =
    hasCheckInContent
      ? `<div style="${WARNING_BOX_STYLE}">${renderSectionTitle('Check-in intermediar', 3)}${payload.checkIn.format ? formatTextBlock(payload.checkIn.format) : ''}${payload.checkIn.regula ? `<p style="margin:6px 0 0 0;">${escapeHtml(String(payload.checkIn.regula))}</p>` : ''}</div>`
      : '';

  const raportUrmator = payload.incheiere.raportUrmator ? escapeHtml(payload.incheiere.raportUrmator) : '';
  const mesaj = showCheckIn
    ? (payload.incheiere.mesajSub80 ? escapeHtml(payload.incheiere.mesajSub80) : '')
    : (payload.incheiere.mesajPeste80 ? escapeHtml(payload.incheiere.mesajPeste80) : '');
  const semn = payload.incheiere.semnatura;
  const semnaturaHtml =
    semn && typeof semn === 'object'
      ? `<p style="margin:1em 0 0 0;">${escapeHtml(String(semn.nume ?? ''))}<br/>${escapeHtml(String(semn.functie ?? ''))}<br/>${escapeHtml(String(semn.companie ?? ''))}</p>`
      : '';

  const title = escapeHtml(getMonthlyEmployeeSubject(person?.name, periodStart));
  const bodyInner =
    `<p style="margin:0 0 1em 0;"><b>${greeting}</b></p>` +
    (intro ? `<div style="margin:0 0 16px 0;">${intro}</div>` : '') +
    sect1Html +
    renderHr() +
    sect2Html +
    renderHr() +
    sect3Html +
    renderHr() +
    sect4Html +
    renderHr() +
    sect5Html +
    (sect6Html ? renderHr() + sect6Html + renderHr() : '') +
    (raportUrmator ? `<p style="${SECTION_STYLE}"><strong>Raport următor:</strong> ${raportUrmator}</p>` : '') +
    (mesaj ? `<p style="${SECTION_STYLE}">${mesaj}</p>` : '') +
    semnaturaHtml;

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>${title}</title></head>
<body style="margin:0;padding:0;">
<div style="${CONTAINER_STYLE}">
<table style="${INNER_TABLE_STYLE}" role="presentation"><tr><td style="font-size:14px;">
${bodyInner}
</td></tr></table>
</div>
</body>
</html>`;
}

/**
 * Builds monthly employee email. Subject and title always from backend (getMonthlyEmployeeSubject).
 * @param {object} opts - { person, data3Months, deptAverages3Months, periodStart, llmSections }
 * @param {object} opts.llmSections - Full validated structure (content passed through semantic adapter)
 * @returns {{ subject: string, html: string }}
 */
export function buildMonthlyEmployeeEmail({
  person,
  data3Months,
  deptAverages3Months,
  periodStart,
  workingDaysInPeriod,
  llmSections,
}) {
  loadMonthlyEmployeePrompt();
  assertFullStructure(llmSections);
  const subject = getMonthlyEmployeeSubject(person?.name, periodStart);
  const html = buildMonthlyEmployeeEmailHtml({
    person,
    department: person?.department,
    data3Months: data3Months ?? { current: null },
    deptAverages3Months,
    periodStart,
    workingDaysInPeriod: workingDaysInPeriod ?? 0,
    llmSections,
  });
  return { subject, html };
}

/** Exported for tests (backward compat). */
export function loadMonthlyEmployeePromptFromRepo() {
  return loadMonthlyEmployeePrompt();
}
