/**
 * Shared helper: sanitize email for use in filenames (no @ or .).
 * Used by monthly and weekly jobs when writing dry-run HTML per person.
 */

/**
 * @param {string} [email]
 * @returns {string}
 */
export function sanitizeEmailForFilename(email) {
  if (!email || typeof email !== 'string') return 'unknown';
  return email.replace(/@/g, '_at_').replace(/\./g, '_');
}
