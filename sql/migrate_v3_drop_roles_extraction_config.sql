-- Remove per-role extraction_config; fields now come from the client on upload/rescan only.
ALTER TABLE roles DROP COLUMN IF EXISTS extraction_config;
