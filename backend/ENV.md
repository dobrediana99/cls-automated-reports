# Environment variables (backend)

## OpenRouter (LLM – monthly job)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `OPENROUTER_API_KEY` | Yes (for monthly) | — | API key from [OpenRouter](https://openrouter.ai). Monthly job fails fast if missing. |
| `OPENROUTER_MODEL` | No | `anthropic/claude-opus-4.6` | Model ID. Empty or whitespace falls back to Claude Opus 4.6. |
| `OPENROUTER_HTTP_REFERER` | No | — | Optional. Sent as `HTTP-Referer` header to OpenRouter. |
| `OPENROUTER_X_TITLE` | No | — | Optional. Sent as `X-Title` header (e.g. `cls-automated-reports`). |
| `OPENROUTER_TIMEOUT_MS` | No | `90000` | Request timeout (ms). AbortError is retried. |
| `OPENROUTER_MAX_TOKENS` | No | `8192` | Max tokens per completion. |
| `OPENROUTER_USE_JSON_SCHEMA` | No | — | If `true`, use strict `json_schema` response_format when supported; on 400 fallback to `json_object` then omit. |

**Checklist**

- [ ] `OPENROUTER_API_KEY` set (no value logged; use `/debug/llm` to confirm `openrouterConfigured: true`).
- [ ] `OPENROUTER_MODEL=anthropic/claude-opus-4.6` (or omit to use default).
- [ ] Optionally `OPENROUTER_X_TITLE=cls-automated-reports` for usage tracking.

Logs (including production) include **LLM audit** lines: `requestedModel`, `returnedModel`, `requestId`, token usage, and prompt hashes (no secrets, no full prompt text).
