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
  renderKpiCards,
  parseMarkdownTableToHtml,
} from './monthlyEmailHelpers.js';
import { buildMonthlyEmployeeEmail, buildMonthlyEmployeeEmailHtml as buildEmployeeEmailHtmlFromTemplate } from './templates/monthlyEmployee.js';
import { round2, calcTargetAchievementWithManagement, formatRealizareTargetForEmail } from '../utils/kpiCalc.js';

export { getPersonRow };

const CONTAINER_STYLE = 'font-family:Arial,sans-serif;background:#ffffff;padding:0;margin:0;';
const INNER_TABLE_STYLE = 'width:100%;max-width:680px;margin:0 auto;padding:20px;';
const SECTION_STYLE = 'margin:1em 0 0 0;';
const DASH = '–';

function getDepartmentPrompt() {
  return loadMonthlyDepartmentPrompt();
}

function n(val) {
  return typeof val === 'number' && Number.isFinite(val) ? val : 0;
}

function fmtEur(val) {
  if (val == null || typeof val !== 'number' || !Number.isFinite(val)) return DASH;
  const r = round2(val);
  return r != null ? `${r} EUR` : DASH;
}

/**
 * Build "Rezumat Executiv" section HTML exclusively from backend data (reportSummary, reportSummaryPrev).
 * LLM content for sectiunea_1 is ignored. Used for deterministic department email.
 * @param {{ departments?: { sales?: object, operational?: object, management?: object } }} reportSummary
 * @param {{ departments?: { sales?: object, operational?: object, management?: object } }} [reportSummaryPrev] - optional, for trend
 * @returns {string} HTML fragment (section title + KPI cards)
 */
function buildDeterministicRezumatExecutiv(reportSummary, reportSummaryPrev) {
  const depts = reportSummary?.departments ?? {};
  const sales = depts.sales && typeof depts.sales === 'object' ? depts.sales : {};
  const ops = depts.operational && typeof depts.operational === 'object' ? depts.operational : {};
  const mgmt = depts.management && typeof depts.management === 'object' ? depts.management : {};

  const salesProfit = n(sales.profitTotal);
  const opsProfit = n(ops.profitTotal);
  const mgmtProfit = n(mgmt.profitTotal);
  const totalProfitCompanie = salesProfit + opsProfit + mgmtProfit;
  const salesTarget = n(sales.targetTotal);
  const opsTarget = n(ops.targetTotal);
  const mgmtTarget = n(mgmt.targetTotal);
  const targetDepartamentalCombinat = salesTarget + opsTarget + mgmtTarget;

  const realizareTarget = formatRealizareTargetForEmail(calcTargetAchievementWithManagement(depts));

  const totalCurse =
    n(sales.ctr_principalCount) + n(sales.ctr_secondaryCount) + n(sales.livr_principalCount) + n(sales.livr_secondaryCount) +
    n(ops.ctr_principalCount) + n(ops.ctr_secondaryCount) + n(ops.livr_principalCount) + n(ops.livr_secondaryCount) +
    n(mgmt.ctr_principalCount) + n(mgmt.ctr_secondaryCount) + n(mgmt.livr_principalCount) + n(mgmt.livr_secondaryCount);
  const numarTotalCurse = totalCurse > 0 ? String(totalCurse) : DASH;

  const prev = reportSummaryPrev?.departments ?? {};
  const salesPrev = prev.sales && typeof prev.sales === 'object' ? prev.sales : {};
  const opsPrev = prev.operational && typeof prev.operational === 'object' ? prev.operational : {};
  const salesProfitPrev = n(salesPrev.profitTotal);
  const opsProfitPrev = n(opsPrev.profitTotal);

  function trend(cur, prevVal) {
    if (prevVal == null || prevVal === 0) return cur > 0 ? '+' : '=';
    const pct = round2(((cur - prevVal) / prevVal) * 100);
    if (pct == null) return '=';
    return pct >= 0 ? `+${pct}%` : `${pct}%`;
  }
  function status(profit, target) {
    if (target <= 0) return 'N/A';
    const pct = (profit / target) * 100;
    return pct >= 80 ? 'OK' : 'Sub target';
  }
  function pctDinTarget(profit, target) {
    if (target <= 0) return 'N/A';
    const pct = round2((profit / target) * 100);
    return pct != null ? `${pct}%` : 'N/A';
  }

  const kpiCards = [
    { label: 'Profit total companie', value: fmtEur(totalProfitCompanie) },
    { label: 'Target departamental combinat', value: fmtEur(targetDepartamentalCombinat) },
    { label: 'Realizare target', value: realizareTarget },
    { label: 'Număr total curse', value: numarTotalCurse },
  ];
  const vanzariCards = [
    { label: 'Vânzări – Profit', value: fmtEur(salesProfit) },
    { label: 'Vânzări – % din target', value: pctDinTarget(salesProfit, salesTarget) },
    { label: 'Vânzări – Trend', value: trend(salesProfit, salesProfitPrev) },
    { label: 'Vânzări – Status', value: status(salesProfit, salesTarget) },
  ];
  const opCards = [
    { label: 'Operațional – Profit', value: fmtEur(opsProfit) },
    { label: 'Operațional – % din target', value: pctDinTarget(opsProfit, opsTarget) },
    { label: 'Operațional – Trend', value: trend(opsProfit, opsProfitPrev) },
    { label: 'Operațional – Status', value: status(opsProfit, opsTarget) },
  ];

  const parts = [
    renderSectionTitle('Rezumat Executiv', 2),
    renderKpiCards(kpiCards, 2),
    renderKpiCards(vanzariCards, 2),
    renderKpiCards(opCards, 2),
  ];
  return parts.join('');
}

