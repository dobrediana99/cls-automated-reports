/**
 * Retry wrapper for monthly Gmail send (transporter.sendMail).
 * Retries only transient failures (network, timeout, SMTP 4xx temp); no retry for auth/config.
 * Config via EMAIL_SEND_MAX_ATTEMPTS (default 3), EMAIL_SEND_BACKOFF_MS (default 1000).
 * Exponential backoff + small jitter. No secrets in logs.
 */

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_INITIAL_BACKOFF_MS = 1000;

/** Nodemailer / SMTP codes we treat as permanent (do not retry). */
const PERMANENT_CODES = new Set(['EAUTH', 'ENOAUTH', 'EOAUTH2', 'ECONFIG', 'EPROTOCOL']);

/** Nodemailer / network codes we treat as transient (retry). */
const TRANSIENT_CODES = new Set([
  'ECONNECTION',
  'ETIMEDOUT',
  'ECONNRESET',
  'EDNS',
  'ESOCKET',
  'ETLS',
]);

/** Message substrings that indicate transient (retry). */
const TRANSIENT_MESSAGE_PATTERN = /timeout|ECONNRESET|ETIMEDOUT|temporarily|try again|connection refused|ENOTFOUND|network/i;

/** Message substrings that indicate permanent (no retry). */
const PERMANENT_MESSAGE_PATTERN = /authentication|invalid credentials|invalid login|username and password/i;

/**
 * Classify send error as transient (retry) or permanent (fail fast).
 * @param {Error} err
 * @returns {{ transient: boolean, reason: string }}
 */
export function isTransientSendError(err) {
  if (!err || typeof err !== 'object') {
    return { transient: false, reason: 'unknown' };
  }
  const code = err.code ?? err.errno ?? '';
  const responseCode = err.responseCode ?? err.statusCode;
  const msg = String(err.message ?? '');

  if (PERMANENT_CODES.has(code) || PERMANENT_MESSAGE_PATTERN.test(msg)) {
    return { transient: false, reason: 'permanent' };
  }
  if (responseCode != null && responseCode >= 500) {
    return { transient: false, reason: 'permanent' };
  }
  if (TRANSIENT_CODES.has(code)) {
    return { transient: true, reason: 'transient' };
  }
  if (responseCode != null && responseCode >= 400 && responseCode < 500) {
    return { transient: true, reason: 'transient' };
  }
  if (TRANSIENT_MESSAGE_PATTERN.test(msg)) {
    return { transient: true, reason: 'transient' };
  }
  return { transient: false, reason: 'permanent' };
}

/**
 * Read retry config from env with safe defaults.
 * @returns {{ maxAttempts: number, initialBackoffMs: number }}
 */
export function getRetryConfig() {
  const maxAttempts = Math.max(1, parseInt(process.env.EMAIL_SEND_MAX_ATTEMPTS || '', 10) || DEFAULT_MAX_ATTEMPTS);
  const initialBackoffMs = Math.max(0, parseInt(process.env.EMAIL_SEND_BACKOFF_MS || '', 10) || DEFAULT_INITIAL_BACKOFF_MS);
  return { maxAttempts, initialBackoffMs };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Small jitter: [0, capMs) added to delay. No secrets.
 */
function jitterMs(capMs) {
  return Math.floor(Math.random() * Math.max(0, capMs));
}

/**
 * Send mail with retry on transient errors. Exponential backoff + jitter.
 * @param {object} transporter - Nodemailer transport (must have sendMail)
 * @param {object} mailOptions - Options passed to transporter.sendMail
 * @param {{ context?: string, maxAttempts?: number, initialBackoffMs?: number }} opts - Optional overrides and context for logs
 * @returns {Promise<object>} Result of sendMail
 * @throws {Error} Last error after exhausting retries or on permanent error
 */
export async function sendWithRetry(transporter, mailOptions, opts = {}) {
  const config = getRetryConfig();
  const maxAttempts = opts.maxAttempts ?? config.maxAttempts;
  const initialBackoffMs = opts.initialBackoffMs ?? config.initialBackoffMs;
  const context = opts.context ?? 'send';

  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await transporter.sendMail(mailOptions);
      return result;
    } catch (err) {
      lastErr = err;
      const { transient, reason } = isTransientSendError(err);
      const code = err?.code ?? err?.errno ?? '';
      const msg = (err?.message ?? String(err)).slice(0, 80);

      if (!transient || attempt >= maxAttempts) {
        if (attempt > 1) {
          console.error(
            `[email][retry] ${context} attempt=${attempt}/${maxAttempts} final failure reason=${reason} code=${code} message=${msg}`
          );
        }
        throw err;
      }

      const baseDelay = initialBackoffMs * Math.pow(2, attempt - 1);
      const delayMs = baseDelay + jitterMs(Math.min(500, baseDelay));
      console.warn(
        `[email][retry] ${context} attempt=${attempt}/${maxAttempts} reason=${reason} code=${code} nextAttemptInMs=${delayMs}`
      );
      await sleep(delayMs);
    }
  }
  throw lastErr;
}
