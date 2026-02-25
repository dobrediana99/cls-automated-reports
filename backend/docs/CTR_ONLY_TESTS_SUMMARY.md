# Rezumat teste CTR-only + verificare Excel

## Teste adăugate/actualizate

| Fișier | Test nou | Scenariu |
|--------|----------|----------|
| `backend/email/buildEmployeeKpiBullets.test.js` | `CTR-only: when livr_* has large values, % target and profit ignore livr` | ctr=1000, livr=95000, target=10000 → realizare 10%, profit 1000 EUR |
| `backend/report/departmentAnalytics.test.js` | `CTR-only: pctTarget ignores livr_* when livr has large values` | ctr=500, livr=95000, target=1000 → pctTarget=0.5, totalProfitAll=500 |
| `backend/email/monthly.test.js` | `CTR-only: buildMonthlyEmployeeEmail shows profit and % target from CTR when livr_* is large` | Verifică că HTML conține 1000, 10%, 400, 8% |
| `backend/email/monthlyEmailHelpers.test.js` | (fișier nou) `CTR-only: when livr_* has large values, profit and % target use only CTR` | buildDeterministicPerformanceTable output |

## Verificare: fișiere Excel export NU au fost modificate

- **backend/export/weeklyReportWorkbook.js**: bonus = totalProfitEurLivr - target (LIVR), coloane CTR + LIVR separate
- **backend/export/xlsx.js**: delegare la weeklyReportWorkbook, fără logică profit

## Formule vechi vs noi

| Context | Formulă veche | Formulă nouă |
|---------|---------------|--------------|
| **Email: profit total** | totalProfitEur = ctr + livr | totalProfitCtr = ctr_principal + ctr_secondary |
| **Email: % target** | totalProfitEur / target × 100 | totalProfitCtr / target × 100 |
| **Email: getPerformancePct** | ctr + livr / target | ctr_principal + ctr_secondary / target |
| **departmentAnalytics: pctTarget** | totalProfitAll / target | totalProfitCtr / target |
| **departmentAnalytics: active** | totalTripsCtr > 0 \|\| totalProfitAll | totalTripsCtr > 0 \|\| totalProfitCtr |
| **Excel: bonus** | totalProfitEurLivr - target | (neschimbat) totalProfitEurLivr - target |
| **Excel: coloane** | CTR + LIVR separate | (neschimbat) |
