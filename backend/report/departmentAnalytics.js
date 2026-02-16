// Deterministic, auditabil analytics pe departament (Sales / Operațional) pentru raportul lunar.
// Primește rânduri per angajat + agregate pe lună și calculează:
// - headcount + medii pe angajați activi
// - high/low performers (top/bottom 1–2) pe baza KPI-urilor CTR
// - volatilitate (curent vs luna anterioară)
// - probleme individuale (sub-standard, zero burse, dezechilibru, termene etc.)
// - probleme sistemice (>50% din angajații activi cu aceeași problemă)

function safeNumber(v) {
  return typeof v === 'number' && !Number.isNaN(v) ? v : 0;
}

function computeEmployeeKpis(row) {
  const totalTripsCtr = safeNumber(row.ctr_principalCount) + safeNumber(row.ctr_secondaryCount);
  const totalProfitCtr = safeNumber(row.ctr_principalProfitEur) + safeNumber(row.ctr_secondaryProfitEur);
  const totalProfitAll =
    totalProfitCtr + safeNumber(row.livr_principalProfitEur) + safeNumber(row.livr_secondaryProfitEur);
  const target = safeNumber(row.target);
  const pctTarget = target > 0 ? totalProfitAll / target : null;
  const active = totalTripsCtr > 0 || totalProfitAll !== 0;
  const burseCount = safeNumber(row.burseCount);
  const burseCountCtrPrincipal = safeNumber(row.burseCountCtrPrincipal);
  const burseCountCtrSecondary = safeNumber(row.burseCountCtrSecondary);
  const burseCountLivrPrincipal = safeNumber(row.burseCountLivrPrincipal);
  const burseCountLivrSecondary = safeNumber(row.burseCountLivrSecondary);

  const profitPrincipalTotal =
    safeNumber(row.ctr_principalProfitEur) + safeNumber(row.livr_principalProfitEur);
  const profitSecondaryTotal =
    safeNumber(row.ctr_secondaryProfitEur) + safeNumber(row.livr_secondaryProfitEur);
  const profitPrincipalSecondaryTotal = profitPrincipalTotal + profitSecondaryTotal;
  const principalShare =
    profitPrincipalSecondaryTotal > 0 ? profitPrincipalTotal / profitPrincipalSecondaryTotal : null;

  const sumProfitability = safeNumber(row.sumProfitability);
  const countProfitability = safeNumber(row.countProfitability);
  const profitabilityPct = countProfitability > 0 ? sumProfitability / countProfitability : null;

  const avgClientTerm =
    safeNumber(row.countClientTerms) > 0 ? safeNumber(row.sumClientTerms) / safeNumber(row.countClientTerms) : null;

  return {
    totalTripsCtr,
    totalProfitCtr,
    totalProfitAll,
    target,
    pctTarget,
    active,
    burseCount,
    burseBreakdown: {
      burseCountCtrPrincipal,
      burseCountCtrSecondary,
      burseCountLivrPrincipal,
      burseCountLivrSecondary,
    },
    profitPrincipalTotal,
    profitSecondaryTotal,
    principalShare,
    profitabilityPct,
    avgClientTerm,
    overdueInvoicesCount: safeNumber(row.overdueInvoicesCount),
    supplierTermsUnder30: safeNumber(row.supplierTermsUnder30),
    supplierTermsOver30: safeNumber(row.supplierTermsOver30),
  };
}

function analyseEmployeeIssues(row, kpis, departmentKey) {
  const issues = [];
  const flags = {
    subTarget: false,
    zeroBurse: false,
    imbalancePrincipalSecondary: false,
  };

  if (!kpis.active) {
    issues.push('Nu există activitate (curse sau profit) în perioada curentă.');
    return { issues, flags };
  }

  if (kpis.target > 0 && kpis.pctTarget !== null && kpis.pctTarget < 0.8) {
    const pct = Math.round(kpis.pctTarget * 100);
    issues.push(`Sub 80% din target individual (${pct}% din target).`);
    flags.subTarget = true;
  }

  if (departmentKey === 'operational') {
    if (kpis.burseCount === 0) {
      issues.push(
        'ALERTĂ CRITICĂ: ZERO curse burse în luna curentă (0 implicări burse; ' +
          `CTR P=${kpis.burseBreakdown.burseCountCtrPrincipal}, ` +
          `CTR S=${kpis.burseBreakdown.burseCountCtrSecondary}, ` +
          `LIVR P=${kpis.burseBreakdown.burseCountLivrPrincipal}, ` +
          `LIVR S=${kpis.burseBreakdown.burseCountLivrSecondary}).`,
      );
      flags.zeroBurse = true;
    }

    if (kpis.principalShare !== null) {
      const sharePct = Math.round(kpis.principalShare * 100);
      if (kpis.principalShare > 0.7 || kpis.principalShare < 0.3) {
        issues.push(
          `Dezechilibru principal/secundar: ${sharePct}% din profit dintr-o singură parte (principal vs secundar).`,
        );
        flags.imbalancePrincipalSecondary = true;
      }
    }

    if (kpis.overdueInvoicesCount >= 3) {
      issues.push('≥3 facturi client întârziate >15 zile (problemă majoră de încasare).');
    }

    if (kpis.supplierTermsUnder30 > 3) {
      issues.push('>3 furnizori cu termen de plată <30 zile (risc de cashflow).');
    }

    if (kpis.avgClientTerm !== null && kpis.avgClientTerm > 45) {
      issues.push(`Termen mediu de plată client >45 zile (${Math.round(kpis.avgClientTerm)} zile).`);
    }
  }

  // Pentru Sales ținem minimul: doar sub-target + eventual alte praguri viitoare.

  if (issues.length === 0) {
    issues.push('Fără probleme majore identificate în funcție de pragurile definite.');
  }

  return { issues, flags };
}

