import { describe, it, expect } from 'vitest';
import { formatPeriodForEmail, getWeeklySubject, getWeeklyIntroHtml } from './weeklyTexts.js';

describe('formatPeriodForEmail', () => {
  it('returns DD.MM.YYYY – DD.MM.YYYY for ISO period', () => {
    const out = formatPeriodForEmail('2026-01-19T00:00:00.000+02:00', '2026-01-25T23:59:59.999+02:00');
    expect(out).toBe('19.01.2026 – 25.01.2026');
  });
});

describe('getWeeklySubject', () => {
  it('returns employee subject format', () => {
    const s = getWeeklySubject({ role: 'employee', periodStart: '2026-01-19', periodEnd: '2026-01-25' });
    expect(s).toContain('Raport săptămânal – Activitatea dvs. |');
    expect(s).toContain('19.01.2026 – 25.01.2026');
    expect(s).not.toContain('raport complet atașat');
  });

  it('returns manager subject format with (raport complet atașat)', () => {
    const s = getWeeklySubject({ role: 'manager', periodStart: '2026-01-19', periodEnd: '2026-01-25' });
    expect(s).toContain('Raport săptămânal – Activitatea dvs. (raport complet atașat) |');
    expect(s).toContain('19.01.2026 – 25.01.2026');
  });
});

describe('getWeeklyIntroHtml', () => {
  it('employee intro contains Bună ziua, Nume Prenume when personName provided', () => {
    const html = getWeeklyIntroHtml({ role: 'employee', periodStart: '2026-01-19', periodEnd: '2026-01-25', personName: 'Ion Popescu' });
    expect(html).toContain('Bună ziua, Ion Popescu,');
    expect(html).toContain('Activitatea dumneavoastră');
    expect(html).toContain('managerul direct');
    expect(html).toContain('Vă mulțumim');
    expect(html).toContain('19.01.2026 – 25.01.2026');
  });

  it('employee intro contains only Bună ziua, when personName not provided', () => {
    const html = getWeeklyIntroHtml({ role: 'employee', periodStart: '2026-01-19', periodEnd: '2026-01-25' });
    expect(html).toContain('Bună ziua,');
    expect(html).not.toMatch(/Bună ziua,\s+[A-Z]/);
  });

  it('manager intro contains mention of attachment and Excel', () => {
    const html = getWeeklyIntroHtml({ role: 'manager', periodStart: '2026-01-19', periodEnd: '2026-01-25', personName: 'Manager' });
    expect(html).toContain('Bună ziua, Manager,');
    expect(html).toContain('Raportul complet');
    expect(html).toContain('atașat acestui email');
    expect(html).toContain('Excel');
  });
});
