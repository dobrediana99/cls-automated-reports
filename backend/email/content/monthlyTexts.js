/**
 * Standardized subject and salutation for monthly emails.
 * Single source of truth; used by monthly employee and management emails.
 */

import { DateTime } from 'luxon';

const TZ = 'Europe/Bucharest';

/**
 * Format period as "Luna YYYY" (e.g. "Ianuarie 2026") from periodStart ISO string.
 * @param {string} periodStart - ISO date string (e.g. 2026-01-01)
 * @returns {string}
 */
export function formatMonthYear(periodStart) {
  if (!periodStart) return '';
  const dt = DateTime.fromISO(periodStart, { zone: TZ });
  if (!dt.isValid) return '';
  const formatted = dt.setLocale('ro').toFormat('LLLL yyyy');
  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}

/**
 * Subject for monthly employee email: "Raport performanță – <Nume Prenume> | <Luna YYYY>"
 * @param {string} personName - "Nume Prenume"
 * @param {string} periodStart - ISO date (start of reported month)
 * @returns {string}
 */
export function getMonthlyEmployeeSubject(personName, periodStart) {
  const monthYear = formatMonthYear(periodStart);
  if (!monthYear) return 'Raport performanță';
  const name = (personName || '').trim() || 'Angajat';
  return `Raport performanță – ${name} | ${monthYear}`;
}

/**
 * Subject for monthly management email: "Raport performanță departamentală | <Luna YYYY>"
 * @param {string} periodStart - ISO date (start of reported month)
 * @returns {string}
 */
export function getMonthlyDepartmentSubject(periodStart) {
  const monthYear = formatMonthYear(periodStart);
  if (!monthYear) return 'Raport performanță departamentală';
  return `Raport performanță departamentală | ${monthYear}`;
}

/**
 * Salutation for monthly emails: "Bună ziua, <Nume Prenume>,"
 * @param {string} personName - "Nume Prenume"
 * @returns {string}
 */
export function getMonthlySalutation(personName) {
  const name = (personName || '').trim();
  return name ? `Bună ziua, ${name},` : 'Bună ziua,';
}
