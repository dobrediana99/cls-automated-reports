/**
 * Monthly email rendering. Uses prompts from backend/prompts/ as single source of truth (loaded at runtime).
 * Employee emails: backend/email/templates/monthlyEmployee.js (prompt from monthlyEmployeePrompt.md).
 * Management email: department prompt from monthlyDepartmentPrompt.md; Total Company doar tabel.
 */

import { loadMonthlyDepartmentPrompt } from '../prompts/loadPrompts.js';
import { getMonthlyDepartmentSubject } from './content/monthlyTexts.js';
import { getPersonRow } from './getPersonRow.js';
import {
  escapeHtml,
  formatTextBlock,
  renderSectionTitle,
  renderHr,
  renderKeyValueTable,
  parseMarkdownTableToHtml,
} from './monthlyEmailHelpers.js';
import { buildMonthlyEmployeeEmail, buildMonthlyEmployeeEmailHtml as buildEmployeeEmailHtmlFromTemplate } from './templates/monthlyEmployee.js';
import { departmentToSemanticPayload } from '../llm/semanticAdapters.js';

export { getPersonRow };

const CONTAINER_STYLE = 'font-family:Arial,sans-serif;background:#ffffff;padding:0;margin:0;';
const INNER_TABLE_STYLE = 'width:100%;max-width:680px;margin:0 auto;padding:20px;';
const SECTION_STYLE = 'margin:1em 0 0 0;';

function getDepartmentPrompt() {
  return loadMonthlyDepartmentPrompt();
}

function objToRows(obj) {
  if (!obj || typeof obj !== 'object') return [];
  return Object.entries(obj).map(([k, v]) => [String(k), v != null ? String(v) : '']);
}

/** Build one department analysis block (Vânzări or Operațional): tables + tabelAngajati (markdown→HTML) + probleme + high/low + problemeSistemice. Title from backend when provided. */
function buildDeptAnalysisBlock(section, backendTitle = null) {
  if (!section || typeof section !== 'object') return '';
  const parts = [];
  const title = backendTitle != null && String(backendTitle).trim() ? String(backendTitle).trim() : (section.titlu ?? '');
  parts.push(renderSectionTitle(title, 2));
  const pv = section.performantaVsIstoric;
  if (pv && typeof pv === 'object') parts.push(renderKeyValueTable(objToRows(pv)));
  const td = section.targetDepartamental;
  if (td && typeof td === 'object') parts.push(renderKeyValueTable(objToRows(td)));
  const metrici = section.metriciMediiPerAngajat;
  if (metrici && typeof metrici === 'object') parts.push(renderKeyValueTable(objToRows(metrici)));
  const tabelStr = section.tabelAngajati;
  if (tabelStr != null && String(tabelStr).trim() !== '') {
    parts.push(parseMarkdownTableToHtml(String(tabelStr)));
  }
  const problemeAng = section.problemeIdentificateAngajati;
  if (Array.isArray(problemeAng) && problemeAng.length > 0) {
    const lis = problemeAng.map((item) => {
      const nume = item?.nume != null ? escapeHtml(String(item.nume)) : '';
      const probs = Array.isArray(item?.probleme) ? item.probleme : [];
      const probLis = probs.map((p) => `<li>${escapeHtml(String(p))}</li>`).join('');
      return `<li><b>${nume}</b><ul style="margin:4px 0 0 0;">${probLis}</ul></li>`;
    }).join('');
    parts.push(`<ul style="${SECTION_STYLE}">${lis}</ul>`);
  }
  const high = section.highPerformers;
  const low = section.lowPerformers;
  if (Array.isArray(high) && high.length > 0) {
    const rows = high.map((h) => [
      (h?.nume ?? '') + (h?.profit != null ? ` – ${h.profit}` : '') + (h?.procentTarget != null ? ` (${h.procentTarget})` : ''),
      h?.justificare ?? '',
    ]);
    parts.push(renderSectionTitle('Performeri ridicați', 3));
    parts.push(renderKeyValueTable(rows.map((r) => [r[0], r[1]])));
  }
  if (Array.isArray(low) && low.length > 0) {
    const rows = low.map((l) => [
      (l?.nume ?? '') + (l?.profit != null ? ` – ${l.profit}` : '') + (l?.procentTarget != null ? ` (${l.procentTarget})` : ''),
      l?.justificare ?? '',
    ]);
    parts.push(renderSectionTitle('Performeri sub așteptări', 3));
    parts.push(renderKeyValueTable(rows.map((r) => [r[0], r[1]])));
  }
  const sist = section.problemeSistemice;
  if (Array.isArray(sist) && sist.length > 0) {
    parts.push(renderSectionTitle('Probleme sistemice', 3));
    parts.push('<ul style="' + SECTION_STYLE + '">' + sist.map((s) => `<li>${escapeHtml(String(s))}</li>`).join('') + '</ul>');
  } else {
    parts.push(renderSectionTitle('Probleme sistemice', 3));
    parts.push('<p style="margin:0 0 8px 0;">Nu au fost identificate probleme sistemice.</p>');
  }
  return parts.join(renderHr());
}

