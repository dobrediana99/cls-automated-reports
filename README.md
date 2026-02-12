# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

## Backend (Node.js / Express)

The backend is a minimal HTTP server for deployment on Google Cloud Run. It exposes a health check and placeholders for job endpoints.

### Running the backend locally

1. Copy `.env.example` to `.env` and fill in at least `OIDC_AUDIENCE` (and optionally `SCHEDULER_SA_EMAIL`) if you want to call the protected endpoints from Cloud Scheduler (OIDC Bearer token).
2. Start the server:
   - **Production-style:** `npm run start`
   - **Development (with auto-reload):** `npm run dev:server`
3. The server listens on `http://localhost:8080` by default (override with the `PORT` environment variable).

### Docker & Cloud Run (backend only)

The backend can be deployed to **Google Cloud Run** using the image built from `backend/Dockerfile`. Do not copy `.env` into the image; configure secrets via Cloud Run environment variables or Secret Manager.

**Local run (Docker):**

- Build (context = backend, Dockerfile in backend):  
  `docker build -t cls-backend -f backend/Dockerfile backend`
- Run:  
  `docker run -p 8080:8080 -e PORT=8080 cls-backend`
- Healthcheck:  
  `curl http://localhost:8080/health`

**Cloud Run:**

- Build context: **backend** (directory)
- Dockerfile path: **backend/Dockerfile** (or `Dockerfile` when building from backend directory in Cloud Build)
- Set `PORT=8080` (Cloud Run sets this automatically). Configure `OIDC_AUDIENCE` (Cloud Run URL for OIDC), `MONDAY_API_TOKEN`, OpenRouter (`OPENROUTER_API_KEY` for monthly LLM), and email/sender env vars in the Cloud Run service.

### Calling `/health`

```bash
curl http://localhost:8080/health
```

Response: `{"status":"ok"}`

### Idempotency (no duplicates) – Local File Store

Weekly and monthly jobs must not send the same report twice for the same period (e.g. the same week label). Idempotency is implemented with a **local file-based store** (no Firestore or cloud credentials).

- **Where state is stored:** marker files under `backend/state/`, one per sent run:
  - `backend/state/weekly-<label>.sent` (e.g. `weekly-2026-01-19..2026-01-25.sent`)
  - `backend/state/monthly-<label>.sent`
- **How it works:** Before running a job, the app checks if a `.sent` file exists for that `jobType` and `label`. If it exists, the run is skipped with `{ skipped: true, reason: 'already_sent', jobType, label }`. After a successful send (and only when not in DRY_RUN), the app creates the marker file with minimal JSON (`createdAt`, `jobType`, `label`). If the job throws, the run is not marked as sent, so a retry will run again.
- **Resetting for tests:** Delete the marker file or the whole `backend/state/` folder, then run the job again — it will send again.
- **Limitation:** This method does not synchronize across multiple instances or servers. It is suitable for a single instance (e.g. one Cloud Run service or local dev). For multi-instance deployments you would need a shared store (e.g. Firestore or a DB).

### Monday API – throttling și retry (enterprise-grade)

Toate requesturile către Monday.com trec prin **backend/monday/httpClient.js**: limitare concurență, delay minim între requesturi, timeout, retry cu backoff exponențial + jitter. La 429 (inclusiv „Internal Request Error in column_values - 429” din răspunsul GraphQL) se face retry; se respectă header-ul **Retry-After** când există. Job-urile weekly/monthly nu mai cad pe 429, ci reîncearcă până la `MONDAY_MAX_ATTEMPTS`.

**Variabile opționale (.env):**

| Variabilă | Default | Descriere |
|-----------|---------|-----------|
| `MONDAY_MAX_CONCURRENT` | 2 | Requesturi Monday simultane (max) |
| `MONDAY_MIN_DELAY_MS` | 200 | Delay minim (ms) între pornirea a două requesturi |
| `MONDAY_TIMEOUT_MS` | 60000 | Timeout per request (ms) |
| `MONDAY_MAX_ATTEMPTS` | 8 | Încercări max la 429/5xx/rețea |
| `MONDAY_RETRY_BASE_MS` | 800 | Bază backoff (ms) |
| `MONDAY_RETRY_MAX_MS` | 30000 | Cap backoff (ms) |

