# Audit complet cost LLM (OpenRouter/Claude) – cls-automated-reports

**Scop:** Identificarea consumului de tokens/cost și a măsurilor de reducere a costului **fără** scăderea calității output-ului și **fără** modificarea logicii de business.

**Data:** 2025-02-16

---

## 1) Harta completă a apelurilor LLM (LLM call map)

| File path | Funcție | operationName | Apeluri per job | Construcție messages |
|-----------|---------|---------------|-----------------|----------------------|
| `backend/llm/openrouterClient.js` | `callOpenRouterJson` | (passthrough) | Invocat de `generateMonthlySections` și `generateMonthlyDepartmentSections` | `normalizeMessages(messages)` → system + user; body = `{ model, messages, max_tokens, response_format? }` |
| `backend/llm/openrouterClient.js` | `generateMonthlySections` | `'employee'` | **1 per persoană activă** (bucla `for (const person of activePeople)` în `backend/jobs/monthly.js` linia 144–164) | **System:** `systemPrompt` = conținut din `loadMonthlyEmployeePrompt()` (fișier `monthlyEmployeePrompt.md`). **User:** `EMPLOYEE_JSON_INSTRUCTION` + `"\n\nDate pentru analiză (JSON):\n"` + `JSON.stringify(inputJson, null, 2)` |
| `backend/llm/openrouterClient.js` | `generateMonthlyDepartmentSections` | `'department'` | **1 per job** (un singur apel în `backend/jobs/monthly.js` linia 238) | **System:** `systemPrompt` = conținut din `loadMonthlyDepartmentPrompt()` (`monthlyDepartmentPrompt.md`). **User:** `DEPARTMENT_JSON_INSTRUCTION` + `"\n\nDate pentru analiză (JSON, 3 luni):\n"` + `JSON.stringify(inputJson, null, 2)` |

**Detalii importante:**

- **Call site employee:** `backend/jobs/monthly.js` linia 163: `await generateMonthlySections({ systemPrompt: employeePrompt, inputJson })`. `employeePrompt` se încarcă o singură dată (linia 138); `inputJson` se construiește în buclă (linii 155–161) per persoană.
- **Call site department:** `backend/jobs/monthly.js` linia 238: `await generateMonthlyDepartmentSections({ systemPrompt: departmentPrompt, inputJson: departmentInputJson })`.
- **Număr total apeluri OpenRouter per job:** `N + 1`, unde `N = activePeople.length` (persoane din `ORG` cu `isActive: true`). În config actual: 3 manageri + 14 angajați = **17 apeluri employee + 1 apel department = 18 apeluri** (plus până la 2 repair retry-uri pe tip dacă validarea schema eșuează).
- **Prompturi:** Încărcate din `backend/prompts/loadPrompts.js` → `monthlyEmployeePrompt.md`, `monthlyDepartmentPrompt.md` (readFileSync, fără cache în memorie între apeluri, dar fișierele sunt citite o dată per job).

---

## 2) Input payload audit

### 2.1 Employee – unde se construiește inputJson

- **Locație:** `backend/jobs/monthly.js` linii 145–161, în bucla pe `activePeople`.
- **Cod relevant:**
  ```js
  const data3Months = {
    current: getPersonRow(reports[0], person),
    prev: getPersonRow(reports[1], person),
    prev2: getPersonRow(reports[2], person),
  };
  const deptKey = departmentToSummaryKey(person.department);
  const deptAverages3Months = {
    current: reportSummaries[0]?.departments?.[deptKey] ?? null,
    prev: reportSummaries[1]?.departments?.[deptKey] ?? null,
    prev2: reportSummaries[2]?.departments?.[deptKey] ?? null,
  };
  const inputJson = {
    person: { name: person.name, department: person.department },
    data3Months,
    deptAverages3Months,
    periodStart: metas[0].periodStart,
  };
  ```

**Schema outline (employee inputJson):**

| Cheie | Tip | Descriere |
|-------|-----|-----------|
| `person` | `{ name, department }` | Identificator angajat |
| `data3Months` | `{ current, prev, prev2 }` | Câte un rând de report per lună (obiecte din `opsStats`/`salesStats`/`mgmtStats`) |
| `deptAverages3Months` | `{ current, prev, prev2 }` | Agregate departament (output `computeTotals`) – același dept pentru toate 3 lunile |
| `periodStart` | string | ISO period start (ex. `"2025-01-01"`) |

