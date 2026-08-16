-- Wave 82 (Period Closing checklist workflow, per COMPARISON_CSV_GAP_ANALYSIS.md
-- backlog item 3). erp_accounting_periods (Wave 50) only had a bare
-- open/closed flag -- this adds a real checklist gate plus a formal
-- sign-off step, both enforced by closePeriod() before a period can close.

ALTER TABLE compliance.erp_accounting_periods
  ADD COLUMN IF NOT EXISTS signed_off_by_id text,
  ADD COLUMN IF NOT EXISTS signed_off_at timestamp;

CREATE TABLE IF NOT EXISTS compliance.erp_period_closing_checklist_items (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  period_id text NOT NULL REFERENCES compliance.erp_accounting_periods(id) ON DELETE CASCADE,
  title text NOT NULL,
  task_type text NOT NULL DEFAULT 'other',
  status text NOT NULL DEFAULT 'pending',
  assigned_to_id text,
  completed_by_id text,
  completed_at timestamp,
  notes text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_erp_period_closing_checklist_items_period_id ON compliance.erp_period_closing_checklist_items(period_id);

ALTER TABLE compliance.erp_period_closing_checklist_items ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.erp_period_closing_checklist_items FOR ALL TO app_runtime
    USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY service_role_bypass_erp_period_closing_checklist_items ON compliance.erp_period_closing_checklist_items FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.erp_period_closing_checklist_items TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.erp_period_closing_checklist_items TO service_role;
