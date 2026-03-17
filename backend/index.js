import express from 'express';
import crypto from 'crypto';
import { OAuth2Client } from 'google-auth-library';
import { getPreviousCalendarWeekRange, isMonthlyReportSendDayForWindow } from './lib/dateRanges.js';
import { getPreviousCalendarMonthRange } from './lib/dateRanges.js';
import { runWeekly } from './jobs/weekly.js';
import {
  runMonthly,
  resolveMonthlySendScope,
  resolveMonthlyRunSlot,
  applyMonthlyRunSlotToLabel,
} from './jobs/monthly.js';
import { logSenderConfig } from './email/sender.js';
import { getModel } from './llm/openrouterClient.js';
import {
  getPromptPaths,
  loadMonthlyEmployeePrompt,
  loadMonthlyDepartmentPrompt,
} from './prompts/loadPrompts.js';

const app = express();
const PORT = Number(process.env.PORT) || 8080;

app.use(express.json());

const oauth2Client = new OAuth2Client();

/**
 * Validates Google OIDC ID token (Bearer) for Cloud Scheduler calls.
 * Uses OIDC_AUDIENCE (e.g. Cloud Run service URL). Optionally restricts to SCHEDULER_SA_EMAIL.
 * 401 on missing/invalid token; 403 if SCHEDULER_SA_EMAIL is set and token email does not match.
 */
export async function oidcAuth(req, res, next) {
  const authHeader = req.get('Authorization');
  if (!authHeader || typeof authHeader !== 'string') {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const match = /^\s*Bearer\s+(.+)\s*$/i.exec(authHeader);
  const idToken = match?.[1]?.trim();
  if (!idToken) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const audience = process.env.OIDC_AUDIENCE;
  if (!audience || typeof audience !== 'string' || !audience.trim()) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const ticket = await oauth2Client.verifyIdToken({ idToken, audience: audience.trim() });
    const payload = ticket.getPayload();
    if (!payload) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const allowedEmail = process.env.SCHEDULER_SA_EMAIL?.trim();
    if (allowedEmail) {
      const tokenEmail = payload.email && String(payload.email).trim();
      if (tokenEmail !== allowedEmail) {
        return res.status(403).json({ error: 'Forbidden' });
      }
    }

    return next();
  } catch (_err) {
    console.error('[oidcAuth] verifyIdToken failed:', _err?.message || _err);
    return res.status(401).json({ error: 'Unauthorized' });
  }
}

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

/**
 * Debug endpoint: proves OpenRouter config and which prompts are loaded (hashes + preview).
 * Safe: no secrets, no full prompt content. Use for Cloud Run verification.
 */
function sha256(str) {
  return crypto.createHash('sha256').update(String(str), 'utf8').digest('hex');
}
function preview(str) {
  if (str == null || typeof str !== 'string') return '';
  return str.replace(/\s+/g, ' ').trim().slice(0, 200);
}

app.get('/debug/llm', (_req, res) => {
  try {
    const paths = getPromptPaths();
    let employeePromptHash = null;
    let departmentPromptHash = null;
    let employeePromptPreview = null;
    let departmentPromptPreview = null;
    let loadError = null;
    try {
      const employeeContent = loadMonthlyEmployeePrompt();
      const departmentContent = loadMonthlyDepartmentPrompt();
      employeePromptHash = sha256(employeeContent);
      departmentPromptHash = sha256(departmentContent);
      employeePromptPreview = preview(employeeContent);
      departmentPromptPreview = preview(departmentContent);
    } catch (e) {
      loadError = e?.message ?? String(e);
    }
    res.json({
      openrouterConfigured: !!process.env.OPENROUTER_API_KEY,
      requestedModel: getModel(),
      employeePromptPath: paths.employeePromptPath,
      departmentPromptPath: paths.departmentPromptPath,
      employeePromptHash,
      departmentPromptHash,
      employeePromptPreview,
      departmentPromptPreview,
      ...(loadError && { loadError }),
    });
  } catch (err) {
    console.error('[debug/llm]', err);
    res.status(500).json({ error: err?.message ?? 'Internal server error' });
  }
});

