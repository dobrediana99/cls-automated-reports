/**
 * OpenRouter (Claude Opus 4.6) client for monthly report analysis.
 * Uses Chat Completions API. Requires OPENROUTER_API_KEY.
 * Env: OPENROUTER_API_KEY (required), OPENROUTER_MODEL, OPENROUTER_HTTP_REFERER, OPENROUTER_X_TITLE,
 *      OPENROUTER_TIMEOUT_MS, OPENROUTER_MAX_TOKENS, OPENROUTER_USE_JSON_SCHEMA.
 * Retry on 408, 409, 429, 5xx, timeout (AbortError), and on JSON parse failure (with stricter prompt).
 * response_format is never sent for Anthropic models (anthropic/*) to avoid 400 structured-outputs header error.
 * Fallback: 400 response_format -> retry with json_object, then without response_format (non-Anthropic only).
 * LLM audit logging: requestedModel, returnedModel, hasKey, prompt hashes (no full prompt in production).
 *
 * AUDIT OpenRouter 401 (Cloud Run):
 * - Endpoint: OK — https://openrouter.ai/api/v1/chat/completions
 * - Authorization: OK — "Bearer ${apiKey}"
 * - Content-Type: OK — application/json
 * - HTTP-Referer: FIXED — was optional (env only); now sent with default if env unset
 * - X-Title: FIXED — was optional (env only); now sent with default if env unset
 * - Parsing: OK — body read once (res.text() when !ok, res.json() when ok)
 * - 401: safe log added (keyFp + bodySnippet, no full key)
 */

import crypto from 'crypto';
import { parseJsonFromText } from './parseJsonFromText.js';
import { normalizeMonthlyEmployeeOutput } from './normalizeMonthlyEmployeeOutput.js';
import {
  validateEmployeeOutput,
  validateDepartmentOutput,
  getMonthlySchema,
} from './validateMonthlyOutput.js';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_MODEL = 'anthropic/claude-opus-4.6';
const MAX_ATTEMPTS = 3;
const INITIAL_BACKOFF_MS = 2000;
const DEFAULT_MAX_TOKENS = 8192;
const MAX_TOKENS = Number(process.env.OPENROUTER_MAX_TOKENS || DEFAULT_MAX_TOKENS);
const REQUEST_TIMEOUT_MS = Number(process.env.OPENROUTER_TIMEOUT_MS || 90000);
const STRICT_JSON_APPEND =
  '\n\nReturn ONLY valid JSON object, no markdown, no extra text.';
const SCHEMA_REPAIR_APPEND =
  '\n\nReturnează DOAR JSON valid, fără markdown/backticks, cu exact structura cerută. Toate cheile obligatorii prezente, string-uri non-goale. NU adăuga chei suplimentare (additionalProperties false). '
  + 'sectiunea_5_plan_saptamanal trebuie să conțină format cu exact saptamana_1 și saptamana_2_4 (string-uri non-goale). '
  + 'incheiere: raport_urmator, mesaj_sub_80, mesaj_peste_80 și semnatura (nume, functie, companie) trebuie să fie string-uri non-goale.';
const PREVIEW_LEN = 200;
const RAW_BODY_LOG_MAX = 2048;

function isResponseFormatError(body) {
  if (body == null || typeof body !== 'string') return false;
  const lower = body.toLowerCase();
  return (
    lower.includes('response_format') &&
    (lower.includes('unsupported') || lower.includes('not supported'))
  );
}

function getJsonSchemaForOperation(operationName) {
  const schema = getMonthlySchema(operationName);
  const name =
    operationName === 'department' ? 'monthly_department' : 'monthly_employee';
  return {
    type: 'json_schema',
    json_schema: {
      name,
      strict: true,
      schema,
    },
  };
}

/**
 * Anthropic models via OpenRouter do not support response_format (structured outputs);
 * sending it causes 400 invalid_request_error (anthropic-beta header).
 * @param {string} [model] - e.g. "anthropic/claude-opus-4.6"
 * @returns {boolean}
 */
