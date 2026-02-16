# Audit complet: CTR/CRT, bonus, tabel email, termene/profitability, emailsCount

**Data:** 2026-02-13

---

## 1️⃣ Audit CTR / CRT – toate utilizările

| Câmp | Fișier | Funcție / context | Utilizare | Eliminare din tabel email afectează altă logică? |
|------|--------|-------------------|-----------|--------------------------------------------------|
| **ctr_principalCount** | `backend/report/buildReport.js` | `generateStats`, atribuire la comenzi | f) Internal aggregation (populare row) | Nu. Doar sursa datelor. |
| **ctr_principalCount** | `backend/report/runReport.js` | `computeTotals` | f) Internal aggregation (total departament) | Nu. Totalurile rămân. |
| **ctr_principalCount** | `backend/email/templates/weeklyEmployeeDetails.js` | `getOrderedRows` → row în tabel | a) Email display | **Da** – dispare rândul din email. |
| **ctr_principalCount** | `backend/email/templates/monthlyEmployee.js` | `isSubStandard` (totalProfit = ctr + livr) | (logică sub 80% target) | Nu – doar folosește profit total, nu afișează CTR. |
| **ctr_principalCount** | `backend/report/departmentAnalytics.js` | `computeEmployeeKpis` (totalTripsCtr, etc.) | f) Internal aggregation | Nu. |
| **ctr_principalCount** | `src/App.jsx` | tabel, totaluri, medii | e) Dashboard/UI | Nu – doar vizual. |
| **ctr_principalCount** | `backend/export/weeklyReportWorkbook.js` | coloane XLSX, totaluri | c) XLSX export | Nu – doar coloane. |
| **ctr_principalProfitEur** | (aceleași fișiere ca mai sus) | Idem | a) Email, c) XLSX, e) Dashboard, f) Aggregation | Same as above. |
| **ctr_secondaryCount** | (aceleași) | Idem | Idem | Idem. |
| **ctr_secondaryProfitEur** | (aceleași) | Idem | Idem | Idem. |
| **totalCtrCount** | `backend/email/templates/weeklyEmployeeDetails.js` | `getOrderedRows`: `totalCtrCount = v('ctr_principalCount') + v('ctr_secondaryCount')` | a) Email display (rând „Total curse după contract”) | **Da** – dispare rândul. |
| **totalCtrCount** | `src/App.jsx` | calcul local + tabel + totaluri | e) Dashboard/UI | Nu. |
| **totalCtrCount** | `backend/export/weeklyReportWorkbook.js` | calcul + coloane XLSX | c) XLSX export | Nu. |
| **totalCtrProfit** | `weeklyEmployeeDetails.js` | `totalCtrProfit = ...` + `profitPesteTarget = totalCtrProfit - target` | a) Email display + **b) Bonus** (profit peste target) | **Da** – și bonusul din email (profitPesteTarget). |
| **totalCtrProfit** | `src/App.jsx` | `bonus = totalProfitEurCtr - target`, coloane | b) Bonus, e) Dashboard | Da pentru bonus în UI. |
| **totalCtrProfit** | `backend/export/weeklyReportWorkbook.js` | `bonus = totalProfitEurCtr - target`, coloane | b) Bonus, c) XLSX | Da pentru coloana „Profit peste target” în XLSX. |

**Rezumat 1:**  
- **Email:** toate (ctr_principalCount, ctr_principalProfitEur, ctr_secondaryCount, ctr_secondaryProfitEur, totalCtrCount, totalCtrProfit) sunt folosite în **tabelul** din `weeklyEmployeeDetails.js` (getOrderedRows).  
- **Bonus (profit peste target)** folosește **totalCtrProfit** (CTR), nu totalLivrProfit, în: email (`profitPesteTarget`), App.jsx, weeklyReportWorkbook.js.  
- **Eliminarea doar a rândurilor CTR din tabelul de email** (fără a șterge câmpurile din obiectul stats) nu rupe totaluri, XLSX sau departmentAnalytics; doar **profitPesteTarget** este și el afișat ca rând în același tabel – dacă îl lași, doar rândurile CTR dispar din email.