**Schema unei rânduri (data3Months.current/prev/prev2)** – din `backend/report/buildReport.js` (generateStats + agregare):

| Câmp | Tip | Volum |
|------|-----|--------|
| `id`, `name`, `mondayId` | string/number | 1 valoare |
| `target` | number | 1 |
| `suppliersAdded`, `ctr_principalCount`, `ctr_principalProfitEur`, `ctr_secondaryCount`, `ctr_secondaryProfitEur` | number | 1 fiecare |
| `livr_principalCount`, `livr_principalProfitEur`, `livr_secondaryCount`, `livr_secondaryProfitEur` | number | 1 fiecare |
| `profitRonRaw`, `websiteCount`, `websiteProfit`, `solicitariCount`, `contactat`, `calificat`, `emailsCount`, `callsCount` | number | 1 fiecare |
| `sumClientTerms`, `countClientTerms`, `sumSupplierTerms`, `countSupplierTerms` | number | 1 fiecare |
| `overdueInvoicesCount`, `supplierTermsUnder30`, `supplierTermsOver30` | number | 1 fiecare |
| `sumProfitability`, `countProfitability`, `websiteCountSec`, `websiteProfitSec` | number | 1 fiecare |
| `burseCountCtrPrincipal`, `burseCountCtrSecondary`, `burseCountLivrPrincipal`, `burseCountLivrSecondary`, `burseCount` | number | 1 fiecare |

**Top 10 câmpuri care pot umfla JSON-ul (employee):**

1. **Repetarea întregii structuri pe 3 luni** – `data3Months.current`, `prev`, `prev2` conțin fiecare ~35+ chei numerice; triplicare = ~105+ chei doar pentru un angajat.
2. **`deptAverages3Months`** – același shape ca un rând (computeTotals), de 3 ori; poate fi redundant dacă promptul folosește doar medii simple.
3. **`JSON.stringify(inputJson, null, 2)`** – pretty-print mărește semnificativ bytes (newline + 2 spații per nivel).
4. Nume lungi / `periodStart` – impact mic.
5. Câmpuri zero – păstrate explicit (nu se omit), deci fiecare rând are multe chei.

**Redundențe posibile (employee):**

- `deptAverages3Months` este același pentru toți angajații din același departament; dar fiecare apel e independent, deci nu se trimite între apeluri.
- În interiorul unui apel: `periodStart` e un string scurt; `person` e mic. Redundanța principală e **pretty-print** și **numărul mare de câmpuri numerice** (multe zero) pe 3 luni.

---

### 2.2 Department – unde se construiește inputJson

- **Locație:** `backend/jobs/monthly.js` linii 227–241.
- **Cod relevant:**
  ```js
  const departmentInputJson = {
    periodStart: metas[0].periodStart,
    analytics: departmentAnalytics,
    rawSummaries: {
      current: reportSummaries[0],
      prev1: reportSummaries[1],
      prev2: reportSummaries[2],
    },
  };
  ```

**Schema outline (department inputJson):**

| Cheie | Tip | Descriere |
|-------|-----|-----------|
| `periodStart` | string | Perioada raportului |
| `analytics` | `buildDepartmentAnalytics()` | `{ meta, sales, operational }`; fiecare dept are `headcount`, `averages`, `highPerformers`, `lowPerformers`, `volatility`, `employeeIssues`, `systemicIssues` |
| `rawSummaries` | `{ current, prev1, prev2 }` | 3 × reportSummary complet (departments.operational, .sales, .management + company) |

**Structură `analytics` (per departament):**

- `headcount`: `{ totalEmployees, activeEmployees }`
- `averages`: `avgTripsCtr`, `avgProfitCtr`, `avgProfitAll`, `avgBurseCount`, `avgProfitabilityPct`
- `highPerformers` / `lowPerformers`: array de 2 elemente cu `name`, `id`, `totalTripsCtr`, `totalProfitCtr`, `totalProfitAll`, `pctTarget`
- `volatility`: array de obiecte `{ name, id, totalProfitCtrCurrent/Prev, totalTripsCtrCurrent/Prev, deltaProfitCtrPct, deltaTripsCtrPct, level }`
- `employeeIssues`: array – **un element per angajat** – cu `id`, `name`, `mondayId`, `active`, `kpis` (obiect mare), `issues` (array de stringuri)
- `systemicIssues`: array de `{ code, issue, affectedCount, activeCount, affectedPct }`

