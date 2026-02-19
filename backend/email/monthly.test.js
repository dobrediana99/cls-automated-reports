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
    operational: { livr_principalCount: 10, livr_principalProfitEur: 1000, profitTotal: 8000, targetTotal: 10000, callsCount: 0 },
    sales: { contactat: 555, calificat: 129, callsCount: 605, profitTotal: 12000, targetTotal: 15000 },
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
const mockMeta = { periodStart: '2026-01-01', periodEnd: '2026-01-31', workingDaysInPeriod: 22, label: '2026-01-01..2026-01-31' };

const mockEmployeeLlmSections = {
  antet: {
    subiect: 'Raport Performanță Test User – Ianuarie 2026',
    greeting: 'Bună, Test User,',
    intro_message: 'Îți trimit raportul de performanță pentru perioada analizată.',
  },
  sectiunea_1_tabel_date_performanta: {
    continut: ['Indicatori relevanți', 'Comparație Luna Curentă vs. Luna Anterioară'],
  },
  sectiunea_2_interpretare_date: {
    stil: 'Obiectiv, bazat pe date',
    include: ['Performanță absolută', 'Comparație cu luna anterioară', 'Interpretare bazată pe cifre (5 comenzi principal, 4 livrări, profit 480 EUR).'],
  },
  sectiunea_3_concluzii: {
    ce_merge_bine: 'Performanță în parametri.',
    ce_nu_merge_si_necesita_interventie_urgenta: 'Nicio problemă majoră.',
    focus_luna_urmatoare: 'Menținerea livrărilor.',
  },
  sectiunea_4_actiuni_prioritare: {
    format_actiune: '1. Menține target livrări.',
    structura: { ce: 'Livrări', de_ce: 'Target', masurabil: 'Număr', deadline: 'Luna următoare' },
    actiuni_specifice_per_rol: {
      freight_forwarder: ['Verifică termene furnizori.'],
      sales_freight_agent: ['Menține target livrări.'],
    },
  },
  sectiunea_5_plan_saptamanal: {
    format: { saptamana_1: 'Aliniere cu echipa.', saptamana_2_4: 'Prioritizare comenzi.' },
  },
  incheiere: {
    raport_urmator: 'Perioada Februarie 2026.',
    mesaj_sub_80: 'ATENȚIE: Performanța sub prag.',
    mesaj_peste_80: 'Continuă în acest ritm.',
    semnatura: { nume: 'Rafael Emre Onisoara', functie: 'Performance Manager', companie: 'Crystal Logistics Services' },
  },
};

const mockEmployeeLlmSectionsWithCheckIn = {
  ...mockEmployeeLlmSections,
  sectiunea_6_check_in_intermediar: {
    regula: 'Sub 80% target',
    format: 'Check-in intermediar: Vineri 15.02.2026, 10:00 - Review obligatoriu progres.',
  },
};

