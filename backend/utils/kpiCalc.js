/**
 * Deterministic KPI calculations for monthly reports.
 * Uses CLS department mapping: sales, operational, management (no management in combined target).
 * Uses Luxon for date handling in Europe/Bucharest.
 */

import { DateTime } from 'luxon';

const TZ = 'Europe/Bucharest';

/**
 * Round to 2 decimal places. Returns null for non-finite input.
 * @param {number} num
 * @returns {number | null}
 */
export function round2(num) {
  if (num == null || typeof num !== 'number' || !Number.isFinite(num)) return null;
  return Math.round(num * 100) / 100;
}

/**
 * Total profit EUR from one row (employee or department aggregate).
 * Sum of ctr_principal + ctr_secondary + livr_principal + livr_secondary. Fallback 0 for missing.
 * @param {object} row - Report row with profit fields
 * @returns {number}
 */
export function totalProfitEur(row) {
  if (!row || typeof row !== 'object') return 0;
  const n = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return (
    n(row.ctr_principalProfitEur) +
    n(row.ctr_secondaryProfitEur) +
    n(row.livr_principalProfitEur) +
    n(row.livr_secondaryProfitEur)
  );
}

/**
 * Realizare target per angajat: (totalProfitEur / target) * 100. Null if target <= 0.
 * @param {object} row - Report row with target and profit fields
 * @returns {number | null}
 */
export function calcTargetAchievementPct(row) {
  if (!row || typeof row !== 'object') return null;
  const target = Number(row.target);
  if (target <= 0 || !Number.isFinite(target)) return null;
  const profit = totalProfitEur(row);
  return round2((profit / target) * 100);
}

/**
 * Count working days (Mon–Fri) in [periodStart, periodEnd] inclusive. Uses Luxon.
 * @param {string} periodStart - ISO date (YYYY-MM-DD or full ISO)
 * @param {string} periodEnd - ISO date
 * @param {string} [timezone='Europe/Bucharest'] - IANA timezone for date parsing
 * @returns {number | null} Working days, or null if invalid / end < start
 */
export function countWorkingDays(periodStart, periodEnd, timezone = 'Europe/Bucharest') {
  if (periodStart == null || periodEnd == null) return null;
  const tz = typeof timezone === 'string' && timezone ? timezone : TZ;
  const startStr = String(periodStart).slice(0, 10);
  const endStr = String(periodEnd).slice(0, 10);
  const start = DateTime.fromISO(startStr, { zone: tz }).startOf('day');
  const end = DateTime.fromISO(endStr, { zone: tz }).startOf('day');
  if (!start.isValid || !end.isValid || end < start) return null;
  let count = 0;
  let cur = start;
  while (cur <= end) {
    if (cur.weekday >= 1 && cur.weekday <= 5) count += 1;
    cur = cur.plus({ days: 1 });
  }
  return count;
}

/**
 * Validate period and working days. Fail fast if invalid.
 * @param {{ periodStart: string, periodEnd: string, workingDaysInPeriod: number }} opts
 * @throws {Error} If periodStart > periodEnd or workingDaysInPeriod <= 0
 */
export function assertValidPeriod({ periodStart, periodEnd, workingDaysInPeriod }) {
  if (periodStart == null || periodEnd == null) {
    throw new Error('periodStart and periodEnd are required');
  }
  const start = String(periodStart).slice(0, 10);
  const end = String(periodEnd).slice(0, 10);
  if (start > end) {
    throw new Error(`periodStart (${start}) must be <= periodEnd (${end})`);
  }
  const wd = workingDaysInPeriod;
  if (typeof wd !== 'number' || !Number.isFinite(wd) || wd <= 0) {
    throw new Error(`workingDaysInPeriod must be a number > 0, got: ${wd}`);
  }
}

/**
 * Realizare target combinat (Sales + Operațional only). Uses departments.sales and departments.operational.
 * Formula: ((salesProfit + opsProfit) / (salesTarget + opsTarget)) * 100
 * @param {{ sales?: { profitTotal?: number, targetTotal?: number }, operational?: { profitTotal?: number, targetTotal?: number } }} departments
 * @returns {number | null} Percentage or null if combined target is 0
 */
