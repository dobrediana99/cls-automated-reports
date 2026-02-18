# Audit: KPI deterministe și suprascrierea secțiunii 1 (email lunar angajat)

**Scop:** Starea exactă după modificările pentru KPI-uri deterministe și suprascrierea `sectiunea_1_tabel_date_performanta.continut`; identificarea riscurilor rămase pentru (1) apariția textelor „Nu pot determina…” și (2) erori care opresc trimiterea emailului.

**Constrângeri:** Fără modificări de prompt-uri; raport doar analiză, fără schimbări de cod.

---

## 1. Unde poate apărea „Nu pot determina” (și variante)

### 1.1 Surse explicite în cod / prompturi

| Fișier | Linie / fragment | Context / unde ajunge în email |
|--------|-------------------|--------------------------------|
| `backend/prompts/monthlyDepartmentPrompt.md` | ~linia 5: `„Nu pot determina din datele disponibile”` | **Prompt departament:** instrucțiune explicită: „Dacă o informație lipsește, spune explicit: «Nu pot determina din datele disponibile».” Conținutul generat de LLM pentru **emailul departamental** poate conține acest text în orice secțiune (rezumat executiv, analize, comparație, recomandări, incheiere). |
| `backend/prompts/monthlyDepartmentPrompt.md` | ~linia 18 (în metodologie): `„Nu pot valida consistența din datele disponibile”`, `„nu poate fi determinat targetul departamental din datele furnizate”` | Aceleași variante pot apărea în textul raportului departamental (LLM le poate folosi în propoziții). |
| `backend/email/buildEmployeeKpiBullets.js` | Comentarii (linii 3, 21, 47): „Nu pot determina… never appears” | Doar documentație; nu introduc text în output. |
| `backend/email/buildEmployeeKpiBullets.test.js` | Linii 2, 41, 44, 48–49, 53–55, 70 | Doar teste (mock-uri și aserțiuni); nu afectează emailul. |
| `backend/email/monthly.test.js` | Linia 343: `expect(html).not.toContain('Nu pot determina')` | Doar test; nu afectează emailul. |

**Concluzie surse:** Singura sursă „live” care poate produce text „Nu pot determina…” în email este **promptul de departament** (`monthlyDepartmentPrompt.md`). Promptul de **angajat** (`monthlyEmployeePrompt.md`) **nu** conține expresia „Nu pot determina”; spune doar „nu menționa elementul respectiv” pentru date lipsă.

### 1.2 Texte căutate care nu apar în repo (în afara promptului departament)

- „Nu pot determina un procent” – **nu apare** în cod/prompturi.
- „Nu pot determina media zilnică” – **nu apare** în cod/prompturi.
- „nu există un câmp explicit” – **nu apare** în cod/prompturi.

Acestea pot apărea doar dacă **LLM-ul** le generează liber în secțiunile narative (angajat sau departament).

### 1.3 Normalizare și fallback în cod (angajat)

| Fișier | Fragment | Efect |
|--------|----------|--------|
| `backend/llm/normalizeMonthlyEmployeeOutput.js` | `const DEFAULT_CONTINUT = ['Date indisponibile'];` (linia 8) | Când `sectiunea_1_tabel_date_performanta.continut` este gol sau invalid, normalizarea pune `['Date indisponibile']`. **În fluxul actual** acest continut este **suprascris** imediat după return din LLM (în job), deci utilizatorul **nu** vede „Date indisponibile” în secțiunea 1 (vezi secțiunea 3). |

---

## 2. Fluxul complet de generare email per angajat (call chain)

Fluxul este același pentru **run real** și **DRY_RUN**; diferența este că la DRY_RUN nu se trimite emailul, doar se scrie HTML pe disk.

### Pas 1: Job – pregătire date și input

| Fișier | Funcție / loc | Intră | Ieși | Validări / erori |
|--------|----------------|-------|------|-------------------|
| `backend/jobs/monthly.js` | `runMonthly()` | `opts`, cache/GCS | `reports`, `metas`, `reportSummaries`, `activePeople` | La start: `workingDaysInPeriod = countWorkingDays(metas[0].periodStart, metas[0].periodEnd)`; dacă `workingDaysInPeriod == null \|\| <= 0` → **throw** `Error('[MONTHLY] Invalid workingDaysInPeriod for ...')`. |
| `backend/jobs/monthly.js` | În loop `for (const person of activePeople)`: `getPersonRow(reports[0], person)`, `getPersonRow(reports[1], person)` | `reports[0]`, `reports[1]`, `person` | `data3Months.current`, `data3Months.prev` (obiect row sau `null`) | `getPersonRow` poate returna `null` (fără match); nu aruncă. |
| `backend/jobs/monthly.js` | Construcție `inputJson` | `person`, `data3Months`, `deptAverages3Months`, `metas[0].periodStart/periodEnd`, `workingDaysInPeriod` | `inputJson` | Nicio validare suplimentară aici. |

