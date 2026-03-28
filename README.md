# Resume Screener (Sprinto assignment)

FastAPI backend with PostgreSQL (Supabase) for structured rows, MongoDB GridFS for PDF/DOCX binaries, and a Next.js UI. Three LLM flows: dynamic-field extraction (Pydantic schema from config), fit scoring with justification, and optional RAG chunking plus embeddings.

## Prerequisites

- Python 3.10+
- Node.js 18.17+ (for the frontend; Node 20+ or 24 LTS recommended)
- Empty Supabase Postgres database and MongoDB Atlas (or compatible) cluster
- OpenAI API key with access to `gpt-4o-mini` and `text-embedding-3-small`

## Environment

Create `.env` at the **repository root** (same level as `config/` and `sql/`):

- `MONGO_URI` — Mongo connection string
- `SUPABASE_URI` — Postgres connection string
- `OPENAI_API_KEY`
- `OPENAI_MODEL` — default `gpt-4o-mini`
- `OPENAI_EMBEDDING_MODEL` — default `text-embedding-3-small`
- `MONGO_TLS_DISABLE_OCSP_CHECK` — default **true** (recommended on many cloud VMs where OCSP to Atlas is blocked); set `false` only if you need stricter revocation checks
- `MONGO_TLS_INSECURE` — optional `true` **debugging only** if TLS still fails (skips certificate verification)
- `LOG_LEVEL` — default **INFO** for all `app.*` loggers; use **DEBUG** for verbose parsing/hash steps (also configurable as `log_level` in settings)
- `CORS_ALLOW_ORIGINS` — optional comma-separated list (e.g. `https://myapp.vercel.app`) for the deployed UI; if unset, localhost dev origins are used

## Database setup

```bash
cd /path/to/Sprinto-Rag-Agent
python3 -m venv backend/.venv
source backend/.venv/bin/activate
pip install -r backend/requirements.txt
python scripts/init_db.py
```

This runs `sql/schema.sql` against `SUPABASE_URI`.

### Seed default job roles (optional)

After the schema exists, you can insert five standard roles (Backend Engineer, Frontend Engineer, Senior Backend Engineer, AI Implementation Engineer, HR Head) if those titles are not already present:

```bash
# from repo root, venv activated (same as above)
python scripts/seed_roles.py
```

Role text is also kept in `config/jd_config.json` for template import in the UI.

If you see **`OSError: [Errno 101] Network is unreachable`**, the problem is **routing to Supabase** (not your password). If DNS shows **no IPv4** for `db.*.supabase.co` and only **IPv6**, but this host has **no IPv6 route**, use the **Connection Pooler** URI from Supabase (Dashboard → Database → often `aws-0-<region>.pooler.supabase.com` on port **6543**), which usually resolves over **IPv4**. Alternatively enable IPv6 on the VPC/instance or run `init_db` from a network with working IPv4/IPv6.

## MongoDB / Atlas

- **Network Access:** In Atlas → **Network Access**, add your machine’s **public IP** or `0.0.0.0/0` for testing. Uploads fail with TLS/timeout errors if the cluster rejects the connection.
- **TLS:** The app uses **certifi** for the CA bundle, sets `SSL_CERT_FILE`, and by default uses **`MONGO_TLS_DISABLE_OCSP_CHECK=true`** to avoid handshake failures when OCSP is blocked.
- If you still see `SSL handshake failed` / `TLSV1_ALERT_INTERNAL_ERROR`, set **`MONGO_TLS_INSECURE=true`** temporarily to confirm it is TLS-related, then fix CA/network; turn insecure mode off for production.
- On startup, the API logs `MongoDB ping OK` or an error if the cluster is unreachable.

## Run the API

```bash
source backend/.venv/bin/activate
cd backend
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Open `http://127.0.0.1:8000/docs` for OpenAPI.

## Run the UI

```bash
cd frontend
cp .env.local.example .env.local   # adjust API URL if needed
npm install
npm run dev
```

Visit `http://localhost:1830` (dev server port is set in `frontend/package.json`).

### Supabase Postgres (`SUPABASE_URI`)

1. In the [Supabase dashboard](https://supabase.com/dashboard), open **Rishijain2003's Project** (or your project).
2. Go to **Project Settings** (gear) → **Database**.
3. Under **Connection string**, choose **URI**. Use the **password** you set when creating the project (reset it under **Database** if needed).
4. Paste into `.env` as `SUPABASE_URI=...`  
   - Prefer adding **`?sslmode=require`** at the end if not already present.  
   - If you see **Session pooler** / **Transaction pooler** (port **6543**), that is fine for long‑lived apps; **Direct connection** (port **5432**) is also fine.
5. If you get **`Network is unreachable`** from your server: ensure the machine has outbound internet, security group allows outbound **5432** (or **6543** for pooler), and try the **pooler** host if IPv6 routing is an issue.

Then run `python scripts/init_db.py` again from the repo root (with venv activated).

## Architecture notes

- **Postgres (Supabase):** `roles` (title + JD text only). `candidates` (per-upload row: `role_title`, hashes, extracted JSON, score, justification, `mongo_file_id`, `config_snapshot` = extraction JSON the client sent for that upload). Extraction field definitions are **not** stored on `roles`; the UI sends them on **upload** and **re-scan** (and keeps a per-role copy in **browser `localStorage`** for convenience). RAG/chunk tables are not used in this version. Deleting a role **cascades** to its candidates in Postgres (`ON DELETE CASCADE`). Resume binaries live in **MongoDB GridFS**. Schema migrations: `sql/migrate_v2_candidates_role_title.sql` (older DBs), `sql/migrate_v3_drop_roles_extraction_config.sql` (drop `roles.extraction_config`).
- **MongoDB:** GridFS bucket `resume_files` in database `resume_screener` (configurable via `MONGO_DB_NAME`).
- **Duplicates:** `actual_hash` = SHA-256 of file bytes; `normalized_hash` = SimHash of normalized text; uniqueness on `(role_id, actual_hash)`; near-duplicate warning via Hamming distance on SimHash (scoped per role).
- **Default extraction fields:** `config/default_extraction.json`; the UI can load this JSON and edit per role.

## API summary

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/roles` | Create role + JD + extraction config (optional body `id` = UUID) |
| GET | `/api/roles` | List roles |
| GET | `/api/roles/applicant-counts` | Map of `role_id` → number of uploads (`candidates` rows) |
| PATCH | `/api/roles/{id}` | Update JD / config |
| DELETE | `/api/roles/{id}` | Delete role (cascades candidates in Postgres) |
| POST | `/api/upload` | Multipart: `role_id`, `file`, `extraction_config` (JSON string of `{ version, fields }`); file → GridFS, row → Postgres |
| GET | `/api/candidates/library` | All resumes (joined with role title); optional `?role_id=` filter |
| GET | `/api/candidates/{id}/file` | Download original file bytes from GridFS |
| GET | `/api/results?role_id=` | Candidates ordered by score DESC |
| POST | `/api/score` | Re-score one candidate vs its role JD |
| POST | `/api/rescan` | JSON body: `role_id` + `extraction_config` (same shape as upload) |
| POST | `/api/rank-multi` | One resume vs multiple roles |
| GET | `/api/config/default-extraction` | Default field definitions |
