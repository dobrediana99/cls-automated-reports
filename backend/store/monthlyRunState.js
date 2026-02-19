/**
 * Persistent run-state store for monthly job (checkpointing).
 * Keyed by jobType "monthly" + label (e.g. metas[0].label).
 * GCS when SNAPSHOT_BUCKET is set; else local backend/state/monthly_runs/.
 *
 * @typedef {{ status: string, attempts?: number, error?: string, completedAt?: string }} StageStatus
 * @typedef {{ llm: StageStatus, send: StageStatus, llmSections?: object }} DepartmentStage
 * @typedef {{ llm: StageStatus, send: StageStatus, name: string, llmSections?: object }} EmployeeStage
 * @typedef {{
 *   version: number,
 *   jobType: string,
 *   label: string,
 *   periodStart: string,
 *   periodEnd: string,
 *   createdAt: string,
 *   updatedAt: string,
 *   stages: { collect: StageStatus & { completedAt?: string }, department: DepartmentStage, employees: Record<string, EmployeeStage> },
 *   completed: boolean
 * }} MonthlyRunState
 */

import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
import { Storage } from '@google-cloud/storage';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCAL_STATE_DIR = path.join(__dirname, '..', 'state', 'monthly_runs');
const STATE_PREFIX_GCS = 'monthly_runs/state';
const WRITE_MAX_ATTEMPTS = 4;
const WRITE_INITIAL_BACKOFF_MS = 1000;

export const RUN_STATE_VERSION = 1;

/** Error codes for run-state load failures (fail-closed semantics). */
export const RUN_STATE_CORRUPT = 'RUN_STATE_CORRUPT';
export const RUN_STATE_UNAVAILABLE = 'RUN_STATE_UNAVAILABLE';

/**
 * Thrown when run-state load fails for a non-miss reason (parse/schema or IO).
 * @param {string} code - RUN_STATE_CORRUPT or RUN_STATE_UNAVAILABLE
 * @param {string} message
 * @param {Error} [cause]
 */
export function RunStateLoadError(code, message, cause) {
  const err = new Error(message);
  err.name = 'RunStateLoadError';
  err.code = code;
  if (cause) err.cause = cause;
  return err;
}

function getBucket() {
  return (process.env.SNAPSHOT_BUCKET || '').trim();
}

function useGcs() {
  return getBucket().length > 0;
}

function safeLabel(label) {
  return String(label ?? '').replace(/[/\\?*:]/g, '_');
}

function stateObjectName(label) {
  return `${STATE_PREFIX_GCS}/monthly-${safeLabel(label)}.json`;
}

function localStatePath(label) {
  return path.join(LOCAL_STATE_DIR, `monthly-${safeLabel(label)}.json`);
}

function ensureLocalStateDir() {
  if (!fs.existsSync(LOCAL_STATE_DIR)) {
    fs.mkdirSync(LOCAL_STATE_DIR, { recursive: true });
  }
}

