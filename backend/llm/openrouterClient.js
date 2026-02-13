/**
 * OpenRouter (Claude Opus 4.6) client for monthly report analysis.
 * Uses Chat Completions API. Requires OPENROUTER_API_KEY.
 * Env: OPENROUTER_API_KEY (required), OPENROUTER_MODEL, OPENROUTER_HTTP_REFERER, OPENROUTER_X_TITLE.
 * Retry on 408, 409, 429, 5xx and on JSON parse failure (with stricter prompt).
 * LLM audit logging: requestedModel, returnedModel, hasKey, prompt hashes/previews, usage (no secrets).
 */

import crypto from 'crypto';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_MODEL = 'anthropic/claude-opus-4.6';
const MAX_ATTEMPTS = 3;
const INITIAL_BACKOFF_MS = 2000;
const MAX_TOKENS = 8192;
const STRICT_JSON_APPEND =
  '\n\nReturn ONLY valid JSON object, no markdown, no extra text.';
const PREVIEW_LEN = 200;
const RAW_BODY_LOG_MAX = 2048;

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
 * Call OpenRouter Chat Completions with JSON output. Retries on transient errors and on JSON parse failure.
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

      const body = {
        model,
        messages: apiMessages,
        response_format: { type: 'json_object' },
        max_tokens: MAX_TOKENS,
      };

      if (attempt === 1) {
        const inputJson = body;
        const systemPromptHash = sha256(systemContent);
        const systemPromptPreview = previewText(systemContent);
        const inputJsonHash = sha256(JSON.stringify(inputJson));
        console.log('[LLM audit] request', {
          requestId,
          requestedModel: model,
          endpoint: OPENROUTER_URL,
          hasKey,
          systemPromptHash,
          systemPromptPreview,
          inputJsonHash,
        });
      }

      console.log('[OPENROUTER] REQUEST', {
        model: getModel(),
        hasKey: Boolean(process.env.OPENROUTER_API_KEY),
        messageCount: Array.isArray(body?.messages) ? body.messages.length : null,
        timestamp: new Date().toISOString(),
      });

      const res = await fetch(OPENROUTER_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });

      console.log('[OPENROUTER] RESPONSE', {
        status: res.status,
        ok: res.ok,
        timestamp: new Date().toISOString(),
      });

      const status = res.status;
      if (!res.ok) {
        const text = await res.text();
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
          continue;
        }
        logOpenRouterError(model, err, operationName);
        throw err;
      }

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
        status,
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

      try {
        JSON.parse(content);
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
          continue;
        }
        const rawPreview = String(content).slice(0, RAW_BODY_LOG_MAX);
        console.error('[LLM audit] model did not return valid JSON; raw body (max ' + RAW_BODY_LOG_MAX + ' chars):', rawPreview);
        throw new Error(
          'LLM response is not valid JSON. Monthly job fails.'
        );
      }

      if (process.env.NODE_ENV !== 'production' && attempt > 1) {
        console.log('[llm] model=' + model + ' attempts=' + attempt);
      }
      return { content, usage, model };
    } catch (err) {
      console.error('[OPENROUTER] ERROR', {
        message: err?.message ?? String(err),
        stack: err?.stack ?? undefined,
        timestamp: new Date().toISOString(),
      });
      const status = err?.status ?? err?.statusCode;
      const isRetryable =
        isRetryableStatus(status) ||
        /rate limit|429|timeout|ECONNRESET|ETIMEDOUT|fetch failed/i.test(
          err?.message ?? ''
        );
      if (!isRetryable || attempt >= MAX_ATTEMPTS) {
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
            'ms'
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
 */
export async function generateMonthlySections({ systemPrompt, inputJson }) {
  console.log('[LLM] GENERATE EMPLOYEE SECTIONS START', {
    model: getModel(),
    timestamp: new Date().toISOString(),
  });
  const userPayload = EMPLOYEE_JSON_INSTRUCTION.trim() + '\n\nDate pentru analiză (JSON):\n' + JSON.stringify(inputJson, null, 2);
  const { content, usage, model } = await callOpenRouterJson({
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPayload },
    ],
    operationName: 'employee',
  });

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (_) {
    throw new Error('LLM response is not valid JSON. Monthly job fails.');
  }

  let result;
  try {
    result = validateEmployeeOutput(parsed);
  } catch (schemaErr) {
    const rawPreview = String(content).slice(0, RAW_BODY_LOG_MAX);
    console.error('[LLM audit] model did not respect schema; raw body (max ' + RAW_BODY_LOG_MAX + ' chars):', rawPreview);
    throw schemaErr;
  }
  if (process.env.NODE_ENV !== 'production') {
    console.log(
      '[llm] model=' + model + ', usage=' + (usage ? JSON.stringify(usage) : '') + ', ok'
    );
  }
  return result;
}

/**
 * Generate monthly department/management sections. Fail fast if output invalid.
 */
export async function generateMonthlyDepartmentSections({
  systemPrompt,
  inputJson,
}) {
  console.log('[LLM] GENERATE DEPARTMENT SECTIONS START', {
    model: getModel(),
    timestamp: new Date().toISOString(),
  });
  const userPayload = DEPARTMENT_JSON_INSTRUCTION.trim() + '\n\nDate pentru analiză (JSON, 3 luni):\n' + JSON.stringify(inputJson, null, 2);
  const { content, usage, model } = await callOpenRouterJson({
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPayload },
    ],
    operationName: 'department',
  });

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (_) {
    throw new Error(
      'LLM department response is not valid JSON. Monthly job fails.'
    );
  }

  let result;
  try {
    result = validateDepartmentOutput(parsed);
  } catch (schemaErr) {
    const rawPreview = String(content).slice(0, RAW_BODY_LOG_MAX);
    console.error('[LLM audit] model did not respect department schema; raw body (max ' + RAW_BODY_LOG_MAX + ' chars):', rawPreview);
    throw schemaErr;
  }
  if (process.env.NODE_ENV !== 'production') {
    console.log(
      '[llm] model=' + model + ', usage=' + (usage ? JSON.stringify(usage) : '') + ', ok'
    );
  }
  return result;
}
