import fs from 'fs';
import path from 'path';
import nodemailer from 'nodemailer';
import { writeDryRunFile } from './dryRun.js';
import { getOutDir, ensureOutDir } from '../utils/outDir.js';
import { getMonthlyPeriods, loadOrComputeMonthlyReport } from '../report/runMonthlyPeriods.js';
import { buildMonthlySnapshot } from '../report/buildMonthlySnapshot.js';
import {
  readMonthlySnapshotFromGCS,
  writeMonthlySnapshotToGCS,
  writeMonthlyRunManifestToGCS,
} from '../store/monthlySnapshots.js';
import {
  loadMonthlyRunState,
  saveMonthlyRunState,
  createInitialState,
  markCollectOk,
  markDepartmentLlmOk,
  markDepartmentLlmFailed,
  markEmployeeLlmOk,
  markEmployeeLlmFailed,
  ensureEmployeeEntry,
} from '../store/monthlyRunState.js';
import { buildMonthlyEmployeeEmail, getPersonRow, buildMonthlyDepartmentEmail } from '../email/monthly.js';
import { resolveRecipients, resolveSubject, logSendRecipients, resolveGmailUser } from '../email/sender.js';
import { sendWithRetry } from '../email/sendWithRetry.js';
import { buildMonthlyXlsx } from '../export/xlsx.js';
import { requireOpenRouter, generateMonthlySections, generateMonthlyDepartmentSections } from '../llm/openrouterClient.js';
import { loadMonthlyEmployeePrompt, loadMonthlyDepartmentPrompt } from '../prompts/loadPrompts.js';
import { buildDepartmentAnalytics, validateDepartmentAnalytics } from '../report/departmentAnalytics.js';
import {
  buildReportKpi,
  countWorkingDays,
  round2,
  calcTargetAchievementPct,
  totalProfitCtr,
  calcTargetAchievementPctCtr,
  calcCallsPerWorkingDay,
  calcProspectingConversionPct,
} from '../utils/kpiCalc.js';
import { ORG, MANAGERS, DEPARTMENTS } from '../config/org.js';
import { validateMonthlyRuntimeConfig } from '../config/validateRuntimeConfig.js';
import { sanitizeEmailForFilename } from '../utils/sanitizeEmailForFilename.js';

function safeNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function resolveMonthlySendScope(raw = process.env.MONTHLY_SEND_SCOPE) {
  const normalized = String(raw ?? '').trim().toLowerCase();
  if (!normalized || normalized === 'all') return 'all';
  if (normalized === 'department_only' || normalized === 'department-only' || normalized === 'department') {
    return 'department_only';
  }
  throw new Error('MONTHLY_SEND_SCOPE must be "all" or "department_only".');
}

export function resolveMonthlyRunSlot(raw = process.env.MONTHLY_RUN_SLOT) {
  const normalized = String(raw ?? '').trim();
  if (!normalized) return null;
  if (!/^\d{1,2}$/.test(normalized)) {
    throw new Error('MONTHLY_RUN_SLOT must be a day of month 1..31 (example: "05" or "15").');
  }
  const n = Number(normalized);
  if (!Number.isInteger(n) || n < 1 || n > 31) {
    throw new Error('MONTHLY_RUN_SLOT must be a day of month 1..31 (example: "05" or "15").');
  }
  return String(n).padStart(2, '0');
}

export function applyMonthlyRunSlotToLabel(label, runSlot) {
  const base = String(label ?? '').trim();
  if (!runSlot) return base;
  return `${base}__slot_${runSlot}`;
}

function sumProfitAllEur(row) {
  if (!row || typeof row !== 'object') return 0;
  return (
    safeNumber(row.ctr_principalProfitEur) +
    safeNumber(row.ctr_secondaryProfitEur) +
    safeNumber(row.livr_principalProfitEur) +
    safeNumber(row.livr_secondaryProfitEur)
  );
}

/**
 * Individual monthly emails must use delivery-date-based KPIs.
 * We keep department aggregates unchanged and remap only employee rows used
 * in the individual flow.
 */
