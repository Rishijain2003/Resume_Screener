-- Sprinto Resume Screener — PostgreSQL (Supabase)
-- Run once against an empty database: python scripts/init_db.py

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Job role + JD. Extraction field definitions are defined in the UI only and sent per upload/rescan.
CREATE TABLE roles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title TEXT NOT NULL,
    jd_text TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_roles_created ON roles (created_at DESC);

-- One row per resume upload (applicant): metadata + scores in Postgres; file bytes in MongoDB GridFS.
-- extracted_data: dynamic key/value map from LLM extraction.
-- config_snapshot: JSON the client sent for this upload (field definitions used for that parse).
CREATE TABLE candidates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    role_id UUID NOT NULL REFERENCES roles (id) ON DELETE CASCADE,
    role_title TEXT NOT NULL DEFAULT '',
    name TEXT,
    -- SHA-256 hex of raw file bytes — exact duplicate check: UNIQUE (role_id, actual_hash)
    actual_hash CHAR(64) NOT NULL,
    -- SimHash hex of normalized resume text — near-duplicate warning within the same role
    normalized_hash VARCHAR(32) NOT NULL,
    mongo_file_id TEXT NOT NULL,
    original_filename TEXT,
    mime_type TEXT,
    extracted_data JSONB NOT NULL DEFAULT '{}'::jsonb,
    config_snapshot JSONB,
    score SMALLINT CHECK (score IS NULL OR (score >= 1 AND score <= 10)),
    justification TEXT,
    parse_status TEXT NOT NULL DEFAULT 'pending',
    duplicate_warning TEXT,
    error_message TEXT,
    raw_text_preview TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (role_id, actual_hash)
);

CREATE INDEX idx_candidates_role_score ON candidates (role_id, score DESC NULLS LAST);
CREATE INDEX idx_candidates_role_normhash ON candidates (role_id, normalized_hash);
CREATE INDEX idx_candidates_role_created ON candidates (role_id, created_at DESC);
CREATE INDEX idx_candidates_role_title ON candidates (role_title);

COMMENT ON TABLE roles IS 'Job descriptions and per-role extraction field definitions.';
COMMENT ON TABLE candidates IS 'Resume uploads: hashes, extracted fields, score; binary file in Mongo (mongo_file_id).';
COMMENT ON COLUMN candidates.role_title IS 'Copy of roles.title at upload time; updated when the role title changes.';
COMMENT ON COLUMN candidates.name IS 'Candidate display name from extraction.';
COMMENT ON COLUMN candidates.actual_hash IS 'SHA-256 of raw file bytes; compared on upload for exact duplicates per role.';
COMMENT ON COLUMN candidates.normalized_hash IS 'SimHash hex of normalized text; near-duplicate detection vs other rows in the same role.';
COMMENT ON COLUMN candidates.justification IS 'LLM explanation for fit score vs the role JD.';
