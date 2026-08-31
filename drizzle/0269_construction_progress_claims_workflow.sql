-- Progress-claim billing workflow (SAP-mapping PHASE-2-CROSSREF, SD-002
-- "Billing Due List" + SD-007 "Sales Order Status Overview", both BUILD_NEW,
-- engine_track=workflow). A state machine, not a calculation --
-- construction_interim_bills (0267) stays the source of truth for computed
-- bill amounts; this table only tracks the pre-invoice approval stage a
-- claim moves through: milestone_achieved -> drafted -> submitted ->
-- client_approved -> invoiced (or rejected, bounced back to drafted).
-- Hand-written, NOT drizzle-kit's raw `generate` output -- same reason as
-- 0268_pms_time_entry_approval_flow.sql's own header (drizzle/meta/ is
-- missing per-migration snapshots between 0001 and 0264).

DO $$ BEGIN
  CREATE TYPE compliance.construction_claim_status AS ENUM (
    'milestone_achieved', 'drafted', 'submitted', 'client_approved', 'invoiced', 'rejected'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS compliance.construction_progress_claims (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL,
  project_id text NOT NULL,
  boq_id text NOT NULL,
  customer_id text NOT NULL,
  milestone_description text NOT NULL,
  scheduled_date date NOT NULL,
  retention_percent numeric NOT NULL DEFAULT 0,
  status compliance.construction_claim_status NOT NULL DEFAULT 'milestone_achieved',
  drafted_at timestamp,
  submitted_at timestamp,
  approved_at timestamp,
  rejected_at timestamp,
  rejection_reason text,
  invoiced_at timestamp,
  interim_bill_id text,
  created_by_id text NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS construction_progress_claims_project_id_idx ON compliance.construction_progress_claims (project_id);
CREATE INDEX IF NOT EXISTS construction_progress_claims_boq_id_idx ON compliance.construction_progress_claims (boq_id);
-- Drives the SD-002 "Billing Due List" worklist: filter by org+status, order by scheduled_date.
CREATE INDEX IF NOT EXISTS construction_progress_claims_org_status_idx ON compliance.construction_progress_claims (org_id, status, scheduled_date);

-- Row Level Security -- matching 0267's established app_runtime_tenant_isolation +
-- service_role_bypass pattern (direct org_id policy, this table carries its own).
ALTER TABLE compliance.construction_progress_claims ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY app_runtime_tenant_isolation ON compliance.construction_progress_claims FOR ALL TO app_runtime USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_construction_progress_claims ON compliance.construction_progress_claims FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
