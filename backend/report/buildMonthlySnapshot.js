/**
 * Build monthly report snapshot (v1 schema) for one month.
 * Runs same fetch + buildReport as runReport; produces full v1 snapshot for GCS.
 */

import { fetchReportData } from './fetchData.js';
import { buildReport } from './buildReport.js';
import { computeTotals } from './runReport.js';
import { getWorkingDaysInPeriod } from '../lib/dateRanges.js';
import { ORG, MANAGERS } from '../config/org.js';

const TIMEZONE = 'Europe/Bucharest';
const SERVICE_NAME = 'cls-automated-reports';

function toDateString(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v.slice(0, 10);
  if (v instanceof Date && !isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

function buildActivitiesByItemId(activities) {
  const byItemId = {};
  if (!Array.isArray(activities)) return byItemId;
  for (const a of activities) {
    const id = a.item_id ?? a.itemId ?? a.id;
    if (id != null) {
      if (!byItemId[id]) byItemId[id] = [];
      byItemId[id].push(a);
    }
  }
  return byItemId;
}

/**
 * Build v1 snapshot for one month. Runs Monday fetch + buildReport; fills schema.
 * @param {{ month: string, startDate: string|Date, endDate: string|Date, refresh: boolean }} opts - month YYYY-MM, startDate/endDate ISO or Date
 * @returns {Promise<object>} Full snapshot (derived.meta, derived.reportSummary, derived.report for pipeline)
 */
export async function buildMonthlySnapshot(opts) {
  const { month, startDate, endDate, refresh } = opts;
  const dateFrom = toDateString(startDate);
  const dateTo = toDateString(endDate);

  console.log('[snapshot] build month=' + month + ' start');
  const t0 = Date.now();

  const rawData = await fetchReportData(dateFrom, dateTo);
  const { opsStats, salesStats, mgmtStats, companyStats } = buildReport(rawData);

  const reportSummary = {
    departments: {
      operational: computeTotals(opsStats),
      sales: computeTotals(salesStats),
      management: computeTotals(mgmtStats),
    },
    company: companyStats,
  };

  const runAt = new Date().toISOString();
  const label = `${dateFrom}..${dateTo}`;
  const workingDaysInPeriod = getWorkingDaysInPeriod(dateFrom, dateTo);
  if (workingDaysInPeriod <= 0) {
    throw new Error(`workingDaysInPeriod must be > 0 for ${dateFrom}..${dateTo}, got ${workingDaysInPeriod}`);
  }
  const meta = {
    jobType: 'monthly',
    periodStart: startDate,
    periodEnd: endDate,
    workingDaysInPeriod,
    label,
    timezone: TIMEZONE,
    runAt,
  };

  const report = { opsStats, salesStats, mgmtStats, companyStats };
  const durationMs = Date.now() - t0;

  const orders = rawData.comenziCtr?.items_page?.items ?? [];
  const leads = rawData.leadsContact?.items_page?.items ?? [];
  const suppliers = rawData.furnizori?.items_page?.items ?? [];

  const env = process.env.NODE_ENV;
  const sourceEnvironment = env === 'production' ? 'prod' : (env ? 'dev' : 'unknown');

  const snapshot = {
    schemaVersion: '1.0',
    kind: 'cls.monthlyReportSnapshot',
    period: {
      month,
      startDate: dateFrom,
      endDate: dateTo,
      timezone: TIMEZONE,
    },
    generatedAt: runAt,
    source: {
      projectId: process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || null,
      service: SERVICE_NAME,
      commitSha: process.env.COMMIT_SHA || process.env.GIT_SHA || null,
      environment: sourceEnvironment,
    },
    inputs: {
      monday: { apiBase: 'https://api.monday.com/v2' },
      options: { refresh: !!refresh, includeActivities: true },
    },
    stats: {
      durationMs,
      mondayRequests: 0,
      activitiesChunks: 0,
      items: {
        leads: leads.length,
        contacts: 0,
        orders: orders.length,
        suppliers: suppliers.length,
      },
    },
    people: {
      active: ORG.filter((p) => p.isActive).map((p) => ({
        personId: String(p.mondayUserId ?? p.email),
        name: p.name,
        email: p.email,
        department: p.department ?? null,
        managerEmail: MANAGERS.find((m) => m.department === p.department)?.email ?? null,
      })),
      managers: MANAGERS.filter((m) => m.isActive).map((m) => ({
        email: m.email,
        name: m.name,
        department: m.department ?? null,
      })),
    },
    raw: {
      columns: { COMENZI: [], FURNIZORI: [], CONTACTE: [], LEADS: [] },
      items: {
        orders: rawData.comenziCtr?.items_page?.items ?? [],
        leads: rawData.leadsContact?.items_page?.items ?? [],
        contacts: [],
        suppliers: rawData.furnizori?.items_page?.items ?? [],
      },
      activities: { byItemId: buildActivitiesByItemId(rawData.activities) },
    },
    derived: {
      meta,
      reportSummary,
      report,
      kpis: { company: {}, byPersonId: {} },
      tables: { xlsx: { sheets: [] } },
    },
    llm: {
      model: {
        provider: 'openrouter',
        name: (process.env.OPENROUTER_MODEL || '').trim() || 'anthropic/claude-opus-4.6',
        location: null,
      },
      employeeSummaries: {},
      departmentSummary: {},
    },
    artifacts: {
      xlsx: { gcsUri: null, sha256: null },
    },
  };

  console.log('[snapshot] build month=' + month + ' done durationMs=' + durationMs);
  return snapshot;
}
