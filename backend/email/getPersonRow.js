/**
 * Shared helper: get one person's stats row from a report by department.
 * Used by monthly and weekly email rendering and by monthly job (data3Months).
 * Matches by mondayUserId first, then by name (single match); logs warnings on empty list, mismatch, ambiguous name, or no match.
 */

import { DEPARTMENTS } from '../config/org.js';

/**
 * Get the stats row for a person from report (opsStats/salesStats/mgmtStats by department).
 * @param {object} report - { opsStats, salesStats, mgmtStats }
 * @param {{ name: string, department: string, mondayUserId?: string|number }} person
 * @returns {object|null} Row object or null
 */
export function getPersonRow(report, person) {
  const { opsStats, salesStats, mgmtStats } = report;
  const list =
    person.department === DEPARTMENTS.MANAGEMENT
      ? mgmtStats
      : person.department === DEPARTMENTS.SALES
        ? salesStats
        : person.department === DEPARTMENTS.OPERATIONS
          ? opsStats
          : [];

  if (!list || list.length === 0) {
    console.warn('[getPersonRow] empty list for department', { person: person.name, department: person.department });
    return null;
  }

  const hasMondayId = person.mondayUserId != null && String(person.mondayUserId).trim() !== '';
  if (hasMondayId) {
    const byMondayId = list.find((r) => String(r.mondayId) === String(person.mondayUserId));
    if (byMondayId) return byMondayId;
    console.warn('[getPersonRow] no row for mondayUserId', { name: person.name, mondayUserId: person.mondayUserId, department: person.department });
  }

  const byName = list.filter((r) => r.name === person.name);
  if (byName.length === 1) return byName[0];
  if (byName.length > 1) {
    console.warn('[getPersonRow] ambiguous match by name', { name: person.name, department: person.department });
    return null;
  }

  console.warn('[getPersonRow] no match', { name: person.name, department: person.department });
  return null;
}
