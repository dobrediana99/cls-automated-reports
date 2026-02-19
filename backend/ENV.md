# Environment variables (backend)

## OpenRouter (LLM – monthly job)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `OPENROUTER_API_KEY` | Yes (for monthly) | — | API key from [OpenRouter](https://openrouter.ai). Monthly job fails fast if missing. |
| `OPENROUTER_MODEL` | No | `anthropic/claude-opus-4.6` | Model ID. Empty or whitespace falls back to Claude Opus 4.6. |
| `OPENROUTER_HTTP_REFERER` | No | — | Optional. Sent as `HTTP-Referer` header to OpenRouter. |
| `OPENROUTER_X_TITLE` | No | — | Optional. Sent as `X-Title` header (e.g. `cls-automated-reports`). |
| `OPENROUTER_TIMEOUT_MS` | No | `90000` | Request timeout (ms). AbortError is retried (3 attempts, 2s initial backoff). |
| `OPENROUTER_MAX_TOKENS` | No | `8192` | Max tokens per completion. |
| `OPENROUTER_USE_JSON_SCHEMA` | No | — | If `true`, use strict `json_schema` response_format when supported; on 400 fallback to `json_object` then omit. |

**Checklist**

- [ ] `OPENROUTER_API_KEY` set (no value logged; use `/debug/llm` to confirm `openrouterConfigured: true`).
- [ ] `OPENROUTER_MODEL=anthropic/claude-opus-4.6` (or omit to use default).
- [ ] Optionally `OPENROUTER_X_TITLE=cls-automated-reports` for usage tracking.

**Monthly email send (retry):** `EMAIL_SEND_MAX_ATTEMPTS` (default `3`), `EMAIL_SEND_BACKOFF_MS` (default `1000`). Transient SMTP/network errors are retried with exponential backoff; permanent auth errors fail fast. Logs: `[email][retry]` with attempt/max and reason (no secrets).

Logs (including production) include **LLM audit** lines: `requestedModel`, `returnedModel`, `requestId`, token usage, and prompt hashes (no secrets, no full prompt text).

## Monthly snapshot and cache (GCS)

| Variable | When used | Default / behavior |
|----------|-----------|--------------------|
| `SNAPSHOT_BUCKET` | When **set** (non-empty): monthly job uses GCS snapshots for the 3 periods. Bucket name = env value or `cls-automated-reports-data` if empty. Path: `gs://<bucket>/monthly_snapshots/YYYY-MM.json`. Run state (resume/checkpoints) also uses GCS when set. | When **unset**: no GCS snapshots; job uses report cache only (see `REPORTS_BUCKET` or disk). |
| `REPORTS_BUCKET` | When set (and `SNAPSHOT_BUCKET` unset): report cache read/write to GCS. Path: `gs://<bucket>/<REPORTS_PREFIX>/YYYY-MM.json`. | When unset: report cache is disk only (`out/cache/monthly/`). |
| `REPORTS_PREFIX` | Prefix under `REPORTS_BUCKET` for cache objects. | `monthly-cache/` |

**GCS read fallback:** On snapshot or cache read failure (404, network error, or invalid payload), the job logs and treats as miss → recomputes and writes. No crash; look for `[snapshot] read month=... miss` or `[monthly][cache] invalid envelope` in logs.

**Run-state (monthly resume) fail-closed:** When `SNAPSHOT_BUCKET` is set or state is on disk, the monthly job loads run-state before sending. Only a true *miss* (GCS 404 / local file ENOENT) is treated as “no state” and allows creating a new run. Any other load failure (network, permission, invalid JSON, invalid schema) causes the job to **abort immediately** with a clear error and no emails or LLM calls, to avoid duplicate sends. Logs: `[monthly][run-state] load failed, aborting to avoid duplicate sends` with `label`, `code`, `message` (no secrets).

## Monday fetch (items_page pagination)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `MONDAY_ITEMS_MAX_PAGES` | No | `50` | Max number of items_page requests per board per fetch. Prevents runaway pagination; on exceed, fetch fails with a clear `[fetchData] items_page max pages exceeded` error (boardId and limit in message, no secrets). |