function toMonthlyEmployeeDeliveryRow(row) {
  if (!row || typeof row !== 'object') return row ?? null;
  const livrBurseCount =
    safeNumber(row.livr_burseCount) ||
    (safeNumber(row.burseCountLivrPrincipal) + safeNumber(row.burseCountLivrSecondary));
  return {
    ...row,
    // Keep existing KPI helpers (CTR-based formulas) but feed them livrare values.
    ctr_principalCount: safeNumber(row.livr_principalCount),
    ctr_secondaryCount: safeNumber(row.livr_secondaryCount),
    ctr_principalProfitEur: safeNumber(row.livr_principalProfitEur),
    ctr_secondaryProfitEur: safeNumber(row.livr_secondaryProfitEur),
    sumProfitability: safeNumber(row.livr_sumProfitability),
    countProfitability: safeNumber(row.livr_countProfitability),
    websiteCount: safeNumber(row.livr_websiteCount),
    websiteProfit: safeNumber(row.livr_websiteProfit),
    websiteCountSec: safeNumber(row.livr_websiteCountSec),
    websiteProfitSec: safeNumber(row.livr_websiteProfitSec),
    burseCount: livrBurseCount,
    sumClientTerms: safeNumber(row.livr_sumClientTerms),
    countClientTerms: safeNumber(row.livr_countClientTerms),
    sumSupplierTerms: safeNumber(row.livr_sumSupplierTerms),
    countSupplierTerms: safeNumber(row.livr_countSupplierTerms),
    overdueInvoicesCount: safeNumber(row.livr_overdueInvoicesCount),
    supplierTermsUnder30: safeNumber(row.livr_supplierTermsUnder30),
    supplierTermsOver30: safeNumber(row.livr_supplierTermsOver30),
  };
}

/**
 * Build department averages per active employee for employee-monthly LLM input.
 * This avoids confusing totals with "media departamentului" in narrative sections.
 */
function computeDepartmentEmployeeAverages(rows, workingDaysInPeriod) {
  const list = Array.isArray(rows) ? rows : [];
  if (list.length === 0) {
    return {
      totalEmployees: 0,
      activeEmployees: 0,
      avgProfitCtrEur: null,
      avgTargetEur: null,
      avgTripsCtr: null,
      avgCallsCount: null,
      avgContactat: null,
      avgCalificat: null,
      avgCallsPerWorkingDay: null,
      avgConversieProspectarePct: null,
      avgTargetAchievementPct: null,
    };
  }

  const enriched = list.map((row) => {
    const tripsCtr = safeNumber(row?.ctr_principalCount) + safeNumber(row?.ctr_secondaryCount);
    const profitCtr = safeNumber(row?.ctr_principalProfitEur) + safeNumber(row?.ctr_secondaryProfitEur);
    const profitAll = sumProfitAllEur(row);
    const active = tripsCtr > 0 || profitAll !== 0;
    return { row, tripsCtr, profitCtr, active };
  });

  const activeEntries = enriched.filter((e) => e.active);
  const usedEntries = activeEntries.length > 0 ? activeEntries : enriched;
  const denominator = usedEntries.length;

  const sums = usedEntries.reduce(
    (acc, e) => {
      acc.tripsCtr += e.tripsCtr;
      acc.profitCtr += e.profitCtr;
      acc.target += safeNumber(e.row?.target);
      acc.calls += safeNumber(e.row?.callsCount);
      acc.contactat += safeNumber(e.row?.contactat);
      acc.calificat += safeNumber(e.row?.calificat);
      return acc;
    },
    { tripsCtr: 0, profitCtr: 0, target: 0, calls: 0, contactat: 0, calificat: 0 },
  );

  const avgProfitCtrEurRaw = sums.profitCtr / denominator;
  const avgTargetEurRaw = sums.target / denominator;
  const avgCallsCountRaw = sums.calls / denominator;
  const avgContactatRaw = sums.contactat / denominator;
  const avgCalificatRaw = sums.calificat / denominator;

  return {
    totalEmployees: list.length,
    activeEmployees: activeEntries.length,
    avgProfitCtrEur: round2(avgProfitCtrEurRaw),
    avgTargetEur: round2(avgTargetEurRaw),
    avgTripsCtr: round2(sums.tripsCtr / denominator),
    avgCallsCount: round2(avgCallsCountRaw),
    avgContactat: round2(avgContactatRaw),
    avgCalificat: round2(avgCalificatRaw),
    avgCallsPerWorkingDay: calcCallsPerWorkingDay(avgCallsCountRaw, workingDaysInPeriod),
    avgConversieProspectarePct: calcProspectingConversionPct(avgContactatRaw, avgCalificatRaw),
    avgTargetAchievementPct:
      avgTargetEurRaw > 0 ? round2((avgProfitCtrEurRaw / avgTargetEurRaw) * 100) : null,
  };
}

/**
 * Build the "calculated" KPI object for LLM input (employee + department current/prev).
 * Department values should represent averages per employee (not totals).
 */
