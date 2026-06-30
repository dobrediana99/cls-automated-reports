/**
 * Centralized runtime config validation for monthly flow.
 * Fails fast with operator-friendly errors before heavy work starts.
 * No secrets in error messages.
 */

/**
 * @param {NodeJS.ProcessEnv} [env] - Defaults to process.env
 * @returns {string|undefined}
 */
function getEnv(env, key) {
  const e = env ?? process.env;
  const v = e[key];
  return v !== undefined && v !== '' ? String(v).trim() : undefined;
}

/**
 * Validate numeric env: if set, must be finite and satisfy predicate.
 * @param {object} opts
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @param {string} opts.key
 * @param {string} opts.description - e.g. "must be a positive number"
 * @param {(n: number) => boolean} opts.predicate
 * @throws {Error}
 */
function validateNumericEnv({ env, key, description, predicate }) {
  const raw = getEnv(env, key);
  if (raw === undefined) return;
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    throw new Error(`${key} must be a number (got: "${raw}"). ${description}.`);
  }
  if (!predicate(n)) {
    throw new Error(`${key} ${description} (got: ${n}).`);
  }
}

/**
 * Validate integer env: if set, must be integer and satisfy predicate.
 * @param {object} opts
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @param {string} opts.key
 * @param {string} opts.description - e.g. "must be an integer >= 1"
 * @param {(n: number) => boolean} opts.predicate
 * @throws {Error}
 */
function validateIntEnv({ env, key, description, predicate }) {
  const raw = getEnv(env, key);
  if (raw === undefined) return;
  const n = parseInt(raw, 10);
  if (String(n) !== raw.trim() || !Number.isFinite(n)) {
    throw new Error(`${key} must be an integer (got: "${raw}"). ${description}.`);
  }
  if (!predicate(n)) {
    throw new Error(`${key} ${description} (got: ${n}).`);
  }
}

/**
 * Validate monthly runtime config. Throws on first validation failure.
 * Call before any heavy compute (periods, Monday, OpenRouter, etc.).
 *
 * @param {object} opts
 * @param {boolean} [opts.dryRun] - true if DRY_RUN=1
 * @param {'test'|'prod'} [opts.sendMode] - resolved send mode (default 'test' when not 'prod')
 * @param {NodeJS.ProcessEnv} [opts.env] - defaults to process.env (for tests)
 * @throws {Error} With operator-friendly message; no secrets.
 */
export function validateMonthlyRuntimeConfig(opts = {}) {
  const dryRun = opts.dryRun === true;
  const sendMode = opts.sendMode === 'prod' ? 'prod' : 'test';
  const env = opts.env ?? process.env;

  // --- Required for monthly (always) ---
  // Data source is the CRM report endpoint (replaces Monday.com).
  const crmUrl = getEnv(env, 'CRM_REPORTS_URL');
  if (!crmUrl) {
    throw new Error('CRM_REPORTS_URL must be set: the CRM report endpoint that provides report data.');
  }
  const crmSecret = getEnv(env, 'CRM_REPORTS_SECRET');
  if (!crmSecret) {
    throw new Error('CRM_REPORTS_SECRET must be set to authenticate with the CRM report endpoint.');
  }

  const openRouterKey = getEnv(env, 'OPENROUTER_API_KEY');
  if (!openRouterKey) {
    throw new Error('OPENROUTER_API_KEY must be set for monthly LLM. Get a key at https://openrouter.ai');
  }

  // --- Required for NON-DRY_RUN (sending) ---
  if (!dryRun) {
    const gmailUser = getEnv(env, 'GMAIL_USER');
    const gmailAppPassword = getEnv(env, 'GMAIL_APP_PASSWORD');
    if (sendMode === 'prod' && !gmailUser) {
      throw new Error('GMAIL_USER must be set for monthly email send in SEND_MODE=prod (non-DRY_RUN).');
    }
    if (!gmailAppPassword) {
      throw new Error('GMAIL_APP_PASSWORD must be set for monthly email send (non-DRY_RUN).');
    }

    // SEND_MODE=test => TEST_EMAILS must be non-empty
    if (sendMode === 'test') {
      const testEmailsRaw = getEnv(env, 'TEST_EMAILS');
      const list = testEmailsRaw ? testEmailsRaw.split(',').map((e) => e.trim()).filter(Boolean) : [];
      if (list.length === 0) {
        throw new Error('TEST_EMAILS must be set when SEND_MODE=test (comma-separated list of recipient emails). Non-DRY_RUN monthly send requires at least one test address in test mode.');
      }
    }
  }

  // --- SEND_MODE must be test or prod (explicit) ---
  const sendModeRaw = getEnv(env, 'SEND_MODE');
  if (sendModeRaw !== undefined && sendModeRaw !== 'test' && sendModeRaw !== 'prod') {
    throw new Error(`SEND_MODE must be "test" or "prod" (got: "${sendModeRaw}").`);
  }

  // --- Numeric envs (OpenRouter) ---
  validateNumericEnv({
    env,
    key: 'OPENROUTER_TIMEOUT_MS',
    description: 'must be a positive number (milliseconds)',
    predicate: (n) => n > 0,
  });
  validateNumericEnv({
    env,
    key: 'OPENROUTER_MAX_TOKENS',
    description: 'must be a positive number',
    predicate: (n) => n > 0,
  });

  // --- Numeric envs (CRM report client) ---
  validateNumericEnv({
    env,
    key: 'CRM_REPORTS_TIMEOUT_MS',
    description: 'must be a positive number (milliseconds)',
    predicate: (n) => n > 0,
  });
  validateIntEnv({
    env,
    key: 'CRM_REPORTS_MAX_ATTEMPTS',
    description: 'must be an integer >= 1',
    predicate: (n) => n >= 1,
  });
}
