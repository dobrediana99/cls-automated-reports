import fs from 'fs';
import path from 'path';
import nodemailer from 'nodemailer';
import { writeDryRunFile } from './dryRun.js';
import { getMonthlyPeriods, loadOrComputeMonthlyReport } from '../report/runMonthlyPeriods.js';
import { buildMonthlyEmployeeEmail, getPersonRow, buildMonthlyDepartmentEmail } from '../email/monthly.js';
import { resolveRecipients, resolveSubject, logSendRecipients } from '../email/sender.js';
import { buildMonthlyXlsx } from '../export/xlsx.js';
import { requireOpenAI, generateMonthlySections, generateMonthlyDepartmentSections } from '../llm/openaiClient.js';
import { loadMonthlyEmployeePrompt, loadMonthlyDepartmentPrompt } from '../prompts/loadPrompts.js';
import { ORG, MANAGERS, DEPARTMENTS } from '../../src/config/org.js';

const JOB_TYPE = 'monthly';
const TIMEZONE = 'Europe/Bucharest';
const OUT_DIR = path.join(process.cwd(), 'out');

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

function ensureOutDir() {
  if (!fs.existsSync(OUT_DIR)) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
  }
}

/**
 * Runs the monthly job.
 * Uses cache in out/cache/monthly/<YYYY-MM>.json; refresh forces recompute for all 3 months.
 * Fetches data for 3 periods: report month (previous calendar month), 2 months ago, 3 months ago.
 * DRY_RUN=1: writes JSON + one HTML per person + department HTML + XLSX to ./out/.
 * Otherwise: sends personal monthly email to each active person; sends one department email to each manager (with XLSX attachment).
 * Idempotency is enforced by the route (runJobWithIdempotency); mark sent only after all emails sent.
 * @param {{ now?: Date, refresh?: boolean }} [opts] - now defaults to new Date(); refresh=true ignores cache
 * @returns {Promise<{ payload: object, dryRunPath?: string }>}
 */
export async function runMonthly(opts = {}) {
  const now = opts.now ?? new Date();
  const refresh = opts.refresh === true || opts.refresh === 1;

  if (refresh && process.env.NODE_ENV !== 'production') {
    console.log('[monthly] refresh=1 -> ignoring cache for all 3 months');
  }

  const periods = getMonthlyPeriods({ baseDate: now });
  const result0 = await loadOrComputeMonthlyReport({ period: periods[0], refresh });
  const result1 = await loadOrComputeMonthlyReport({ period: periods[1], refresh });
  const result2 = await loadOrComputeMonthlyReport({ period: periods[2], refresh });

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

  requireOpenAI();
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

  const departmentInputJson = {
    current: reportSummaries[0],
    prev1: reportSummaries[1],
    prev2: reportSummaries[2],
    periodStart: metas[0].periodStart,
  };
  const departmentLlmSections = await generateMonthlyDepartmentSections({
    systemPrompt: departmentPrompt,
    inputJson: departmentInputJson,
  });

  if (process.env.DRY_RUN === '1') {
    const dryRunPath = writeDryRunFile(JOB_TYPE, label, { ...payload, reports3: reports, metas3: metas });
    ensureOutDir();
    for (const { person, data3Months, deptAverages3Months, llmSections } of employeeLlmSections) {
      const { subject, html } = buildMonthlyEmployeeEmail({
        person,
        data3Months,
        deptAverages3Months,
        periodStart: metas[0].periodStart,
        llmSections,
      });
      const safeEmail = sanitizeEmailForFilename(person.email);
      fs.writeFileSync(path.join(OUT_DIR, `monthly_employee_${safeEmail}_${label}.html`), html, 'utf8');
    }
    const { subject: deptSubject, html: deptHtml } = buildMonthlyDepartmentEmail({
      periodStart: metas[0].periodStart,
      reportSummary: result0.reportSummary,
      monthExcelCurrent: xlsxBuffer,
      llmSections: departmentLlmSections,
    });
    fs.writeFileSync(path.join(OUT_DIR, `monthly_department_${label}.html`), deptHtml, 'utf8');
    fs.writeFileSync(path.join(OUT_DIR, xlsxFilename), xlsxBuffer);
    return { payload, dryRunPath };
  }

  // Trimitere reală: Nodemailer (la fel ca weekly.js). Idempotency marchează sent DOAR după ce toate emailurile au fost trimise cu succes.
  const gmailUser = process.env.GMAIL_USER;
  const gmailAppPassword = process.env.GMAIL_APP_PASSWORD;
  if (!gmailUser || !gmailAppPassword) {
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