function buildEmployeeInputCalculated(data3Months, deptAverages3Months, workingDaysInPeriod, periodStart, periodEnd) {
  const cur = data3Months?.current;
  const prev = data3Months?.prev;
  const deptCur = deptAverages3Months?.current;
  const deptPrev = deptAverages3Months?.prev;

  const empCur = {
    profitTotalEur: round2(totalProfitCtr(cur)),
    realizareTargetPct: calcTargetAchievementPctCtr(cur),
    apeluriMediiZiLucratoare: calcCallsPerWorkingDay(cur?.callsCount, workingDaysInPeriod),
    conversieProspectarePct: calcProspectingConversionPct(cur?.contactat, cur?.calificat),
    callsCount: cur?.callsCount ?? null,
    contactat: cur?.contactat ?? null,
    calificat: cur?.calificat ?? null,
    target: cur?.target ?? null,
  };
  const empPrev = {
    profitTotalEur: round2(totalProfitCtr(prev)),
    realizareTargetPct: calcTargetAchievementPctCtr(prev),
    apeluriMediiZiLucratoare: calcCallsPerWorkingDay(prev?.callsCount, workingDaysInPeriod),
    conversieProspectarePct: calcProspectingConversionPct(prev?.contactat, prev?.calificat),
    callsCount: prev?.callsCount ?? null,
    contactat: prev?.contactat ?? null,
    calificat: prev?.calificat ?? null,
    target: prev?.target ?? null,
  };

  const asNumberOrNull = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const deptProfitCur = asNumberOrNull(deptCur?.avgProfitCtrEur ?? deptCur?.profitTotal);
  const deptTargetCur = asNumberOrNull(deptCur?.avgTargetEur ?? deptCur?.targetTotal);
  const deptProfitPrev = asNumberOrNull(deptPrev?.avgProfitCtrEur ?? deptPrev?.profitTotal);
  const deptTargetPrev = asNumberOrNull(deptPrev?.avgTargetEur ?? deptPrev?.targetTotal);
  const deptCallsCur = asNumberOrNull(deptCur?.avgCallsCount ?? deptCur?.callsCount);
  const deptCallsPrev = asNumberOrNull(deptPrev?.avgCallsCount ?? deptPrev?.callsCount);
  const deptContactCur = asNumberOrNull(deptCur?.avgContactat ?? deptCur?.contactat);
  const deptContactPrev = asNumberOrNull(deptPrev?.avgContactat ?? deptPrev?.contactat);
  const deptCalifCur = asNumberOrNull(deptCur?.avgCalificat ?? deptCur?.calificat);
  const deptCalifPrev = asNumberOrNull(deptPrev?.avgCalificat ?? deptPrev?.calificat);

  return {
    period: { periodStart, periodEnd, workingDaysInPeriod },
    employee: { current: empCur, prev: empPrev },
    department: {
      current: {
        // Legacy key kept for compatibility; value represents average per employee.
        profitTotalEur: deptProfitCur != null ? round2(deptProfitCur) : null,
        profitMediuPerAngajatEur: deptProfitCur != null ? round2(deptProfitCur) : null,
        realizareTargetPct:
          asNumberOrNull(deptCur?.avgTargetAchievementPct) ??
          (deptTargetCur != null && deptTargetCur > 0 && deptProfitCur != null
            ? round2((deptProfitCur / deptTargetCur) * 100)
            : null),
        apeluriMediiZiLucratoare:
          asNumberOrNull(deptCur?.avgCallsPerWorkingDay) ??
          (deptCallsCur != null
            ? calcCallsPerWorkingDay(deptCallsCur, workingDaysInPeriod)
            : null),
        conversieProspectarePct:
          asNumberOrNull(deptCur?.avgConversieProspectarePct) ??
          (deptContactCur != null && deptCalifCur != null
            ? calcProspectingConversionPct(deptContactCur, deptCalifCur)
            : null),
        activeEmployees: asNumberOrNull(deptCur?.activeEmployees),
      },
      prev: {
        // Legacy key kept for compatibility; value represents average per employee.
        profitTotalEur: deptProfitPrev != null ? round2(deptProfitPrev) : null,
        profitMediuPerAngajatEur: deptProfitPrev != null ? round2(deptProfitPrev) : null,
        realizareTargetPct:
          asNumberOrNull(deptPrev?.avgTargetAchievementPct) ??
          (deptTargetPrev != null && deptTargetPrev > 0 && deptProfitPrev != null
            ? round2((deptProfitPrev / deptTargetPrev) * 100)
            : null),
        apeluriMediiZiLucratoare:
          asNumberOrNull(deptPrev?.avgCallsPerWorkingDay) ??
          (deptCallsPrev != null
            ? calcCallsPerWorkingDay(deptCallsPrev, workingDaysInPeriod)
            : null),
        conversieProspectarePct:
          asNumberOrNull(deptPrev?.avgConversieProspectarePct) ??
          (deptContactPrev != null && deptCalifPrev != null
            ? calcProspectingConversionPct(deptContactPrev, deptCalifPrev)
            : null),
        activeEmployees: asNumberOrNull(deptPrev?.activeEmployees),
      },
    },
  };
}

// Behavior A: Snapshots are persisted before email send. If email env is missing or send fails,
// the job exits with code 1 but computed checkpoints remain in GCS so reruns skip heavy Monday queries.