### Pas 2: Apel LLM și parsare

| Fișier | Funcție | Intră | Ieși | Validări / erori |
|--------|---------|-------|------|-------------------|
| `backend/llm/openrouterClient.js` | `generateMonthlySections({ systemPrompt, inputJson, performancePct })` | Prompt + `inputJson` + `performancePct` | `{ sections, usage }` (sau throw) | `JSON.parse(raw)` eșuează → throw „LLM response is not valid JSON”. |

### Pas 3: Normalizare (în OpenRouter, înainte de validare)

| Fișier | Funcție | Intră | Ieși | Validări / erori |
|--------|---------|-------|------|-------------------|
| `backend/llm/openrouterClient.js` | `tryParseAndValidate` → `normalizeMonthlyEmployeeOutput(parsed)` | `parsed` (obiect JSON) | Același obiect, mutat | Normalizarea nu aruncă; completează/trim-uiește (ex.: `sectiunea_1_tabel_date_performanta.continut` → trim, drop empty, sau `DEFAULT_CONTINUT`). |

### Pas 4: Validare AJV + reguli de business

| Fișier | Funcție | Intră | Ieși | Validări / erori |
|--------|---------|-------|------|-------------------|
| `backend/llm/validateMonthlyOutput.js` | `validateEmployeeOutput(obj, { performancePct })` | Obiect normalizat | Același obiect (validat) | (1) `!obj \|\| typeof obj !== 'object'` → throw „LLM output is not a valid object.” (2) **AJV** (`validateEmployeeSchema(obj)`): orice eroare de schemă → throw „LLM employee output schema validation failed: …”. (3) **applyCheckInRule**: `performancePct < 80` fără `sectiunea_6_check_in_intermediar` sau `>= 80` cu sectiunea_6 prezentă → throw. (4) **applyClosingMessageRule**: lipsește `incheiere.mesaj_sub_80` (când pct < 80) sau `incheiere.mesaj_peste_80` (când pct >= 80) → throw. |

### Pas 5: Return la job – suprascriere secțiune 1 (KPI determinist)

| Fișier | Funcție / loc | Intră | Ieși | Validări / erori |
|--------|----------------|-------|------|-------------------|
| `backend/jobs/monthly.js` | După `llmSections = raw?.sections ?? raw`: `buildEmployeeKpiBullets(...)`, `applyEmployeeKpiOverwrite(llmSections, kpiLines)` | `data3Months.current`, `data3Months.prev`, `workingDaysInPeriod`, `metas[0]` | – (mutare `llmSections` în loc) | `buildEmployeeKpiBullets` nu aruncă; folosește N/A pentru valori invalide. `applyEmployeeKpiOverwrite` nu aruncă; dacă `llmSections` e null/undefined, iese fără modificare. |

### Pas 6: Template – assert structură și randare HTML

| Fișier | Funcție | Intră | Ieși | Validări / erori |
|--------|---------|-------|------|-------------------|
| `backend/email/templates/monthlyEmployee.js` | `buildMonthlyEmployeeEmail({ person, data3Months, deptAverages3Months, periodStart, llmSections })` | `llmSections` (deja cu continut suprascris) | `{ subject, html }` | **assertFullStructure(llmSections)**: dacă lipsește oricare cheie din `REQUIRED_TOP_KEYS` (antet, sectiunea_1_tabel_date_performanta, 2, 3, 4, 5, incheiere) → throw „Monthly employee email missing LLM key: …”. |
| `backend/email/templates/monthlyEmployee.js` | `buildMonthlyEmployeeEmailHtml(...)` | `llmSections` | HTML string | La început: `assertFullStructure(llmSections)`. Apoi citește `s1.continut` și randă `<ul><li>…</li></ul>`. Dacă `s1.continut` e array gol → `continutRows === ''` → nu se afișează liste (doar titlul „Date de performanță”). |

### Pas 7: Trimitere (doar run real)

