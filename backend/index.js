import express from 'express';
import { OAuth2Client } from 'google-auth-library';
import { getPreviousCalendarWeekRange } from './lib/dateRanges.js';
import { getPreviousCalendarMonthRange } from './lib/dateRanges.js';
import { runWeekly } from './jobs/weekly.js';
import { runMonthly } from './jobs/monthly.js';
import * as idempotency from './idempotency/localFileStore.js';
import { logSenderConfig } from './email/sender.js';

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
    return res.status(401).json({ error: 'Unauthorized' });
  }
}

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

/** Used by POST /run/weekly and /run/monthly; exported for unit tests with mocked store. */
export async function runJobWithIdempotency(jobType, getRange, runJob) {
  const range = getRange();
  const { label } = range;
  const isDryRun = process.env.DRY_RUN === '1';

  if (isDryRun) {
    // DRY_RUN=1: never block on idempotency, run job, never mark as sent
    if (process.env.NODE_ENV !== 'production') {
      console.log('[idempotency] DRY_RUN=1 -> skip idempotency check and mark');
    }
    return await runJob();
  }

  if (idempotency.wasAlreadySent(jobType, label)) {
    console.log('[idempotency] already sent -> skip', jobType, label);
    return { skipped: true, reason: 'already_sent', jobType, label };
  }

  try {
    const result = await runJob();
    idempotency.markAsSent(jobType, label);
    console.log('[idempotency] marked sent ->', jobType, label);
    return result;
  } catch (err) {
    // Do not mark as sent on failure
    throw err;
  }
}

app.post('/run/weekly', oidcAuth, async (_req, res) => {
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

app.post('/run/monthly', oidcAuth, async (req, res) => {
  try {
    const refresh = req.query?.refresh === '1' || req.query?.refresh === true || req.body?.refresh === true || req.body?.refresh === 1;
    const result = await runJobWithIdempotency('monthly', getPreviousCalendarMonthRange, () => runMonthly({ refresh }));
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
