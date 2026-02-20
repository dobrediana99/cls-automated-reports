import { describe, it, expect } from 'vitest';
import { renderWeeklyEmployeeEmail, renderWeeklyManagerEmail } from './weekly.js';

const mockReport = {
  opsStats: [{ name: 'Test User', mondayId: 123, ctr_principalCount: 5, ctr_secondaryCount: 0, ctr_principalProfitEur: 500, ctr_secondaryProfitEur: 0, livr_principalCount: 4, livr_secondaryCount: 0, livr_principalProfitEur: 480, livr_secondaryProfitEur: 0, target: 400 }],
  salesStats: [],
  mgmtStats: [],
  companyStats: {},
};
const mockPerson = { name: 'Test User', email: 'test@example.com', department: 'Operatiuni', role: 'employee', isActive: true };
const mockManager = { name: 'Manager', email: 'manager@example.com', department: 'Management', role: 'manager', isActive: true };
const mockMeta = { label: '2026-01-20..2026-01-26', periodStart: '2026-01-20', periodEnd: '2026-01-26' };

describe('renderWeeklyEmployeeEmail', () => {
  it('includes salutation with person name: Bună ziua, Nume Prenume,', () => {
    const html = renderWeeklyEmployeeEmail(mockReport, mockPerson, mockMeta);
    expect(html).toContain('Bună ziua, Test User,');
    expect(html).toContain('Activitatea dumneavoastră');
    expect(html).toContain('20.01.2026 – 26.01.2026');
    expect(html).toContain('Vă mulțumim');
  });

  it('Operatiuni employee: table has no Contactat, Calificat, Rata conv., Emailuri, Apeluri', () => {
    const html = renderWeeklyEmployeeEmail(mockReport, mockPerson, mockMeta);
    expect(html).toContain('Termen mediu client');
    expect(html).toContain('<table');
    expect(html).toContain('Metrică');
    expect(html).toContain('Valoare');
    expect(html).toContain('Curse livrate principal');
    expect(html).not.toContain('Clienți contactați telefonic');
    expect(html).not.toContain('Clienți calificați');
    expect(html).not.toContain('Rata conversie');
    expect(html).not.toContain('Emailuri');
    expect(html).not.toContain('Apeluri');
  });

  it('Vanzari employee: table includes Contactat, Calificat, Rata conv., Apeluri', () => {
    const reportSales = { ...mockReport, opsStats: [], salesStats: mockReport.opsStats, mgmtStats: [] };
    const personSales = { ...mockPerson, department: 'Vanzari' };
    const html = renderWeeklyEmployeeEmail(reportSales, personSales, mockMeta);
    expect(html).toContain('Clienți contactați telefonic');
    expect(html).toContain('Clienți calificați');
    expect(html).toContain('Rata conversie');
    expect(html).toContain('Apeluri');
  });
});

describe('renderWeeklyManagerEmail', () => {
  it('includes standardized intro with attachment mention and manager own stats', () => {
    const mockReportMgmt = { ...mockReport, opsStats: [], salesStats: [], mgmtStats: [{ name: 'Manager', mondayId: 1, ctr_principalCount: 0, ctr_secondaryCount: 0, ctr_principalProfitEur: 0, ctr_secondaryProfitEur: 0, livr_principalCount: 0, livr_secondaryCount: 0, livr_principalProfitEur: 0, livr_secondaryProfitEur: 0, target: 0 }], companyStats: {} };
    const html = renderWeeklyManagerEmail(mockReportMgmt, mockManager, mockMeta);
    expect(html).toContain('Raportul complet');
    expect(html).toContain('atașat acestui email');
    expect(html).toContain('Excel');
    expect(html).not.toContain('Target total');
    expect(html).not.toContain('Date per angajat');
  });

  it('shows no-data message when manager has no stats in report', () => {
    const mockReportNoMgmt = { ...mockReport, opsStats: [], salesStats: [], mgmtStats: [], companyStats: {} };
    const html = renderWeeklyManagerEmail(mockReportNoMgmt, mockManager, mockMeta);
    expect(html).toContain('Nu există date individuale pentru dumneavoastră');
  });
});