| Fișier | Funcție | Intră | Ieși | Validări / erori |
|--------|---------|-------|------|-------------------|
| `backend/jobs/monthly.js` | `transporter.sendMail({ from, to, subject, html })` | `subject`, `html` de la `buildMonthlyEmployeeEmail` | – | Erori de rețea/SMTP → throw; job face fail-fast. |

**Rezumat ordine:**  
LLM → parse → **normalize** → **validate (AJV + check-in + closing)** → return în job → **suprascriere sectiunea_1** → **buildMonthlyEmployeeEmail** (assertFullStructure + HTML) → send.

---

## 3. Loc exact al suprascrierii KPI (secțiunea 1)

### 3.1 Fișier și funcție

- **Fișier:** `backend/jobs/monthly.js`  
- **Funcții implicate:**  
  - `buildEmployeeKpiBullets(cur, prev, workingDaysInPeriod, meta)` – din `backend/email/buildEmployeeKpiBullets.js` – construiește array-ul de 5 linii.  
  - `applyEmployeeKpiOverwrite(llmSections, lines)` – din același fișier – scrie în `llmSections.sectiunea_1_tabel_date_performanta.continut`.

### 3.2 Poziție în flux

- **După** parsare JSON și **după** `normalizeMonthlyEmployeeOutput`.
- **După** **validarea AJV** și **după** `applyCheckInRule` / `applyClosingMessageRule` (toate în `generateMonthlySections` → `tryParseAndValidate`).
- **Înainte** de `buildMonthlyEmployeeEmail` (deci **înainte** de `assertFullStructure` și **înainte** de randarea HTML).

### 3.3 Fragment de cod (suprascriere în job)

```javascript
// backend/jobs/monthly.js (run real, ~linia 396–399)
llmSections = raw?.sections ?? raw;
const kpiLines = buildEmployeeKpiBullets(data3Months.current, data3Months.prev, workingDaysInPeriod, metas[0]);
applyEmployeeKpiOverwrite(llmSections, kpiLines);
```

La DRY_RUN (~linia 265–267):

```javascript
let llmSections = raw?.sections ?? raw;
const kpiLines = buildEmployeeKpiBullets(data3Months.current, data3Months.prev, workingDaysInPeriod, metas[0]);
applyEmployeeKpiOverwrite(llmSections, kpiLines);
```

### 3.4 Fragment – aplicarea overwrite-ului

```javascript
// backend/email/buildEmployeeKpiBullets.js (linii 51–58)
export function applyEmployeeKpiOverwrite(llmSections, lines) {
  if (!llmSections || typeof llmSections !== 'object') return;
  const arr = Array.isArray(lines) ? lines : [];
  if (llmSections.sectiunea_1_tabel_date_performanta != null && typeof llmSections.sectiunea_1_tabel_date_performanta === 'object') {
    llmSections.sectiunea_1_tabel_date_performanta.continut = arr;
  } else {
    llmSections.sectiunea_1_tabel_date_performanta = { continut: arr };
  }
}
```

Rezultat: `continut` este mereu un array de stringuri (5 linii), fără „Nu pot determina…”; schema (continut array, minItems:1, items string minLength:1) rămâne satisfăcută.

---

## 4. Câmpuri folosite pentru KPI determinist per angajat

### 4.1 Lista câmpurilor

- **Din row (current/prev):** `target`, `ctr_principalProfitEur`, `ctr_secondaryProfitEur`, `livr_principalProfitEur`, `livr_secondaryProfitEur`, `callsCount`, `contactat`, `calificat`.  
- **Din meta / job:** `periodStart`, `periodEnd`; `workingDaysInPeriod` (calculat din `metas[0].periodStart/periodEnd`).

### 4.2 Originea datelor

| Câmp | Proveniență | Comportament dacă lipsește |
|------|-------------|----------------------------|
| `target` | `backend/report/buildReport.js`: `safeVal(emp.target)`; sursă inițială `orgAdapter` / persoane (e.g. `person.target`). | `calcTargetAchievementPct(row)`: target <= 0 sau non-numeric → **null** → afișat **„N/A”**. |
| `ctr_principalProfitEur`, `ctr_secondaryProfitEur`, `livr_principalProfitEur`, `livr_secondaryProfitEur` | `buildReport.js`: inițial 0, apoi completate din agregări (comenzi, activități). | `totalProfitEur(row)`: folosește 0 pentru lipsă/non-numeric → profit total poate fi 0 → **round2(0) = 0** → „0 EUR” (nu N/A). |
| `callsCount` | `buildReport.js`: incrementat pentru activități de tip call (e.g. `emp.callsCount++`). | `calcCallsPerWorkingDay`: callsCount negativ sau non-numeric → **null** → **„N/A”**. |
| `contactat`, `calificat` | `buildReport.js`: incrementate pentru tipuri „contact” / „qualified”. | `calcProspectingConversionPct`: null/negativ → **null** → **„N/A”**; contactat === 0 → **0** (determinist). |
| `periodStart`, `periodEnd` | `metas[0]` din `loadOrComputeMonthlyReport` → `getMonthRangeOffset` în `dateRanges.js`. | În bullet „Zile lucrătoare…”: dacă meta lipsește, `periodStartStr`/`periodEndStr` devin `''`. |
| `workingDaysInPeriod` | Calculat în job: `countWorkingDays(metas[0].periodStart, metas[0].periodEnd)`. | Dacă **null** sau **<= 0** → job **aruncă** înainte de loop-ul per angajat; nu se ajunge la build email. |

