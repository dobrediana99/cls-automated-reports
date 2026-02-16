/**
 * OpenRouter (Claude Opus 4.6) client for monthly report analysis.
 * Uses Chat Completions API. Requires OPENROUTER_API_KEY.
 * Env: OPENROUTER_API_KEY (required), OPENROUTER_MODEL, OPENROUTER_HTTP_REFERER, OPENROUTER_X_TITLE,
 *      OPENROUTER_TIMEOUT_MS, OPENROUTER_MAX_TOKENS, OPENROUTER_USE_JSON_SCHEMA.
 * Retry on 408, 409, 429, 5xx, timeout (AbortError), and on JSON parse failure (with stricter prompt).
 * Fallback: 400 response_format -> retry with json_object, then without response_format.
 * LLM audit logging: requestedModel, returnedModel, hasKey, prompt hashes (no full prompt in production).
 */

import crypto from 'crypto';

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
  '\n\nSchema validation failed. Return EXACT same JSON object with ALL required keys present and non-empty strings. Do not add extra keys.';
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
  const employeeKeys = ['interpretareHtml', 'concluziiHtml', 'actiuniHtml', 'planHtml'];
  const departmentKeys = [
    'rezumatExecutivHtml',
    'vanzariHtml',
    'operationalHtml',
    'comparatiiHtml',
    'recomandariHtml',
  ];
  const keys = operationName === 'department' ? departmentKeys : employeeKeys;
  const properties = {};
  const required = [...keys];
  for (const k of keys) {
    properties[k] = { type: 'string' };
  }
  return {
    type: 'json_schema',
    json_schema: {
      name: 'monthly_output',
      strict: true,
      schema: {
        type: 'object',
        additionalProperties: false,
        required,
        properties,
      },
    },
  };
}

/**
 * @param {string} [operationName] - 'employee' | 'department'
 * @param {number} formatLevel - 0 = json_schema (if env) or json_object, 1 = json_object, 2 = omit
 * @returns {object|undefined} response_format for body, or undefined to omit
 */