**Dacă mai apar 429:** reduce agresivitatea: `MONDAY_MAX_CONCURRENT=1` și opțional `MONDAY_MIN_DELAY_MS=500`. Monthly produce multe call-uri (3 luni × boards/items/activities), de aceea throttle + retry sunt importante.

**Exemple de log la retry:**
```
[monday][retry] op=items_page attempt=1/8 status=429 waitMs=1200 reason=HTTP
[monday][retry] op=column_values attempt=2/8 status=429 waitMs=2500 reason=GraphQL: Internal Request Error in column_values - 429
```

### Prompt sources (permanent) – Monthly emails

Instrucțiunile pentru emailurile lunare (angajați + management) sunt **înghețate** în aplicație: stocate în fișiere Markdown în repo și folosite ca **singură sursă de adevăr** pentru structură, ton și reguli.

- **Documente-sursă** (conținutul lor este menținut în fișierele de mai jos):
  - **Prompt_Angajat_Raport** → `backend/prompts/monthlyEmployeePrompt.md`: reguli pentru analiza individuală + structură email angajat (tabel, interpretare, concluzii, acțiuni prioritare SMART, plan săptămânal, check-in intermediar doar dacă sub standard).
  - **Raport Departamental - Crystal Logistics Services** → `backend/prompts/monthlyDepartmentPrompt.md`: raport executiv departamental + companie pentru management (rezumat executiv, Vânzări, Operațional, comparații, recomandări; Total Company doar tabel, fără interpretare).
- **Fișiere obligatorii** (în repo):
  - `backend/prompts/monthlyEmployeePrompt.md`
  - `backend/prompts/monthlyDepartmentPrompt.md`
- **Folosire în cod:** La runtime, LLM prompt = (system instructions din fișier) + (date JSON) + (cerințe de output). Modulul `backend/prompts/loadPrompts.js` citește fișierele cu `fs.readFileSync`; `backend/email/monthly.js` le încarcă la fiecare construire de email. **Nu** se copiază fragmente de instrucțiuni în cod.
- **Garanție:** Dacă un fișier lipsește, aplicația aruncă eroare clară la runtime: `Missing prompt file: ... Required for monthly employee/management emails.`

#### Cum se actualizează instrucțiunile

- Modificările de logică, ton sau structură se fac **doar** în fișierele din `backend/prompts/`:
  - `backend/prompts/monthlyEmployeePrompt.md` – pentru email lunar angajat.
  - `backend/prompts/monthlyDepartmentPrompt.md` – pentru email lunar management/departamental.
- Nu edita fragmente de prompt în cod; nu duplica instrucțiunile în mai multe fișiere. După editare, rulează testele (`npm test`) pentru a verifica că loader-ul citește fișierele și că emailurile lunare conțin secțiunile cerute.

### Monthly job – cache și testare cu curl

- **Cache pe disc:** Rapoartele pentru cele 3 luni (curent, -1, -2) se salvează în `out/cache/monthly/<YYYY-MM>.json`. La rulări ulterioare, dacă fișierul există și nu se cere refresh, se încarcă din cache (fără fetch Monday). La `?refresh=1` sau `body: { "refresh": true }` se ignoră cache-ul și se refac toate cele 3 luni.
- **OpenRouter (obligatoriu pentru monthly):** Secțiunile Interpretare / Concluzii / Acțiuni / Plan (angajat) și Rezumat executiv / Vânzări / Operațional / Comparații / Recomandări (management) sunt generate cu OpenRouter (model default `anthropic/claude-opus-4.6`, override cu `OPENROUTER_MODEL`). Dacă analiza LLM eșuează sau output-ul este invalid, job-ul monthly **eșuează** (nu trimite email, nu marchează idempotency). Fără `OPENROUTER_API_KEY` job-ul monthly nu rulează (fail fast). Obține cheie la https://openrouter.ai
- **Trimitere reală (NON-DRY_RUN):** Job-ul trimite emailuri cu Nodemailer (GMAIL_USER, GMAIL_APP_PASSWORD). În `SEND_MODE=test` toate emailurile merg la `TEST_EMAILS`. Idempotency marchează sent **doar** după ce toate emailurile au fost trimise cu succes.
- **DRY_RUN=1:** Nu trimite emailuri; salvează în `out/` HTML-urile generate și XLSX-ul lunii.

