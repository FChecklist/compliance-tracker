-- Design Studio timesheets: designer-entry -> manager-validation-on-review
-- approval flow for pms_time_entries (Owner item 12, "IMPORTANT", 2026-07-28).
-- Hand-written, NOT drizzle-kit's raw `generate` output -- drizzle/meta/ is
-- missing every per-migration snapshot between 0001 and 0264 (see 0267's own
-- header for the full explanation), so `drizzle-kit generate` cannot diff
-- schema.ts against an accurate baseline. This file mirrors
-- 0103_wave117_construction_kpi_documents_metadata.sql's own enum + column
-- style for the equivalent construction_kpi_entries.approval_status flow.

DO $$ BEGIN
  CREATE TYPE compliance.pms_time_entry_approval_status AS ENUM ('draft', 'submitted', 'approved', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE compliance.pms_time_entries ADD COLUMN IF NOT EXISTS approval_status compliance.pms_time_entry_approval_status NOT NULL DEFAULT 'draft';
ALTER TABLE compliance.pms_time_entries ADD COLUMN IF NOT EXISTS approved_by_id text;
ALTER TABLE compliance.pms_time_entries ADD COLUMN IF NOT EXISTS approved_at timestamp;
ALTER TABLE compliance.pms_time_entries ADD COLUMN IF NOT EXISTS rejection_reason text;

CREATE INDEX IF NOT EXISTS pms_time_entries_approval_status_idx ON compliance.pms_time_entries (org_id, approval_status);
