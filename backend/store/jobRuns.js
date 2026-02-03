/**
 * Legacy: job-run persistence for idempotency (Firestore). No longer used by the app.
 * Idempotency is now handled by backend/idempotency/localFileStore.js (local file markers).
 */

const COLLECTION = 'jobRuns';

let firestore = null;

function getProjectId() {
  return process.env.GCP_PROJECT_ID || process.env.FIRESTORE_PROJECT_ID || '';
}

/** Lazy init Firestore when project id is set. Returns null if not configured. */
export async function ensureFirestore() {
  const projectId = getProjectId();
  if (!projectId) return null;
  if (firestore) return firestore;
  const { Firestore } = await import('@google-cloud/firestore');
  firestore = new Firestore({ projectId });
  return firestore;
}

/** Whether persistence is configured (project id set). */
export function isPersistenceConfigured() {
  return !!getProjectId();
}

/** Throw if not DRY_RUN and Firestore is not configured. */
export function requirePersistenceWhenNotDryRun() {
  if (process.env.DRY_RUN === '1') return;
  if (!isPersistenceConfigured()) {
    throw new Error(
      'Firestore is required when not in DRY_RUN. Set GCP_PROJECT_ID or FIRESTORE_PROJECT_ID for job-run persistence.'
    );
  }
}

function docId(jobType, label) {
  return `${jobType}_${label}`;
}

/**
 * Get existing job run if any.
 * @param {string} jobType - 'weekly' | 'monthly'
 * @param {string} label - e.g. '2026-01-19..2026-01-25'
 * @returns {Promise<object|null>} { jobType, label, periodStart, periodEnd, runAt, status, attemptCount, errorMessage } or null
 */
export async function getJobRun(jobType, label) {
  const db = await ensureFirestore();
  if (!db) return null;
  const ref = db.collection(COLLECTION).doc(docId(jobType, label));
  const snap = await ref.get();
  if (!snap.exists) return null;
  const data = snap.data();
  return {
    jobType: data.jobType,
    label: data.label,
    periodStart: data.periodStart,
    periodEnd: data.periodEnd,
    runAt: data.runAt,
    status: data.status,
    attemptCount: data.attemptCount ?? 1,
    errorMessage: data.errorMessage ?? null,
  };
}

/**
 * Mark job run as started (create or increment attemptCount if already started).
 * @param {string} jobType
 * @param {string} label
 * @param {object} meta - { periodStart, periodEnd, runAt }
 */
export async function markJobRunStarted(jobType, label, meta) {
  requirePersistenceWhenNotDryRun();
  const db = await ensureFirestore();
  if (!db) return;
  const id = docId(jobType, label);
  const ref = db.collection(COLLECTION).doc(id);
  const snap = await ref.get();
  const now = new Date().toISOString();
  const attemptCount = snap.exists && snap.data().status === 'started'
    ? (snap.data().attemptCount ?? 1) + 1
    : 1;
  await ref.set({
    jobType,
    label,
    periodStart: meta.periodStart,
    periodEnd: meta.periodEnd,
    runAt: meta.runAt ?? now,
    status: 'started',
    attemptCount,
    errorMessage: null,
    updatedAt: now,
  }, { merge: true });
}

/**
 * Mark job run as sent (idempotent success).
 * @param {string} jobType
 * @param {string} label
 * @param {object} [data] - optional payload to store
 */
export async function markJobRunSent(jobType, label, data = {}) {
  requirePersistenceWhenNotDryRun();
  const db = await ensureFirestore();
  if (!db) return;
  const ref = db.collection(COLLECTION).doc(docId(jobType, label));
  const now = new Date().toISOString();
  await ref.set({
    jobType,
    label,
    status: 'sent',
    errorMessage: null,
    updatedAt: now,
    ...data,
  }, { merge: true });
}

/**
 * Mark job run as failed.
 * @param {string} jobType
 * @param {string} label
 * @param {string} errorMessage
 */
export async function markJobRunFailed(jobType, label, errorMessage) {
  requirePersistenceWhenNotDryRun();
  const db = await ensureFirestore();
  if (!db) return;
  const ref = db.collection(COLLECTION).doc(docId(jobType, label));
  const now = new Date().toISOString();
  await ref.set({
    jobType,
    label,
    status: 'failed',
    errorMessage: String(errorMessage),
    updatedAt: now,
  }, { merge: true });
}