---

## 2️⃣ Audit logică bonus (profit peste target)

### Formule găsite

| Locație | Formulă exactă | Câmp profit folosit |
|---------|----------------|---------------------|
| `backend/email/templates/weeklyEmployeeDetails.js` (linia 56) | `profitPesteTarget = totalCtrProfit - target` | **totalCtrProfit** (ctr_principalProfitEur + ctr_secondaryProfitEur) |
| `src/App.jsx` (linia 203) | `bonus = totalProfitEurCtr - target` | **totalProfitEurCtr** (același: CTR) |
| `backend/export/weeklyReportWorkbook.js` (linia 117) | `bonus = totalProfitEurCtr - target` | **totalProfitEurCtr** (CTR) |
| `src/App.jsx` (linia 378) | `bonusTotal = totalCtrProfit - targetTotal` | **totalCtrProfit** (agregat CTR) |
| `backend/export/weeklyReportWorkbook.js` (linia 324) | `bonusTotal = totalCtrProfit - totals.targetTotal` | **totalCtrProfit** (agregat CTR) |

În **toate** locurile, bonusul / profit peste target este **totalCtrProfit - target** (sau variante agregate), nu totalLivrProfit.

### totalLivrProfit

- **totalLivrProfit** = livr_principalProfitEur + livr_secondaryProfitEur.
- Este folosit pentru: afișare „Total profit după livrare” în email, XLSX, dashboard; **nu** pentru bonus în niciun fișier.
- Da: în cod **totalLivrProfit** reprezintă întotdeauna „profit total după livrare” (suma profiturilor livrare principal + secundar).

### Schimbarea la bonus = totalLivrProfit - target

- **Impact:**  
  - **Email:** rândul „Profit peste target” ar reflecta (livr - target) în loc de (ctr - target).  
  - **XLSX (weekly + monthly):** coloana „PROFIT PESTE TARGET” ar avea aceeași nouă formulă.  
  - **Dashboard (App.jsx):** coloana „Profit peste target” ar avea aceeași nouă formulă.  
- **Ce nu se schimbă:** totalurile de tip `computeTotals` (runReport.js), departmentAnalytics (KPI-uri bazate pe totalProfitCtr / totalProfitAll), buildReport și agregările din weeklyReportWorkbook rămân pe datele brute; doar **afișarea** bonusului și valoarea din coloana bonus se schimbă.  
- **Concluzie:** schimbarea la `bonus = totalLivrProfit - target` **nu** rupe totaluri, raport manager sau exporturi; doar **semnificația** bonusului afișat (email, XLSX, UI) devine „profit peste target după livrare” în loc de „după contract”.

---

## 3️⃣ Audit utilizare buildEmployeeDetailsTable & getOrderedRows

### buildEmployeeDetailsTable

| Fișier | Utilizare | Template email |
|--------|-----------|----------------|
| `backend/email/templates/weeklyEmployeeDetails.js` | Definit aici; folosit în `buildWeeklyEmployeeEmailHtml(stats, department)` | **Weekly** (angajat + manager) |
| `backend/email/templates/monthlyEmployee.js` | Import `buildEmployeeDetailsTable` din `weeklyEmployeeDetails.js`; apel `buildEmployeeDetailsTable(current, department)` pentru tabelul lunar | **Monthly** (angajat) |

Deci: **weekly** și **monthly** folosesc **același** generator de tabel (`buildEmployeeDetailsTable` din `weeklyEmployeeDetails.js`).

### getOrderedRows

| Fișier | Utilizare |
|--------|-----------|
| `backend/email/templates/weeklyEmployeeDetails.js` | `getOrderedRows(stats)` – construiește lista de rânduri; `getOrderedRowsForDepartment(stats, department)` filtrează după departament (exclude contactat/calificat/emails/calls/rata_conv pentru Operatiuni/Management). |
| Apelat doar din `buildEmployeeDetailsTable` → deci doar pentru **tabelul** din email (weekly + monthly). |