**Comenzi curl:** Endpoint-urile `/run/weekly` și `/run/monthly` cer **Authorization: Bearer &lt;id_token&gt;** (OIDC). Cloud Scheduler poate fi configurat cu OIDC target; token-ul trebuie să aibă audience = URL-ul serviciului Cloud Run (OIDC_AUDIENCE). Pentru test local cu token obținut din gcloud sau din altă sursă:

```bash
# Monthly normal (folosește cache dacă există)
curl -s -X POST "http://localhost:8080/run/monthly" \
  -H "Authorization: Bearer <ID_TOKEN>" -H "Content-Type: application/json"

# Monthly cu refresh (ignoră cache, reface toate cele 3 luni)
curl -s -X POST "http://localhost:8080/run/monthly?refresh=1" \
  -H "Authorization: Bearer <ID_TOKEN>" -H "Content-Type: application/json"

# Sau refresh din body
curl -s -X POST "http://localhost:8080/run/monthly" \
  -H "Authorization: Bearer <ID_TOKEN>" -H "Content-Type: application/json" \
  -d "{\"refresh\": true}"
```

După trimitere cu succes, la o nouă rulare pentru aceeași lună răspunsul va fi `{ "skipped": true, "reason": "already_sent", "jobType": "monthly", "label": "..." }`.

**Test local cache monthly:**
1. Prima rulare monthly (DRY_RUN=1): creează 3 fișiere în `out/cache/monthly/` (ex. `2026-01.json`, `2025-12.json`, `2025-11.json`).
2. A doua rulare monthly (fără refresh): în log apare doar „cache hit” și nu se fac fetch-uri Monday.
3. Rulare cu `?refresh=1`: se refac toate cele 3 luni și se rescriu fișierele.

### Weekly report determinism & test local (PowerShell)

Rapoartele weekly pentru aceeași perioadă trebuie să fie deterministe (3 rulări consecutive ⇒ rezultate identice). Fetch-ul de activities este enterprise-grade: fără swallow de erori, retry cu backoff, validare de integritate, sortare consistentă.

**Teste unitare (fetchActivitiesForItems + monday client):**

```powershell
cd c:\Users\<user>\OneDrive\Documente\cls-automated-reports
npm run test -- backend/report/fetchData.test.js backend/monday/client.test.js
```

**Test de determinism (3 rulări weekly, comparare payload):**

Asigură-te că ai `.env` cu `MONDAY_API_TOKEN` (și opțional alte variabile). Scriptul setează `DRY_RUN=1` și rulează job-ul weekly de 3 ori cu aceeași perioadă (dată fixă), apoi compară `reportSummary` (company + dept totals). Dacă există diferențe, scriptul iese cu cod 1.

```powershell
cd c:\Users\<user>\OneDrive\Documente\cls-automated-reports
$env:DRY_RUN = "1"
node scripts/test-determinism.js
```

Sau folosind npm (scriptul încarcă `.env` și setează DRY_RUN):

```powershell
npm run test:determinism
```

Pentru a rula weekly manual (după ștergere marker) și a verifica idempotency:

```powershell
# Șterge markerul pentru perioada curentă (ex. weekly-2026-01-26..2026-02-01.sent)
Remove-Item backend\state\weekly-*.sent -ErrorAction SilentlyContinue
# Rulează job-ul (DRY_RUN sau cu OIDC: set OIDC_AUDIENCE și folosește Bearer ID token)
$env:DRY_RUN = "1"
# Cu OIDC: Invoke-RestMethod -Uri "http://localhost:8080/run/weekly" -Method POST -Headers @{ "Authorization" = "Bearer $idToken" } -ContentType "application/json"
Invoke-RestMethod -Uri "http://localhost:8080/run/weekly" -Method POST -Headers @{ "Authorization" = "Bearer <ID_TOKEN>" } -ContentType "application/json"
```

---

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) (or [oxc](https://oxc.rs) when used in [rolldown-vite](https://vite.dev/guide/rolldown)) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.
# CI green test Tue Feb  3 03:28:34 PM UTC 2026
