import { describe, it, expect } from 'vitest';
import {
  renderMonthlyEmployeeEmail,
  renderMonthlyManagerEmail,
  buildMonthlyEmployeeEmail,
  buildMonthlyDepartmentEmail,
  buildMonthlyEmployeeEmailHtml,
  buildMonthlyDepartmentEmailHtml,
} from './monthly.js';
import { normalizeLlmSection } from './templates/monthlyEmployee.js';
import { getMonthlyEmployeeSubject, getMonthlyDepartmentSubject, getMonthlySalutation } from './content/monthlyTexts.js';

const mockReport = {
  opsStats: [
    {
      name: 'Test User',
      mondayId: 123,
      ctr_principalCount: 5,
      livr_principalCount: 4,
      livr_principalProfitEur: 480,
      target: 400,
      contactat: 10,
      calificat: 3,
      emailsCount: 5,
      callsCount: 2,
    },
  ],
  salesStats: [],
  mgmtStats: [],
  companyStats: {},
};

const mockReportSummary = {
  departments: {
    operational: { livr_principalCount: 10, livr_principalProfitEur: 1000 },
    sales: { contactat: 20, calificat: 5 },
    management: { target: 5000 },
  },
  company: {},
};

const mockPerson = {
  name: 'Test User',
  email: 'test@example.com',
  department: 'Operatiuni',
  role: 'employee',
  mondayUserId: 123,
};
const mockMeta = { periodStart: '2026-01-01', periodEnd: '2026-01-31', label: '2026-01-01..2026-01-31' };

const mockEmployeeLlmSections = {
  interpretareHtml: '<p>Interpretare bazată pe cifrele din tabel (5 comenzi principal, 4 livrări, profit 480 EUR).</p>',
  concluziiHtml: '<p>Concluzii: performanță în parametri; focus pe menținerea livrărilor.</p>',
  actiuniHtml: '<ol><li>Menține target livrări.</li><li>Verifică termene furnizori.</li></ol>',
  planHtml: '<p>Plan săptămânal: aliniere cu echipa și prioritizare comenzi.</p>',
};

const mockDepartmentLlmSections = {
  rezumatExecutivHtml: '<p>Rezumat executiv bazat pe datele agregate.</p>',
  vanzariHtml: '<p>Analiză Vânzări: contactați 20, calificați 5.</p>',
  operationalHtml: '<p>Analiză Operațional: livrări 10, profit 1000 EUR.</p>',
  comparatiiHtml: '<p>Comparații între luni conform datelor.</p>',
  recomandariHtml: '<p>Recomandări prioritizate pentru management.</p>',
};

describe('Monthly employee email', () => {
  it('output contains required sections from monthlyEmployeePrompt.md (interpretare + concluzii + acțiuni + plan)', () => {
    const html = renderMonthlyEmployeeEmail(mockReport, mockPerson, mockMeta, mockEmployeeLlmSections);
    expect(html).not.toContain('Tabel date performanță');
    expect(html).not.toMatch(/Metrică\s*\|?\s*Valoare/);
    expect(html).toContain('Interpretare date');
    expect(html).toContain('Concluzii');
    expect(html).toContain('Acțiuni prioritare');
    expect(html).toContain('Plan săptămânal');
    expect(html).toContain('Bună ziua, Test User,');
  });

  it('strips duplicate section titles and SUBIECT from LLM content (single Interpretare date heading)', () => {
    const rawInterpretare =
      '<p><strong>SUBIECT: Raport lunar</strong></p><p>Bună, Test User,</p><h3>Interpretare Date</h3><p>Conținut real al interpretării bazat pe cifre.</p>';
    const normalized = normalizeLlmSection(rawInterpretare, { removeLabels: ['interpretare date'] });
    expect(normalized).not.toContain('SUBIECT:');
    expect(normalized).not.toMatch(/Interpretare\s+Date/i);
    expect(normalized).toContain('Conținut real al interpretării');

    const llmWithDuplicates = {
      ...mockEmployeeLlmSections,
      interpretareHtml: rawInterpretare,
    };
    const html = renderMonthlyEmployeeEmail(mockReport, mockPerson, mockMeta, llmWithDuplicates);
    expect(html).not.toContain('SUBIECT:');
    const interpretareCount = (html.match(/Interpretare date/gi) || []).length;
    expect(interpretareCount).toBe(1);
    expect(html).toContain('Conținut real al interpretării');
  });

  it('buildMonthlyEmployeeEmail returns { subject, html }', () => {
    const result = buildMonthlyEmployeeEmail({
      person: mockPerson,
      data3Months: { current: mockReport.opsStats[0] },
      periodStart: '2026-01-01',
      llmSections: mockEmployeeLlmSections,
    });
    expect(result).toHaveProperty('subject');
    expect(result).toHaveProperty('html');
    expect(result.subject).toContain('Raport performanță');
    expect(result.subject).toContain('Test User');
    expect(result.html).toContain('Bună ziua, Test User,');
  });

  it('Check-in intermediar appears only when angajat is sub standard (<80% target)', () => {
    const subStandardData = { ...mockReport.opsStats[0], target: 1000, ctr_principalProfitEur: 0, livr_principalProfitEur: 300 };
    const resultSub = buildMonthlyEmployeeEmail({
      person: mockPerson,
      data3Months: { current: subStandardData },
      periodStart: '2026-01-01',
      llmSections: mockEmployeeLlmSections,
    });
    expect(resultSub.html).toContain('Check-in intermediar');

    const okData = { ...mockReport.opsStats[0], target: 400, ctr_principalProfitEur: 200, livr_principalProfitEur: 200 };
    const resultOk = buildMonthlyEmployeeEmail({
      person: mockPerson,
      data3Months: { current: okData },
      periodStart: '2026-01-01',
      llmSections: mockEmployeeLlmSections,
    });
    expect(resultOk.html).not.toContain('Check-in intermediar');
  });

  it('buildMonthlyEmployeeEmailHtml uses prompt (loads and does not throw)', () => {
    const html = buildMonthlyEmployeeEmailHtml({
      personName: 'Alexandru Pop',
      stats: mockReport.opsStats[0],
      department: 'Operatiuni',
      periodStart: '2026-01-01',
      llmSections: mockEmployeeLlmSections,
    });
    expect(html).toContain('Bună ziua, Alexandru Pop,');
    expect(html).not.toContain('Tabel date performanță');
    expect(html).toContain('Interpretare date');
  });

  it('buildMonthlyEmployeeEmail throws when llmSections is missing', () => {
    expect(() =>
      buildMonthlyEmployeeEmail({
        person: mockPerson,
        data3Months: { current: mockReport.opsStats[0] },
        periodStart: '2026-01-01',
      })
    ).toThrow(/llmSections|missing LLM section/);
  });
});

