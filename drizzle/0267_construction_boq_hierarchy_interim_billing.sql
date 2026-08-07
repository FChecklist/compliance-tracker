-- Hierarchical BoQ breakdown-% + interim-billing/valuation/retention engine
-- (Owner directive, PROJEXA_ERP_END_TO_END_REQUIREMENT_ANALYSIS_GAP_FILL_AND_IMPLEMENTATION,
-- 2026-07-27). Hand-written, NOT drizzle-kit's raw `generate` output --
-- drizzle/meta/ is missing every per-migration snapshot between 0001 and
-- 0264 (only 0000_snapshot.json was ever committed; see git history
-- "Repair drizzle/meta/_journal.json: register all 261 real migrations (was
-- frozen at migration 0000 since first commit)" -- that commit repaired the
-- journal's tag/timestamp list but never regenerated the per-migration
-- snapshots). Because of that gap, `drizzle-kit generate` diffs against the
-- near-empty 0000 baseline and tries to recreate the entire schema from
-- scratch. This file is a minimal, hand-written migration containing only
-- this task's real additive changes, in drizzle-kit's own SQL style
-- (verified against 0101_wave115_construction_boq_progress_diary.sql's
-- CREATE TABLE + RLS conventions for this same construction_* table
-- family). drizzle/meta/0265_snapshot.json (committed alongside this file)
-- IS the real, accurate, freshly-generated full snapshot of current
-- schema.ts -- kept so a future `generate` call diffs from an accurate
-- baseline going forward, without attempting the much larger, out-of-scope
-- job of backfilling all 264 missing historical snapshots.

-- ============================================================
-- 1. Hierarchical BoQ line items: self-FK + breakdown %
-- ============================================================
ALTER TABLE compliance.construction_boq_line_items ADD COLUMN IF NOT EXISTS parent_line_item_id text;
ALTER TABLE compliance.construction_boq_line_items ADD COLUMN IF NOT EXISTS breakdown_percentage numeric;

CREATE INDEX IF NOT EXISTS construction_boq_line_items_parent_line_item_id_idx ON compliance.construction_boq_line_items (parent_line_item_id);

-- ============================================================
-- 2. Interim/RA (Running Account) billing + retention
-- ============================================================
CREATE TABLE IF NOT EXISTS compliance.construction_interim_bills (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL,
  project_id text NOT NULL,
  boq_id text NOT NULL,
  bill_number integer NOT NULL,
  bill_date date NOT NULL,
  retention_percent numeric NOT NULL DEFAULT 0,
  gross_amount numeric NOT NULL DEFAULT 0,
  retention_amount numeric NOT NULL DEFAULT 0,
  net_payable numeric NOT NULL DEFAULT 0,
  sales_invoice_id text,
  created_by_id text NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.construction_interim_bill_line_items (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  interim_bill_id text NOT NULL,
  boq_line_item_id text NOT NULL,
  cumulative_percent_complete integer NOT NULL DEFAULT 0,
  cumulative_amount numeric NOT NULL DEFAULT 0,
  previous_billed_amount numeric NOT NULL DEFAULT 0,
  current_bill_amount numeric NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS construction_interim_bills_project_id_idx ON compliance.construction_interim_bills (project_id);
CREATE INDEX IF NOT EXISTS construction_interim_bills_boq_id_idx ON compliance.construction_interim_bills (boq_id);
CREATE INDEX IF NOT EXISTS construction_interim_bill_line_items_interim_bill_id_idx ON compliance.construction_interim_bill_line_items (interim_bill_id);
CREATE INDEX IF NOT EXISTS construction_interim_bill_line_items_boq_line_item_id_idx ON compliance.construction_interim_bill_line_items (boq_line_item_id);

-- ============================================================
-- 3. Row Level Security -- matching 0101_wave115_construction_boq_progress_diary.sql's
-- established app_runtime_tenant_isolation + service_role_bypass pattern.
-- construction_interim_bills has its own org_id (direct policy, like
-- construction_boqs); construction_interim_bill_line_items has no org_id of
-- its own (EXISTS-join policy via its parent, exactly like
-- construction_boq_line_items via construction_boqs above).
-- ============================================================
ALTER TABLE compliance.construction_interim_bills ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY app_runtime_tenant_isolation ON compliance.construction_interim_bills FOR ALL TO app_runtime USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_construction_interim_bills ON compliance.construction_interim_bills FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE compliance.construction_interim_bill_line_items ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY app_runtime_tenant_isolation ON compliance.construction_interim_bill_line_items FOR ALL TO app_runtime
    USING (EXISTS (SELECT 1 FROM compliance.construction_interim_bills b WHERE b.id = construction_interim_bill_line_items.interim_bill_id AND b.org_id = compliance.current_org_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_construction_interim_bill_line_items ON compliance.construction_interim_bill_line_items FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
