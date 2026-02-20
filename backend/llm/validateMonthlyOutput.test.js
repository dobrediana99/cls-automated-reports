/**
 * Unit tests for validateMonthlyOutput: schema (extra keys, missing keys, empty string),
 * check-in rule (pct >= 80 + sectiunea_6 present => FAIL; pct < 80 + sectiunea_6 missing => FAIL).
 */

import { describe, it, expect } from 'vitest';
import {
  validateEmployeeOutput,
  validateDepartmentOutput,
} from './validateMonthlyOutput.js';

const minimalAntet = {
  subiect: 'Raport',
  greeting: 'Bună,',
  intro_message: 'Intro',
};
const minimalS1 = { continut: ['Row 1'] };
const minimalS2 = { stil: 'Obiectiv', include: ['Item 1'] };
const minimalS3 = {
  ce_merge_bine: 'A',
  ce_nu_merge_si_necesita_interventie_urgenta: 'B',
  focus_luna_urmatoare: 'C',
};
const minimalS4 = {
  format_actiune: 'Format',
  structura: { ce: 'x', de_ce: 'y', masurabil: 'z', deadline: 'd' },
  actiuni_specifice_per_rol: {
    freight_forwarder: ['F1'],
    sales_freight_agent: ['S1'],
  },
};
const minimalS5 = {
  format: { saptamana_1: 'S1', saptamana_2_4: 'S2-4' },
};
const minimalS6 = {
  regula: 'Sub 80%',
  format: 'Check-in: ...',
};
const minimalIncheiere = {
  raport_urmator: 'Next',
  mesaj_sub_80: 'Sub 80 msg',
  mesaj_peste_80: 'Peste 80 msg',
  semnatura: { nume: 'N', functie: 'F', companie: 'C' },
};

function validEmployee(includeS6 = false) {
  const o = {
    antet: { ...minimalAntet },
    sectiunea_1_tabel_date_performanta: { ...minimalS1, continut: [...(minimalS1.continut)] },
    sectiunea_2_interpretare_date: { ...minimalS2, include: [...(minimalS2.include)] },
    sectiunea_3_concluzii: { ...minimalS3 },
    sectiunea_4_actiuni_prioritare: {
      ...minimalS4,
      structura: { ...minimalS4.structura },
      actiuni_specifice_per_rol: {
        freight_forwarder: [...minimalS4.actiuni_specifice_per_rol.freight_forwarder],
        sales_freight_agent: [...minimalS4.actiuni_specifice_per_rol.sales_freight_agent],
      },
    },
    sectiunea_5_plan_saptamanal: { format: { ...minimalS5.format } },
    incheiere: { ...minimalIncheiere, semnatura: { ...minimalIncheiere.semnatura } },
  };
  if (includeS6) o.sectiunea_6_check_in_intermediar = { ...minimalS6 };
  return o;
}

describe('validateEmployeeOutput', () => {
  it('accepts valid employee without sectiunea_6', () => {
    const obj = validEmployee(false);
    expect(validateEmployeeOutput(obj, { performancePct: 85 })).toEqual(obj);
  });

  it('accepts valid employee with sectiunea_6 when pct < 80', () => {
    const obj = validEmployee(true);
    expect(validateEmployeeOutput(obj, { performancePct: 75 })).toEqual(obj);
  });

  it('FAIL when extra top-level key', () => {
    const obj = { ...validEmployee(false), extraKey: 'x' };
    expect(() => validateEmployeeOutput(obj, { performancePct: 85 })).toThrow(
      /schema validation failed|additionalProperties/
    );
  });

  it('FAIL when missing required key (incheiere)', () => {
    const obj = validEmployee(false);
    delete obj.incheiere;
    expect(() => validateEmployeeOutput(obj, { performancePct: 85 })).toThrow(
      /schema validation failed|required/
    );
  });

  it('FAIL when string empty (antet.subiect)', () => {
    const obj = validEmployee(false);
    obj.antet.subiect = '';
    expect(() => validateEmployeeOutput(obj, { performancePct: 85 })).toThrow(
      /schema validation failed|minLength/
    );
  });

  it('FAIL when performancePct >= 80 and sectiunea_6 present (check-in rule)', () => {
    const obj = validEmployee(true);
    expect(() => validateEmployeeOutput(obj, { performancePct: 80 })).toThrow(
      /sectiunea_6|performancePct >= 80/
    );
    expect(() => validateEmployeeOutput(obj, { performancePct: 90 })).toThrow(
      /sectiunea_6|performancePct >= 80/
    );
  });

  it('FAIL when performancePct < 80 and sectiunea_6 missing (check-in rule)', () => {
    const obj = validEmployee(false);
    expect(() => validateEmployeeOutput(obj, { performancePct: 79 })).toThrow(
      /sectiunea_6|sub 80|missing/
    );
  });

  it('no check-in enforcement when performancePct is null/undefined', () => {
    const withS6 = validEmployee(true);
    const withoutS6 = validEmployee(false);
    expect(validateEmployeeOutput(withoutS6, { performancePct: null })).toEqual(withoutS6);
    expect(validateEmployeeOutput(withoutS6, {})).toEqual(withoutS6);
    expect(validateEmployeeOutput(withS6, { performancePct: undefined })).toEqual(withS6);
  });

  it('pct 70: requires sectiunea_6 and incheiere.mesaj_sub_80 (non-empty)', () => {
    const withS6 = validEmployee(true);
    withS6.incheiere.mesaj_sub_80 = 'Mesaj pentru sub 80%';
    expect(validateEmployeeOutput(withS6, { performancePct: 70 })).toEqual(withS6);

    const noMesajSub80 = validEmployee(true);
    delete noMesajSub80.incheiere.mesaj_sub_80;
    expect(() => validateEmployeeOutput(noMesajSub80, { performancePct: 70 })).toThrow(
      /Missing required incheiere\.mesaj_sub_80 for performancePct < 80/
    );
  });

  it('pct 85: requires no sectiunea_6 and incheiere.mesaj_peste_80 (non-empty)', () => {
    const withoutS6 = validEmployee(false);
    withoutS6.incheiere.mesaj_peste_80 = 'Mesaj pentru peste 80%';
    expect(validateEmployeeOutput(withoutS6, { performancePct: 85 })).toEqual(withoutS6);

    const noMesajPeste80 = validEmployee(false);
    delete noMesajPeste80.incheiere.mesaj_peste_80;
    expect(() => validateEmployeeOutput(noMesajPeste80, { performancePct: 85 })).toThrow(
      /Missing required incheiere\.mesaj_peste_80 for performancePct >= 80/
    );
  });
});

