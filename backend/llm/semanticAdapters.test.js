/**
 * Tests for semantic adapters: LLM output → semantic payload (content only; structure is backend).
 */

import { describe, it, expect } from 'vitest';
import { employeeToSemanticPayload, departmentToSemanticPayload } from './semanticAdapters.js';

describe('employeeToSemanticPayload', () => {
  const minimalEmployeeSections = {
    antet: { subiect: 'Sub', greeting: 'Bună, X,', intro_message: 'Intro text' },
    sectiunea_2_interpretare_date: { stil: 'Obiectiv', include: ['Punct 1', 'Punct 2'] },
    sectiunea_3_concluzii: {
      ce_merge_bine: 'Merge bine',
      ce_nu_merge_si_necesita_interventie_urgenta: 'Nu merge',
      focus_luna_urmatoare: 'Focus',
    },
    sectiunea_4_actiuni_prioritare: {
      actiuni_specifice_per_rol: {
        freight_forwarder: ['A1'],
        sales_freight_agent: ['A2'],
      },
    },
    sectiunea_5_plan_saptamanal: {
      format: { saptamana_1: 'S1', saptamana_2_4: 'S2-4' },
    },
    incheiere: {
      raport_urmator: 'Next',
      mesaj_sub_80: 'Sub 80',
      mesaj_peste_80: 'Peste 80',
      semnatura: { nume: 'N', functie: 'F', companie: 'C' },
    },
  };

  it('extracts semantic payload; actiuni is flat list (no role structure)', () => {
    const payload = employeeToSemanticPayload(minimalEmployeeSections);
    expect(payload).toHaveProperty('greeting', 'Bună, X,');
    expect(payload).toHaveProperty('introMessage', 'Intro text');
    expect(payload.interpretare).toEqual({ stil: 'Obiectiv', include: ['Punct 1', 'Punct 2'] });
    expect(payload.concluzii.ceMergeBine).toBe('Merge bine');
    expect(payload.actiuni).toEqual(['A1', 'A2']);
    expect(payload.plan.saptamana_1).toBe('S1');
    expect(payload.checkIn).toBeNull();
    expect(payload.incheiere.raportUrmator).toBe('Next');
  });

  it('includes checkIn when sectiunea_6 is present', () => {
    const withS6 = {
      ...minimalEmployeeSections,
      sectiunea_6_check_in_intermediar: { regula: 'Reg', format: 'Format' },
    };
    const payload = employeeToSemanticPayload(withS6);
    expect(payload.checkIn).not.toBeNull();
    expect(payload.checkIn.regula).toBe('Reg');
    expect(payload.checkIn.format).toBe('Format');
  });

  it('throws when llmSections is missing or not object', () => {
    expect(() => employeeToSemanticPayload(null)).toThrow(/requires validated llmSections/);
    expect(() => employeeToSemanticPayload(undefined)).toThrow(/requires validated llmSections/);
  });
});

describe('departmentToSemanticPayload', () => {
  const minimalDeptSections = {
    antet: { introducere: 'Intro dept' },
    sectiunea_2_analiza_vanzari: {
      performantaVsIstoric: { a: '1' },
      targetDepartamental: {},
      metriciMediiPerAngajat: {},
      tabelAngajati: '',
      problemeIdentificateAngajati: [],
      highPerformers: [],
      lowPerformers: [],
      problemeSistemice: [],
    },
    sectiunea_3_analiza_operational: {
      performantaVsIstoric: {},
      targetDepartamental: {},
      metriciMediiPerAngajat: {},
      tabelAngajati: '',
      problemeIdentificateAngajati: [],
      highPerformers: [],
      lowPerformers: [],
      problemeSistemice: [],
    },
    sectiunea_4_comparatie_departamente: { tabelComparativ: {}, observatii: [] },
    sectiunea_5_recomandari_management: {
      oneToOneLowPerformers: [],
      trainingNecesare: [],
      urmarireSaptamanala: [],
      setareObiectiveSpecifice: [],
      mutariRolOptional: [],
      problemeSistemiceProces: [],
    },
    incheiere: { urmatorulRaport: 'Next', semnatura: {} },
  };

  it('extracts semantic payload; ignores sectiunea_1 (Rezumat is backend)', () => {
    const payload = departmentToSemanticPayload(minimalDeptSections);
    expect(payload.intro).toBe('Intro dept');
    expect(payload.analizaVanzari.performantaVsIstoric).toEqual({ a: '1' });
    expect(payload.comparatie).toHaveProperty('tabelComparativ');
    expect(payload.recomandari).toHaveProperty('trainingNecesare');
    expect(payload.incheiere.urmatorulRaport).toBe('Next');
  });

  it('throws when llmSections is missing or not object', () => {
    expect(() => departmentToSemanticPayload(null)).toThrow(/requires validated llmSections/);
  });
});
