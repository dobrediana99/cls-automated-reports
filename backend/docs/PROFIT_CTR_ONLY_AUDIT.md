# Audit: Regula „Peste tot se folosește DOAR profit CTR (contracte)”

**Data auditului:** 2025-02-23  
**Regula:** Pentru toate calculele de performanță (target achievement, performancePct, high/low performers, bonus, profit mediu etc.) se folosește EXCLUSIV profit CTR (contracte), nu profit LIVR (livrare).

**Definiție oficială:**
```
CTR = ctr_principalProfitEur + ctr_secondaryProfitEur
```

**Ce NU se mai folosește în KPI de performanță:**
- `livr_principalProfitEur`
- `livr_secondaryProfitEur`
- `totalProfitAll` = CTR + LIVR
- orice formulă care include profit LIVR în evaluarea performanței

---

## Tabel de inventariere

| Fișier | Funcție / Loc | Formula actuală | Formula dorită (CTR-only) | Risc | Prioritate |
|--------|---------------|-----------------|---------------------------|------|------------|
| `backend/utils/kpiCalc.js` | `totalProfitEur(row)` | `ctr_principal + ctr_secondary + livr_principal + livr_secondary` | `ctr_principalProfitEur + ctr_secondaryProfitEur` | **CRITIC** – sursă unică pentru realizare target angajat | **P0** |
| `backend/utils/kpiCalc.js` | `calcTargetAchievementPct(row)` | `totalProfitEur(row) / target * 100` | Folosește `totalProfitCtr(row)` (nou) în loc de `totalProfitEur` | **CRITIC** – determină % realizare target angajat | **P0** |
| `backend/utils/kpiCalc.js` | `calcTargetAchievementCombined(departments)` | `(salesProfit + opsProfit) / totalTarget * 100` – profitTotal vine din `runReport` = CTR+LIVR+website | Necesită `profitTotal` CTR-only la nivel departament; modificare upstream în `runReport.computeTotals` | **CRITIC** – realizare target combinat | **P0** |
| `backend/utils/kpiCalc.js` | `calcTargetAchievementWithManagement(departments)` | Idem – folosește `profitTotal` per departament | Idem – `profitTotal` trebuie să fie CTR-only | **CRITIC** | **P0** |
| `backend/report/departmentAnalytics.js` | `computeEmployeeKpis()` | `totalProfitAll = totalProfitCtr + livr_principal + livr_secondary` | Elimina `totalProfitAll`; folosește doar `totalProfitCtr` pentru pctTarget, active | **CRITIC** | **P0** |
| `backend/report/departmentAnalytics.js` | `computeEmployeeKpis()` | `pctTarget = totalProfitAll / target` | `pctTarget = totalProfitCtr / target` | **CRITIC** – sub-target 80% se bazează pe acest calcul | **P0** |
| `backend/report/departmentAnalytics.js` | `computeEmployeeKpis()` | `active = totalTripsCtr > 0 \|\| totalProfitAll !== 0` | `active = totalTripsCtr > 0 \|\| totalProfitCtr !== 0` | Mediu | **P1** |
| `backend/report/departmentAnalytics.js` | `computeEmployeeKpis()` | `principalShare = profitPrincipalTotal / profitPrincipalSecondaryTotal` unde ambele includ LIVR | `principalShare` trebuie calculat pe baza CTR-only: `(ctr_principalProfit + livr_principalProfit) vs (ctr_secondaryProfit + livr_secondaryProfit)` – **atenție:** aceasta e raport Principal vs Secundar, nu CTR vs LIVR. Conform auditului, dacă regula e strict CTR: Principal = ctr_principal, Secundar = ctr_secondary. De verificat business. | Mediu – dezechilibru Principal/Secundar e KPI Operațional | **P1** |
| `backend/report/departmentAnalytics.js` | `computeDepartmentHeadcountAndAverages()` | `avgProfitAll`, `totalProfitAll` în sums | Înlocui cu `avgProfitCtr`, elimina `totalProfitAll` din medii KPI | Mediu | **P1** |
| `backend/report/departmentAnalytics.js` | `selectHighLowPerformers()` | Folosește `avgProfitCtr`, `totalProfitCtr` pentru condiții – **OK** | Deja CTR pentru profit în condiții; dar `pctTarget` vine din totalProfitAll | `pctTarget` trebuie CTR (din fix anterior) | **P0** |
| `backend/report/departmentAnalytics.js` | `buildEntry()` | Expune `totalProfitAll`, `pctTarget` | `totalProfitCtr`, `pctTarget` (CTR) | Mediu – expunere în output | **P1** |
| `backend/jobs/monthly.js` | `buildEmployeeInputCalculated()` | `profitTotalEur: totalProfitEur(cur)` | `profitTotalEur: totalProfitCtr(cur)` (nou helper) | **CRITIC** – input LLM angajat | **P0** |
| `backend/jobs/monthly.js` | `buildEmployeeInputCalculated()` | `realizareTargetPct: calcTargetAchievementPct(cur)` | După fix kpiCalc, va fi automat CTR | Depinde de kpiCalc | **P0** |
| `backend/jobs/monthly.js` | `getPerformancePct(monthData)` | `totalProfit = ctr_principal + ctr_secondary + livr_principal + livr_secondary` | `totalProfit = ctr_principal + ctr_secondary` | **CRITIC** – regula check-in sectiunea_6 (<80%) | **P0** |
| `backend/email/buildEmployeeKpiBullets.js` | `buildEmployeeKpiBullets()` | `totalProfitEur(cur)`, `calcTargetAchievementPct(cur)` | După fix kpiCalc – automat CTR | Depinde de kpiCalc | **P0** |
| `backend/email/monthlyEmailHelpers.js` | `buildDeterministicPerformanceTable()` | `totalProfitEur(cur)`, `calcTargetAchievementPct(cur)` | După fix kpiCalc | Depinde de kpiCalc | **P0** |
| `backend/report/runReport.js` | `computeTotals()` | `profitTotal = ctr_principal + ctr_secondary + livr_principal + livr_secondary + websiteProfit + websiteProfitSec` | Pentru KPI departament: opțiune A) câmp nou `profitTotalCtr`; B) `profitTotal` = doar CTR (breaking change). Recomandare: adăugare `profitTotalCtr` și utilizare în calcule realizare target. | **CRITIC** – rawSummaries.departments.profitTotal alimentează LLM și kpiCalc | **P0** |
| `backend/export/weeklyReportWorkbook.js` | `addDepartmentTable()` per row | `bonus = totalProfitEurLivr - target` | `bonus = totalProfitEurCtr - target` | **CRITIC** – coloana "PROFIT PESTE TARGET" | **P0** |
| `backend/export/weeklyReportWorkbook.js` | `writeFooterRow()` | `bonusTotal = totalLivrProfit - totals.targetTotal` | `bonusTotal = totalCtrProfit - totals.targetTotal` | **CRITIC** – total și medie bonus | **P0** |
| `src/App.jsx` | `OperationalRowCells` | `bonus = totalProfitEurLivr - target` | `bonus = totalProfitEurCtr - target` | **CRITIC** – UI raport | **P0** |
| `src/App.jsx` | `TableFooter` | `bonusTotal = totalLivrProfit - targetTotal` | `bonusTotal = totalCtrProfit - targetTotal` | **CRITIC** – TOTAL și MEDIA | **P0** |
| `backend/prompts/monthlyDepartmentPrompt.md` | Referințe `profitTotal` | `rawSummaries.departments.*.profitTotal` – provine din runReport (CTR+LIVR) | Promptul trebuie să precizeze: profitTotal = doar CTR (contracte). Sau schimbăm sursa datelor. | Mediu – LLM primește ce e în JSON | **P1** |
| `backend/prompts/monthlyEmployeePrompt.md` | Referințe Total Profit | "Total Profit" în tabel – nu specifică CTR vs LIVR | Adăugare regulă: "Profitul folosit pentru target și performanță este exclusiv din contracte (CTR), nu din livrări." | Scăzut – datele vin din calculated | **P2** |

