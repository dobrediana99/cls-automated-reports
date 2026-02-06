# Analiză flow generare emailuri cu tabele

## 1) Flow complet

### Weekly

| Pas | Fișier | Funcție | Intră | Ieșire |
|-----|--------|---------|-------|--------|
| Date per perioadă | `backend/report/runReport.js` | `runReport` | periodStart, periodEnd, label, timezone | `{ meta, reportSummary, report }` — report = { opsStats, salesStats, mgmtStats, companyStats } |
| Rând per persoană | `backend/email/weekly.js` | `getPersonRow(report, person)` | report (opsStats/salesStats/mgmtStats), person din ORG | Un rând din listă (sau null): `list.find(r => r.name === person.name \|\| String(r.mondayId) === String(person.mondayUserId))` |
| Structură tabel | `backend/email/templates/weeklyEmployeeDetails.js` | `getOrderedRows(stats)` / `getOrderedRowsForDepartment(stats, department)` | stats = rândul unei persoane | Listă de [key, label, getter, formatter] |
| HTML tabel | `backend/email/templates/weeklyEmployeeDetails.js` | `buildEmployeeDetailsTable(stats, department)` | stats (un rând), department | HTML `<table>...</table>` |
| HTML email | `backend/email/templates/weeklyEmployeeDetails.js` | `buildWeeklyEmployeeEmailHtml({ introHtml, stats, department, ... })` | introHtml, stats (un rând), department | HTML document complet |
| Loop + send | `backend/jobs/weekly.js` | `runWeekly` | - | Pentru fiecare `person` din `ORG.filter(p => p.isActive)`: `stats = getPersonRow(report, person)` → `html = renderWeeklyEmployeeEmail(report, person, reportMeta)` → `await transporter.sendMail({ html, ... })` |

### Monthly

| Pas | Fișier | Funcție | Intră | Ieșire |
|-----|--------|---------|-------|--------|
| Rapoarte 3 luni | `backend/jobs/monthly.js` | `loadOrComputeMonthlyReport` x3 | period | reports[0..2], metas, reportSummaries |
| Date per persoană (3 luni) | `backend/jobs/monthly.js` | Loop `for (const person of activePeople)` | person, reports, reportSummaries | `data3Months = { current, prev, prev2 }` cu `getPersonRow(reports[i], person)`; `deptAverages3Months` din reportSummaries; LLM sections per persoană |
| Rând per persoană | `backend/email/monthly.js` | `getPersonRow(report, person)` | report, person | Același mecanism ca weekly: find pe name sau mondayId |
| Tabel în email | `backend/email/templates/monthlyEmployee.js` | `buildMonthlyEmployeeEmailHtml` | person, data3Months, llmSections, ... | `current = data3Months?.current` → `buildEmployeeDetailsTable(current, department)` (aceeași funcție ca weekly) |
| Loop + send | `backend/jobs/monthly.js` | Loop `for (const { person, data3Months, ... } of employeeLlmSections)` | element din employeeLlmSections | `buildMonthlyEmployeeEmail({ person, data3Months, ... })` → `await transporter.sendMail({ html, ... })` |

---

## 2) Shared state

- **Nu există** un obiect/array reutilizat între persoane: fiecare element din `employeeLlmSections` are propriul `data3Months` (referințe la rânduri din report). Fiecare apel `getPersonRow(report, person)` returnează o referință la un element din opsStats/salesStats/mgmtStats.
- **Nu există** variabile definite în afara loop-ului mutate în interior: `data3Months` este creat în loop și push-uit în array.
- Loop-urile de trimitere sunt **await** pe fiecare `sendMail`, deci nu există trimitere după ce datele au fost modificate de o iterație următoare.
- **Singurul risc de shared state**: dacă `getPersonRow` returnează același rând pentru două persoane diferite (vezi cauza 1).

---

## 3) Logică tabele

- **Weekly**: `renderWeeklyEmployeeEmail(report, person, meta)` → `stats = getPersonRow(report, person)` → `buildWeeklyEmployeeEmailHtml({ stats, department: person.department })` → `buildEmployeeDetailsTable(stats, department)`. Datele sunt **per persoană** (un rând din report).
- **Monthly**: `buildMonthlyEmployeeEmail` primește `data3Months.current` (rândul persoanei pentru luna curentă) și apelează `buildEmployeeDetailsTable(current, department)`. Nu se folosește reportSummary pentru tabelul individual; reportSummary este doar pentru emailul departamental.
- **buildEmployeeDetailsTable**: primește un singur obiect `stats` și iteră `getOrderedRowsForDepartment(stats, department)`; valorile sunt citite prin getter(stats) la momentul render-ului. Nu există replace/replaceAll pe placeholder-uri; totul este construit din datele din `stats`.

---

## 4) Procesare AI / Markdown

