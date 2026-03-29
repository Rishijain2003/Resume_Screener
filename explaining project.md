# Explaining this project

This document is a concise architecture note for the **Sprinto RAG / resume screener** stack: a **FastAPI** backend, **Next.js** frontend, **PostgreSQL** (e.g. Supabase) for structured data, **MongoDB GridFS** for resume binaries, and **OpenAI** for extraction and scoring.

---

## LLM choice: **gpt-4o-mini**

We use **`gpt-4o-mini`** as the default chat model (configurable via `OPENAI_MODEL`). It balances cost and latency while supporting **structured outputs** (`chat.completions.parse` with Pydantic schemas) for:

- **Field extraction** — dynamic JSON fields defined in the UI.
- **Fit scoring** — a numeric score plus justification.

Embeddings (`text-embedding-3-small`) exist in `llm_chunks` for optional chunking/RAG-style experiments; **the main upload → extract → score path does not depend on embeddings today.**

---

## Prompting strategy

Prompts live in `backend/app/prompt.py` so behavior is easy to change without hunting through services.

### Extraction

- **System:** Extract only facts from the resume; use `null` for missing values; keep lists short; prefer a single number for years of experience when possible.
- **User:** A list of field keys and descriptions (from your config) plus truncated resume text (cap in code).

### Scoring (your weighted rubric)

Scoring uses a **detailed recruiter-style system prompt** with **fixed weights totaling 100%**. The model is instructed to score each bucket, then **normalize to a final 1–10** fit score. The criteria are:

| Criterion | Weight | Notes |
|-----------|--------|--------|
| **Core requirements match** | 30% | Skills/competencies vs JD; coverage and depth |
| **Experience relevance** | 20% | Years, seniority, responsibilities |
| **Domain & context alignment** | 20% | Relevance of past work; transferability |
| **Work quality & impact** | 15% | Complexity, ownership, measurable outcomes |
| **Soft skills** | 3% | Communication, teamwork, leadership |
| **Education & certifications** | 4% | Relevance; avoid over-weighting pedigree |
| **Resume quality & risks** | 8% | Missing sections, structure, vagueness, timeline inconsistencies |

The prompt also requires a **strict textual breakdown** (e.g. `Core Requirements: X/30`, …) before the final normalized score, and asks for **evidence-based** justification with explicit gaps and assumptions.

There is a second, shorter prompt path when scoring from **extracted JSON only** (no raw resume in context): same 1–10 + justification shape, tuned for “structured fields only.”

---

## File parsing

- **Supported types:** `.pdf` (PyMuPDF / `fitz`) and `.docx` (python-docx).
- **Flow:** Bytes are opened according to extension; text is concatenated from pages (PDF) or paragraphs (DOCX).

### What we do *not* handle (limitations)

- **Image-only / scanned PDFs:** There is **no OCR**. If the PDF has no extractable text layer, parsing yields empty text and the pipeline treats that as a failure (clear error message), not a silent success.
- **Corrupted or invalid files:** Open failures surface as parse errors; there is no repair or fallback format.
- **Other formats** (e.g. `.doc`, images): **Unsupported** — rejected with an explicit error.

On **upload**, for `.pdf` / `.docx`, the API may run a quick text extraction to reject empty/unreadable files **before** storing; other paths (e.g. full extract) enforce the same “must have text” rule.

---

## System architecture (end-to-end)

### 1. Duplicate detection (exact)

On upload, the server computes **SHA-256** over the **raw file bytes** (`actual_hash`). It queries PostgreSQL:

```sql
-- Conceptually: same role + same hash → duplicate
SELECT id FROM candidates WHERE role_id = ? AND actual_hash = ?
```

- If a row exists → **no new upload**: the API returns the existing `candidate_id` and marks the response as an exact duplicate.
- If not → the file is stored and a **new** `candidates` row is inserted.

Exact duplicates are **per role** (`UNIQUE (role_id, actual_hash)` in the schema).

