/**
 * Centralized email send behavior: SEND_MODE (test|prod), TEST_EMAILS, subject prefix, logging.
 * Used by weekly and future monthly jobs. DRY_RUN is unchanged (no sending); SEND_MODE applies only when not DRY_RUN.
 */

const TEST_PREFIX = '[TEST] ';

/**
 * @returns {'test'|'prod'} Default: 'test'.
 */
export function getSendMode() {
  return process.env.SEND_MODE === 'prod' ? 'prod' : 'test';
}

/**
 * Parsed TEST_EMAILS (trimmed, non-empty). Used only in test mode.
 * @returns {string[]}
 */
export function getTestEmails() {
  const raw = process.env.TEST_EMAILS || '';
  return raw.split(',').map((e) => e.trim()).filter(Boolean);
}

/**
 * Resolve recipients: in test mode return TEST_EMAILS (throw if empty); in prod return realRecipients.
 * @param {string[]} realRecipients - Intended recipients from org config.
 * @returns {string[]} Recipients to use for this send.
 * @throws {Error} If SEND_MODE=test and TEST_EMAILS is empty.
 */
export function resolveRecipients(realRecipients) {
  const mode = getSendMode();
  if (mode === 'prod') {
    return Array.isArray(realRecipients) ? [...realRecipients] : [];
  }
  const testList = getTestEmails();
  if (testList.length === 0) {
    throw new Error('TEST_EMAILS must be set when SEND_MODE=test (comma-separated list of recipient emails)');
  }
  return [...testList];
}

/**
 * Resolve subject: in test mode prefix with "[TEST] "; in prod no prefix.
 * @param {string} subject
 * @returns {string}
 */
export function resolveSubject(subject) {
  const mode = getSendMode();
  if (mode === 'test') {
    return TEST_PREFIX + (subject || '');
  }
  return subject || '';
}

/**
 * Log send config at startup (safe, no secrets). Call once when server starts.
 */
export function logSenderConfig() {
  const mode = getSendMode();
  const testEmails = getTestEmails();
  const configured = testEmails.length > 0;
  console.log('[email] SEND_MODE:', mode);
  if (mode === 'test') {
    console.log('[email] TEST_EMAILS configured:', configured, configured ? `(${testEmails.length} address(es))` : '');
    if (configured && process.env.NODE_ENV !== 'production') {
      console.log('[email] TEST_EMAILS list (local dev):', testEmails.join(', '));
    }
  }
}

/**
 * Log when sending: original recipients count and actual recipients used (safe, no secrets).
 * @param {number} originalCount - Number of intended recipients (e.g. 1 per email).
 * @param {string[]} actualRecipients - Resolved list (test list or real).
 */
export function logSendRecipients(originalCount, actualRecipients) {
  const count = Array.isArray(actualRecipients) ? actualRecipients.length : 0;
  console.log('[email] send: original recipients count:', originalCount, ', actual recipients used:', count);
}
