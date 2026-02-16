# OpenRouter / Claude – integrare și entry points

**Fișier principal:** `backend/llm/openrouterClient.js`

---

## A. Entry points – unde e integrarea OpenRouter

### Căutare: openrouter.ai, OPENROUTER, anthropic/, claude, response_format, Authorization: Bearer

| String | Fișier(e) | Context |
|--------|-----------|---------|
| `openrouter.ai` | `backend/llm/openrouterClient.js` (URL), `backend/ENV.md`, `README.md`, `monthly.test.js` | URL endpoint, documentație, mesaj eroare |
| `OPENROUTER` | `openrouterClient.js`, `backend/index.js`, `backend/jobs/monthly.js`, `backend/ENV.md`, `README.md`, `docs/AUDIT-MONTHLY-LLM.md`, `monthly.test.js`, `buildMonthlySnapshot.js` | Env vars, log, debug |
| `anthropic/` | `openrouterClient.js` (DEFAULT_MODEL), `README.md`, `ENV.md`, `buildMonthlySnapshot.js` | Model default |
| `claude` | Comentarii / doc (Claude Opus 4.6) | — |
| `response_format` | `openrouterClient.js` linia 148 | Body request: `response_format: { type: 'json_object' }` |
| `Authorization: Bearer` | `openrouterClient.js` linia 55: `Authorization: \`Bearer ${apiKey}\`` | Header pentru OpenRouter (nu OIDC) |

**Notă:** `Authorization: Bearer <id_token>` din README/SPEC se referă la **OIDC** pentru `/run/weekly` și `/run/monthly`, nu la OpenRouter.

---

### Fișiere implicate

| Fișier | Rol |
|--------|-----|
| **backend/llm/openrouterClient.js** | Singurul modul care face HTTP către OpenRouter; conține URL, headers, body, retry, parse, validare. |
| backend/jobs/monthly.js | Apelează `requireOpenRouter`, `generateMonthlySections`, `generateMonthlyDepartmentSections`. |
| backend/index.js | Folosește `getModel()` pentru `GET /debug/llm`. |
| backend/prompts/loadPrompts.js | Încarcă prompturile; nu apelează OpenRouter. |
| backend/report/buildMonthlySnapshot.js | Doar notează în metadata numele modelului; nu face request. |
| backend/ENV.md, README.md | Documentație env. |
| backend/jobs/monthly.test.js | Mock pentru openrouterClient. |

---

### Funcții exportate din openrouterClient.js

| Funcție | Apelată din | Scop |
|---------|-------------|------|
| **requireOpenRouter()** | `openrouterClient.js` (în callOpenRouterJson), **jobs/monthly.js** (linia 139) | Verifică OPENROUTER_API_KEY; aruncă dacă lipsește. |
| **getModel()** | `openrouterClient.js` (callOpenRouterJson, generateMonthly*, log), **backend/index.js** (GET /debug/llm) | Returnează modelul efectiv (env sau default). |
| **generateMonthlySections({ systemPrompt, inputJson })** | **jobs/monthly.js** (linia 163, în bucla pe activePeople) | Secțiuni LLM per angajat (interpretare, concluzii, acțiuni, plan). |
| **generateMonthlyDepartmentSections({ systemPrompt, inputJson })** | **jobs/monthly.js** (linia 238) | Secțiuni LLM pentru raport management (rezumat, vânzări, operațional, comparații, recomandări). |

**Nu sunt exportate:** `callOpenRouterJson`, `getHeaders`, `normalizeMessages`, `validateEmployeeOutput`, `validateDepartmentOutput`.

---

### Lanț de apeluri (call chain)