**Răspuns:**  
- **Care template-uri îl folosesc:** weekly (angajat + manager) și monthly (angajat). Managerul weekly primește același tip de tabel (buildEmployeeDetailsTable) cu stats per persoană/context.  
- **Weekly și monthly:** da, folosesc **același** table generator (buildEmployeeDetailsTable → getOrderedRowsForDepartment → getOrderedRows).  
- **Eliminarea rândurilor din getOrderedRows:** afectează **doar** tabelul din email (weekly + monthly). Nu există alt raport (XLSX, API, dashboard) care să folosească getOrderedRows; XLSX-ul și App.jsx au propriile liste de coloane. Deci **da** – eliminarea unor rânduri din getOrderedRows afectează **doar** afișarea în email, nu și alte tipuri de raport.

---

## 4️⃣ Audit „Sumă / Număr” termene & profitability

| Câmp | Fișier | Doar email? | Folosit în calcule? | XLSX? | Eliminare rând din tabel email rupe ceva? |
|------|--------|-------------|----------------------|-------|------------------------------------------|
| **sumClientTerms** | `backend/report/buildReport.js` | Nu | Populare row | — | Nu |
| **sumClientTerms** | `backend/report/runReport.js` | Nu | computeTotals (agregare) | — | Nu |
| **sumClientTerms** | `backend/email/templates/weeklyEmployeeDetails.js` | Da (rând în tabel) | Da – pentru **termenMediuClient** (avg) în același fișier | — | Nu (doar dispare rândul; media se poate folosi în continuare în alte rânduri dacă rămâne) |
| **sumClientTerms** | `backend/report/departmentAnalytics.js` | Nu | **avgClientTerm** (countClientTerms > 0 ? sumClientTerms/countClientTerms : null) | — | Nu |
| **sumClientTerms** | `src/App.jsx` | Nu | avgClientTerm pentru UI | — | Nu |
| **sumClientTerms** | `backend/export/weeklyReportWorkbook.js` | Nu | avgClientTerm pentru XLSX | **Da** (termen client) | Nu |
| **countClientTerms** | (aceleași) | Idem | În calcule (avg, count) | Da | Nu |
| **sumSupplierTerms** | (analog) | Idem | termenMediuFurnizor, agregări | Da | Nu |
| **countSupplierTerms** | (analog) | Idem | Idem | Da | Nu |
| **sumProfitability** | (analog) | Idem | avgProfitability în email, departmentAnalytics, XLSX | Da | Nu |
| **countProfitability** | (analog) | Idem | Idem | Da | Nu |

**Rezumat 4:**  
- Sunt folosite pentru **afișare** în tabelul de email (getOrderedRows), pentru **calcule** (termen mediu client/furnizor, profitability medie) în același modul și în departmentAnalytics, și în **XLSX** (weeklyReportWorkbook).  
- Eliminarea **doar a rândurilor** „Sumă termene client”, „Număr termene client”, „Sumă termene furnizor”, „Număr termene furnizor”, „Sumă profitability”, „Număr profitability” din tabelul de email **nu** rupe calculele sau XLSX; rămân disponibile în obiectul stats și în export. Doar vizualizarea acestor rânduri în email dispare.

---

## 5️⃣ Audit emailsCount

| Fișier | Doar afișare email? | Folosit în rata conversie / KPI? | Export / API? | Eliminare din tabel email rupe calcule? |
|--------|---------------------|----------------------------------|---------------|----------------------------------------|
| `backend/report/buildReport.js` | Nu | Nu | Nu | Nu – doar populare câmp |
| `backend/report/runReport.js` | Nu | Nu | Nu | Nu – doar agregare total |
| `backend/email/templates/weeklyEmployeeDetails.js` | **Da** (rând „Emailuri” în getOrderedRows) | **Nu** – rata conversie folosește contactat/calificat | Nu | Nu |
| `backend/email/templates/weeklyEmployeeDetails.js` | — | — | — | **EXCLUDED_KEYS_NON_SALES**: emailsCount e exclus pentru Operatiuni/Management (nu văd rândul) |
| `src/App.jsx` | Nu (e coloană în tabel) | Nu | Nu (doar UI) | Nu |
| `backend/export/weeklyReportWorkbook.js` | Nu | Nu | **Da** – coloană EMAILS în XLSX (sales) | Nu |
| Teste (monthly.test, weeklyEmployeeDetails.test, xlsx.test) | — | — | — | Nu |