### 4.3 Cazul `getPersonRow` returnează `null`

- `data3Months.current` sau `.prev` pot fi `null`.  
- `buildEmployeeKpiBullets(null, prev, ...)` / `(cur, null, ...)`: în `kpiCalc` / `buildEmployeeKpiBullets` se folosesc `cur?.callsCount`, `totalProfitEur(null) === 0`, `calcTargetAchievementPct(null) === null` etc. → toate liniile primesc **N/A** unde e cazul; **nu se aruncă**.

---

## 5. Riscuri rămase: „Nu pot determina…” în email

### 5.1 Secțiunea 1 (tabel date performanță) – angajat

- **Risc: practic zero** pentru emailul lunar **angajat**.  
- Motiv: conținutul este **în întregime înlocuit** cu cele 5 bullet-uri deterministe; nu se folosește niciun text generat de LLM pentru secțiunea 1.

### 5.2 Secțiunile 2–5 și incheiere – angajat

- **Risc: existent.**  
- Secțiunile **sectiunea_2_interpretare_date**, **sectiunea_3_concluzii**, **sectiunea_4_actiuni_prioritare**, **sectiunea_5_plan_saptamanal** și **incheiere** (inclusiv `mesaj_sub_80` / `mesaj_peste_80`) sunt **100% din output-ul LLM**; nu există suprascriere.  
- Promptul angajat nu conține „Nu pot determina”, dar **nu interzice** nici acest tip de formulare; modelul poate genera oricum astfel de texte în aceste câmpuri.

### 5.3 Email departament

- **Risc: ridicat.**  
- Promptul **monthlyDepartmentPrompt.md** cere explicit: „Dacă o informație lipsește, spune explicit: «Nu pot determina din datele disponibile».”  
- Toate secțiunile raportului departamental (rezumat executiv, analize, comparație, recomandări, incheiere) sunt LLM; deci **orice secțiune** poate conține „Nu pot determina…” sau variante (ex. „Nu pot valida…”, „nu poate fi determinat…”).

### 5.4 Alte tipuri de email

- **Săptămânal (weekly):** nu s-a căutat în detaliu; nu există suprascriere KPI similară cu cea lunară. Dacă există texte generate de LLM sau template-uri cu fallback, acolo ar trebui verificat separat.  
- **Alte template-uri:** doar monthly employee și monthly department au fost analizate aici.

---

## 6. Riscuri de erori care opresc emailul

### 6.1 Erori de schemă AJV (employee)

- **Unde:** `backend/llm/validateMonthlyOutput.js` – `validateEmployeeOutput` → `validateEmployeeSchema(obj)`.  
- **Când:** Chei lipsă, tipuri greșite, stringuri goale unde `minLength:1`, array-uri cu &lt; 1 element unde `minItems:1`, chei suplimentare dacă `additionalProperties: false`.  
- **Modificările actuale:** Suprascrierea secțiunii 1 **îmbunătățește** stabilitatea: `continut` devine mereu un array de 5 stringuri non-goale, conform schemei. Normalizarea (care poate pune `['Date indisponibile']`) este urmată de overwrite, deci nu rămâne continut invalid pentru schemă.

### 6.2 Regula check-in (sectiunea_6)

- **Unde:** `validateMonthlyOutput.js` – `applyCheckInRule(obj, opts)`.  
- **Când:** `performancePct < 80` dar lipsește `sectiunea_6_check_in_intermediar`, sau `performancePct >= 80` dar sectiunea_6 este prezentă.  
- **Modificările actuale:** Nu o afectează; `performancePct` vine din `getPerformancePct(data3Months.current)` (profit/target); overwrite-ul nu schimbă sectiunea_6.

