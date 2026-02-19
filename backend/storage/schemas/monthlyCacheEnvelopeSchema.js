/**
 * JSON schema and validator for GCS monthly cache envelope.
 * Used by gcsMonthlyCache.js to validate shape before returning data to runMonthly.
 * Invalid payload → treat as cache miss (return null); no secrets in logs.
 */

import Ajv from 'ajv';

const CACHE_ENVELOPE_SCHEMA = {
  type: 'object',
  required: ['schemaVersion', 'data'],
  properties: {
    schemaVersion: { type: 'number', const: 1 },
    data: {
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
const validateSchema = ajv.compile(CACHE_ENVELOPE_SCHEMA);

/**
 * Validate cache envelope document shape. Does not log; caller logs on failure.
 * @param {object} doc - Parsed envelope (schemaVersion, data: { meta, reportSummary, report })
 * @returns {{ valid: boolean, errors?: string[] }}
 */
export function validateMonthlyCacheEnvelope(doc) {
  if (!doc || typeof doc !== 'object') {
    return { valid: false, errors: ['envelope is not an object'] };
  }
  const valid = validateSchema(doc);
  if (!valid) {
    const messages = (validateSchema.errors || []).map(
      (e) => `${e.instancePath || '/'} ${e.message}`
    );
    return { valid: false, errors: messages };
  }
  return { valid: true };
}