const mockDepartmentLlmSections = {
  antet: { subiect: 'Raport departamental', introducere: 'Rezumat executiv bazat pe datele agregate.' },
  sectiunea_1_rezumat_executiv: {
    titlu: 'Rezumat executiv',
    performanta_generala: { totalProfitCompanie: '1', targetDepartamentalCombinat: '2', realizareTarget: '3', numarTotalCurse: '4' },
    departamentVanzari: { profit: '1', procentDinTarget: '2', trend: '3', status: '4' },
    departamentOperational: { profit: '1', procentDinTarget: '2', trend: '3', status: '4' },
    observatiiCritice: ['Obs 1'],
  },
  sectiunea_2_analiza_vanzari: {
    titlu: 'Analiză Vânzări',
    performantaVsIstoric: { lunaCurenta: '1', lunaAnterioara: '2', trend: '3' },
    targetDepartamental: { target: '1', realizat: '2', procentAtingere: '3', status: '4' },
    metriciMediiPerAngajat: { profitMediu: '1', curseMedii: '2', apeluriMediiZi: '3', conversieMedieClienti: '4' },
    tabelAngajati: 'Tabel',
    problemeIdentificateAngajati: [{ nume: 'A', probleme: ['P1'] }],
    highPerformers: [],
    lowPerformers: [],
    problemeSistemice: [],
  },
  sectiunea_3_analiza_operational: {
    titlu: 'Analiză Operațional',
    performantaVsIstoric: { lunaCurenta: '1', lunaAnterioara: '2', trend: '3' },
    targetDepartamental: { target: '1', realizat: '2', procentAtingere: '3', status: '4' },
    metriciMediiPerAngajat: { profitMediu: '1', curseMedii: '2', curseMediiBurse: '3', procentProfitPrincipal: '4', procentProfitSecundar: '5' },
    tabelAngajati: 'Tabel',
    problemeIdentificateAngajati: [{ nume: 'A', probleme: ['P1'] }],
    highPerformers: [],
    lowPerformers: [],
    problemeSistemice: [],
  },
  sectiunea_4_comparatie_departamente: {
    titlu: 'Comparații',
    tabelComparativ: {
      profitTotal: { vanzari: '1', operational: '2', diferenta: '3' },
      numarCurseTotal: { vanzari: '1', operational: '2', diferenta: '3' },
      procentTargetDepartamental: { vanzari: '1', operational: '2', diferenta: '3' },
      profitMediuAngajat: { vanzari: '1', operational: '2', diferenta: '3' },
      trendVsLunaAnterioara: { vanzari: '1', operational: '2' },
    },
    observatii: ['Comparații între luni.'],
  },
  sectiunea_5_recomandari_management: {
    titlu: 'Recomandări',
    oneToOneLowPerformers: [],
    trainingNecesare: [],
    urmarireSaptamanala: [],
    setareObiectiveSpecifice: [],
    mutariRolOptional: [],
    problemeSistemiceProces: [],
  },
  incheiere: { urmatorulRaport: 'Next', semnatura: { functie: 'F', companie: 'C' } },
};