**Structură `reportSummary` (rawSummaries):**

- `departments.operational`, `departments.sales`, `departments.management`: fiecare = output `computeTotals(rows)` (~25+ chei numerice).
- `company`: obiect cu `ctr`, `livr` (count, profit, websiteCount, websiteProfit, burseCount, breakdowns).

**Top 10 câmpuri care pot umfla JSON-ul (department):**

1. **`rawSummaries.current` / `prev1` / `prev2`** – 3 copii complete ale reportSummary (departamente + company); **posibilă redundanță** cu `analytics` care deja derivează KPIs și agregate.
2. **`analytics.sales.employeeIssues`** – un element per angajat, fiecare cu `kpis` (totalTripsCtr, totalProfitCtr, burseBreakdown, principalShare, etc.) + `issues[]`.
3. **`analytics.operational.employeeIssues`** – idem, pentru toți angajații operaționali.
4. **`employeeIssues[].kpis`** – conține burseBreakdown, profitabilityPct, avgClientTerm etc.; repetat pentru fiecare angajat.
5. **`analytics.*.volatility`** – listă de obiecte cu cifre curente/anterioare.
6. **`company.ctr/livr.breakdowns`** – obiecte cu chei dinamice (ex. tip serviciu, dep, status plată); pot fi mari.
7. **Pretty-print:** `JSON.stringify(inputJson, null, 2)` la department mărește mult payload-ul.
8. **`reportSummary.departments`** – 3 × (operational + sales + management) cu toate câmpurile computeTotals.
9. **Triplarea perioadelor** – current, prev1, prev2 peste tot.
10. **Texte în `employeeIssues[].issues`** – stringuri lungi (ex. „ALERTĂ CRITICĂ: ZERO curse burse…”).

**Redundențe (department):**

- **rawSummaries vs analytics:** `analytics` este derivat din aceleași reporturi; `rawSummaries` repetă reportSummary-urile complete. Dacă promptul poate lucra doar din `analytics` (plus eventual doar agregate din rawSummaries), porțiuni din `rawSummaries` pot fi eliminate sau comprimate.
- **Breakdowns company** – folosite „doar pentru referință” în prompt; pot fi trunchiate sau omise dacă nu sunt necesare pentru analiza text.

---

## 3) Token cost observability

**Unde se loghează:**

- **Fișier:** `backend/llm/openrouterClient.js`.
- **Request (attempt 1, responseFormatLevel 0):** linii 270–284:
  - `systemPromptHash` = sha256(systemContent) ✅
  - `inputJsonHash` = sha256(JSON.stringify(body)) – **atenție:** hash pe întregul body (model + messages + max_tokens + response_format), nu doar pe user content / inputJson ✅
  - Nu se loghează: `operationName`, mărimea input (bytes/chars), lungimea systemPrompt (chars).
- **Response:** linii 364–376:
  - `prompt_tokens`, `completion_tokens`, `total_tokens` ✅
  - `cost` (dacă OpenRouter îl trimite) ✅
  - `cost_details` / `upstream_inference_cost` (dacă există) ✅
  - Nu se loghează: `operationName` în același obiect de log (apare doar la eroare).

**Instrumentation gaps:**

| Gap | Descriere | Recomandare |
|-----|-----------|-------------|
| **operationName în [LLM audit] response** | La success nu se vede dacă răspunsul e pentru employee sau department | Adăugare `operationName` în `auditResponse` la linia 364 |
| **Mărime input (bytes/chars)** | Nu există metrică pentru dimensiunea request-ului | Log `userContentLength`, `systemContentLength` (sau `bodyBytes`) în `[LLM audit] request` |
| **inputJson (doar date) hash** | `inputJsonHash` actual = hash pe tot body; pentru cache pe „aceleași date” e util hash doar pe user message sau pe inputJson | Opțional: log separat `userPayloadHash` sau `inputJsonHash` = hash(JSON.stringify(inputJson)) în generateMonthlySections/Department (unde ai acces la inputJson) |
| **Agregare per job** | Nu există sumar la sfârșitul job-ului: total prompt_tokens, completion_tokens, cost | La final de job (monthly.js) nu se agregă usage; recomandare: colectare usage din fiecare apel și log la sfârșit: `[LLM audit] job summary` cu total_tokens, total_cost, apeluri per operationName |
| **Average / p95 tokens** | Nu există metrici agregate | Dacă se loghează într-un sistem central (ex. Cloud Logging), se pot calcula average/p95 pe requestId; altfel, log sumar la sfârșit: `totalPromptTokens`, `totalCompletionTokens`, `employeeCalls`, `departmentCalls`, `avgPromptTokensPerEmployee` |

