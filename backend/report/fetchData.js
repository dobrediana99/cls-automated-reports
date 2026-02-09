import { mondayRequest } from '../monday/client.js';
import { BOARD_IDS, COLS } from './constants.js';

/**
 * Fetch column metadata for a board.
 */
export async function fetchColumns(boardId) {
  const query = `query {
    boards (ids: [${boardId}]) {
      columns { id title type }
    }
  }`;
  const data = await mondayRequest(query, undefined, 'columns');
  return data.boards?.[0]?.columns ?? [];
}

/**
 * Fetch items page with optional cursor and query_params (rules).
 */
export async function fetchAllItems(boardId, colIdsArray, rulesString = null) {
  const allItems = [];
  let cursor = null;
  let hasMore = true;
  const colsString = colIdsArray.map((c) => `"${c}"`).join(', ');

  while (hasMore) {
    let args = cursor ? `limit: 250, cursor: "${cursor}"` : 'limit: 250';
    if (!cursor && rulesString) args += `, query_params: { rules: ${rulesString} }`;

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

    const data = await mondayRequest(query, undefined, 'items_page');
    const page = data.boards?.[0]?.items_page;
    if (!page) break;

    allItems.push(...(page.items ?? []));
    cursor = page.cursor;
    if (!cursor) hasMore = false;
  }

  return { items_page: { items: allItems } };
}

/**
 * Lightweight directory fetch (single owner column).
 */
export async function fetchItemsDirectory(boardId, ownerColId, rulesString = null) {
  const allItems = [];
  let cursor = null;
  let hasMore = true;

  while (hasMore) {
    let args = cursor ? `limit: 500, cursor: "${cursor}"` : 'limit: 500';
    if (!cursor && rulesString) args += `, query_params: { rules: ${rulesString} }`;

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

    const data = await mondayRequest(query, undefined, 'items_page');
    const page = data.boards?.[0]?.items_page;
    if (page?.items) allItems.push(...page.items);
    cursor = page?.cursor;
    if (!cursor) hasMore = false;
  }

  return { items_page: { items: allItems } };
}

const ACTIVITIES_CHUNK_SIZE = 4;
const ACTIVITIES_CONCURRENCY = 3;
const ACTIVITIES_MIN_ATTEMPTS = 5;
const ACTIVITIES_INITIAL_BACKOFF_MS = 1000;