function isAnthropicModel(model) {
  return typeof model === 'string' && model.trim().toLowerCase().startsWith('anthropic/');
}

/**
 * @param {string} [operationName] - 'employee' | 'department'
 * @param {number} formatLevel - 0 = json_schema (if env) or json_object, 1 = json_object, 2 = omit
 * @param {string} [model] - when anthropic/, response_format is always omitted
 * @returns {object|undefined} response_format for body, or undefined to omit
 */
function getResponseFormat(operationName, formatLevel, model) {
  if (isAnthropicModel(model)) return undefined;
  if (formatLevel === 2) return undefined;
  if (formatLevel === 1) return { type: 'json_object' };
  const useSchema =
    process.env.OPENROUTER_USE_JSON_SCHEMA === 'true' ||
    (process.env.OPENROUTER_USE_JSON_SCHEMA !== 'false' &&
      (operationName === 'employee' || operationName === 'department'));
  if (useSchema) {
    return getJsonSchemaForOperation(operationName);
  }
  return { type: 'json_object' };
}

function sha256(str) {
  return crypto.createHash('sha256').update(String(str), 'utf8').digest('hex');
}

function previewText(str) {
  if (str == null || typeof str !== 'string') return '';
  return str.replace(/\s+/g, ' ').trim().slice(0, PREVIEW_LEN);
}

/**
 * Validate that OpenRouter is configured (for job to fail fast before LLM calls).
 * Returns the trimmed API key.
 * @returns {string}
 */
export function requireOpenRouter() {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key || typeof key !== 'string' || !key.trim()) {
    throw new Error(
      'OpenRouter requires an API key. Set OPENROUTER_API_KEY (get one at https://openrouter.ai).'
    );
  }
  return key.trim();
}

/**
 * Model used for requests. Empty/whitespace env falls back to Claude Opus 4.6.
 * Exported for GET /debug/llm.
 */
export function getModel() {
  const model = (process.env.OPENROUTER_MODEL || '').trim() || DEFAULT_MODEL;
  return model;
}

function getHeaders(apiKey) {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'HTTP-Referer': (process.env.OPENROUTER_HTTP_REFERER || '').trim() || 'https://crystal-logistics-services.com',
    'X-Title': (process.env.OPENROUTER_X_TITLE || '').trim() || 'CLS Automated Reports',
  };
}

function logOpenRouterError(model, err, operationName) {
  const statusCode = err?.status ?? err?.statusCode ?? err?.code;
  const message = err?.message ?? String(err);
  console.error('[openrouter] error', {
    model,
    operationName: operationName ?? null,
    statusCode: statusCode != null ? statusCode : undefined,
    message,
  });
}