/** Build comparație table from tabelComparativ object (profitTotal, numarCurseTotal, etc.) */
function buildComparatieTable(tabelComparativ) {
  if (!tabelComparativ || typeof tabelComparativ !== 'object') return '';
  const TABLE_STYLE = 'border-collapse:collapse;width:100%;font-family:Arial,sans-serif;font-size:14px;';
  const TH = 'padding:8px 10px;border:1px solid #ddd;background:#f7f7f7;text-align:left;font-weight:bold;';
  const TD = 'padding:8px 10px;border:1px solid #ddd;';
  const labels = {
    profitTotal: 'Profit Total',
    numarCurseTotal: 'Număr Curse Total',
    procentTargetDepartamental: '% Target Departamental',
    profitMediuAngajat: 'Profit Mediu/Angajat',
    trendVsLunaAnterioara: 'Trend vs. luna anterioară',
  };
  let html = `<table style="${TABLE_STYLE}"><thead><tr><th style="${TH}">Indicator</th><th style="${TH}">Vânzări</th><th style="${TH}">Operațional</th><th style="${TH}">Diferență</th></tr></thead><tbody>`;
  const rowOrder = ['profitTotal', 'numarCurseTotal', 'procentTargetDepartamental', 'profitMediuAngajat', 'trendVsLunaAnterioara'];
  for (const key of rowOrder) {
    const row = tabelComparativ[key];
    if (!row || typeof row !== 'object') continue;
    const label = labels[key] || key;
    const vanz = row.vanzari != null ? escapeHtml(String(row.vanzari)) : '';
    const op = row.operational != null ? escapeHtml(String(row.operational)) : '';
    const diff = row.diferenta != null ? escapeHtml(String(row.diferenta)) : '–';
    html += `<tr><td style="${TD}">${escapeHtml(label)}</td><td style="${TD}">${vanz}</td><td style="${TD}">${op}</td><td style="${TD}">${diff}</td></tr>`;
  }
  html += '</tbody></table>';
  return html;
}

/** Re-export for callers that need { subject, html } with data3Months. */
export { buildMonthlyEmployeeEmail };