**Recomandări minimale (fără infrastructură nouă):**

1. În `callOpenRouterJson`, la primul attempt, adăuga în `auditPayload`: `operationName`, `systemChars: systemContent.length`, `userChars: userContent.length` (sau `userBytes: Buffer.byteLength(userContent, 'utf8')`).
2. În `auditResponse`, adăuga `operationName` (trece-l din parametru).
3. În `generateMonthlySections` / `generateMonthlyDepartmentSections`: după `callOpenRouterJson`, log optional `inputJsonChars: JSON.stringify(inputJson).length` (sau hash doar al inputJson pentru cache).
4. În `monthly.js`: colectează `usage` din fiecare `generateMonthlySections` și din `generateMonthlyDepartmentSections` (returnând usage din client); la final log: `[LLM audit] monthly job totals`, `{ employeeCalls, departmentCalls, totalPromptTokens, totalCompletionTokens, totalTokens, estimatedCost? }`.

---

## 4) Prompt audit (prompt size report + safe trim candidates)

**Sursă:** `backend/prompts/loadPrompts.js` → `monthlyEmployeePrompt.md`, `monthlyDepartmentPrompt.md`.

### 4.1 monthlyEmployeePrompt.md

- **Lungime:** ~11.400 caractere (estimat din liniile citite).
- **Secțiuni:** ROL, CONTEXT COMPANIE, STRUCTURA DATELOR, BENCHMARK-URI, LEVIERE, METODOLOGIE, STRUCTURA EMAIL, TON & STIL, EXEMPLU EMAIL COMPLET (foarte lung), FORMAT OBLIGATORIU DE OUTPUT, CHECKLIST FINAL.

**Redundențe / repetiții:**

- Regulile de JSON („NU folosi markdown”, „NU adăuga explicații”) apar în FORMAT OBLIGATORIU și în instrucțiunile din cod (`EMPLOYEE_JSON_INSTRUCTION` din openrouterClient.js) – o parte poate rămâne doar în prompt sau doar în cod.
- Structura datelor (coloane tabel) e descrisă foarte detaliat; poate fi scurtată la „vezi cheile din JSON” + 1–2 propoziții per secțiune.
- Checklist-ul final repetă cerințe deja enunțate (ex. „2–4 acțiuni SMART”, „check-in doar dacă sub standard”).

**Exemplu foarte lung:**

- „EXEMPLU EMAIL COMPLET” (~2.200+ caractere) – email complet Andrei Stancu cu tabel, interpretare, concluzii, acțiuni, plan. Poate fi redus la un „skeleton” (titluri + 1 propoziție per secțiune) sau mutat într-un exemplu mai scurt.

**Instructiuni duplicate:**

- JSON rules: în prompt (FORMAT OBLIGATORIU) și în `EMPLOYEE_JSON_INSTRUCTION` (openrouterClient.js): „Răspunde EXCLUSIV în JSON valid, cu exact aceste chei… Fără alte chei.”

**Safe trim candidates (fără schimbare logică business):**

1. Scurtare „STRUCTURA DATELOR (COLOANE TABEL)” la un rezumat (lista de chei + sens scurt); eliminare detaliere care se înțelege din JSON.
2. Reducere „EXEMPLU EMAIL COMPLET” la jumătate (păstrare structură, tăiere paragrafe lungi sau exemplu alternativ mai scurt).
3. Unificare reguli JSON: păstrare o singură sursă (fie în prompt, fie în user message); eliminare duplicatul.
4. Checklist: păstrare 5–6 puncte esențiale; eliminare bullet-uri care repetă exact ce e deja în METODOLOGIE / STRUCTURA EMAIL.
5. „CONTEXT COMPANIE” – păstrare roluri și metrici cheie; posibilă reducere la 50% prin formulări mai scurte.

**Estimare:** Reducere ~15–25% din caractere (aprox. 1.700–2.800 caractere) cu trim-uri safe.

