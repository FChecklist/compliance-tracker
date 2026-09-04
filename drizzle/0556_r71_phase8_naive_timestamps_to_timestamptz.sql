-- R71 Phase 8 (U8-04/U8-05). 7 timezone-naive columns found (more than the
-- one previously known, embeddings.created_at) -- a bitemporal memory store
-- ordering rows across zones with a mixed naive/aware temporal type set is a
-- real correctness risk: two records logged at the "same instant" from
-- different client zones can compare as out of order.
--
-- ASSUMED SOURCE TIMEZONE: UTC, stated explicitly rather than assumed
-- silently. This is a Supabase project; every other timestamptz column in
-- this schema (including memory_records' own already-aware columns from
-- other migrations, and the DEFAULT now() on every column below) is written
-- in UTC by both Postgres's own now() and this codebase's application code.
-- No column here has ever had a non-UTC value written to it.
ALTER TABLE compliance.embeddings
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';

ALTER TABLE compliance.memory_records
  ALTER COLUMN created_at    TYPE timestamptz USING created_at    AT TIME ZONE 'UTC',
  ALTER COLUMN updated_at    TYPE timestamptz USING updated_at    AT TIME ZONE 'UTC',
  ALTER COLUMN effective_from TYPE timestamptz USING effective_from AT TIME ZONE 'UTC',
  ALTER COLUMN effective_to   TYPE timestamptz USING effective_to   AT TIME ZONE 'UTC';

ALTER TABLE compliance.memory_sources
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';

ALTER TABLE compliance.memory_versions
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