function isRetryableGcsError(err) {
  const code = err?.code ?? err?.status;
  if (code === 429 || (typeof code === 'number' && code >= 500 && code < 600)) return true;
  const msg = String(err?.message ?? '');
  if (/ECONNRESET|ETIMEDOUT|timeout|UNAVAILABLE|DEADLINE_EXCEEDED/i.test(msg)) return true;
  return false;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function defaultStage(status = 'pending') {
  return { status, attempts: 0 };
}

/**
 * Create initial run state for a label.
 * @param {{ label: string, periodStart: string, periodEnd: string }} opts
 * @returns {MonthlyRunState}
 */
export function createInitialState(opts) {
  const { label, periodStart, periodEnd } = opts;
  const now = new Date().toISOString();
  return {
    version: RUN_STATE_VERSION,
    jobType: 'monthly',
    label: String(label),
    periodStart: String(periodStart),
    periodEnd: String(periodEnd),
    createdAt: now,
    updatedAt: now,
    stages: {
      collect: { ...defaultStage(), status: 'pending' },
      department: {
        llm: { ...defaultStage() },
        send: { ...defaultStage() },
      },
      employees: {},
    },
    completed: false,
  };
}

/**
 * Minimal validation for loaded state.
 * @param {unknown} doc
 * @param {string} label
 * @returns {doc is MonthlyRunState}
 */
export function isValidRunState(doc, label) {
  if (!doc || typeof doc !== 'object') return false;
  const d = /** @type {Record<string, unknown>} */ (doc);
  if (d.version !== RUN_STATE_VERSION || d.jobType !== 'monthly') return false;
  if (String(d.label) !== String(label)) return false;
  if (!d.stages || typeof d.stages !== 'object') return false;
  const stages = /** @type {Record<string, unknown>} */ (d.stages);
  if (!stages.collect || !stages.department || !stages.employees) return false;
  return true;
}

function errorSnippet(err, maxLen = 200) {
  const msg = err?.message ?? String(err ?? '');
  if (msg.length <= maxLen) return msg;
  return msg.slice(0, maxLen) + '…';
}

/**
 * Load run state from GCS or local file.
 * Returns null only on true MISS (GCS 404 / local ENOENT).
 * Throws RunStateLoadError with RUN_STATE_CORRUPT (parse/schema) or RUN_STATE_UNAVAILABLE (other read failure).
 * @param {string} label - Period label (e.g. metas[0].label)
 * @returns {Promise<MonthlyRunState | null>}
 */
export async function loadMonthlyRunState(label) {
  const safeLabelForLog = safeLabel(label);

  if (useGcs()) {
    try {
      const bucketName = getBucket();
      const storage = new Storage();
      const file = storage.bucket(bucketName).file(stateObjectName(label));
      const [contents] = await file.download();
      let doc;
      try {
        doc = JSON.parse(contents.toString('utf8'));
      } catch (parseErr) {
        console.error('[monthly][run-state] load label=' + safeLabelForLog + ' classification=corrupt (invalid JSON)');
        throw RunStateLoadError(
          RUN_STATE_CORRUPT,
          'Run-state invalid JSON for label ' + safeLabelForLog,
          parseErr
        );
      }
      if (!isValidRunState(doc, label)) {
        console.error('[monthly][run-state] load label=' + safeLabelForLog + ' classification=corrupt (invalid schema)');
        throw RunStateLoadError(RUN_STATE_CORRUPT, 'Run-state invalid schema for label ' + safeLabelForLog);
      }
      console.log('[monthly][resume] state loaded from GCS', { label: safeLabelForLog });
      return /** @type {MonthlyRunState} */ (doc);
    } catch (err) {
      if (err?.code === RUN_STATE_CORRUPT || err?.code === RUN_STATE_UNAVAILABLE) throw err;
      const isMiss = err?.code === 404 || err?.status === 404;
      if (isMiss) {
        console.log('[monthly][run-state] load label=' + safeLabelForLog + ' miss');
        return null;
      }
      console.error('[monthly][run-state] load label=' + safeLabelForLog + ' classification=unavailable', err?.message ?? err);
      throw RunStateLoadError(
        RUN_STATE_UNAVAILABLE,
        'Run-state read failed for label ' + safeLabelForLog + ': ' + (err?.message ?? String(err)),
        err
      );
    }
  }

  ensureLocalStateDir();
  const filePath = localStatePath(label);
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    let doc;
    try {
      doc = JSON.parse(raw);
    } catch (parseErr) {
      console.error('[monthly][run-state] load label=' + safeLabelForLog + ' classification=corrupt (invalid JSON, local)');
      throw RunStateLoadError(
        RUN_STATE_CORRUPT,
        'Run-state invalid JSON for label ' + safeLabelForLog,
        parseErr
      );
    }
    if (!isValidRunState(doc, label)) {
      console.error('[monthly][run-state] load label=' + safeLabelForLog + ' classification=corrupt (invalid schema, local)');
      throw RunStateLoadError(RUN_STATE_CORRUPT, 'Run-state invalid schema for label ' + safeLabelForLog);
    }
    console.log('[monthly][resume] state loaded from local', { label: safeLabelForLog });
    return /** @type {MonthlyRunState} */ (doc);
  } catch (err) {
    if (err?.code === RUN_STATE_CORRUPT || err?.code === RUN_STATE_UNAVAILABLE) throw err;
    if (err?.code === 'ENOENT') {
      console.log('[monthly][run-state] load label=' + safeLabelForLog + ' miss (local)');
      return null;
    }
    console.error('[monthly][run-state] load label=' + safeLabelForLog + ' classification=unavailable (local)', err?.message ?? err);
    throw RunStateLoadError(
      RUN_STATE_UNAVAILABLE,
      'Run-state read failed for label ' + safeLabelForLog + ': ' + (err?.message ?? String(err)),
      err
    );
  }
}

