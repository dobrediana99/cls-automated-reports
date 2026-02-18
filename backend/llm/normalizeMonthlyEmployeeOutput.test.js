/**
 * Tests for normalizeMonthlyEmployeeOutput: broken LLM output is fixed so AJV validation passes.
 */

import { describe, it, expect } from 'vitest';
import { normalizeMonthlyEmployeeOutput } from './normalizeMonthlyEmployeeOutput.js';
import { validateEmployeeOutput } from './validateMonthlyOutput.js';

const minimalAntet = {
  subiect: 'Raport',
  greeting: 'Bună,',
  intro_message: 'Intro',
};
const minimalS2 = { stil: 'Obiectiv', include: ['Item 1'] };
const minimalS4Structura = { ce: 'x', de_ce: 'y', masurabil: 'z', deadline: 'd' };
const minimalS5 = { format: { saptamana_1: 'S1', saptamana_2_4: 'S2-4' } };
const minimalIncheiere = {
  raport_urmator: 'Next',
  mesaj_sub_80: 'Sub 80 msg',
  mesaj_peste_80: 'Peste 80 msg',
  semnatura: { nume: 'N', functie: 'F', companie: 'C' },
};

function fullValidEmployee() {
  return {
    antet: { ...minimalAntet },
    sectiunea_1_tabel_date_performanta: { continut: ['Row 1'] },
    sectiunea_2_interpretare_date: { ...minimalS2, include: [...minimalS2.include] },
    sectiunea_3_concluzii: {
      ce_merge_bine: 'A',
      ce_nu_merge_si_necesita_interventie_urgenta: 'B',
      focus_luna_urmatoare: 'C',
    },
    sectiunea_4_actiuni_prioritare: {
      format_actiune: 'Format',
      structura: { ...minimalS4Structura },
      actiuni_specifice_per_rol: {
        freight_forwarder: ['F1'],
        sales_freight_agent: ['S1'],
      },
    },
    sectiunea_5_plan_saptamanal: { format: { ...minimalS5.format } },
    incheiere: { ...minimalIncheiere, semnatura: { ...minimalIncheiere.semnatura } },
  };
}

describe('normalizeMonthlyEmployeeOutput', () => {
  it('sectiunea_1.continut: trims and removes empty; empty array → ["Date indisponibile"]', () => {
    const o = fullValidEmployee();
    o.sectiunea_1_tabel_date_performanta.continut = ['  a  ', '', '  ', 'b'];
    normalizeMonthlyEmployeeOutput(o);
    expect(o.sectiunea_1_tabel_date_performanta.continut).toEqual(['a', 'b']);

    o.sectiunea_1_tabel_date_performanta.continut = ['', '  ', ''];
    normalizeMonthlyEmployeeOutput(o);
    expect(o.sectiunea_1_tabel_date_performanta.continut).toEqual(['Date indisponibile']);
  });

  it('sectiunea_3: non-string ce_merge_bine / ce_nu_merge_si_necesita_interventie_urgenta → string', () => {
    const o = fullValidEmployee();
    o.sectiunea_3_concluzii.ce_merge_bine = ['p1', 'p2'];
    o.sectiunea_3_concluzii.ce_nu_merge_si_necesita_interventie_urgenta = { a: 1 };
    normalizeMonthlyEmployeeOutput(o);
    expect(o.sectiunea_3_concluzii.ce_merge_bine).toBe('p1\np2');
    expect(o.sectiunea_3_concluzii.ce_nu_merge_si_necesita_interventie_urgenta).toBe('{"a":1}');
  });

  it('sectiunea_4.actiuni_specifice_per_rol: synonym keys mapped, extra keys removed', () => {
    const o = fullValidEmployee();
    o.sectiunea_4_actiuni_prioritare.actiuni_specifice_per_rol = {
      forwarder: ['FF1'],
      sales_agent: ['SA1'],
      extra_key: ['x'],
    };
    normalizeMonthlyEmployeeOutput(o);
    expect(o.sectiunea_4_actiuni_prioritare.actiuni_specifice_per_rol).toEqual({
      freight_forwarder: ['FF1'],
      sales_freight_agent: ['SA1'],
    });
  });

  it('after normalization, validateEmployeeOutput passes (performancePct 85)', () => {
    const o = fullValidEmployee();
    o.sectiunea_1_tabel_date_performanta.continut = ['  only row  ', ''];
    o.sectiunea_3_concluzii.ce_merge_bine = ['Merge A', 'Merge B'];
    o.sectiunea_3_concluzii.ce_nu_merge_si_necesita_interventie_urgenta = null;
    o.sectiunea_4_actiuni_prioritare.actiuni_specifice_per_rol = {
      freight: ['F1'],
      sales: ['S1'],
    };
    normalizeMonthlyEmployeeOutput(o);
    const result = validateEmployeeOutput(o, { performancePct: 85 });
    expect(result).toBe(o);
    expect(result.sectiunea_1_tabel_date_performanta.continut).toEqual(['only row']);
    expect(result.sectiunea_3_concluzii.ce_merge_bine).toBe('Merge A\nMerge B');
    expect(result.sectiunea_3_concluzii.ce_nu_merge_si_necesita_interventie_urgenta).toBe('N/A');
    expect(result.sectiunea_4_actiuni_prioritare.actiuni_specifice_per_rol).toEqual({
      freight_forwarder: ['F1'],
      sales_freight_agent: ['S1'],
    });
  });
});
