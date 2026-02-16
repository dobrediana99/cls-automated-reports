/**
 * Weekly employee email template: full 2-column (label | value) HTML table.
 * Gmail-compatible: tables, inline styles, no external CSS.
 * Department-based filtering: OPERATIONS see only operational metrics (no sales-specific).
 */

const safeVal = (v) => (typeof v === 'number' && !isNaN(v) ? v : 0);
const fmt = (n) => (typeof n === 'number' && !isNaN(n) ? n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0.00');
const fmtInt = (n) => (typeof n === 'number' && !isNaN(n) ? String(Math.round(n)) : '0');
const fmtPct = (n) => (typeof n === 'number' && !isNaN(n) ? n.toFixed(1) + '%' : '—');

const TABLE_STYLE = 'border-collapse: collapse; width: 100%; max-width: 560px; font-family: Arial, sans-serif; font-size: 13px;';
const TH_STYLE = 'padding: 8px 10px; text-align: left; border: 1px solid #ccc; background: #f2f2f2; font-weight: bold; white-space: nowrap;';
const TD_LABEL_STYLE = 'padding: 8px 10px; border: 1px solid #ccc; background: #fafafa; white-space: nowrap; font-weight: 500;';
const TD_VALUE_STYLE = 'padding: 8px 10px; border: 1px solid #ccc;';

/** Department values (must match backend/config/org.js DEPARTMENTS). */
export const DEPARTMENT_OPERATIONS = 'Operatiuni';
export const DEPARTMENT_MANAGEMENT = 'Management';
export const DEPARTMENT_SALES = 'Vanzari';

/**
 * Metric keys excluded for OPERAȚIUNI and MANAGEMENT (whitelist approach: SALES sees all; OPS/MGMT see all except these).
 * These metrics are neither calculated nor displayed for Operatiuni and Management.
 */
export const EXCLUDED_KEYS_NON_SALES = new Set([
  'contactat',      // Contactat
  'calificat',     // Calificat
  'rata_conv',     // Rata conversie
  'callsCount',    // Apeluri
]);

/** Departments that use EXCLUDED_KEYS_NON_SALES (no contactat/calificat/rate/emails/calls). */
const DEPARTMENTS_EXCLUDE_SALES_METRICS = new Set([DEPARTMENT_OPERATIONS, DEPARTMENT_MANAGEMENT]);

/**
 * Ordered list of stats rows: [key, label, getter, formatter].
 * Key is used for department-based filtering.
 */
function getOrderedRows(stats) {
  if (!stats || typeof stats !== 'object') return [];

  const v = (key) => safeVal(stats[key]);
  const countClientTerms = v('countClientTerms');
  const countSupplierTerms = v('countSupplierTerms');
  const countProfitability = v('countProfitability');
  const termenMediuClient = countClientTerms > 0 ? (v('sumClientTerms') / countClientTerms) : null;
  const termenMediuFurnizor = countSupplierTerms > 0 ? (v('sumSupplierTerms') / countSupplierTerms) : null;
  const avgProfitability = countProfitability > 0 ? (v('sumProfitability') / countProfitability) : null;
  const totalLivrCount = v('livr_principalCount') + v('livr_secondaryCount');
  const totalLivrProfit = v('livr_principalProfitEur') + v('livr_secondaryProfitEur');
  const target = v('target');
  const profitPesteTarget = totalLivrProfit - target;
  const solicitari = v('solicitariCount');
  const websiteCount = v('websiteCount');
  const convWeb = solicitari > 0 ? ((websiteCount / solicitari) * 100) : (websiteCount > 0 ? 100 : null);

  // Rata conversie: computed lazily in getter so it is not run for departments that exclude it (OPS/MGMT).
  const getRataConv = (st) => {
    const c = safeVal(st?.contactat);
    const q = safeVal(st?.calificat);
    return (c + q) > 0 ? ((q / (c + q)) * 100) : null;
  };

  const rows = [
    ['contactat', 'Contactați', () => stats.contactat, fmtInt],
    ['calificat', 'Calificați', () => stats.calificat, fmtInt],
    ['rata_conv', 'Rata conversie clienți (%)', getRataConv, (x) => (x != null ? fmtPct(x) : '—')],
    ['callsCount', 'Apeluri', () => stats.callsCount, fmtInt],
    ['suppliersAdded', 'Furnizori adăugați', () => stats.suppliersAdded, fmtInt],
    ['livr_principalCount', 'Curse livrare principal', () => stats.livr_principalCount, fmtInt],
    ['livr_principalProfitEur', 'Profit livrare principal (EUR)', () => stats.livr_principalProfitEur, fmt],
    ['livr_secondaryCount', 'Curse livrare secundar', () => stats.livr_secondaryCount, fmtInt],
    ['livr_secondaryProfitEur', 'Profit livrare secundar (EUR)', () => stats.livr_secondaryProfitEur, fmt],
    ['totalLivrCount', 'Total curse după livrare', () => totalLivrCount, fmtInt],
    ['totalLivrProfit', 'Total profit după livrare (EUR)', () => totalLivrProfit, fmt],
    ['target', 'Target total (EUR)', () => stats.target, fmt],
    ['profitPesteTarget', 'Profit peste target (EUR)', () => profitPesteTarget, fmt],
    ['avgProfitability', 'Profitability (%)', () => avgProfitability, (x) => (x != null ? fmtPct(x) : '—')],
    ['websiteCount', 'Curse web principal', () => stats.websiteCount, fmtInt],
    ['websiteProfit', 'Profit web principal (EUR)', () => stats.websiteProfit, fmt],
    ['websiteCountSec', 'Curse web secundar', () => stats.websiteCountSec, fmtInt],
    ['websiteProfitSec', 'Profit web secundar (EUR)', () => stats.websiteProfitSec, fmt],
    ['burseCount', 'Curse burse', () => stats.burseCount, fmtInt],
    ['solicitariCount', 'Solicitări web', () => stats.solicitariCount, fmtInt],
    ['convWeb', 'Conversie web (%)', () => convWeb, (x) => (x != null ? fmtPct(x) : '—')],
    ['termenMediuClient', 'Termen mediu client (zile)', () => termenMediuClient, (x) => (x != null ? fmt(x) : '—')],
    ['termenMediuFurnizor', 'Termen mediu furnizor (zile)', () => termenMediuFurnizor, (x) => (x != null ? fmt(x) : '—')],
    ['overdueInvoicesCount', 'Întârzieri > 15 zile', () => stats.overdueInvoicesCount, fmtInt],
    ['supplierTermsUnder30', 'Furnizori < 30 zile', () => stats.supplierTermsUnder30, fmtInt],
    ['supplierTermsOver30', 'Furnizori >= 30 zile', () => stats.supplierTermsOver30, fmtInt],
  ];

  return rows;
}

/** Filter rows by department: OPS and MANAGEMENT exclude sales metrics; SALES sees all. */
function getOrderedRowsForDepartment(stats, department) {
  const rows = getOrderedRows(stats);
  if (!department || !DEPARTMENTS_EXCLUDE_SALES_METRICS.has(department)) return rows;
  return rows.filter(([key]) => !EXCLUDED_KEYS_NON_SALES.has(key));
}

const EXPLICIT_KEYS = new Set([
  'contactat', 'calificat', 'emailsCount', 'callsCount', 'suppliersAdded',
  'ctr_principalCount', 'ctr_principalProfitEur', 'ctr_secondaryCount', 'ctr_secondaryProfitEur',
  'livr_principalCount', 'livr_principalProfitEur', 'livr_secondaryCount', 'livr_secondaryProfitEur',
  'websiteCount', 'websiteProfit', 'websiteCountSec', 'websiteProfitSec',
  'burseCount', 'solicitariCount',
  'sumClientTerms', 'countClientTerms', 'sumSupplierTerms', 'countSupplierTerms',
  'overdueInvoicesCount', 'supplierTermsUnder30', 'supplierTermsOver30',
  'sumProfitability', 'countProfitability',
  'target', 'id', 'name', 'mondayId', 'profitRonRaw',
]);

function titleCase(str) {
  if (!str || typeof str !== 'string') return str;
  return str.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase()).trim();
}

