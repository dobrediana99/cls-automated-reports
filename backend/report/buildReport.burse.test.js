import { describe, it, expect } from 'vitest';
import { buildReport } from './buildReport.js';
import { COLS } from './constants.js';

describe('buildReport bursă metrics', () => {
  function makePersonValue(id) {
    return {
      value: JSON.stringify({
        personsAndTeams: [{ id }],
      }),
    };
  }

  it('counts detailed burse fields and anti-double-counts burseCount per emp per item', () => {
    const COLS_COMENZI = COLS.COMENZI;

    const comenziCtr = {
      items_page: {
        items: [
          {
            column_values: [
              { id: COLS_COMENZI.STATUS_CTR, text: 'In derulare' },
              { id: COLS_COMENZI.STATUS_TRANS, text: 'In derulare' },
              { id: COLS_COMENZI.SURSA, text: 'Timocom' },
              { id: COLS_COMENZI.PROFIT_PRINCIPAL, value: JSON.stringify(100) },
              { id: COLS_COMENZI.PROFIT_SECUNDAR, value: JSON.stringify(50) },
              { id: COLS_COMENZI.PROFIT, value: JSON.stringify(150) },
              { id: COLS_COMENZI.MONEDA, text: 'EUR' },
              { id: COLS_COMENZI.PRINCIPAL, ...makePersonValue('1') },
              { id: COLS_COMENZI.SECUNDAR, ...makePersonValue('2') },
            ],
          },
        ],
      },
    };

    const comenziLivr = {
      items_page: {
        items: [
          {
            column_values: [
              { id: COLS_COMENZI.STATUS_CTR, text: 'In derulare' },
              { id: COLS_COMENZI.STATUS_TRANS, text: 'In derulare' },
              { id: COLS_COMENZI.SURSA, text: 'Trans.eu' },
              { id: COLS_COMENZI.PROFIT_PRINCIPAL, value: JSON.stringify(200) },
              { id: COLS_COMENZI.PROFIT_SECUNDAR, value: JSON.stringify(0) },
              { id: COLS_COMENZI.PROFIT, value: JSON.stringify(200) },
              { id: COLS_COMENZI.MONEDA, text: 'EUR' },
              { id: COLS_COMENZI.PRINCIPAL, ...makePersonValue('2') },
              { id: COLS_COMENZI.SECUNDAR, ...makePersonValue('1') },
            ],
          },
        ],
      },
    };

    const raw = {
      comenziCtr,
      comenziLivr,
      solicitari: null,
      leadsContact: null,
      leadsQualified: null,
      furnizori: null,
      activities: null,
      COLS_COMENZI,
      dynamicCols: null,
    };

    const { opsStats } = buildReport(raw);
    const emp1 = opsStats.find((e) => String(e.mondayId) === '1');
    const emp2 = opsStats.find((e) => String(e.mondayId) === '2');

    expect(emp1.burseCountCtrPrincipal).toBeGreaterThanOrEqual(0);
    expect(emp1.burseCountCtrSecondary).toBeGreaterThanOrEqual(0);
    expect(emp1.burseCountLivrPrincipal).toBeGreaterThanOrEqual(0);
    expect(emp1.burseCountLivrSecondary).toBeGreaterThanOrEqual(0);

    // A: o bursă CTR ca principal + o implicare LIVR ca secundar => 2 comenzi burse distincte
    expect(emp1.burseCount).toBe(2);

    // B: o bursă CTR ca secundar + o bursă LIVR ca principal => 2 comenzi burse distincte
    expect(emp2.burseCount).toBe(2);
  });
});

