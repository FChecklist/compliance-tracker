-- AI Cost Reconciliation (Finance). VERIDIAN Review Framework remediation,
-- "AI Cost Governance & FinOps": (1) cost attribution reconciles against
-- actual provider invoices, (2) cost-per-report/cost-per-AI-action are
-- measurable, not estimated. Manual monthly reconciliation record -- see
-- schema.ts's aiCostReconciliations comment for the full rationale. Same
-- "server-side write, financial accounting data" posture as
-- token_usage_ledger (0093): service_role only, no org_id (provider
-- invoices bill the whole platform, not a single tenant).

CREATE TABLE IF NOT EXISTS compliance.ai_cost_reconciliations (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  period_month text NOT NULL,
  provider text NOT NULL,
  actual_invoice_usd numeric NOT NULL,
  estimated_ledger_usd numeric NOT NULL,
  variance_usd numeric NOT NULL,
  variance_pct numeric,
  notes text,
  recorded_by_user_id text NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_cost_reconciliations_period_month ON compliance.ai_cost_reconciliations(period_month);
CREATE INDEX IF NOT EXISTS idx_ai_cost_reconciliations_provider ON compliance.ai_cost_reconciliations(provider);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_cost_reconciliations_period_provider ON compliance.ai_cost_reconciliations(period_month, provider);

ALTER TABLE compliance.ai_cost_reconciliations ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_ai_cost_reconciliations ON compliance.ai_cost_reconciliations FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.ai_cost_reconciliations TO service_role;