```
POST /run/monthly (backend/index.js)
  → runJobWithIdempotency('monthly', ..., runMonthly)
  → runMonthly() (backend/jobs/monthly.js)
      → requireOpenRouter()                    [openrouterClient.js]
      → loadMonthlyEmployeePrompt()            [prompts/loadPrompts.js]
      → loadMonthlyDepartmentPrompt()         [prompts/loadPrompts.js]
      → for each activePerson:
            generateMonthlySections({ systemPrompt: employeePrompt, inputJson })
              → callOpenRouterJson({ messages, operationName: 'employee' })   [internal]
              → fetch(OPENROUTER_URL, { method: 'POST', headers, body })
              → JSON.parse(content) + validateEmployeeOutput(parsed)
      → generateMonthlyDepartmentSections({ systemPrompt: departmentPrompt, inputJson })
              → callOpenRouterJson({ messages, operationName: 'department' })
              → fetch(...) + JSON.parse(content) + validateDepartmentOutput(parsed)
      → buildMonthlyEmployeeEmail(..., llmSections) / buildMonthlyDepartmentEmail(..., llmSections)
```

```
GET /debug/llm (backend/index.js)
  → getModel()           [openrouterClient.js]
  → getPromptPaths()     [loadPrompts.js]
  → loadMonthlyEmployeePrompt() / loadMonthlyDepartmentPrompt()
```

---

## B. Construirea request-ului (model, headers, body)

**Fișier:** `backend/llm/openrouterClient.js`. Request-ul este construit în **callOpenRouterJson** (aprox. linii 121–177).

### Sursa modelului

- **Variabilă de mediu:** `OPENROUTER_MODEL`.
- **Default în cod:** `DEFAULT_MODEL = 'anthropic/claude-opus-4.6'` (linia 12).
- **Logică:** `getModel()` returnează `(process.env.OPENROUTER_MODEL || '').trim() || DEFAULT_MODEL` (linii 48–50). Dacă env e gol sau doar spații, se folosește Claude Opus 4.6.

### Câmpuri body (request)

| Câmp | Valoare | Observații |
|------|--------|------------|
| **model** | `getModel()` | Vezi mai sus. |
| **messages** | Array OpenAI-style | `[{ role: 'system', content: systemContent }, { role: 'user', content: userContent }]`. User content la retry după JSON invalid: se adaugă `STRICT_JSON_APPEND`. |
| **response_format** | `{ type: 'json_object' }` | Forțează răspuns JSON. |
| **max_tokens** | `8192` | Constantă `MAX_TOKENS` (linia 15). |

**Nu se trimit:** `temperature`, `top_p`, `stream`, sau alte câmpuri.

### Headers

| Header | Sursă | Obligatoriu? |
|--------|--------|--------------|
| **Authorization** | `Bearer ${apiKey}` (apiKey = requireOpenRouter()) | Da |
| **Content-Type** | `application/json` | Da |
| **HTTP-Referer** | `process.env.OPENROUTER_HTTP_REFERER?.trim()` | Nu (doar dacă setat) |
| **X-Title** | `process.env.OPENROUTER_X_TITLE?.trim()` | Nu (doar dacă setat) |

Funcția **getHeaders(apiKey)** (linii 53–67) construiește obiectul.

### Tratarea răspunsurilor non-200

- **res.ok === false:** se citește `await res.text()`, se construiește eroare cu `err.status` / `err.statusCode` și `err.body`.
- **Retry:** dacă `isRetryableStatus(status)` (408, 409, 429, 5xx) și `attempt < MAX_ATTEMPTS` (3), se așteaptă `INITIAL_BACKOFF_MS * 2^(attempt-1)` și se reia bucla.
- **Fără retry:** se apelează `logOpenRouterError(model, err, operationName)` și se face `throw err`.
- **Răspuns 200 dar fără content:** dacă `data?.choices?.[0]?.message?.content` lipsește sau nu e string, se aruncă `'OpenRouter response missing choices[0].message.content'`.
- **Erori în catch (rețea etc.):** dacă `isRetryable` (status retryable sau mesaj conține rate limit/429/timeout/ECONNRESET/ETIMEDOUT/fetch failed) și mai sunt încercări, se face sleep + retry; altfel se loghează și se aruncă eroarea.

---

## C. Variantă API: Chat Completions vs Responses

- **Endpoint folosit:** `https://openrouter.ai/api/v1/chat/completions` (constantă `OPENROUTER_URL`, linia 11).
- Deci se folosește **Chat Completions** (OpenAI-compatible), **nu** `/api/v1/responses`.

