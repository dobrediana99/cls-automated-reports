/**
 * Strict Ajv validation for monthly LLM output (employee and department).
 * Loads JSON schemas from backend/llm/schemas/. Employee: applies check-in rule in code (sectiunea_6 only when performancePct < 80).
 */

import Ajv from 'ajv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMAS_DIR = path.join(__dirname, 'schemas');

const ajv = new Ajv({ strict: true, allErrors: true });

const employeeSchema = JSON.parse(
  fs.readFileSync(path.join(SCHEMAS_DIR, 'monthlyEmployee.schema.json'), 'utf8')
);
const departmentSchema = JSON.parse(
  fs.readFileSync(path.join(SCHEMAS_DIR, 'monthlyDepartment.schema.json'), 'utf8')
);

const validateEmployeeSchema = ajv.compile(employeeSchema);
const validateDepartmentSchema = ajv.compile(departmentSchema);

/**
 * Check-in rule: sectiunea_6_check_in_intermediar must be present when performancePct < 80, and must be absent when performancePct >= 80.
 * @param {object} obj - Parsed employee output (already schema-valid)
 * @param {{ performancePct?: number | null }} opts - performancePct from job (e.g. (profit/target)*100). If undefined/null, we do not enforce (backward compat).
 * @throws {Error} If rule is violated
 */
function applyCheckInRule(obj, opts = {}) {
  const pct = opts.performancePct;
  if (pct !== undefined && pct !== null && typeof pct !== 'number') return;
  if (pct === undefined || pct === null) return; // no data => skip rule

  const hasS6 = obj && typeof obj === 'object' && 'sectiunea_6_check_in_intermediar' in obj && obj.sectiunea_6_check_in_intermediar != null;

  if (pct < 80 && !hasS6) {
    throw new Error(
      'LLM output invalid: performancePct < 80 but sectiunea_6_check_in_intermediar is missing. It must be present when performance is sub-standard.'
    );
  }
  if (pct >= 80 && hasS6) {
    throw new Error(
      'LLM output invalid: performancePct >= 80 but sectiunea_6_check_in_intermediar is present. It must be absent when performance is at or above standard.'
    );
  }
}

/**
 * Validate monthly employee LLM output. Schema + check-in rule.
 * @param {object} obj - Parsed JSON (e.g. from parseJsonFromText)
 * @param {{ performancePct?: number | null }} opts
 * @returns {object} The same object (validated)
 * @throws {Error} If validation or check-in rule fails
 */
export function validateEmployeeOutput(obj, opts = {}) {
  if (!obj || typeof obj !== 'object') {
    throw new Error('LLM output is not a valid object.');
  }
  const valid = validateEmployeeSchema(obj);
  if (!valid) {
    const msg = ajv.errorsText(validateEmployeeSchema.errors, { dataVar: 'output' });
    throw new Error(`LLM employee output schema validation failed: ${msg}`);
  }
  applyCheckInRule(obj, opts);
  return obj;
}

/**
 * Validate monthly department LLM output.
 * @param {object} obj - Parsed JSON (e.g. from parseJsonFromText)
 * @returns {object} The same object (validated)
 * @throws {Error} If validation fails
 */
export function validateDepartmentOutput(obj) {
  if (!obj || typeof obj !== 'object') {
    throw new Error('LLM department output is not a valid object.');
  }
  const valid = validateDepartmentSchema(obj);
  if (!valid) {
    const msg = ajv.errorsText(validateDepartmentSchema.errors, { dataVar: 'output' });
    throw new Error(`LLM department output schema validation failed: ${msg}`);
  }
  return obj;
}

/**
 * Return the raw JSON schema object for an operation (for OpenRouter response_format when supported).
 * @param {'employee' | 'department'} operationName
 * @returns {object} JSON schema object
 */
export function getMonthlySchema(operationName) {
  return operationName === 'department' ? departmentSchema : employeeSchema;
}