---

## Fișiere care NU necesită modificare (sau doar documentație)

| Fișier | Motiv |
|--------|-------|
| `backend/report/buildReport.js` | Agregă date brute (ctr_*, livr_*). Nu face calcule de performanță. |
| `backend/email/templates/weeklyEmployeeDetails.js` | Afișează componente separate (livr_principal, livr_secondary etc.). Nu calculează KPI performanță. |
| `backend/report/runReport.js` – `companyStats` | Stats companie (CTR vs LIVR) sunt separate; nu intră în KPI performanță. Pot rămâne ca atare. |
| `CompanyTable` în App.jsx | Afișează stats.ctr.profit vs stats.livr.profit – corect, informative. |
| `addCompanyTable` în weeklyReportWorkbook.js | Idem – CTR vs LIVR ca coloane separate. |

---

## Observații suplimentare

### principalShare (departmentAnalytics)
`principalShare` = raport Principal vs Secundar la profit. Actual: include LIVR (profitPrincipalTotal = ctr_principal + livr_principal, idem secundar). Regula CTR-only sugerează: `principalShare = ctr_principalProfit / (ctr_principalProfit + ctr_secondaryProfit)` când numitorul > 0. **De confirmat cu business** dacă dezechilibrul Principal/Secundar trebuie evaluat doar pe CTR.

### rawSummaries.company
Promptul menționează `rawSummaries.current.company.profitTotal`. Compania are structură `ctr` și `livr` separate. Dacă "realizare target companie" trebuie CTR-only, atunci `profitTotalCompanie` pentru această formulă trebuie să fie `company.ctr.profit`, nu suma globală.

### Teste
Toate testele care validează `totalProfitEur`, `calcTargetAchievementPct`, `buildEmployeeInputCalculated`, `buildEmployeeKpiBullets`, `departmentAnalytics` și `weeklyReportWorkbook` vor trebui actualizate cu valorile așteptate CTR-only.

---

## Confirmare explicită

**CTR = ctr_principalProfitEur + ctr_secondaryProfitEur**

Această formulă trebuie folosită peste tot pentru:
- realizare target angajat (%Tgt)
- performancePct (check-in rule)
- highPerformers / lowPerformers (pctTarget și comparații profit)
- bonus / profit peste target
- profit mediu în comparații
- realizare target departament/companie (când aplicabil)

---

## Prioritate de implementare (sugestie)

1. **P0 (blocant):** `kpiCalc.js` – `totalProfitCtr`, actualizare `calcTargetAchievementPct`, eventual `totalProfitEur` deprecat sau redenumit.
2. **P0:** `runReport.js` – `profitTotalCtr` sau schimbare semnificație `profitTotal` pentru departments.
3. **P0:** `monthly.js` – `getPerformancePct` și `buildEmployeeInputCalculated`.
4. **P0:** `departmentAnalytics.js` – `computeEmployeeKpis` (totalProfitAll → totalProfitCtr, pctTarget).
5. **P0:** `weeklyReportWorkbook.js` și `App.jsx` – bonus = CTR - target.
6. **P1:** `departmentAnalytics.js` – avgProfitAll, principalShare, buildEntry.
7. **P1:** Prompturi – clarificare CTR-only.
8. **P2:** Teste și documentație.