/**
 * Persist run state. GCS: atomic write + retry; local: overwrite.
 * @param {string} label
 * @param {MonthlyRunState} state
 */
export async function saveMonthlyRunState(label, state) {
  const updated = { ...state, updatedAt: new Date().toISOString() };
  const body = JSON.stringify(updated, null, 2);

  if (useGcs()) {
    const bucketName = getBucket();
    const finalPath = stateObjectName(label);
    const tmpPath = `${STATE_PREFIX_GCS}/monthly-${safeLabel(label)}.tmp-${randomUUID()}.json`;
    const storage = new Storage();
    const bucket = storage.bucket(bucketName);
    const tmpFile = bucket.file(tmpPath);
    const destFile = bucket.file(finalPath);
    const opts = { metadata: { contentType: 'application/json' } };

    let lastErr;
    for (let attempt = 1; attempt <= WRITE_MAX_ATTEMPTS; attempt++) {
      try {
        await tmpFile.save(body, opts);
        await tmpFile.copy(destFile);
        try {
          await tmpFile.delete();
        } catch (_) {}
        console.log('[monthly][checkpoint] state saved to GCS', { label });
        return;
      } catch (err) {
        lastErr = err;
        const retryable = isRetryableGcsError(err);
        console.error('[monthly][run-state] write error label=' + label + ' retryable=' + retryable, err?.message ?? err);
        if (!retryable || attempt >= WRITE_MAX_ATTEMPTS) throw err;
        const delay = WRITE_INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1);
        await sleep(delay);
      }
    }
    throw lastErr;
  }

  ensureLocalStateDir();
  const filePath = localStatePath(label);
  fs.writeFileSync(filePath, body, 'utf8');
  console.log('[monthly][checkpoint] state saved to local', { label });
}

/**
 * Mark collect stage ok and persist.
 * @param {MonthlyRunState} state
 * @param { (s: MonthlyRunState) => Promise<void> } save
 */
export function markCollectOk(state, save) {
  const now = new Date().toISOString();
  state.stages.collect = { status: 'ok', completedAt: now };
  state.updatedAt = now;
  return save(state);
}

/**
 * Mark department LLM ok (optionally store sections for resume).
 * @param {MonthlyRunState} state
 * @param {object} [llmSections]
 * @param { (s: MonthlyRunState) => Promise<void> } save
 */
export function markDepartmentLlmOk(state, llmSections, save) {
  const now = new Date().toISOString();
  const attempts = (state.stages.department.llm.attempts ?? 0) + 1;
  state.stages.department.llm = { status: 'ok', attempts, completedAt: now };
  if (llmSections != null) state.stages.department.llmSections = llmSections;
  state.updatedAt = now;
  return save(state);
}

/**
 * Mark department LLM failed and persist.
 * @param {MonthlyRunState} state
 * @param {Error} err
 * @param { (s: MonthlyRunState) => Promise<void> } save
 */