function computeDepartmentHeadcountAndAverages(rows) {
  const totalEmployees = rows.length;
  const kpisList = rows.map((r) => computeEmployeeKpis(r));
  const activeKpis = kpisList.filter((k) => k.active);
  const activeEmployees = activeKpis.length;

  const sums = activeKpis.reduce(
    (acc, k) => {
      acc.totalTripsCtr += k.totalTripsCtr;
      acc.totalProfitCtr += k.totalProfitCtr;
      acc.totalProfitAll += k.totalProfitAll;
      acc.burseCount += k.burseCount;
      acc.sumProfitability += safeNumber(k.profitabilityPct);
      acc.countProfitability += k.profitabilityPct !== null ? 1 : 0;
      return acc;
    },
    { totalTripsCtr: 0, totalProfitCtr: 0, totalProfitAll: 0, burseCount: 0, sumProfitability: 0, countProfitability: 0 },
  );

  const averages =
    activeEmployees > 0
      ? {
          avgTripsCtr: sums.totalTripsCtr / activeEmployees,
          avgProfitCtr: sums.totalProfitCtr / activeEmployees,
          avgProfitAll: sums.totalProfitAll / activeEmployees,
          avgBurseCount: sums.burseCount / activeEmployees,
          avgProfitabilityPct:
            sums.countProfitability > 0 ? sums.sumProfitability / sums.countProfitability : null,
        }
      : {
          avgTripsCtr: 0,
          avgProfitCtr: 0,
          avgProfitAll: 0,
          avgBurseCount: 0,
          avgProfitabilityPct: null,
        };

  return { totalEmployees, activeEmployees, kpisList, averages };
}

function selectHighLowPerformers(rows, kpisList, averages) {
  const activeEntries = rows
    .map((row, idx) => ({ row, kpis: kpisList[idx] }))
    .filter((e) => e.kpis.active);

  if (activeEntries.length === 0) {
    return { highPerformers: [], lowPerformers: [] };
  }

  const { avgTripsCtr, avgProfitCtr } = averages;

  const isStrictHigh = (k) => {
    const condTrips = avgTripsCtr > 0 ? k.totalTripsCtr > avgTripsCtr * 1.3 : false;
    const condProfit = avgProfitCtr > 0 ? k.totalProfitCtr > avgProfitCtr * 1.3 : false;
    const condTarget = k.target > 0 && k.pctTarget !== null ? k.pctTarget >= 1.0 : true;
    return condTrips && condProfit && condTarget;
  };

  const isStrictLow = (k) => {
    const condTrips = avgTripsCtr > 0 ? k.totalTripsCtr < avgTripsCtr * 0.7 : false;
    const condProfit = avgProfitCtr > 0 ? k.totalProfitCtr < avgProfitCtr * 0.7 : false;
    const condTarget = k.target > 0 && k.pctTarget !== null ? k.pctTarget < 0.8 : false;
    return condTrips && condProfit && condTarget;
  };

  const strictHigh = activeEntries.filter((e) => isStrictHigh(e.kpis));
  const strictLow = activeEntries.filter((e) => isStrictLow(e.kpis));

  const buildEntry = (e) => ({
    name: e.row.name,
    id: e.row.id,
    totalTripsCtr: e.kpis.totalTripsCtr,
    totalProfitCtr: e.kpis.totalProfitCtr,
    totalProfitAll: e.kpis.totalProfitAll,
    pctTarget: e.kpis.pctTarget,
  });

  if (strictHigh.length > 0 && strictLow.length > 0) {
    return {
      highPerformers: strictHigh.slice(0, 2).map(buildEntry),
      lowPerformers: strictLow.slice(0, 2).map(buildEntry),
    };
  }

  const scoreForHigh = (k) => {
    let score = 0;
    let factors = 0;
    if (avgTripsCtr > 0) {
      score += k.totalTripsCtr / avgTripsCtr;
      factors++;
    }
    if (avgProfitCtr > 0) {
      score += k.totalProfitCtr / avgProfitCtr;
      factors++;
    }
    if (k.target > 0 && k.pctTarget !== null) {
      score += k.pctTarget;
      factors++;
    }
    return factors > 0 ? score / factors : 0;
  };

  const scoreForLow = (k) => {
    let penalties = 0;
    let factors = 0;
    if (avgTripsCtr > 0) {
      const ratio = k.totalTripsCtr / avgTripsCtr;
      penalties += 1 - Math.min(ratio, 1);
      factors++;
    }
    if (avgProfitCtr > 0) {
      const ratio = k.totalProfitCtr / avgProfitCtr;
      penalties += 1 - Math.min(ratio, 1);
      factors++;
    }
    if (k.target > 0 && k.pctTarget !== null) {
      const ratio = k.pctTarget;
      penalties += 1 - Math.min(ratio, 1);
      factors++;
    }
    return factors > 0 ? penalties / factors : 0;
  };

  const withScores = activeEntries.map((e) => ({
    ...e,
    highScore: scoreForHigh(e.kpis),
    lowScore: scoreForLow(e.kpis),
  }));

  const highSorted = [...withScores].sort((a, b) => b.highScore - a.highScore);
  const lowSorted = [...withScores].sort((a, b) => b.lowScore - a.lowScore);

  return {
    highPerformers: highSorted.slice(0, 2).map(buildEntry),
    lowPerformers: lowSorted.slice(0, 2).map(buildEntry),
  };
}