function isTransientError(err) {
  const code = err?.statusCode;
  if (code === 429 || code === 408 || (code >= 500 && code < 600)) return true;
  if (err?.cause?.code === 'ECONNRESET' || err?.cause?.code === 'ETIMEDOUT') return true;
  if (err?.name === 'TypeError' && (err?.message?.includes('fetch') || err?.message?.includes('network'))) return true;
  return false;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function jitter(baseMs) {
  return Math.floor(baseMs * (0.8 + Math.random() * 0.4));
}

function buildActivitiesQuery(chunk) {
  const queryBody = chunk
    .map(
      (id) => `
    t_${id}: timeline(id: ${id}) {
      timeline_items_page {
        timeline_items {
          type
          created_at
          user { id }
        }
      }
    }
  `
    )
    .join('\n');
  return `query { ${queryBody} }`;
}

/**
 * Validate chunk response: every requested itemId must have t_${id} with timeline_items_page.timeline_items (array).
 * Returns { ok: boolean, missing: number[] }.
 */
function validateChunkResponse(data, chunk) {
  if (!data || typeof data !== 'object') return { ok: false, missing: [...chunk] };
  const missing = chunk.filter((id) => {
    const items = data[`t_${id}`]?.timeline_items_page?.timeline_items;
    return !Array.isArray(items);
  });
  return { ok: missing.length === 0, missing };
}

/**
 * Fetch one chunk with retries. Throws on non-transient error or incomplete after retries.
 * On 403 or 400 (timeline): if chunk has more than one item, splits in half and recurses; if single item, skips and returns [].
 */
async function fetchActivitiesChunk(chunk, chunkIndex, mondayRequestFn, stats) {
  const query = buildActivitiesQuery(chunk);
  let lastError;
  for (let attempt = 1; attempt <= ACTIVITIES_MIN_ATTEMPTS; attempt++) {
    try {
      const sample = chunk.slice(0, 5);
      console.log('[timeline][chunk] op=timeline chunkIndex=' + chunkIndex + ' count=' + chunk.length + ' sample=' + JSON.stringify(sample));
      const data = await mondayRequestFn(query, undefined, 'timeline');
      const { ok, missing } = validateChunkResponse(data, chunk);
      if (!ok) {
        lastError = new Error(
          `fetchActivitiesForItems chunk ${chunkIndex}: incomplete response (itemIds: ${chunk.length}, missing: ${missing.length}, attempt ${attempt}/${ACTIVITIES_MIN_ATTEMPTS})`
        );
        lastError.missingIds = missing;
        lastError.chunkIndex = chunkIndex;
        lastError.attempt = attempt;
        if (attempt < ACTIVITIES_MIN_ATTEMPTS) {
          stats.retries++;
          const backoff = jitter(ACTIVITIES_INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1));
          if (process.env.NODE_ENV !== 'production') {
            console.log(`[fetchActivities] chunk ${chunkIndex} incomplete, missing ${missing.length} itemIds, retry ${attempt} in ${backoff}ms`);
          }
          await sleep(backoff);
          continue;
        }
        throw lastError;
      }
      const sortedIds = [...chunk].sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }));
      const activities = [];
      for (const id of sortedIds) {
        const items = data[`t_${id}`]?.timeline_items_page?.timeline_items ?? [];
        const sorted = [...items].sort((a, b) => {
          const ta = (a?.created_at && new Date(a.created_at).getTime()) || 0;
          const tb = (b?.created_at && new Date(b.created_at).getTime()) || 0;
          if (ta !== tb) return ta - tb;
          return String(a?.id ?? '').localeCompare(String(b?.id ?? ''), undefined, { numeric: true });
        });
        activities.push(...sorted);
      }
      return activities;
    } catch (err) {
      lastError = err;
      const is400 = err?.statusCode === 400;
      if (err?.statusCode === 403 || is400) {
        if (chunk.length > 1) {
          const mid = Math.ceil(chunk.length / 2);
          const left = await fetchActivitiesChunk(chunk.slice(0, mid), chunkIndex, mondayRequestFn, stats);
          const right = await fetchActivitiesChunk(chunk.slice(mid), chunkIndex, mondayRequestFn, stats);
          return [...left, ...right];
        }
        const bodyPreview = (err?.bodyPreview ?? err?.message ?? '').slice(0, 300);
        if (is400) {
          console.error('[timeline][skip-400] itemId=' + chunk[0] + ' chunkIndex=' + chunkIndex + ' bodyPreview=' + bodyPreview);
        } else {
          console.error('[timeline][skip-forbidden]', { chunkIndex, itemId: chunk[0] });
        }
        return [];
      }
      if (err.chunkIndex !== undefined && err.missingIds) throw err;
      if (!isTransientError(err) && err?.statusCode != null) {
        throw err;
      }
      if (attempt >= ACTIVITIES_MIN_ATTEMPTS) throw err;
      if (err?.statusCode === 429) stats.status429++;
      stats.retries++;
      let delayMs = jitter(ACTIVITIES_INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1));
      if (err?.statusCode === 429 && err?.retryAfter != null && err.retryAfter > 0) {
        delayMs = Math.max(delayMs, err.retryAfter * 1000);
      }
      if (process.env.NODE_ENV !== 'production') {
        console.log(`[fetchActivities] chunk ${chunkIndex} attempt ${attempt} failed (${err?.message}), retry in ${delayMs}ms`);
      }
      await sleep(delayMs);
    }
  }
  throw lastError;
}

/**
 * Run tasks with concurrency limit.
 */
