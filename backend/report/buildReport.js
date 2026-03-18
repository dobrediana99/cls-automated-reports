import { getEmployeesByDepartment } from './orgAdapter.js';
import { EXCHANGE_RATE, COLS } from './constants.js';

const RAFAEL_ID = '73046209';

function safeVal(v) {
  return typeof v === 'number' && !isNaN(v) ? v : 0;
}

function parseDurationToMinutes(text) {
  if (!text) return 0;

  const str = String(text).trim();

  // format: HH:MM:SS
  if (str.includes(':')) {
    const parts = str.split(':').map(Number);

    const hours = parts[0] || 0;
    const minutes = parts[1] || 0;
    const seconds = parts[2] || 0;

    return hours * 60 + minutes + seconds / 60;
  }

  // fallback (dacă apare alt format)
  const hours = (str.match(/(\d+)h/) || [])[1] || 0;
  const minutes = (str.match(/(\d+)m/) || [])[1] || 0;
  const seconds = (str.match(/(\d+)s/) || [])[1] || 0;

  return (
    parseInt(hours, 10) * 60 +
    parseInt(minutes, 10) +
    parseInt(seconds, 10) / 60
  );
}

function parseNumericString(raw) {
  let valStr = String(raw ?? '').trim();
  if (!valStr) return null;
  const lowered = valStr.toLowerCase();
  if (lowered === 'null' || lowered === 'true' || lowered === 'false') return null;
  if (valStr.includes('(') && valStr.includes(')')) valStr = '-' + valStr.replace(/[()]/g, '');
  let clean = valStr.replace(/\s+/g, '').replace(/[^0-9.,-]/g, '');
  if (!clean) return null;
  if (clean.includes('.') && clean.includes(',')) {
    clean = clean.indexOf('.') < clean.indexOf(',') ? clean.replace(/\./g, '').replace(',', '.') : clean.replace(/,/g, '');
  } else if (clean.includes(',')) clean = clean.replace(',', '.');
  const n = parseFloat(clean);
  return Number.isFinite(n) ? n : null;
}

function coerceNumeric(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw === 'boolean') return null;
  if (typeof raw === 'string') return parseNumericString(raw);
  return null;
}

function extractNumericValueWithPresence(columnValue) {
  if (!columnValue) return { value: 0, hasNumeric: false };
  let valStr = '';

  if (columnValue.value !== undefined && columnValue.value !== null && String(columnValue.value).trim() !== '') {
    try {
      const parsed = JSON.parse(columnValue.value);

      const directParsedNumber = coerceNumeric(parsed);
      if (directParsedNumber !== null) return { value: directParsedNumber, hasNumeric: true };

      if (parsed && typeof parsed === 'object') {
        const formulaResultNumber = coerceNumeric(parsed.formula_result);
        if (formulaResultNumber !== null) return { value: formulaResultNumber, hasNumeric: true };

        const nestedValueNumber = coerceNumeric(parsed.value);
        if (nestedValueNumber !== null) return { value: nestedValueNumber, hasNumeric: true };

        if (parsed.value !== undefined && parsed.value !== null) {
          valStr = String(parsed.value);
        }
      }
    } catch (_) {
      valStr = String(columnValue.value);
    }
  }

  if (!valStr && columnValue.display_value) valStr = String(columnValue.display_value);
  if (!valStr && columnValue.text) valStr = String(columnValue.text);
  const parsedFallback = coerceNumeric(valStr);
  if (parsedFallback !== null) return { value: parsedFallback, hasNumeric: true };
  return { value: 0, hasNumeric: false };
}

function extractNumericValue(columnValue) {
  const parsed = extractNumericValueWithPresence(columnValue);
  return parsed.hasNumeric ? parsed.value : 0;
}

function getPersonIds(columnValue) {
  if (!columnValue?.value) return [];
  try {
    const parsed = JSON.parse(columnValue.value);
    return parsed.personsAndTeams ? parsed.personsAndTeams.map((p) => String(p.id)) : [];
  } catch (_) {
    return [];
  }
}

function getDealOwnerIds(columnValue, allEmployees) {
  const idsFromValue = getPersonIds(columnValue);
  if (idsFromValue.length > 0) return idsFromValue;

  const ownerName = String(columnValue?.text || '')
    .trim()
    .toLowerCase();

  if (!ownerName) return [];

  const matchedEmployee = allEmployees.find(
    (emp) => String(emp.name || '').trim().toLowerCase() === ownerName
  );

  return matchedEmployee ? [String(matchedEmployee.mondayId)] : [];
}

