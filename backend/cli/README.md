# CLI entrypoints

## Monthly job (Cloud Run Job)

Run the monthly report once and exit. Used by **Cloud Run Jobs** (one-shot, no HTTP); can also be run locally. For HTTP-triggered runs use the **Cloud Run Service** and POST to `/run/monthly` (see README.md).

**Environment variables:**

- `REFRESH` – set to `1` to force regeneration of all 3 monthly periods (optional).
- `NOW_ISO` – optional ISO date string; used as reference “now” for period calculation (default: current time).
- `SNAPSHOT_BUCKET` – When **set** (non-empty): job uses GCS snapshots for the 3 periods. Bucket = env value or `cls-automated-reports-data` if empty. Path: `gs://<bucket>/monthly_snapshots/YYYY-MM.json`. When **unset**: job uses report cache only (disk or `REPORTS_BUCKET`). GCS read fallback: 404/error/invalid payload → log + miss → recompute and write. Logs: `[snapshot] read month=... miss` or `[snapshot] read month=... invalid: ...`.

**Example (local, no GCS):**

```bash
cd backend && node cli/run_monthly_job.js
```

**Example (with cache refresh):**

```bash
REFRESH=1 NOW_ISO=2026-02-01T00:00:00Z node backend/cli/run_monthly_job.js
```

**Cloud Run Job:** Set `SNAPSHOT_BUCKET` if using GCS snapshots (or leave unset for disk cache), plus `MONDAY_API_TOKEN`, `OPENROUTER_API_KEY`, `GMAIL_*`, etc. Command: `node cli/run_monthly_job.js`. No OIDC (Job runs to completion; auth via env/secrets).

Exit code: `0` on success, `1` on failure.
