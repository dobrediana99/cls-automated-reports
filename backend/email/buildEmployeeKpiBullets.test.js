/**
 * Tests for employee KPI bullets: deterministic output and anti-"Nu pot determina" guarantee.
 */

import { describe, it, expect } from 'vitest';
import { buildEmployeeKpiBullets, applyEmployeeKpiOverwrite } from './buildEmployeeKpiBullets.js';

describe('buildEmployeeKpiBullets', () => {
  it('returns 5 lines with N/A when cur/prev are empty', () => {
    const meta = { periodStart: '2026-02-01', periodEnd: '2026-02-28' };
    const lines = buildEmployeeKpiBullets(null, null, 20, meta);
    expect(lines).toHaveLength(5);
    expect(lines[0]).toContain('Realizare target:');
    expect(lines[1]).toContain('Profit total:');
    expect(lines[2]).toContain('Apeluri medii/zi (lucrătoare):');
    expect(lines[3]).toContain('Conversie prospectare (calificat/contactat):');
    expect(lines[4]).toContain('Zile lucrătoare în perioadă:');
    expect(lines[4]).toContain('2026-02-01..2026-02-28');
  });

  it('fills numeric KPI when cur has data', () => {
    const cur = {
      target: 25000,
      ctr_principalProfitEur: 10000,
      ctr_secondaryProfitEur: 0,
      livr_principalProfitEur: 10000,
      livr_secondaryProfitEur: 0,
      callsCount: 605,
      contactat: 555,
      calificat: 129,
    };
    const prev = { target: 20000, ctr_principalProfitEur: 8000, livr_principalProfitEur: 8000, callsCount: 400, contactat: 200, calificat: 50 };
    const meta = { periodStart: '2026-02-01', periodEnd: '2026-02-28' };
    const lines = buildEmployeeKpiBullets(cur, prev, 21, meta);
    expect(lines[0]).toMatch(/Realizare target: 80% \(luna anterioară: 80%\)/);
    expect(lines[2]).toMatch(/Apeluri medii\/zi \(lucrătoare\): 28\.81/);
    expect(lines[3]).toMatch(/Conversie prospectare.*23\.24%.*luna anterioară/);
    expect(lines[4]).toContain('Zile lucrătoare în perioadă: 21');
  });

  it('never contains "Nu pot determina"', () => {
    const lines = buildEmployeeKpiBullets(null, null, 22, { periodStart: '2026-01-01', periodEnd: '2026-01-31' });
    const joined = lines.join(' ');
    expect(joined).not.toContain('Nu pot determina');
  });
});

describe('applyEmployeeKpiOverwrite (anti-Nu pot determina)', () => {
  it('overwrites sectiunea_1 so continut does not contain "Nu pot determina"', () => {
    const llmSections = {
      sectiunea_1_tabel_date_performanta: {
        continut: [
          'Nu pot determina realizarea target.',
          'Nu pot determina apelurile medii.',
          'Conversie: Nu pot determina.',
        ],
      },
    };
    const lines = [
      'Realizare target: N/A (luna anterioară: N/A)',
      'Profit total: N/A (luna anterioară: N/A)',
      'Apeluri medii/zi (lucrătoare): N/A (luna anterioară: N/A)',
      'Conversie prospectare (calificat/contactat): N/A (luna anterioară: N/A)',
      'Zile lucrătoare în perioadă: 21 (2026-02-01..2026-02-28)',
    ];
    applyEmployeeKpiOverwrite(llmSections, lines);
    const continut = llmSections.sectiunea_1_tabel_date_performanta.continut;
    expect(Array.isArray(continut)).toBe(true);
    const joined = continut.join(' ');
    expect(joined).not.toContain('Nu pot determina');
    expect(joined).toContain('Apeluri medii/zi (lucrătoare):');
    expect(joined).toContain('Conversie prospectare');
  });

  it('creates sectiunea_1_tabel_date_performanta if missing', () => {
    const llmSections = {};
    const lines = ['Line 1', 'Line 2'];
    applyEmployeeKpiOverwrite(llmSections, lines);
    expect(llmSections.sectiunea_1_tabel_date_performanta).toBeDefined();
    expect(llmSections.sectiunea_1_tabel_date_performanta.continut).toEqual(['Line 1', 'Line 2']);
  });
});
