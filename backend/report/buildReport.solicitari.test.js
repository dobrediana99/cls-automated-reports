import { describe, it, expect } from 'vitest';
import { buildReport } from './buildReport.js';
import { COLS } from './constants.js';

function makePersonValue(id) {
  return {
    value: JSON.stringify({
      personsAndTeams: [{ id }],
    }),
  };
}

describe('buildReport solicitari web sources', () => {
  it('counts Newsletter as valid solicitare web source', () => {
    const id1 = '74695692';

    const solicitari = {
      items_page: {
        items: [
          {
            column_values: [
              { id: COLS.SOLICITARI.SURSA, text: 'Newsletter' },
              { id: COLS.SOLICITARI.PRINCIPAL, ...makePersonValue(id1) },
            ],
          },
          {
            column_values: [
              { id: COLS.SOLICITARI.SURSA, text: 'Website' },
              { id: COLS.SOLICITARI.PRINCIPAL, ...makePersonValue(id1) },
            ],
          },
          {
            column_values: [
              { id: COLS.SOLICITARI.SURSA, text: 'Recomandare' },
              { id: COLS.SOLICITARI.PRINCIPAL, ...makePersonValue(id1) },
            ],
          },
        ],
      },
    };

    const raw = {
      comenziCtr: null,
      comenziLivr: null,
      solicitari,
      leadsContact: null,
      leadsQualified: null,
      furnizori: null,
      activities: null,
      COLS_COMENZI: COLS.COMENZI,
      dynamicCols: null,
    };

    const { opsStats } = buildReport(raw);
    const emp1 = opsStats.find((e) => String(e.mondayId) === id1);
    expect(emp1).toBeDefined();
    expect(emp1.solicitariCount).toBe(2);
  });
});
