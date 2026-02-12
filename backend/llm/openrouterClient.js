/**
 * OpenRouter (Claude Opus 4.6) client for monthly report analysis.
 * Uses Chat Completions API. Requires OPENROUTER_API_KEY.
 * Env: OPENROUTER_API_KEY (required), OPENROUTER_MODEL, OPENROUTER_HTTP_REFERER, OPENROUTER_X_TITLE.
 * Retry on 408, 409, 429, 5xx and on JSON parse failure (with stricter prompt).
 */

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_MODEL = 'anthropic/claude-opus-4.6';
const MAX_ATTEMPTS = 3;
const INITIAL_BACKOFF_MS = 2000;
const MAX_TOKENS = 8192;
const STRICT_JSON_APPEND =
  '\n\nReturn ONLY valid JSON object, no markdown, no extra text.';

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

function getModel() {
  return (process.env.OPENROUTER_MODEL || DEFAULT_MODEL).trim();
}

function getHeaders(apiKey) {
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };
  const referer = process.env.OPENROUTER_HTTP_REFERER;
  if (referer && typeof referer === 'string' && referer.trim()) {
    headers['HTTP-Referer'] = referer.trim();
  }
  const title = process.env.OPENROUTER_X_TITLE;
  if (title && typeof title === 'string' && title.trim()) {
    headers['X-Title'] = title.trim();
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
  const headers = getHeaders(apiKey);
  const normalizedMessages = normalizeMessages(messages);

  let lastParseError = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const systemMsg = normalizedMessages.find((m) => m.role === 'system');
      const userMsg = normalizedMessages.find((m) => m.role === 'user');
      const systemContent =
        attempt === 1
          ? (systemMsg?.content ?? '')
          : (systemMsg?.content ?? '') + STRICT_JSON_APPEND;
      const apiMessages = [
        { role: 'system', content: systemContent },
        { role: 'user', content: userMsg?.content ?? '' },
      ];

      const body = {
        model,
        messages: apiMessages,
        response_format: { type: 'json_object' },
        max_tokens: MAX_TOKENS,
      };

      const res = await fetch(OPENROUTER_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
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
      const content = data?.choices?.[0]?.message?.content;
      if (content == null || typeof content !== 'string') {
        throw new Error(
          'OpenRouter response missing choices[0].message.content'
        );
      }

      const usage = data?.usage
        ? {
            prompt_tokens: data.usage.prompt_tokens,
            completion_tokens: data.usage.completion_tokens,
            total_tokens: data.usage.total_tokens,
          }
        : undefined;

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
        throw new Error(
          'LLM response is not valid JSON. Monthly job fails.'
        );
      }

      if (process.env.NODE_ENV !== 'production' && attempt > 1) {
        console.log('[llm] model=' + model + ' attempts=' + attempt);
      }
      return { content, usage, model };
    } catch (err) {
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

// --- Validation (same as vertexClient) ---

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
  const { content, usage, model } = await callOpenRouterJson({
    messages: [
      {
        role: 'system',
        content: systemPrompt + '\n\n' + EMPLOYEE_JSON_INSTRUCTION,
      },
      {
        role: 'user',
        content: `Date pentru analiză (JSON):\n${JSON.stringify(inputJson, null, 2)}`,
      },
    ],
    operationName: 'employee',
  });

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (_) {
    throw new Error('LLM response is not valid JSON. Monthly job fails.');
  }

  const result = validateEmployeeOutput(parsed);
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
  const { content, usage, model } = await callOpenRouterJson({
    messages: [
      {
        role: 'system',
        content: systemPrompt + '\n\n' + DEPARTMENT_JSON_INSTRUCTION,
      },
      {
        role: 'user',
        content: `Date pentru analiză (JSON, 3 luni):\n${JSON.stringify(inputJson, null, 2)}`,
      },
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

  const result = validateDepartmentOutput(parsed);
  if (process.env.NODE_ENV !== 'production') {
    console.log(
      '[llm] model=' + model + ', usage=' + (usage ? JSON.stringify(usage) : '') + ', ok'
    );
  }
  return result;
}
