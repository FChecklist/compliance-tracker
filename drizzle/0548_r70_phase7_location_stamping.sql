-- R70 Phase 7 (P7-01): location stamping on compliance.memory_records.
-- Owner requirement: date, time, LOCATION, and reference stamping on every
-- memory record. Date/time/reference already exist (created_at,
-- effective_from/to, memory_sources references); location does not.
-- Free at 0 rows -- compliance.memory_records is verified empty (R69/R70
-- baseline, re-confirmed live immediately before this migration).
--
-- All five columns nullable, no backfill, no geo provider picked (R70 P7-01
-- NOT clause). location_ref holds a project_id/site_id-shaped reference;
-- the exact controlled vocabulary per vertical is specified in R70 Part 3
-- S8-03, not decided here.

ALTER TABLE compliance.memory_records
  ADD COLUMN IF NOT EXISTS location_type text,
  ADD COLUMN IF NOT EXISTS location_ref text,
  ADD COLUMN IF NOT EXISTS location_label text,
  ADD COLUMN IF NOT EXISTS latitude numeric,
  ADD COLUMN IF NOT EXISTS longitude numeric;
