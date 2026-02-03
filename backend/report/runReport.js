import { fetchReportData } from './fetchData.js';
import { buildReport } from './buildReport.js';

function safeVal(v) {
  return typeof v === 'number' && !isNaN(v) ? v : 0;
}

function computeTotals(rows) {
  const init = {
    contactat: 0,
    calificat: 0,
    emailsCount: 0,
    callsCount: 0,
    suppliersAdded: 0,
    ctr_principalCount: 0,
    ctr_principalProfitEur: 0,
    ctr_secondaryCount: 0,
    ctr_secondaryProfitEur: 0,
    livr_principalCount: 0,
    livr_principalProfitEur: 0,
    livr_secondaryCount: 0,
    livr_secondaryProfitEur: 0,
    websiteCount: 0,
    websiteProfit: 0,
    websiteCountSec: 0,
    websiteProfitSec: 0,
    burseCount: 0,
    solicitariCount: 0,
    sumClientTerms: 0,
    countClientTerms: 0,
    sumSupplierTerms: 0,
    countSupplierTerms: 0,
    overdueInvoicesCount: 0,
    supplierTermsUnder30: 0,
    supplierTermsOver30: 0,
    sumProfitability: 0,
    countProfitability: 0,
    targetTotal: 0,
  };
  return (rows || []).reduce((acc, row) => {
    acc.contactat += safeVal(row.contactat);
    acc.calificat += safeVal(row.calificat);
    acc.emailsCount += safeVal(row.emailsCount);
    acc.callsCount += safeVal(row.callsCount);
    acc.suppliersAdded += safeVal(row.suppliersAdded);
    acc.ctr_principalCount += safeVal(row.ctr_principalCount);
    acc.ctr_principalProfitEur += safeVal(row.ctr_principalProfitEur);
    acc.ctr_secondaryCount += safeVal(row.ctr_secondaryCount);
    acc.ctr_secondaryProfitEur += safeVal(row.ctr_secondaryProfitEur);
    acc.livr_principalCount += safeVal(row.livr_principalCount);
    acc.livr_principalProfitEur += safeVal(row.livr_principalProfitEur);
    acc.livr_secondaryCount += safeVal(row.livr_secondaryCount);
    acc.livr_secondaryProfitEur += safeVal(row.livr_secondaryProfitEur);
    acc.websiteCount += safeVal(row.websiteCount);
    acc.websiteProfit += safeVal(row.websiteProfit);
    acc.websiteCountSec += safeVal(row.websiteCountSec);
    acc.websiteProfitSec += safeVal(row.websiteProfitSec);
    acc.burseCount += safeVal(row.burseCount);
    acc.solicitariCount += safeVal(row.solicitariCount);
    acc.sumClientTerms += safeVal(row.sumClientTerms);
    acc.countClientTerms += safeVal(row.countClientTerms);
    acc.sumSupplierTerms += safeVal(row.sumSupplierTerms);
    acc.countSupplierTerms += safeVal(row.countSupplierTerms);
    acc.overdueInvoicesCount += safeVal(row.overdueInvoicesCount);
    acc.supplierTermsUnder30 += safeVal(row.supplierTermsUnder30);
    acc.supplierTermsOver30 += safeVal(row.supplierTermsOver30);
    acc.sumProfitability += safeVal(row.sumProfitability);
    acc.countProfitability += safeVal(row.countProfitability);
    acc.targetTotal += safeVal(row.target);
    return acc;
  }, { ...init });
}

/**
 * Fetch Monday data for the period, build report, return meta + reportSummary (totals per department + company).
 * periodStart/periodEnd: ISO strings (e.g. from dateRanges).
 * @param {object} options - { periodStart, periodEnd, label, timezone, jobType, runAt }
 * @returns {Promise<{ meta: object, reportSummary: object }>}
 */
export async function runReport(options) {
  const { periodStart, periodEnd, label, timezone, jobType, runAt } = options;
  const dateFrom = periodStart.slice(0, 10);
  const dateTo = periodEnd.slice(0, 10);

  const raw = await fetchReportData(dateFrom, dateTo);
  const { opsStats, salesStats, mgmtStats, companyStats } = buildReport(raw);

  const reportSummary = {
    departments: {
      operational: computeTotals(opsStats),
      sales: computeTotals(salesStats),
      management: computeTotals(mgmtStats),
    },
    company: companyStats,
  };

  const meta = {
    jobType: jobType ?? 'report',
    periodStart,
    periodEnd,
    label: label ?? `${dateFrom}..${dateTo}`,
    timezone: timezone ?? 'Europe/Bucharest',
    runAt: runAt ?? new Date().toISOString(),
  };

  const report = { opsStats, salesStats, mgmtStats, companyStats };
  return { meta, reportSummary, report };
}
