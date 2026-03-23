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

function makeDurationValue(seconds) {
  return {
    value: JSON.stringify({
      duration: seconds,
    }),
  };
}

function makeStatusValue(statusText) {
  return {
    text: statusText,
    value: JSON.stringify({ label: { text: statusText } }),
  };
}

describe('buildReport deals average times by status', () => {
  it('uses only expected statuses for offer/close average times', () => {
    const id1 = '74695692';
    const dealsData = {
      items_page: {
        items: [
          // Offer included
          {
            column_values: [
              { id: 'deal_owner', ...makePersonValue(id1) },
              { id: 'deal_stage', ...makeStatusValue('Ofertat 50%') },
              { id: 'duration_mkq0z4bg', ...makeDurationValue(60 * 60) }, // 60 min
              { id: 'duration_mkyhd77n', ...makeDurationValue(10 * 60) }, // should be ignored for close
            ],
          },
          {
            column_values: [
              { id: 'deal_owner', ...makePersonValue(id1) },
              { id: 'deal_stage', ...makeStatusValue('Amanat 50%') },
              { id: 'duration_mkq0z4bg', ...makeDurationValue(30 * 60) }, // 30 min
              { id: 'duration_mkyhd77n', ...makeDurationValue(20 * 60) }, // should be ignored for close
            ],
          },
          // Close included
          {
            column_values: [
              { id: 'deal_owner', ...makePersonValue(id1) },
              { id: 'deal_stage', ...makeStatusValue('Castigat  100%') },
              { id: 'duration_mkq0z4bg', ...makeDurationValue(40 * 60) }, // should be ignored for offer
              { id: 'duration_mkyhd77n', ...makeDurationValue(90 * 60) }, // 90 min
            ],
          },
          {
            column_values: [
              { id: 'deal_owner', ...makePersonValue(id1) },
              { id: 'deal_stage', ...makeStatusValue('Pierdut - Self resolved') },
              { id: 'duration_mkq0z4bg', ...makeDurationValue(50 * 60) }, // should be ignored for offer
              { id: 'duration_mkyhd77n', ...makeDurationValue(30 * 60) }, // 30 min
            ],
          },
          // Ignored entirely for both metrics
          {
            column_values: [
              { id: 'deal_owner', ...makePersonValue(id1) },
              { id: 'deal_stage', ...makeStatusValue('In lucru 30% + Adauga client') },
              { id: 'duration_mkq0z4bg', ...makeDurationValue(999 * 60) },
              { id: 'duration_mkyhd77n', ...makeDurationValue(999 * 60) },
            ],
          },
        ],
      },
    };

    const raw = {
      comenziCtr: null,
      comenziLivr: null,
      solicitari: null,
      leadsContact: null,
      leadsQualified: null,
      furnizori: null,
      activities: null,
      COLS_COMENZI: COLS.COMENZI,
      dynamicCols: null,
      dealsData,
    };

    const { opsStats } = buildReport(raw);
    const emp = opsStats.find((e) => String(e.mondayId) === id1);
    expect(emp).toBeDefined();

    // Offer: (60 + 30) / 2 = 45
    expect(emp.sumOfferTime).toBe(90);
    expect(emp.countOfferTime).toBe(2);
    expect(emp.avgOfferTime).toBe(45);

    // Close: (90 + 30) / 2 = 60
    expect(emp.sumCloseTime).toBe(120);
    expect(emp.countCloseTime).toBe(2);
    expect(emp.avgCloseTime).toBe(60);
  });
});
