/**
 * Enterprise-grade Monday API HTTP client: global concurrency limiter, min delay between requests,
 * timeout, retry with exponential backoff + jitter, Retry-After support. GraphQL 200+errors that
 * indicate 429/rate limit are treated as retryable. Single central place for all Monday requests.
 */

const MONDAY_API_URL = 'https://api.monday.com/v2';

const DEFAULT_MAX_CONCURRENT = 2;
const DEFAULT_MIN_DELAY_MS = 200;
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_ATTEMPTS = 8;
const DEFAULT_RETRY_BASE_MS = 800;
const DEFAULT_RETRY_MAX_MS = 30_000;
const JITTER_FRACTION = 0.3;

function envInt(name, defaultVal) {
  const v = process.env[name];
  if (v === undefined || v === '') return defaultVal;
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? defaultVal : n;
}

function getConfig() {
  return {
    maxConcurrent: envInt('MONDAY_MAX_CONCURRENT', DEFAULT_MAX_CONCURRENT),
    minDelayMs: envInt('MONDAY_MIN_DELAY_MS', DEFAULT_MIN_DELAY_MS),
    defaultTimeoutMs: envInt('MONDAY_TIMEOUT_MS', DEFAULT_TIMEOUT_MS),
    maxAttempts: envInt('MONDAY_MAX_ATTEMPTS', DEFAULT_MAX_ATTEMPTS),
    baseDelayMs: envInt('MONDAY_RETRY_BASE_MS', DEFAULT_RETRY_BASE_MS),
    maxDelayMs: envInt('MONDAY_RETRY_MAX_MS', DEFAULT_RETRY_MAX_MS),
  };
}

let lastRequestStart = 0;
const queue = [];
let running = 0;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function jitter(baseMs) {
  const j = baseMs * JITTER_FRACTION * Math.random();
  return Math.floor(baseMs + j);
}

/**
 * Parse Retry-After header: seconds (number) or HTTP-date. Returns seconds (number) or null.
 */
function parseRetryAfter(value) {
  if (value == null || value === '') return null;
  const s = String(value).trim();
  const n = parseInt(s, 10);
  if (!isNaN(n) && n >= 0) return n;
  const date = new Date(s);
  if (!isNaN(date.getTime())) {
    const secs = Math.ceil((date.getTime() - Date.now()) / 1000);
    return secs > 0 ? secs : 1;
  }
  return null;
}

function computeDelay(attempt, retryAfterSeconds, config) {
  let delay = Math.min(config.baseDelayMs * Math.pow(2, attempt - 1), config.maxDelayMs);
  delay = jitter(delay);
  if (retryAfterSeconds != null && retryAfterSeconds > 0) {
    const retryAfterMs = retryAfterSeconds * 1000;
    delay = Math.max(delay, retryAfterMs);
  }
  return delay;
}