/**
 * Build only the 2-column table HTML for one employee's stats, filtered by department.
 * @param {object} stats - One row from opsStats/salesStats/mgmtStats
 * @param {string} [department] - Department from ORG (e.g. 'Operatiuni', 'Vanzari', 'Management'). Operations see only operational metrics.
 * @returns {string} HTML <table>...</table>
 */
export function buildEmployeeDetailsTable(stats, department) {
  const rows = getOrderedRowsForDepartment(stats, department);
  let html = `<table style="${TABLE_STYLE}">
  <thead>
    <tr>
      <th style="${TH_STYLE}">Metrică</th>
      <th style="${TH_STYLE}">Valoare</th>
    </tr>
  </thead>
  <tbody>
`;
  for (const [, label, getter, formatter] of rows) {
    const raw = typeof getter === 'function' ? getter(stats) : stats[getter];
    const value = formatter ? formatter(raw) : (raw === null || raw === undefined ? '—' : String(raw));
    html += `    <tr><td style="${TD_LABEL_STYLE}">${escapeHtml(String(label))}</td><td style="${TD_VALUE_STYLE}">${escapeHtml(String(value))}</td></tr>\n`;
  }

  // Extra keys from stats: only for non-Operations (Operations has strict allow-list)
  if (stats && typeof stats === 'object' && department !== DEPARTMENT_OPERATIONS) {
    for (const key of Object.keys(stats)) {
      if (EXPLICIT_KEYS.has(key)) continue;
      const val = stats[key];
      const label = titleCase(key);
      const value = val === null || val === undefined ? '—' : (typeof val === 'number' ? (Number.isInteger(val) ? fmtInt(val) : fmt(val)) : String(val));
      html += `    <tr><td style="${TD_LABEL_STYLE}">${escapeHtml(label)}</td><td style="${TD_VALUE_STYLE}">${escapeHtml(value)}</td></tr>\n`;
    }
  }

  html += '  </tbody>\n</table>';
  return html;
}