**Răspuns:**  
- **emailsCount** este folosit pentru: afișare în email (rând „Emailuri” pentru Vanzari), coloană în XLSX (sales), coloană în dashboard.  
- **Nu** este folosit în niciun calcul de rata conversie sau KPI (rata conversie = calificat / (contactat + calificat)).  
- Eliminarea lui **doar din tabelul de email** (ex. ștergerea rândului din getOrderedRows sau păstrarea exclusiei doar pentru OPS/MGMT) nu rupe niciun calcul; XLSX și App.jsx îl citesc din același obiect de date, nu din tabelul HTML.

---

## 6️⃣ Rezumat final – ce e safe să elimini

### Câmpuri SAFE să fie eliminate **doar din afișarea tabelului de email**

(Adică să scoți rândurile din `getOrderedRows` din `weeklyEmployeeDetails.js`, **fără** a șterge câmpurile din buildReport/runReport/departmentAnalytics/export.)

- **ctr_principalCount**, **ctr_principalProfitEur**, **ctr_secondaryCount**, **ctr_secondaryProfitEur**, **totalCtrCount**, **totalCtrProfit** – safe să dispară doar din tabelul de email.  
  - Atenție: **profitPesteTarget** (bonus) este calculat din totalCtrProfit; dacă îl lași ca rând în tabel, doar rândurile CTR dispar; dacă vrei să schimbi și formula bonus la totalLivrProfit, trebuie schimbată în toate locurile (vezi secțiunea 2).
- **sumClientTerms**, **countClientTerms**, **sumSupplierTerms**, **countSupplierTerms**, **sumProfitability**, **countProfitability** – safe să fie scoase doar din tabelul de email; calculele (termen mediu, profitability) și XLSX rămân neschimbate.
- **emailsCount** – safe să fie scos doar din tabelul de email (sau deja ascuns pentru Operatiuni/Management).

### Câmpuri **nu** sunt safe să fie eliminate complet din cod

- **ctr_principal* / ctr_secondary*** – sunt necesare în: buildReport (aggregare), runReport (computeTotals), departmentAnalytics (KPI-uri), XLSX (weeklyReportWorkbook), App.jsx (dashboard). Eliminarea lor din cod ar strica totaluri, raport manager, export, analytics.
- **totalCtrCount / totalCtrProfit** – derivate; folosite pentru bonus și afișare. Eliminarea completă ar necesita să nu mai ai nici bonus bazat pe CTR.
- **sum*Terms / count*Terms / sum*Profitability / count*Profitability** – folosite în departmentAnalytics și XLSX; nu pot fi șterse din cod fără a rupe analytics și export.
- **emailsCount** – folosit în XLSX (sales) și în buildReport/runReport; poți să nu îl mai afișezi în email, dar eliminarea completă din cod ar afecta XLSX și agregările.

### Efecte dacă elimini **doar** rândurile CTR din tabelul de email

- **Email (weekly + monthly):** dispare din tabel: Curse CTR principal, Profit CTR principal, Curse CTR secundar, Profit CTR secundar, Total curse după contract, Total profit după contract.  
- Poți **păstra** rândul „Profit peste target” – el folosește în continuare totalCtrProfit (sau, după modificare, totalLivrProfit); nu se rupe nimic.  
- **XLSX, dashboard, departmentAnalytics, totaluri:** rămân neschimbate; datele CTR rămân în obiecte și sunt folosite acolo.

---

**Document generat din auditul codului (backend + src + export).**