async function runWithConcurrency(tasks, concurrency) {
  const results = [];
  let index = 0;
  async function worker() {
    while (index < tasks.length) {
      const i = index++;
      if (i >= tasks.length) break;
      results[i] = await tasks[i]();
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

/**
 * Fetch timeline activities for given item IDs (chunked). Enterprise-grade: no error swallowing,
 * retry with backoff, integrity validation, deterministic ordering. Fails fast on incomplete data.
 */
export async function fetchActivitiesForItems(itemIds, start, end) {
  const startWall = Date.now();
  const startTime = start.getTime();
  const endTime = end.getTime();
  const stats = { status429: 0, retries: 0 };

  const sortedIds = [...itemIds].sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }));
  const chunks = [];
  for (let i = 0; i < sortedIds.length; i += ACTIVITIES_CHUNK_SIZE) {
    chunks.push(sortedIds.slice(i, i + ACTIVITIES_CHUNK_SIZE));
  }

  if (sortedIds.length === 0) {
    if (process.env.NODE_ENV !== 'production') {
      console.log('[fetchActivities] total itemIds: 0, chunks: 0, activities: 0, 429: 0, retries: 0, ms: 0');
    }
    return [];
  }

  const tasks = chunks.map((chunk, chunkIndex) => () => fetchActivitiesChunk(chunk, chunkIndex, mondayRequest, stats));
  const chunkResults = await runWithConcurrency(tasks, ACTIVITIES_CONCURRENCY);
  const allActivities = chunkResults.flat();
  const filtered = allActivities.filter((item) => {
    const t = new Date(item?.created_at).getTime();
    return t >= startTime && t <= endTime;
  });

  const ms = Date.now() - startWall;
  if (process.env.NODE_ENV !== 'production') {
    console.log(
      `[fetchActivities] total itemIds: ${sortedIds.length}, chunks: ${chunks.length}, activities: ${filtered.length}, 429: ${stats.status429}, retries: ${stats.retries}, ms: ${ms}`
    );
  }

  return filtered;
}

/**
 * Fetch all report data for a date range. Returns same shape as frontend fetchMondayData raw fetches.
 * dateFrom/dateTo: YYYY-MM-DD strings.
 */
