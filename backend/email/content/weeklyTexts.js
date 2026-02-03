/**
 * Standardized subject and body texts for weekly emails.
 * Single source of truth: formal Romanian, consistent structure.
 */

import { DateTime } from 'luxon';

const TZ = 'Europe/Bucharest';

/**
 * Format period for display: "DD.MM.YYYY – DD.MM.YYYY"
 * @param {string} periodStart - ISO date string
 * @param {string} periodEnd - ISO date string
 * @returns {string}
 */
export function formatPeriodForEmail(periodStart, periodEnd) {
  if (!periodStart || !periodEnd) return '';
  const start = DateTime.fromISO(periodStart, { zone: TZ });
  const end = DateTime.fromISO(periodEnd, { zone: TZ });
  if (!start.isValid || !end.isValid) return '';
  return `${start.toFormat('dd.MM.yyyy')} – ${end.toFormat('dd.MM.yyyy')}`;
}

/**
 * Standardized subject for weekly email.
 * @param {object} opts - { role, periodStart, periodEnd }
 * @param {'employee'|'manager'} opts.role
 * @returns {string} Subject line (without [TEST] prefix; caller uses resolveSubject for that)
 */
export function getWeeklySubject({ role, periodStart, periodEnd }) {
  const period = formatPeriodForEmail(periodStart, periodEnd);
  if (!period) return 'Raport săptămânal';

  if (role === 'manager') {
    return `Raport săptămânal – Activitatea dvs. (raport complet atașat) | ${period}`;
  }
  return `Raport săptămânal – Activitatea dvs. | ${period}`;
}

/**
 * Standardized intro HTML for weekly email body (paragraphs only; table is added by template).
 * @param {object} opts - { role, periodStart, periodEnd, personName }
 * @param {'employee'|'manager'} opts.role
 * @param {string} [opts.personName] - "Nume Prenume" for salutation: "Bună ziua, Nume Prenume,"
 * @returns {string} HTML fragment (paragraphs)
 */
export function getWeeklyIntroHtml({ role, periodStart, periodEnd, personName }) {
  const period = formatPeriodForEmail(periodStart, periodEnd);
  const periodPhrase = period ? `din perioada ${period}` : 'din perioada raportată';

  const escapeHtml = (s) => {
    if (typeof s !== 'string') return '';
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  };

  const p = (text) => `<p style="margin: 0 0 1em 0;">${escapeHtml(text)}</p>`;

  const salutation = personName ? `Bună ziua, ${personName.trim()},` : 'Bună ziua,';

  const introEmployee = [
    salutation,
    '',
    `Activitatea dumneavoastră ${periodPhrase} este prezentată mai jos, sub forma unui tabel cu indicatorii individuali de performanță.`,
    '',
    'Pentru orice neclarități legate de datele afișate, vă rugăm să luați legătura cu managerul direct.',
    '',
    'Vă mulțumim.',
  ].join('\n');

  const introManager = [
    salutation,
    '',
    `Activitatea dumneavoastră ${periodPhrase} este prezentată mai jos, sub forma unui tabel cu indicatorii individuali de performanță.`,
    '',
    'Raportul complet, care include activitatea tuturor angajaților, precum și matricile globale la nivel de companie, este atașat acestui email, în format Excel.',
    '',
    'Vă mulțumim.',
  ].join('\n');

  const paragraphs = (role === 'manager' ? introManager : introEmployee).split('\n\n').filter(Boolean);
  return paragraphs.map((block) => p(block)).join('\n');
}