function objToRows(obj) {
  if (!obj || typeof obj !== 'object') return [];
  return Object.entries(obj).map(([k, v]) => [String(k), v != null ? String(v) : '']);
}

/** Build one department analysis block (Vânzări or Operațional): tables + tabelAngajati (markdown→HTML) + probleme + high/low + problemeSistemice */
function buildDeptAnalysisBlock(section) {
  if (!section || typeof section !== 'object') return '';
  const parts = [];
  parts.push(renderSectionTitle(section.titlu ?? '', 2));
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
 * Subject/title and Rezumat Executiv are built deterministically from code (reportSummary); LLM content for sectiunea_1 is ignored.
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

  const antet = llmSections.antet;
  const subiect = escapeHtml(getMonthlyDepartmentSubject(periodStart));
  const intro = antet?.introducere != null ? formatTextBlock(antet.introducere) : '';

  const rezumatExecutivHtml = buildDeterministicRezumatExecutiv(reportSummary ?? null, reportSummaryPrev ?? null);

  const s2Block = buildDeptAnalysisBlock(llmSections.sectiunea_2_analiza_vanzari);
  const s3Block = buildDeptAnalysisBlock(llmSections.sectiunea_3_analiza_operational);

  const s4 = llmSections.sectiunea_4_comparatie_departamente;
  const comparatieTitle = s4?.titlu != null ? renderSectionTitle(s4.titlu, 2) : renderSectionTitle('Comparație Vânzări vs. Operațional', 2);
  const comparatieTable = buildComparatieTable(s4?.tabelComparativ);
  const observatii = Array.isArray(s4?.observatii) ? s4.observatii : [];
  const observatiiComparatie = observatii.length > 0
    ? '<ul style="' + SECTION_STYLE + '">' + observatii.map((o) => `<li>${escapeHtml(String(o))}</li>`).join('') + '</ul>'
    : '';

  const s5 = llmSections.sectiunea_5_recomandari_management;
  const oneToOne = Array.isArray(s5?.oneToOneLowPerformers) ? s5.oneToOneLowPerformers : [];
  const oneToOneRows = oneToOne.map((r) => [
    (r?.nume ?? '') + (r?.departament != null ? ` (${r.departament})` : ''),
    r?.problemePrincipale ?? '',
  ]);
  const training = Array.isArray(s5?.trainingNecesare) ? s5.trainingNecesare : [];
  const urmarire = Array.isArray(s5?.urmarireSaptamanala) ? s5.urmarireSaptamanala : [];
  const urmarireRows = urmarire.map((r) => [r?.nume ?? '', r?.metricDeUrmarit ?? r?.metric ?? '']);
  const obiective = Array.isArray(s5?.setareObiectiveSpecifice) ? s5.setareObiectiveSpecifice : [];
  const mutari = Array.isArray(s5?.mutariRolOptional) ? s5.mutariRolOptional : [];
  const sistProces = Array.isArray(s5?.problemeSistemiceProces) ? s5.problemeSistemiceProces : [];

  const recomandariParts = [];
  recomandariParts.push(renderSectionTitle(s5?.titlu ?? 'Recomandări Management', 2));
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

  const incheiere = llmSections.incheiere;
  const urmatorulRaport = incheiere?.urmatorulRaport != null ? escapeHtml(String(incheiere.urmatorulRaport)) : '';
  const semn = incheiere?.semnatura;
  const semnaturaHtml =
    semn && typeof semn === 'object'
      ? `<p style="margin:1em 0 0 0;">${escapeHtml(String(semn.functie ?? ''))}<br/>${escapeHtml(String(semn.companie ?? ''))}</p>`
      : '';

  const bodyInner =
    (intro ? `<div style="margin:0 0 16px 0;">${intro}</div>` : '') +
    renderHr() +
    rezumatExecutivHtml +
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
 * Subject is always from code (getMonthlyDepartmentSubject). Rezumat Executiv is built from reportSummary (deterministic).
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