function getResponseFormat(operationName, formatLevel) {
  if (formatLevel === 2) return undefined;
  if (formatLevel === 1) return { type: 'json_object' };
  if (process.env.OPENROUTER_USE_JSON_SCHEMA === 'true') {
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
 * Remove outer markdown fence (```...```) only if the whole string is wrapped.
 * Does not strip backticks inside the content.
 */
function stripMarkdownFenceWrapper(text) {
  if (typeof text !== 'string') return text;

  const trimmed = text.trim();
  if (!trimmed.startsWith('```')) return trimmed;

  const lines = trimmed.split('\n');
  if (lines.length < 2) return trimmed;

  const firstLine = lines[0].trim();
  const lastLine = lines[lines.length - 1].trim();

  const isFenceStart = firstLine.startsWith('```');
  const isFenceEnd = lastLine === '```';

  if (!isFenceStart || !isFenceEnd) return trimmed;

  return lines.slice(1, -1).join('\n').trim();
}

/**
 * Extract substring between first "{" and last "}".
 * Only if both braces exist, end > start, and result starts/ends with braces.
 */
function extractJsonObject(text) {
  if (typeof text !== 'string') return text;

  const trimmed = text.trim();

  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');

  if (start === -1 || end === -1 || end <= start) {
    return trimmed;
  }

  const candidate = trimmed.slice(start, end + 1).trim();

  if (!candidate.startsWith('{') || !candidate.endsWith('}')) {
    return trimmed;
  }

  return candidate;
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
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };
  const referer = process.env.OPENROUTER_HTTP_REFERER?.trim();
  if (referer) {
    headers['HTTP-Referer'] = referer;
  }
  const title = process.env.OPENROUTER_X_TITLE?.trim();
  if (title) {
    headers['X-Title'] = title;
  }
  return headers;
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

      while (responseFormatLevel <= 2) {
      const responseFormat = getResponseFormat(operationName, responseFormatLevel);
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
        if (status === 400 && isResponseFormatError(text) && responseFormatLevel < 2) {
          responseFormatLevel++;
          if (process.env.NODE_ENV !== 'production') {
            console.log(
              '[llm] 400 response_format fallback level=' + responseFormatLevel
            );
          }
          continue;
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

      let cleaned = stripMarkdownFenceWrapper(content);
      const hadFenceWrapper = cleaned !== content.trim();
      const afterFence = cleaned;
      cleaned = extractJsonObject(cleaned);
      const hadExtraction = cleaned !== afterFence;

      try {
        JSON.parse(cleaned);
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
        if (process.env.NODE_ENV === 'production') {
          console.error('[LLM audit] invalid JSON', {
            requestId,
            model,
            status: res.status,
            attempt,
            parseErrorMessage: parseErr?.message ?? String(parseErr),
          });
        } else {
          const rawPreview = String(content).slice(0, RAW_BODY_LOG_MAX);
          console.error(
            '[LLM audit] model did not return valid JSON; raw body (max ' +
              RAW_BODY_LOG_MAX +
              ' chars):',
            rawPreview
          );
          console.error('[LLM audit] parse debug', {
            originalLen: content.length,
            cleanedLen: cleaned.length,
            hadFenceWrapper,
            hadExtraction,
          });
        }
        throw new Error(
          'LLM response is not valid JSON. Monthly job fails.'
        );
      }

      if (process.env.NODE_ENV !== 'production' && attempt > 1) {
        console.log('[llm] model=' + model + ' attempts=' + attempt);
      }
      return { content: cleaned, usage, model };
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

// --- Validation (required keys for employee/department output) ---

const EMPLOYEE_KEYS = [
  'interpretareHtml',
  'concluziiHtml',
  'actiuniHtml',
  'planHtml',
];

function validateEmployeeOutput(obj) {
  if (!obj || typeof obj !== 'object') {
    throw new Error('LLM output is not a valid object');
  }
  for (const key of EMPLOYEE_KEYS) {
    const val = obj[key];
    if (val == null || typeof val !== 'string' || !String(val).trim()) {
      throw new Error(
        `LLM output missing or empty required key: ${key}. Monthly job fails without valid analysis.`
      );
    }
  }
  return {
    interpretareHtml: String(obj.interpretareHtml).trim(),
    concluziiHtml: String(obj.concluziiHtml).trim(),
    actiuniHtml: String(obj.actiuniHtml).trim(),
    planHtml: String(obj.planHtml).trim(),
  };
}

const DEPARTMENT_KEYS = [
  'rezumatExecutivHtml',
  'vanzariHtml',
  'operationalHtml',
  'comparatiiHtml',
  'recomandariHtml',
];

function validateDepartmentOutput(obj) {
  if (!obj || typeof obj !== 'object') {
    throw new Error('LLM department output is not a valid object');
  }
  for (const key of DEPARTMENT_KEYS) {
    const val = obj[key];
    if (val == null || typeof val !== 'string' || !String(val).trim()) {
      throw new Error(
        `LLM department output missing or empty required key: ${key}. Monthly job fails without valid analysis.`
      );
    }
  }
  return {
    rezumatExecutivHtml: String(obj.rezumatExecutivHtml).trim(),
    vanzariHtml: String(obj.vanzariHtml).trim(),
    operationalHtml: String(obj.operationalHtml).trim(),
    comparatiiHtml: String(obj.comparatiiHtml).trim(),
    recomandariHtml: String(obj.recomandariHtml).trim(),
  };
}

const EMPLOYEE_JSON_INSTRUCTION = `
Răspunde EXCLUSIV în JSON valid, cu exact aceste chei (conținut HTML valid, inline styles permis):
- interpretareHtml: secțiunea Interpretare date (HTML, paragrafe/lista)
- concluziiHtml: secțiunea Concluzii (HTML)
- actiuniHtml: secțiunea Acțiuni prioritare (HTML, listă numerotată)
- planHtml: secțiunea Plan săptămânal (HTML)
Fără alte chei. Conținutul trebuie să facă referire la cifrele din input.`;

const DEPARTMENT_JSON_INSTRUCTION = `
Răspunde EXCLUSIV în JSON valid, cu exact aceste chei (conținut HTML valid, inline styles permis):
- rezumatExecutivHtml: Rezumat executiv (HTML)
- vanzariHtml: Analiză Vânzări (HTML)
- operationalHtml: Analiză Operațional (HTML)
- comparatiiHtml: Comparații (HTML)
- recomandariHtml: Recomandări (HTML)
Fără alte chei. Conținutul trebuie să facă referire la datele din input.`;

/**
 * Generate monthly employee sections (interpretare, concluzii, acțiuni, plan). Fail fast if output invalid.
 * One repair retry on schema validation failure.
 */
export async function generateMonthlySections({ systemPrompt, inputJson }) {
  if (process.env.NODE_ENV !== 'production') {
    console.log('[LLM] GENERATE EMPLOYEE SECTIONS START', {
      model: getModel(),
      timestamp: new Date().toISOString(),
    });
  }
  const userPayload = EMPLOYEE_JSON_INSTRUCTION.trim() + '\n\nDate pentru analiză (JSON):\n' + JSON.stringify(inputJson, null, 2);

  const tryParseAndValidate = (raw) => {
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (_) {
      throw new Error('LLM response is not valid JSON. Monthly job fails.');
    }
    return validateEmployeeOutput(parsed);
  };

  const { content, usage, model } = await callOpenRouterJson({
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPayload },
    ],
    operationName: 'employee',
  });

  try {
    const result = tryParseAndValidate(content);
    if (process.env.NODE_ENV !== 'production') {
      console.log('[llm] model=' + model + ', usage=' + (usage ? JSON.stringify(usage) : '') + ', ok');
    }
    return result;
  } catch (schemaErr) {
    if (process.env.NODE_ENV === 'production') {
      console.error('[LLM audit] employee schema validation failed', {
        attempt: 1,
        message: schemaErr?.message ?? String(schemaErr),
      });
    } else {
      console.error('[LLM audit] model did not respect schema; raw body (max ' + RAW_BODY_LOG_MAX + ' chars):', String(content).slice(0, RAW_BODY_LOG_MAX));
    }
    const { content: repairContent } = await callOpenRouterJson({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPayload + SCHEMA_REPAIR_APPEND },
      ],
      operationName: 'employee',
    });
    try {
      const result = tryParseAndValidate(repairContent);
      if (process.env.NODE_ENV !== 'production') {
        console.log('[llm] model= ok (after schema repair retry)');
      }
      return result;
    } catch (repairErr) {
      if (process.env.NODE_ENV === 'production') {
        console.error('[LLM audit] employee schema validation failed', {
          attempt: 2,
          message: repairErr?.message ?? String(repairErr),
        });
      } else {
        console.error('[LLM audit] model did not respect schema after repair; raw body (max ' + RAW_BODY_LOG_MAX + ' chars):', String(repairContent).slice(0, RAW_BODY_LOG_MAX));
      }
      throw repairErr;
    }
  }
}