**Structură request:** se folosește **messages** (array de `{ role, content }`), nu `input`.

**Extragerea output-ului:** din răspunsul JSON al API-ului:
- `content = data?.choices?.[0]?.message?.content` (linia 236).
- Este un string (JSON serializat); se parsează cu `JSON.parse(content)` și apoi se validează cu funcții interne (validateEmployeeOutput / validateDepartmentOutput). Nu există câmp `output` sau `choices[0].message` în alt format.

---

## D. Parsing JSON și comportament la output invalid

Toate utilizările lui **JSON.parse** pe output-ul LLM sunt în **backend/llm/openrouterClient.js**. Nu există zod/ajv; validarea este manuală (liste de chei obligatorii + tip string non-gol).

---

### 1) callOpenRouterJson – verificare „probe” (linii 244–265)

| Aspect | Detaliu |
|--------|---------|
| **Fișier** | `backend/llm/openrouterClient.js` |
| **Ce se parsează** | `content` – stringul brut `data.choices[0].message.content` (nu substring, întregul răspuns). |
| **La eșec parse** | Se salvează `lastParseError`; dacă `attempt < MAX_ATTEMPTS` (3): log „JSON parse failed, attempt…”, sleep cu backoff, **retry** cu același request dar user content având adăugat `STRICT_JSON_APPEND` (încercarea 2 și 3). După ultima încercare: log raw body (primele RAW_BODY_LOG_MAX caractere), apoi **throw** `'LLM response is not valid JSON. Monthly job fails.'`. |
| **Schema validation** | None aici (doar verificare că e JSON valid). |

---

### 2) generateMonthlySections (linii 406–418)

| Aspect | Detaliu |
|--------|---------|
| **Fișier** | `backend/llm/openrouterClient.js` |
| **Ce se parsează** | `content` – același string returnat de `callOpenRouterJson`. |
| **La eșec parse** | **Throw** imediat: `'LLM response is not valid JSON. Monthly job fails.'` (fără retry în această funcție). |
| **După parse** | `validateEmployeeOutput(parsed)` – validare manuală: obiect + chei `interpretareHtml`, `concluziiHtml`, `actiuniHtml`, `planHtml` (fiecare string non-gol). La eșec: log raw body, **throw** schemaErr. |
| **Schema validation** | **None** (fără zod/ajv). Validare manuală: `validateEmployeeOutput` (liste EMPLOYEE_KEYS + tip string trim). |

---

### 3) generateMonthlyDepartmentSections (linii 449–463)

| Aspect | Detaliu |
|--------|---------|
| **Fișier** | `backend/llm/openrouterClient.js` |
| **Ce se parsează** | `content` – stringul returnat de `callOpenRouterJson`. |
| **La eșec parse** | **Throw**: `'LLM department response is not valid JSON. Monthly job fails.'` (fără retry aici). |
| **După parse** | `validateDepartmentOutput(parsed)` – chei: `rezumatExecutivHtml`, `vanzariHtml`, `operationalHtml`, `comparatiiHtml`, `recomandariHtml` (string non-gol). La eșec: log raw body, **throw** schemaErr. |
| **Schema validation** | **None** (fără zod/ajv). Validare manuală: `validateDepartmentOutput` (DEPARTMENT_KEYS + string trim). |

---

### Rezumat D

| Locație | Ce se parsează | La parse failure | Schema |
|---------|----------------|------------------|--------|
| **callOpenRouterJson** (linii 244–265) | `content` (raw) | Retry până la 3 cu STRICT_JSON_APPEND; apoi throw | None |
| **generateMonthlySections** (linii 406–418) | `content` (raw) | Throw imediat | Manuală (validateEmployeeOutput), no zod/ajv |
| **generateMonthlyDepartmentSections** (linii 449–463) | `content` (raw) | Throw imediat | Manuală (validateDepartmentOutput), no zod/ajv |

Niciunde nu există fallback pe output invalid; job-ul monthly eșuează (throw) și nu se trimite email.