/** Builds full HTML for monthly employee (single report). Requires llmSections (from OpenRouter LLM); no placeholder. */
export function buildMonthlyEmployeeEmailHtml({ personName, stats, department, periodStart, workingDaysInPeriod = 0, showCheckIn = false, llmSections }) {
  return buildEmployeeEmailHtmlFromTemplate({
    person: { name: personName, department },
    department,
    data3Months: { current: stats },
    deptAverages3Months: null,
    periodStart,
    workingDaysInPeriod,
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

/**
 * Builds full HTML for monthly management email from full validated LLM structure.
 * Subject/title from code. Rezumat Executiv section is not rendered.
 * @param {object} opts - { periodStart, periodEnd?, workingDaysInPeriod?, reportSummary?, reportSummaryPrev?, report?, meta?, llmSections }
 * @param {object} opts.llmSections - Full validated: antet, sectiunea_1_*, ..., incheiere (sectiunea_1 content not used for rezumat)
 * @returns {string} Full HTML document
 */
export function buildMonthlyDepartmentEmailHtml({ periodStart, periodEnd, workingDaysInPeriod, reportSummary, reportSummaryPrev, report, meta, llmSections }) {
  getDepartmentPrompt();
  if (!llmSections || typeof llmSections !== 'object') {
    throw new Error('Monthly management email requires llmSections (full validated structure). Job fails without valid analysis.');
  }
  for (const key of DEPT_REQUIRED_KEYS) {
    if (!(key in llmSections) || llmSections[key] == null) {
      throw new Error(`Monthly management email missing LLM key: ${key}. Job fails without valid analysis.`);
    }
  }

  const subiect = escapeHtml(getMonthlyDepartmentSubject(periodStart));
  const payload = departmentToSemanticPayload(llmSections);
  const intro = payload.intro ? formatTextBlock(payload.intro) : '';

  const s2Block = buildDeptAnalysisBlock(payload.analizaVanzari, 'Analiză Vânzări');
  const s3Block = buildDeptAnalysisBlock(payload.analizaOperational, 'Analiză Operațional');

  const comparatieTitle = renderSectionTitle('Comparație Vânzări vs. Operațional', 2);
  const comparatieTable = buildComparatieTable(payload.comparatie.tabelComparativ);
  const observatii = payload.comparatie.observatii;
  const observatiiComparatie = observatii.length > 0
    ? '<ul style="' + SECTION_STYLE + '">' + observatii.map((o) => `<li>${escapeHtml(String(o))}</li>`).join('') + '</ul>'
    : '';

  const r = payload.recomandari;
  const oneToOne = r.oneToOneLowPerformers;
  const oneToOneRows = oneToOne.map((row) => [
    (row?.nume ?? '') + (row?.departament != null ? ` (${row.departament})` : ''),
    row?.problemePrincipale ?? '',
  ]);
  const training = r.trainingNecesare;
  const urmarire = r.urmarireSaptamanala;
  const urmarireRows = urmarire.map((row) => [row?.nume ?? '', row?.metricDeUrmarit ?? row?.metric ?? '']);
  const obiective = r.setareObiectiveSpecifice;
  const mutari = r.mutariRolOptional;
  const sistProces = r.problemeSistemiceProces;

  const recomandariParts = [];
  recomandariParts.push(renderSectionTitle('Recomandări Management', 2));
  if (oneToOneRows.length > 0) {
    recomandariParts.push(renderSectionTitle('One-to-one performeri sub așteptări', 3));
    recomandariParts.push(renderKeyValueTable(oneToOneRows));
  }
  if (training.length > 0) {
    recomandariParts.push(renderSectionTitle('Training necesare', 3));
    recomandariParts.push('<ul style="' + SECTION_STYLE + '">' + training.map((t) => `<li>${escapeHtml(String(t))}</li>`).join('') + '</ul>');
  }
  if (urmarireRows.length > 0) {
    recomandariParts.push(renderSectionTitle('Urmărire săptămânală', 3));
    recomandariParts.push(renderKeyValueTable(urmarireRows.map((r) => [r[0], r[1]])));
  }
  if (obiective.length > 0) {
    recomandariParts.push(renderSectionTitle('Setare obiective specifice', 3));
    recomandariParts.push('<ul style="' + SECTION_STYLE + '">' + obiective.map((o) => `<li>${escapeHtml(String(o))}</li>`).join('') + '</ul>');
  }
  if (mutari.length > 0) {
    recomandariParts.push(renderSectionTitle('Mutări rol (opțional)', 3));
    recomandariParts.push('<ul style="' + SECTION_STYLE + '">' + mutari.map((m) => `<li>${escapeHtml(String(m))}</li>`).join('') + '</ul>');
  }
  if (sistProces.length > 0) {
    recomandariParts.push(renderSectionTitle('Probleme sistemice de proces', 3));
    recomandariParts.push('<ul style="' + SECTION_STYLE + '">' + sistProces.map((p) => `<li>${escapeHtml(String(p))}</li>`).join('') + '</ul>');
  }
  const recomandariHtml = recomandariParts.join(renderHr());

  const inc = payload.incheiere;
  const urmatorulRaport = inc.urmatorulRaport ? escapeHtml(String(inc.urmatorulRaport)) : '';
  const semn = inc.semnatura;
  const semnaturaHtml =
    semn && typeof semn === 'object'
      ? `<p style="margin:1em 0 0 0;">${escapeHtml(String(semn.functie ?? ''))}<br/>${escapeHtml(String(semn.companie ?? ''))}</p>`
      : '';

  const bodyInner =
    (intro ? `<div style="margin:0 0 16px 0;">${intro}</div>` : '') +
    renderHr() +
    s2Block +
    renderHr() +
    s3Block +
    renderHr() +
    comparatieTitle +
    (comparatieTable ? comparatieTable : '') +
    (observatiiComparatie ? observatiiComparatie : '') +
    renderHr() +
    recomandariHtml +
    renderHr() +
    (urmatorulRaport ? `<p style="${SECTION_STYLE}"><strong>Următorul raport:</strong> ${urmatorulRaport}</p>` : '') +
    semnaturaHtml;

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>${subiect}</title></head>
<body style="margin:0;padding:0;">
<div style="${CONTAINER_STYLE}">
<table style="${INNER_TABLE_STYLE}" role="presentation"><tr><td style="font-size:14px;">
<h1 style="font-size:20px;margin:0 0 6px 0;">${subiect}</h1>
${bodyInner}
</td></tr></table>
</div>
</body>
</html>`;
}

/**
 * Builds monthly department/management email from full validated LLM structure.
 * Subject is always from code (getMonthlyDepartmentSubject). Rezumat Executiv section is not rendered.
 * @param {object} opts - { periodStart, meta?, reportSummary?, reportSummaryPrev?, report?, monthExcelCurrent?, monthExcelPrev?, monthExcelPrev2?, llmSections }
 * @param {object} opts.llmSections - Full validated structure (antet, sectiuni, incheiere)
 * @returns {{ subject: string, html: string, attachments: Array<{ filename: string, content: Buffer }> }}
 */
export function buildMonthlyDepartmentEmail({ periodStart, meta, reportSummary, reportSummaryPrev, report, monthExcelCurrent, monthExcelPrev, monthExcelPrev2, llmSections }) {
  getDepartmentPrompt();
  const subject = getMonthlyDepartmentSubject(periodStart);
  const html = buildMonthlyDepartmentEmailHtml({
    periodStart,
    periodEnd: meta?.periodEnd,
    workingDaysInPeriod: meta?.workingDaysInPeriod,
    reportSummary: reportSummary ?? null,
    reportSummaryPrev: reportSummaryPrev ?? null,
    report: report ?? null,
    meta: meta ?? null,
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
    deptAverages3Months: null,
    periodStart: meta?.periodStart,
    workingDaysInPeriod: meta?.workingDaysInPeriod ?? 0,
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
    periodEnd: meta?.periodEnd,
    workingDaysInPeriod: meta?.workingDaysInPeriod,
    reportSummary: reportSummary ?? null,
    report: report ?? null,
    meta: meta ?? null,
    llmSections,
  });
}

/** Alias for renderMonthlyManagerEmail. data = { report, meta, reportSummary, llmSections }. */
export function renderMonthlyManagementEmail(data) {
  return renderMonthlyManagerEmail(data.report, data.meta, data.reportSummary, data.llmSections);
}
