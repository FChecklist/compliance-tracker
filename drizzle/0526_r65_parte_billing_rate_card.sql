-- R65 Part E -- Billing Engine, Phase 1: product catalog + versioned rate
-- card (2026-09-02). First real implementation slice of the Formula 1 +
-- Formula 2 + commercial-customization-layer directive (see memory:
-- veridian_r65_part_e_billing_engine_directive_2026-09-01 and its Phase 0
-- architecture report). Scope decision, made explicit here rather than
-- silently: this migration builds ONLY the two tables the Phase 0 report's
-- own gap analysis named as the real, load-bearing net-new pieces --
-- `billing_products` and `billing_rates` (its own §30 gap table calls
-- billing_rates "the real, named gap in the directive's own PR-635 closing
-- comment"). `billing_configurations`, `billing_contracts`,
-- `billing_discounts`, `billing_credits`, `billing_events`, `invoices`/
-- `invoice_lines` (extending platform_billing_invoices per the PM decision
-- already recorded), and `billing_adjustments` are Phase 2/5/6 territory --
-- explicitly NOT built in this migration. This keeps Formula 1's
-- included/additional-user math and Formula 2's per-call token-rate math
-- calculable and testable against the directive's own worked examples
-- (§21-22) without the commercial-discount/invoice-generation machinery
-- that depends on decisions (numeric precision -- decided; subscriptionPlans
-- disposition -- not yet re-verified by a real grep in this PR) out of
-- scope here.
--
-- REUSE-VS-BUILD CHECK (done before writing DDL, per directive §30's own
-- instruction): platform_billing_plans (0400) is plan-as-flat-tier, not a
-- versioned per-org-or-standard rate card and has no formula concept at
-- all -- not reusable. sales_commission_plans (0087) is the closest schema
-- shape in this repo (product_key, rate, valid_from/valid_to, is_active)
-- and is the template copied below, adapted for owner-approval fields
-- (status/approved_by/approved_at) that a sales commission plan doesn't
-- need. Neither table is modified by this migration.
--
-- MONEY REPRESENTATION: numeric(14,2) for every money/rate column, per the
-- Phase 0 report's own PM decision (recorded 2026-09-01, "PM decisions
-- recorded" section) -- a deliberate deviation from platform_billing_plans'
-- bare `numeric` precedent, decided in favor of exact decimal-place
-- discipline for this specific initiative. token_multiplier is NOT a money
-- column (it's a dimensionless usage multiplier, directive §10's real value
-- 1.2) so it keeps its own numeric(6,3) precision instead of being forced
-- into the money convention.

CREATE TABLE IF NOT EXISTS compliance.billing_products (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  product_key text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

-- Versioned rate card (directive §16-17, §30). org_id nullable: NULL = the
-- standard/platform rate for a product; set = an owner-approved,
-- customer-specific negotiated rate (directive §13/§14). This collapses
-- §14's 4-level priority order (org-specific contract > product/customer
-- pricing > product pricing > standard pricing) down to 2 real levels
-- (org-specific row > standard row) -- the middle two levels require
-- billing_contracts, which does not exist yet (Phase 5). Disclosed
-- simplification, not a silent one: see billing-cost-rollup-service.ts's
-- own header for the resolution function that implements exactly this
-- 2-level version of §14, and the PR description for why the other 2
-- levels are out of scope here.
--
-- Rates are never overwritten once effective (directive rule 21, "historical
-- rates immutable") -- a rate change is always a new row with a higher
-- rate_version, enforced by application-layer discipline (see
-- billing-cost-rollup-service.ts), same "documented convention, not a DB
-- trigger" posture this repo already uses for token_usage_ledger's
-- append-only contract (0093's own header).
CREATE TABLE IF NOT EXISTS compliance.billing_rates (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  product_id text NOT NULL REFERENCES compliance.billing_products(id),
  org_id text REFERENCES compliance.organisations(id), -- NULL = standard/platform rate
  formula text NOT NULL,
  rate_version integer NOT NULL,
  -- Formula 1 fields (directive §4-5). NULL when formula='formula_2' --
  -- "not every field applies to every formula, don't create meaningless
  -- values" (directive §16) is enforced at the application layer
  -- (billing-cost-rollup-service.ts / formula-engine.ts), not via a CHECK
  -- constraint, matching billing_configurations' own not-yet-built
  -- validation posture described in the Phase 0 report.
  base_rate numeric(14,2),
  included_users integer,
  additional_user_rate numeric(14,2),
  -- Formula 2 fields (directive §6-10). NULL when formula='formula_1'.
  base_user_rate numeric(14,2),
  input_token_rate numeric(14,2), -- per 1,000 billable input tokens, verified against directive §13/§22's own worked arithmetic
  output_token_rate numeric(14,2), -- per 1,000 billable output tokens
  software_token_rate numeric(14,2), -- per 1,000 billable software tokens (directive §9) -- see formula-engine.ts header: no ledger data source exists for raw software-token counts yet, so this column has no real consumer in this PR
  token_multiplier numeric(6,3) NOT NULL DEFAULT 1.2, -- directive §10's real, owner-specified initial value -- not a placeholder
  effective_from timestamp NOT NULL DEFAULT now(),
  effective_to timestamp, -- NULL = open-ended
  status text NOT NULL DEFAULT 'draft', -- 'draft' | 'approved' | 'active' | 'expired' | 'revoked'
  approved_by text REFERENCES compliance.users(id),
  approved_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT billing_rates_formula_check CHECK (formula IN ('formula_1', 'formula_2')),
  CONSTRAINT billing_rates_status_check CHECK (status IN ('draft', 'approved', 'active', 'expired', 'revoked'))
);

CREATE INDEX IF NOT EXISTS idx_billing_rates_product_org ON compliance.billing_rates(product_id, org_id);
CREATE INDEX IF NOT EXISTS idx_billing_rates_formula ON compliance.billing_rates(formula);
CREATE INDEX IF NOT EXISTS idx_billing_rates_status ON compliance.billing_rates(status);
CREATE INDEX IF NOT EXISTS idx_billing_rates_effective ON compliance.billing_rates(effective_from, effective_to);

-- ─── RLS ──────────────────────────────────────────────────────────────────
-- billing_products: platform-wide reference catalog, no org_id -- Pattern A
-- verbatim from platform_billing_plans (0400): read-all to app_runtime,
-- full bypass to service_role. Writing a product is a
-- service_role/migration-seed operation for now (no admin UI in this PR).
ALTER TABLE compliance.billing_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.billing_products FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY app_runtime_read_all ON compliance.billing_products FOR SELECT TO app_runtime USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_billing_products ON compliance.billing_products FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT ON compliance.billing_products TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.billing_products TO service_role;

-- billing_rates: real commercial pricing/contract data (directive rules
-- 9-11: "commercial rates are owner-controlled", "AI cannot change
-- commercial terms", "org admins cannot change commercial terms without
-- authorization"). This is why the app_runtime GRANT below is SELECT-ONLY
-- -- unlike fm_checklist_templates' (0085) FOR ALL + `org_id IS NULL OR
-- org_id = current_org_id()` precedent (which lets app_runtime write rows
-- with org_id NULL), a billing rate must never be writable by an org
-- session or by the AI acting as one. Enforcing this as a GRANT-level
-- restriction (not just RLS policy logic) makes rules 10-11 a database
-- fact, not just an application-layer promise -- the Phase 0 report's own
-- "Authorization-layer risk" flag is addressed here at the strongest
-- available layer. An org can SELECT its own negotiated rate (org_id =
-- current_org_id()) plus every standard rate (org_id IS NULL); it can
-- write neither. All writes are service_role only (Owner Billing Control
-- Panel, §26, when it exists, will write through service_role from a
-- server action after its own app-layer role check -- Phase 7, not this
-- PR).
ALTER TABLE compliance.billing_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.billing_rates FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.billing_rates FOR SELECT TO app_runtime
    USING (org_id IS NULL OR org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_billing_rates ON compliance.billing_rates FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT ON compliance.billing_rates TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.billing_rates TO service_role;

-- ─── Seed: billing_products ───────────────────────────────────────────────
-- 'veridian_ai_os': the one product with real usage data in THIS database's
-- token_usage_ledger today (this repo IS Veridian AI OS -- CLAUDE.md's own
-- "Brand: VERIDIAN AI | Product: Veridian AI" line). is_active=true, real.
--
-- 'projexa_ai': seeded per directive §33's explicit instruction ("applies
-- to VERIDIAN and all products, e.g. PROJEXA-AI.COM") for schema
-- completeness, but with an HONEST, verified gap disclosed here rather than
-- implied working: PROJEXA is a separate application with its own Supabase
-- auth project (evpckeuxgvahguwsaeul), confirmed by this repo's own
-- CLAUDE.md ("PROJEXA is a SEPARATE repository"). Its domain data is
-- proxied through this repo's /api/v1/projexa/* routes, but a repo-wide
-- grep (`grep -rl "logTokenUsage\|callLLM" src/app/api/v1/projexa/`) run
-- before writing this migration found ZERO matches -- no code path
-- anywhere writes token_usage_ledger.veridian_product_id='projexa_ai'
-- today. This row exists so the rate-card schema is ready, but the
-- cost-rollup engine (billing-cost-rollup-service.ts) will never produce a
-- non-zero PROJEXA rollup until something actually tags ledger rows with
-- this product_key at write time -- that attribution wiring is out of
-- scope for this PR.
INSERT INTO compliance.billing_products (product_key, name, description, is_active)
VALUES
  ('veridian_ai_os', 'VERIDIAN AI OS', 'This platform (compliance-tracker) -- the sole product with real AI-usage rows in token_usage_ledger today.', true),
  ('projexa_ai', 'PROJEXA-AI.COM', 'Separate application (FChecklist/projexa). No current write path tags token_usage_ledger rows with this product -- see migration header.', true)
ON CONFLICT (product_key) DO NOTHING;

-- No billing_rates rows are seeded with real numbers. This is the single
-- most important honest gap in this PR: the directive's Formula 1 fields
-- (base_rate, included_users, additional_user_rate) and Formula 2's money
-- fields (base_user_rate, input_token_rate, output_token_rate,
-- software_token_rate) all require Owner-approved standard pricing that
-- has never been specified anywhere in the directive or Phase 0 report --
-- only §13's ABC Ltd example (base ₹400/user, ₹8/1k input, ₹25/1k output)
-- and §4-5's worked example (₹20,000 base, 10 included users, ₹500/extra)
-- exist, and both are explicitly labeled worked EXAMPLES / one customer's
-- NEGOTIATED terms, not VERIDIAN's real standard price list. Inventing a
-- "standard" row from either would misrepresent an example as a real
-- commercial decision -- exactly the trap this session's own standing
-- instructions warn against. token_multiplier's default (1.2) is the one
-- real, directive-specified number (§10) and is wired as the column
-- DEFAULT above; every other numeric field is left for the Owner Billing
-- Control Panel (§26, Phase 7) or a direct owner-approved INSERT once real
-- numbers exist.

-- ─── Universal Metadata Registry (Rule 9/Priority 4) ─────────────────────
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('billing_products', 'other', 'name', 'description', NULL, NULL, NULL, 'is_active');

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.billing_products
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('billing_rates', 'other', 'formula', NULL, NULL, 'org_id', 'approved_by', NULL);

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.billing_rates
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();
