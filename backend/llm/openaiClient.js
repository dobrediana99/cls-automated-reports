/**
 * OpenAI API client for monthly report analysis. Server-side only; Bearer OPENAI_API_KEY.
 * Timeout + retry on 429/5xx. Strict JSON output validation (fail fast on missing/empty keys).
 */

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_MODEL = 'gpt-4.1-mini';
const TIMEOUT_MS = 90_000;
const MAX_ATTEMPTS = 3;
const INITIAL_BACKOFF_MS = 2000;

function getApiKey() {
  const key = process.env.OPENAI_API_KEY;
  if (!key || typeof key !== 'string' || !key.trim()) {
    throw new Error('OPENAI_API_KEY is not set. Monthly job requires OpenAI for analysis.');
  }
  return key.trim();
}

function getModel() {
  return process.env.OPENAI_MODEL?.trim() || DEFAULT_MODEL;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function isRetryableStatus(status) {
  return status === 429 || (status >= 500 && status < 600);
}

/**
 * Call OpenAI chat completions with JSON mode. Retries on 429/5xx.
 * @param {{ systemPrompt: string, userContent: string, model?: string }} opts
 * @returns {{ content: string, usage?: object, model: string }}
 */
async function chatCompletion(opts) {
  const apiKey = getApiKey();
  const model = opts.model ?? getModel();
  const messages = [
    { role: 'system', content: opts.systemPrompt },
    { role: 'user', content: opts.userContent },
  ];

  let lastError;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const response = await fetch(OPENAI_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages,
          response_format: { type: 'json_object' },
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        const err = new Error(data.error?.message || `OpenAI HTTP ${response.status}`);
        err.status = response.status;
        if (isRetryableStatus(response.status) && attempt < MAX_ATTEMPTS) {
          const delay = INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1);
          await sleep(delay);
          continue;
        }
        throw err;
      }

      const content = data.choices?.[0]?.message?.content;
      if (content == null || typeof content !== 'string') {
        throw new Error('OpenAI response missing choices[0].message.content');
      }

      return {
        content,
        usage: data.usage,
        model: data.model || model,
      };
    } catch (err) {
      lastError = err;
      if (err.name === 'AbortError') {
        lastError = new Error('OpenAI request timeout');
      }
      if (attempt < MAX_ATTEMPTS && (err.status && isRetryableStatus(err.status))) {
        const delay = INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1);
        await sleep(delay);
        continue;
      }
      throw lastError;
    }
  }

  throw lastError;
}

const EMPLOYEE_KEYS = ['interpretareHtml', 'concluziiHtml', 'actiuniHtml', 'planHtml'];

function validateEmployeeOutput(obj) {
  if (!obj || typeof obj !== 'object') {
    throw new Error('LLM output is not a valid object');
  }
  for (const key of EMPLOYEE_KEYS) {
    const val = obj[key];
    if (val == null || typeof val !== 'string' || !String(val).trim()) {
      throw new Error(`LLM output missing or empty required key: ${key}. Monthly job fails without valid analysis.`);
    }
  }
  return {
    interpretareHtml: String(obj.interpretareHtml).trim(),
    concluziiHtml: String(obj.concluziiHtml).trim(),
    actiuniHtml: String(obj.actiuniHtml).trim(),
    planHtml: String(obj.planHtml).trim(),
  };
}

const DEPARTMENT_KEYS = ['rezumatExecutivHtml', 'vanzariHtml', 'operationalHtml', 'comparatiiHtml', 'recomandariHtml'];

function validateDepartmentOutput(obj) {
  if (!obj || typeof obj !== 'object') {
    throw new Error('LLM department output is not a valid object');
  }
  for (const key of DEPARTMENT_KEYS) {
    const val = obj[key];
    if (val == null || typeof val !== 'string' || !String(val).trim()) {
      throw new Error(`LLM department output missing or empty required key: ${key}. Monthly job fails without valid analysis.`);
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
 * @param {{ systemPrompt: string, inputJson: object }} opts - systemPrompt from monthlyEmployeePrompt.md; inputJson = data for the employee
 * @returns {{ interpretareHtml: string, concluziiHtml: string, actiuniHtml: string, planHtml: string }}
 */
export async function generateMonthlySections({ systemPrompt, inputJson }) {
  const { content, usage, model } = await chatCompletion({
    systemPrompt: systemPrompt + '\n\n' + EMPLOYEE_JSON_INSTRUCTION,
    userContent: `Date pentru analiză (JSON):\n${JSON.stringify(inputJson, null, 2)}`,
  });

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (_) {
    throw new Error('LLM response is not valid JSON. Monthly job fails.');
  }

  const result = validateEmployeeOutput(parsed);
  if (process.env.NODE_ENV !== 'production') {
    console.log('[llm] model=' + model + ', usage=' + (usage ? JSON.stringify(usage) : '') + ', ok');
  }
  return result;
}

/**
 * Generate monthly department/management sections. Fail fast if output invalid.
 * @param {{ systemPrompt: string, inputJson: object }} opts - systemPrompt from monthlyDepartmentPrompt.md; inputJson = 3 months data
 * @returns {{ rezumatExecutivHtml: string, vanzariHtml: string, operationalHtml: string, comparatiiHtml: string, recomandariHtml: string }}
 */
export async function generateMonthlyDepartmentSections({ systemPrompt, inputJson }) {
  const { content, usage, model } = await chatCompletion({
    systemPrompt: systemPrompt + '\n\n' + DEPARTMENT_JSON_INSTRUCTION,
    userContent: `Date pentru analiză (JSON, 3 luni):\n${JSON.stringify(inputJson, null, 2)}`,
  });

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (_) {
    throw new Error('LLM department response is not valid JSON. Monthly job fails.');
  }

  const result = validateDepartmentOutput(parsed);
  if (process.env.NODE_ENV !== 'production') {
    console.log('[llm] model=' + model + ', usage=' + (usage ? JSON.stringify(usage) : '') + ', ok');
  }
  return result;
}

/**
 * Check if OpenAI is configured (for job to fail fast before sending).
 */
export function requireOpenAI() {
  getApiKey();
}
