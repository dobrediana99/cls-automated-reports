/**
 * JSON schema and validator for monthly report snapshot (v1).
 * Used by monthlySnapshots.js to validate shape before use in runMonthly.
 * Invalid payload → treat as cache miss (return null); no secrets in logs.
 */

import Ajv from 'ajv';

const SNAPSHOT_SCHEMA = {
  type: 'object',
  required: ['schemaVersion', 'kind', 'period', 'derived'],
  properties: {
    schemaVersion: { const: '1.0' },
    kind: { const: 'cls.monthlyReportSnapshot' },
    period: {
      type: 'object',
      required: ['month'],
      properties: {
        month: { type: 'string', pattern: '^\\d{4}-\\d{2}$' },
      },
    },
    derived: {
      type: 'object',
      required: ['meta', 'reportSummary', 'report'],
      properties: {
        meta: {
          type: 'object',
          required: ['periodStart', 'periodEnd', 'label'],
          properties: {
            periodStart: { type: 'string' },
            periodEnd: { type: 'string' },
            label: { type: 'string' },
          },
        },
        reportSummary: { type: 'object' },
        report: { type: 'object' },
      },
    },
  },
};

const ajv = new Ajv({ allErrors: true });
const validateSchema = ajv.compile(SNAPSHOT_SCHEMA);

/**
 * Validate snapshot document shape. Does not log; caller logs on failure.
 * @param {object} doc - Parsed snapshot object
 * @param {string} month - Expected YYYY-MM (must match doc.period.month)
 * @returns {{ valid: boolean, errors?: string[] }}
 */
export function validateMonthlySnapshot(doc, month) {
  if (!doc || typeof doc !== 'object') {
    return { valid: false, errors: ['document is not an object'] };
  }
  const valid = validateSchema(doc);
  if (!valid) {
    const messages = (validateSchema.errors || []).map(
      (e) => `${e.instancePath || '/'} ${e.message}`
    );
    return { valid: false, errors: messages };
  }
  if (doc.period?.month !== month) {
    return { valid: false, errors: [`period.month "${doc.period?.month}" does not match expected "${month}"`] };
  }
  return { valid: true };
}
