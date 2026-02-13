/**
 * Loads permanent prompt files from backend/prompts/.
 * Single source of truth: monthlyEmployeePrompt.md, monthlyDepartmentPrompt.md.
 * Throws at runtime if a required file is missing.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MONTHLY_EMPLOYEE_PROMPT_FILE = 'monthlyEmployeePrompt.md';
const MONTHLY_DEPARTMENT_PROMPT_FILE = 'monthlyDepartmentPrompt.md';

/**
 * Resolves path to a prompt file in backend/prompts/.
 * @param {string} filename
 * @returns {string} Absolute path
 */
export function resolvePromptPath(filename) {
  return path.join(__dirname, filename);
}

/** Absolute paths for debug/llm. */
export function getPromptPaths() {
  return {
    employeePromptPath: path.join(__dirname, MONTHLY_EMPLOYEE_PROMPT_FILE),
    departmentPromptPath: path.join(__dirname, MONTHLY_DEPARTMENT_PROMPT_FILE),
  };
}

/**
 * Loads the monthly employee prompt (instructions for individual performance analysis).
 * @returns {string} Raw markdown content
 * @throws {Error} If file is missing or unreadable
 */
export function loadMonthlyEmployeePrompt() {
  const filePath = resolvePromptPath(MONTHLY_EMPLOYEE_PROMPT_FILE);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing prompt file: ${filePath}. Required for monthly employee emails.`);
  }
  return fs.readFileSync(filePath, 'utf8');
}

/**
 * Loads the monthly department prompt (instructions for management/department report).
 * @returns {string} Raw markdown content
 * @throws {Error} If file is missing or unreadable
 */
export function loadMonthlyDepartmentPrompt() {
  const filePath = resolvePromptPath(MONTHLY_DEPARTMENT_PROMPT_FILE);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing prompt file: ${filePath}. Required for monthly management email.`);
  }
  return fs.readFileSync(filePath, 'utf8');
}