describe('Monthly management email', () => {
  it('output contains required sections from monthlyDepartmentPrompt.md', () => {
    const html = renderMonthlyManagerEmail(mockReport, mockMeta, mockReportSummary, mockDepartmentLlmSections);
    expect(html).toContain('Rezumat executiv');
    expect(html).toContain('Analiză Vânzări');
    expect(html).toContain('Analiză Operațional');
    expect(html).toContain('Comparații');
    expect(html).toContain('Recomandări');
    expect(html).toContain('Date agregate');
  });

  it('buildMonthlyDepartmentEmail returns { subject, html, attachments }', () => {
    const result = buildMonthlyDepartmentEmail({
      periodStart: '2026-01-01',
      reportSummary: mockReportSummary,
      llmSections: mockDepartmentLlmSections,
    });
    expect(result).toHaveProperty('subject');
    expect(result).toHaveProperty('html');
    expect(result).toHaveProperty('attachments');
    expect(Array.isArray(result.attachments)).toBe(true);
    expect(result.subject).toContain('Raport performanță departamentală');
    expect(result.html).toContain('Rezumat executiv');
  });

  it('buildMonthlyDepartmentEmailHtml uses prompt (loads and does not throw)', () => {
    const html = buildMonthlyDepartmentEmailHtml({
      periodStart: '2026-01-01',
      reportSummary: mockReportSummary,
      llmSections: mockDepartmentLlmSections,
    });
    expect(html).toContain('Rezumat executiv');
    expect(html).toContain('Analiză Vânzări');
    expect(html).toContain('Analiză Operațional');
  });

  it('monthly management email contains headings: Rezumat executiv, Vânzări, Operațional, Recomandări', () => {
    const html = renderMonthlyManagerEmail(mockReport, mockMeta, mockReportSummary, mockDepartmentLlmSections);
    expect(html).toContain('Rezumat executiv');
    expect(html).toContain('Analiză Vânzări');
    expect(html).toContain('Analiză Operațional');
    expect(html).toContain('Recomandări');
  });
});

describe('Monthly texts', () => {
  it('getMonthlyEmployeeSubject returns correct format', () => {
    const subject = getMonthlyEmployeeSubject('Nume Prenume', '2026-01-01');
    expect(subject).toContain('Raport performanță');
    expect(subject).toContain('Nume Prenume');
    expect(subject).toMatch(/Ianuarie 2026|2026/);
  });

  it('getMonthlyDepartmentSubject returns correct format', () => {
    const subject = getMonthlyDepartmentSubject('2026-01-01');
    expect(subject).toContain('Raport performanță departamentală');
    expect(subject).toMatch(/Ianuarie 2026|2026/);
  });

  it('getMonthlySalutation returns Bună ziua, Nume Prenume,', () => {
    expect(getMonthlySalutation('Maria Ionescu')).toBe('Bună ziua, Maria Ionescu,');
    expect(getMonthlySalutation('')).toBe('Bună ziua,');
  });
});