describe('Monthly employee email', () => {
  it('output contains required sections from monthlyEmployeePrompt.md (interpretare + concluzii + acțiuni + plan)', () => {
    const html = renderMonthlyEmployeeEmail(mockReport, mockPerson, mockMeta, mockEmployeeLlmSections);
    expect(html).toContain('Date de performanță');
    expect(html).toContain('Interpretare');
    expect(html).toContain('Concluzii');
    expect(html).toContain('Acțiuni prioritare');
    expect(html).toContain('Plan săptămânal');
    expect(html).toContain('Test User');
  });

  it('normalizeLlmSection strips SUBIECT and duplicate section headings from raw HTML', () => {
    const rawInterpretare =
      '<p><strong>SUBIECT: Raport lunar</strong></p><p>Bună, Test User,</p><h3>Interpretare Date</h3><p>Conținut real al interpretării bazat pe cifre.</p>';
    const normalized = normalizeLlmSection(rawInterpretare, { removeLabels: ['interpretare date'] });
    expect(normalized).not.toContain('SUBIECT:');
    expect(normalized).not.toMatch(/Interpretare\s+Date/i);
    expect(normalized).toContain('Conținut real al interpretării');
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
    expect(result.subject).toMatch(/raport performanță/i);
    expect(result.subject).toContain('Test User');
    expect(result.html).toContain('Test User');
  });

  it('Check-in intermediar appears only when sectiunea_6 is present in llmSections', () => {
    const resultWithCheckIn = buildMonthlyEmployeeEmail({
      person: mockPerson,
      data3Months: { current: mockReport.opsStats[0] },
      periodStart: '2026-01-01',
      llmSections: mockEmployeeLlmSectionsWithCheckIn,
    });
    expect(resultWithCheckIn.html).toContain('Check-in intermediar');

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
    expect(html).toContain('Interpretare');
    expect(html).toContain('Date de performanță');
    expect(html).toContain('Concluzii');
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

  it('employee email escapes user content (no HTML injection)', () => {
    const xssLlm = {
      ...mockEmployeeLlmSections,
      antet: {
        subiect: 'Raport',
        greeting: 'Bună, <script>alert(1)</script>,',
        intro_message: 'Intro "quotes"',
      },
    };
    const html = buildMonthlyEmployeeEmailHtml({
      personName: mockPerson.name,
      stats: mockReport.opsStats[0],
      department: mockPerson.department,
      periodStart: '2026-01-01',
      llmSections: xssLlm,
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&quot;');
  });

  it('section 1 pipe-separated lines are rendered as HTML table with header and cells', () => {
    const pipeContinut = [
      'COMENZI DUPĂ DATA LIVRĂRII | Luna Curentă | Luna Anterioară | Δ% | Media Dept.',
      'Curse Principal | 10 | 8 | +25% | 24',
      'Curse Secundar | 2 | 3 | -33% | 5',
      'Profit Principal | 1200 EUR | 900 EUR | +33% | 1000 EUR',
    ];
    const llmWithTable = {
      ...mockEmployeeLlmSections,
      sectiunea_1_tabel_date_performanta: { continut: pipeContinut },
    };
    const html = buildMonthlyEmployeeEmailHtml({
      person: mockPerson,
      department: mockPerson.department,
      data3Months: {},
      deptAverages3Months: {},
      periodStart: '2026-01-01',
      llmSections: llmWithTable,
    });
    expect(html).toContain('<table');
    expect(html).toContain('<th');
    expect(html).toContain('COMENZI DUPĂ DATA LIVRĂRII');
    expect(html).toContain('Curse Principal');
    expect(html).toContain('1200 EUR');
    expect(html).not.toMatch(/\|\s*Luna Curentă\s*\|/);
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
    expect(html).not.toContain('Date agregate (tabel)');
  });

  it('buildMonthlyDepartmentEmail returns { subject, html, attachments }', () => {
    const result = buildMonthlyDepartmentEmail({
      periodStart: '2026-01-01',
      meta: mockMeta,
      reportSummary: mockReportSummary,
      report: null,
      llmSections: mockDepartmentLlmSections,
    });
    expect(result).toHaveProperty('subject');
    expect(result).toHaveProperty('html');
    expect(result).toHaveProperty('attachments');
    expect(Array.isArray(result.attachments)).toBe(true);
    expect(result.subject).toMatch(/raport.*departamental/i);
    expect(result.html).toContain('Rezumat executiv');
  });

  it('buildMonthlyDepartmentEmailHtml uses prompt (loads and does not throw)', () => {
    const html = buildMonthlyDepartmentEmailHtml({
      periodStart: '2026-01-01',
      reportSummary: mockReportSummary,
      report: null,
      meta: mockMeta,
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

  it('department email uses real HTML tables (no raw markdown pipes in output)', () => {
    const withMarkdownTable = {
      ...mockDepartmentLlmSections,
      sectiunea_2_analiza_vanzari: {
        ...mockDepartmentLlmSections.sectiunea_2_analiza_vanzari,
        tabelAngajati: '| Nume | Profit |\n|------|-------|\n| A | 100 |\n| B | 200 |',
      },
    };
    const html = buildMonthlyDepartmentEmailHtml({
      periodStart: '2026-01-01',
      reportSummary: mockReportSummary,
      report: null,
      meta: mockMeta,
      llmSections: withMarkdownTable,
    });
    expect(html).toContain('<table');
    expect(html).toContain('<tbody>');
    expect(html).not.toMatch(/\|\s*#\s*\|/);
    expect(html).not.toContain('| Nume | Profit |');
  });

  it('all user text is escaped (no HTML injection)', () => {
    const xssLlm = {
      ...mockDepartmentLlmSections,
      antet: {
        subiect: 'Normal subject',
        introducere: 'Intro with <script>alert(1)</script> and "quotes"',
      },
    };
    const html = buildMonthlyDepartmentEmailHtml({
      periodStart: '2026-01-01',
      reportSummary: mockReportSummary,
      report: null,
      meta: mockMeta,
      llmSections: xssLlm,
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&quot;');
  });

  it('department email does not contain KPI-uri deterministe block and contains Rezumat Executiv', () => {
    const html = renderMonthlyManagerEmail(mockReport, mockMeta, mockReportSummary, mockDepartmentLlmSections);
    expect(html).not.toContain('KPI-uri deterministe');
    expect(html).toContain('Rezumat Executiv');
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