export function calcTargetAchievementCombined(departments) {
  if (!departments || typeof departments !== 'object') return null;
  const sales = departments.sales && typeof departments.sales === 'object' ? departments.sales : {};
  const ops = departments.operational && typeof departments.operational === 'object' ? departments.operational : {};
  const salesProfit = typeof sales.profitTotal === 'number' && Number.isFinite(sales.profitTotal) ? sales.profitTotal : 0;
  const opsProfit = typeof ops.profitTotal === 'number' && Number.isFinite(ops.profitTotal) ? ops.profitTotal : 0;
  const salesTarget = typeof sales.targetTotal === 'number' && Number.isFinite(sales.targetTotal) ? sales.targetTotal : 0;
  const opsTarget = typeof ops.targetTotal === 'number' && Number.isFinite(ops.targetTotal) ? ops.targetTotal : 0;
  const totalTarget = salesTarget + opsTarget;
  if (totalTarget === 0) {
    return null;
  }
  return round2(((salesProfit + opsProfit) / totalTarget) * 100);
}

/**
 * Realizare target companie (Sales + Operațional + Management). Official business rule for department email.
 * realizareTargetPct = ((salesProfit + operationalProfit + managementProfit) / (salesTarget + operationalTarget + managementTarget)) * 100
 * @param {{ sales?: { profitTotal?: number, targetTotal?: number }, operational?: { profitTotal?: number, targetTotal?: number }, management?: { profitTotal?: number, targetTotal?: number } }} departments
 * @returns {number | null} Percentage or null if denominator <= 0 or required values missing
 */
export function calcTargetAchievementWithManagement(departments) {
  if (!departments || typeof departments !== 'object') return null;
  const n = (dept, key) => {
    const d = dept && typeof dept === 'object' ? dept : {};
    const v = d[key];
    return typeof v === 'number' && Number.isFinite(v) ? v : 0;
  };
  const salesProfit = n(departments.sales, 'profitTotal');
  const opsProfit = n(departments.operational, 'profitTotal');
  const mgmtProfit = n(departments.management, 'profitTotal');
  const salesTarget = n(departments.sales, 'targetTotal');
  const opsTarget = n(departments.operational, 'targetTotal');
  const mgmtTarget = n(departments.management, 'targetTotal');
  const totalTarget = salesTarget + opsTarget + mgmtTarget;
  if (totalTarget <= 0) return null;
  return round2(((salesProfit + opsProfit + mgmtProfit) / totalTarget) * 100);
}

/**
 * Format realizare target for department email HTML: "XX.XX%" or "N/A". No explanatory text.
 * @param {number | null} pct - from calcTargetAchievementWithManagement
 * @returns {string}
 */
export function formatRealizareTargetForEmail(pct) {
  if (pct == null || typeof pct !== 'number' || !Number.isFinite(pct)) return 'N/A';
  const r = round2(pct);
  return r != null ? `${r}%` : 'N/A';
}

/**
 * Apeluri medii per zi lucrătoare.
 * Returns null if workingDays <= 0 or callsCount is negative/non-numeric.
 * @param {number} callsCount
 * @param {number} workingDaysInPeriod
 * @returns {number | null} Rounded to 2 decimals, or null if invalid
 */
export function calcCallsPerWorkingDay(callsCount, workingDaysInPeriod) {
  if (workingDaysInPeriod == null || typeof workingDaysInPeriod !== 'number' || !Number.isFinite(workingDaysInPeriod) || workingDaysInPeriod <= 0) {
    return null;
  }
  if (callsCount == null || typeof callsCount !== 'number' || !Number.isFinite(callsCount) || callsCount < 0) {
    return null;
  }
  return round2(callsCount / workingDaysInPeriod);
}

/**
 * Conversie prospectare: (calificat / contactat) * 100. Returns 0 when contactat is 0 (no NaN).
 * @param {number} contactat
 * @param {number} calificat
 * @returns {number} 0..100 or 0 when contactat is 0
 */