### 6.3 Regula mesajului de încheiere

- **Unde:** `validateMonthlyOutput.js` – `applyClosingMessageRule(obj, opts)`.  
- **Când:** Pentru `performancePct < 80`, `incheiere.mesaj_sub_80` lipsește sau e gol; pentru `>= 80`, `incheiere.mesaj_peste_80` lipsește sau e gol.  
- **Modificările actuale:** Nu o afectează.

### 6.4 assertFullStructure (template)

- **Unde:** `backend/email/templates/monthlyEmployee.js` – `assertFullStructure(llmSections)` (apelat în `buildMonthlyEmployeeEmailHtml` și `buildMonthlyEmployeeEmail`).  
- **Când:** Lipsește una dintre cheile: `antet`, `sectiunea_1_tabel_date_performanta`, `sectiunea_2_interpretare_date`, `sectiunea_3_concluzii`, `sectiunea_4_actiuni_prioritare`, `sectiunea_5_plan_saptamanal`, `incheiere`.  
- **Modificările actuale:** Dacă LLM nu ar returna deloc `sectiunea_1_tabel_date_performanta`, `applyEmployeeKpiOverwrite` **creează** `llmSections.sectiunea_1_tabel_date_performanta = { continut: arr }`, deci **reduce** riscul de throw la assertFullStructure pentru această cheie.

### 6.5 Throw-uri în job

- **workingDaysInPeriod invalid:** la începutul fluxului lunar; oprește tot job-ul.  
- **Eroare la LLM/validare:** în try/catch din loop-ul angajat; fail-fast, job-ul se oprește.  
- **Eroare la send:** în try/catch la `transporter.sendMail`; fail-fast.

---

## 7. Recomandări de mitigare (doar analiză, fără modificări de prompt)

### 7.1 Zero „Nu pot determina…” în tot emailul

1. **Post-procesare text în secțiunile narative (angajat)**  
   După suprascrierea secțiunii 1, într-un singur loc (ex. în job sau într-un helper de „sanitize”): parcurgere câmpurilor string/array din `llmSections` (sectiunile 2–5, incheiere) și înlocuirea substring-urilor „Nu pot determina” (și eventual „Nu pot valida…”, „nu poate fi determinat…”) cu un text neutru fix (ex. „Indicatorul nu este disponibil în datele curente.”) sau eliminare propoziție. **Risc:** scăzut; nu schimbă prompturile, doar output-ul LLM înainte de template.

2. **Filtru similar pentru emailul departament**  
   Același tip de post-procesare pe obiectul `departmentLlmSections` înainte de `buildMonthlyDepartmentEmail`, pentru a înlocui sau elimina formulele „Nu pot determina…” (fără a modifica promptul de departament).

3. **Monitoring / test E2E**  
   Test (sau check în CI) care randă HTML-ul final (angajat + departament) și face assert că `html.indexOf('Nu pot determina') === -1`. Dacă apare, build-ul eșuează și se poate investiga.

### 7.2 Minimizare crash-uri de schemă / structură

1. **Normalizare defensivă post-overwrite (opțional)**  
   După `applyEmployeeKpiOverwrite`, asigurare că `sectiunea_1_tabel_date_performanta.continut` are toate elementele string cu `minLength:1` (trim + eliminare stringuri goale; dacă rămâne gol, un singur element „N/A” sau „Date indisponibile”). Astfel chiar dacă viitoare modificări introduc edge case-uri, schema rămâne satisfăcută.

2. **Validare ușoară în job înainte de build**  
   Înainte de `buildMonthlyEmployeeEmail`, verificare că `llmSections.sectiunea_1_tabel_date_performanta?.continut` este array cu cel puțin un element. Dacă nu (ex. overwrite e apelat cu `lines` neașteptat), setare `continut = kpiLines` din nou sau fallback la cele 5 linii N/A; evită throw la template/schemă.

3. **Schema: relaxare ușoară acolo unde e acceptabil**  
   Ex.: pentru `sectiunea_1_tabel_date_performanta.continut`, păstrare `minItems: 1` dar eventual acceptarea de stringuri goale în array (sau `minLength: 0`) și tratarea în template ca „nu afișa linie” – reduce riscul ca un LLM să treacă validarea cu un array de stringuri goale în cazuri excepționale. (Aici se atinge doar schema/template, nu prompturile.)

---

**Document generat ca audit; nu conține modificări de cod sau de prompt-uri.**
