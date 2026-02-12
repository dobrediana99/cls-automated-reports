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
import { buildMonthlyEmployeeEmail, getPersonRow, buildMonthlyDepartmentEmail } from '../email/monthly.js';
import { resolveRecipients, resolveSubject, logSendRecipients } from '../email/sender.js';
import { buildMonthlyXlsx } from '../export/xlsx.js';
import { requireOpenRouter, generateMonthlySections, generateMonthlyDepartmentSections } from '../llm/openrouterClient.js';
import { loadMonthlyEmployeePrompt, loadMonthlyDepartmentPrompt } from '../prompts/loadPrompts.js';
import { buildDepartmentAnalytics, validateDepartmentAnalytics } from '../report/departmentAnalytics.js';
import { ORG, MANAGERS, DEPARTMENTS } from '../config/org.js';

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

function sanitizeEmailForFilename(email) {
  if (!email || typeof email !== 'string') return 'unknown';
  return email.replace(/@/g, '_at_').replace(/\./g, '_');
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
  const now = opts.now ?? new Date();
  const refresh = opts.refresh === true || opts.refresh === 1;

  // Fail fast before heavy compute if Monday token missing (needed for snapshot build or report fetch).
  const mondayToken = process.env.MONDAY_API_TOKEN;
  if (!mondayToken || typeof mondayToken !== 'string' || !mondayToken.trim()) {
    throw new Error('MONDAY_API_TOKEN must be set for monthly report (fetch or snapshot build)');
  }

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
  const employeeLlmSections = [];
  for (const person of activePeople) {
    const data3Months = {
      current: getPersonRow(reports[0], person),
      prev: getPersonRow(reports[1], person),
      prev2: getPersonRow(reports[2], person),
    };
    const deptKey = departmentToSummaryKey(person.department);
    const deptAverages3Months = {
      current: reportSummaries[0]?.departments?.[deptKey] ?? null,
      prev: reportSummaries[1]?.departments?.[deptKey] ?? null,
      prev2: reportSummaries[2]?.departments?.[deptKey] ?? null,
    };
    const inputJson = {
      person: { name: person.name, department: person.department },
      data3Months,
      deptAverages3Months,
      periodStart: metas[0].periodStart,
    };
    const sections = await generateMonthlySections({ systemPrompt: employeePrompt, inputJson });
    employeeLlmSections.push({ person, data3Months, deptAverages3Months, llmSections: sections });
  }

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
    prev2: {
      summary: reportSummaries[2],
      rows: {
        operational: reports[2]?.opsStats ?? [],
        sales: reports[2]?.salesStats ?? [],
      },
    },
  };

  const departmentAnalytics = buildDepartmentAnalytics({
    current: departmentPeriods.current,
    prev1: departmentPeriods.prev1,
    prev2: departmentPeriods.prev2,
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
    periodStart: metas[0].periodStart,
    analytics: departmentAnalytics,
    rawSummaries: {
      current: reportSummaries[0],
      prev1: reportSummaries[1],
      prev2: reportSummaries[2],
    },
  };
  const departmentLlmSections = await generateMonthlyDepartmentSections({
    systemPrompt: departmentPrompt,
    inputJson: departmentInputJson,
  });

  if (process.env.DRY_RUN === '1') {
    const dryRunPath = writeDryRunFile(JOB_TYPE, label, { ...payload, reports3: reports, metas3: metas });
    const outDir = getOutDir({ dryRun: true });
    ensureOutDir(outDir);
    for (const { person, data3Months, deptAverages3Months, llmSections } of employeeLlmSections) {
      const { subject, html } = buildMonthlyEmployeeEmail({
        person,
        data3Months,
        deptAverages3Months,
        periodStart: metas[0].periodStart,
        llmSections,
      });
      const safeEmail = sanitizeEmailForFilename(person.email);
      fs.writeFileSync(path.join(outDir, `monthly_employee_${safeEmail}_${label}.html`), html, 'utf8');
    }
    const { subject: deptSubject, html: deptHtml } = buildMonthlyDepartmentEmail({
      periodStart: metas[0].periodStart,
      reportSummary: result0.reportSummary,
      monthExcelCurrent: xlsxBuffer,
      llmSections: departmentLlmSections,
    });
    fs.writeFileSync(path.join(outDir, `monthly_department_${label}.html`), deptHtml, 'utf8');
    fs.writeFileSync(path.join(outDir, xlsxFilename), xlsxBuffer);
    return { payload, dryRunPath };
  }

  // Email send: validate env before sending. Snapshots already persisted; if we throw here, exit 1 but checkpoints remain.
  const gmailUser = process.env.GMAIL_USER;
  const gmailAppPassword = process.env.GMAIL_APP_PASSWORD;
  if (!gmailUser || !gmailAppPassword) {
    console.error('[job] monthly email skipped missing env (GMAIL_USER or GMAIL_APP_PASSWORD unset)');
    throw new Error('GMAIL_USER and GMAIL_APP_PASSWORD must be set for monthly email send');
  }

  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: { user: gmailUser, pass: gmailAppPassword },
  });

  for (const { person, data3Months, deptAverages3Months, llmSections } of employeeLlmSections) {
    const { subject, html } = buildMonthlyEmployeeEmail({
      person,
      data3Months,
      deptAverages3Months,
      periodStart: metas[0].periodStart,
      llmSections,
    });
    const toList = resolveRecipients([person.email]);
    logSendRecipients(1, toList);
    await transporter.sendMail({
      from: gmailUser,
      to: toList.join(', '),
      subject: resolveSubject(subject),
      html,
    });
  }

  const { subject: deptSubject, html: deptHtml, attachments } = buildMonthlyDepartmentEmail({
    periodStart: metas[0].periodStart,
    reportSummary: result0.reportSummary,
    monthExcelCurrent: xlsxBuffer,
    llmSections: departmentLlmSections,
  });
  for (const manager of MANAGERS) {
    if (!manager.isActive) continue;
    const toList = resolveRecipients([manager.email]);
    logSendRecipients(1, toList);
    await transporter.sendMail({
      from: gmailUser,
      to: toList.join(', '),
      subject: resolveSubject(deptSubject),
      html: deptHtml,
      attachments,
    });
  }

  return { payload };
}