const JOB_TYPE = 'monthly';
const TIMEZONE = 'Europe/Bucharest';
const MONTHLY_DEPARTMENT_EXTRA_RECIPIENTS = [
  'beatrice.s@crystal-logistics-services.com',
  'narcisa.g@crystal-logistics-services.com',
  'ana-maria.t@crystal-logistics-services.com',
  'bianca.o@crystal-logistics-services.com',
];

function dedupeEmails(emails) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(emails) ? emails : []) {
    const email = typeof raw === 'string' ? raw.trim() : '';
    if (!email) continue;
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(email);
  }
  return out;
}

function departmentToSummaryKey(department) {
  if (department === DEPARTMENTS.OPERATIONS) return 'operational';
  if (department === DEPARTMENTS.SALES) return 'sales';
  if (department === DEPARTMENTS.MANAGEMENT) return 'management';
  return 'operational';
}

function getDeptHeadcount(report, deptKey) {
  if (!report || typeof report !== 'object') return null;
  if (deptKey === 'operational') {
    const n = report?.opsStats?.length;
    return typeof n === 'number' && n >= 0 ? n : null;
  }
  if (deptKey === 'sales') {
    const n = report?.salesStats?.length;
    return typeof n === 'number' && n >= 0 ? n : null;
  }
  if (deptKey === 'management') {
    const n = report?.mgmtStats?.length;
    return typeof n === 'number' && n >= 0 ? n : null;
  }
  return null;
}

/**
 * Runs the monthly job.
 * Uses cache in out/cache/monthly/<YYYY-MM>.json; refresh forces recompute for all 3 months.
 * Snapshots persist even if email fails (behavior A); job exits non-zero for alerting.
 * DRY_RUN=1: writes JSON + one HTML per person + department HTML + XLSX to ./out/.
 * Otherwise: sends personal monthly email to each active person; sends one department email to each manager (with XLSX attachment).
 * Idempotency is enforced by the route (runJobWithIdempotency); mark sent only after all emails sent.
 * @param {{ now?: Date, refresh?: boolean }} [opts] - now defaults to new Date(); refresh=true ignores cache
 * @returns {Promise<{ payload: object, dryRunPath?: string }>}
 */