export function markDepartmentLlmFailed(state, err, save) {
  const attempts = (state.stages.department.llm.attempts ?? 0) + 1;
  state.stages.department.llm = { status: 'failed', attempts, error: errorSnippet(err) };
  state.updatedAt = new Date().toISOString();
  return save(state);
}

/**
 * Mark department send ok or failed.
 * @param {MonthlyRunState} state
 * @param {'ok'|'failed'} status
 * @param {Error} [err]
 * @param { (s: MonthlyRunState) => Promise<void> } save
 */
export function markDepartmentSend(state, status, err, save) {
  const now = new Date().toISOString();
  const attempts = (state.stages.department.send.attempts ?? 0) + 1;
  state.stages.department.send = {
    status,
    attempts,
    ...(status === 'failed' && err ? { error: errorSnippet(err) } : {}),
    ...(status === 'ok' ? { completedAt: now } : {}),
  };
  state.updatedAt = now;
  return save(state);
}

/**
 * Mark employee LLM failed and persist.
 * @param {MonthlyRunState} state
 * @param {string} email
 * @param {Error} err
 * @param { (s: MonthlyRunState) => Promise<void> } save
 * @param {string} [name] - Person name for new entry if not yet present
 */
export function markEmployeeLlmFailed(state, email, err, save, name) {
  ensureEmployeeEntry(state, email, name ?? state.stages.employees[email]?.name ?? email);
  const entry = state.stages.employees[email];
  const attempts = (entry.llm.attempts ?? 0) + 1;
  entry.llm = { status: 'failed', attempts, error: errorSnippet(err) };
  state.updatedAt = new Date().toISOString();
  return save(state);
}

/**
 * Ensure employee entry exists; return it.
 * @param {MonthlyRunState} state
 * @param {string} email
 * @param {string} name
 */
export function ensureEmployeeEntry(state, email, name) {
  if (!state.stages.employees[email]) {
    state.stages.employees[email] = {
      llm: { status: 'pending', attempts: 0 },
      send: { status: 'pending', attempts: 0 },
      name: String(name),
    };
  }
  return state.stages.employees[email];
}

/**
 * Mark employee LLM ok (optionally store sections).
 * @param {MonthlyRunState} state
 * @param {string} email
 * @param {object} [llmSections]
 * @param { (s: MonthlyRunState) => Promise<void> } save
 */
export function markEmployeeLlmOk(state, email, llmSections, save) {
  const now = new Date().toISOString();
  const entry = state.stages.employees[email];
  if (!entry) return Promise.resolve();
  const attempts = (entry.llm.attempts ?? 0) + 1;
  entry.llm = { status: 'ok', attempts, completedAt: now };
  if (llmSections != null) entry.llmSections = llmSections;
  state.updatedAt = now;
  return save(state);
}

/**
 * Mark employee send ok or failed.
 * @param {MonthlyRunState} state
 * @param {string} email
 * @param {'ok'|'failed'} status
 * @param {Error} [err]
 * @param { (s: MonthlyRunState) => Promise<void> } save
 */
export function markEmployeeSend(state, email, status, err, save) {
  const now = new Date().toISOString();
  const entry = state.stages.employees[email];
  if (!entry) return Promise.resolve();
  const attempts = (entry.send.attempts ?? 0) + 1;
  entry.send = {
    status,
    attempts,
    ...(status === 'failed' && err ? { error: errorSnippet(err) } : {}),
    ...(status === 'ok' ? { completedAt: now } : {}),
  };
  state.updatedAt = now;
  return save(state);
}

/**
 * Mark run as completed and persist.
 * @param {MonthlyRunState} state
 * @param { (s: MonthlyRunState) => Promise<void> } save
 */
export function markCompleted(state, save) {
  state.completed = true;
  state.updatedAt = new Date().toISOString();
  return save(state);
}
