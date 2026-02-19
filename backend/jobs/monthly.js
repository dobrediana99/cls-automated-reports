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
  markDepartmentSend,
  markEmployeeLlmOk,
  markEmployeeLlmFailed,
  markEmployeeSend,
  ensureEmployeeEntry,
  markCompleted,
} from '../store/monthlyRunState.js';
import { buildMonthlyEmployeeEmail, getPersonRow, buildMonthlyDepartmentEmail } from '../email/monthly.js';
import { resolveRecipients, resolveSubject, logSendRecipients } from '../email/sender.js';
import { sendWithRetry } from '../email/sendWithRetry.js';
import { buildMonthlyXlsx } from '../export/xlsx.js';
import { requireOpenRouter, generateMonthlySections, generateMonthlyDepartmentSections } from '../llm/openrouterClient.js';
import { loadMonthlyEmployeePrompt, loadMonthlyDepartmentPrompt } from '../prompts/loadPrompts.js';
import { buildDepartmentAnalytics, validateDepartmentAnalytics } from '../report/departmentAnalytics.js';
import {
  buildReportKpi,
  countWorkingDays,
  round2,
  totalProfitEur,
  calcTargetAchievementPct,
  calcCallsPerWorkingDay,
  calcProspectingConversionPct,
} from '../utils/kpiCalc.js';
import { ORG, MANAGERS, DEPARTMENTS } from '../config/org.js';
import { validateMonthlyRuntimeConfig } from '../config/validateRuntimeConfig.js';
import { sanitizeEmailForFilename } from '../utils/sanitizeEmailForFilename.js';

/**
 * Build the "calculated" KPI object for LLM input (employee + department current/prev).
 * Department summary uses profitTotal/targetTotal from reportSummary.departments.
 */
function buildEmployeeInputCalculated(data3Months, deptAverages3Months, workingDaysInPeriod, periodStart, periodEnd) {
  const cur = data3Months?.current;
  const prev = data3Months?.prev;
  const deptCur = deptAverages3Months?.current;
  const deptPrev = deptAverages3Months?.prev;

  const empCur = {
    profitTotalEur: round2(totalProfitEur(cur)),
    realizareTargetPct: calcTargetAchievementPct(cur),
    apeluriMediiZiLucratoare: calcCallsPerWorkingDay(cur?.callsCount, workingDaysInPeriod),
    conversieProspectarePct: calcProspectingConversionPct(cur?.contactat, cur?.calificat),
    callsCount: cur?.callsCount ?? null,
    contactat: cur?.contactat ?? null,
    calificat: cur?.calificat ?? null,
    target: cur?.target ?? null,
  };
  const empPrev = {
    profitTotalEur: round2(totalProfitEur(prev)),
    realizareTargetPct: calcTargetAchievementPct(prev),
    apeluriMediiZiLucratoare: calcCallsPerWorkingDay(prev?.callsCount, workingDaysInPeriod),
    conversieProspectarePct: calcProspectingConversionPct(prev?.contactat, prev?.calificat),
    callsCount: prev?.callsCount ?? null,
    contactat: prev?.contactat ?? null,
    calificat: prev?.calificat ?? null,
    target: prev?.target ?? null,
  };

  const deptProfitCur = deptCur?.profitTotal != null ? Number(deptCur.profitTotal) : null;
  const deptTargetCur = deptCur?.targetTotal != null && Number(deptCur.targetTotal) > 0 ? Number(deptCur.targetTotal) : null;
  const deptProfitPrev = deptPrev?.profitTotal != null ? Number(deptPrev.profitTotal) : null;
  const deptTargetPrev = deptPrev?.targetTotal != null && Number(deptPrev.targetTotal) > 0 ? Number(deptPrev.targetTotal) : null;

  return {
    period: { periodStart, periodEnd, workingDaysInPeriod },
    employee: { current: empCur, prev: empPrev },
    department: {
      current: {
        profitTotalEur: deptProfitCur != null ? round2(deptProfitCur) : null,
        realizareTargetPct: deptTargetCur != null && deptProfitCur != null ? round2((deptProfitCur / deptTargetCur) * 100) : null,
        apeluriMediiZiLucratoare: deptCur?.callsCount != null ? calcCallsPerWorkingDay(deptCur.callsCount, workingDaysInPeriod) : null,
        conversieProspectarePct: (deptCur?.contactat != null && deptCur?.calificat != null) ? calcProspectingConversionPct(deptCur.contactat, deptCur.calificat) : null,
      },
      prev: {
        profitTotalEur: deptProfitPrev != null ? round2(deptProfitPrev) : null,
        realizareTargetPct: deptTargetPrev != null && deptProfitPrev != null ? round2((deptProfitPrev / deptTargetPrev) * 100) : null,
        apeluriMediiZiLucratoare: deptPrev?.callsCount != null ? calcCallsPerWorkingDay(deptPrev.callsCount, workingDaysInPeriod) : null,
        conversieProspectarePct: (deptPrev?.contactat != null && deptPrev?.calificat != null) ? calcProspectingConversionPct(deptPrev.contactat, deptPrev.calificat) : null,
      },
    },
  };
}