const minimalDeptAntet = { subiect: 'Raport Dept', introducere: 'Intro' };
const minimalRezumat = {
  titlu: 'Rezumat',
  performanta_generala: {
    totalProfitCompanie: '1',
    targetDepartamentalCombinat: '2',
    realizareTarget: '3',
    numarTotalCurse: '4',
  },
  departamentVanzari: { profit: '1', procentDinTarget: '2', trend: '3', status: '4' },
  departamentOperational: { profit: '1', procentDinTarget: '2', trend: '3', status: '4' },
  observatiiCritice: ['O1'],
};
const minimalAnaliza = {
  titlu: 'Analiză',
  performantaVsIstoric: { lunaCurenta: '1', lunaAnterioara: '2', trend: '3' },
  targetDepartamental: { target: '1', realizat: '2', procentAtingere: '3', status: '4' },
  metriciMediiPerAngajat: {
    profitMediu: '1',
    curseMedii: '2',
    apeluriMediiZi: '3',
    conversieMedieClienti: '4',
  },
  tabelAngajati: 'Tabel',
  problemeIdentificateAngajati: [{ nume: 'A', probleme: ['P1'] }],
  highPerformers: [],
  lowPerformers: [],
  problemeSistemice: [],
};
const minimalComparatie = {
  titlu: 'Comparație',
  tabelComparativ: {
    profitTotal: { vanzari: '1', operational: '2', diferenta: '3' },
    numarCurseTotal: { vanzari: '1', operational: '2', diferenta: '3' },
    procentTargetDepartamental: { vanzari: '1', operational: '2', diferenta: '3' },
    profitMediuAngajat: { vanzari: '1', operational: '2', diferenta: '3' },
    trendVsLunaAnterioara: { vanzari: '1', operational: '2' },
  },
  observatii: ['Obs'],
};
const minimalRecomandari = {
  titlu: 'Recomandări',
  oneToOneLowPerformers: [],
  trainingNecesare: [],
  urmarireSaptamanala: [],
  setareObiectiveSpecifice: [],
  mutariRolOptional: [],
  problemeSistemiceProces: [],
};
const minimalDeptIncheiere = {
  urmatorulRaport: 'Next',
  semnatura: { functie: 'F', companie: 'C' },
};

function validDepartment() {
  return {
    antet: minimalDeptAntet,
    sectiunea_1_rezumat_executiv: minimalRezumat,
    sectiunea_2_analiza_vanzari: { ...minimalAnaliza, metriciMediiPerAngajat: { profitMediu: '1', curseMedii: '2', apeluriMediiZi: '3', conversieMedieClienti: '4' } },
    sectiunea_3_analiza_operational: {
      ...minimalAnaliza,
      metriciMediiPerAngajat: {
        profitMediu: '1',
        curseMedii: '2',
        curseMediiBurse: '3',
        procentProfitPrincipal: '4',
        procentProfitSecundar: '5',
      },
    },
    sectiunea_4_comparatie_departamente: minimalComparatie,
    sectiunea_5_recomandari_management: minimalRecomandari,
    incheiere: minimalDeptIncheiere,
  };
}

describe('validateDepartmentOutput', () => {
  it('accepts valid department', () => {
    const obj = validDepartment();
    expect(validateDepartmentOutput(obj)).toEqual(obj);
  });

  it('accepts valid department without sectiunea_1_rezumat_executiv', () => {
    const obj = validDepartment();
    delete obj.sectiunea_1_rezumat_executiv;
    expect(validateDepartmentOutput(obj)).toEqual(obj);
  });

  it('FAIL when extra key', () => {
    const obj = { ...validDepartment(), extra: 'x' };
    expect(() => validateDepartmentOutput(obj)).toThrow(
      /schema validation failed|additionalProperties/
    );
  });

  it('FAIL when missing required key (e.g. incheiere)', () => {
    const obj = validDepartment();
    delete obj.incheiere;
    expect(() => validateDepartmentOutput(obj)).toThrow(
      /schema validation failed|required/
    );
  });

  it('FAIL when string empty', () => {
    const obj = validDepartment();
    obj.antet.subiect = '';
    expect(() => validateDepartmentOutput(obj)).toThrow(
      /schema validation failed|minLength/
    );
  });
});
