import React, { useState } from 'react';
import { 
  BarChart2, 
  FileBarChart, 
  AlertCircle, 
  Download,
  ArrowRight,
  ExternalLink,
  Bug,
  Activity,
  Search,
  Building
} from 'lucide-react';
import { buildWeeklyRaportWorkbook, formatRaportFilename } from '../backend/export/weeklyReportWorkbook.js';

// --- CONFIGURARE ---
// Monday API token must be configured in backend only. Frontend uses placeholder (UI may not fetch until backend proxy or env is set).
const API_KEY = import.meta.env.VITE_MONDAY_API_TOKEN ?? "";
const EXCHANGE_RATE = 5.1; // Curs actualizat 2025

// IDs Board-uri
const BOARD_ID_COMENZI = 2030349838; 
const BOARD_ID_LEADS = 1853156722; 
const BOARD_ID_CONTACTE = 1853156713;
const BOARD_ID_FURNIZORI = 1907628670; 
const BOARD_ID_SOLICITARI = 1905911565;

// Link Google Drive
const DRIVE_FOLDER_LINK = "https://drive.google.com/drive/folders/1I_sUSjcWBXZr70ns58a8VzK5d0pEM1C6?ths=true";

// COLUMN IDs
const COLS = {
    COMENZI: {
        DATA_CTR: "deal_creation_date", 
        DATA_LIVRARE: "date_mkvyt36d", 
        STATUS_CTR: "color_mksem8fg", 
        STATUS_TRANS: "color_mkse52dk", 
        PRINCIPAL: "deal_owner", 
        SECUNDAR: "multiple_person_mkt9b24z", 
        PROFIT: "formula_mkre3gx1",
        PROFIT_PRINCIPAL: "formula_mkt97xz", 
        PROFIT_SECUNDAR: "formula_mkt949b4", 
        SURSA: "color_mktcvtpz", 
        MONEDA: "color_mkse3amh", 
        TERMEN_PLATA_CLIENT: "numeric_mksek8d2", 
        TERMEN_PLATA_FURNIZOR: "numeric_mksev08g", 
        DATA_SCADENTA_CLIENT: "date_mkyhsbh4", 
        STATUS_PLATA_CLIENT: "color_mkv5g682", 
        PROFITABILITATE: "formula_mkxwd14p", 
        
        // --- COLOANE NOI (Vor fi detectate dinamic) ---
        CRT: "crt_column_id", 
        DEP: "dep_column_id", 
        IMPLICARE: "implicare_column_id", 
        CLIENT_FURNIZOR_PE: "client_furnizor_pe_column_id", 
        MOD_TRANSPORT: "mod_transport_column_id", 
        TIP_MARFA: "tip_marfa_column_id", 
        OCUPARE: "ocupare_mij_transport_column_id",

        // ADDED EXPLICITLY
        CLIENT_PE: "color_mktcqj26",
        FURNIZ_PE: "color_mkt9as8p"
    },
    FURNIZORI: {
        DATA: "date4", 
        PERSON: "person" 
    },
    SOLICITARI: {
        DATA: "deal_creation_date",
        SURSA: "color_mkpv6sj4", 
        PRINCIPAL: "deal_owner",
        SECUNDAR: "multiple_person_mktbbfzk"
    },
    LEADS: {
        DATA: "date__1", 
        STATUS: "lead_status", 
        OWNER: "lead_owner"
    },
    CONTACTE: {
        DATA: "date_mkq2380r",
        OWNER: "multiple_person_mknr9sz8" 
    }
};

const DEPARTMENTS = {
    management: {
        name: "Management",
        employees: [
            { id: 301, name: "Alin Lita", mondayUserId: 73962695, target: 3960 },
            { id: 302, name: "Bogdan Serafim", mondayUserId: 73962698, target: 3780 },
            { id: 303, name: "Rafael Onișoară", mondayUserId: 73046209, target: 0 }
        ]
    },
    sales: {
        name: "Vânzări",
        employees: [
            { id: 201, name: "Alexandru Paraschiv", mondayUserId: 74108550, target: 3300 },
            { id: 202, name: "Denisa Ionescu", mondayUserId: 74108553, target: 2442 },
            { id: 203, name: "Andrei Pauna", mondayUserId: 73046350, target: 3400 },
            { id: 204, name: "Nedelcu Alexandru", mondayUserId: 77987246, target: 3630 },
            { id: 205, name: "Christiana Sora", mondayUserId: 90770132, target: 2310 },
            { id: 208, name: "Eduard Grigore", mondayUserId: 96568397, target: 2100 },
            { id: 209, name: "George Rafte", mondayUserId: 98357010, target: 2800 }
        ]
    },
    operational: {
        name: "Operațiuni",
        employees: [
            { id: 103, name: "David Popescu", mondayUserId: 74695692, target: 3485 },
            { id: 104, name: "Roberto Coica", mondayUserId: 74668675, target: 3240 },
            { id: 105, name: "Dumitru Ionut", mondayUserId: 74668676, target: 3240 },
            { id: 106, name: "Robert Florea", mondayUserId: 74668678, target: 4590 },
            { id: 107, name: "Alexandra Ghiurca", mondayUserId: 96280239, target: 3040 },
            { id: 108, name: "David Mitrica", mondayUserId: 89227837, target: 1920 },
            { id: 109, name: "Mocanu George", mondayUserId: 96568400, target: 3040 }
        ]
    }
};

