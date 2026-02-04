/**
 * Vertex AI (Gemini) client for monthly report analysis. Same public API as before.
 * Authenticates via IAM (no API key). Requires GOOGLE_CLOUD_PROJECT or GCLOUD_PROJECT.
 * Retry on transient failures and on JSON parse failure (with stricter prompt).
 */

import { VertexAI } from '@google-cloud/vertexai';

const DEFAULT_MODEL = 'gemini-1.5-pro';
const DEFAULT_LOCATION = 'europe-west1';
const MAX_ATTEMPTS = 3;
const INITIAL_BACKOFF_MS = 2000;
const STRICT_JSON_APPEND = '\n\nRăspunde DOAR cu un obiect JSON valid, fără markdown, fără text înainte sau după.';

function getProject() {
  const project = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT;
  if (!project || typeof project !== 'string' || !project.trim()) {
    throw new Error(
      'Vertex AI requires a GCP project. Set GOOGLE_CLOUD_PROJECT or GCLOUD_PROJECT (Cloud Run sets this automatically).'
    );
  }
  return project.trim();
}

function getVertexConfig() {
  return {
    project: getProject(),
    location: (process.env.VERTEX_LOCATION || DEFAULT_LOCATION).trim(),
    model: (process.env.GEMINI_MODEL || DEFAULT_MODEL).trim(),
  };
}

/**
 * Check if Vertex AI is configured (for job to fail fast before sending).
 * Validates that runtime has GCP project ID (e.g. on Cloud Run).
 */
export function requireOpenAI() {
  getProject();
}

function getModel() {
  return (process.env.GEMINI_MODEL || DEFAULT_MODEL).trim();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function isRetryableError(err) {
  const code = err?.code || err?.status;
  const message = err?.message || '';
  if (typeof code === 'number' && (code === 429 || (code >= 500 && code < 600))) return true;
  if (/RESOURCE_EXHAUSTED|UNAVAILABLE|DEADLINE_EXCEEDED|INTERNAL/i.test(String(code))) return true;
  if (/rate limit|429|timeout|ECONNRESET|ETIMEDOUT/i.test(message)) return true;
  return false;
}

/**
 * Convert OpenAI-style messages to Gemini request: systemInstruction + user content.
 * @param {{ role: string, content: string }[]} messages
 * @returns {{ systemInstruction: string, userContent: string }}
 */
function messagesToPrompt(messages) {
  let systemPrompt = '';
  let userContent = '';
  for (const m of messages) {
    const text = (m.content && String(m.content).trim()) || '';
    if (m.role === 'system') systemPrompt = systemPrompt ? systemPrompt + '\n\n' + text : text;
    else if (m.role === 'user') userContent = userContent ? userContent + '\n\n' + text : text;
  }
  return { systemInstruction: systemPrompt || 'You are a helpful assistant.', userContent: userContent || '' };
}

/**
 * Call Vertex AI Gemini with JSON output. Retries on transient errors and on JSON parse failure.
 * @param {{ model?: string, messages: { role: string, content: string }[] }} opts
 * @returns {{ content: string, usage?: object, model: string }}
 */
async function callGeminiJson({ model, messages }) {
  const config = getVertexConfig();
  const modelName = model || config.model;
  const { systemInstruction, userContent } = messagesToPrompt(messages);

  const vertexAI = new VertexAI({ project: config.project, location: config.location });
  const generativeModel = vertexAI.getGenerativeModel({
    model: modelName,
    generationConfig: {
      responseMimeType: 'application/json',
      maxOutputTokens: 8192,
    },
  });

  let lastParseError = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const systemText = attempt === 1 ? systemInstruction : systemInstruction + STRICT_JSON_APPEND;
      const request = {
        contents: [{ role: 'user', parts: [{ text: userContent }] }],
        systemInstruction: { role: 'system', parts: [{ text: systemText }] },
      };

      const result = await generativeModel.generateContent(request);
      const response = result?.response;
      if (!response?.candidates?.[0]?.content?.parts?.[0]?.text) {
        const feedback = response?.promptFeedback;
        throw new Error(feedback ? `Vertex AI prompt feedback: ${JSON.stringify(feedback)}` : 'Vertex AI response missing text');
      }

      const content = response.candidates[0].content.parts[0].text;
      const usage = response.usageMetadata
        ? {
            promptTokenCount: response.usageMetadata.promptTokenCount,
            candidatesTokenCount: response.usageMetadata.candidatesTokenCount,
            totalTokenCount: response.usageMetadata.totalTokenCount,
          }
        : undefined;

      try {
        JSON.parse(content);
      } catch (parseErr) {
        lastParseError = parseErr;
        if (attempt < MAX_ATTEMPTS) {
          if (process.env.NODE_ENV !== 'production') {
            console.log('[llm] JSON parse failed, attempt ' + attempt + '/' + MAX_ATTEMPTS + ', retrying with stricter instruction');
          }
          await sleep(INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1));
          continue;
        }
        throw new Error('LLM response is not valid JSON. Monthly job fails.');
      }

      if (process.env.NODE_ENV !== 'production' && attempt > 1) {
        console.log('[llm] model=' + modelName + ' attempts=' + attempt);
      }
      return { content, usage, model: modelName };
    } catch (err) {
      if (!isRetryableError(err) || attempt >= MAX_ATTEMPTS) throw err;
      const delay = INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1);
      if (process.env.NODE_ENV !== 'production') {
        console.log('[llm] transient error attempt ' + attempt + '/' + MAX_ATTEMPTS + ' delay=' + delay + 'ms');
      }
      await sleep(delay);
    }
  }

  throw new Error('LLM response is not valid JSON. Monthly job fails.');
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
  const { content, usage, model } = await callGeminiJson({
    model: getModel(),
    messages: [
      { role: 'system', content: systemPrompt + '\n\n' + EMPLOYEE_JSON_INSTRUCTION },
      { role: 'user', content: `Date pentru analiză (JSON):\n${JSON.stringify(inputJson, null, 2)}` },
    ],
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
  const { content, usage, model } = await callGeminiJson({
    model: getModel(),
    messages: [
      { role: 'system', content: systemPrompt + '\n\n' + DEPARTMENT_JSON_INSTRUCTION },
      { role: 'user', content: `Date pentru analiză (JSON, 3 luni):\n${JSON.stringify(inputJson, null, 2)}` },
    ],
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