function isAbortError(err) {
  return err?.name === 'AbortError';
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function isRetryableStatus(status) {
  if (typeof status !== 'number') return false;
  if (status === 408 || status === 409 || status === 429) return true;
  if (status >= 500 && status < 600) return true;
  return false;
}

/**
 * Build messages array for OpenRouter (OpenAI-style): system + user.
 * @param {{ role: string, content: string }[]} messages
 * @returns {{ role: string, content: string }[]}
 */
function normalizeMessages(messages) {
  let systemContent = '';
  let userContent = '';
  for (const m of messages) {
    const text = (m.content && String(m.content).trim()) || '';
    if (m.role === 'system') {
      systemContent = systemContent ? systemContent + '\n\n' + text : text;
    } else if (m.role === 'user') {
      userContent = userContent ? userContent + '\n\n' + text : text;
    }
  }
  const out = [];
  if (systemContent) {
    out.push({ role: 'system', content: systemContent });
  }
  out.push({ role: 'user', content: userContent || '(no input)' });
  return out;
}

/**
 * Call OpenRouter Chat Completions with JSON output. Retries on transient errors, timeout (AbortError), and JSON parse failure.
 * Fallback on 400 response_format: json_schema -> json_object -> no response_format.
 * @param {{ messages: { role: string, content: string }[], operationName?: string }} opts
 * @returns {Promise<{ content: string, usage?: object, model: string }>}
 */
async function callOpenRouterJson({ messages, operationName }) {
  const apiKey = requireOpenRouter();
  const model = getModel();
  const requestId = crypto.randomUUID();
  console.log('[LLM audit] Using OpenRouter model: ' + model);
  const headers = getHeaders(apiKey);
  const normalizedMessages = normalizeMessages(messages);
  const hasKey = !!process.env.OPENROUTER_API_KEY;

  let lastParseError = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const systemMsg = normalizedMessages.find((m) => m.role === 'system');
      const userMsg = normalizedMessages.find((m) => m.role === 'user');
      const systemContent = systemMsg?.content ?? '';
      const userContent =
        attempt === 1
          ? (userMsg?.content ?? '')
          : (userMsg?.content ?? '') + STRICT_JSON_APPEND;
      const apiMessages = [
        { role: 'system', content: systemContent },
        { role: 'user', content: userContent },
      ];

      let responseFormatLevel = 0;
      let res;
      let lastResponseFormatErr = null;

      while (responseFormatLevel <= 2) {
      const responseFormat = getResponseFormat(operationName, responseFormatLevel, model);
      const body = {
        model,
        messages: apiMessages,
        max_tokens: MAX_TOKENS,
        ...(responseFormat && { response_format: responseFormat }),
      };

      if (attempt === 1 && responseFormatLevel === 0) {
        const systemPromptHash = sha256(systemContent);
        const inputJsonHash = sha256(JSON.stringify(body));
        const auditPayload = {
          requestId,
          requestedModel: model,
          endpoint: OPENROUTER_URL,
          hasKey,
          systemPromptHash,
          inputJsonHash,
        };
        if (process.env.NODE_ENV !== 'production') {
          auditPayload.systemPromptPreview = previewText(systemContent);
        }
        console.log('[LLM audit] request', auditPayload);
      }

      if (process.env.NODE_ENV !== 'production') {
        console.log('[OPENROUTER] REQUEST', {
          model: getModel(),
          hasKey: Boolean(process.env.OPENROUTER_API_KEY),
          messageCount: Array.isArray(body?.messages) ? body.messages.length : null,
          timestamp: new Date().toISOString(),
        });
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      try {
        res = await fetch(OPENROUTER_URL, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }

      if (process.env.NODE_ENV !== 'production') {
        console.log('[OPENROUTER] RESPONSE', {
          status: res.status,
          ok: res.ok,
          timestamp: new Date().toISOString(),
        });
      }

      const status = res.status;
      if (!res.ok) {
        const text = await res.text();
        if (status === 401) {
          console.error('[OPENROUTER 401]', {
            model,
            endpoint: OPENROUTER_URL,
            keyFp: { len: apiKey?.length ?? 0, prefix6: apiKey ? String(apiKey).slice(0, 6) : '' },
            bodySnippet: text.slice(0, 300),
          });
        }
        if (status === 400 && isResponseFormatError(text)) {
          const err = new Error(`OpenRouter API error: ${status} ${res.statusText}`);
          err.status = status;
          err.statusCode = status;
          err.body = text;
          lastResponseFormatErr = err;
          if (responseFormatLevel < 2) {
            console.warn('[OpenRouter response_format fallback]', {
              requestId,
              operationName: operationName ?? null,
              attempt,
              currentLevel: responseFormatLevel,
              nextLevel: responseFormatLevel + 1,
              model,
              status: res.status,
              message: err.message,
            });
            responseFormatLevel++;
            if (process.env.NODE_ENV !== 'production') {
              console.log(
                '[llm] 400 response_format fallback level=' + responseFormatLevel
              );
            }
            continue;
          }
          console.error('[OpenRouter response_format exhausted]', {
            requestId,
            operationName: operationName ?? null,
            attempt,
            finalLevel: responseFormatLevel,
            model,
            status: res.status,
            message: err.message,
          });
          logOpenRouterError(model, err, operationName);
          throw err;
        }
        let err = new Error(`OpenRouter API error: ${status} ${res.statusText}`);
        err.status = status;
        err.statusCode = status;
        err.body = text;
        if (isRetryableStatus(status) && attempt < MAX_ATTEMPTS) {
          const delay = INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1);
          if (process.env.NODE_ENV !== 'production') {
            console.log(
              '[llm] openrouter status ' +
                status +
                ' attempt ' +
                attempt +
                '/' +
                MAX_ATTEMPTS +
                ' delay=' +
                delay +
                'ms'
            );
          }
          await sleep(delay);
          break; // exit while, next for attempt
        }
        logOpenRouterError(model, err, operationName);
        throw err;
      }

      // res.ok
      const data = await res.json();
      const returnedModel = data?.model ?? null;
      const usage = data?.usage
        ? {
            prompt_tokens: data.usage.prompt_tokens,
            completion_tokens: data.usage.completion_tokens,
            total_tokens: data.usage.total_tokens,
          }
        : undefined;
      const auditResponse = {
        requestId,
        status: res.status,
        returnedModel,
        prompt_tokens: data?.usage?.prompt_tokens,
        completion_tokens: data?.usage?.completion_tokens,
        total_tokens: data?.usage?.total_tokens,
      };
      if (data?.usage?.cost != null) auditResponse.cost = data.usage.cost;
      if (data?.usage?.cost_details != null) auditResponse.cost_details = data.usage.cost_details;
      console.log('[LLM audit] response', auditResponse);

      const content = data?.choices?.[0]?.message?.content;
      if (content == null || typeof content !== 'string') {
        throw new Error(
          'OpenRouter response missing choices[0].message.content'
        );
      }

      let parsed;
      try {
        parsed = parseJsonFromText(content);
      } catch (parseErr) {
        lastParseError = parseErr;
        if (attempt < MAX_ATTEMPTS) {
          if (process.env.NODE_ENV !== 'production') {
            console.log(
              '[llm] JSON parse failed, attempt ' +
                attempt +
                '/' +
                MAX_ATTEMPTS +
                ', retrying with stricter instruction'
            );
          }
          await sleep(INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1));
          break;
        }
        console.error('[LLM audit] invalid JSON', {
          requestId,
          model,
          status: res.status,
          attempt,
          reason: 'parse fail',
          parseErrorMessage: parseErr?.message ?? String(parseErr),
        });
        if (process.env.NODE_ENV !== 'production') {
          const rawPreview = String(content).slice(0, RAW_BODY_LOG_MAX);
          console.error(
            '[LLM audit] raw body (max ' + RAW_BODY_LOG_MAX + ' chars):',
            rawPreview
          );
        }
        throw new Error(
          'LLM returned non-JSON. Monthly job fails. ' +
            (parseErr?.message ?? String(parseErr))
        );
      }

      if (process.env.NODE_ENV !== 'production' && attempt > 1) {
        console.log('[llm] model=' + model + ' attempts=' + attempt);
      }
      return {
        content: JSON.stringify(parsed),
        usage,
        model,
        requestId,
      };
      }
      if (lastResponseFormatErr) {
        console.error('[OpenRouter response_format exited loop without success]', {
          requestId,
          operationName: operationName ?? null,
          model,
          message: lastResponseFormatErr.message,
        });
        throw lastResponseFormatErr;
      }
    } catch (err) {
      if (attempt >= MAX_ATTEMPTS) {
        logOpenRouterError(model, err, operationName);
        throw err;
      }
      const isRetryable =
        isAbortError(err) ||
        isRetryableStatus(err?.status ?? err?.statusCode) ||
        /rate limit|429|timeout|ECONNRESET|ETIMEDOUT|fetch failed/i.test(
          err?.message ?? ''
        );
      if (!isRetryable) {
        logOpenRouterError(model, err, operationName);
        throw err;
      }
      const delay = INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1);
      if (process.env.NODE_ENV !== 'production') {
        console.log(
          '[llm] transient error attempt ' +
            attempt +
            '/' +
            MAX_ATTEMPTS +
            ' delay=' +
            delay +
            'ms',
          err?.message
        );
      }
      await sleep(delay);
    }
  }

  if (lastParseError) {
    throw new Error(
      'LLM response is not valid JSON. Monthly job fails.'
    );
  }
  throw new Error('OpenRouter request failed after retries.');
}

