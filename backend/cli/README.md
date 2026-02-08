# CLI entrypoints

## Monthly job (Cloud Run Job)

Run the monthly report once and exit. Used by Cloud Run Jobs; can also be run locally.

**Environment variables:**

- `REFRESH` – set to `1` to ignore cache and recompute all 3 months (optional).
- `NOW_ISO` – optional ISO date string; used as reference “now” for period calculation (default: current time).

**Example (local):**

```bash
REFRESH=1 NOW_ISO=2026-02-01T00:00:00Z node backend/cli/run_monthly_job.js
```

From the repo root with backend as working directory:

```bash
cd backend && REFRESH=1 node cli/run_monthly_job.js
```

Exit code: `0` on success, `1` on failure.
