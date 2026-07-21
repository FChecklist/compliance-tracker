-- VERIDIAN Review Framework gap-closure: "Checks & Balances / Risk, Fraud &
-- Anomaly Detection" (4 findings). See src/lib/db/schema.ts's
-- riskAnomalyEvents/authFailureEvents comment for the full design reasoning
-- (deliberately NOT the same registry as monitor_agents/monitor_task_state --
-- that one is AI-Ops dispatch-health scoped, this is business-risk scoped).
-- Additive-only: two new CREATE TABLEs, no ALTER TABLE, no destructive
-- statement anywhere in this file.

-- Org-scoped: real business-risk detection/escalation state, one row per
-- Tier-1 rule verdict. Matches crm_accounts' (drizzle/0219) FORCE RLS +
-- org-scoped-policy + service_role-bypass pattern exactly, the current
-- convention for every new org-scoped table.
CREATE TABLE IF NOT EXISTS compliance.risk_anomaly_events (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  event_type text NOT NULL,
  severity text NOT NULL DEFAULT 'medium',
  source_entity_type text NOT NULL,
  source_entity_id text,
  actor_user_id text,
  reason text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'open',
  escalated_to_user_id text,
  escalated_at timestamp,
  created_at timestamp NOT NULL DEFAULT now()
);

ALTER TABLE compliance.risk_anomaly_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.risk_anomaly_events FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.risk_anomaly_events FOR ALL TO app_runtime
    USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_risk_anomaly_events ON compliance.risk_anomaly_events FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.risk_anomaly_events TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.risk_anomaly_events TO service_role;

CREATE INDEX IF NOT EXISTS idx_risk_anomaly_events_org_id ON compliance.risk_anomaly_events(org_id);
CREATE INDEX IF NOT EXISTS idx_risk_anomaly_events_event_type ON compliance.risk_anomaly_events(event_type);
CREATE INDEX IF NOT EXISTS idx_risk_anomaly_events_status ON compliance.risk_anomaly_events(status);

-- Unified pre-auth failure log, no org_id column -- exact same rationale as
-- passcode_login_attempts (drizzle/0259_passcode_login.sql): an attempt has
-- no org to resolve to until AFTER a successful match. service_role-only
-- access (raw db client, never withTenantContext), same security posture as
-- that table -- it records raw attempted email addresses.
CREATE TABLE IF NOT EXISTS compliance.auth_failure_events (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  email text NOT NULL,
  method text NOT NULL,
  ip_address text,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_auth_failure_events_email_created ON compliance.auth_failure_events(email, created_at);

ALTER TABLE compliance.auth_failure_events ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_auth_failure_events ON compliance.auth_failure_events FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT, INSERT ON compliance.auth_failure_events TO service_role;

-- Asset Registry Coverage Check (GAP-UMR-TABLE-COVERAGE): both tables are
-- exempted in ai-os/registry/asset-registry-coverage.yaml, not registered --
-- append-only system/security-event logs with no genuine display-name/
-- owner column, same class as monitor_execution_log/passcode_login_attempts.

-- Indexes on PRE-EXISTING tables backing this gap-closure's new query
-- patterns -- additive CREATE INDEX only, no ALTER TABLE/column change.
-- (1) erp-payment-entries-service.ts's new duplicate-payment lookup
-- (createPaymentEntry) filters on exactly these columns before every
-- payment insert.
CREATE INDEX IF NOT EXISTS idx_erp_payment_entries_party_lookup
  ON compliance.erp_payment_entries(org_id, party_id, party_type, payment_type, posting_date);
-- (2) risk-register-service.ts's hasVerificationEvidence runs a jsonb `@>`
-- containment check against risks.linked_control_ids on every
-- framework_controls 'verified' transition -- a GIN index makes that a real
-- index scan instead of a per-row sequential scan.
CREATE INDEX IF NOT EXISTS idx_risks_linked_control_ids
  ON compliance.risks USING GIN (linked_control_ids jsonb_path_ops);
