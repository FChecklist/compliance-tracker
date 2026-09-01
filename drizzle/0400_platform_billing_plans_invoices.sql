-- VERIDIAN Review Framework gap-closure, 2026-08-07: "Per-User AI
-- Subscription Model" + "Base Subscription + Token Consumption Pricing".
-- See schema.ts's platformBillingPlans/platformBillingInvoices header
-- comment for the full rationale. Both findings are closed by the same
-- pair of tables: platform_billing_plans is the priced counterpart to
-- src/app/pricing/page.tsx's PLANS array, platform_billing_invoices is a
-- generated per-org-per-period bill computed from the already-real seat
-- count (org-license-service.ts) and already-real AI spend (cost-guard.ts /
-- token_usage_ledger).

CREATE TABLE IF NOT EXISTS compliance.platform_billing_plans (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  plan_key text NOT NULL UNIQUE,
  name text NOT NULL,
  base_fee_monthly_usd numeric NOT NULL DEFAULT '0',
  per_seat_monthly_usd numeric NOT NULL DEFAULT '0',
  included_ai_cost_usd numeric NOT NULL DEFAULT '0',
  overage_multiplier numeric NOT NULL DEFAULT '1.30',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.platform_billing_invoices (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  plan_id text NOT NULL REFERENCES compliance.platform_billing_plans(id),
  invoice_number integer NOT NULL,
  period_start timestamp NOT NULL,
  period_end timestamp NOT NULL,
  seat_count integer NOT NULL,
  base_fee_usd numeric NOT NULL,
  seat_fee_usd numeric NOT NULL,
  ai_cost_usd numeric NOT NULL,
  included_ai_cost_usd numeric NOT NULL,
  overage_ai_cost_usd numeric NOT NULL,
  overage_charge_usd numeric NOT NULL,
  total_usd numeric NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  payment_gateway_ref text,
  generated_at timestamp NOT NULL DEFAULT now(),
  created_at timestamp NOT NULL DEFAULT now(),
  -- One invoice per org per period (mirrors 0224's exchange-rate
  -- idempotent-per-(org,date) convention) -- re-running generation for an
  -- already-invoiced period must update, never duplicate.
  CONSTRAINT platform_billing_invoices_org_period_unique UNIQUE (org_id, period_start, period_end),
  CONSTRAINT platform_billing_invoices_org_number_unique UNIQUE (org_id, invoice_number)
);

-- platform_billing_plans is a small, platform-wide priced list (like
-- gst_gstin_master/gst_hsn_master) -- no org_id, read-only to app_runtime.
-- Writing/editing plans is a service_role/migration-seed operation for now;
-- an admin-facing plan editor is explicitly out of scope for this PR (see
-- PROGRESS.md).
ALTER TABLE compliance.platform_billing_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.platform_billing_plans FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY app_runtime_read_all ON compliance.platform_billing_plans FOR SELECT TO app_runtime USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_platform_billing_plans ON compliance.platform_billing_plans FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT ON compliance.platform_billing_plans TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.platform_billing_plans TO service_role;

ALTER TABLE compliance.platform_billing_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.platform_billing_invoices FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.platform_billing_invoices FOR ALL TO app_runtime
    USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_platform_billing_invoices ON compliance.platform_billing_invoices FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.platform_billing_invoices TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.platform_billing_invoices TO service_role;

CREATE INDEX IF NOT EXISTS idx_platform_billing_invoices_org_id ON compliance.platform_billing_invoices(org_id);
CREATE INDEX IF NOT EXISTS idx_platform_billing_invoices_period_start ON compliance.platform_billing_invoices(period_start);

-- Seed the 3 real marketing tiers from src/app/pricing/page.tsx's PLANS
-- array so plan_key lookups resolve for every existing org out of the box.
-- Starter/Enterprise keep the marketing page's $0 "contact us" placeholder
-- pricing (Enterprise is genuinely quote-based; Starter is a real free
-- tier) -- only Professional carries a real recurring charge today.
-- included_ai_cost_usd/overage_multiplier are a documented starting
-- assumption (not derived from a pricing decision on file anywhere) and
-- are trivially adjustable per-plan without a code change once the Owner
-- confirms real numbers.
INSERT INTO compliance.platform_billing_plans (plan_key, name, base_fee_monthly_usd, per_seat_monthly_usd, included_ai_cost_usd, overage_multiplier, is_active)
VALUES
  ('free', 'Starter', '0', '0', '5', '1.30', true),
  ('professional', 'Professional', '2499', '0', '50', '1.30', true),
  ('enterprise', 'Enterprise', '0', '0', '250', '1.30', true)
ON CONFLICT (plan_key) DO NOTHING;

-- ─── Universal Metadata Registry (Rule 9/Priority 4) ────────────────────
-- platform_billing_plans: platform-wide (no org), name_column=name,
-- active_column=is_active (genuine TRUE-means-active flag), no owner
-- column exists -- same reasoning class as erp_subscription_plans/
-- gst_gstin_master above it in this file's precedent.
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('platform_billing_plans', 'other', 'name', NULL, NULL, NULL, NULL, 'is_active');

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.platform_billing_plans
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

-- platform_billing_invoices: org-scoped, name_column has no single
-- human-readable field the way invoice_number reads for erp_sales_invoices
-- (it's an integer meaningful only alongside org_id, not globally unique) --
-- still registered using invoice_number as the display name, same
-- integer-sequence precedent as erp_sales_invoices/erp_rfqs above.
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('platform_billing_invoices', 'other', 'invoice_number', NULL, NULL, 'org_id', NULL, NULL);

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.platform_billing_invoices
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();
