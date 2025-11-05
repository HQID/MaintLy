# Maintly

_Simple, modern predictive maintenance platform (monorepo, no Docker)._

## Ringkas

- **FE (React)** → antarmuka dashboard & chat.
- **BE1 (Hapi/Node)** → API publik & Agent (query‑based default, LLM opsional).
- **BE2 (FastAPI/Python)** → ETL dataset, training/inference, tulis hasil model ke DB.
- **DB (PostgreSQL)** → sumber kebenaran (machines, readings, predictions, anomalies, recommendations, tickets, models).

> Arsitektur: **BE2 menulis ke DB**, **BE1 membaca dari DB dan menyajikan ke FE**. Realtime hanya simulasi; fokus historis + prediksi.

---

## Prasyarat

- **PostgreSQL 16+** (psql/pgAdmin)
- **Node.js 20+** + npm
- **Python 3.10+** + pip + venv
- OS: Windows/macOS/Linux

---

## Struktur Repo (ringkas)

```
frontend/          # React (Vite)
service/
  api/             # BE1 – Hapi.js (public API & Agent)
  ml/              # BE2 – FastAPI (ETL + batch/inference)
db/
  init.sql         # skema inti Postgres
  seeds.sql        # (opsional) seed contoh
scripts/
  dev-all.sh|ps1   # jalankan FE + BE1 + BE2 sekaligus
```

---

## Konfigurasi Environment

Salin **.env.example** lalu ubah jadi **.env** di setiap paket.

**`service/api/.env.example`**

```
PORT=4000
POSTGRES_URL=postgres://pmc_user:pmc_pass@127.0.0.1:5432/pmc_db
AGENT_MODE=QUERY
FASTAPI_BASE_URL=http://127.0.0.1:5000
```

**`service/ml/.env.example`**

```
POSTGRES_URL=postgres://pmc_user:pmc_pass@127.0.0.1:5432/pmc_db
BE2_PORT=5000
DATASET_PATH=./data/predictive_maintenance.csv
MODEL_DIR=./models/rf_v1
```

**`frontend/.env.example`**

```
VITE_API_BASE_URL=http://127.0.0.1:4000
```

> **Jangan commit secret** – commit hanya `*.env.example` (lihat `.gitignore`).

---

## Buat Database & User (sekali)

**psql**

```sql
CREATE ROLE pmc_user LOGIN PASSWORD 'pmc_pass';
CREATE DATABASE pmc_db OWNER pmc_user;
```

**Migrate schema**

```bash
psql -h 127.0.0.1 -U pmc_user -d pmc_db -f db/init.sql
# (opsional) seed:
psql -h 127.0.0.1 -U pmc_user -d pmc_db -f db/seeds.sql
```

---

## Menjalankan (Development)

### Opsi A — Semua sekaligus

```bash
# Unix/macOS
chmod +x scripts/dev-all.sh
./scripts/dev-all.sh

# Windows (PowerShell)
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
./scripts/dev-all.ps1
```

### Opsi B — Per service

**BE1 (API)**

```bash
cd service/api
cp .env.example .env
npm install
npm run dev
```

**BE2 (ML)**

```bash
cd service/ml
cp .env.example .env
python -m venv .venv
# Windows: .\.venv\Scripts\Activate.ps1
# Unix:    source .venv/bin/activate
pip install -r requirements.txt
uvicorn app:app --reload --port 5000
```

**Frontend**

```bash
cd frontend
cp .env.example .env
npm install
npm run dev
```

**URL Lokal**

- FE: `http://127.0.0.1:5173`
- BE1: `http://127.0.0.1:4000`
- BE2: `http://127.0.0.1:5000`

---

## Dataset & Timestamp Sintetis

Dataset lama **tidak** punya timestamp → BE2 (ETL) membangkitkan `ts` sintetis agar bisa query periode (contoh: 7 hari terakhir).

Strategi (di ETL BE2):

- `anchor = "2025-10-01 08:00:00+08:00"` (Asia/Makassar)
- Per mesin (`Product ID`), urutkan baris → `ts = anchor + k * Δ` (mis. `Δ = 60 menit`)
- Simpan kolom ke tabel `sensor_readings.ts` / `predictions.ts` (timestamptz)

---

## Endpoint Publik (contoh minimum – BE1)

- `GET /api/machines` – ringkasan status mesin
- `GET /api/machines/{product_id}/readings?from&to&agg=5m` – time‑series historis
- `GET /api/machines/{product_id}/predictions?from&to` – skor/level historis
- `GET /api/machines/{product_id}/anomalies?limit=10`
- `GET /api/tickets` · `POST /api/tickets` · `PATCH /api/tickets/{id}`
- `POST /api/agent/chat` – Agent (QUERY default; LLM opsional)

> **BE2 tidak diekspos ke FE** – hanya untuk ETL/inference & akses internal dari BE1.

---

## Mode Agent

- `AGENT_MODE=QUERY` (default): intent tetap + query DB + reasoning rules sederhana.
- `AGENT_MODE=LLM` (opsional): LLM + tool‑calling **tetap memakai fakta dari DB**.

---
