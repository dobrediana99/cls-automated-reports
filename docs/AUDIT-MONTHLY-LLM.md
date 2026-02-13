# Audit tehnic: fluxul monthly și utilizarea OpenRouter (Claude)

**Data:** 2026-02-13  
**Scop:** Verificare dacă modelul Claude prin OpenRouter este apelat efectiv pentru generarea textelor din emailurile lunare.

---

## 1️⃣ Confirmare: OpenRouter este apelat efectiv

### Unde este importat și folosit `llm/openrouterClient.js`

| Fișier | Utilizare |
|--------|-----------|
| **`backend/jobs/monthly.js`** | Singurul consumator din flow-ul monthly. Import la linia 16: `requireOpenRouter`, `generateMonthlySections`, `generateMonthlyDepartmentSections`. |
| `backend/index.js` | Doar `getModel()` pentru endpoint-ul `GET /debug/llm`. |
| `backend/report/buildMonthlySnapshot.js` | Doar referință în schema snapshot (`llm.model.name`); **nu** importă sau apelează clientul. |

### Funcția care face Chat Completion

- **Nume intern:** `callOpenRouterJson` (în `backend/llm/openrouterClient.js`, ~linia 121).
- **Nu este exportată;** este apelată doar din:
  - `generateMonthlySections()` → `callOpenRouterJson(...)` (linia 374)
  - `generateMonthlyDepartmentSections()` → `callOpenRouterJson(...)` (linia 412)

### Unde se face apelul în flow-ul monthly

- **Nu** în `email/monthly.js`: acesta primește `llmSections` ca parametru și le injectează în HTML; nu apelează OpenRouter.
- **Nu** în `content/monthlyTexts.js`: conține doar subiecte și saluturi (texte deterministe); nu are nicio referință la LLM.

**Apelurile efective sunt doar în `backend/jobs/monthly.js`:**

| Linie | Apel | Context |
|-------|------|--------|
| 127 | `requireOpenRouter()` | Fail-fast dacă `OPENROUTER_API_KEY` lipsește. |
| 151 | `await generateMonthlySections({ systemPrompt: employeePrompt, inputJson })` | În bucla `for (const person of activePeople)` — **un apel OpenRouter per angajat**. |
| 226 | `await generateMonthlyDepartmentSections({ systemPrompt: departmentPrompt, inputJson: departmentInputJson })` | **Un apel** pentru secțiunile de management. |

### Răspuns clar

- **Da, clientul OpenRouter este apelat efectiv** în flow-ul monthly.
- **Nu există niciun branch care să îl ocolească:** după obținerea celor 3 perioade (fie din GCS snapshot, fie din cache/runReport), job-ul întotdeauna:
  1. apelează `requireOpenRouter()` (dacă cheia lipsește → job eșuează),
  2. încarcă prompturile din `backend/prompts/`,
  3. pentru fiecare persoană activă apelează `generateMonthlySections` (deci OpenRouter),
  4. apelează o dată `generateMonthlyDepartmentSections` (OpenRouter),
  5. construiește emailurile cu aceste secțiuni și fie scrie în `out/` (DRY_RUN), fie trimite prin Nodemailer.

Singura cale pe care LLM **nu** este apelat este dacă job-ul **eșuează înainte** de linia 127 (ex.: `MONDAY_API_TOKEN` lipsă) sau la linia 127 (lipsă `OPENROUTER_API_KEY`). În aceste cazuri nu se ajunge la generarea de texte.

---

## 2️⃣ Bypass / fallback logic

### Căutare: DRY_RUN, LLM, DISABLE, NO_LLM, SEND_MODE, fallback

- **DRY_RUN:** Folosit doar pentru idempotency (index) și pentru a scrie în `out/` în loc să trimită email. În `monthly.js`, **după** ce `employeeLlmSections` și `departmentLlmSections` sunt deja populate (deci după toate apelurile LLM), se verifică `if (process.env.DRY_RUN === '1')` pentru a decide dacă se scrie pe disc sau se trimite email. **DRY_RUN nu evită apelurile OpenRouter.**
- **NO_LLM / DISABLE LLM:** Nu există nicio variabilă de mediu sau condiție care să dezactiveze LLM în proiect.
- **SEND_MODE:** Folosit în `email/sender.js` doar pentru destinatari (test vs prod); nu influențează dacă se apelează sau nu OpenRouter.
- **Fallback determinist pentru monthly:** **Nu există.** Atât `email/templates/monthlyEmployee.js` cât și `email/monthly.js` (department) verifică existența și completitudinea `llmSections` și **aruncă** dacă lipsește sau un câmp e gol:
  - `monthlyEmployee.js` linia 51–57: `throw new Error('Monthly employee email requires llmSections...')` și verificare pe `interpretareHtml`, `concluziiHtml`, `actiuniHtml`, `planHtml`.
  - `email/monthly.js` linia 84–90: același tip de throw pentru emailul departamental.
