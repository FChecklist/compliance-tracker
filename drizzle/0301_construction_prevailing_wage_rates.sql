-- Certified Payroll (SAP-mapping gap analysis HCM-006, "Certified Payroll
-- Report (Regulatory / Public Works)", US WH-347 equivalent, BUILD_NEW/
-- MEDIUM, engine_track=calculation). Grepped certifiedPayroll/davis-bacon/
-- prevailingWage/WH-347 across the whole repo first -- zero hits, a
-- genuine, confirmed gap, not assumed.
--
-- Master data only: the government-mandated minimum hourly rate + required
-- fringe-benefit rate per trade classification, for one public-works
-- project -- admin-editable, never hardcoded, same "rates come from a
-- periodic government determination, not a formula" discipline as
-- erp_statutory_rules (0050_wave56_erp_statutory_payroll.sql) and
-- erp_income_tax_slabs. trade is free text, matched case-insensitively
-- against construction_labour_roster.trade (that column's own comment:
-- "free text -- advisory, not enum-enforced").
--
-- See construction-reports-service.ts's certifiedPayrollReport()/
-- computeCertifiedPayroll() (this same PR) for the real report this master
-- data feeds -- the report itself reuses the existing
-- construction_labour_roster/construction_attendance site-labour ledger
-- (real per-day hours/cost), not a new time-tracking mechanism.
--
-- Hand-written, not drizzle-kit's raw `generate` output -- same reason as
-- 0268_pms_time_entry_approval_flow.sql's own header (drizzle/meta/ is
-- missing per-migration snapshots between 0001 and 0264).

CREATE TABLE IF NOT EXISTS compliance.construction_prevailing_wage_rates (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL,
  project_id text NOT NULL,
  trade text NOT NULL,
  prevailing_hourly_rate numeric NOT NULL,
  fringe_benefit_rate numeric NOT NULL DEFAULT 0,
  effective_from date NOT NULL,
  effective_to date,
  created_by_id text,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS construction_prevailing_wage_rates_project_trade_idx ON compliance.construction_prevailing_wage_rates (project_id, trade);

-- Row Level Security -- matching 0269_construction_progress_claims_workflow.sql's
-- established app_runtime_tenant_isolation + service_role_bypass pattern
-- (direct org_id policy, this table carries its own).
ALTER TABLE compliance.construction_prevailing_wage_rates ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY app_runtime_tenant_isolation ON compliance.construction_prevailing_wage_rates FOR ALL TO app_runtime USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_construction_prevailing_wage_rates ON compliance.construction_prevailing_wage_rates FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
