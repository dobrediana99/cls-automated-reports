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

  it('ignores boolean formula_result for PROFIT_PRINCIPAL (true must not become 1)', () => {
    const COLS_COMENZI = COLS.COMENZI;
    const id1 = '74695692';

    const comenziCtr = {
      items_page: {
        items: [
          {
            column_values: [
              { id: COLS_COMENZI.STATUS_CTR, text: 'In derulare' },
              { id: COLS_COMENZI.STATUS_TRANS, text: 'In derulare' },
              { id: COLS_COMENZI.SURSA, text: 'Website' },
              { id: COLS_COMENZI.PROFIT_PRINCIPAL, value: JSON.stringify({ formula_result: true }) },
              { id: COLS_COMENZI.PROFIT_SECUNDAR, value: JSON.stringify(0) },
              { id: COLS_COMENZI.PROFIT, value: JSON.stringify(0) },
              { id: COLS_COMENZI.MONEDA, text: 'EUR' },
              { id: COLS_COMENZI.PRINCIPAL, ...makePersonValue(id1) },
            ],
          },
        ],
      },
    };

    const raw = {
      comenziCtr,
      comenziLivr: null,
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
    expect(emp1).toBeDefined();
    expect(emp1.ctr_principalCount).toBe(1);
    expect(emp1.ctr_principalProfitEur).toBe(0);
  });

  it('includes explicit 0 values in average term sums/counts', () => {
    const COLS_COMENZI = COLS.COMENZI;
    const id1 = '74695692';

    const comenziCtr = {
      items_page: {
        items: [
          {
            column_values: [
              { id: COLS_COMENZI.STATUS_CTR, text: 'In derulare' },
              { id: COLS_COMENZI.STATUS_TRANS, text: 'In derulare' },
              { id: COLS_COMENZI.SURSA, text: 'Website' },
              { id: COLS_COMENZI.PROFIT_PRINCIPAL, value: JSON.stringify(100) },
              { id: COLS_COMENZI.PROFIT_SECUNDAR, value: JSON.stringify(0) },
              { id: COLS_COMENZI.PROFIT, value: JSON.stringify(100) },
              { id: COLS_COMENZI.MONEDA, text: 'EUR' },
              { id: COLS_COMENZI.PRINCIPAL, ...makePersonValue(id1) },
              { id: COLS_COMENZI.TERMEN_PLATA_CLIENT, value: JSON.stringify(0), text: '0' },
              { id: COLS_COMENZI.TERMEN_PLATA_FURNIZOR, value: JSON.stringify(0), text: '0' },
            ],
          },
          {
            column_values: [
              { id: COLS_COMENZI.STATUS_CTR, text: 'In derulare' },
              { id: COLS_COMENZI.STATUS_TRANS, text: 'In derulare' },
              { id: COLS_COMENZI.SURSA, text: 'Website' },
              { id: COLS_COMENZI.PROFIT_PRINCIPAL, value: JSON.stringify(100) },
              { id: COLS_COMENZI.PROFIT_SECUNDAR, value: JSON.stringify(0) },
              { id: COLS_COMENZI.PROFIT, value: JSON.stringify(100) },
              { id: COLS_COMENZI.MONEDA, text: 'EUR' },
              { id: COLS_COMENZI.PRINCIPAL, ...makePersonValue(id1) },
              { id: COLS_COMENZI.TERMEN_PLATA_CLIENT, value: JSON.stringify(30), text: '30' },
              { id: COLS_COMENZI.TERMEN_PLATA_FURNIZOR, value: JSON.stringify(45), text: '45' },
            ],
          },
        ],
      },
    };

    const raw = {
      comenziCtr,
      comenziLivr: null,
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
    expect(emp1).toBeDefined();

    expect(emp1.sumClientTerms).toBe(30);
    expect(emp1.countClientTerms).toBe(2);
    expect(emp1.sumSupplierTerms).toBe(45);
    expect(emp1.countSupplierTerms).toBe(2);
    expect(emp1.supplierTermsUnder30).toBe(1);
    expect(emp1.supplierTermsOver30).toBe(1);
  });

  it('tracks LIVR-specific metrics for individual delivery-basis remap', () => {
    const COLS_COMENZI = COLS.COMENZI;
    const id1 = '74695692';
    const id2 = '74668675';

    const comenziLivr = {
      items_page: {
        items: [
          {
            column_values: [
              { id: COLS_COMENZI.STATUS_CTR, text: 'In derulare' },
              { id: COLS_COMENZI.STATUS_TRANS, text: 'In derulare' },
              { id: COLS_COMENZI.SURSA, text: 'Website' },
              { id: COLS_COMENZI.PROFIT_PRINCIPAL, value: JSON.stringify(200) },
              { id: COLS_COMENZI.PROFIT_SECUNDAR, value: JSON.stringify(100) },
              { id: COLS_COMENZI.PROFIT, value: JSON.stringify(300) },
              { id: COLS_COMENZI.PROFITABILITATE, display_value: '25' },
              { id: COLS_COMENZI.MONEDA, text: 'EUR' },
              { id: COLS_COMENZI.PRINCIPAL, ...makePersonValue(id1) },
              { id: COLS_COMENZI.SECUNDAR, ...makePersonValue(id2) },
              { id: COLS_COMENZI.TERMEN_PLATA_CLIENT, value: JSON.stringify(0), text: '0' },
              { id: COLS_COMENZI.TERMEN_PLATA_FURNIZOR, value: JSON.stringify(45), text: '45' },
              { id: COLS_COMENZI.DATA_SCADENTA_CLIENT, text: '2025-01-01' },
              { id: COLS_COMENZI.STATUS_PLATA_CLIENT, text: 'Neplatita' },
            ],
          },
        ],
      },
    };

    const raw = {
      comenziCtr: null,
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
    const principal = opsStats.find((e) => String(e.mondayId) === id1);
    const secondary = opsStats.find((e) => String(e.mondayId) === id2);
    expect(principal).toBeDefined();
    expect(secondary).toBeDefined();

    expect(principal.livr_websiteCount).toBe(1);
    expect(principal.livr_websiteProfit).toBe(200);
    expect(secondary.livr_websiteCountSec).toBe(1);
    expect(secondary.livr_websiteProfitSec).toBe(100);

    expect(principal.livr_sumProfitability).toBe(25);
    expect(principal.livr_countProfitability).toBe(1);
    expect(principal.livr_sumClientTerms).toBe(0);
    expect(principal.livr_countClientTerms).toBe(1);
    expect(principal.livr_overdueInvoicesCount).toBe(1);

    expect(secondary.livr_sumSupplierTerms).toBe(45);
    expect(secondary.livr_countSupplierTerms).toBe(1);
    expect(secondary.livr_supplierTermsUnder30).toBe(0);
    expect(secondary.livr_supplierTermsOver30).toBe(1);

    expect(principal.livr_burseCount).toBe(0);
  });
});

