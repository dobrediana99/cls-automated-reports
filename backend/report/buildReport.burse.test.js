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

  it('emp.burseCount only from CTR when principal; LIVR does not increment burseCount (Report_monday parity)', () => {
    const COLS_COMENZI = COLS.COMENZI;
    // Use real operational mondayUserIds from backend/config/org.js (David Popescu, Roberto Coica)
    const id1 = '74695692';
    const id2 = '74668675';

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
              { id: COLS_COMENZI.PRINCIPAL, ...makePersonValue(id1) },
              { id: COLS_COMENZI.SECUNDAR, ...makePersonValue(id2) },
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
              { id: COLS_COMENZI.PRINCIPAL, ...makePersonValue(id2) },
              { id: COLS_COMENZI.SECUNDAR, ...makePersonValue(id1) },
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
    const emp1 = opsStats.find((e) => String(e.mondayId) === id1);
    const emp2 = opsStats.find((e) => String(e.mondayId) === id2);
    expect(emp1).toBeDefined();
    expect(emp2).toBeDefined();

    expect(emp1.burseCountCtrPrincipal).toBe(1);
    expect(emp1.burseCountLivrSecondary).toBe(1);
    expect(emp2.burseCountCtrSecondary).toBe(1);
    expect(emp2.burseCountLivrPrincipal).toBe(1);

    // Reference Report_monday: emp.burseCount only from CTR when principal; LIVR does not increment burseCount.
    expect(emp1.burseCount).toBe(1);
    expect(emp2.burseCount).toBe(0);
  });
});

