import fs from 'fs';
import path from 'path';
import nodemailer from 'nodemailer';
import { getPreviousCalendarWeekRange } from '../lib/dateRanges.js';
import { writeDryRunFile } from './dryRun.js';
import { getOutDir, ensureOutDir } from '../utils/outDir.js';
import { runReport } from '../report/runReport.js';
import { renderWeeklyEmployeeEmail, renderWeeklyManagerEmail } from '../email/weekly.js';
import { getWeeklySubject } from '../email/content/weeklyTexts.js';
import { resolveRecipients, resolveSubject, logSendRecipients } from '../email/sender.js';
import { buildWeeklyXlsx } from '../export/xlsx.js';
import { formatRaportFilename } from '../export/weeklyReportWorkbook.js';
import { ORG } from '../config/org.js';

const JOB_TYPE = 'weekly';
const TIMEZONE = 'Europe/Bucharest';

function sanitizeEmailForFilename(email) {
  if (!email || typeof email !== 'string') return 'unknown';
  return email.replace(/@/g, '_at_').replace(/\./g, '_');
}

/**
 * Runs the weekly job.
 * DRY_RUN=1: fetches Monday data, builds report, writes JSON + one HTML per person + one XLSX to ./out/.
 * Otherwise: sends personal HTML email to each active person via Nodemailer (Gmail); managers also get XLSX attachment.
 * Idempotency is enforced by the route (runJobWithIdempotency) so no duplicate sends.
 * @param {Date} [now=new Date()]
 * @returns {Promise<{ payload: object, dryRunPath?: string }>}
 */
export async function runWeekly(now = new Date()) {
  const range = getPreviousCalendarWeekRange(now);
  const meta = {
    jobType: JOB_TYPE,
    periodStart: range.periodStart,
    periodEnd: range.periodEnd,
    label: range.label,
    timezone: TIMEZONE,
    runAt: new Date().toISOString(),
  };

  const { meta: reportMeta, reportSummary, report } = await runReport({
    periodStart: range.periodStart,
    periodEnd: range.periodEnd,
    label: range.label,
    timezone: TIMEZONE,
    jobType: JOB_TYPE,
    runAt: meta.runAt,
  });
  const payload = { meta: reportMeta, reportSummary };
  const label = range.label;

  if (process.env.DRY_RUN === '1') {
    const dryRunPath = writeDryRunFile(JOB_TYPE, label, payload);
    const outDir = getOutDir({ dryRun: true });
    ensureOutDir(outDir);

    const activePeople = ORG.filter((p) => p.isActive);
    for (const person of activePeople) {
      const html = person.role === 'manager'
        ? renderWeeklyManagerEmail(report, person, reportMeta)
        : renderWeeklyEmployeeEmail(report, person, reportMeta);
      const safeEmail = sanitizeEmailForFilename(person.email);
      const htmlPath = path.join(outDir, `weekly_employee_${safeEmail}_${label}.html`);
      fs.writeFileSync(htmlPath, html, 'utf8');
    }

    const xlsxBuffer = await buildWeeklyXlsx(report, reportMeta);
    const xlsxFilename = formatRaportFilename(reportMeta.periodStart, reportMeta.periodEnd);
    const xlsxPath = path.join(outDir, xlsxFilename);
    fs.writeFileSync(xlsxPath, xlsxBuffer);

    return { payload, dryRunPath };
  }

  // Real send: Nodemailer Gmail SMTP
  const gmailUser = process.env.GMAIL_USER;
  const gmailAppPassword = process.env.GMAIL_APP_PASSWORD;
  if (!gmailUser || !gmailAppPassword) {
    throw new Error('GMAIL_USER and GMAIL_APP_PASSWORD must be set for weekly email send');
  }

  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: {
      user: gmailUser,
      pass: gmailAppPassword,
    },
  });

  const xlsxBuffer = await buildWeeklyXlsx(report, reportMeta);
  const xlsxFilename = formatRaportFilename(reportMeta.periodStart, reportMeta.periodEnd);
  const activePeople = ORG.filter((p) => p.isActive);

  for (const person of activePeople) {
    const html = person.role === 'manager'
      ? renderWeeklyManagerEmail(report, person, reportMeta)
      : renderWeeklyEmployeeEmail(report, person, reportMeta);
    const subject = resolveSubject(getWeeklySubject({
      role: person.role === 'manager' ? 'manager' : 'employee',
      periodStart: reportMeta.periodStart,
      periodEnd: reportMeta.periodEnd,
    }));
    const toList = resolveRecipients([person.email]);
    logSendRecipients(1, toList);
    const attachments = person.role === 'manager'
      ? [{ filename: xlsxFilename, content: xlsxBuffer }]
      : [];
    await transporter.sendMail({
      from: gmailUser,
      to: toList.join(', '),
      subject,
      html,
      attachments,
    });
  }

  return { payload };
}
