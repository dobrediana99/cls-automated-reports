import express from 'express';
import { getPreviousCalendarWeekRange } from './lib/dateRanges.js';
import { getPreviousCalendarMonthRange } from './lib/dateRanges.js';
import { runWeekly } from './jobs/weekly.js';
import { runMonthly } from './jobs/monthly.js';
import * as idempotency from './idempotency/localFileStore.js';
import { logSenderConfig } from './email/sender.js';

const app = express();
const PORT = Number(process.env.PORT) || 8080;

app.use(express.json());

/** Require X-Job-Token header to match JOB_TOKEN for /run/*. Header name is case-insensitive (req.get). */
export function jobTokenAuth(req, res, next) {
  const token = req.get('X-Job-Token');
  const expected = process.env.JOB_TOKEN;
  if (!expected || token !== expected) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
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

app.post('/run/weekly', jobTokenAuth, async (_req, res) => {
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

app.post('/run/monthly', jobTokenAuth, async (req, res) => {
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
      console.log('[job-auth] JOB_TOKEN is set:', !!process.env.JOB_TOKEN);
    }
    console.log(`Backend listening on port ${PORT}`);
  });
}
