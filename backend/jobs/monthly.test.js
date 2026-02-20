/**
 * Monthly job tests. OpenRouter hardening (400 fallback, JSON retry, schema repair, timeout)
 * is covered in backend/llm/openrouterClient.test.js with mocked fetch.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runReport } from '../report/runReport.js';
import { requireOpenRouter, generateMonthlySections, generateMonthlyDepartmentSections } from '../llm/openrouterClient.js';
import { loadOrComputeMonthlyReport } from '../report/runMonthlyPeriods.js';
import { MANAGERS, ORG } from '../config/org.js';
import { runMonthly, buildEmployeeInputCalculated } from './monthly.js';
import { createInitialState, RUN_STATE_UNAVAILABLE } from '../store/monthlyRunState.js';
import * as emailMonthly from '../email/monthly.js';

const {
  sendMailMock,
  mockEmployeeSections,
  mockDepartmentSections,
  loadMonthlyRunStateMock,
  saveMonthlyRunStateMock,
} = vi.hoisted(() => {
  const mockEmployeeSections = {
    antet: { subiect: 'Raport', greeting: 'Bună,', intro_message: 'Intro' },
    sectiunea_1_tabel_date_performanta: { continut: ['Row 1'] },
    sectiunea_2_interpretare_date: { stil: 'Obiectiv', include: ['Item 1'] },
    sectiunea_3_concluzii: {
      ce_merge_bine: 'A',
      ce_nu_merge_si_necesita_interventie_urgenta: 'B',
      focus_luna_urmatoare: 'C',
    },
    sectiunea_4_actiuni_prioritare: {
      format_actiune: 'F',
      structura: { ce: 'x', de_ce: 'y', masurabil: 'z', deadline: 'd' },
      actiuni_specifice_per_rol: { freight_forwarder: ['F1'], sales_freight_agent: ['S1'] },
    },
    sectiunea_5_plan_saptamanal: { format: { saptamana_1: 'S1', saptamana_2_4: 'S2-4' } },
    incheiere: {
      raport_urmator: 'Next',
      mesaj_sub_80: 'Sub 80',
      mesaj_peste_80: 'Peste 80',
      semnatura: { nume: 'N', functie: 'F', companie: 'C' },
    },
  };
  const mockDepartmentSections = {
    antet: { subiect: 'Raport Dept', introducere: 'Intro' },
    sectiunea_1_rezumat_executiv: {
      titlu: 'Rezumat',
      performanta_generala: { totalProfitCompanie: '1', targetDepartamentalCombinat: '2', realizareTarget: '3', numarTotalCurse: '4' },
      departamentVanzari: { profit: '1', procentDinTarget: '2', trend: '3', status: '4' },
      departamentOperational: { profit: '1', procentDinTarget: '2', trend: '3', status: '4' },
      observatiiCritice: ['O1'],
    },
    sectiunea_2_analiza_vanzari: {
      titlu: 'Vânzări',
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
      titlu: 'Operațional',
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
      titlu: 'Comparație',
      tabelComparativ: {
        profitTotal: { vanzari: '1', operational: '2', diferenta: '3' },
        numarCurseTotal: { vanzari: '1', operational: '2', diferenta: '3' },
        procentTargetDepartamental: { vanzari: '1', operational: '2', diferenta: '3' },
        profitMediuAngajat: { vanzari: '1', operational: '2', diferenta: '3' },
        trendVsLunaAnterioara: { vanzari: '1', operational: '2' },
      },
      observatii: ['Obs'],
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
  return {
    sendMailMock: vi.fn().mockResolvedValue({}),
    mockEmployeeSections,
    mockDepartmentSections,
    loadMonthlyRunStateMock: vi.fn().mockResolvedValue(null),
    saveMonthlyRunStateMock: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock('../report/runReport.js', () => ({
  runReport: vi.fn().mockResolvedValue({
    meta: { periodStart: '2025-12-01', periodEnd: '2025-12-31', label: '2025-12-01..2025-12-31' },
    reportSummary: { departments: { operational: {}, sales: {}, management: {} }, company: {} },
    report: { opsStats: [], salesStats: [], mgmtStats: [], companyStats: {} },
  }),
}));
vi.mock('../report/runMonthlyPeriods.js', () => {
  const mockMeta = { periodStart: '2025-12-01', periodEnd: '2025-12-31', label: '2025-12-01..2025-12-31' };
  const mockSummary = { departments: { operational: {}, sales: {}, management: {} }, company: {} };
  const mockReport = { opsStats: [], salesStats: [], mgmtStats: [], companyStats: {} };
  const mockResult = { meta: mockMeta, reportSummary: mockSummary, report: mockReport };
  return {
    getMonthlyPeriods: vi.fn().mockReturnValue([
      { yyyyMm: '2025-12', start: '2025-12-01', end: '2025-12-31', label: '2025-12-01..2025-12-31' },
      { yyyyMm: '2025-11', start: '2025-11-01', end: '2025-11-30', label: '2025-11-01..2025-11-30' },
      { yyyyMm: '2025-10', start: '2025-10-01', end: '2025-10-31', label: '2025-10-01..2025-10-31' },
    ]),
    loadOrComputeMonthlyReport: vi.fn().mockResolvedValue(mockResult),
  };
});
vi.mock('../cache/monthlyReportCache.js', () => ({
  ensureMonthlyCacheDir: vi.fn(),
  getMonthlyCachePath: vi.fn((yyyyMm) => `/out/cache/monthly/${yyyyMm}.json`),
  loadMonthlyReportFromCache: vi.fn().mockReturnValue(null),
  saveMonthlyReportToCache: vi.fn(),
}));

vi.mock('../llm/openrouterClient.js', () => ({
  requireOpenRouter: vi.fn(),
  generateMonthlySections: vi.fn().mockResolvedValue({ sections: mockEmployeeSections, usage: null }),
  generateMonthlyDepartmentSections: vi.fn().mockResolvedValue({ sections: mockDepartmentSections, usage: null }),
}));
vi.mock('../prompts/loadPrompts.js', () => ({
  loadMonthlyEmployeePrompt: vi.fn().mockReturnValue('Employee prompt'),
  loadMonthlyDepartmentPrompt: vi.fn().mockReturnValue('Department prompt'),
}));
vi.mock('./dryRun.js', () => ({ writeDryRunFile: vi.fn().mockReturnValue('/out/monthly_2025-12-01..2025-12-31.json') }));
vi.mock('../store/monthlySnapshots.js', () => ({
  readMonthlySnapshotFromGCS: vi.fn().mockResolvedValue(null),
  writeMonthlySnapshotToGCS: vi.fn().mockResolvedValue(undefined),
  writeMonthlyRunManifestToGCS: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../store/monthlyRunState.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    loadMonthlyRunState: loadMonthlyRunStateMock,
    saveMonthlyRunState: saveMonthlyRunStateMock,
  };
});

vi.mock('nodemailer', () => ({
  default: { createTransport: () => ({ sendMail: sendMailMock }) },
}));

const mockReport = { opsStats: [], salesStats: [], mgmtStats: [], companyStats: {} };
const mockMeta = { periodStart: '2025-12-01', periodEnd: '2025-12-31', label: '2025-12-01..2025-12-31' };
const mockSummary = { departments: { operational: {}, sales: {}, management: {} }, company: {} };

describe('runMonthly', () => {
  beforeEach(() => {
    delete process.env.DRY_RUN;
    delete process.env.OPENROUTER_TIMEOUT_MS;
    process.env.MONDAY_API_TOKEN = 'test-token';
    process.env.OPENROUTER_API_KEY = 'test-key';
    sendMailMock.mockClear();
    sendMailMock.mockResolvedValue({});
    loadMonthlyRunStateMock.mockReset();
    loadMonthlyRunStateMock.mockResolvedValue(null);
    saveMonthlyRunStateMock.mockClear();
    saveMonthlyRunStateMock.mockResolvedValue(undefined);
    vi.mocked(generateMonthlySections).mockReset();
    vi.mocked(generateMonthlySections).mockResolvedValue({ sections: mockEmployeeSections, usage: null });
    vi.mocked(generateMonthlyDepartmentSections).mockReset();
    vi.mocked(generateMonthlyDepartmentSections).mockResolvedValue({ sections: mockDepartmentSections, usage: null });
    vi.mocked(runReport).mockResolvedValue({
      meta: mockMeta,
      reportSummary: mockSummary,
      report: mockReport,
    });
  });

  it('runs and returns dryRunPath when DRY_RUN=1 (loads or computes 3 months)', async () => {
    process.env.DRY_RUN = '1';

    const result = await runMonthly({ now: new Date('2026-01-15T09:30:00') });

    expect(result).toHaveProperty('dryRunPath');
    expect(result.payload).toBeDefined();
    expect(loadOrComputeMonthlyReport).toHaveBeenCalledTimes(3);
  });

  it('when DRY_RUN != 1 throws if GMAIL credentials missing (runtime config validation)', async () => {
    process.env.DRY_RUN = '0';
    process.env.SEND_MODE = 'prod';
    process.env.TEST_EMAILS = 'test@example.com';
    delete process.env.GMAIL_USER;
    delete process.env.GMAIL_APP_PASSWORD;
    vi.mocked(loadOrComputeMonthlyReport).mockClear();

    await expect(runMonthly({ now: new Date('2026-01-15T09:30:00') })).rejects.toThrow('GMAIL_USER');
    expect(loadOrComputeMonthlyReport).not.toHaveBeenCalled();
  });

  it('throws when OpenRouter is not configured (requireOpenRouter fails)', async () => {
    process.env.DRY_RUN = '1';
    vi.mocked(requireOpenRouter).mockImplementationOnce(() => {
      throw new Error('OpenRouter requires an API key. Set OPENROUTER_API_KEY (get one at https://openrouter.ai).');
    });
    await expect(runMonthly({ now: new Date('2026-01-15T09:30:00') })).rejects.toThrow(
      'OPENROUTER_API_KEY'
    );
  });

  it('throws when MONDAY_API_TOKEN is missing (before heavy compute)', async () => {
    delete process.env.MONDAY_API_TOKEN;
    vi.mocked(loadOrComputeMonthlyReport).mockClear();

    await expect(runMonthly({ now: new Date('2026-01-15T09:30:00') })).rejects.toThrow(
      'MONDAY_API_TOKEN'
    );
    expect(loadOrComputeMonthlyReport).not.toHaveBeenCalled();
  });

  it('invalid numeric env (OPENROUTER_TIMEOUT_MS=0) throws before heavy compute', async () => {
    process.env.DRY_RUN = '1';
    process.env.OPENROUTER_API_KEY = 'test-key';
    process.env.OPENROUTER_TIMEOUT_MS = '0';
    vi.mocked(loadOrComputeMonthlyReport).mockClear();

    await expect(runMonthly({ now: new Date('2026-01-15T09:30:00') })).rejects.toThrow(
      'OPENROUTER_TIMEOUT_MS'
    );
    expect(loadOrComputeMonthlyReport).not.toHaveBeenCalled();
  });

  it('SEND_MODE=test and missing TEST_EMAILS throws early in NON-DRY_RUN', async () => {
    process.env.DRY_RUN = '0';
    process.env.OPENROUTER_API_KEY = 'test-key';
    process.env.GMAIL_USER = 'u@example.com';
    process.env.GMAIL_APP_PASSWORD = 'p';
    process.env.SEND_MODE = 'test';
    delete process.env.TEST_EMAILS;
    vi.mocked(loadOrComputeMonthlyReport).mockClear();

    await expect(runMonthly({ now: new Date('2026-01-15T09:30:00') })).rejects.toThrow(
      'TEST_EMAILS must be set when SEND_MODE=test'
    );
    expect(loadOrComputeMonthlyReport).not.toHaveBeenCalled();
  });

  it('NON-DRY RUN: department email is sent once to all active managers, before any employee emails', async () => {
    process.env.DRY_RUN = '0';
    process.env.GMAIL_USER = 'test@example.com';
    process.env.GMAIL_APP_PASSWORD = 'secret';
    process.env.SEND_MODE = 'prod';

    await runMonthly({ now: new Date('2026-01-15T09:30:00') });

    const calls = sendMailMock.mock.calls;
    const activeManagers = MANAGERS.filter((m) => m.isActive);
    const activeManagerEmails = activeManagers.map((m) => m.email);
    const activePeopleCount = ORG.filter((p) => p.isActive).length;

    expect(sendMailMock).toHaveBeenCalled();
    expect(calls.length).toBe(1 + activePeopleCount);
    const firstCall = calls[0][0];
    expect(firstCall.attachments).toBeDefined();
    expect(Array.isArray(firstCall.attachments)).toBe(true);
    activeManagerEmails.forEach((email) => {
      expect(firstCall.to).toContain(email);
    });
    for (let i = 1; i < calls.length; i++) {
      expect(calls[i][0].attachments).toBeUndefined();
    }
  });

  it('NON-DRY RUN: if department sendMail fails, job throws and no employee emails sent', async () => {
    process.env.DRY_RUN = '0';
    process.env.GMAIL_USER = 'test@example.com';
    process.env.GMAIL_APP_PASSWORD = 'secret';
    process.env.TEST_EMAILS = 'test@example.com';

    sendMailMock.mockReset();
    sendMailMock.mockRejectedValueOnce(new Error('Send failed'));

    vi.mocked(generateMonthlySections).mockClear();
    vi.mocked(generateMonthlyDepartmentSections).mockClear();

    await expect(runMonthly({ now: new Date('2026-01-15T09:30:00') })).rejects.toThrow('Send failed');

    expect(sendMailMock).toHaveBeenCalledTimes(1);
    expect(generateMonthlySections).not.toHaveBeenCalled();
  });

  it('NON-DRY RUN: if an employee send fails, job throws and stops further employee sends', async () => {
    process.env.DRY_RUN = '0';
    process.env.GMAIL_USER = 'test@example.com';
    process.env.GMAIL_APP_PASSWORD = 'secret';
    process.env.TEST_EMAILS = 'test@example.com';

    sendMailMock
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error('Employee send failed'));

    await expect(runMonthly({ now: new Date('2026-01-15T09:30:00') })).rejects.toThrow('Employee send failed');

    expect(sendMailMock).toHaveBeenCalledTimes(3);
  });

  it('NON-DRY RUN: fails fast on first employee LLM error after department success', async () => {
    process.env.DRY_RUN = '0';
    process.env.GMAIL_USER = 'test@example.com';
    process.env.GMAIL_APP_PASSWORD = 'secret';
    process.env.TEST_EMAILS = 'test@example.com';

    vi.mocked(generateMonthlySections)
      .mockResolvedValueOnce({ sections: mockEmployeeSections, usage: null })
      .mockRejectedValueOnce(new Error('LLM failed'));

    await expect(runMonthly({ now: new Date('2026-01-15T09:30:00') })).rejects.toThrow('LLM failed');

    expect(generateMonthlyDepartmentSections).toHaveBeenCalledTimes(1);
    expect(generateMonthlySections).toHaveBeenCalledTimes(2);
    expect(sendMailMock).toHaveBeenCalledTimes(2);
  });

  it('department LLM inputJson has only 2 months (current + prev1), no prev2', async () => {
    process.env.DRY_RUN = '1';

    await runMonthly({ now: new Date('2026-01-15T09:30:00') });

    expect(generateMonthlyDepartmentSections).toHaveBeenCalledTimes(1);
    const call = vi.mocked(generateMonthlyDepartmentSections).mock.calls[0][0];
    const inputJson = call.inputJson;

    expect(inputJson).toHaveProperty('periodStart');
    expect(inputJson).toHaveProperty('analytics');
    expect(inputJson).toHaveProperty('rawSummaries');
    expect(inputJson.rawSummaries).toHaveProperty('current');
    expect(inputJson.rawSummaries).toHaveProperty('prev1');
    expect(inputJson.rawSummaries.prev2).toBeUndefined();
    expect(inputJson.rawSummaries).not.toHaveProperty('prev2');
    expect(JSON.stringify(inputJson)).not.toContain('prev2');
  });

  it('employee inputJson includes calculated, periodEnd, workingDaysInPeriod (smoke)', async () => {
    process.env.DRY_RUN = '1';
    await runMonthly({ now: new Date('2026-01-15T09:30:00') });

    expect(generateMonthlySections).toHaveBeenCalled();
    const firstEmployeeCall = vi.mocked(generateMonthlySections).mock.calls.find(
      (c) => c[0]?.inputJson?.person != null
    );
    expect(firstEmployeeCall).toBeDefined();
    const inputJson = firstEmployeeCall[0].inputJson;

    expect(inputJson.workingDaysInPeriod).toBeGreaterThan(0);
    expect(inputJson.periodEnd).toBeDefined();
    expect(inputJson.periodStart).toBeDefined();
    expect(inputJson.calculated).toBeDefined();
    expect(inputJson.calculated.period).toEqual(
      expect.objectContaining({
        periodStart: inputJson.periodStart,
        periodEnd: inputJson.periodEnd,
        workingDaysInPeriod: inputJson.workingDaysInPeriod,
      })
    );
    const empCur = inputJson.calculated.employee.current;
    expect(typeof empCur.apeluriMediiZiLucratoare === 'number' || empCur.apeluriMediiZiLucratoare === null).toBe(true);
    expect(typeof empCur.conversieProspectarePct === 'number' || empCur.conversieProspectarePct === null).toBe(true);
    expect(typeof empCur.realizareTargetPct === 'number' || empCur.realizareTargetPct === null).toBe(true);
    expect(empCur).toHaveProperty('profitTotalEur');
    expect(inputJson.calculated.employee.prev).toBeDefined();
    expect(inputJson.calculated.department).toHaveProperty('current');
    expect(inputJson.calculated.department).toHaveProperty('prev');
  });

  it('DRY_RUN path does not load or save run state', async () => {
    process.env.DRY_RUN = '1';
    loadMonthlyRunStateMock.mockClear();
    saveMonthlyRunStateMock.mockClear();

    await runMonthly({ now: new Date('2026-01-15T09:30:00') });

    expect(loadMonthlyRunStateMock).not.toHaveBeenCalled();
    expect(saveMonthlyRunStateMock).not.toHaveBeenCalled();
  });

  it('department email: subject from code, Rezumat Executiv from reportSummary (deterministic)', async () => {
    process.env.DRY_RUN = '1';
    let deptEmailOpts;
    let deptEmailResult;
    const origBuildDept = emailMonthly.buildMonthlyDepartmentEmail;
    const spy = vi.spyOn(emailMonthly, 'buildMonthlyDepartmentEmail').mockImplementation((opts) => {
      deptEmailOpts = opts;
      deptEmailResult = origBuildDept(opts);
      return deptEmailResult;
    });
    await runMonthly({ now: new Date('2026-01-15T09:30:00') });
    spy.mockRestore();
    expect(deptEmailOpts).toBeDefined();
    expect(deptEmailOpts.reportSummaryPrev).toBeDefined();
    expect(deptEmailResult?.subject).toMatch(/raport.*departamental/i);
    expect(deptEmailResult?.subject).toMatch(/\d{4}/);
    expect(deptEmailResult?.html).toContain('Comparație Vânzări vs. Operațional');
    expect(deptEmailResult?.html).toMatch(/\d+(\.\d+)?%|N\/A/);
    expect(deptEmailResult?.html).not.toMatch(/Nu pot determina|explicație|depinde de date/i);
  });

  it('NON-DRY RUN: when loadMonthlyRunState throws (read error), runMonthly fails immediately without send/LLM/checkpoint save', async () => {
    process.env.DRY_RUN = '0';
    process.env.GMAIL_USER = 'test@example.com';
    process.env.GMAIL_APP_PASSWORD = 'secret';
    process.env.SEND_MODE = 'prod';

    const loadErr = Object.assign(new Error('Run-state read failed'), { code: RUN_STATE_UNAVAILABLE });
    loadMonthlyRunStateMock.mockRejectedValueOnce(loadErr);
    sendMailMock.mockClear();
    saveMonthlyRunStateMock.mockClear();
    vi.mocked(generateMonthlySections).mockClear();
    vi.mocked(generateMonthlyDepartmentSections).mockClear();

    await expect(runMonthly({ now: new Date('2026-01-15T09:30:00') })).rejects.toThrow(
      'Monthly run-state unavailable/corrupt for'
    );

    expect(sendMailMock).not.toHaveBeenCalled();
    expect(generateMonthlyDepartmentSections).not.toHaveBeenCalled();
    expect(generateMonthlySections).not.toHaveBeenCalled();
    expect(saveMonthlyRunStateMock).not.toHaveBeenCalled();
  });

  it('NON-DRY RUN: partial success then failure – first run sends department + one employee, then fails on next employee', async () => {
    process.env.DRY_RUN = '0';
    process.env.GMAIL_USER = 'test@example.com';
    process.env.GMAIL_APP_PASSWORD = 'secret';
    process.env.TEST_EMAILS = 'test@example.com';

    const activePeople = ORG.filter((p) => p.isActive);
    sendMailMock
      .mockResolvedValueOnce({}) // department
      .mockResolvedValueOnce({}) // first employee
      .mockRejectedValueOnce(new Error('Employee B send failed'));

    await expect(runMonthly({ now: new Date('2026-01-15T09:30:00') })).rejects.toThrow('Employee B send failed');

    expect(sendMailMock).toHaveBeenCalledTimes(3); // dept + emp1 + fail on emp2
    const lastSavedState = saveMonthlyRunStateMock.mock.calls[saveMonthlyRunStateMock.mock.calls.length - 1]?.[1];
    expect(lastSavedState).toBeDefined();
    expect(lastSavedState.stages.department.send.status).toBe('ok');
    const firstEmployeeEmail = activePeople[0].email;
    expect(lastSavedState.stages.employees[firstEmployeeEmail].send.status).toBe('ok');
    expect(lastSavedState.completed).toBe(false);
  });

  it('NON-DRY RUN: resume run does NOT resend department or already-sent employee, continues with remaining only', async () => {
    process.env.DRY_RUN = '0';
    process.env.GMAIL_USER = 'test@example.com';
    process.env.GMAIL_APP_PASSWORD = 'secret';
    process.env.TEST_EMAILS = 'test@example.com';

    const activePeople = ORG.filter((p) => p.isActive);
    const label = '2025-12-01..2025-12-31';
    const firstEmployee = activePeople[0];
    const resumeState = createInitialState({ label, periodStart: '2025-12-01', periodEnd: '2025-12-31' });
    resumeState.stages.collect = { status: 'ok', completedAt: new Date().toISOString() };
    resumeState.stages.department = {
      llm: { status: 'ok', attempts: 1, completedAt: new Date().toISOString() },
      send: { status: 'ok', attempts: 1, completedAt: new Date().toISOString() },
      llmSections: mockDepartmentSections,
    };
    resumeState.stages.employees[firstEmployee.email] = {
      llm: { status: 'ok', attempts: 1, completedAt: new Date().toISOString() },
      send: { status: 'ok', attempts: 1, completedAt: new Date().toISOString() },
      name: firstEmployee.name,
      llmSections: mockEmployeeSections,
    };
    loadMonthlyRunStateMock.mockResolvedValueOnce(resumeState);

    await runMonthly({ now: new Date('2026-01-15T09:30:00') });

    expect(sendMailMock).toHaveBeenCalled();
    const deptCalls = sendMailMock.mock.calls.filter((c) => c[0].attachments?.length > 0);
    expect(deptCalls.length).toBe(0);
    const employeeCalls = sendMailMock.mock.calls.filter((c) => !c[0].attachments?.length);
    expect(employeeCalls.length).toBe(activePeople.length - 1);
  });

  it('NON-DRY RUN: completed run rerun is no-op, no sendMail calls', async () => {
    process.env.DRY_RUN = '0';
    process.env.GMAIL_USER = 'test@example.com';
    process.env.GMAIL_APP_PASSWORD = 'secret';
    process.env.TEST_EMAILS = 'test@example.com';

    const label = '2025-12-01..2025-12-31';
    const completedState = createInitialState({ label, periodStart: '2025-12-01', periodEnd: '2025-12-31' });
    completedState.completed = true;
    completedState.stages.collect = { status: 'ok', completedAt: new Date().toISOString() };
    completedState.stages.department = {
      llm: { status: 'ok', attempts: 1 },
      send: { status: 'ok', attempts: 1 },
    };
    loadMonthlyRunStateMock.mockResolvedValueOnce(completedState);
    sendMailMock.mockClear();

    const result = await runMonthly({ now: new Date('2026-01-15T09:30:00') });

    expect(result).toEqual({ payload: expect.any(Object) });
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it('NON-DRY RUN: transient send error then success retries and succeeds', async () => {
    process.env.DRY_RUN = '0';
    process.env.GMAIL_USER = 'test@example.com';
    process.env.GMAIL_APP_PASSWORD = 'secret';
    process.env.TEST_EMAILS = 'test@example.com';

    const transientErr = Object.assign(new Error('Connection timeout'), { code: 'ETIMEDOUT' });
    sendMailMock
      .mockRejectedValueOnce(transientErr)
      .mockResolvedValue({});

    const result = await runMonthly({ now: new Date('2026-01-15T09:30:00') });

    expect(result).toEqual({ payload: expect.any(Object) });
    expect(sendMailMock).toHaveBeenCalled();
    const calls = sendMailMock.mock.calls.length;
    expect(calls).toBeGreaterThanOrEqual(2);
  });

  it('NON-DRY RUN: permanent send error fails fast without useless retries', async () => {
    process.env.DRY_RUN = '0';
    process.env.GMAIL_USER = 'test@example.com';
    process.env.GMAIL_APP_PASSWORD = 'secret';
    process.env.TEST_EMAILS = 'test@example.com';

    const permanentErr = Object.assign(new Error('Invalid login'), { code: 'EAUTH' });
    sendMailMock.mockRejectedValue(permanentErr);

    await expect(runMonthly({ now: new Date('2026-01-15T09:30:00') })).rejects.toThrow('Invalid login');
    expect(sendMailMock).toHaveBeenCalledTimes(1);
  });

  it('NON-DRY RUN: retries exhausted throws and checkpoint remains failed', async () => {
    process.env.DRY_RUN = '0';
    process.env.GMAIL_USER = 'test@example.com';
    process.env.GMAIL_APP_PASSWORD = 'secret';
    process.env.TEST_EMAILS = 'test@example.com';
    process.env.EMAIL_SEND_MAX_ATTEMPTS = '3';

    const transientErr = Object.assign(new Error('Connection closed'), { code: 'ECONNECTION' });
    sendMailMock.mockRejectedValue(transientErr);

    await expect(runMonthly({ now: new Date('2026-01-15T09:30:00') })).rejects.toThrow('Connection closed');

    expect(sendMailMock).toHaveBeenCalledTimes(3);
    const lastSavedState = saveMonthlyRunStateMock.mock.calls[saveMonthlyRunStateMock.mock.calls.length - 1]?.[1];
    expect(lastSavedState).toBeDefined();
    expect(lastSavedState.stages.department.send.status).toBe('failed');
    expect(lastSavedState.completed).toBe(false);
  });

  it('buildEmployeeInputCalculated produces valid shape with mock data', () => {
    const data3Months = {
      current: {
        target: 25000,
        ctr_principalProfitEur: 10000,
        livr_principalProfitEur: 10000,
        callsCount: 605,
        contactat: 555,
        calificat: 129,
      },
      prev: { target: 20000, ctr_principalProfitEur: 8000, livr_principalProfitEur: 8000, callsCount: 400, contactat: 200, calificat: 50 },
    };
    const deptAverages3Months = {
      current: { profitTotal: 50000, targetTotal: 60000, callsCount: 1200, contactat: 1000, calificat: 200 },
      prev: { profitTotal: 45000, targetTotal: 55000, callsCount: 1100, contactat: 900, calificat: 180 },
    };
    const calculated = buildEmployeeInputCalculated(
      data3Months,
      deptAverages3Months,
      21,
      '2026-02-01',
      '2026-02-28',
    );
    expect(calculated.period.workingDaysInPeriod).toBe(21);
    expect(calculated.period.periodStart).toBe('2026-02-01');
    expect(calculated.period.periodEnd).toBe('2026-02-28');
    expect(calculated.employee.current.realizareTargetPct).toBe(80);
    expect(calculated.employee.current.apeluriMediiZiLucratoare).toBe(28.81);
    expect(calculated.employee.current.conversieProspectarePct).toBe(18.86);
    expect(calculated.employee.current.profitTotalEur).toBe(20000);
    expect(calculated.department.current.realizareTargetPct).toBe(83.33);
  });
});