### 2. Near-duplicates (after text exists)

**SimHash** over **normalized resume text** is computed during **extract**, not at upload. The fingerprint is stored as `normalized_hash`. The pipeline compares it to other candidates in the **same role** using **Hamming distance**; if within a small bit threshold (`simhash_near_duplicate_bits` in settings), a **warning** is attached (`duplicate_warning`) — the row is still kept; it is informational, not a hard block.

### 3. Where the resume file lives

- **MongoDB GridFS:** Original bytes are stored here; PostgreSQL holds **`mongo_file_id`** (GridFS file id) plus metadata (filename, MIME type, hashes, scores, etc.).

### 4. PostgreSQL tables (two main entities)

**`roles`**

- Job **title** and **job description text** (`jd_text`).
- Created/updated via the roles API; candidates reference `role_id`.

**`candidates`**

- One row per resume upload for a role: **`role_id`**, **`role_title`** (snapshot at upload), **`name`** (filled after extraction when available), hashes, **`mongo_file_id`**, **`extracted_data`** (JSON from LLM), **`config_snapshot`** (field definitions used for that parse), **`score`** / **`justification`**, **`parse_status`**, **`duplicate_warning`**, **`error_message`**, **`raw_text_preview`**, timestamps.

**How data gets in**

- **Roles:** API creates/updates role records (title + JD).
- **Candidates:** **POST upload** inserts a row (after duplicate check), uploads bytes to GridFS, sets status toward **`uploaded`**. **POST extract** loads from GridFS, parses text, runs LLM extraction, updates **`extracted_data`**, **`normalized_hash`**, preview, **`parse_status = parsed`**, clears score. **POST score** runs the fit model and sets **`score`**, **`justification`**, **`parse_status = completed`**.

### 5. After extract — what is stored where

| Location | What gets updated |
|----------|-------------------|
| **Postgres `candidates`** | `extracted_data`, `config_snapshot`, `name` (from extraction), `raw_text_preview`, `normalized_hash`, `duplicate_warning`, `parse_status = parsed`; score/justification cleared until the next score run |
| **MongoDB** | Unchanged for extract — file was already stored at upload |

### 6. Scoring

- **`full_resume`:** Load file from GridFS, parse text again, send resume + JD to the model → **`score`**, **`justification`**.
- **`extracted_values`:** Send JD + **`extracted_data` JSON** only (requires `parsed` first).

Both paths return structured **`FitScore`** (1–10 + short justification) and persist on the same candidate row.

### 7. Reranking / multi-role comparison

**POST `/rank-multi`** takes one **candidate** and a list of **target role ids**. The service loads the resume once from GridFS, parses text, then **scores that same text against each target role’s JD in parallel** (bounded by `llm_max_parallel`). Results are a list of `{ role_id, role_title, score, justification }` (or per-role errors) so you can **rank** which roles fit the candidate best without mutating stored scores on the original row.

### 8. Rescan

**POST `/rescan`** re-runs extraction for all non-skipped candidates in a role with a new field config (background task), refreshing **`extracted_data`** and resetting scores until you score again.

---

## How it was built (engineering shape)

- **Separation of concerns:** Routers handle HTTP; **`pipeline.py`** orchestrates GridFS + Postgres + LLM steps; **`parsing`**, **`hashing`**, **`llm_*`** are small focused modules; prompts are centralized in **`prompt.py`**.
- **Structured LLM I/O:** Pydantic models and `response_format` reduce brittle JSON parsing for extract and score.
- **Dual store:** Postgres for queryable metadata, uniqueness on `(role_id, actual_hash)`, and sorting by score; Mongo for large binaries.
- **Frontend:** Configures extraction fields and JDs, drives upload → extract → score and library/results views against the same API.

This keeps the system **inspectable** (hashes, statuses, warnings in SQL) while staying **cheap enough** to run repeatedly with **gpt-4o-mini** on real resume volumes.
