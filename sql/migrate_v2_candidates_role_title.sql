-- Apply on existing databases that already ran the older schema.sql (with resume_chunks).
-- Run once in Supabase SQL editor or: psql $SUPABASE_URI -f sql/migrate_v2_candidates_role_title.sql

-- Remove RAG chunk storage (feature removed from app)
DROP TABLE IF EXISTS resume_chunks CASCADE;

-- Denormalized role title on each candidate row
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS role_title TEXT NOT NULL DEFAULT '';

UPDATE candidates c
SET role_title = r.title
FROM roles r
WHERE r.id = c.role_id AND btrim(c.role_title) = '';

CREATE INDEX IF NOT EXISTS idx_candidates_role_title ON candidates (role_title);