/**
 * Generate monthly department/management sections. Fail fast if output invalid.
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
  const userPayload = DEPARTMENT_JSON_INSTRUCTION.trim() + '\n\nDate pentru analiză (JSON, 3 luni):\n' + JSON.stringify(inputJson, null, 2);

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

  const { content, usage, model } = await callOpenRouterJson({
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPayload },
    ],
    operationName: 'department',
  });

  try {
    const result = tryParseAndValidate(content);
    if (process.env.NODE_ENV !== 'production') {
      console.log('[llm] model=' + model + ', usage=' + (usage ? JSON.stringify(usage) : '') + ', ok');
    }
    return result;
  } catch (schemaErr) {
    if (process.env.NODE_ENV === 'production') {
      console.error('[LLM audit] department schema validation failed', {
        attempt: 1,
        message: schemaErr?.message ?? String(schemaErr),
      });
    } else {
      console.error('[LLM audit] model did not respect department schema; raw body (max ' + RAW_BODY_LOG_MAX + ' chars):', String(content).slice(0, RAW_BODY_LOG_MAX));
    }
    const { content: repairContent } = await callOpenRouterJson({
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
      return result;
    } catch (repairErr) {
      if (process.env.NODE_ENV === 'production') {
        console.error('[LLM audit] department schema validation failed', {
          attempt: 2,
          message: repairErr?.message ?? String(repairErr),
        });
      } else {
        console.error('[LLM audit] model did not respect department schema after repair; raw body (max ' + RAW_BODY_LOG_MAX + ' chars):', String(repairContent).slice(0, RAW_BODY_LOG_MAX));
      }
      throw repairErr;
    }
  }
}