- **Try/catch care înghite erorile LLM:** **Nu există.** În `jobs/monthly.js` singurul try/catch (liniile 195–213) înconjoară doar logarea „burse sanity”; nu înconjoară `generateMonthlySections` sau `generateMonthlyDepartmentSections`. Orice eroare din OpenRouter (rețea, 429, JSON invalid) se propagă și oprește job-ul.

**Concluzie:** Nu există bypass, fallback determinist pentru textele lunare sau try/catch care să permită continuarea fără rezultat LLM. Dacă OpenRouter eșuează sau returnează JSON invalid, job-ul monthly eșuează.

---

## 3️⃣ Verificare async (await, Promise.all, race)

- **`map(async ...)` fără `await`:** Nu există în `monthly.js`. Secțiunile per angajat se obțin într-o buclă `for (const person of activePeople)` cu `await generateMonthlySections(...)` în interior (linia 151).
- **`forEach(async ...)`:** Nu este folosit pentru apeluri LLM.
- **Apeluri `generateMonthly...` fără await:** Toate sunt await-uite:
  - linia 151: `const sections = await generateMonthlySections(...)`
  - linia 226: `const departmentLlmSections = await generateMonthlyDepartmentSections(...)`
- **Promise.all:** Nu este folosit pentru LLM; apelurile sunt intenționat secvențiale (un request per persoană), ceea ce evită rate limit și asigură că fiecare rezultat este disponibil înainte de a construi emailurile.

**Concluzie:** Rezultatul LLM este întotdeauna așteptat înainte de generarea emailurilor; nu există risc de race condition sau de a folosi rezultate neînchegate.

---

## 4️⃣ Utilizarea rezultatului LLM în template

### Obicet returnat de LLM

- **Angajat:** `generateMonthlySections` returnează (după `validateEmployeeOutput`) un obiect cu: `interpretareHtml`, `concluziiHtml`, `actiuniHtml`, `planHtml` (openrouterClient.js, linia 316–320).
- **Departament:** `generateMonthlyDepartmentSections` returnează (după `validateDepartmentOutput`): `rezumatExecutivHtml`, `vanzariHtml`, `operationalHtml`, `comparatiiHtml`, `recomandariHtml` (openrouterClient.js, linia 344–349).

### Unde este injectat în HTML

- **Angajat:** `backend/email/templates/monthlyEmployee.js`:
  - linia 87: `llmSections.interpretareHtml`
  - linia 90: `llmSections.concluziiHtml`
  - linia 93: `llmSections.actiuniHtml`
  - linia 96: `llmSections.planHtml`  
  Toate sunt sanitizate cu `sanitizeReportHtml()` și puse în div-uri; nu există text determinist care să le suprascrie.

- **Management/departament:** în `email/monthly.js`, funcția care construiește HTML-ul de management folosește:
  - linia 124: `llmSections.rezumatExecutivHtml`
  - linia 127: `llmSections.vanzariHtml`
  - linia 130: `llmSections.operationalHtml`
  - linia 133: `llmSections.comparatiiHtml`
  - linia 136: `llmSections.recomandariHtml`  
  Din nou, doar sanitizare; fără suprascriere cu texte deterministe.

**Concluzie:** Câmpurile generate de LLM sunt efectiv folosite în HTML; nu sunt înlocuite ulterior cu texte deterministe. Nu există `monthlyDepartment.js` template separat; logica departamentală este în `email/monthly.js`.

---

## 5️⃣ Cache și snapshot

### `buildMonthlySnapshot.js`

- Construiește un snapshot v1 pentru **o lună**: fetch Monday + `buildReport` + structură fixă.
- **Nu apelează OpenRouter.** Schema conține `llm: { model: { ... }, employeeSummaries: {}, departmentSummary: {} }` (liniile 142–150) — doar metadata și containere goale; nu se generează și nu se salvează texte LLM în snapshot.

### `store/monthlySnapshots.js`

- Citește/scrie fișiere JSON pe GCS (`monthly_snapshots/YYYY-MM.json`). Conținutul este snapshot-ul produs de `buildMonthlySnapshot`; deci **nu** conține secțiunile LLM (interpretare, concluzii, etc.).

### `runMonthlyPeriods.js`

- Gestionează cache-ul pentru **report** (meta, reportSummary, report) pe disc sau GCS (`REPORTS_BUCKET`). Nu gestionează cache de texte LLM.

### Flux în `jobs/monthly.js` când există `SNAPSHOT_BUCKET`