/** True if HTTP status is retryable (429, 502, 503, 504). */
function isRetryableStatus(status) {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

/** True if error is network/timeout. */
function isNetworkError(err) {
  if (err?.cause?.code === 'ECONNRESET' || err?.cause?.code === 'ETIMEDOUT') return true;
  if (err?.name === 'AbortError') return true;
  if (err?.name === 'TypeError' && (err?.message?.includes('fetch') || err?.message?.includes('network'))) return true;
  return false;
}

/**
 * GraphQL 200 response with errors: treat as retryable if rate limit (429), internal/5xx message, or extensions.status_code >= 500.
 */
function isRetryableGraphQLError(errors) {
  if (!Array.isArray(errors) || errors.length === 0) return false;
  const first = errors[0];
  const msg = (first?.message ?? String(first)).toLowerCase();
  const ext = first?.extensions;
  const statusCode = ext?.status_code ?? ext?.statusCode;
  const is5xx = typeof statusCode === 'number' && statusCode >= 500;
  return (
    msg.includes('429') ||
    msg.includes('rate limit') ||
    (msg.includes('column_values') && msg.includes('429')) ||
    msg.includes('internal server error') ||
    is5xx
  );
}

function pump() {
  const config = getConfig();
  while (running < config.maxConcurrent && queue.length > 0) {
    const now = Date.now();
    const wait = lastRequestStart + config.minDelayMs - now;
    if (wait > 0) {
      sleep(wait).then(() => {
        lastRequestStart = Date.now();
        runNext();
      });
      return;
    }
    lastRequestStart = Date.now();
    runNext();
  }
}

function runNext() {
  if (queue.length === 0) return;
  const { task, resolve, reject } = queue.shift();
  running++;
  Promise.resolve()
    .then(() => task())
    .then(resolve, reject)
    .finally(() => {
      running--;
      pump();
    });
}

/**
 * Enqueue a task. Respects maxConcurrent and minDelayMs between request starts.
 */
function enqueue(task) {
  return new Promise((resolve, reject) => {
    queue.push({ task, resolve, reject });
    pump();
  });
}

/**
 * Single Monday API request with timeout and retries. Called only from within enqueue.
 */
async function doRequest({ query, variables, operationName, timeoutMs }) {
  const token = process.env.MONDAY_API_TOKEN;
  if (!token || !String(token).trim()) {
    throw new Error('MONDAY_API_TOKEN is not set');
  }

  const config = getConfig();
  const timeout = timeoutMs ?? config.defaultTimeoutMs;
  const op = operationName ?? 'unknown';
  let lastError;

  for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const body = variables !== undefined
        ? { query, variables, operationName: op }
        : { query, operationName: op };
      const response = await fetch(MONDAY_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: token,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const rawText = await response.text();

      let json;
      try {
        json = rawText ? JSON.parse(rawText) : {};
      } catch (_) {
        json = {};
      }

      if (!response.ok) {
        const status = response.status;
        const details = rawText ? rawText.slice(0, 2000) : "";
        console.error("[monday][http-error]", { op, status, details });
        const config = getConfig();
        if (isRetryableStatus(status) && attempt < config.maxAttempts) {
          const retryAfterSecs = parseRetryAfter(response.headers?.get?.('Retry-After'));
          const waitMs = computeDelay(attempt, retryAfterSecs, config);
          console.log(
            `[monday][retry] op=${op} attempt=${attempt}/${config.maxAttempts} status=${status} waitMs=${waitMs} reason=HTTP`
          );
          await sleep(waitMs);
          continue;
        }
        lastError = new Error(json.error_message || json.message || `HTTP ${response.status}`);
        lastError.statusCode = status;
        throw lastError;
      }

      if (json.errors && json.errors.length > 0) {
        const config = getConfig();
        if (isRetryableGraphQLError(json.errors) && attempt < config.maxAttempts) {
          const retryAfterSecs = parseRetryAfter(response.headers?.get?.('Retry-After'));
          const waitMs = computeDelay(attempt, retryAfterSecs, config);
          const msg = json.errors[0]?.message ?? String(json.errors[0]);
          console.log(
            `[monday][retry] op=${op} attempt=${attempt}/${config.maxAttempts} status=429 waitMs=${waitMs} reason=GraphQL: ${msg.slice(0, 60)}`
          );
          await sleep(waitMs);
          continue;
        }
        const msg = json.errors[0]?.message ?? String(json.errors[0]);
        console.error('[monday][graphql-error]', {
          op,
          msg,
          variables: variables ?? null,
          errors: JSON.parse(JSON.stringify(json.errors)),
        });
        lastError = new Error(msg);
        lastError.statusCode = 400;
        throw lastError;
      }

      return json;
    } catch (err) {
      lastError = err;
      const config = getConfig();
      const isRetryable =
        (err?.statusCode && isRetryableStatus(err.statusCode)) ||
        isNetworkError(err) ||
        err?.name === 'AbortError';

      if (isRetryable && attempt < config.maxAttempts) {
        const status = err?.statusCode ?? (err?.name === 'AbortError' ? 'timeout' : 'network');
        const waitMs = computeDelay(attempt, err?.retryAfter ?? null, config);
        console.log(
          `[monday][retry] op=${op} attempt=${attempt}/${config.maxAttempts} status=${status} waitMs=${waitMs} reason=${err?.message?.slice(0, 50) ?? 'error'}`
        );
        await sleep(waitMs);
        continue;
      }

      const finalErr = lastError instanceof Error ? lastError : new Error(String(lastError));
      finalErr.statusCode = finalErr.statusCode ?? (finalErr.name === 'AbortError' ? 408 : 0);
      finalErr.operationName = op;
      throw finalErr;
    }
  }

  const finalErr = lastError instanceof Error ? lastError : new Error('Monday request failed after retries');
  finalErr.statusCode = lastError?.statusCode;
  finalErr.operationName = op;
  throw finalErr;
}

/**
 * Make a Monday API request. Uses global concurrency limiter and min delay.
 * Retries on 429, 502/503/504, network errors. Respects Retry-After. Fails fast on 400/401/403.
 * GraphQL 200+errors containing "429" or "rate limit" or "column_values - 429" are retried.
 *
 * @param {{ query: string, variables?: object, operationName?: string, timeoutMs?: number }} opts
 * @returns {Promise<object>} Full JSON response (data + errors if any; on success errors are absent)
 */
export async function mondayRequest(opts) {
  const { query, variables, operationName, timeoutMs } = opts;
  return enqueue(() => doRequest({ query, variables, operationName, timeoutMs }));
}