- Secțiunile LLM (interpretare, concluzii, acțiuni, plan) sunt HTML generat de Vertex și sunt injectate direct în șablon; **nu** se extrage niciun tabel din output-ul AI pentru „tabelul de date performanță”.
- Tabelul „Tabel date performanță” este generat **doar în cod** prin `buildEmployeeDetailsTable(current, department)` în `backend/email/templates/monthlyEmployee.js` (linia 61–63). Deci nu există confuzie „primul tabel găsit” sau delimitatori fragili pentru acest tabel.

---

## 5) Simulare Employee A vs Employee B

- **Employee A**: `getPersonRow(report, personA)` → rândul din opsStats/salesStats/mgmtStats care satisface `r.name === personA.name || String(r.mondayId) === String(personA.mondayUserId)` (primul match).
- **Employee B**: același `find` pentru personB. Dacă listele conțin rânduri distincte per persoană și name/mondayUserId sunt unice per persoană, fiecare primește rândul corect.
- **Risc**: dacă în același departament două persoane au același `name` sau același `mondayUserId`, `find()` returnează **primul** match. Atunci Employee B poate primi rândul lui Employee A (tabelul greșit).

---

## 6) Cauze probabile (max 3) + fix-uri

### Cauza 1 (cea mai probabilă): Match după name sau mondayId – „primul câștigător”

**De ce apare:** `getPersonRow` folosește `list.find((r) => r.name === person.name || String(r.mondayId) === String(person.mondayUserId))`. Dacă în același departament există două persoane cu același nume (sau același mondayUserId), doar prima primește rândul corect; a doua primește rândul primei.

**Fișier și zonă:**  
`backend/email/weekly.js` linia 20 și `backend/email/monthly.js` linia 23:

```js
return list.find((r) => r.name === person.name || String(r.mondayId) === String(person.mondayUserId)) || null;
```

**Fix recomandat:** Prioritate la identificator unic (mondayUserId); name doar fallback dacă mondayUserId lipsește sau nu găsește match.

```js
// backend/email/weekly.js – getPersonRow
function getPersonRow(report, person) {
  const { opsStats, salesStats, mgmtStats } = report;
  const list = /* ... */;
  const byId = list.find((r) => String(r.mondayId) === String(person.mondayUserId));
  if (byId) return byId;
  return list.find((r) => r.name === person.name) || null;
}
```

Aplică același pattern în `backend/email/monthly.js` pentru `getPersonRow`.

---

### Cauza 2: Departament nepotrivit → listă goală → tabel gol / „Nu există date”

**De ce apare:** Lista pentru `getPersonRow` se alege după `person.department` strict (MANAGEMENT / SALES / OPERATIONS). Dacă în ORG `person.department` nu este exact unul dintre valorile din `DEPARTMENTS` (typo, valoare nouă), `list` devine `[]`, find returnează `undefined`, și în șablon se afișează „Nu există date pentru această perioadă”.

**Fișier și zonă:**  
`backend/email/weekly.js` (linii 11–21), `backend/email/monthly.js` (linii 14–23).

**Fix recomandat:** Asigură-te că ORG folosește doar `DEPARTMENTS.OPERATIONS`, `DEPARTMENTS.SALES`, `DEPARTMENTS.MANAGEMENT`. Dacă vrei defensiv, poți loga când `list` este gol: `if (list.length === 0) console.warn('[getPersonRow] empty list for department', person.department, person.name);`.

---

### Cauza 3: Referință la același obiect „stats” dacă buildReport ar returna liste cu un singur element partajat

**De ce ar apărea:** În `buildReport.js`, `generateStats` creează obiecte noi per angajat și acestea sunt mutate în place. Dacă din greșeală s-ar crea o singură instanță partajată între mai multe intrări în listă, toți ar vedea aceleași date. În codul actual, `generateStats` face `employees.map((emp) => ({ ... }))`, deci fiecare element este distinct.

**Verificare:** Nu există în codebase nicio logică care să înlocuiască elementele din opsStats/salesStats/mgmtStats cu același obiect. Risc actual: foarte mic.

**Recomandare:** Păstrează `generateStats` ca `.map()` care creează obiect nou per angajat; evită orice refactor care ar putea partaja același obiect între mai multe rânduri.

---

## Patch concret pentru Cauza 1 (getPersonRow – prioritate mondayId)

În ambele fișiere, înlocuiește return-ul din getPersonRow cu match explicit pe mondayId mai întâi, apoi pe name:

**backend/email/weekly.js** (în funcția getPersonRow):

```js
const byMondayId = list.find((r) => String(r.mondayId) === String(person.mondayUserId));
if (byMondayId) return byMondayId;
return list.find((r) => r.name === person.name) || null;
```

**backend/email/monthly.js** (același pattern în getPersonRow):

```js
const byMondayId = list.find((r) => String(r.mondayId) === String(person.mondayUserId));
if (byMondayId) return byMondayId;
return list.find((r) => r.name === person.name) || null;
```

Astfel, dacă mondayUserId este setat corect și unic în Monday și în ORG, fiecare persoană primește întotdeauna rândul ei, chiar dacă există nume duplicate.