---

### 4.2 monthlyDepartmentPrompt.md

- **Lungime:** ~25.000+ caractere (raportat din conținut).
- **Secțiuni:** role, report_recipients, company_context, data_structure, departmental_benchmarks, analysis_methodology, report_structure, tone_and_style, clarifications, example_report, FORMAT OBLIGATORIU DE OUTPUT.

**Redundențe / repetiții:**

- **Structura datelor** – descriere foarte detaliată a coloanelor (Secțiunea 1–7); apoi „FORMAT TABEL OUTPUT” repetă ce intră în tabel. Poate fi comprimat la „structură tabel: coloane X, rânduri Y; chei din JSON: …”.
- **Benchmark-uri** – „Benchmark-uri Individual (aplicabile fiecărui angajat)” repetă praguri din promptul employee; pot rămâne doar valorile (ex. „<7/zi = PROBLEMĂ”) fără re-explicarea rolurilor.
- **Metodologie** – Pașii 1–5 sunt detaliați; unele sub-bullet-uri pot fi reduse la titlu + o linie.
- **report_structure** – template-ul de secțiuni (## Rezumat Executiv, ## Departament Vânzări…) conține multe placeholder-uri; pot fi păstrate doar titlurile și 1–2 propoziții per secțiune.
- **Exemplu raport** – ~4.000+ caractere; exemplu parțial foarte lung. Poate fi redus la Rezumat Executiv + o subsecțiune (ex. doar Vânzări sau doar Operațional) + Comparație + Recomandări.
- **FORMAT OBLIGATORIU** – același tip de duplicat cu employee (și cu DEPARTMENT_JSON_INSTRUCTION din cod); cheile din exemplu sunt greșite (interpretareHtml etc. sunt pentru employee); department folosește rezumatExecutivHtml, vanzariHtml etc. – de verificat și aliniat.

**Safe trim candidates:**

1. Comprimare `<data_structure>`: păstrare doar lista de secțiuni și „ce primești în JSON”; eliminare explicații lungi per coloană.
2. Reducere exemplu raport la ~40% (păstrare structură, tăiere liste lungi de angajați și repetiții).
3. Benchmark-uri: păstrare doar tabelul de praguri; eliminare paragrafe care repetă promptul employee.
4. report_structure: păstrare titluri și format; reducere exemplele din paranteze la 1 linie.
5. analysis_methodology: pașii păstrați; sub-bullet-uri reduse la 1 propoziție acolo unde e suficient.
6. Unificare reguli JSON și corectare exemplu (chei department) în prompt.

**Estimare:** Reducere ~20–30% din caractere (aprox. 5.000–7.500 caractere) cu trim-uri safe.

---

## 5) Output audit (output growth drivers + safe output constraints)

**Ce cere promptul ca output:**

### Employee

- **Secțiuni:** 4 (interpretareHtml, concluziiHtml, actiuniHtml, planHtml).
- **Așteptări implicite (din prompt):** Interpretare: „obiectiv, bazat pe date”; Concluzii: „2–4 puncte pozitive”, „2–5 probleme majore”; Acțiuni: „2–4 acțiuni SMART” cu Ce/De ce/Măsurabil/Deadline; Plan: Săpt 1 + Săpt 2–4; Check-in doar dacă sub standard.
- **Limită explicită:** „Email sub 1,000 cuvinte” (checklist) – nu e impusă tehnic în schema JSON; modelul poate genera mai mult.

**Output growth drivers (employee):**

1. Lipsa unei limite explicite de lungime per secțiune (cuvinte/caractere) în system prompt sau în schema de răspuns.
2. Exemplul lung din prompt (email complet) încurajează răspunsuri la fel de detaliate.
3. „2–5 probleme” + „2–4 acțiuni” permit max 5 + 4 = 9 blocuri mari; fiecare cu „Ce”, „De ce”, „Măsurabil”, „Deadline” → multe propoziții.
4. `max_tokens` global 8192 (OPENROUTER_MAX_TOKENS) – nu există cap per completion în prompt, deci modelul poate umple până la limită.
5. Validarea doar „string non-gol” per cheie – nu există validare de lungime maximă.

### Department

- **Secțiuni:** 5 (rezumatExecutivHtml, vanzariHtml, operationalHtml, comparatiiHtml, recomandariHtml).
- **Așteptări:** Rezumat executiv; analiză detaliată Vânzări (cu tabel, probleme per angajat, volatilitate, high/low performers, probleme sistemice); idem Operațional; comparație între departamente; recomandări (one-to-one, training-uri, urmărire, obiective, mutări, probleme sistemice). Promptul cere explicit „Pentru FIECARE angajat” și „Listă completă”.
- **Fără limită explicită** de lungime per secțiune sau per raport.

**Output growth drivers (department):**

1. Cerința de acoperire a **tuturor** angajaților (probleme, volatilitate, high/low) → volum mare de text.
2. Structura de raport foarte detaliată (template-uri cu multe rânduri) → model tinde să umple fiecare subsecțiune.
3. Exemplu raport lung → bias către răspunsuri lungi.
4. Nicio constrângere „max bullets” sau „max cuvinte per secțiune”.
5. `max_tokens` 8192 – un singur apel department poate consuma o mare parte din el.

**5 constrângeri safe de output (păstrând calitatea):**

1. **Max cuvinte per secțiune (în prompt):** ex. „Interpretare: max 150 cuvinte”; „Concluzii: max 100 cuvinte”; „Fiecare acțiune: max 80 cuvinte”. Similar pentru department: „Rezumat executiv: max 200 cuvinte”; „Analiză Vânzări: max 400 cuvinte” etc.
2. **Max bullets / itemi:** „Maximum 4 puncte în Concluzii (ce merge bine + ce nu merge)”; „Maximum 4 acțiuni prioritare”; „High/Low performers: maximum 2 per departament” (deja cerut, dar poate fi reîncadrat ca limită strictă).
3. **max_tokens la request:** Setare `OPENROUTER_MAX_TOKENS=4096` (sau 2048 pentru employee) – reduce cap-ul efectiv; trebuie testat că raportul încă se încadrează.
4. **Checklist explicit în prompt:** „Răspuns total sub 800 cuvinte (employee)” / „Raport department sub 1.500 cuvinte” – ca orientare, nu validare.
5. **Schema/validare:** Păstrare validare strictă pe chei; opțional adăugare validare lungime maximă per câmp (de ex. refuz dacă `interpretareHtml.length > 8000` și retry cu instrucțiune „scurtă”) – mai mult decât „safe”, dar poate fi făcut conservator.

---

## 6) Recomandări concrete (zero business logic change)

### LEVEL 1 – Low risk, imediat

| Recomandare | Impact estimat (tokens/cost) | Risc calitate | Complexitate |
|-------------|-----------------------------|---------------|--------------|
| **Observability:** log `operationName`, `systemChars`, `userChars` (sau `userBytes`) în [LLM audit] request; `operationName` în response; la final job log sumar total tokens + cost (dacă e disponibil) | 0 direct; permite identificarea rapidă a apelurilor scumpe | Nul | Mică |
| **OPENROUTER_MAX_TOKENS:** setare explicită (ex. 4096) în env sau în cod ca default mai mic; testare că output-ul rămâne valid | Reducere completion_tokens la apeluri care „umplu” inutil | Posibil truncare dacă e prea mic – necesar test | Mică |
| **Output constraints în prompt:** adăugare în employee/department prompt a limitelor „max X cuvinte” per secțiune și „max Y acțiuni/bullets” | Reducere 10–25% completion_tokens (estimat) | Scăzut dacă limitele sunt rezonabile | Mică |
| **Hash doar pentru user payload (opțional):** log `userPayloadHash` sau hash(inputJson) pentru cache viitor | 0 direct; pregătește Level 3 | Nul | Mică |

---

### LEVEL 2 – Medium risk

| Recomandare | Impact estimat | Risc calitate | Complexitate |
|-------------|----------------|---------------|--------------|
| **Eliminare pretty-print:** `JSON.stringify(inputJson)` fără `null, 2` în generateMonthlySections și generateMonthlyDepartmentSections | Reducere ~15–30% din user message (doar partea de date) | Nul – JSON rămâne valid | Foarte mică |
| **Employee – omitere câmpuri zero:** înainte de stringify, trimite doar chei cu valoare !== 0 (sau păstrează doar cheile folosite explicit în prompt) | Reducere 10–20% input per employee | Scăzut – trebuie asigurat că promptul nu se bazează pe „lipsă cheie = 0” | Medie (trebuie whitelist clară) |
| **Department – reducere rawSummaries:** trimite doar `reportSummary.departments` (fără company.breakdowns) sau doar agregate esențiale (ex. profit, curse, target) în loc de tot computeTotals | Reducere mare pe department (20–40% din payload) | Mediu – promptul trebuie să poată lucra fără breakdowns/company complet | Medie |
| **Compresie employee – un singur obiect „luna curentă” + delta:** în loc de 3 luni complete, trimite `current` complet și pentru `prev`/`prev2` doar câmpurile necesare pentru comparație (ex. totalProfit, totalTrips, target) | Reducere semnificativă a lui data3Months | Scăzut–mediu – promptul trebuie adaptat la „delta” sau la mai puține cifre pentru istoric | Medie |
| **Prompt trim (safe):** aplicare safe trim candidates din secțiunea 4 (scurtare exemple, unificare reguli JSON, reducere checklist) | Reducere 15–25% system prompt tokens | Scăzut | Mică–medie |

---

### LEVEL 3 – Structural, high leverage

| Recomandare | Impact estimat | Risc calitate | Complexitate |
|-------------|----------------|---------------|--------------|
| **Cache per hash (inputJson / userPayload):** înainte de `callOpenRouterJson`, calculezi `hash = sha256(JSON.stringify(inputJson))` (sau al user message); dacă există în cache (Redis/GCS/DB) răspuns valid pentru acel hash, returnezi din cache. Invalidezi per lună sau per periodStart | Reducere 0–(N-1) apeluri employee la rerun-uri sau angajați cu date identice; 0–1 apel department | Nul dacă TTL/invalidare e corectă | Mare (storage, invalidation, race) |
| **Batching employee:** în loc de N apeluri secvențiale, gruparea a 2–4 angajați într-un singur request (user message cu array de inputJson) și cerere de răspuns JSON array cu 4 secțiuni per angajat. Necesită schimbare de prompt și parsare output | Reducere număr apeluri (ex. 17 → 5); cost per token poate rămâne similar; economie pe overhead request | Mediu – prompt mai complex, risc de amestec între angajați sau timeout | Mare |
| **Two-pass summary (employee → department):** department nu mai primește rawSummaries + analytics complet; primește doar rezumate per angajat (1 paragraf) generate într-un pas anterior (sau folosește output-urile employee „interpretare + concluzii” ca input). Apoi un singur apel department pe „rezumate” + agregate | Reducere mare a input-ului department; posibil și reducere a lungimii output-ului department | Mediu – calitatea raportului management depinde de calitatea rezumatelor; poate pierde detaliu | Mare |
| **Model mai ieftin pentru employee:** folosire model mai mic (ex. claude-sonnet) pentru employee și Opus doar pentru department | Reducere cost per token employee (semnificativ) | Mediu – test A/B pe câteva luni | Mică (config); medie (validare) |

---

## Livrabil – rezumat

1. **LLM call map:** 1 apel per persoană activă (employee) + 1 apel department per job; messages = system (prompt din .md) + user (instrucțiuni JSON + `JSON.stringify(inputJson, null, 2)`); repair retry la validare schema.
2. **Employee inputJson:** schema outline + top volume: triplarea data3Months, deptAverages3Months, pretty-print, multe câmpuri numerice.
3. **Department inputJson:** schema outline + top volume: rawSummaries × 3, employeeIssues (per angajat) cu kpis, analytics, pretty-print.
4. **Prompt size report:** employee ~11.4k chars cu exemplu lung și reguli duplicate; department ~25k+ chars cu exemplu foarte lung și structuri repetate; safe trim candidates enumerate.
5. **Output growth drivers:** lipsa limitelor explicite de lungime, exemple lungi, cerințe „pentru fiecare angajat”, max_tokens 8192; 5 constrângeri safe enumerate.
6. **Plan 3 niveluri:** Level 1 = observability + max_tokens + output constraints (low risk); Level 2 = fără pretty-print, reducere câmpuri/rawSummaries, prompt trim (medium risk); Level 3 = cache per hash, batching, two-pass, model mai ieftin (high leverage, complexitate mare).

**Nu s-a modificat nicio logică de business; toate recomandările sunt fie observability, fie reducere de volum (input/output) sau schimbări de proces (cache, batching) cu trade-offs descriși.**