const EMPLOYEE_JSON_INSTRUCTION = `
Răspunde EXCLUSIV în JSON valid, cu exact structura din prompt (antet, sectiunea_1_tabel_date_performanta, sectiunea_2_interpretare_date, sectiunea_3_concluzii, sectiunea_4_actiuni_prioritare, sectiunea_5_plan_saptamanal, sectiunea_6_check_in_intermediar doar dacă performanța sub 80%, incheiere). NU include text în afara JSON. NU folosi \`\`\`. NU include chei suplimentare.`;

const DEPARTMENT_JSON_INSTRUCTION = `
Răspunde EXCLUSIV în JSON valid, cu exact structura din prompt (antet, sectiunea_1_rezumat_executiv, sectiunea_2_analiza_vanzari, sectiunea_3_analiza_operational, sectiunea_4_comparatie_departamente, sectiunea_5_recomandari_management, incheiere). NU include text în afara JSON. NU folosi \`\`\`. NU include chei suplimentare.`;

/**
 * Generate monthly employee sections. Returns full validated JSON (antet, sectiuni, incheiere). Fail fast if invalid.
 * One repair retry on schema or check-in rule failure.
 * @param {{ systemPrompt: string, inputJson: object, performancePct?: number | null }} opts - performancePct used for sectiunea_6 rule (<80 => required, >=80 => absent)
 */