export async function fetchReportData(dateFrom, dateTo) {
  const start = new Date(dateFrom + 'T00:00:00');
  const end = new Date(dateTo + 'T23:59:59');

  const comenziCols = await fetchColumns(BOARD_IDS.COMENZI);
  const furnizoriCols = await fetchColumns(BOARD_IDS.FURNIZORI);
  const contacteCols = await fetchColumns(BOARD_IDS.CONTACTE);

  const findColId = (boardCols, searchTitle, defaultId) => {
    const c = boardCols.find(
      (col) =>
        col.title?.toLowerCase().trim() === searchTitle.toLowerCase().trim() ||
        col.title?.toLowerCase().includes(searchTitle.toLowerCase())
    );
    return c?.id ?? defaultId;
  };

  const furnDateCol = furnizoriCols.find((c) => c.type === 'date' || c.title?.toLowerCase().includes('data'))?.id ?? COLS.FURNIZORI.DATA;
  const furnPersonCol = furnizoriCols.find((c) => c.type === 'people' || /owner|persoana/.test(c.title?.toLowerCase() || ''))?.id ?? COLS.FURNIZORI.PERSON;

  const COLS_COMENZI = { ...COLS.COMENZI };
  COLS_COMENZI.SURSA = findColId(comenziCols, 'Sursa', COLS_COMENZI.SURSA);
  COLS_COMENZI.CRT = findColId(comenziCols, 'Crt', 'crt');
  COLS_COMENZI.DEP = findColId(comenziCols, 'Dep', 'dep');
  COLS_COMENZI.IMPLICARE = findColId(comenziCols, 'Implicare', 'implicare');
  COLS_COMENZI.CLIENT_FURNIZOR_PE = findColId(comenziCols, 'Client/Furnizor Pe', 'client_furnizor');
  COLS_COMENZI.MOD_TRANSPORT = findColId(comenziCols, 'Mod Transport', 'mod_transport');
  COLS_COMENZI.TIP_MARFA = findColId(comenziCols, 'Tip Marfa', 'tip_marfa');
  COLS_COMENZI.OCUPARE = findColId(comenziCols, 'Ocupare', 'ocupare');

  const rulesCtr = `[{ column_id: "${COLS_COMENZI.DATA_CTR}", operator: between, compare_value: ["${dateFrom}", "${dateTo}"] }]`;
  const rulesLivr = `[{ column_id: "${COLS_COMENZI.DATA_LIVRARE}", operator: between, compare_value: ["${dateFrom}", "${dateTo}"] }]`;
  const rulesSolicitari = `[{ column_id: "${COLS.SOLICITARI.DATA}", operator: between, compare_value: ["${dateFrom}", "${dateTo}"] }]`;
  const rulesFurnizori = `[{ column_id: "${furnDateCol}", operator: between, compare_value: ["${dateFrom}", "${dateTo}"] }]`;
  const rulesLeadsDate = `[{ column_id: "${COLS.LEADS.DATA}", operator: between, compare_value: ["${dateFrom}", "${dateTo}"] }]`;
  const rulesLeadsContact = `[{ column_id: "${COLS.LEADS.DATA}", operator: between, compare_value: ["${dateFrom}", "${dateTo}"] }, { column_id: "${COLS.LEADS.STATUS}", operator: any_of, compare_value: [14] }]`;
  const rulesLeadsQualified = `[{ column_id: "${COLS.LEADS.DATA}", operator: between, compare_value: ["${dateFrom}", "${dateTo}"] }, { column_id: "${COLS.LEADS.STATUS}", operator: any_of, compare_value: [103] }]`;

  const [comenziCtr, comenziLivr, solicitari, furnizori, leadsContact, leadsQualified] = await Promise.all([
    fetchAllItems(BOARD_IDS.COMENZI, Object.values(COLS_COMENZI), rulesCtr),
    fetchAllItems(BOARD_IDS.COMENZI, Object.values(COLS_COMENZI), rulesLivr),
    fetchAllItems(BOARD_IDS.SOLICITARI, Object.values(COLS.SOLICITARI), rulesSolicitari),
    fetchAllItems(BOARD_IDS.FURNIZORI, [furnDateCol, furnPersonCol], rulesFurnizori),
    fetchAllItems(BOARD_IDS.LEADS, Object.values(COLS.LEADS), rulesLeadsContact),
    fetchAllItems(BOARD_IDS.LEADS, Object.values(COLS.LEADS), rulesLeadsQualified),
  ]);

  const rawLeads = await fetchItemsDirectory(BOARD_IDS.LEADS, COLS.LEADS.OWNER, rulesLeadsDate);
  const rawContacts = await fetchItemsDirectory(BOARD_IDS.CONTACTE, COLS.CONTACTE.OWNER, `[{ column_id: "${COLS.CONTACTE.DATA}", operator: between, compare_value: ["${dateFrom}", "${dateTo}"] }]`);

  const allActivityItemIds = [...(rawLeads.items_page?.items ?? []), ...(rawContacts.items_page?.items ?? [])].map((i) => i.id);
  let activities = [];
  let activitiesError = null;
  if (allActivityItemIds.length > 0) {
    try {
      activities = await fetchActivitiesForItems(allActivityItemIds, start, end);
    } catch (err) {
      const chunks = Math.ceil(allActivityItemIds.length / ACTIVITIES_CHUNK_SIZE);
      const message = err?.message ?? String(err);
      console.error(
        '[timeline][fallback] continuing without activities message=' +
          message.slice(0, 200) +
          ' totalItemIds=' +
          allActivityItemIds.length +
          ' chunks=' +
          chunks
      );
      activities = [];
      activitiesError = { message: message.slice(0, 500), totalItemIds: allActivityItemIds.length, chunks };
    }
  }

  return {
    comenziCtr,
    comenziLivr,
    solicitari,
    leadsContact,
    leadsQualified,
    furnizori,
    activities,
    activitiesError,
    start,
    end,
    dynamicCols: { furnDateCol, furnPersonCol },
    COLS_COMENZI,
  };
}
