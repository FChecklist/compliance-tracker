-- RUN R12-21AUG point 7 (Option B, Rajat's 21 Aug ruling): progress belongs
-- to a BOQ LINE, not to an activity -- activity is a project-management
-- concept and VERIDIAN is the shared backend for every product. Purely
-- ADDITIVE: activity_id is untouched (still NOT NULL, still the only link
-- every pre-existing row has), nothing is dropped, nothing is backfilled.
-- No customers today -- this is why the migration is cheap now, and why it
-- only gets more expensive the longer it waits.
--
-- ON DELETE SET NULL (not the Postgres default RESTRICT): if a BOQ line
-- item is ever hard-deleted while a progress entry still points at it
-- directly, the entry survives with boq_line_item_id cleared rather than
-- the delete failing outright -- src/lib/services/construction-boq-service.ts's
-- loadLatestProgressByLineItem() then falls back to that same entry's
-- activity_id (if it has one), same as any other legacy-only entry.
--
-- Applied via drizzle/migrate (no snapshot/journal update -- 0312-0314
-- established this as hand-authored-SQL-only for this repo's recent
-- migrations; matching that, not drizzle-kit generate).
ALTER TABLE compliance.construction_work_progress_entries
  ADD COLUMN IF NOT EXISTS boq_line_item_id text REFERENCES compliance.construction_boq_line_items(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_construction_work_progress_entries_boq_line_item_id
  ON compliance.construction_work_progress_entries(boq_line_item_id);