export async function runMonthly(opts = {}) {
  const sendScope = resolveMonthlySendScope(opts.sendScope ?? process.env.MONTHLY_SEND_SCOPE);
  const runSlot = resolveMonthlyRunSlot(opts.runSlot ?? process.env.MONTHLY_RUN_SLOT);
  const departmentOnly = sendScope === 'department_only';

  console.log('[MONTHLY] START', {
    service: process.env.K_SERVICE || null,
    revision: process.env.K_REVISION || null,
    region: process.env.K_REGION || null,
    hasOpenRouterKey: Boolean(process.env.OPENROUTER_API_KEY),
    openRouterModel: process.env.OPENROUTER_MODEL || 'DEFAULT',
    hasMondayToken: Boolean(process.env.MONDAY_API_TOKEN),
    dryRun: process.env.DRY_RUN || null,
    sendMode: process.env.SEND_MODE || null,
    sendScope,
    runSlot,
    timestamp: new Date().toISOString(),
  });

  const now = opts.now ?? new Date();
  const refresh = opts.refresh === true || opts.refresh === 1;
  const dryRun = process.env.DRY_RUN === '1';
  const sendMode = process.env.SEND_MODE === 'prod' ? 'prod' : 'test';

  validateMonthlyRuntimeConfig({ dryRun, sendMode });

  if (refresh && process.env.NODE_ENV !== 'production') {
    console.log('[monthly] refresh=1 -> regenerating all 3 snapshots');
  }

  const periods = getMonthlyPeriods({ baseDate: now });
  let result0;
  let result1;
  let result2;
  let runLabelForManifest = null;

  if (process.env.SNAPSHOT_BUCKET) {
    const results = [];
    const perMonth = {};
    for (const period of periods) {
      let snapshot = !refresh ? await readMonthlySnapshotFromGCS(period.yyyyMm) : null;
      if (!snapshot) {
        snapshot = await buildMonthlySnapshot({
          month: period.yyyyMm,
          startDate: period.start,
          endDate: period.end,
          refresh,
        });
        await writeMonthlySnapshotToGCS(period.yyyyMm, snapshot);
        perMonth[period.yyyyMm] = { source: 'computed', wrote: true };
      } else {
        perMonth[period.yyyyMm] = { source: 'hit', wrote: false };
      }
      results.push({
        meta: snapshot.derived.meta,
        reportSummary: snapshot.derived.reportSummary,
        report: snapshot.derived.report,
      });
    }
    result0 = results[0];
    result1 = results[1];
    result2 = results[2];
    runLabelForManifest = applyMonthlyRunSlotToLabel(results[0]?.meta?.label ?? periods[0].label, runSlot);
    await writeMonthlyRunManifestToGCS({
      jobType: JOB_TYPE,
      label: runLabelForManifest,
      months: periods.map((p) => p.yyyyMm),
      perMonth,
    });
  } else {
    result0 = await loadOrComputeMonthlyReport({ period: periods[0], refresh });
    result1 = await loadOrComputeMonthlyReport({ period: periods[1], refresh });
    result2 = await loadOrComputeMonthlyReport({ period: periods[2], refresh });
  }

  const reports = [result0.report, result1.report, result2.report];
  const metas = [result0.meta, result1.meta, result2.meta];
  const reportSummaries = [result0.reportSummary, result1.reportSummary, result2.reportSummary];

  const periodStart = metas[0].periodStart;
  const periodEnd = metas[0].periodEnd;
  const workingDaysInPeriod = countWorkingDays(periodStart, periodEnd);
  if (workingDaysInPeriod == null || workingDaysInPeriod <= 0) {
    throw new Error(`[MONTHLY] Invalid workingDaysInPeriod for ${periodStart}..${periodEnd}`);
  }

  const runAt = new Date().toISOString();
  const meta0 = {
    jobType: JOB_TYPE,
    periodStart: metas[0].periodStart,
    periodEnd: metas[0].periodEnd,
    label: metas[0].label,
    timezone: TIMEZONE,
    runAt,
  };
  const payload = { meta: meta0, reportSummary: result0.reportSummary };
  const label = metas[0].label;
  const runStateLabel = applyMonthlyRunSlotToLabel(label, runSlot);

  const xlsxBuffer = await buildMonthlyXlsx(reports[0], metas[0]);
  const xlsxFilename = `Raport_lunar_${metas[0].periodStart.slice(0, 7)}.xlsx`;

  requireOpenRouter();
  const employeePrompt = loadMonthlyEmployeePrompt();
  const departmentPrompt = loadMonthlyDepartmentPrompt();

  const activePeople = ORG.filter((p) => p.isActive);

  // Department analytics and LLM payload use ONLY 2 months (current + prev1). No prev2.
  const departmentPeriods = {
    current: {
      summary: reportSummaries[0],
      rows: {
        operational: reports[0]?.opsStats ?? [],
        sales: reports[0]?.salesStats ?? [],
      },
    },
    prev1: {
      summary: reportSummaries[1],
      rows: {
        operational: reports[1]?.opsStats ?? [],
        sales: reports[1]?.salesStats ?? [],
      },
    },
  };

  const departmentAnalytics = buildDepartmentAnalytics({
    current: departmentPeriods.current,
    prev1: departmentPeriods.prev1,
    periodStart: metas[0].periodStart,
  });

  const departmentAveragesByMonth = [
    {
      operational: computeDepartmentEmployeeAverages(reports[0]?.opsStats ?? [], workingDaysInPeriod),
      sales: computeDepartmentEmployeeAverages(reports[0]?.salesStats ?? [], workingDaysInPeriod),
      management: computeDepartmentEmployeeAverages(reports[0]?.mgmtStats ?? [], workingDaysInPeriod),
    },
    {
      operational: computeDepartmentEmployeeAverages(reports[1]?.opsStats ?? [], workingDaysInPeriod),
      sales: computeDepartmentEmployeeAverages(reports[1]?.salesStats ?? [], workingDaysInPeriod),
      management: computeDepartmentEmployeeAverages(reports[1]?.mgmtStats ?? [], workingDaysInPeriod),
    },
  ];

  const validation = validateDepartmentAnalytics(departmentAnalytics);
  if (!validation.ok) {
    console.warn('[monthly] validateDepartmentAnalytics errors', validation.errors);
  }
  if (validation.warnings && validation.warnings.length > 0) {
    console.warn('[monthly] validateDepartmentAnalytics warnings', validation.warnings);
  }

  // Sanity check pentru burse (companie vs Operațional per angajat).
  try {
    const companyCtrBurse = reportSummaries[0]?.company?.ctr?.burseCount ?? 0;
    const companyLivrBurse = reportSummaries[0]?.company?.livr?.burseCount ?? 0;
    const deptOpsBurse = reportSummaries[0]?.departments?.operational?.burseCount ?? 0;
    const opsHeadcount = departmentAnalytics.operational?.headcount?.totalEmployees ?? 0;
    const opsActive = departmentAnalytics.operational?.headcount?.activeEmployees ?? 0;
    const opsZeroBurseCount =
      departmentAnalytics.operational?.employeeIssues?.filter(
        (e) => e.active && e.kpis && e.kpis.burseCount === 0,
      ).length ?? 0;
    console.log('[monthly] burse sanity', {
      companyCtrBurse,
      companyLivrBurse,
      deptOpsBurse,
      opsHeadcount,
      opsActive,
      opsZeroBurseCount,
    });
  } catch (e) {
    console.warn('[monthly] burse sanity logging failed', e);
  }

  const departmentInputJson = {
    periodStart,
    periodEnd,
    workingDaysInPeriod,
    analytics: departmentAnalytics,
    rawSummaries: {
      current: reportSummaries[0],
      prev1: reportSummaries[1],
    },
  };

  /** performancePct = (totalProfitCtr / target) * 100 for check-in rule; null if unknown. Email KPI = DOAR CTR. */
  function getPerformancePct(monthData) {
    if (!monthData || typeof monthData !== 'object') return null;
    const target = Number(monthData.target);
    if (!target || target <= 0) return null;
    const totalProfitCtr =
      Number(monthData.ctr_principalProfitEur ?? 0) + Number(monthData.ctr_secondaryProfitEur ?? 0);
    return (totalProfitCtr / target) * 100;
  }

  if (process.env.DRY_RUN === '1') {
    const outDir = getOutDir({ dryRun: true });
    ensureOutDir(outDir);
    if (!departmentOnly) {
      for (const person of activePeople) {
        const data3Months = {
          current: toMonthlyEmployeeDeliveryRow(getPersonRow(reports[0], person)),
          prev: toMonthlyEmployeeDeliveryRow(getPersonRow(reports[1], person)),
        };
        const deptKey = departmentToSummaryKey(person.department);
        const deptCurRaw = reportSummaries[0]?.departments?.[deptKey] ?? null;
        const deptPrevRaw = reportSummaries[1]?.departments?.[deptKey] ?? null;
        const deptAverages3Months = {
          current: departmentAveragesByMonth[0]?.[deptKey] ?? null,
          prev: departmentAveragesByMonth[1]?.[deptKey] ?? null,
        };
        const calculated = buildEmployeeInputCalculated(
          data3Months,
          deptAverages3Months,
          workingDaysInPeriod,
          periodStart,
          periodEnd,
        );
        const inputJson = {
          person: { name: person.name, department: person.department },
          data3Months,
          deptAverages3Months,
          periodStart,
          periodEnd,
          workingDaysInPeriod,
          calculated,
        };
        const performancePct = getPerformancePct(data3Months.current);
        const raw = await generateMonthlySections({
          systemPrompt: employeePrompt,
          inputJson,
          performancePct,
        });
        const llmSections = raw?.sections ?? raw;
        const { html } = buildMonthlyEmployeeEmail({
          person,
          data3Months,
          deptAverages3Months,
          periodStart: metas[0].periodStart,
          workingDaysInPeriod,
          llmSections,
        });
        const safeEmail = sanitizeEmailForFilename(person.email);
        fs.writeFileSync(path.join(outDir, `monthly_employee_${safeEmail}_${label}.html`), html, 'utf8');
      }
    } else {
      console.log('[monthly] DRY_RUN scope=department_only -> skipping individual email generation');
    }
    const deptRaw = await generateMonthlyDepartmentSections({
      systemPrompt: departmentPrompt,
      inputJson: departmentInputJson,
    });
    const departmentLlmSections = deptRaw?.sections ?? deptRaw;
    const dryRunPath = writeDryRunFile(JOB_TYPE, label, { ...payload, reports3: reports, metas3: metas });
    if (result0.meta && result0.reportSummary?.departments) {
      result0.report.kpi = buildReportKpi(
        { ...result0.meta, workingDaysInPeriod },
        result0.reportSummary.departments,
      );
    }
    const { html: deptHtml } = buildMonthlyDepartmentEmail({
      periodStart: metas[0].periodStart,
      meta: result0.meta,
      reportSummary: result0.reportSummary,
      reportSummaryPrev: result1.reportSummary,
      report: result0.report,
      monthExcelCurrent: xlsxBuffer,
      llmSections: departmentLlmSections,
    });
    fs.writeFileSync(path.join(outDir, `monthly_department_${label}.html`), deptHtml, 'utf8');
    fs.writeFileSync(path.join(outDir, xlsxFilename), xlsxBuffer);
    return { payload, dryRunPath };
  }

  // NON-DRY RUN: load/create run state; checkpoint collect → department → employees; skip already-completed units.
  // GMAIL + TEST_EMAILS (when SEND_MODE=test) already validated by validateMonthlyRuntimeConfig.
  const gmailUser = resolveGmailUser(process.env.GMAIL_USER);
  const gmailAppPassword = process.env.GMAIL_APP_PASSWORD;
  const monthlyEmployeeFrom = process.env.MONTHLY_EMPLOYEE_FROM_EMAIL?.trim() || null;
  const monthlyEmployeeAppPassword = process.env.MONTHLY_EMPLOYEE_APP_PASSWORD?.trim() || null;
  const useEmployeeSender =
    sendMode === 'prod' && monthlyEmployeeFrom && monthlyEmployeeAppPassword;

  let runState;
  try {
    runState = await loadMonthlyRunState(runStateLabel);
  } catch (loadErr) {
    const code = loadErr?.code ?? 'RUN_STATE_UNAVAILABLE';
    const message = loadErr?.message ?? String(loadErr);
    console.error('[monthly][run-state] load failed, aborting to avoid duplicate sends', { label: runStateLabel, code, message });
    throw new Error(
      'Monthly run-state unavailable/corrupt for ' + runStateLabel + '; aborting to avoid duplicate sends.'
    );
  }
  if (!runState) {
    runState = createInitialState({ label: runStateLabel, periodStart, periodEnd });
    await saveMonthlyRunState(runStateLabel, runState);
    console.log('[monthly][resume] state created (new run)', { label: runStateLabel });
  } else {
    console.log('[monthly][resume] state loaded', { label: runStateLabel, completed: runState.completed });
  }

  const save = (s) => saveMonthlyRunState(runStateLabel, s);
  await markCollectOk(runState, save);
  console.log('[monthly][checkpoint] stage collect=ok');

  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: { user: gmailUser, pass: gmailAppPassword },
  });

  const transporterEmployee = useEmployeeSender
    ? nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 587,
        secure: false,
        auth: { user: monthlyEmployeeFrom, pass: monthlyEmployeeAppPassword },
      })
    : null;

  const jobStartMs = Date.now();
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  let totalCost = null;

  // 1) Department: always send on every run (no persisted "sent" checkpointing).
  let departmentLlmSections = runState.stages.department?.llmSections ?? null;
  const needDeptLlm = runState.stages.department?.llm?.status !== 'ok' || !departmentLlmSections;
  if (needDeptLlm) {
    try {
      const deptRaw = await generateMonthlyDepartmentSections({
        systemPrompt: departmentPrompt,
        inputJson: departmentInputJson,
      });
      departmentLlmSections = deptRaw?.sections ?? deptRaw;
      const usage = deptRaw?.usage;
      if (usage) {
        const pt = usage.prompt_tokens ?? usage.input_tokens ?? 0;
        const ct = usage.completion_tokens ?? usage.output_tokens ?? 0;
        totalPromptTokens += pt;
        totalCompletionTokens += ct;
        if (usage.cost != null) totalCost = (totalCost ?? 0) + usage.cost;
      }
      await markDepartmentLlmOk(runState, departmentLlmSections, save);
      console.log('[monthly][checkpoint] stage department llm=ok');
    } catch (err) {
      const reason = err?.reason ?? err?.llmMeta?.reason ?? null;
      const requestId = err?.requestId ?? err?.llmMeta?.requestId ?? null;
      const repairRequestId =
        err?.repairRequestId ?? err?.llmMeta?.repairRequestId ?? null;
      console.error('[monthly] department_failed', {
        label,
        stage: 'dept_llm',
        attempt: 1,
        reason,
        requestId,
        repairRequestId,
        message: err?.message ?? String(err),
      });
      await markDepartmentLlmFailed(runState, err, save);
      throw err;
    }
  }
  if (!departmentLlmSections) {
    departmentLlmSections = runState.stages.department?.llmSections ?? null;
  }

  if (result0.meta && result0.reportSummary?.departments) {
    result0.report.kpi = buildReportKpi(
      { ...result0.meta, workingDaysInPeriod },
      result0.reportSummary.departments,
    );
  }
  const { subject: deptSubject, html: deptHtml, attachments } = buildMonthlyDepartmentEmail({
    periodStart: metas[0].periodStart,
    meta: result0.meta,
    reportSummary: result0.reportSummary,
    reportSummaryPrev: result1.reportSummary,
    report: result0.report,
    monthExcelCurrent: xlsxBuffer,
    llmSections: departmentLlmSections,
  });

  const managerEmails = MANAGERS.filter((m) => m.isActive).map((m) => m.email);
  const departmentRecipientList = dedupeEmails([
    ...managerEmails,
    ...MONTHLY_DEPARTMENT_EXTRA_RECIPIENTS,
  ]);
  const deptToList = resolveRecipients(departmentRecipientList);
  logSendRecipients(deptToList.length, deptToList);
  try {
    await sendWithRetry(
      transporter,
      {
        from: gmailUser,
        to: deptToList.join(', '),
        subject: resolveSubject(deptSubject),
        html: deptHtml,
        attachments,
      },
      { context: 'department' }
    );
    console.log('[monthly] department_email_sent');
  } catch (err) {
    console.error('[monthly] department_failed', {
      label,
      stage: 'dept_send',
      message: err?.message ?? String(err),
    });
    throw err;
  }

  // 2) Employee emails: always send on every run (no persisted "sent" checkpointing).
  if (!departmentOnly) {
    for (const person of activePeople) {
      ensureEmployeeEntry(runState, person.email, person.name);

      const data3Months = {
        current: toMonthlyEmployeeDeliveryRow(getPersonRow(reports[0], person)),
        prev: toMonthlyEmployeeDeliveryRow(getPersonRow(reports[1], person)),
      };
      const deptKey = departmentToSummaryKey(person.department);
      const deptCurRaw = reportSummaries[0]?.departments?.[deptKey] ?? null;
      const deptPrevRaw = reportSummaries[1]?.departments?.[deptKey] ?? null;
      const deptAverages3Months = {
        current: departmentAveragesByMonth[0]?.[deptKey] ?? null,
        prev: departmentAveragesByMonth[1]?.[deptKey] ?? null,
      };
      const calculated = buildEmployeeInputCalculated(
        data3Months,
        deptAverages3Months,
        workingDaysInPeriod,
        periodStart,
        periodEnd,
      );
      const inputJson = {
        person: { name: person.name, department: person.department },
        data3Months,
        deptAverages3Months,
        periodStart,
        periodEnd,
        workingDaysInPeriod,
        calculated,
      };

      console.log('[monthly] employee_start', person.name, person.email);
      let llmSections = runState.stages.employees[person.email]?.llmSections ?? null;
      const needEmpLlm = runState.stages.employees[person.email]?.llm?.status !== 'ok' || !llmSections;
      if (needEmpLlm) {
        const performancePct = getPerformancePct(data3Months.current);
        try {
          const raw = await generateMonthlySections({
            systemPrompt: employeePrompt,
            inputJson,
            performancePct,
          });
          llmSections = raw?.sections ?? raw;
          const usage = raw?.usage;
          if (usage) {
            const pt = usage.prompt_tokens ?? usage.input_tokens ?? 0;
            const ct = usage.completion_tokens ?? usage.output_tokens ?? 0;
            totalPromptTokens += pt;
            totalCompletionTokens += ct;
            if (usage.cost != null) totalCost = (totalCost ?? 0) + usage.cost;
            console.log('[monthly] employee_llm_success', person.name, person.email, {
              prompt_tokens: pt,
              completion_tokens: ct,
              cost: usage.cost ?? null,
            });
          } else {
            console.log('[monthly] employee_llm_success', person.name, person.email);
          }
          await markEmployeeLlmOk(runState, person.email, llmSections, save);
          console.log('[monthly][checkpoint] stage employee llm=ok', { email: person.email });
        } catch (err) {
          const reason = err?.reason ?? err?.llmMeta?.reason ?? null;
          const requestId = err?.requestId ?? err?.llmMeta?.requestId ?? null;
          const repairRequestId =
            err?.repairRequestId ?? err?.llmMeta?.repairRequestId ?? null;
          console.error('[monthly] employee_failed', {
            label,
            email: person.email,
            name: person.name,
            stage: 'emp_llm',
            attempt: 1,
            reason,
            requestId,
            repairRequestId,
            message: err?.message ?? String(err),
          });
          await markEmployeeLlmFailed(runState, person.email, err, save, person.name);
          throw err;
        }
      }
      if (!llmSections) {
        llmSections = runState.stages.employees[person.email]?.llmSections ?? null;
      }

      try {
        const { subject, html } = buildMonthlyEmployeeEmail({
          person,
          data3Months,
          deptAverages3Months,
          periodStart: metas[0].periodStart,
          workingDaysInPeriod,
          llmSections,
        });
        const toList = resolveRecipients([person.email]);
        logSendRecipients(1, toList);
        const empTransporter = transporterEmployee ?? transporter;
        const empFrom = useEmployeeSender ? monthlyEmployeeFrom : gmailUser;
        await sendWithRetry(
          empTransporter,
          {
            from: empFrom,
            to: toList.join(', '),
            subject: resolveSubject(subject),
            html,
          },
          { context: 'employee' }
        );
        console.log('[monthly] employee_email_sent', person.name, person.email);
      } catch (err) {
        console.error('[monthly] employee_failed', {
          label,
          email: person.email,
          name: person.name,
          stage: 'emp_send',
          message: err?.message ?? String(err),
        });
        throw err;
      }
    }
  } else {
    console.log('[monthly] scope=department_only -> skipping individual employee stage');
  }

  console.log('[monthly] run completed', { label });

  const employeesSent = departmentOnly ? 0 : activePeople.length;
  const durationMs = Date.now() - jobStartMs;
  const totalTokens = totalPromptTokens + totalCompletionTokens;
  console.log('[monthly] job_summary', {
    employeesProcessed: activePeople.length,
    employeesSent,
    totalTokens: totalTokens || undefined,
    totalCost: totalCost ?? undefined,
    durationMs,
  });

  return { payload };
}

export {
  buildEmployeeInputCalculated,
  toMonthlyEmployeeDeliveryRow,
};