// --- HELPER FUNCTIONS ---
const formatCurrency = (val) => {
    if (typeof val !== 'number' || isNaN(val)) return "0.00";
    return val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const formatNumber = (val, decimals = 1) => {
    if (typeof val !== 'number' || isNaN(val)) return "0.0";
    return val.toFixed(decimals);
};

const formatDateISO = (date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

const safeVal = (v) => (typeof v === 'number' && !isNaN(v) ? v : 0);

const extractNumericValue = (columnValue) => {
    if (!columnValue) return 0;
    let valStr = "";
    if (columnValue.value) {
        try {
            const parsed = JSON.parse(columnValue.value);
            if (typeof parsed === 'number') return parsed;
            if (parsed.formula_result !== undefined) return Number(parsed.formula_result);
            if (parsed && parsed.value !== undefined) {
                if (typeof parsed.value === 'number') return parsed.value;
                valStr = String(parsed.value);
            }
        } catch(e) {}
    }
    if (!valStr) {
        if (columnValue.display_value) valStr = String(columnValue.display_value);
        else if (columnValue.text) valStr = columnValue.text;
    }
    if (!valStr || valStr === "null") return 0;
    
    // Cleaning
    if (valStr.includes('(') && valStr.includes(')')) {
        valStr = '-' + valStr.replace(/[()]/g, '');
    }
    let clean = valStr.replace(/\s+/g, '');
    clean = clean.replace(/[^0-9.,-]/g, '');
    
    if (!clean) return 0;

    if (clean.includes('.') && clean.includes(',')) {
        if (clean.indexOf('.') < clean.indexOf(',')) {
            clean = clean.replace(/\./g, '').replace(',', '.');
        } else {
            clean = clean.replace(/,/g, '');
        }
    } else if (clean.includes(',')) {
        clean = clean.replace(',', '.');
    }
    const n = parseFloat(clean);
    return isNaN(n) ? 0 : n;
};

const getPersonIds = (columnValue) => {
    if (!columnValue?.value) return [];
    try {
        const parsed = JSON.parse(columnValue.value);
        return parsed.personsAndTeams ? parsed.personsAndTeams.map(p => String(p.id)) : [];
    } catch (e) {
        return [];
    }
};

// --- API FUNCTIONS (MOVED OUTSIDE COMPONENT) ---

// --- COMPONENTE UI ---

const OperationalRowCells = ({ row, showSalesMetrics = false }) => {
    const totalCountCtr = safeVal(row.ctr_principalCount) + safeVal(row.ctr_secondaryCount);
    const totalProfitEurCtr = safeVal(row.ctr_principalProfitEur) + safeVal(row.ctr_secondaryProfitEur);
    const totalCountLivr = safeVal(row.livr_principalCount) + safeVal(row.livr_secondaryCount);
    const totalProfitEurLivr = safeVal(row.livr_principalProfitEur) + safeVal(row.livr_secondaryProfitEur);

    const target = safeVal(row.target);
    const bonus = totalProfitEurCtr - target;

    const qualified = safeVal(row.calificat);
    const contacted = safeVal(row.contactat);
    const rataConversieClienti = (qualified + contacted) > 0 
        ? ((qualified / (qualified + contacted)) * 100).toFixed(1) 
        : "0.0";
    
    const solicitari = safeVal(row.solicitariCount);
    const websiteCount = safeVal(row.websiteCount);
    const conversionRateWebsite = solicitari > 0 
        ? ((websiteCount / solicitari) * 100).toFixed(1) 
        : (websiteCount > 0 ? "100.0" : "0.0");

    const avgClientTerm = row.countClientTerms > 0 ? (row.sumClientTerms / row.countClientTerms) : 0;
    const avgSupplierTerm = row.countSupplierTerms > 0 ? (row.sumSupplierTerms / row.countSupplierTerms) : 0;
    const avgProfitability = row.countProfitability > 0 ? (row.sumProfitability / row.countProfitability) : 0;

    return (
        <React.Fragment>
            <td className="px-3 py-2 font-medium text-slate-900 sticky left-0 bg-white border-r shadow-sm min-w-[150px] z-10">{row.name}</td>
            
            <td className="px-2 py-2 text-center text-slate-700 font-medium border-r">{safeVal(row.suppliersAdded)}</td>
            
            <td className="px-2 py-2 text-center bg-blue-50/30 text-slate-700">{safeVal(row.ctr_principalCount)}</td>
            <td className="px-2 py-2 text-center bg-blue-50/30">{formatCurrency(safeVal(row.ctr_principalProfitEur))}</td> 
            <td className="px-2 py-2 text-center text-slate-600">{safeVal(row.ctr_secondaryCount)}</td>
            <td className="px-2 py-2 text-center text-slate-600">{formatCurrency(safeVal(row.ctr_secondaryProfitEur))}</td>
            <td className="px-2 py-2 text-center font-bold bg-blue-100/50">{safeVal(totalCountCtr)}</td>
            <td className="px-2 py-2 text-center font-bold bg-blue-100/50 border-r">{formatCurrency(totalProfitEurCtr)}</td>
            
            <td className="px-2 py-2 text-center bg-green-50/30 text-slate-700">{safeVal(row.livr_principalCount)}</td>
            <td className="px-2 py-2 text-center bg-green-50/30">{formatCurrency(safeVal(row.livr_principalProfitEur))}</td>
            <td className="px-2 py-2 text-center text-slate-600">{safeVal(row.livr_secondaryCount)}</td>
            <td className="px-2 py-2 text-center text-slate-600">{formatCurrency(safeVal(row.livr_secondaryProfitEur))}</td>
            <td className="px-2 py-2 text-center font-bold bg-green-100/50">{safeVal(totalCountLivr)}</td>
            <td className="px-2 py-2 text-center font-bold bg-green-100/50 border-r">{formatCurrency(totalProfitEurLivr)}</td>

            <td className="px-2 py-2 text-center text-slate-600 bg-blue-50/30">{formatCurrency(target)}</td>
            <td className="px-2 py-2 text-center font-bold text-green-700 bg-blue-100/50 border-r">{formatCurrency(bonus)}</td>

            <td className="px-2 py-2 text-center font-bold text-blue-800 bg-blue-50/50 border-l border-r border-blue-100">
                {formatNumber(avgProfitability)}%
            </td>
            
            <td className="px-2 py-2 text-center">{websiteCount}</td>
            <td className="px-2 py-2 text-center">{formatCurrency(safeVal(row.websiteProfit))}</td>
            <td className="px-2 py-2 text-center bg-purple-50/30">{safeVal(row.websiteCountSec)}</td>
            <td className="px-2 py-2 text-center bg-purple-50/30 border-r">{formatCurrency(safeVal(row.websiteProfitSec))}</td>
            <td className="px-2 py-2 text-center bg-orange-50/30 border-r bold text-orange-900">{safeVal(row.burseCount)}</td>

            <td className="px-2 py-2 text-center bg-purple-50 font-medium text-purple-700">{solicitari}</td>
            <td className="px-2 py-2 text-center font-bold text-slate-700">{conversionRateWebsite}%</td>
            
            <td className="px-2 py-2 text-center text-slate-700">{formatNumber(avgClientTerm)}</td>
            <td className="px-2 py-2 text-center text-slate-700">{formatNumber(avgSupplierTerm)}</td>
            <td className="px-2 py-2 text-center text-red-600 font-bold bg-red-50">{row.overdueInvoicesCount}</td>
            
            <td className="px-2 py-2 text-center text-slate-600 bg-orange-50/50">{row.supplierTermsUnder30}</td>
            <td className="px-2 py-2 text-center text-slate-600 bg-orange-50/50">{row.supplierTermsOver30}</td>

            {showSalesMetrics && (
                <React.Fragment>
                    <td className="px-2 py-2 text-center bg-yellow-50 font-medium text-slate-700">{contacted}</td>
                    <td className="px-2 py-2 text-center bg-yellow-50 font-medium text-slate-700">{qualified}</td>
                    <td className="px-2 py-2 text-center bg-yellow-50 font-bold text-blue-600 border-r">{rataConversieClienti}%</td>
                    <td className="px-2 py-2 text-center bg-indigo-50 text-indigo-700">{safeVal(row.emailsCount)}</td>
                    <td className="px-2 py-2 text-center bg-indigo-50 text-indigo-700 border-r">{safeVal(row.callsCount)}</td>
                </React.Fragment>
            )}
        </React.Fragment>
    );
};

const TableFooter = ({ data, showSalesMetrics }) => {
  const initTotals = {
    // sales
    contactat: 0,
    calificat: 0,
    emailsCount: 0,
    callsCount: 0,

    // furnizori
    suppliersAdded: 0,

    // contract
    ctr_principalCount: 0,
    ctr_principalProfitEur: 0,
    ctr_secondaryCount: 0,
    ctr_secondaryProfitEur: 0,

    // livrare
    livr_principalCount: 0,
    livr_principalProfitEur: 0,
    livr_secondaryCount: 0,
    livr_secondaryProfitEur: 0,

    // website / burse
    websiteCount: 0,
    websiteProfit: 0,
    websiteCountSec: 0,
    websiteProfitSec: 0,
    burseCount: 0,
    solicitariCount: 0,

    // termene / restante / profitability
    sumClientTerms: 0,
    countClientTerms: 0,
    sumSupplierTerms: 0,
    countSupplierTerms: 0,
    overdueInvoicesCount: 0,
    supplierTermsUnder30: 0,
    supplierTermsOver30: 0,
    sumProfitability: 0,
    countProfitability: 0,

    // ✅ target (lipsea în UI)
    targetTotal: 0,
  };

  const totals = (data || []).reduce((acc, row) => {
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

    acc.sumProfitability += safeVal(row.sumProfitability);
    acc.countProfitability += safeVal(row.countProfitability);

    acc.supplierTermsUnder30 += safeVal(row.supplierTermsUnder30);
    acc.supplierTermsOver30 += safeVal(row.supplierTermsOver30);

    // ✅ FIX: adună targetul
    acc.targetTotal += safeVal(row.target);

    return acc;
  }, { ...initTotals });

  const rowsCount = (data || []).length;
  const denom = rowsCount > 0 ? rowsCount : 1;

  const totalCtrCount = totals.ctr_principalCount + totals.ctr_secondaryCount;
  const totalCtrProfit = totals.ctr_principalProfitEur + totals.ctr_secondaryProfitEur;

  const totalLivrCount = totals.livr_principalCount + totals.livr_secondaryCount;
  const totalLivrProfit = totals.livr_principalProfitEur + totals.livr_secondaryProfitEur;

  const targetTotal = totals.targetTotal;
  const bonusTotal = totalCtrProfit - targetTotal;

  // KPI ponderate (corecte business)
  const avgProfitability =
    totals.countProfitability > 0 ? totals.sumProfitability / totals.countProfitability : 0;

  const avgClientTerm =
    totals.countClientTerms > 0 ? totals.sumClientTerms / totals.countClientTerms : 0;

  const avgSupplierTerm =
    totals.countSupplierTerms > 0 ? totals.sumSupplierTerms / totals.countSupplierTerms : 0;

  const totalLeads = totals.calificat + totals.contactat;
  const rateConvClients = totalLeads > 0 ? (totals.calificat / totalLeads) * 100 : 0;

  const rateConvWeb =
    totals.solicitariCount > 0 ? (totals.websiteCount / totals.solicitariCount) * 100 : 0;

  const avg = (v) => safeVal(v) / denom;

  return (
    <tfoot className="bg-gray-100 border-t-2 border-gray-300 font-bold text-gray-800">
      {/* ===================== TOTAL ===================== */}
      <tr>
        <td className="px-3 py-2 text-left bg-gray-200">TOTAL</td>

        <td className="px-2 py-2 text-center border-r">{totals.suppliersAdded}</td>

        <td className="px-2 py-2 text-center">{totals.ctr_principalCount}</td>
        <td className="px-2 py-2 text-center">{formatCurrency(totals.ctr_principalProfitEur)}</td>
        <td className="px-2 py-2 text-center">{totals.ctr_secondaryCount}</td>
        <td className="px-2 py-2 text-center">{formatCurrency(totals.ctr_secondaryProfitEur)}</td>
        <td className="px-2 py-2 text-center">{totalCtrCount}</td>
        <td className="px-2 py-2 text-center border-r">{formatCurrency(totalCtrProfit)}</td>

        <td className="px-2 py-2 text-center">{totals.livr_principalCount}</td>
        <td className="px-2 py-2 text-center">{formatCurrency(totals.livr_principalProfitEur)}</td>
        <td className="px-2 py-2 text-center">{totals.livr_secondaryCount}</td>
        <td className="px-2 py-2 text-center">{formatCurrency(totals.livr_secondaryProfitEur)}</td>
        <td className="px-2 py-2 text-center">{totalLivrCount}</td>
        <td className="px-2 py-2 text-center border-r">{formatCurrency(totalLivrProfit)}</td>

        <td className="px-2 py-2 text-center">{formatCurrency(targetTotal)}</td>
        <td className="px-2 py-2 text-center border-r text-green-700">
          {formatCurrency(bonusTotal)}
        </td>

        <td className="px-2 py-2 text-center border-l border-r">{formatNumber(avgProfitability)}%</td>

        <td className="px-2 py-2 text-center">{totals.websiteCount}</td>
        <td className="px-2 py-2 text-center border-r">{formatCurrency(totals.websiteProfit)}</td>

        <td className="px-2 py-2 text-center">{totals.websiteCountSec}</td>
        <td className="px-2 py-2 text-center border-r">{formatCurrency(totals.websiteProfitSec)}</td>

        <td className="px-2 py-2 text-center border-r">{totals.burseCount}</td>

        <td className="px-2 py-2 text-center">{totals.solicitariCount}</td>
        <td className="px-2 py-2 text-center">{formatNumber(rateConvWeb)}%</td>

        <td className="px-2 py-2 text-center">{formatNumber(avgClientTerm)}</td>
        <td className="px-2 py-2 text-center">{formatNumber(avgSupplierTerm)}</td>

        <td className="px-2 py-2 text-center text-red-600">{totals.overdueInvoicesCount}</td>

        <td className="px-2 py-2 text-center">{totals.supplierTermsUnder30}</td>
        <td className="px-2 py-2 text-center">{totals.supplierTermsOver30}</td>

        {showSalesMetrics && (
          <>
            <td className="px-2 py-2 text-center">{totals.contactat}</td>
            <td className="px-2 py-2 text-center">{totals.calificat}</td>
            <td className="px-2 py-2 text-center">{formatNumber(rateConvClients)}%</td>
            <td className="px-2 py-2 text-center">{totals.emailsCount}</td>
            <td className="px-2 py-2 text-center border-r">{totals.callsCount}</td>
          </>
        )}
      </tr>

      {/* ===================== MEDIA ===================== */}
      <tr className="text-gray-600 italic">
        <td className="px-3 py-2 text-left bg-gray-200">MEDIA</td>

        <td className="px-2 py-2 text-center border-r">{formatNumber(avg(totals.suppliersAdded))}</td>

        <td className="px-2 py-2 text-center">{formatNumber(avg(totals.ctr_principalCount))}</td>
        <td className="px-2 py-2 text-center">{formatCurrency(avg(totals.ctr_principalProfitEur))}</td>
        <td className="px-2 py-2 text-center">{formatNumber(avg(totals.ctr_secondaryCount))}</td>
        <td className="px-2 py-2 text-center">{formatCurrency(avg(totals.ctr_secondaryProfitEur))}</td>
        <td className="px-2 py-2 text-center">{formatNumber(avg(totalCtrCount))}</td>
        <td className="px-2 py-2 text-center border-r">{formatCurrency(avg(totalCtrProfit))}</td>

        <td className="px-2 py-2 text-center">{formatNumber(avg(totals.livr_principalCount))}</td>
        <td className="px-2 py-2 text-center">{formatCurrency(avg(totals.livr_principalProfitEur))}</td>
        <td className="px-2 py-2 text-center">{formatNumber(avg(totals.livr_secondaryCount))}</td>
        <td className="px-2 py-2 text-center">{formatCurrency(avg(totals.livr_secondaryProfitEur))}</td>
        <td className="px-2 py-2 text-center">{formatNumber(avg(totalLivrCount))}</td>
        <td className="px-2 py-2 text-center border-r">{formatCurrency(avg(totalLivrProfit))}</td>

        <td className="px-2 py-2 text-center">{formatCurrency(avg(targetTotal))}</td>
        <td className="px-2 py-2 text-center border-r text-green-700">
          {formatCurrency(avg(bonusTotal))}
        </td>

        {/* KPI-urile le păstrăm ponderate (nu media per om), ca să nu inducă în eroare */}
        <td className="px-2 py-2 text-center border-l border-r">{formatNumber(avgProfitability)}%</td>

        <td className="px-2 py-2 text-center">{formatNumber(avg(totals.websiteCount))}</td>
        <td className="px-2 py-2 text-center border-r">{formatCurrency(avg(totals.websiteProfit))}</td>

        <td className="px-2 py-2 text-center">{formatNumber(avg(totals.websiteCountSec))}</td>
        <td className="px-2 py-2 text-center border-r">{formatCurrency(avg(totals.websiteProfitSec))}</td>

        <td className="px-2 py-2 text-center border-r">{formatNumber(avg(totals.burseCount))}</td>

        <td className="px-2 py-2 text-center">{formatNumber(avg(totals.solicitariCount))}</td>
        <td className="px-2 py-2 text-center">{formatNumber(rateConvWeb)}%</td>

        <td className="px-2 py-2 text-center">{formatNumber(avgClientTerm)}</td>
        <td className="px-2 py-2 text-center">{formatNumber(avgSupplierTerm)}</td>

        <td className="px-2 py-2 text-center">{formatNumber(avg(totals.overdueInvoicesCount))}</td>
        <td className="px-2 py-2 text-center">{formatNumber(avg(totals.supplierTermsUnder30))}</td>
        <td className="px-2 py-2 text-center">{formatNumber(avg(totals.supplierTermsOver30))}</td>

        {showSalesMetrics && (
          <>
            <td className="px-2 py-2 text-center">{formatNumber(avg(totals.contactat))}</td>
            <td className="px-2 py-2 text-center">{formatNumber(avg(totals.calificat))}</td>
            <td className="px-2 py-2 text-center">{formatNumber(rateConvClients)}%</td>
            <td className="px-2 py-2 text-center">{formatNumber(avg(totals.emailsCount))}</td>
            <td className="px-2 py-2 text-center border-r">{formatNumber(avg(totals.callsCount))}</td>
          </>
        )}
      </tr>
    </tfoot>
  );
};


const TableHeader = ({ showSalesMetrics }) => (
    <thead className="text-[10px] uppercase bg-slate-100 border-b border-slate-200 text-slate-600">
        <tr>
            <th className="px-3 py-3 font-bold sticky left-0 bg-slate-100 z-10 border-r shadow-sm">Angajat</th>
            
            <th className="px-2 py-3 text-center border-r">Furnizori</th>

            <th colSpan={6} className="px-2 py-2 text-center bg-blue-50 border-b border-blue-200 border-r text-blue-800 font-bold">
                După Data Contract
            </th>
            
            <th colSpan={6} className="px-2 py-2 text-center bg-green-50 border-b border-green-200 border-r text-green-800 font-bold">
                După Data Livrare
            </th>

            <th className="px-2 py-3 text-center bg-blue-50/30 text-blue-900 border-b border-blue-200">Target</th>
            <th className="px-2 py-3 text-center bg-blue-100/50 text-green-800 border-b border-blue-200 border-r">Profit peste target</th>

            <th className="px-2 py-3 text-center bg-blue-50 text-blue-800">Profitabilitate<br/>%</th>
            <th className="px-2 py-3 text-center">Curse<br/>Web Pr.</th>
            <th className="px-2 py-3 text-center border-r">Profit<br/>Web Pr.</th>
            
            <th className="px-2 py-3 text-center bg-purple-50/30">Curse<br/>Web Sec.</th>
            <th className="px-2 py-3 text-center bg-purple-50/30 border-r">Profit<br/>Web Sec.</th>

            <th className="px-2 py-3 text-center bg-orange-50/30 border-r text-orange-800">Curse<br/>Burse</th>

            <th className="px-2 py-3 text-center bg-purple-50">Solicitări<br/>Web</th>
            <th className="px-2 py-3 text-center">Conv. Web<br/>%</th>
            <th className="px-2 py-3 text-center">Termen Mediu<br/>Plată Client</th>
            <th className="px-2 py-3 text-center">Termen Mediu<br/>Plată Furnizor</th>
            <th className="px-2 py-3 text-center text-red-600">Întârzieri<br/>Client {'>'}15</th>
            <th className="px-2 py-3 text-center bg-orange-50 text-orange-800">Furn.<br/>{'<'}30</th>
            <th className="px-2 py-3 text-center bg-orange-50 text-orange-800">Furn.<br/>{'>='}30</th>

            {showSalesMetrics && (
                <React.Fragment>
                    <th className="px-2 py-3 text-center bg-yellow-100/50">CONTACTATI</th>
                    <th className="px-2 py-3 text-center bg-yellow-100/50">Calificați</th>
                    <th className="px-2 py-3 text-center bg-yellow-100/50 border-r text-blue-700 font-bold">Rata Conv.</th>
                    <th className="px-2 py-3 text-center bg-indigo-50 text-indigo-900">EMAILS</th>
                    <th className="px-2 py-3 text-center bg-indigo-50 text-indigo-900 border-r">APELURI</th>
                </React.Fragment>
            )}
        </tr>
        <tr>
            <th className="sticky left-0 bg-slate-100 z-10 border-r"></th>
            <th className="border-r"/>

            <th className="px-1 py-2 text-center bg-blue-50/30">Curse Pr.</th>
            <th className="px-1 py-2 text-center bg-blue-50/30">Profit Pr.</th>
            <th className="px-1 py-2 text-center">Curse Sec.</th>
            <th className="px-1 py-2 text-center">Profit Sec.</th>
            <th className="px-1 py-2 text-center bg-blue-100/50 font-bold">Total Curse</th>
            <th className="px-1 py-2 text-center bg-blue-100/50 font-bold">Total Profit</th>

            <th className="px-1 py-2 text-center bg-green-50/30">Curse Pr.</th>
            <th className="px-1 py-2 text-center bg-green-50/30">Profit Pr.</th>
            <th className="px-1 py-2 text-center">Curse Sec.</th>
            <th className="px-1 py-2 text-center">Profit Sec.</th>
            <th className="px-1 py-2 text-center bg-green-100/50 font-bold">Total Curse</th>
            <th className="px-1 py-2 text-center bg-green-100/50 border-r font-bold">Total Profit</th>

            <th className="bg-blue-50/30"></th>
            <th className="bg-blue-100/50 border-r"></th>

            <th colSpan={14}></th>
            {showSalesMetrics && <React.Fragment><th className="bg-yellow-100/50"/><th className="bg-yellow-100/50"/><th className="bg-yellow-100/50 border-r"/><th className="bg-indigo-50"/><th className="bg-indigo-50 border-r"/></React.Fragment>}
        </tr>
    </thead>
);

const CompanyTable = ({ stats }) => {
    // Helper to render breakout rows
    const renderBreakdownRows = (breakdownObj) => {
        // ... (not used, keeping for structure if needed later)
        return null;
    };
    
    // Function to calculate %
    const calcPct = (count, total) => total > 0 ? ((count / total) * 100).toFixed(1) + "%" : "0.0%";
    
    // Helper to render a section of rows for a specific breakdown
    const renderBreakdownSection = (title, fieldKey) => {
        // Collect all unique keys from both CTR and LIVR
        const ctrData = stats.ctr.breakdowns?.[fieldKey] || {};
        const livrData = stats.livr.breakdowns?.[fieldKey] || {};
        const allKeys = new Set([...Object.keys(ctrData), ...Object.keys(livrData)]);
        
        if (allKeys.size === 0) return null;
        
        return (
            <>
                <tr className="bg-gray-200"><td colSpan="3" className="font-bold text-xs uppercase px-4 py-1">{title}</td></tr>
                {[...allKeys].sort().map(key => (
                    <tr key={key} className="border-b text-xs">
                        <td className="px-4 py-1">{key}</td>
                        <td className="px-4 py-1 text-right">
                            {ctrData[key] || 0} <span className="text-gray-500 text-[10px]">({calcPct(ctrData[key] || 0, stats.ctr.count)})</span>
                        </td>
                        <td className="px-4 py-1 text-right">
                            {livrData[key] || 0} <span className="text-gray-500 text-[10px]">({calcPct(livrData[key] || 0, stats.livr.count)})</span>
                        </td>
                    </tr>
                ))}
            </>
        );
    };

    return (
        <div className="overflow-x-auto bg-white rounded-lg shadow border border-slate-200 mt-8">
             <div className="p-4 border-b border-slate-200 bg-slate-800 text-white">
                <h3 className="font-bold">Total Companie (Global)</h3>
            </div>
            <table className="w-full text-sm text-left text-slate-800">
                <thead className="bg-slate-100 border-b border-slate-300">
                    <tr>
                         <th className="px-4 py-3">Metrică</th>
                         <th className="px-4 py-3 text-right">După Data Contract</th>
                         <th className="px-4 py-3 text-right">După Data Livrare</th>
                    </tr>
                </thead>
                <tbody>
                     <tr className="border-b bg-blue-50">
                         <td className="px-4 py-3 font-bold">Număr Total Curse</td>
                         <td className="px-4 py-3 text-right font-bold">{stats.ctr.count}</td>
                         <td className="px-4 py-3 text-right font-bold">{stats.livr.count}</td>
                     </tr>
                     <tr className="border-b">
                         <td className="px-4 py-3 font-bold">Profit Total (EUR)</td>
                         <td className="px-4 py-3 text-right font-bold text-green-700">{formatCurrency(stats.ctr.profit)}</td>
                         <td className="px-4 py-3 text-right font-bold text-green-700">{formatCurrency(stats.livr.profit)}</td>
                     </tr>
                     <tr className="border-b">
                         <td className="px-4 py-3">Website / Fix - Curse</td>
                         <td className="px-4 py-3 text-right">{stats.ctr.websiteCount}</td>
                         <td className="px-4 py-3 text-right">{stats.livr.websiteCount}</td>
                     </tr>
                     <tr className="border-b">
                         <td className="px-4 py-3">Website / Fix - Profit</td>
                         <td className="px-4 py-3 text-right">{formatCurrency(stats.ctr.websiteProfit)}</td>
                         <td className="px-4 py-3 text-right">{formatCurrency(stats.livr.websiteProfit)}</td>
                     </tr>
                     <tr className="border-b">
                         <td className="px-4 py-3">Burse - Curse</td>
                         <td className="px-4 py-3 text-right">{stats.ctr.burseCount}</td>
                         <td className="px-4 py-3 text-right">{stats.livr.burseCount}</td>
                     </tr>
                     
                     {/* BREAKDOWNS */}
                     {renderBreakdownSection("Tip serviciu", "STATUS_CTR")}
                     {renderBreakdownSection("Dep", "DEP")}
                     {renderBreakdownSection("Status Plata Client", "STATUS_PLATA_CLIENT")}
                     {renderBreakdownSection("Moneda Cursa", "MONEDA")}
                     {renderBreakdownSection("Sursa Client", "SURSA")}
                     {renderBreakdownSection("Implicare", "IMPLICARE")}
                     {renderBreakdownSection("Client Pe", "CLIENT_PE")}
                     {renderBreakdownSection("Furnizor Pe", "FURNIZ_PE")}
                     {renderBreakdownSection("Client/Furnizor Pe", "CLIENT_FURNIZOR_PE")}
                     {renderBreakdownSection("Mod Transport", "MOD_TRANSPORT")}
                     {renderBreakdownSection("Tip Marfa", "TIP_MARFA")}
                     {renderBreakdownSection("Ocupare Mij Transport", "OCUPARE")}
                </tbody>
            </table>
        </div>
    );
}

const ManagementTable = ({ data, dateRange }) => {
    return (
        <div className="overflow-x-auto bg-white rounded-lg shadow border border-slate-200">
            <div className="p-4 border-b border-slate-200 bg-slate-50">
                <h3 className="font-bold text-slate-800">
                    Departamentul de Management în intervalul: {dateRange}
                </h3>
            </div>
            <table className="w-full text-xs text-left text-slate-600 whitespace-nowrap">
                <TableHeader showSalesMetrics={false} />
                <tbody>
                    {data.map((row, index) => (
                        <tr key={index} className="border-b hover:bg-slate-50">
                            <OperationalRowCells row={row} showSalesMetrics={false} />
                        </tr>
                    ))}
                    {data.length === 0 && (
                        <tr>
                            <td colSpan={30} className="px-4 py-8 text-center text-slate-500">
                                Nu există date disponibile pentru perioada selectată.
                            </td>
                        </tr>
                    )}
                </tbody>
                {data.length > 0 && <TableFooter data={data} showSalesMetrics={false} />}
            </table>
        </div>
    );
};

const OperationalTable = ({ data, dateRange }) => {
    return (
        <div className="overflow-x-auto bg-white rounded-lg shadow border border-slate-200">
            <div className="p-4 border-b border-slate-200 bg-slate-50">
                <h3 className="font-bold text-slate-800">
                    Departamentul de Operațiuni în intervalul: {dateRange}
                </h3>
            </div>
            <table className="w-full text-xs text-left text-slate-600 whitespace-nowrap">
                <TableHeader showSalesMetrics={false} />
                <tbody>
                    {data.map((row, index) => (
                        <tr key={index} className="border-b hover:bg-slate-50">
                            <OperationalRowCells row={row} showSalesMetrics={false} />
                        </tr>
                    ))}
                    {data.length === 0 && (
                        <tr>
                            <td colSpan={30} className="px-4 py-8 text-center text-slate-500">
                                Nu există date disponibile pentru perioada selectată.
                            </td>
                        </tr>
                    )}
                </tbody>
                {data.length > 0 && <TableFooter data={data} showSalesMetrics={false} />}
            </table>
        </div>
    );
};

const SalesTable = ({ data, dateRange }) => {
    return (
        <div className="overflow-x-auto bg-white rounded-lg shadow border border-slate-200">
             <div className="p-4 border-b border-slate-200 bg-slate-50">
                <h3 className="font-bold text-slate-800">
                    Departamentul de Vânzări în intervalul: {dateRange}
                </h3>
            </div>
            <table className="w-full text-xs text-left text-slate-600 whitespace-nowrap">
                <TableHeader showSalesMetrics={true} />
                <tbody>
                     {data.map((row, index) => (
                        <tr key={index} className="border-b hover:bg-slate-50">
                            <OperationalRowCells row={row} showSalesMetrics={true} />
                        </tr>
                    ))}
                     {data.length === 0 && (
                        <tr>
                            <td colSpan={33} className="px-4 py-8 text-center text-slate-500">
                                Nu există date disponibile pentru perioada selectată.
                            </td>
                        </tr>
                    )}
                </tbody>
                {data.length > 0 && <TableFooter data={data} showSalesMetrics={true} />}
            </table>
        </div>
    );
};

export default function App() {
    const [selectedPeriod, setSelectedPeriod] = useState("week"); 
    const [customStart, setCustomStart] = useState("");
    const [customEnd, setCustomEnd] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    
    // State per departament
    const [opsStats, setOpsStats] = useState([]);
    const [salesStats, setSalesStats] = useState([]);
    const [mgmtStats, setMgmtStats] = useState([]); 
    const [companyStats, setCompanyStats] = useState({ 
        ctr: { count: 0, profit: 0, websiteCount: 0, websiteProfit: 0, burseCount: 0, breakdowns: {} }, 
        livr: { count: 0, profit: 0, websiteCount: 0, websiteProfit: 0, burseCount: 0, breakdowns: {} } 
    });
    
    const [dateRangeStr, setDateRangeStr] = useState("");
    const [statusMessage, setStatusMessage] = useState("");

    const getDateRange = () => {
        const now = new Date();
        const start = new Date(now);
        const end = new Date(now);

        if (selectedPeriod === 'week') {
            const day = start.getDay();
            const diff = start.getDate() - day + (day === 0 ? -6 : 1) - 7; 
            start.setDate(diff);
            start.setHours(0, 0, 0, 0);
            end.setDate(start.getDate() + 6);
            end.setHours(23, 59, 59, 999);
        } else if (selectedPeriod === 'month') {
            start.setMonth(start.getMonth() - 1);
            start.setDate(1);
            start.setHours(0, 0, 0, 0);
            end.setDate(0); 
            end.setHours(23, 59, 59, 999);
        } else if (selectedPeriod === 'year') {
            start.setFullYear(start.getFullYear() - 1);
            start.setMonth(0);
            start.setDate(1);
            start.setHours(0, 0, 0, 0);
            end.setFullYear(end.getFullYear() - 1);
            end.setMonth(11);
            end.setDate(31);
            end.setHours(23, 59, 59, 999);
        } else if (selectedPeriod === 'custom') {
            if (!customStart || !customEnd) return null;
            const sParts = customStart.split('-').map(Number);
            const eParts = customEnd.split('-').map(Number);
            const s = new Date(sParts[0], sParts[1] - 1, sParts[2]);
            const e = new Date(eParts[0], eParts[1] - 1, eParts[2]);
            s.setHours(0,0,0,0);
            e.setHours(23,59,59,999);
            return { start: s, end: e };
        }
        return { start, end };
    };

    const handleGenerate = () => {
        const range = getDateRange();
        if (!range || range.start > range.end) {
            setError("Interval invalid.");
            return;
        }
        fetchMondayData(range);
    };

    const handleExport = () => {
        if (!opsStats.length && !salesStats.length && !mgmtStats.length) {
            setError("Nu există date de exportat.");
            return;
        }

        setError(null);

        const parts = (dateRangeStr || "").trim().split(/\s*\.\.\s*/);
        const periodStart = (parts[0] || "").trim();
        const periodEnd = (parts[1] || "").trim();
        const filename = periodStart && periodEnd
            ? formatRaportFilename(periodStart, periodEnd)
            : `Raport_${(dateRangeStr || "raport").replace(/\s*[–-]\s*/g, "_").replace(/\s+/g, "").replace(/[^a-zA-Z0-9._-]/g, "")}.xlsx`;

        const generateExcel = async () => {
            const workbook = buildWeeklyRaportWorkbook(
                { opsStats, salesStats, mgmtStats, companyStats, meta: { periodStart, periodEnd, label: dateRangeStr } },
                window.ExcelJS
            );
            const buffer = await workbook.xlsx.writeBuffer();
            const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
            const url = window.URL.createObjectURL(blob);
            const anchor = document.createElement("a");
            anchor.href = url;
            anchor.download = filename;
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
            setTimeout(() => window.URL.revokeObjectURL(url), 0);
        };

        if (!window.ExcelJS) {
            const script = document.createElement("script");
            script.src = "https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.3.0/exceljs.min.js";
            script.onload = () => generateExcel();
            script.onerror = () => setError("Nu s-a putut încărca ExcelJS.");
            document.body.appendChild(script);
        } else {
            generateExcel();
        }
    };

    const fetchAllItems = async (boardId, colIdsArray, rulesString = null) => {
        let allItems = [];
        let cursor = null;
        let hasMore = true;
        
        const colsString = colIdsArray.map(c => `"${c}"`).join(", ");

        while (hasMore) {
            let args = "";
            if (cursor) {
                args = `limit: 250, cursor: "${cursor}"`;
            } else {
                args = `limit: 250`;
                if (rulesString) {
                    args += `, query_params: { rules: ${rulesString} }`;
                }
            }

            const query = `query {
                boards (ids: [${boardId}]) {
                    items_page (${args}) {
                        cursor
                        items {
                            id
                            name
                            column_values(ids: [${colsString}]) {
                                id
                                text
                                value
                                type
                                ... on FormulaValue { display_value }
                            }
                        }
                    }
                }
            }`;

            let attempts = 0;
            let success = false;
            let json;
            
            while(attempts < 3 && !success) {
                try {
                    const response = await fetch("https://api.monday.com/v2", {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': API_KEY
                        },
                        body: JSON.stringify({ query })
                    });
                    
                    if (!response.ok) throw new Error(`HTTP ${response.status}`);
                    json = await response.json();
                    success = true;
                } catch(e) {
                    attempts++;
                    console.warn(`Attempt ${attempts} failed for board ${boardId}:`, e);
                    if(attempts >= 3) throw e;
                    await new Promise(r => setTimeout(r, 1000 * attempts));
                }
            }

            if (json.errors) throw new Error(json.errors[0].message);
            
            const data = json.data?.boards?.[0]?.items_page;
            if (!data) break;

            allItems = [...allItems, ...data.items];
            cursor = data.cursor;
            
            if (!cursor) hasMore = false;
        }
        
        return { items_page: { items: allItems } };
    };
    
    // LIGHTWEIGHT DIRECTORY FETCH
    const fetchItemsDirectory = async (boardId, ownerColId, rulesString = null) => {
        let allItems = [];
        let cursor = null;
        let hasMore = true;

        while (hasMore) {
            let args = "";
            if (cursor) {
                args = `limit: 500, cursor: "${cursor}"`;
            } else {
                args = `limit: 500`;
                if (rulesString) {
                    args += `, query_params: { rules: ${rulesString} }`;
                }
            }
            
            const query = `query {
                boards (ids: [${boardId}]) {
                    items_page (${args}) {
                        cursor
                        items {
                            id
                            column_values(ids: ["${ownerColId}"]) {
                                id
                                value
                            }
                        }
                    }
                }
            }`;
            
            try {
                const res = await fetch("https://api.monday.com/v2", {
                     method: 'POST',
                     headers: { 'Content-Type': 'application/json', 'Authorization': API_KEY },
                     body: JSON.stringify({ query })
                });
                const json = await res.json();
                const data = json.data?.boards?.[0]?.items_page;
                
                if (data?.items) allItems.push(...data.items);
                cursor = data?.cursor;
                if (!cursor) hasMore = false;
            } catch(e) {
                console.error("Directory fetch error:", e);
                hasMore = false;
            }
        }
        return { items_page: { items: allItems } };
    };
    
    const fetchColumns = async (boardId) => {
        const query = `query {
            boards (ids: [${boardId}]) {
                columns { id title type }
            }
        }`;
        const response = await fetch("https://api.monday.com/v2", {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': API_KEY },
            body: JSON.stringify({ query })
        });
        const json = await response.json();
        return json.data?.boards?.[0]?.columns || [];
    };

    // NEW: Fetch Activities specifically (Timeline query optimization)
    const fetchActivitiesForItems = async (itemIds, start, end) => {
        // We chunk itemIds to avoid massive queries
        const CHUNK_SIZE = 15; // Increased for speed
        const results = [];
        
        // Convert dates to timestamps for easy comparison
        const startTime = start.getTime();
        const endTime = end.getTime();
        
        for (let i = 0; i < itemIds.length; i += CHUNK_SIZE) {
            const chunk = itemIds.slice(i, i + CHUNK_SIZE);
            const queryBody = chunk.map((id, idx) => `
                t_${id}: timeline(id: ${id}) {
                    timeline_items_page {
                        timeline_items {
                            type
                            created_at
                            user { id }
                        }
                    }
                }
            `).join('\n');
            
            const query = `query { ${queryBody} }`;
            
            try {
                const response = await fetch("https://api.monday.com/v2", {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': API_KEY },
                    body: JSON.stringify({ query })
                });
                const json = await response.json();
                if (json.data) {
                     Object.values(json.data).forEach(tData => {
                         if (tData?.timeline_items_page?.timeline_items) {
                             results.push(...tData.timeline_items_page.timeline_items);
                         }
                     });
                }
            } catch(e) {
                console.warn("Error fetching activities chunk:", e);
            }
        }
        
        return results.filter(item => {
            const itemTime = new Date(item.created_at).getTime();
            return itemTime >= startTime && itemTime <= endTime;
        });
    };

    const fetchMondayData = async ({ start, end }) => {
        setLoading(true);
        setStatusMessage("Se preiau datele din board-uri...");
        setError(null);
        setOpsStats([]);
        setSalesStats([]);
        setMgmtStats([]); // Reset management stats
        setCompanyStats({ 
            ctr: { count: 0, profit: 0, websiteCount: 0, websiteProfit: 0, burseCount: 0, breakdowns: {} }, 
            livr: { count: 0, profit: 0, websiteCount: 0, websiteProfit: 0, burseCount: 0, breakdowns: {} } 
        });

        try {
            const dateFrom = formatDateISO(start);
            const dateTo = formatDateISO(end);
            
            const salesUserIds = new Set(DEPARTMENTS.sales.employees.map(e => String(e.mondayUserId)));

            const isOwnedBySales = (item, ownerColId) => {
                const col = item.column_values.find(c => c.id === ownerColId);
                const ids = getPersonIds(col);
                return ids.some(id => salesUserIds.has(String(id)));
            };

            const furnizoriCols = await fetchColumns(BOARD_ID_FURNIZORI);
            const contacteCols = await fetchColumns(BOARD_ID_CONTACTE);

            const furnDateCol = furnizoriCols.find(c => c.type === 'date' || c.title.toLowerCase().includes('data'))?.id || "date4";
            const furnPersonCol = furnizoriCols.find(c => c.type === 'people' || c.title.toLowerCase().includes('owner') || c.title.toLowerCase().includes('persoana'))?.id || "person";
            const contactOwnerCol = COLS.CONTACTE.OWNER; 

            // FETCH COLS FOR COMENZI TO FIND ALL DYNAMIC COLUMNS
            const comenziCols = await fetchColumns(BOARD_ID_COMENZI);
            
            // DYNAMIC FINDER HELPER
            const findColId = (searchTitle, defaultId) => {
                return comenziCols.find(c => c.title.toLowerCase().trim() === searchTitle.toLowerCase().trim() || c.title.toLowerCase().includes(searchTitle.toLowerCase()))?.id || defaultId;
            };

            COLS.COMENZI.SURSA = findColId("Sursa", COLS.COMENZI.SURSA);
            COLS.COMENZI.CRT = findColId("Crt", "crt");
            COLS.COMENZI.DEP = findColId("Dep", "dep");
            COLS.COMENZI.IMPLICARE = findColId("Implicare", "implicare");
            COLS.COMENZI.CLIENT_FURNIZOR_PE = findColId("Client/Furnizor Pe", "client_furnizor");
            COLS.COMENZI.MOD_TRANSPORT = findColId("Mod Transport", "mod_transport");
            COLS.COMENZI.TIP_MARFA = findColId("Tip Marfa", "tip_marfa");
            COLS.COMENZI.OCUPARE = findColId("Ocupare", "ocupare");

            // Console log to debug detections
            console.log("Detected Columns:", COLS.COMENZI);


            const comenziCtr = await fetchAllItems(
                BOARD_ID_COMENZI,
                Object.values(COLS.COMENZI),
                `[{ column_id: "${COLS.COMENZI.DATA_CTR}", operator: between, compare_value: ["${dateFrom}", "${dateTo}"] }]`
            );

            const comenziLivr = await fetchAllItems(
                BOARD_ID_COMENZI,
                Object.values(COLS.COMENZI),
                `[{ column_id: "${COLS.COMENZI.DATA_LIVRARE}", operator: between, compare_value: ["${dateFrom}", "${dateTo}"] }]`
            );

            const solicitari = await fetchAllItems(
                BOARD_ID_SOLICITARI,
                Object.values(COLS.SOLICITARI),
                `[{ column_id: "${COLS.SOLICITARI.DATA}", operator: between, compare_value: ["${dateFrom}", "${dateTo}"] }]`
            );

            // Use discovered IDs for Furnizori
            const furnizori = await fetchAllItems(
                BOARD_ID_FURNIZORI,
                [furnDateCol, furnPersonCol],
                `[{ column_id: "${furnDateCol}", operator: between, compare_value: ["${dateFrom}", "${dateTo}"] }]`
            );

            const leadsContact = await fetchAllItems(
                BOARD_ID_LEADS,
                Object.values(COLS.LEADS),
                `[{ column_id: "${COLS.LEADS.DATA}", operator: between, compare_value: ["${dateFrom}", "${dateTo}"] }, { column_id: "${COLS.LEADS.STATUS}", operator: any_of, compare_value: [14] }]`
            );

            const leadsQualified = await fetchAllItems(
                BOARD_ID_LEADS,
                Object.values(COLS.LEADS),
                `[{ column_id: "${COLS.LEADS.DATA}", operator: between, compare_value: ["${dateFrom}", "${dateTo}"] }, { column_id: "${COLS.LEADS.STATUS}", operator: any_of, compare_value: [103] }]`
            );
            
            // --- OPTIMIZED ACTIVITIES FETCH VIA CLIENT-SIDE FILTER ---
            setStatusMessage("Se scanează itemii pentru activități (Filtrare Client-Side)...");
            
            // 1. Fetch Lightweight Directories - FILTERED BY DATE ON SERVER
            const rawLeads = await fetchItemsDirectory(
                BOARD_ID_LEADS, 
                COLS.LEADS.OWNER,
                `[{ column_id: "${COLS.LEADS.DATA}", operator: between, compare_value: ["${dateFrom}", "${dateTo}"] }]`
            );
            
            const rawContacts = await fetchItemsDirectory(
                BOARD_ID_CONTACTE, 
                contactOwnerCol,
                `[{ column_id: "${COLS.CONTACTE.DATA}", operator: between, compare_value: ["${dateFrom}", "${dateTo}"] }]`
            );

            // 2. Filter Client-Side (Double check for Owner)
            // No owner filter for activities fetch, get all
            const relevantLeads = rawLeads.items_page.items;
            const relevantContacts = rawContacts.items_page.items;
            
            const allActivityItemIds = [...relevantLeads, ...relevantContacts].map(i => i.id);
            
            let activities = [];
            if (allActivityItemIds.length > 0) {
                setStatusMessage(`Se descarcă activități pentru ${allActivityItemIds.length} itemi...`);
                activities = await fetchActivitiesForItems(allActivityItemIds, start, end);
            }
            
            setStatusMessage("Se finalizează calculele...");
            processAllData({ comenziCtr, comenziLivr, solicitari, leadsContact, leadsQualified, furnizori, activities, start, end, dynamicCols: { furnDateCol, furnPersonCol } });

        } catch (err) {
            console.error(err);
            setError("Eroare la preluarea datelor: " + err.message);
        } finally {
            setLoading(false);
            setStatusMessage("");
        }
    };

    const processAllData = ({ comenziCtr, comenziLivr, solicitari, leadsContact, leadsQualified, furnizori, activities, start, end, dynamicCols }) => { 
    setDateRangeStr(`${start.toLocaleDateString('ro-RO')} – ${end.toLocaleDateString('ro-RO')}`);
    
    const generateStats = (employees) => employees.map(emp => ({
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

        // New fields
        websiteCountSec: 0,
        websiteProfitSec: 0,
        burseCount: 0
    }));
    
    const companyStatsLocal = {
         ctr: { count: 0, profit: 0, websiteCount: 0, websiteProfit: 0, burseCount: 0, breakdowns: {} }, 
         livr: { count: 0, profit: 0, websiteCount: 0, websiteProfit: 0, burseCount: 0, breakdowns: {} } 
    };
    
    // Helper to aggregate breakdowns
    const aggregateBreakdown = (targetStats, columnKey, rawVal) => {
        if (!rawVal) return;
        const val = String(rawVal).trim();
        if (val === "" || val.toLowerCase() === "null") return;
        
        if (!targetStats.breakdowns[columnKey]) targetStats.breakdowns[columnKey] = {};
        if (!targetStats.breakdowns[columnKey][val]) targetStats.breakdowns[columnKey][val] = 0;
        targetStats.breakdowns[columnKey][val]++;
    };

    const opsStatsLocal = generateStats(DEPARTMENTS.operational.employees);
    const salesStatsLocal = generateStats(DEPARTMENTS.sales.employees);
    const mgmtStatsLocal = generateStats(DEPARTMENTS.management.employees); // Init Management Stats

    const applyToAllStats = (callback) => {
        callback(opsStatsLocal);
        callback(salesStatsLocal);
        callback(mgmtStatsLocal); // Include Management in processing loop
    };
    
    // Helper for orphan logic
    const RAFAEL_ID = "73046209";

    // --- NEW helper (ONLY used for Company Global profit calc) ---
    const toEur = (val, isRon) => (isRon ? (safeVal(val) / EXCHANGE_RATE) : safeVal(val));

    if (comenziCtr) {
        comenziCtr.items_page.items.forEach(item => {
            const getCol = (id) => item.column_values.find(c => c.id === id);
            const statusCtr = getCol(COLS.COMENZI.STATUS_CTR)?.text?.toLowerCase() || "";
            const statusTrans = getCol(COLS.COMENZI.STATUS_TRANS)?.text?.toLowerCase() || "";
            if (statusCtr.includes("anulat") || statusTrans.includes("anulat")) return;

            const valPrincipal = extractNumericValue(getCol(COLS.COMENZI.PROFIT_PRINCIPAL));
            const valSecundar = extractNumericValue(getCol(COLS.COMENZI.PROFIT_SECUNDAR));
            
            const colProfitability = getCol(COLS.COMENZI.PROFITABILITATE);
            let profitabilityVal = 0;
            let hasProfitability = false;
            if (colProfitability?.display_value && colProfitability.display_value !== "null") {
                profitabilityVal = parseFloat(colProfitability.display_value);
                if (!isNaN(profitabilityVal)) {
                    hasProfitability = true;
                }
            }

            const currencyVal = getCol(COLS.COMENZI.MONEDA)?.text?.toUpperCase() || "";
            const isRon = currencyVal.includes("RON") || currencyVal.includes("LEI");

            const sursaVal = getCol(COLS.COMENZI.SURSA)?.text?.trim().toLowerCase() || "";
            // BURSE Logic Update
            const isWebsite = sursaVal === "website" || sursaVal === "telefon / whatsapp fix" || sursaVal === "fix";
            const isBurse = sursaVal.includes("timocom") || sursaVal.includes("trans.eu") || sursaVal.includes("cargopedia");

            const clientTerm = extractNumericValue(getCol(COLS.COMENZI.TERMEN_PLATA_CLIENT));
            const supplierTerm = extractNumericValue(getCol(COLS.COMENZI.TERMEN_PLATA_FURNIZOR));
            
            let isOverdue = false;
            const scadentaClientText = getCol(COLS.COMENZI.DATA_SCADENTA_CLIENT)?.text;
            const statusPlataClient = getCol(COLS.COMENZI.STATUS_PLATA_CLIENT)?.text?.toLowerCase() || "";
            
            if (scadentaClientText && !statusPlataClient.includes("incasata") && !statusPlataClient.includes("încasată")) {
                const scadentaDate = new Date(scadentaClientText);
                if (!isNaN(scadentaDate.getTime())) {
                    const today = new Date();
                    const diffTime = Math.abs(today - scadentaDate);
                    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 
                    if (scadentaDate < today && diffDays > 15) {
                        isOverdue = true;
                    }
                }
            }

            const colPrincipal = getCol(COLS.COMENZI.PRINCIPAL);
            const colSecundar = getCol(COLS.COMENZI.SECUNDAR);
            
            let principalIds = getPersonIds(colPrincipal);
            let secondaryIds = getPersonIds(colSecundar);
            const hasSecondary = secondaryIds.length > 0;
            
            // ORPHAN PROFIT LOGIC for Rafael
            if (!hasSecondary && valSecundar !== 0) {
                secondaryIds.push(RAFAEL_ID);
            }
            
            // --- COMPANY STATS (GLOBAL) CTR ---
            // IMPORTANT FIX: Profit total companie se ia din coloana PROFIT (formula_mkre3gx1), nu din P+S.
            const totalProfitRaw = extractNumericValue(getCol(COLS.COMENZI.PROFIT)); // <-- FIX
            const totalItemProfitCompany = toEur(totalProfitRaw, isRon);            // <-- FIX

            companyStatsLocal.ctr.count++;
            companyStatsLocal.ctr.profit += totalItemProfitCompany;                 // <-- FIX
            if (isWebsite) {
                companyStatsLocal.ctr.websiteCount++;
                companyStatsLocal.ctr.websiteProfit += totalItemProfitCompany;     // <-- FIX (same meaning: total profit for website deals)
            }
            if (isBurse) {
                companyStatsLocal.ctr.burseCount++;
            }
            
            // Aggregation for breakdown
            aggregateBreakdown(companyStatsLocal.ctr, "STATUS_CTR", getCol(COLS.COMENZI.STATUS_CTR)?.text);
            aggregateBreakdown(companyStatsLocal.ctr, "DEP", getCol(COLS.COMENZI.DEP)?.text);
            aggregateBreakdown(companyStatsLocal.ctr, "STATUS_PLATA_CLIENT", getCol(COLS.COMENZI.STATUS_PLATA_CLIENT)?.text);
            aggregateBreakdown(companyStatsLocal.ctr, "MONEDA", getCol(COLS.COMENZI.MONEDA)?.text);
            aggregateBreakdown(companyStatsLocal.ctr, "SURSA", getCol(COLS.COMENZI.SURSA)?.text);
            aggregateBreakdown(companyStatsLocal.ctr, "IMPLICARE", getCol(COLS.COMENZI.IMPLICARE)?.text);
            aggregateBreakdown(companyStatsLocal.ctr, "CLIENT_PE", getCol(COLS.COMENZI.CLIENT_PE)?.text);
            aggregateBreakdown(companyStatsLocal.ctr, "FURNIZ_PE", getCol(COLS.COMENZI.FURNIZ_PE)?.text);
            aggregateBreakdown(companyStatsLocal.ctr, "CLIENT_FURNIZOR_PE", getCol(COLS.COMENZI.CLIENT_FURNIZOR_PE)?.text);
            aggregateBreakdown(companyStatsLocal.ctr, "MOD_TRANSPORT", getCol(COLS.COMENZI.MOD_TRANSPORT)?.text);
            aggregateBreakdown(companyStatsLocal.ctr, "TIP_MARFA", getCol(COLS.COMENZI.TIP_MARFA)?.text);
            aggregateBreakdown(companyStatsLocal.ctr, "OCUPARE", getCol(COLS.COMENZI.OCUPARE)?.text);

            // --- EXISTING employee logic unchanged ---
            const profitToAddP = isRon ? (valPrincipal / EXCHANGE_RATE) : valPrincipal;
            const profitToAddS = isRon ? (valSecundar / EXCHANGE_RATE) : valSecundar;

            applyToAllStats((statsList) => {
                statsList.forEach(emp => {
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

                        if (clientTerm > 0) {
                            emp.sumClientTerms += clientTerm;
                            emp.countClientTerms++;
                        }
                        if (isOverdue) emp.overdueInvoicesCount++;

                        if (isBurse) emp.burseCount++;
                    }

                    if (isSecondary) {
                        emp.ctr_secondaryCount++;
                        emp.ctr_secondaryProfitEur += safeVal(profitToAddS);
                        if (isRon) emp.profitRonRaw += safeVal(valSecundar);

                        if (isWebsite) {
                            emp.websiteCountSec++;
                            emp.websiteProfitSec += safeVal(profitToAddS);
                        }
                    }

                    if (isSecondary || (isPrincipal && !hasSecondary)) {
                        if (supplierTerm > 0) {
                            emp.sumSupplierTerms += supplierTerm;
                            emp.countSupplierTerms++;
                            if (supplierTerm < 30) emp.supplierTermsUnder30++;
                            else emp.supplierTermsOver30++;
                        }
                    }
                });
            });
        });
    }

    if (comenziLivr) {
        comenziLivr.items_page.items.forEach(item => {
            const getCol = (id) => item.column_values.find(c => c.id === id);
            const statusCtr = getCol(COLS.COMENZI.STATUS_CTR)?.text?.toLowerCase() || "";
            const statusTrans = getCol(COLS.COMENZI.STATUS_TRANS)?.text?.toLowerCase() || "";
            if (statusCtr.includes("anulat") || statusTrans.includes("anulat")) return;

            const valPrincipal = extractNumericValue(getCol(COLS.COMENZI.PROFIT_PRINCIPAL));
            const valSecundar = extractNumericValue(getCol(COLS.COMENZI.PROFIT_SECUNDAR));
            const currencyVal = getCol(COLS.COMENZI.MONEDA)?.text?.toUpperCase() || "";
            const isRon = currencyVal.includes("RON") || currencyVal.includes("LEI");

            const sursaVal = getCol(COLS.COMENZI.SURSA)?.text?.trim().toLowerCase() || "";
            const isWebsite = sursaVal === "website" || sursaVal === "telefon / whatsapp fix" || sursaVal === "fix";
            const isBurse = ["timocom", "trans.eu", "cargopedia"].some(b => sursaVal.includes(b));

            const colPrincipal = getCol(COLS.COMENZI.PRINCIPAL);
            const colSecundar = getCol(COLS.COMENZI.SECUNDAR);
            let principalIds = getPersonIds(colPrincipal);
            let secondaryIds = getPersonIds(colSecundar);
            
            if (secondaryIds.length === 0 && valSecundar !== 0) {
                secondaryIds.push(RAFAEL_ID);
            }

            // --- COMPANY STATS (GLOBAL) LIVR ---
            // IMPORTANT FIX: Profit total companie se ia din coloana PROFIT (formula_mkre3gx1), nu din P+S.
            const totalProfitRaw = extractNumericValue(getCol(COLS.COMENZI.PROFIT)); // <-- FIX
            const totalItemProfitCompany = toEur(totalProfitRaw, isRon);            // <-- FIX

            companyStatsLocal.livr.count++;
            companyStatsLocal.livr.profit += totalItemProfitCompany;                // <-- FIX
            if (isWebsite) {
                companyStatsLocal.livr.websiteCount++;
                companyStatsLocal.livr.websiteProfit += totalItemProfitCompany;     // <-- FIX
            }
            if (isBurse) {
                companyStatsLocal.livr.burseCount++;
            }

            // Aggregation for breakdown
            aggregateBreakdown(companyStatsLocal.livr, "STATUS_CTR", getCol(COLS.COMENZI.STATUS_CTR)?.text);
            aggregateBreakdown(companyStatsLocal.livr, "DEP", getCol(COLS.COMENZI.DEP)?.text);
            aggregateBreakdown(companyStatsLocal.livr, "STATUS_PLATA_CLIENT", getCol(COLS.COMENZI.STATUS_PLATA_CLIENT)?.text);
            aggregateBreakdown(companyStatsLocal.livr, "MONEDA", getCol(COLS.COMENZI.MONEDA)?.text);
            aggregateBreakdown(companyStatsLocal.livr, "SURSA", getCol(COLS.COMENZI.SURSA)?.text);
            aggregateBreakdown(companyStatsLocal.livr, "IMPLICARE", getCol(COLS.COMENZI.IMPLICARE)?.text);
            aggregateBreakdown(companyStatsLocal.livr, "CLIENT_PE", getCol(COLS.COMENZI.CLIENT_PE)?.text);
            aggregateBreakdown(companyStatsLocal.livr, "FURNIZ_PE", getCol(COLS.COMENZI.FURNIZ_PE)?.text);
            aggregateBreakdown(companyStatsLocal.livr, "CLIENT_FURNIZOR_PE", getCol(COLS.COMENZI.CLIENT_FURNIZOR_PE)?.text);
            aggregateBreakdown(companyStatsLocal.livr, "MOD_TRANSPORT", getCol(COLS.COMENZI.MOD_TRANSPORT)?.text);
            aggregateBreakdown(companyStatsLocal.livr, "TIP_MARFA", getCol(COLS.COMENZI.TIP_MARFA)?.text);
            aggregateBreakdown(companyStatsLocal.livr, "OCUPARE", getCol(COLS.COMENZI.OCUPARE)?.text);

            // --- EXISTING employee logic unchanged ---
            const profitToAddP = isRon ? (valPrincipal / EXCHANGE_RATE) : valPrincipal;
            const profitToAddS = isRon ? (valSecundar / EXCHANGE_RATE) : valSecundar;

            applyToAllStats((statsList) => {
                statsList.forEach(emp => {
                    const isPrincipal = principalIds.includes(String(emp.mondayId));
                    const isSecondary = secondaryIds.includes(String(emp.mondayId));

                    if (isPrincipal) {
                        emp.livr_principalCount++;
                        emp.livr_principalProfitEur += safeVal(profitToAddP);
                    }
                    if (isSecondary) {
                        emp.livr_secondaryCount++;
                        emp.livr_secondaryProfitEur += safeVal(profitToAddS);
                    }
                });
            });
        });
    }

    if (solicitari) {
        solicitari.items_page.items.forEach(item => {
            const getCol = (id) => item.column_values.find(c => c.id === id);
            
            const sursaVal = getCol(COLS.SOLICITARI.SURSA)?.text?.trim().toLowerCase() || "";
            if (sursaVal !== "website" && sursaVal !== "telefon / whatsapp fix") return;

            const colPrincipal = getCol(COLS.SOLICITARI.PRINCIPAL);
            let principalIds = getPersonIds(colPrincipal);

            applyToAllStats(statsList => {
                statsList.forEach(emp => {
                    if (principalIds.includes(String(emp.mondayId))) {
                        emp.solicitariCount++;
                    }
                });
            });
        });
    }

    if (furnizori) {
        const { furnDateCol, furnPersonCol } = dynamicCols;
        furnizori.items_page.items.forEach(item => {
            const getCol = (id) => item.column_values.find(c => c.id === id);
            const personVal = getCol(furnPersonCol);
            let personIds = getPersonIds(personVal);

            applyToAllStats(statsList => {
                statsList.forEach(emp => {
                    if (personIds.includes(String(emp.mondayId))) {
                        emp.suppliersAdded++;
                    }
                });
            });
        });
    }

    if (activities) {
        activities.forEach(act => {
            const userId = act.user_id || act.creator_id || act.user?.id; // ca fallback
            if (!userId) return;

            // MODIFICARE AICI: normalizare tip
            const type = (act.type || "").toLowerCase();

            applyToAllStats(statsList => {
                const emp = statsList.find(e => String(e.mondayId) === String(userId));
                if (emp) {
                    if (type.includes('email')) {
                        emp.emailsCount++;
                    }

                    if (
                        type === 'activity' ||
                        type.includes('call') ||
                        type.includes('phone') ||
                        type.includes('meeting')
                    ) {
                        emp.callsCount++;
                    }
                }
            });
        });
    }

    const processLeads = (boardData, type) => {
        if (!boardData) return;
        boardData.items_page.items.forEach(item => {
            const ownerVal = item.column_values.find(c => c.id === COLS.LEADS.OWNER);
            let ownerIds = getPersonIds(ownerVal);

            applyToAllStats(statsList => {
                statsList.forEach(emp => {
                    if (ownerIds.includes(String(emp.mondayId))) {
                        if (type === 'contact') emp.contactat++;
                        if (type === 'qualified') emp.calificat++;
                    }
                });
            });
        });
    };

    processLeads(leadsContact, 'contact');
    processLeads(leadsQualified, 'qualified');

    setOpsStats(opsStatsLocal);
    setSalesStats(salesStatsLocal);
    setMgmtStats(mgmtStatsLocal);
    setCompanyStats(companyStatsLocal);
};

    return (
        <div className="min-h-screen bg-slate-50 text-slate-900 font-sans p-6">
            <div className="max-w-[95%] mx-auto">
                <div className="mb-8 border-b border-slate-200 pb-6 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                    <div>
                        <h1 className="text-3xl font-bold text-slate-900 flex items-center gap-3">
                            <BarChart2 className="text-blue-600" />
                            Raportare Monday.com
                        </h1>
                        <p className="text-slate-500 mt-2 text-sm">
                            Generează tabele de activitate pentru Operațiuni și Vânzări.
                        </p>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                        <button onClick={handleExport} disabled={!opsStats.length && !salesStats.length && !mgmtStats.length} className="flex items-center gap-2 text-white bg-blue-600 hover:bg-blue-700 text-sm font-medium border px-4 py-2 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                            <Download className="w-4 h-4" /> Export Excel
                        </button>
                        <a href={DRIVE_FOLDER_LINK} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs text-slate-500 hover:text-blue-600 transition-colors">
                            <ExternalLink className="w-3 h-3" /> Încărcați manual raportul aici
                        </a>
                    </div>
                </div>

                <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 mb-8">
                    <div className="flex flex-col md:flex-row gap-4 items-end">
                        <div className="flex-1 min-w-[200px]">
                            <label className="block text-sm font-semibold text-slate-700 mb-2">Perioada Raport</label>
                            <select className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-lg outline-none cursor-pointer" value={selectedPeriod} onChange={(e) => setSelectedPeriod(e.target.value)}>
                                <option value="week">Săptămâna Trecută</option>
                                <option value="month">Luna Trecută</option>
                                <option value="year">Anul Trecut</option>
                                <option value="custom">Perioadă Personalizată...</option>
                            </select>
                        </div>
                        {selectedPeriod === 'custom' && (
                            <div className="flex gap-2 items-end animate-fade-in">
                                <input type="date" className="p-2.5 bg-slate-50 border border-slate-300 rounded-lg text-sm" value={customStart} onChange={(e) => setCustomStart(e.target.value)} />
                                <div className="pb-3 text-slate-400"><ArrowRight className="w-4 h-4" /></div>
                                <input type="date" className="p-2.5 bg-slate-50 border border-slate-300 rounded-lg text-sm" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} />
                            </div>
                        )}
                        <button onClick={handleGenerate} disabled={loading} className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2.5 px-6 rounded-lg transition-colors flex items-center justify-center gap-2">
                            {loading ? (statusMessage || 'Se procesează...') : 'Generează Rapoarte'} {!loading && <FileBarChart className="w-4 h-4" />}
                        </button>
                    </div>
                </div>

                {error && <div className="p-4 bg-red-50 text-red-800 rounded-lg mb-6 flex gap-2"><AlertCircle className="w-5 h-5" /> {error}</div>}

                <div className="space-y-12">
                    {mgmtStats.length > 0 && <div className="animate-fade-in"><ManagementTable data={mgmtStats} dateRange={dateRangeStr} /></div>}
                    {opsStats.length > 0 && <div className="animate-fade-in"><OperationalTable data={opsStats} dateRange={dateRangeStr} /></div>}
                    {salesStats.length > 0 && <div className="animate-fade-in"><SalesTable data={salesStats} dateRange={dateRangeStr} /></div>}
                    <div className="animate-fade-in"><CompanyTable stats={companyStats} /></div>
                </div>
            </div>
        </div>
    );
}