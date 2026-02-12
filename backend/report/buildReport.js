import { getEmployeesByDepartment } from './orgAdapter.js';
import { EXCHANGE_RATE, COLS } from './constants.js';

const RAFAEL_ID = '73046209';

function safeVal(v) {
  return typeof v === 'number' && !isNaN(v) ? v : 0;
}

function extractNumericValue(columnValue) {
  if (!columnValue) return 0;
  let valStr = '';
  if (columnValue.value) {
    try {
      const parsed = JSON.parse(columnValue.value);
      if (typeof parsed === 'number') return parsed;
      if (parsed.formula_result !== undefined) return Number(parsed.formula_result);
      if (parsed?.value !== undefined) {
        if (typeof parsed.value === 'number') return parsed.value;
        valStr = String(parsed.value);
      }
    } catch (_) {}
  }
  if (!valStr && columnValue.display_value) valStr = String(columnValue.display_value);
  if (!valStr && columnValue.text) valStr = String(columnValue.text);
  if (!valStr || valStr === 'null') return 0;
  if (valStr.includes('(') && valStr.includes(')')) valStr = '-' + valStr.replace(/[()]/g, '');
  let clean = valStr.replace(/\s+/g, '').replace(/[^0-9.,-]/g, '');
  if (!clean) return 0;
  if (clean.includes('.') && clean.includes(',')) {
    clean = clean.indexOf('.') < clean.indexOf(',') ? clean.replace(/\./g, '').replace(',', '.') : clean.replace(/,/g, '');
  } else if (clean.includes(',')) clean = clean.replace(',', '.');
  const n = parseFloat(clean);
  return isNaN(n) ? 0 : n;
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
    solicitariCount: 0,
    contactat: 0,
    calificat: 0,
    emailsCount: 0,
    callsCount: 0,
    sumClientTerms: 0,
    countClientTerms: 0,
    sumSupplierTerms: 0,
    countSupplierTerms: 0,
    overdueInvoicesCount: 0,
    supplierTermsUnder30: 0,
    supplierTermsOver30: 0,
    sumProfitability: 0,
    countProfitability: 0,
    websiteCountSec: 0,
    websiteProfitSec: 0,
    // Curse burse detaliate pe rol și tip comandă.
    // Notă business: bursele relevante pentru Operațional includ:
    // - CTR: principal + secundar
    // - LIVR: principal + secundar
    // câmpul agregat burseCount = totalul tuturor acestor curse (CTR + LIVR, principal + secundar).
    burseCountCtrPrincipal: 0,
    burseCountCtrSecondary: 0,
    burseCountLivrPrincipal: 0,
    burseCountLivrSecondary: 0,
    burseCount: 0,
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
  const { comenziCtr, comenziLivr, solicitari, leadsContact, leadsQualified, furnizori, activities, COLS_COMENZI, dynamicCols } = raw;
  const depts = getEmployeesByDepartment();
  const opsStatsLocal = generateStats(depts.operational);
  const salesStatsLocal = generateStats(depts.sales);
  const mgmtStatsLocal = generateStats(depts.management);

  const companyStatsLocal = {
    ctr: { count: 0, profit: 0, websiteCount: 0, websiteProfit: 0, burseCount: 0, breakdowns: {} },
    livr: { count: 0, profit: 0, websiteCount: 0, websiteProfit: 0, burseCount: 0, breakdowns: {} },
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
      const clientTerm = extractNumericValue(getCol(COLS_COMENZI.TERMEN_PLATA_CLIENT));
      const supplierTerm = extractNumericValue(getCol(COLS_COMENZI.TERMEN_PLATA_FURNIZOR));
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
      const hadSecondary = secondaryIds.length > 0;
      if (secondaryIds.length === 0 && valSecundar !== 0) secondaryIds.push(RAFAEL_ID);

      const totalProfitRaw = extractNumericValue(getCol(COLS_COMENZI.PROFIT));
      const totalItemProfitCompany = toEur(totalProfitRaw, isRon);
      companyStatsLocal.ctr.count++;
      companyStatsLocal.ctr.profit += totalItemProfitCompany;
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
      // Anti double-count: pentru fiecare item burse, un angajat este numărat o singură dată în burseCount
      // chiar dacă apare accidental atât ca PRINCIPAL cât și ca SECUNDAR.
      const countedBurseByEmpId = new Set();
      applyToAllStats((statsList) => {
        statsList.forEach((emp) => {
          const isPrincipal = principalIds.includes(String(emp.mondayId));
          const isSecondary = secondaryIds.includes(String(emp.mondayId));
          const isInAnyRole = isPrincipal || isSecondary;
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
            if (clientTerm > 0) {
              emp.sumClientTerms += clientTerm;
              emp.countClientTerms++;
            }
            if (isOverdue) emp.overdueInvoicesCount++;
            if (isBurse) {
              emp.burseCountCtrPrincipal++;
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
          if (isBurse && isInAnyRole && !countedBurseByEmpId.has(emp.id)) {
            emp.burseCount++;
            countedBurseByEmpId.add(emp.id);
          }
          if (isSecondary || (isPrincipal && !hadSecondary)) {
            if (supplierTerm > 0) {
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
      const currencyVal = (getCol(COLS_COMENZI.MONEDA)?.text || '').toUpperCase();
      const isRon = currencyVal.includes('RON') || currencyVal.includes('LEI');
      const sursaVal = (getCol(COLS_COMENZI.SURSA)?.text || '').trim().toLowerCase();
      const isWebsite = sursaVal === 'website' || sursaVal === 'telefon / whatsapp fix' || sursaVal === 'fix';
      const isBurse = /timocom|trans\.eu|cargopedia/.test(sursaVal);
      let principalIds = getPersonIds(getCol(COLS_COMENZI.PRINCIPAL));
      let secondaryIds = getPersonIds(getCol(COLS_COMENZI.SECUNDAR));
      if (secondaryIds.length === 0 && valSecundar !== 0) secondaryIds.push(RAFAEL_ID);

      const totalProfitRaw = extractNumericValue(getCol(COLS_COMENZI.PROFIT));
      const totalItemProfitCompany = toEur(totalProfitRaw, isRon);
      companyStatsLocal.livr.count++;
      companyStatsLocal.livr.profit += totalItemProfitCompany;
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
      // Anti double-count: pentru fiecare item burse, un angajat este numărat o singură dată în burseCount
      // chiar dacă apare accidental atât ca PRINCIPAL cât și ca SECUNDAR.
      const countedBurseByEmpId = new Set();
      applyToAllStats((statsList) => {
        statsList.forEach((emp) => {
          const isPrincipal = principalIds.includes(String(emp.mondayId));
          const isSecondary = secondaryIds.includes(String(emp.mondayId));
          const isInAnyRole = isPrincipal || isSecondary;
          if (isPrincipal) {
            emp.livr_principalCount++;
            emp.livr_principalProfitEur += safeVal(profitToAddP);
            if (isBurse) {
              emp.burseCountLivrPrincipal++;
            }
          }
          if (isSecondary) {
            emp.livr_secondaryCount++;
            emp.livr_secondaryProfitEur += safeVal(profitToAddS);
            if (isBurse) {
              emp.burseCountLivrSecondary++;
            }
          }
          if (isBurse && isInAnyRole && !countedBurseByEmpId.has(emp.id)) {
            emp.burseCount++;
            countedBurseByEmpId.add(emp.id);
          }
        });
      });
    }
  }

  if (solicitari?.items_page?.items) {
    for (const item of solicitari.items_page.items) {
      const getCol = (id) => item.column_values?.find((c) => c.id === id);
      const sursaVal = (getCol(COLS.SOLICITARI.SURSA)?.text || '').trim().toLowerCase();
      if (sursaVal !== 'website' && sursaVal !== 'telefon / whatsapp fix') continue;
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

  return {
    opsStats: opsStatsLocal,
    salesStats: salesStatsLocal,
    mgmtStats: mgmtStatsLocal,
    companyStats: companyStatsLocal,
  };
}