// Behavior A: Snapshots are persisted before email send. If email env is missing or send fails,
// the job exits with code 1 but computed checkpoints remain in GCS so reruns skip heavy Monday queries.

const JOB_TYPE = 'monthly';
const TIMEZONE = 'Europe/Bucharest';

function departmentToSummaryKey(department) {
  if (department === DEPARTMENTS.OPERATIONS) return 'operational';
  if (department === DEPARTMENTS.SALES) return 'sales';
  if (department === DEPARTMENTS.MANAGEMENT) return 'management';
  return 'operational';
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
  console.log('[MONTHLY] START', {
    service: process.env.K_SERVICE || null,
    revision: process.env.K_REVISION || null,
    region: process.env.K_REGION || null,
    hasOpenRouterKey: Boolean(process.env.OPENROUTER_API_KEY),
    openRouterModel: process.env.OPENROUTER_MODEL || 'DEFAULT',
    hasMondayToken: Boolean(process.env.MONDAY_API_TOKEN),
    dryRun: process.env.DRY_RUN || null,
    sendMode: process.env.SEND_MODE || null,
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
    runLabelForManifest = results[0]?.meta?.label ?? periods[0].label;
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

  /** performancePct = (totalProfit / target) * 100 for check-in rule; null if unknown. */
  function getPerformancePct(monthData) {
    if (!monthData || typeof monthData !== 'object') return null;
    const target = Number(monthData.target);
    if (!target || target <= 0) return null;
    const totalProfit =
      Number(monthData.ctr_principalProfitEur ?? 0) +
      Number(monthData.ctr_secondaryProfitEur ?? 0) +
      Number(monthData.livr_principalProfitEur ?? 0) +
      Number(monthData.livr_secondaryProfitEur ?? 0);
    return (totalProfit / target) * 100;
  }

  if (process.env.DRY_RUN === '1') {
    const outDir = getOutDir({ dryRun: true });
    ensureOutDir(outDir);
    for (const person of activePeople) {
      const data3Months = {
        current: getPersonRow(reports[0], person),
        prev: getPersonRow(reports[1], person),
      };
      const deptKey = departmentToSummaryKey(person.department);
      const deptAverages3Months = {
        current: reportSummaries[0]?.departments?.[deptKey] ?? null,
        prev: reportSummaries[1]?.departments?.[deptKey] ?? null,
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
        llmSections,
      });
      const safeEmail = sanitizeEmailForFilename(person.email);
      fs.writeFileSync(path.join(outDir, `monthly_employee_${safeEmail}_${label}.html`), html, 'utf8');
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
  const gmailUser = process.env.GMAIL_USER;
  const gmailAppPassword = process.env.GMAIL_APP_PASSWORD;

  let runState;
  try {
    runState = await loadMonthlyRunState(label);
  } catch (loadErr) {
    const code = loadErr?.code ?? 'RUN_STATE_UNAVAILABLE';
    const message = loadErr?.message ?? String(loadErr);
    console.error('[monthly][run-state] load failed, aborting to avoid duplicate sends', { label, code, message });
    throw new Error(
      'Monthly run-state unavailable/corrupt for ' + label + '; aborting to avoid duplicate sends.'
    );
  }
  if (!runState) {
    runState = createInitialState({ label, periodStart, periodEnd });
    await saveMonthlyRunState(label, runState);
    console.log('[monthly][resume] state created (new run)', { label });
  } else {
    console.log('[monthly][resume] state loaded', { label, completed: runState.completed });
  }

  if (runState.completed) {
    console.log('[monthly][resume] run already completed, no-op (idempotent)', { label });
    return { payload };
  }

  const save = (s) => saveMonthlyRunState(label, s);
  await markCollectOk(runState, save);
  console.log('[monthly][checkpoint] stage collect=ok');

  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: { user: gmailUser, pass: gmailAppPassword },
  });

  const jobStartMs = Date.now();
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  let totalCost = null;

  // 1) Department: skip if send already ok; else LLM (only if llm != ok, use stored sections if present) then send.
  const deptSendOk = runState.stages.department?.send?.status === 'ok';
  if (deptSendOk) {
    console.log('[monthly][resume] skip department send already completed');
  } else {
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
      report: result0.report,
      monthExcelCurrent: xlsxBuffer,
      llmSections: departmentLlmSections,
    });

    const managerEmails = MANAGERS.filter((m) => m.isActive).map((m) => m.email);
    const deptToList = resolveRecipients(managerEmails);
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
      await markDepartmentSend(runState, 'ok', null, save);
      console.log('[monthly][checkpoint] stage department send=ok');
    } catch (err) {
      console.error('[monthly] department_failed', {
        label,
        stage: 'dept_send',
        message: err?.message ?? String(err),
      });
      await markDepartmentSend(runState, 'failed', err, save);
      throw err;
    }
  }

  // 2) Employee emails: skip if send already ok; else LLM (only if llm != ok) then send; checkpoint each.
  for (const person of activePeople) {
    ensureEmployeeEntry(runState, person.email, person.name);
    if (runState.stages.employees[person.email]?.send?.status === 'ok') {
      console.log('[monthly][resume] skip employee send already completed', { email: person.email });
      continue;
    }

    const data3Months = {
      current: getPersonRow(reports[0], person),
      prev: getPersonRow(reports[1], person),
    };
    const deptKey = departmentToSummaryKey(person.department);
    const deptAverages3Months = {
      current: reportSummaries[0]?.departments?.[deptKey] ?? null,
      prev: reportSummaries[1]?.departments?.[deptKey] ?? null,
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
        llmSections,
      });
      const toList = resolveRecipients([person.email]);
      logSendRecipients(1, toList);
      await sendWithRetry(
        transporter,
        {
          from: gmailUser,
          to: toList.join(', '),
          subject: resolveSubject(subject),
          html,
        },
        { context: 'employee' }
      );
      await markEmployeeSend(runState, person.email, 'ok', null, save);
      console.log('[monthly] employee_email_sent', person.name, person.email);
      console.log('[monthly][checkpoint] stage employee send=ok', { email: person.email });
    } catch (err) {
      console.error('[monthly] employee_failed', {
        label,
        email: person.email,
        name: person.name,
        stage: 'emp_send',
        message: err?.message ?? String(err),
      });
      await markEmployeeSend(runState, person.email, 'failed', err, save);
      throw err;
    }
  }

  await markCompleted(runState, save);
  console.log('[monthly][checkpoint] run completed', { label });

  const employeesSent = activePeople.length;
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

export { buildEmployeeInputCalculated };