function normalizeLabel(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function isWebSolicitareSource(value) {
  const normalized = normalizeLabel(value);
  return (
    normalized === 'website' ||
    normalized === 'newsletter' ||
    normalized === 'telefon / whatsapp fix' ||
    normalized === 'telefon/whatsapp fix'
  );
}

function generateStats(employees) {
  return employees.map((emp) => ({
    id: emp.id,
    name: emp.name,
    mondayId: emp.mondayUserId,
    target: safeVal(emp.target),
    suppliersAdded: 0,
    ctr_principalCount: 0,
    ctr_principalProfitEur: 0,
    ctr_secondaryCount: 0,
    ctr_secondaryProfitEur: 0,
    livr_principalCount: 0,
    livr_principalProfitEur: 0,
    livr_secondaryCount: 0,
    livr_secondaryProfitEur: 0,
    profitRonRaw: 0,
    websiteCount: 0,
    websiteProfit: 0,
    livr_websiteCount: 0,
    livr_websiteProfit: 0,
    solicitariCount: 0,
    contactat: 0,
    calificat: 0,
    emailsCount: 0,
    callsCount: 0,
    sumClientTerms: 0,
    countClientTerms: 0,
    livr_sumClientTerms: 0,
    livr_countClientTerms: 0,
    sumSupplierTerms: 0,
    countSupplierTerms: 0,
    livr_sumSupplierTerms: 0,
    livr_countSupplierTerms: 0,
    overdueInvoicesCount: 0,
    livr_overdueInvoicesCount: 0,
    supplierTermsUnder30: 0,
    supplierTermsOver30: 0,
    livr_supplierTermsUnder30: 0,
    livr_supplierTermsOver30: 0,
    sumProfitability: 0,
    countProfitability: 0,
    livr_sumProfitability: 0,
    livr_countProfitability: 0,
    websiteCountSec: 0,
    websiteProfitSec: 0,
    livr_websiteCountSec: 0,
    livr_websiteProfitSec: 0,
    // Curse burse detaliate pe rol și tip comandă.
    // Notă business: bursele relevante pentru Operațional includ:
    // - CTR: principal + secundar
    // - LIVR: principal + secundar
    // câmpul agregat burseCount = totalul tuturor acestor curse (CTR + LIVR, principal + secundar).
    burseCountCtrPrincipal: 0,
    burseCountCtrSecondary: 0,
    burseCountLivrPrincipal: 0,
    burseCountLivrSecondary: 0,
    livr_burseCount: 0,
    burseCount: 0,
    avgOfferTime: 0,
    avgCloseTime: 0,
    sumOfferTime: 0,
    countOfferTime: 0,
    sumCloseTime: 0,
    countCloseTime: 0,
  }));
}

function aggregateBreakdown(targetStats, columnKey, rawVal) {
  if (!rawVal) return;
  const val = String(rawVal).trim();
  if (val === '' || val.toLowerCase() === 'null') return;
  if (!targetStats.breakdowns[columnKey]) targetStats.breakdowns[columnKey] = {};
  if (!targetStats.breakdowns[columnKey][val]) targetStats.breakdowns[columnKey][val] = 0;
  targetStats.breakdowns[columnKey][val]++;
}

function toEur(val, isRon) {
  return isRon ? safeVal(val) / EXCHANGE_RATE : safeVal(val);
}

/**
 * Pure: process raw Monday fetch result into per-department stats and company stats.
 * Same business rules as frontend processAllData.
 * @param {object} raw - Result of fetchReportData (comenziCtr, comenziLivr, solicitari, furnizori, leadsContact, leadsQualified, activities, COLS_COMENZI, dynamicCols)
 * @returns {{ opsStats: array, salesStats: array, mgmtStats: array, companyStats: object }}
 */
export function buildReport(raw) {
  const { comenziCtr, comenziLivr, solicitari, leadsContact, leadsQualified, furnizori, activities, COLS_COMENZI, dynamicCols, dealsData } = raw;
  const depts = getEmployeesByDepartment();
  const opsStatsLocal = generateStats(depts.operational);
  const salesStatsLocal = generateStats(depts.sales);
  const mgmtStatsLocal = generateStats(depts.management);

  const allEmployees = [
  ...opsStatsLocal,
  ...salesStatsLocal,
  ...mgmtStatsLocal,
];

  const companyStatsLocal = {
    ctr: { count: 0, profit: 0, turnover: 0, websiteCount: 0, websiteProfit: 0, burseCount: 0, breakdowns: {} },
    livr: { count: 0, profit: 0, turnover: 0, websiteCount: 0, websiteProfit: 0, burseCount: 0, breakdowns: {} },
  };

  const applyToAllStats = (callback) => {
    callback(opsStatsLocal);
    callback(salesStatsLocal);
    callback(mgmtStatsLocal);
  };

  if (comenziCtr?.items_page?.items) {
    for (const item of comenziCtr.items_page.items) {
      const getCol = (id) => item.column_values?.find((c) => c.id === id);
      const statusCtr = (getCol(COLS_COMENZI.STATUS_CTR)?.text || '').toLowerCase();
      const statusTrans = (getCol(COLS_COMENZI.STATUS_TRANS)?.text || '').toLowerCase();
      if (statusCtr.includes('anulat') || statusTrans.includes('anulat')) continue;

      const valPrincipal = extractNumericValue(getCol(COLS_COMENZI.PROFIT_PRINCIPAL));
      const valSecundar = extractNumericValue(getCol(COLS_COMENZI.PROFIT_SECUNDAR));
      const colProfitability = getCol(COLS_COMENZI.PROFITABILITATE);
      let profitabilityVal = 0;
      let hasProfitability = false;
      if (colProfitability?.display_value && colProfitability.display_value !== 'null') {
        profitabilityVal = parseFloat(colProfitability.display_value);
        if (!isNaN(profitabilityVal)) hasProfitability = true;
      }
      const currencyVal = (getCol(COLS_COMENZI.MONEDA)?.text || '').toUpperCase();
      const isRon = currencyVal.includes('RON') || currencyVal.includes('LEI');
      const sursaVal = (getCol(COLS_COMENZI.SURSA)?.text || '').trim().toLowerCase();
      const isWebsite = sursaVal === 'website' || sursaVal === 'telefon / whatsapp fix' || sursaVal === 'fix';
      const isBurse = /timocom|trans\.eu|cargopedia/.test(sursaVal);
      const clientTermMeta = extractNumericValueWithPresence(getCol(COLS_COMENZI.TERMEN_PLATA_CLIENT));
      const supplierTermMeta = extractNumericValueWithPresence(getCol(COLS_COMENZI.TERMEN_PLATA_FURNIZOR));
      const clientTerm = clientTermMeta.value;
      const supplierTerm = supplierTermMeta.value;
      let isOverdue = false;
      const scadentaClientText = getCol(COLS_COMENZI.DATA_SCADENTA_CLIENT)?.text;
      const statusPlataClient = (getCol(COLS_COMENZI.STATUS_PLATA_CLIENT)?.text || '').toLowerCase();
      if (scadentaClientText && !statusPlataClient.includes('incasata') && !statusPlataClient.includes('încasată')) {
        const scadentaDate = new Date(scadentaClientText);
        if (!isNaN(scadentaDate.getTime())) {
          const today = new Date();
          const diffDays = Math.ceil(Math.abs(today - scadentaDate) / (1000 * 60 * 60 * 24));
          if (scadentaDate < today && diffDays > 15) isOverdue = true;
        }
      }
      let principalIds = getPersonIds(getCol(COLS_COMENZI.PRINCIPAL));
      let secondaryIds = getPersonIds(getCol(COLS_COMENZI.SECUNDAR));
      if (secondaryIds.length === 0 && valSecundar !== 0) secondaryIds.push(RAFAEL_ID);

      const totalProfitRaw = extractNumericValue(getCol(COLS_COMENZI.PROFIT));
      const totalItemProfitCompany = toEur(totalProfitRaw, isRon);
      const clientPaymentRaw = extractNumericValue(getCol(COLS_COMENZI.VALOARE_CLIENT));
      const clientPaymentEur = toEur(clientPaymentRaw, isRon);
      companyStatsLocal.ctr.count++;
      companyStatsLocal.ctr.profit += totalItemProfitCompany;
      companyStatsLocal.ctr.turnover += clientPaymentEur;
      if (isWebsite) {
        companyStatsLocal.ctr.websiteCount++;
        companyStatsLocal.ctr.websiteProfit += totalItemProfitCompany;
      }
      if (isBurse) companyStatsLocal.ctr.burseCount++;
      for (const [key, colId] of Object.entries(COLS_COMENZI)) {
        if (['STATUS_CTR', 'DEP', 'STATUS_PLATA_CLIENT', 'MONEDA', 'SURSA', 'IMPLICARE', 'CLIENT_PE', 'FURNIZ_PE', 'CLIENT_FURNIZOR_PE', 'MOD_TRANSPORT', 'TIP_MARFA', 'OCUPARE'].includes(key)) {
          aggregateBreakdown(companyStatsLocal.ctr, key, getCol(colId)?.text);
        }
      }

      const profitToAddP = isRon ? valPrincipal / EXCHANGE_RATE : valPrincipal;
      const profitToAddS = isRon ? valSecundar / EXCHANGE_RATE : valSecundar;
      // Reference Report_monday: emp.burseCount increases only on CTR when principal and isBurse (no LIVR, no dedup).
      applyToAllStats((statsList) => {
        statsList.forEach((emp) => {
          const isPrincipal = principalIds.includes(String(emp.mondayId));
          const isSecondary = secondaryIds.includes(String(emp.mondayId));
          if (isPrincipal) {
            emp.ctr_principalCount++;
            emp.ctr_principalProfitEur += safeVal(profitToAddP);
            if (isRon) emp.profitRonRaw += safeVal(valPrincipal);
            if (isWebsite) {
              emp.websiteCount++;
              emp.websiteProfit += safeVal(profitToAddP);
            }
            if (hasProfitability) {
              emp.sumProfitability += safeVal(profitabilityVal);
              emp.countProfitability++;
            }
            if (clientTermMeta.hasNumeric && clientTerm >= 0) {
              emp.sumClientTerms += clientTerm;
              emp.countClientTerms++;
            }
            if (isOverdue) emp.overdueInvoicesCount++;
            if (isBurse) {
              emp.burseCountCtrPrincipal++;
              emp.burseCount++;
            }
          }
          if (isSecondary) {
            emp.ctr_secondaryCount++;
            emp.ctr_secondaryProfitEur += safeVal(profitToAddS);
            if (isRon) emp.profitRonRaw += safeVal(valSecundar);
            if (isWebsite) {
              emp.websiteCountSec++;
              emp.websiteProfitSec += safeVal(profitToAddS);
            }
            if (isBurse) {
              emp.burseCountCtrSecondary++;
            }
          }
          if (isSecondary || isPrincipal) {
            if (supplierTermMeta.hasNumeric && supplierTerm >= 0) {
              emp.sumSupplierTerms += supplierTerm;
              emp.countSupplierTerms++;
              if (supplierTerm < 30) emp.supplierTermsUnder30++;
              else emp.supplierTermsOver30++;
            }
          }
        });
      });
    }
  }

  if (comenziLivr?.items_page?.items) {
    for (const item of comenziLivr.items_page.items) {
      const getCol = (id) => item.column_values?.find((c) => c.id === id);
      const statusCtr = (getCol(COLS_COMENZI.STATUS_CTR)?.text || '').toLowerCase();
      const statusTrans = (getCol(COLS_COMENZI.STATUS_TRANS)?.text || '').toLowerCase();
      if (statusCtr.includes('anulat') || statusTrans.includes('anulat')) continue;

      const valPrincipal = extractNumericValue(getCol(COLS_COMENZI.PROFIT_PRINCIPAL));
      const valSecundar = extractNumericValue(getCol(COLS_COMENZI.PROFIT_SECUNDAR));
      const colProfitability = getCol(COLS_COMENZI.PROFITABILITATE);
      let profitabilityVal = 0;
      let hasProfitability = false;
      if (colProfitability?.display_value && colProfitability.display_value !== 'null') {
        profitabilityVal = parseFloat(colProfitability.display_value);
        if (!isNaN(profitabilityVal)) hasProfitability = true;
      }
      const currencyVal = (getCol(COLS_COMENZI.MONEDA)?.text || '').toUpperCase();
      const isRon = currencyVal.includes('RON') || currencyVal.includes('LEI');
      const sursaVal = (getCol(COLS_COMENZI.SURSA)?.text || '').trim().toLowerCase();
      const isWebsite = sursaVal === 'website' || sursaVal === 'telefon / whatsapp fix' || sursaVal === 'fix';
      const isBurse = /timocom|trans\.eu|cargopedia/.test(sursaVal);
      const clientTermMeta = extractNumericValueWithPresence(getCol(COLS_COMENZI.TERMEN_PLATA_CLIENT));
      const supplierTermMeta = extractNumericValueWithPresence(getCol(COLS_COMENZI.TERMEN_PLATA_FURNIZOR));
      const clientTerm = clientTermMeta.value;
      const supplierTerm = supplierTermMeta.value;
      let isOverdue = false;
      const scadentaClientText = getCol(COLS_COMENZI.DATA_SCADENTA_CLIENT)?.text;
      const statusPlataClient = (getCol(COLS_COMENZI.STATUS_PLATA_CLIENT)?.text || '').toLowerCase();
      if (scadentaClientText && !statusPlataClient.includes('incasata') && !statusPlataClient.includes('încasată')) {
        const scadentaDate = new Date(scadentaClientText);
        if (!isNaN(scadentaDate.getTime())) {
          const today = new Date();
          const diffDays = Math.ceil(Math.abs(today - scadentaDate) / (1000 * 60 * 60 * 24));
          if (scadentaDate < today && diffDays > 15) isOverdue = true;
        }
      }
      let principalIds = getPersonIds(getCol(COLS_COMENZI.PRINCIPAL));
      let secondaryIds = getPersonIds(getCol(COLS_COMENZI.SECUNDAR));
      if (secondaryIds.length === 0 && valSecundar !== 0) secondaryIds.push(RAFAEL_ID);

      const totalProfitRaw = extractNumericValue(getCol(COLS_COMENZI.PROFIT));
      const totalItemProfitCompany = toEur(totalProfitRaw, isRon);
      const clientPaymentRaw = extractNumericValue(getCol(COLS_COMENZI.VALOARE_CLIENT));
      const clientPaymentEur = toEur(clientPaymentRaw, isRon);
      companyStatsLocal.livr.count++;
      companyStatsLocal.livr.profit += totalItemProfitCompany;
      companyStatsLocal.livr.turnover += clientPaymentEur;
      if (isWebsite) {
        companyStatsLocal.livr.websiteCount++;
        companyStatsLocal.livr.websiteProfit += totalItemProfitCompany;
      }
      if (isBurse) companyStatsLocal.livr.burseCount++;
      for (const [key, colId] of Object.entries(COLS_COMENZI)) {
        if (['STATUS_CTR', 'DEP', 'STATUS_PLATA_CLIENT', 'MONEDA', 'SURSA', 'IMPLICARE', 'CLIENT_PE', 'FURNIZ_PE', 'CLIENT_FURNIZOR_PE', 'MOD_TRANSPORT', 'TIP_MARFA', 'OCUPARE'].includes(key)) {
          aggregateBreakdown(companyStatsLocal.livr, key, getCol(colId)?.text);
        }
      }

      const profitToAddP = isRon ? valPrincipal / EXCHANGE_RATE : valPrincipal;
      const profitToAddS = isRon ? valSecundar / EXCHANGE_RATE : valSecundar;
      // Reference Report_monday: emp.burseCount is NOT incremented in LIVR (only CTR principal).
      applyToAllStats((statsList) => {
        statsList.forEach((emp) => {
          const isPrincipal = principalIds.includes(String(emp.mondayId));
          const isSecondary = secondaryIds.includes(String(emp.mondayId));
          if (isPrincipal) {
            emp.livr_principalCount++;
            emp.livr_principalProfitEur += safeVal(profitToAddP);
            if (isWebsite) {
              emp.livr_websiteCount++;
              emp.livr_websiteProfit += safeVal(profitToAddP);
            }
            if (hasProfitability) {
              emp.livr_sumProfitability += safeVal(profitabilityVal);
              emp.livr_countProfitability++;
            }
            if (clientTermMeta.hasNumeric && clientTerm >= 0) {
              emp.livr_sumClientTerms += clientTerm;
              emp.livr_countClientTerms++;
            }
            if (isOverdue) emp.livr_overdueInvoicesCount++;
            if (isBurse) {
              emp.burseCountLivrPrincipal++;
              emp.livr_burseCount++;
            }
          }
          if (isSecondary) {
            emp.livr_secondaryCount++;
            emp.livr_secondaryProfitEur += safeVal(profitToAddS);
            if (isWebsite) {
              emp.livr_websiteCountSec++;
              emp.livr_websiteProfitSec += safeVal(profitToAddS);
            }
            if (isBurse) {
              emp.burseCountLivrSecondary++;
              emp.livr_burseCount++;
            }
          }
          if (isSecondary || isPrincipal) {
            if (supplierTermMeta.hasNumeric && supplierTerm >= 0) {
              emp.livr_sumSupplierTerms += supplierTerm;
              emp.livr_countSupplierTerms++;
              if (supplierTerm < 30) emp.livr_supplierTermsUnder30++;
              else emp.livr_supplierTermsOver30++;
            }
          }
        });
      });
    }
  }

  if (solicitari?.items_page?.items) {
    for (const item of solicitari.items_page.items) {
      const getCol = (id) => item.column_values?.find((c) => c.id === id);
      const sursaVal = getCol(COLS.SOLICITARI.SURSA)?.text || '';
      if (!isWebSolicitareSource(sursaVal)) continue;
      const principalIds = getPersonIds(getCol(COLS.SOLICITARI.PRINCIPAL));
      applyToAllStats((statsList) => {
        statsList.forEach((emp) => {
          if (principalIds.includes(String(emp.mondayId))) emp.solicitariCount++;
        });
      });
    }
  }

  if (furnizori?.items_page?.items && dynamicCols) {
    const { furnPersonCol } = dynamicCols;
    for (const item of furnizori.items_page.items) {
      const personIds = getPersonIds(item.column_values?.find((c) => c.id === furnPersonCol));
      applyToAllStats((statsList) => {
        statsList.forEach((emp) => {
          if (personIds.includes(String(emp.mondayId))) emp.suppliersAdded++;
        });
      });
    }
  }

  if (activities?.length) {
    const COLS_LEADS = { OWNER: 'lead_owner' };
    for (const act of activities) {
      const userId = act.user_id ?? act.creator_id ?? act.user?.id;
      if (!userId) continue;
      const type = (act.type || '').toLowerCase();
      applyToAllStats((statsList) => {
        const emp = statsList.find((e) => String(e.mondayId) === String(userId));
        if (emp) {
          if (type.includes('email')) emp.emailsCount++;
          if (type === 'activity' || type.includes('call') || type.includes('phone') || type.includes('meeting')) emp.callsCount++;
        }
      });
    }
  }

  const processLeads = (boardData, type) => {
    if (!boardData?.items_page?.items) return;
    for (const item of boardData.items_page.items) {
      const ownerVal = item.column_values?.find((c) => c.id === COLS.LEADS.OWNER);
      const ownerIds = getPersonIds(ownerVal);
      applyToAllStats((statsList) => {
        statsList.forEach((emp) => {
          if (ownerIds.includes(String(emp.mondayId))) {
            if (type === 'contact') emp.contactat++;
            if (type === 'qualified') emp.calificat++;
          }
        });
      });
    }
  };
  processLeads(leadsContact, 'contact');
  processLeads(leadsQualified, 'qualified');

  // 🔥 DEALS (timp ofertare + inchidere)
if (dealsData?.boards?.[0]?.items_page?.items) {
  for (const item of dealsData.boards[0].items_page.items) {
    const getCol = (id) => item.column_values?.find((c) => c.id === id);

    const ownerIds = getDealOwnerIds(getCol('deal_owner'), allEmployees);

    const offerTime = parseDurationToMinutes(getCol('duration_mkq0z4bg')?.text);
    const closeTime = parseDurationToMinutes(getCol('duration_mkyhd77n')?.text);

    applyToAllStats((statsList) => {
      statsList.forEach((emp) => {
        if (ownerIds.includes(String(emp.mondayId))) {

          if (offerTime > 0) {
            emp.sumOfferTime += offerTime;
            emp.countOfferTime++;
          }

          if (closeTime > 0) {
            emp.sumCloseTime += closeTime;
            emp.countCloseTime++;
          }

        }
      });
    });
  }
}

  const finalizeStats = (statsList) => {
  statsList.forEach((emp) => {
    emp.avgOfferTime = emp.countOfferTime
      ? emp.sumOfferTime / emp.countOfferTime
      : 0;

    emp.avgCloseTime = emp.countCloseTime
      ? emp.sumCloseTime / emp.countCloseTime
      : 0;
  });
};

finalizeStats(opsStatsLocal);
finalizeStats(salesStatsLocal);
finalizeStats(mgmtStatsLocal);

  return {
    opsStats: opsStatsLocal,
    salesStats: salesStatsLocal,
    mgmtStats: mgmtStatsLocal,
    companyStats: companyStatsLocal,
  };
}
