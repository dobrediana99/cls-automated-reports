import { describe, it, expect } from 'vitest';
import { getWeeklyIntroHtml } from '../content/weeklyTexts.js';
import { buildEmployeeDetailsTable, buildWeeklyEmployeeEmailHtml } from './weeklyEmployeeDetails.js';

const mockStats = {
  name: 'Test User',
  id: 1,
  mondayId: 123,
  target: 400,
  suppliersAdded: 2,
  ctr_principalCount: 5,
  ctr_principalProfitEur: 500,
  ctr_secondaryCount: 0,
  ctr_secondaryProfitEur: 0,
  livr_principalCount: 4,
  livr_principalProfitEur: 480,
  livr_secondaryCount: 0,
  livr_secondaryProfitEur: 0,
  websiteCount: 1,
  websiteProfit: 50,
  websiteCountSec: 0,
  websiteProfitSec: 0,
  burseCount: 0,
  solicitariCount: 2,
  contactat: 10,
  calificat: 3,
  emailsCount: 5,
  callsCount: 2,
  sumClientTerms: 30,
  countClientTerms: 3,
  sumSupplierTerms: 45,
  countSupplierTerms: 3,
  overdueInvoicesCount: 0,
  supplierTermsUnder30: 1,
  supplierTermsOver30: 2,
  sumProfitability: 25,
  countProfitability: 2,
};

describe('buildEmployeeDetailsTable', () => {
  it('returns a table with 2 columns per data row', () => {
    const html = buildEmployeeDetailsTable(mockStats);
    expect(html).toContain('<table');
    expect(html).toContain('</table>');
    const tbodyMatch = html.match(/<tbody>([\s\S]*?)<\/tbody>/);
    const tbodyRows = tbodyMatch ? (tbodyMatch[1].match(/<tr>/g) || []).length : 0;
    const tdCount = (html.match(/<td/g) || []).length;
    expect(tdCount).toBe(tbodyRows * 2);
  });

  it('Vanzari: includes contactat, calificat, rata conversie, emailuri, apeluri', () => {
    const html = buildEmployeeDetailsTable(mockStats, 'Vanzari');
    expect(html).toContain('Contactați');
    expect(html).toContain('Calificați');
    expect(html).toContain('Rata conversie');
    expect(html).toContain('Emailuri');
    expect(html).toContain('Apeluri');
    expect(html).toContain('CTR principal');
    expect(html).toContain('Termen mediu client');
    expect(html).toContain('Target total');
  });

  it('Operatiuni: excludes contactat, calificat, rata conversie, emailuri, apeluri', () => {
    const html = buildEmployeeDetailsTable(mockStats, 'Operatiuni');
    expect(html).toContain('Furnizori adăugați');
    expect(html).toContain('Curse livrare principal');
    expect(html).toContain('Termen mediu client');
    expect(html).toContain('Profitability');
    expect(html).not.toContain('Contactați');
    expect(html).not.toContain('Calificați');
    expect(html).not.toContain('Rata conversie');
    expect(html).not.toContain('Emailuri');
    expect(html).not.toContain('Apeluri');
  });

  it('Management: excludes contactat, calificat, rata conversie, emailuri, apeluri', () => {
    const html = buildEmployeeDetailsTable(mockStats, 'Management');
    expect(html).not.toContain('Contactați');
    expect(html).not.toContain('Calificați');
    expect(html).not.toContain('Rata conversie');
    expect(html).not.toContain('Emailuri');
    expect(html).not.toContain('Apeluri');
  });

  it('includes header row Metrică | Valoare', () => {
    const html = buildEmployeeDetailsTable(mockStats);
    expect(html).toContain('Metrică');
    expect(html).toContain('Valoare');
  });

  it('handles null stats with empty table body', () => {
    const html = buildEmployeeDetailsTable(null);
    expect(html).toContain('<table');
    expect(html).toContain('<tbody>');
  });
});

describe('buildWeeklyEmployeeEmailHtml', () => {
  it('includes standardized intro and full table when stats provided', () => {
    const introHtml = getWeeklyIntroHtml({ role: 'employee', periodStart: '2026-01-19', periodEnd: '2026-01-25', personName: 'Test User' });
    const html = buildWeeklyEmployeeEmailHtml({ introHtml, stats: mockStats, department: 'Vanzari', pageTitle: 'Raport săptămânal' });
    expect(html).toContain('Bună ziua, Test User,');
    expect(html).toContain('Activitatea dumneavoastră');
    expect(html).toContain('Vă mulțumim');
    expect(html).toContain('<table');
    expect(html).toContain('Target total');
    expect(html).toContain('400.00');
  });

  it('shows fallback message when stats is null', () => {
    const introHtml = getWeeklyIntroHtml({ role: 'employee', periodStart: '2026-01-19', periodEnd: '2026-01-25' });
    const html = buildWeeklyEmployeeEmailHtml({ introHtml, stats: null });
    expect(html).toContain('Nu există date pentru această perioadă');
  });

  it('uses custom noDataMessage when provided', () => {
    const introHtml = getWeeklyIntroHtml({ role: 'manager', periodStart: '2026-01-19', periodEnd: '2026-01-25' });
    const html = buildWeeklyEmployeeEmailHtml({ introHtml, stats: null, noDataMessage: 'Nu există date individuale pentru dumneavoastră în această perioadă.' });
    expect(html).toContain('Nu există date individuale pentru dumneavoastră');
  });
});