/** Used by POST /run/weekly and /run/monthly; exported for unit tests with mocked store. */
export async function runJobWithIdempotency(jobType, getRange, runJob) {
  const range = getRange();
  const { label } = range;
  const isDryRun = process.env.DRY_RUN === '1';

  if (isDryRun) {
    // DRY_RUN=1: run job directly
    if (process.env.NODE_ENV !== 'production') {
      console.log('[idempotency] DRY_RUN=1 -> execute run directly');
    }
    return await runJob();
  }

  // Resend policy: do not block by historical ".sent" markers and do not mark as sent.
  // The same period can be re-sent multiple times intentionally.
  try {
    return await runJob();
  } catch (err) {
    throw err;
  }
}

app.post('/run/weekly', async (_req, res) => {
  try {
    const result = await runJobWithIdempotency('weekly', getPreviousCalendarWeekRange, () => runWeekly());
    if (result.skipped) {
      return res.status(200).json({ skipped: true, reason: result.reason, jobType: result.jobType, label: result.label });
    }
    if (result.dryRunPath) {
      return res.status(200).json({ ok: true, dryRunPath: result.dryRunPath });
    }
    res.status(200).json({ ok: true, payload: result.payload });
  } catch (err) {
    console.error('run/weekly error:', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

app.post('/run/monthly', async (req, res) => {
  try {

    if (req.query?.sendMode) {
      process.env.SEND_MODE = req.query.sendMode;
    }
    if (req.query?.testEmails) {
      process.env.TEST_EMAILS = req.query.testEmails;
    }
    
    const sendScopeRaw = req.query?.scope ?? req.body?.scope ?? process.env.MONTHLY_SEND_SCOPE;
    const runSlotRaw = req.query?.slot ?? req.body?.slot ?? process.env.MONTHLY_RUN_SLOT;
    let sendScope;
    let runSlot;
    try {
      sendScope = resolveMonthlySendScope(sendScopeRaw);
      runSlot = resolveMonthlyRunSlot(runSlotRaw);
    } catch (err) {
      return res.status(400).json({ error: err?.message ?? 'Invalid monthly options' });
    }

    const windowStartRaw = req.query?.windowStart ?? req.body?.windowStart ?? '5';
    const windowStart = parseInt(String(windowStartRaw), 10);
    if (!Number.isInteger(windowStart) || windowStart < 1 || windowStart > 31) {
      return res.status(400).json({ error: 'windowStart must be an integer day-of-month between 1 and 31.' });
    }

    const force = req.query?.force === '1' || req.query?.force === true || req.body?.force === true || req.body?.force === 1;
    if (!force && !isMonthlyReportSendDayForWindow(new Date(), 'Europe/Bucharest', windowStart, 3)) {
      return res.status(200).json({
        skipped: true,
        reason: 'not_monthly_send_day',
        message: `Monthly report runs only on the first working day in window ${windowStart}-${windowStart + 2} (Europe/Bucharest). Use ?force=1 to run anyway.`,
      });
    }
    // Always recompute all queries when sending monthly emails (no snapshot reads).
    const refresh = true;
    const getRangeWithSlot = () => {
      const range = getPreviousCalendarMonthRange();
      return { ...range, label: applyMonthlyRunSlotToLabel(range.label, runSlot) };
    };
    const result = await runJobWithIdempotency('monthly', getRangeWithSlot, () => runMonthly({ refresh, sendScope, runSlot }));
    if (result.skipped) {
      return res.status(200).json({ skipped: true, reason: result.reason, jobType: result.jobType, label: result.label });
    }
    if (result.dryRunPath) {
      return res.status(200).json({ ok: true, dryRunPath: result.dryRunPath });
    }
    res.status(200).json({ ok: true, payload: result.payload });
  } catch (err) {
    console.error('run/monthly error:', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

if (!process.env.VITEST) {
  app.listen(PORT, () => {
    logSenderConfig();
    if (process.env.NODE_ENV !== 'production') {
      console.log('[oidc-auth] OIDC_AUDIENCE is set:', !!process.env.OIDC_AUDIENCE);
    }
    console.log(`Backend listening on port ${PORT}`);
  });
}
