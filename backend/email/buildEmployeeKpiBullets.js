/**
 * Build deterministic KPI bullet lines for employee monthly email (sectiunea_1).
 * Used to overwrite LLM-generated content so "Nu pot determina…" never appears.
 * No prompt changes; pure post-processing.
 */

import {
  round2,
  totalProfitEur,
  calcTargetAchievementPct,
  calcCallsPerWorkingDay,
  calcProspectingConversionPct,
} from '../utils/kpiCalc.js';

/**
 * Build the 5 KPI bullet lines for one employee (current + previous month).
 * @param {object} cur - Current month row (data3Months.current)
 * @param {object} prev - Previous month row (data3Months.prev)
 * @param {number} workingDaysInPeriod - Working days in current period (must be > 0)
 * @param {{ periodStart: string, periodEnd: string }} meta - At least periodStart, periodEnd
 * @returns {string[]} Array of 5 lines (no "Nu pot determina…")
 */
export function buildEmployeeKpiBullets(cur, prev, workingDaysInPeriod, meta) {
  const targetPctCur = calcTargetAchievementPct(cur);
  const targetPctPrev = calcTargetAchievementPct(prev);
  const callsDayCur = calcCallsPerWorkingDay(cur?.callsCount, workingDaysInPeriod);
  const callsDayPrev = calcCallsPerWorkingDay(prev?.callsCount, workingDaysInPeriod);
  const convPctCur = calcProspectingConversionPct(cur?.contactat, cur?.calificat);
  const convPctPrev = calcProspectingConversionPct(prev?.contactat, prev?.calificat);
  const profitCur = round2(totalProfitEur(cur));
  const profitPrev = round2(totalProfitEur(prev));

  const periodStartStr = meta?.periodStart != null ? String(meta.periodStart).slice(0, 10) : '';
  const periodEndStr = meta?.periodEnd != null ? String(meta.periodEnd).slice(0, 10) : '';

  return [
    `Realizare target: ${targetPctCur != null ? `${targetPctCur}%` : 'N/A'} (luna anterioară: ${targetPctPrev != null ? `${targetPctPrev}%` : 'N/A'})`,
    `Profit total: ${profitCur != null ? `${profitCur} EUR` : 'N/A'} (luna anterioară: ${profitPrev != null ? `${profitPrev} EUR` : 'N/A'})`,
    `Apeluri medii/zi (lucrătoare): ${callsDayCur != null ? callsDayCur : 'N/A'} (luna anterioară: ${callsDayPrev != null ? callsDayPrev : 'N/A'})`,
    `Conversie prospectare (calificat/contactat): ${convPctCur != null ? `${convPctCur}%` : 'N/A'} (luna anterioară: ${convPctPrev != null ? `${convPctPrev}%` : 'N/A'})`,
    `Zile lucrătoare în perioadă: ${workingDaysInPeriod} (${periodStartStr}..${periodEndStr})`,
  ];
}

/**
 * Overwrite llmSections.sectiunea_1_tabel_date_performanta.continut with deterministic KPI bullets.
 * Ensures continut is an array of strings; never contains "Nu pot determina…".
 * @param {object} llmSections - Sections object from LLM (mutated in place)
 * @param {string[]} lines - From buildEmployeeKpiBullets
 */
export function applyEmployeeKpiOverwrite(llmSections, lines) {
  if (!llmSections || typeof llmSections !== 'object') return;
  const arr = Array.isArray(lines) ? lines : [];
  if (llmSections.sectiunea_1_tabel_date_performanta != null && typeof llmSections.sectiunea_1_tabel_date_performanta === 'object') {
    llmSections.sectiunea_1_tabel_date_performanta.continut = arr;
  } else {
    llmSections.sectiunea_1_tabel_date_performanta = { continut: arr };
  }
}
