# CLI entrypoints

## Monthly job (Cloud Run Job)

Run the monthly report once and exit. Used by Cloud Run Jobs; can also be run locally.

**Environment variables:**

- `REFRESH` – set to `1` to force regeneration of all 3 monthly snapshots (optional).
- `NOW_ISO` – optional ISO date string; used as reference “now” for period calculation (default: current time).
- `SNAPSHOT_BUCKET` – GCS bucket for monthly snapshots (default: `cls-automated-reports-data`). Path: `gs://$SNAPSHOT_BUCKET/monthly_snapshots/YYYY-MM.json`. If GCS read fails (e.g. no creds, 404), the job recomputes that month and writes the snapshot.

**Example (local, no GCS):**

```bash
cd backend && node cli/run_monthly_job.js
```

**Example (with cache refresh):**

```bash
REFRESH=1 NOW_ISO=2026-02-01T00:00:00Z node backend/cli/run_monthly_job.js
```

**Cloud Run Job:** Set `SNAPSHOT_BUCKET` if different from default, plus `MONDAY_API_TOKEN`, `GMAIL_*`, `GOOGLE_CLOUD_PROJECT`, etc. Command: `node cli/run_monthly_job.js`. No OIDC needed for the Job.

Exit code: `0` on success, `1` on failure.