export function calcProspectingConversion(contactat, calificat) {
  const c = typeof contactat === 'number' && Number.isFinite(contactat) ? contactat : 0;
  const q = typeof calificat === 'number' && Number.isFinite(calificat) ? calificat : 0;
  if (c === 0) return 0;
  return round2((q / c) * 100) ?? 0;
}

/**
 * Conversie prospectare pentru KPI per angajat. Returns null if contactat or calificat negative; 0 when contactat === 0.
 * @param {number} contactat
 * @param {number} calificat
 * @returns {number | null}
 */
export function calcProspectingConversionPct(contactat, calificat) {
  const c = contactat != null && typeof contactat === 'number' && Number.isFinite(contactat) ? contactat : null;
  const q = calificat != null && typeof calificat === 'number' && Number.isFinite(calificat) ? calificat : null;
  if (c === null || q === null) return null;
  if (c < 0 || q < 0) return null;
  if (c === 0) return 0;
  return round2((q / c) * 100);
}

/**
 * Build full KPI object for report. Uses departments.sales + operational; working days from meta.
 * Conversion: prefer employee-level contactat/calificat if provided and usable; else department sales.
 * @param {{ periodStart: string, periodEnd: string, workingDaysInPeriod: number }} meta
 * @param {{ sales?: object, operational?: object }} departments
 * @param {{ contactat?: number, calificat?: number, callsCount?: number } | null} [employee] - Optional employee row for employee-scope conversion/calls
 * @returns {{ periodStart: string, periodEnd: string, workingDaysInPeriod: number, realizareTargetCombinatPct: number | null, apeluriMediiZi: number | null, conversieProspectarePct: number, conversionScope: 'employee' | 'department' }}
 */
export function buildReportKpi(meta, departments, employee = null) {
  assertValidPeriod({
    periodStart: meta?.periodStart,
    periodEnd: meta?.periodEnd,
    workingDaysInPeriod: meta?.workingDaysInPeriod,
  });
  const periodStart = String(meta.periodStart).slice(0, 10);
  const periodEnd = String(meta.periodEnd).slice(0, 10);
  const workingDaysInPeriod = meta.workingDaysInPeriod;

  const realizareTargetCombinatPct = calcTargetAchievementCombined(departments);
  if (realizareTargetCombinatPct === null && departments?.sales && departments?.operational) {
    const st = (departments.sales.targetTotal ?? 0) + (departments.operational?.targetTotal ?? 0);
    if (st === 0) {
      console.error('[kpi] Combined target (sales+operational) is 0; realizareTargetCombinatPct set to null');
    }
  }

  const salesDept = departments?.sales && typeof departments.sales === 'object' ? departments.sales : {};
  let apeluriMediiZi = null;
  let conversieProspectarePct = 0;
  let conversionScope = 'department';

  if (employee && typeof employee === 'object') {
    const empContactat = employee.contactat;
    const empCalificat = employee.calificat;
    const hasEmpConversion = (typeof empContactat === 'number' && Number.isFinite(empContactat)) || (typeof empCalificat === 'number' && Number.isFinite(empCalificat));
    if (hasEmpConversion) {
      conversieProspectarePct = calcProspectingConversion(empContactat ?? 0, empCalificat ?? 0);
      conversionScope = 'employee';
    }
    const empCalls = employee.callsCount;
    if (typeof empCalls === 'number' && Number.isFinite(empCalls)) {
      apeluriMediiZi = calcCallsPerWorkingDay(empCalls, workingDaysInPeriod);
    }
  }
  if (apeluriMediiZi === null) {
    const salesCalls = salesDept.callsCount;
    apeluriMediiZi = calcCallsPerWorkingDay(salesCalls, workingDaysInPeriod);
  }
  if (conversionScope === 'department') {
    conversieProspectarePct = calcProspectingConversion(salesDept.contactat ?? 0, salesDept.calificat ?? 0);
  }

  return {
    periodStart,
    periodEnd,
    workingDaysInPeriod,
    realizareTargetCombinatPct,
    apeluriMediiZi,
    conversieProspectarePct: conversieProspectarePct ?? 0,
    conversionScope,
  };
}