function computeVolatility(currentRows, prevRows) {
  const keyForRow = (r) =>
    r.mondayId != null && String(r.mondayId).trim() !== '' ? `m:${r.mondayId}` : `n:${r.name}`;

  const prevMap = new Map();
  prevRows.forEach((r) => {
    prevMap.set(keyForRow(r), r);
  });

  const results = [];

  for (const curr of currentRows) {
    const key = keyForRow(curr);
    const prev = prevMap.get(key);
    if (!prev) continue;

    const currKpis = computeEmployeeKpis(curr);
    const prevKpis = computeEmployeeKpis(prev);
    if (!currKpis.active && !prevKpis.active) continue;

    const pctDelta = (currVal, prevVal) => {
      if (prevVal === 0) return null;
      return (currVal - prevVal) / Math.abs(prevVal);
    };

    const deltaProfitCtrPct = pctDelta(currKpis.totalProfitCtr, prevKpis.totalProfitCtr);
    const deltaTripsCtrPct = pctDelta(currKpis.totalTripsCtr, prevKpis.totalTripsCtr);

    const maxAbsDelta = Math.max(
      deltaProfitCtrPct != null ? Math.abs(deltaProfitCtrPct) : 0,
      deltaTripsCtrPct != null ? Math.abs(deltaTripsCtrPct) : 0,
    );

    let level = null;
    if (maxAbsDelta > 0.5) level = 'mare';
    else if (maxAbsDelta >= 0.25) level = 'medie';

    if (!level) continue;

    results.push({
      name: curr.name,
      id: curr.id,
      totalProfitCtrCurrent: currKpis.totalProfitCtr,
      totalProfitCtrPrev: prevKpis.totalProfitCtr,
      totalTripsCtrCurrent: currKpis.totalTripsCtr,
      totalTripsCtrPrev: prevKpis.totalTripsCtr,
      deltaProfitCtrPct,
      deltaTripsCtrPct,
      level,
    });
  }

  return results;
}

function computeSystemicIssues(perEmployeeFlags, activeEmployees, departmentKey) {
  const issues = [];
  if (activeEmployees === 0) return issues;

  const countWhere = (pred) => perEmployeeFlags.filter(pred).length;

  const zeroBurseCount = countWhere((f) => f.zeroBurse);
  const subTargetCount = countWhere((f) => f.subTarget);
  const imbalanceCount = countWhere((f) => f.imbalancePrincipalSecondary);

  const pushIfSystemic = (code, label, affectedCount) => {
    const pct = affectedCount / activeEmployees;
    if (pct > 0.5) {
      issues.push({
        code,
        issue: label,
        affectedCount,
        activeCount: activeEmployees,
        affectedPct: pct,
      });
    }
  };

  if (departmentKey === 'operational') {
    pushIfSystemic(
      'zero_burse_operational',
      'Peste 50% din angajații activi Operațional au ZERO curse burse în luna curentă.',
      zeroBurseCount,
    );
    pushIfSystemic(
      'imbalance_principal_secondary_operational',
      'Peste 50% din angajații activi Operațional au dezechilibru principal/secundar (>70% dintr-o singură parte).',
      imbalanceCount,
    );
  }

  pushIfSystemic(
    `sub_target_${departmentKey}`,
    `Peste 50% din angajații activi ${departmentKey} sunt sub 80% din target.`,
    subTargetCount,
  );

  return issues;
}

