/**
 * Weekly email rendering (data-only, no AI). Returns HTML strings.
 * Uses standardized texts from content/weeklyTexts.js and template weeklyEmployeeDetails.
 */

import { getWeeklyIntroHtml } from './content/weeklyTexts.js';
import { getPersonRow } from './getPersonRow.js';
import { buildWeeklyEmployeeEmailHtml } from './templates/weeklyEmployeeDetails.js';

function roleForIntro(person) {
  return person.role === 'manager' ? 'manager' : 'employee';
}

/**
 * Returns HTML string for a weekly employee email: standardized intro ("Bună ziua, Nume Prenume,") + 2-column table filtered by department.
 */
export function renderWeeklyEmployeeEmail(report, person, meta) {
  const stats = getPersonRow(report, person);
  const introHtml = getWeeklyIntroHtml({
    role: roleForIntro(person),
    periodStart: meta?.periodStart,
    periodEnd: meta?.periodEnd,
    personName: person?.name,
  });
  return buildWeeklyEmployeeEmailHtml({
    introHtml,
    stats,
    department: person?.department,
    pageTitle: 'Raport săptămânal – Activitatea dvs.',
  });
}

/**
 * Returns HTML string for a weekly manager email: same structure (standardized intro + manager's own table, filtered by department) + intro mentions attachment.
 * Manager receives full XLSX attachment (handled by job).
 */
export function renderWeeklyManagerEmail(report, manager, meta) {
  const stats = getPersonRow(report, manager);
  const introHtml = getWeeklyIntroHtml({
    role: 'manager',
    periodStart: meta?.periodStart,
    periodEnd: meta?.periodEnd,
    personName: manager?.name,
  });
  return buildWeeklyEmployeeEmailHtml({
    introHtml,
    stats,
    department: manager?.department,
    noDataMessage: 'Nu există date individuale pentru dumneavoastră în această perioadă.',
    pageTitle: 'Raport săptămânal – Activitatea dvs. (raport complet atașat)',
  });
}