export async function generateMonthlySections({
  systemPrompt,
  inputJson,
  performancePct,
}) {
  if (process.env.NODE_ENV !== 'production') {
    console.log('[LLM] GENERATE EMPLOYEE SECTIONS START', {
      model: getModel(),
      timestamp: new Date().toISOString(),
    });
  }
  const userPayload =
    EMPLOYEE_JSON_INSTRUCTION.trim() +
    '\n\nDate pentru analiză (JSON, ultimele 2 luni):\n' +
    JSON.stringify(inputJson);

  const PARSE_FAIL_MESSAGE = 'LLM response is not valid JSON. Monthly job fails.';
  const tryParseAndValidate = (raw, requestId, attempt) => {
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (_) {
      throw new Error(PARSE_FAIL_MESSAGE);
    }
    parsed = normalizeMonthlyEmployeeOutput(parsed);
    try {
      return validateEmployeeOutput(parsed, { performancePct });
    } catch (schemaErr) {
      if (process.env.NODE_ENV !== 'production' && schemaErr?.message?.includes('schema validation failed')) {
        console.error(
          '[LLM] After normalization still invalid, sample (500 chars):',
          JSON.stringify(parsed).slice(0, 500)
        );
      }
      throw schemaErr;
    }
  };

  const { content, usage, model, requestId } = await callOpenRouterJson({
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPayload },
    ],
    operationName: 'employee',
  });

  try {
    const result = tryParseAndValidate(content, requestId, 1);
    if (process.env.NODE_ENV !== 'production') {
      console.log(
        '[llm] model=' + model + ', usage=' + (usage ? JSON.stringify(usage) : '') + ', ok'
      );
    }
    return { sections: result, usage: usage ?? null };
  } catch (schemaErr) {
    const reason =
      schemaErr?.message === PARSE_FAIL_MESSAGE
        ? 'parse fail'
        : schemaErr?.message?.includes('sectiunea_6')
          ? 'check-in rule'
          : 'schema fail';
    console.error('[LLM audit] invalid response', {
      requestId: requestId ?? null,
      model,
      attempt: 1,
      reason,
      motiv: schemaErr?.message ?? String(schemaErr),
    });
    if (process.env.NODE_ENV !== 'production') {
      console.error(
        '[LLM audit] raw body (max ' + RAW_BODY_LOG_MAX + ' chars):',
        String(content).slice(0, RAW_BODY_LOG_MAX)
      );
    }
    const { content: repairContent, usage: repairUsage } =
      await callOpenRouterJson({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPayload + SCHEMA_REPAIR_APPEND },
        ],
        operationName: 'employee',
      });
    try {
      const result = tryParseAndValidate(repairContent, null, 2);
      if (process.env.NODE_ENV !== 'production') {
        console.log('[llm] model= ok (after schema repair retry)');
      }
      return { sections: result, usage: repairUsage ?? null };
    } catch (repairErr) {
      const repairReason =
        repairErr?.message === PARSE_FAIL_MESSAGE
          ? 'parse fail'
          : repairErr?.message?.includes('sectiunea_6')
            ? 'check-in rule'
            : 'schema fail';
      console.error('[LLM audit] invalid response', {
        requestId: null,
        model,
        attempt: 2,
        reason: repairReason,
        motiv: repairErr?.message ?? String(repairErr),
      });
      throw new Error(
        'LLM monthly employee output invalid after retries. ' +
          (repairErr?.message ?? String(repairErr))
      );
    }
  }
}