export function escapeHtml(s) {
  if (typeof s !== 'string') return '';
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Build full HTML body for weekly email: intro (standardized text) + table or no-data message.
 * @param {object} opts - { introHtml, stats, noDataMessage?, pageTitle?, department? }
 * @param {string} opts.introHtml - Standardized intro paragraphs (from getWeeklyIntroHtml).
 * @param {object} opts.stats - One row from opsStats/salesStats/mgmtStats (can be null)
 * @param {string} [opts.department] - Department from ORG; used to filter metrics (Operations see only operational).
 * @param {string} [opts.noDataMessage] - When stats is null, use this instead of default message (e.g. for manager)
 * @param {string} [opts.pageTitle] - Optional title for <title> (default: Raport săptămânal)
 * @returns {string} Full HTML document
 */
export function buildWeeklyEmployeeEmailHtml({ introHtml, stats, department, noDataMessage, pageTitle = 'Raport săptămânal' }) {
  const defaultNoData = 'Nu există date pentru această perioadă.';
  const tableHtml = stats ? buildEmployeeDetailsTable(stats, department) : `<p style="margin: 1em 0 0 0;">${escapeHtml(noDataMessage || defaultNoData)}</p>`;

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>${escapeHtml(pageTitle)}</title></head>
<body style="font-family: Arial, sans-serif; font-size: 14px; max-width: 600px; margin: 0 auto; padding: 16px;">
  ${introHtml}
  ${tableHtml}
</body>
</html>`;
}
