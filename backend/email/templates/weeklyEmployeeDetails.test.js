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
  avgOfferTime: 45.5,
  avgCloseTime: 90,
  sumOfferTime: 91,
  countOfferTime: 2,
  sumCloseTime: 180,
  countCloseTime: 2,
  livr_websiteCount: 2,
  livr_websiteProfit: 210.2,
  livr_sumClientTerms: 0,
  livr_countClientTerms: 2,
  livr_sumSupplierTerms: 80,
  livr_countSupplierTerms: 4,
  livr_overdueInvoicesCount: 0,
  livr_supplierTermsUnder30: 2,
  livr_supplierTermsOver30: 2,
  livr_sumProfitability: 37.21,
  livr_countProfitability: 2,
  livr_websiteCountSec: 0,
  livr_websiteProfitSec: 0,
  livr_burseCount: 1,
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

  it('Vanzari: includes contactat, calificat, rata conversie, apeluri; excludes Emailuri and CTR rows', () => {
    const html = buildEmployeeDetailsTable(mockStats, 'Vanzari');
    expect(html).toContain('Clienți contactați telefonic');
    expect(html).toContain('Clienți calificați');
    expect(html).toContain('Rata conversie');
    expect(html).toContain('Apeluri');
    expect(html).not.toContain('Emailuri');
    expect(html).not.toContain('CTR principal');
    expect(html).not.toContain('Total curse după contract');
    expect(html).not.toContain('Total profit după contract');
    expect(html).toContain('Termen mediu client');
    expect(html).not.toContain('Profitabilitate');
    expect(html).not.toContain('Target total');
    expect(html).not.toContain('Profit peste target');
  });

  it('Operatiuni: excludes contactat, calificat, rata conversie, emailuri, apeluri, CTR rows, sum/count termene', () => {
    const html = buildEmployeeDetailsTable(mockStats, 'Operatiuni');
    expect(html).toContain('Furnizori adăugați');
    expect(html).toContain('Curse livrate principal');
    expect(html).toContain('Termen mediu client');
    expect(html).toContain('Termen mediu furnizor');
    expect(html).not.toContain('Profitabilitate');
    expect(html).not.toContain('Clienți contactați telefonic');
    expect(html).not.toContain('Clienți calificați');
    expect(html).not.toContain('Rata conversie');
    expect(html).not.toContain('Emailuri');
    expect(html).not.toContain('Apeluri');
    expect(html).not.toContain('CTR principal');
    expect(html).not.toContain('Target total');
    expect(html).not.toContain('Profit peste target');
    expect(html).not.toContain('Burse Count Ctr Principal');
    expect(html).not.toContain('Burse Count Ctr Secondary');
    expect(html).not.toContain('Burse Count Livr Principal');
    expect(html).not.toContain('Burse Count Livr Secondary');
    expect(html).not.toContain('Sumă termene client');
    expect(html).not.toContain('Număr termene client');
    expect(html).not.toContain('Sumă termene furnizor');
    expect(html).not.toContain('Număr termene furnizor');
    expect(html).not.toContain('Sumă profitability');
    expect(html).not.toContain('Număr profitability');
  });

  it('Management: excludes contactat, calificat, rata conversie, emailuri, apeluri', () => {
    const html = buildEmployeeDetailsTable(mockStats, 'Management');
    expect(html).not.toContain('Clienți contactați telefonic');
    expect(html).not.toContain('Clienți calificați');
    expect(html).not.toContain('Rata conversie');
    expect(html).not.toContain('Emailuri');
    expect(html).not.toContain('Apeluri');
  });

  it('includes renamed average time metrics for all departments in h:m format', () => {
    const htmlOps = buildEmployeeDetailsTable(mockStats, 'Operatiuni');
    const htmlSales = buildEmployeeDetailsTable(mockStats, 'Vanzari');
    const htmlMgmt = buildEmployeeDetailsTable(mockStats, 'Management');
    for (const html of [htmlOps, htmlSales, htmlMgmt]) {
      expect(html).toContain('Timp mediu de ofertare');
      expect(html).toContain('Timp mediu de inchidere');
      expect(html).toContain('0:45');
      expect(html).toContain('1:30');
    }
  });

  it('does not render legacy livr_* technical rows from stats extras', () => {
    const html = buildEmployeeDetailsTable(mockStats, 'Management');
    expect(html).not.toContain('Livr website Count');
    expect(html).not.toContain('Livr website Profit');
    expect(html).not.toContain('Livr sum Client Terms');
    expect(html).not.toContain('Livr count Client Terms');
    expect(html).not.toContain('Livr sum Supplier Terms');
    expect(html).not.toContain('Livr count Supplier Terms');
    expect(html).not.toContain('Livr overdue Invoices Count');
    expect(html).not.toContain('Livr supplier Terms Under30');
    expect(html).not.toContain('Livr supplier Terms Over30');
    expect(html).not.toContain('Livr sum Profitability');
    expect(html).not.toContain('Livr count Profitability');
    expect(html).not.toContain('Livr website Count Sec');
    expect(html).not.toContain('Livr website Profit Sec');
    expect(html).not.toContain('Livr burse Count');
    expect(html).not.toContain('Sum Offer Time');
    expect(html).not.toContain('Count Offer Time');
    expect(html).not.toContain('Sum Close Time');
    expect(html).not.toContain('Count Close Time');
  });

  it('does not render target/bonus rows in weekly email table', () => {
    const html = buildEmployeeDetailsTable(mockStats);
    expect(html).not.toContain('Target total (EUR)');
    expect(html).not.toContain('Profit peste target (EUR)');
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
    expect(html).not.toContain('Target total');
    expect(html).not.toContain('Profit peste target');
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