function buildDepartmentAnalyticsForKey({ departmentKey, currentRows, prevRows }) {
  const rows = currentRows || [];
  const { totalEmployees, activeEmployees, kpisList, averages } =
    computeDepartmentHeadcountAndAverages(rows);

  const employeeIssues = [];
  const perEmployeeFlags = [];
  rows.forEach((row, idx) => {
    const kpis = kpisList[idx];
    const { issues, flags } = analyseEmployeeIssues(row, kpis, departmentKey);
    employeeIssues.push({
      id: row.id,
      name: row.name,
      mondayId: row.mondayId,
      active: kpis.active,
      kpis: {
        totalTripsCtr: kpis.totalTripsCtr,
        totalProfitCtr: kpis.totalProfitCtr,
        totalProfitAll: kpis.totalProfitAll,
        target: kpis.target,
        pctTarget: kpis.pctTarget,
        burseCount: kpis.burseCount,
        burseBreakdown: kpis.burseBreakdown,
        principalShare: kpis.principalShare,
        profitabilityPct: kpis.profitabilityPct,
        avgClientTerm: kpis.avgClientTerm,
        overdueInvoicesCount: kpis.overdueInvoicesCount,
        supplierTermsUnder30: kpis.supplierTermsUnder30,
        supplierTermsOver30: kpis.supplierTermsOver30,
      },
      issues,
    });
    if (kpis.active) {
      perEmployeeFlags.push(flags);
    }
  });

  const volatility = computeVolatility(rows, prevRows || []);
  const { highPerformers, lowPerformers } = selectHighLowPerformers(rows, kpisList, averages);
  const systemicIssues = computeSystemicIssues(perEmployeeFlags, activeEmployees, departmentKey);

  return {
    headcount: { totalEmployees, activeEmployees },
    averages,
    highPerformers,
    lowPerformers,
    volatility,
    employeeIssues,
    systemicIssues,
  };
}

/**
 * Build department analytics using ONLY 2 months: current and prev1.
 * Semnătura acceptă doar { current, prev1, periodStart }. Toate metricile (volatilitate,
 * high/low performers, employeeIssues, systemicIssues, medii, headcount) se bazează strict pe current vs prev1.
 * Dacă un apelant trimite prev2, acesta este ignorat (compatibilitate).
 */
export function buildDepartmentAnalytics({ current, prev1, periodStart }) {
  const currentRows = current?.rows || {};
  const prev1Rows = prev1?.rows || {};

  return {
    meta: {
      periodStart,
    },
    sales: buildDepartmentAnalyticsForKey({
      departmentKey: 'sales',
      currentRows: currentRows.sales || [],
      prevRows: prev1Rows.sales || [],
    }),
    operational: buildDepartmentAnalyticsForKey({
      departmentKey: 'operational',
      currentRows: currentRows.operational || [],
      prevRows: prev1Rows.operational || [],
    }),
  };
}

export function validateDepartmentAnalytics(analytics) {
  const errors = [];
  const warnings = [];

  if (!analytics || typeof analytics !== 'object') {
    errors.push('analytics object is missing or not an object.');
    return { ok: false, errors, warnings };
  }

  const requiredKeys = ['sales', 'operational'];
  for (const key of requiredKeys) {
    if (!analytics[key]) {
      errors.push(`analytics.${key} is missing.`);
      continue;
    }
    const dept = analytics[key];
    if (!dept.headcount || typeof dept.headcount.totalEmployees !== 'number') {
      errors.push(`analytics.${key}.headcount.totalEmployees missing or not a number.`);
    }
    if (!dept.headcount || typeof dept.headcount.activeEmployees !== 'number') {
      errors.push(`analytics.${key}.headcount.activeEmployees missing or not a number.`);
    }
    ['averages', 'highPerformers', 'lowPerformers', 'volatility', 'employeeIssues', 'systemicIssues'].forEach(
      (field) => {
        if (dept[field] == null) {
          errors.push(`analytics.${key}.${field} is missing.`);
        }
      },
    );

    if (dept.headcount && dept.headcount.activeEmployees === 0) {
      warnings.push(
        `analytics.${key}: activeEmployees === 0 – raportul trebuie să menționeze explicit lipsa datelor pentru ranking.`,
      );
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}