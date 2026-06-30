/**
 * CRM report client. Replaces the Monday.com data source: instead of fetching
 * raw board items and computing KPIs locally, we call the CRM endpoint which
 * runs the (single source of truth) buildPerformanceReport over the CRM boards
 * and returns the already-computed per-employee + company stats.
 *
 * Endpoint contract (CRM: app/api/reports/performance/route.ts):
 *   GET {CRM_REPORTS_URL}?from=YYYY-MM-DD&to=YYYY-MM-DD&label=...
 *   Authorization: Bearer {CRM_REPORTS_SECRET}
 *   -> 200 PerformanceReportResult
 *      { periodStart, periodEnd, label, workingDays, generatedAt,
 *        mgmtStats[], opsStats[], salesStats[], companyStats }
 */

const DEFAULT_TIMEOUT_MS = 120000;
const DEFAULT_MAX_ATTEMPTS = 3;

function envInt(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

function requireCrmConfig() {
  const url = process.env.CRM_REPORTS_URL?.trim();
  const secret = process.env.CRM_REPORTS_SECRET?.trim();
  if (!url) throw new Error('CRM_REPORTS_URL must be set to fetch CRM report data');
  if (!secret) throw new Error('CRM_REPORTS_SECRET must be set to authenticate with the CRM report endpoint');
  return { url, secret };
}

const STATS_KEYS = ['opsStats', 'salesStats', 'mgmtStats'];

function ensureArray(report, key) {
  const v = report?.[key];
  if (!Array.isArray(v)) {
    throw new Error(`CRM report missing array field "${key}"`);
  }
  return v;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Fetch the computed performance report from the CRM for a date range.
 * @param {{ dateFrom: string, dateTo: string, label?: string }} opts - dateFrom/dateTo as YYYY-MM-DD
 * @returns {Promise<{ opsStats: object[], salesStats: object[], mgmtStats: object[], companyStats: object, workingDays?: number }>}
 */
export async function fetchCrmReport({ dateFrom, dateTo, label }) {
  const { url, secret } = requireCrmConfig();
  const timeoutMs = envInt('CRM_REPORTS_TIMEOUT_MS', DEFAULT_TIMEOUT_MS);
  const maxAttempts = Math.max(1, envInt('CRM_REPORTS_MAX_ATTEMPTS', DEFAULT_MAX_ATTEMPTS));

  const endpoint = new URL(url);
  endpoint.searchParams.set('from', dateFrom);
  endpoint.searchParams.set('to', dateTo);
  if (label) endpoint.searchParams.set('label', label);

  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(endpoint, {
        method: 'GET',
        headers: { authorization: `Bearer ${secret}` },
        signal: controller.signal,
      });
      const text = await res.text();
      if (!res.ok) {
        throw new Error(`CRM report endpoint ${res.status}: ${text.slice(0, 300)}`);
      }
      let report;
      try {
        report = JSON.parse(text);
      } catch {
        throw new Error(`CRM report endpoint returned invalid JSON: ${text.slice(0, 200)}`);
      }

      const result = {
        companyStats: report?.companyStats ?? null,
        workingDays: report?.workingDays,
      };
      for (const key of STATS_KEYS) {
        result[key] = ensureArray(report, key);
      }
      if (!result.companyStats) {
        throw new Error('CRM report missing companyStats');
      }
      return result;
    } catch (err) {
      lastError = err;
      const transient = err?.name === 'AbortError' || /\b(429|5\d\d)\b/.test(String(err?.message ?? ''));
      if (!transient || attempt >= maxAttempts) break;
      const waitMs = Math.min(2000 * Math.pow(2, attempt - 1), 15000);
      console.warn(
        `[crmClient][retry] attempt=${attempt}/${maxAttempts} from=${dateFrom} to=${dateTo} waitMs=${waitMs} reason=${String(err?.message ?? err).slice(0, 180)}`,
      );
      await sleep(waitMs);
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`[crmClient] failed to fetch CRM report for ${dateFrom}..${dateTo}: ${String(lastError?.message ?? lastError)}`);
}