/**
 * Generate monthly department/management sections. Returns full validated JSON. Fail fast if invalid.
 * One repair retry on schema validation failure.
 */
export async function generateMonthlyDepartmentSections({
  systemPrompt,
  inputJson,
}) {
  if (process.env.NODE_ENV !== 'production') {
    console.log('[LLM] GENERATE DEPARTMENT SECTIONS START', {
      model: getModel(),
      timestamp: new Date().toISOString(),
    });
  }
  const userPayload =
    DEPARTMENT_JSON_INSTRUCTION.trim() +
    '\n\nDate pentru analiză (JSON, ultimele 2 luni):\n' +
    JSON.stringify(inputJson);

  const tryParseAndValidate = (raw) => {
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (_) {
      throw new Error(
        'LLM department response is not valid JSON. Monthly job fails.'
      );
    }
    return validateDepartmentOutput(parsed);
  };

  const { content, usage, model, requestId } = await callOpenRouterJson({
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPayload },
    ],
    operationName: 'department',
  });

  try {
    const result = tryParseAndValidate(content);
    if (process.env.NODE_ENV !== 'production') {
      console.log(
        '[llm] model=' + model + ', usage=' + (usage ? JSON.stringify(usage) : '') + ', ok'
      );
    }
    return { sections: result, usage: usage ?? null };
  } catch (schemaErr) {
    console.error('[LLM audit] invalid JSON', {
      requestId: requestId ?? null,
      model,
      attempt: 1,
      reason: 'schema fail',
      motiv: schemaErr?.message ?? String(schemaErr),
    });
    if (process.env.NODE_ENV !== 'production') {
      console.error(
        '[LLM audit] raw body (max ' + RAW_BODY_LOG_MAX + ' chars):',
        String(content).slice(0, RAW_BODY_LOG_MAX)
      );
    }
    const { content: repairContent, usage: repairUsage } =
      await callOpenRouterJson({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPayload + SCHEMA_REPAIR_APPEND },
        ],
        operationName: 'department',
      });
    try {
      const result = tryParseAndValidate(repairContent);
      if (process.env.NODE_ENV !== 'production') {
        console.log('[llm] model= ok (after schema repair retry)');
      }
      return { sections: result, usage: repairUsage ?? null };
    } catch (repairErr) {
      console.error('[LLM audit] invalid JSON', {
        requestId: null,
        model,
        attempt: 2,
        reason: 'schema fail',
        motiv: repairErr?.message ?? String(repairErr),
      });
      throw new Error(
        'LLM monthly department output invalid after retries. ' +
          (repairErr?.message ?? String(repairErr))
      );
    }
  }
}
