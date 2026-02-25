# Mini-audit: Regula STRICT profit KPI = DOAR CTR – pipeline email

**Data:** 2026-02-23  
**Scope:** Doar pipeline-ul de email. NU se modifică: export Excel, weeklyReportWorkbook.js, xlsx.js, App.jsx.

**Definiție:** profit KPI = ctr_principalProfitEur + ctr_secondaryProfitEur

## Fișiere atinse (commit email pipeline)

| Fișier | Modificare |
|--------|------------|
| `backend/utils/kpiCalc.js` | Adăugat `totalProfitCtr(row)` și `calcTargetAchievementPctCtr(row)` – doar CTR |
| `backend/email/buildEmployeeKpiBullets.js` | Folosește `totalProfitCtr`, `calcTargetAchievementPctCtr` |
| `backend/email/monthlyEmailHelpers.js` | Folosește `totalProfitCtr`, `calcTargetAchievementPctCtr` în `buildDeterministicPerformanceTable` |
| `backend/jobs/monthly.js` | `buildEmployeeInputCalculated`: profit/re realize din CTR; `getPerformancePct`: doar CTR |
| `backend/email/buildEmployeeKpiBullets.test.js` | Actualizat așteptări: 40% realizare (CTR-only) |
| `backend/jobs/monthly.test.js` | Actualizat așteptări buildEmployeeInputCalculated: profitTotalEur=10000, realizareTargetPct=40 |

## Fișiere NU modificate (conform cerinței)

- `backend/export/weeklyReportWorkbook.js`
- `backend/export/xlsx.js`
- `src/App.jsx`