1. Se citesc (sau se construiesc și se scriu) snapshot-urile pentru cele 3 luni.
2. Din fiecare snapshot se extrag doar `meta`, `reportSummary`, `report` (liniile 85–88).
3. **După** aceea se execută întotdeauna: `requireOpenRouter()`, încărcare prompturi, bucla cu `generateMonthlySections`, apoi `generateMonthlyDepartmentSections`.

Deci:

- **La rerun:** LLM **este apelat din nou**; nu se folosesc texte salvate din snapshot (snapshot-ul nici nu le conține).
- **Ștergerea snapshot-ului** influențează doar dacă se refac fetch-urile Monday și buildReport pentru acele luni; **nu** determină dacă se apelează sau nu LLM. LLM este apelat indiferent de cache/snapshot.

**Concluzie:** Snapshot-ul nu conține texte LLM; nu există logică care să înlocuiască apelurile OpenRouter cu texte din cache. Ștergerea snapshot-ului nu este relevantă pentru „reapelarea” LLM — LLM este apelat oricum la fiecare rulare a job-ului monthly.

---

## 6️⃣ Modelul utilizat

- **Default în cod:** `backend/llm/openrouterClient.js`, linia 12: `const DEFAULT_MODEL = 'anthropic/claude-opus-4.6'`.
- **Ce se folosește efectiv:** `getModel()` (linia 48–50): `(process.env.OPENROUTER_MODEL || '').trim() || DEFAULT_MODEL` → deci **anthropic/claude-opus-4.6** dacă `OPENROUTER_MODEL` nu este setat sau este gol.
- **Override:** Da, prin variabila de mediu `OPENROUTER_MODEL` (ex.: alt model OpenRouter).
- **buildMonthlySnapshot.js** (linia 145): doar notează în metadata același string de model; nu inițiază apeluri LLM.

**Concluzie:** Modelul efectiv este **anthropic/claude-opus-4.6**, cu posibilitate de override prin `OPENROUTER_MODEL`. Nu există alt default ascuns în cod pentru flow-ul monthly.

---

## 7️⃣ Răspuns final

### Concluzie audit

**LLM-ul (OpenRouter / Claude) este apelat corect** în job-ul monthly.

- OpenRouter este invocat din **`backend/jobs/monthly.js`** (linia 151 pentru fiecare angajat, linia 226 pentru management).
- Nu există branch care să sară peste aceste apeluri.
- Nu există fallback determinist pentru textele lunare; lipsa sau invalidarea răspunsului LLM duce la eșecul job-ului.
- Apelurile sunt await-uite corect; rezultatul este folosit în template-uri fără suprascriere.
- Snapshot-ul și cache-ul nu conțin și nu furnizează texte LLM; la fiecare rulare se fac apeluri noi către OpenRouter.

### De ce poate „părea” că nu e folosit Claude?

Posibile cauze pe care codul nu le indică:

1. **Lipsă `OPENROUTER_API_KEY`:** Job-ul eșuează la linia 127 (`requireOpenRouter()`); nu se ajunge la generarea de texte. Mesaj: *"OpenRouter requires an API key. Set OPENROUTER_API_KEY..."*.
2. **Eroare de rețea sau de la OpenRouter:** Request-ul către OpenRouter eșuează sau returnează JSON invalid → job-ul aruncă; în loguri ar apărea `[openrouter] error` sau `[LLM audit] ...`.
3. **Verificare rapidă:** `GET /debug/llm` pe serviciu (sau local) confirmă dacă `openrouterConfigured: true` și ce model este folosit; dacă cheia lipsește, `openrouterConfigured` este `false`.
4. **Inspectare conținut:** În DRY_RUN, fișierele `out/monthly_employee_*_*.html` și `monthly_department_*.html` conțin secțiunile LLM; dacă acolo apar texte generice/placeholder, atunci fie cheia nu era setată (job eșuat), fie s-a folosit alt mediu (ex. fără OPENROUTER_API_KEY și cu mock în teste).

### Referințe exacte în cod

| Ce | Fișier | Linie |
|----|--------|-------|
| Import OpenRouter | `backend/jobs/monthly.js` | 16 |
| Verificare cheie (fail-fast) | `backend/jobs/monthly.js` | 127 |
| Apel LLM per angajat | `backend/jobs/monthly.js` | 151 |
| Apel LLM departament | `backend/jobs/monthly.js` | 226 |
| Chat Completion internă | `backend/llm/openrouterClient.js` | 121 (`callOpenRouterJson`), 374 și 412 (apeluri) |
| Model default | `backend/llm/openrouterClient.js` | 12 |

Dacă în mediul tău concret emailurile lunare nu conțin texte care par generate de Claude, pasul următor este verificarea în acel mediu a: `OPENROUTER_API_KEY`, logurilor job-ului (inclusiv `[LLM audit]`), și răspunsului de la `GET /debug/llm`.
