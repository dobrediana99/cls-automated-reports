# Google Cloud Scheduler – rapoarte doar în zile lucrătoare

Aplicația este apelată de **Google Cloud Scheduler** prin HTTP (OIDC). Regulile de programare:

- **Săptămânal:** Luni la 08:00 (Europe/Bucharest).
- **Lunar:** Ziua 5 la 08:00, dar **doar dacă 5 este zi lucrătoare**; altfel prima zi lucrătoare după 5 (ex. 5 sâmbătă → luni 7; 5 duminică → luni 6).

Toate orele sunt în **Europe/Bucharest**.

---

## 1. Raport săptămânal (Luni 08:00)

| Setare        | Valoare |
|---------------|---------|
| **Frecvență** | Luni, 08:00 |
| **Cron**      | `0 8 * * 1` |
| **Timezone**  | `Europe/Bucharest` |
| **URL**       | `POST https://<CLOUD_RUN_SERVICE_URL>/run/weekly` |
| **Auth**      | OIDC (Audience = URL-ul serviciului Cloud Run) |

Luni este zi lucrătoare, deci nu e nevoie de logică suplimentară în backend.

---

## 2. Raport lunar (5 la 08:00, sau prima zi lucrătoare după 5)

| Setare        | Valoare |
|---------------|---------|
| **Frecvență** | Zilele 5, 6 și 7 ale fiecărei luni, la 08:00 |
| **Cron**      | `0 8 5,6,7 * *` |
| **Timezone**  | `Europe/Bucharest` |
| **URL**       | `POST https://<CLOUD_RUN_SERVICE_URL>/run/monthly` |
| **Auth**      | OIDC |

Backend-ul decide singur dacă „azi” este ziua de trimitere:

- Dacă **da** (prima zi lucrătoare pe sau după 5): rulează job-ul lunar.
- Dacă **nu**: răspunde `200` cu `{ "skipped": true, "reason": "not_monthly_send_day" }` și nu trimite emailuri.

Pentru rulare manuală în orice zi (ex. teste): `POST .../run/monthly?force=1` (cu același OIDC).

---

## 3. Creare job-uri în Google Cloud Console

1. **Cloud Scheduler** → **Create job**.
2. **Name:** ex. `cls-weekly-report`, `cls-monthly-report`.
3. **Frequency:** Unigram (cron) → `0 8 * * 1` (weekly) sau `0 8 5,6,7 * *` (monthly).
4. **Timezone:** `Europe/Bucharest`.
5. **Target type:** HTTP.
6. **URL:** URL-ul serviciului Cloud Run + `/run/weekly` sau `/run/monthly`.
7. **HTTP method:** POST.
8. **Auth header:** OIDC token; **Audience** = URL-ul serviciului Cloud Run (același ca în `OIDC_AUDIENCE` din env).
9. **Service account:** Contul folosit pentru a genera token-ul (același ca în Cloud Scheduler / Run).

---

## 4. Exemplu gcloud (opțional)

```bash
# Săptămânal – Luni 08:00 Europe/Bucharest
gcloud scheduler jobs create http cls-weekly-report \
  --location=europe-west1 \
  --schedule="0 8 * * 1" \
  --time-zone="Europe/Bucharest" \
  --uri="https://<SERVICE_URL>/run/weekly" \
  --http-method=POST \
  --oidc-service-account-email=<SA_EMAIL> \
  --oidc-token-audience="https://<SERVICE_URL>"

# Lunar – 5, 6, 7 la 08:00 Europe/Bucharest
gcloud scheduler jobs create http cls-monthly-report \
  --location=europe-west1 \
  --schedule="0 8 5,6,7 * *" \
  --time-zone="Europe/Bucharest" \
  --uri="https://<SERVICE_URL>/run/monthly" \
  --http-method=POST \
  --oidc-service-account-email=<SA_EMAIL> \
  --oidc-token-audience="https://<SERVICE_URL>"
```

Înlocuiește `<SERVICE_URL>` cu URL-ul real al serviciului Cloud Run și `<SA_EMAIL>` cu service account-ul folosit pentru OIDC.

---

## 5. Doar email departamental, pe 5 și pe 15

Dacă vrei **fără emailuri individuale** și două rulări separate (5 + 15), configurează:

- Job #1 (toate emailurile): `windowStart=5`, `scope=all`, `slot=05`
- Job #2 (doar departamental): `windowStart=15`, `scope=department_only`, `slot=15`

`slot` separă idempotency/run-state, astfel încât rularea din 15 nu este blocată de cea din 5.

Exemplu URL-uri Scheduler:

- `POST https://<SERVICE_URL>/run/monthly?windowStart=5&scope=all&slot=05`
- `POST https://<SERVICE_URL>/run/monthly?windowStart=15&scope=department_only&slot=15`

Scheduler cron recomandat:

- pentru fereastra 5..7: `0 8 5,6,7 * *`
- pentru fereastra 15..17: `0 8 15,16,17 * *`

Backend-ul va trimite **o singură dată** în fiecare fereastră (prima zi lucrătoare din fereastră).

Notă importantă: endpoint-ul `/run/monthly` rulează acum cu `refresh=true` implicit, deci la trimitere se recalculează datele (fără citire snapshot).
