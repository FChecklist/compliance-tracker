-- R65 Part E -- Billing Engine, Phase 2: billing_contracts (2026-09-02).
-- Completes more of directive §14's 4-level commercial-terms priority
-- order (see memory: veridian_r65_part_e_billing_engine_directive_
-- 2026-09-01 §14, and its own Phase 0 architecture report's gap-table
-- entry for billing_contracts). Full reasoning duplicated in
-- src/lib/db/schema.ts's own header comment on `billingContracts` -- read
-- that for the complete priority-order argument; this header covers only
-- the DDL-specific decisions.
--
-- Phase 1 (drizzle/0526, PR #1567) built billing_products + billing_rates
-- and collapsed §14's 4 levels to 2 real ones (org-specific billing_rates
-- row > standard billing_rates row) because nothing distinguished an
-- owner-approved organization-specific CONTRACT (§14 level 1) from an
-- ad-hoc org-specific rate row (closer to §14 level 2, "product/customer
-- pricing"). This migration adds that missing authorization-header table
-- and a nullable `contract_id` FK on billing_rates, taking §14 from 2 real
-- levels to 3: contract-backed org rate > bare org-specific rate >
-- standard rate. §14 levels 2 ("product/customer pricing") and 3
-- ("product pricing") remain collapsed -- see schema.ts header for why
-- (needs a promotional/temporary-pricing flag that is directive §11's
-- commercial-customization-pipeline territory, Phase 5, not this table's
-- job). No real contract rows are seeded -- same "never invent a real
-- commercial number/agreement" discipline Phase 1 held for billing_rates.
--
-- REUSE-VS-BUILD CHECK (done before writing DDL, per directive §30's own
-- instruction): erp_contracts/erp_contract_billing_schedules (Wave 71) is
-- the closest schema shape in this repo, but bills the ORG'S OWN
-- customers (wrong tenant direction for Part E, which bills the org
-- itself as VERIDIAN's customer) -- pattern only, not reusable rows, per
-- the Phase 0 report's own finding. billing_rates (0526) is not extended
-- into a header+lines contract shape itself -- a contract's effective
-- window and approval trail are conceptually independent of any one rate
-- VERSION underneath it (directive rule 21: historical rates immutable
-- even while a contract stays active across multiple rate versions).
--
-- MONEY REPRESENTATION: no money columns on this table at all (deliberate
-- -- a contract is a pure authorization header; the actual rate numbers
-- live on billing_rates, which already committed to numeric(14,2) in
-- 0526).
--
-- NAMING: `org_id`, not the Phase 0 report's own suggested
-- `organization_id` -- see schema.ts header for the same rationale 0524
-- already established for product_id -> veridian_product_id (this
-- schema's own established convention wins over the report's literal
-- suggestion).

CREATE TABLE IF NOT EXISTS compliance.billing_contracts (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  product_id text NOT NULL REFERENCES compliance.billing_products(id),
  formula text NOT NULL,
  contract_name text,
  status text NOT NULL DEFAULT 'draft',
  effective_from timestamp NOT NULL,
  effective_to timestamp,
  approved_by text REFERENCES compliance.users(id),
  approved_at timestamp,
  notes text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT billing_contracts_formula_check CHECK (formula IN ('formula_1', 'formula_2')),
  CONSTRAINT billing_contracts_status_check CHECK (status IN ('draft', 'approved', 'active', 'expired', 'terminated'))
);

CREATE INDEX IF NOT EXISTS idx_billing_contracts_org_product ON compliance.billing_contracts(org_id, product_id);
CREATE INDEX IF NOT EXISTS idx_billing_contracts_status ON compliance.billing_contracts(status);
CREATE INDEX IF NOT EXISTS idx_billing_contracts_effective ON compliance.billing_contracts(effective_from, effective_to);

-- Optional link from a specific rate row to the contract that authorizes
-- it (directive §14 level 1). Nullable -- the vast majority of rows have
-- no formal contract behind them (bare org-specific or standard rates).
-- Not backfillable: zero real billing_rates rows exist with real
-- commercial numbers as of this migration (Phase 1's own disclosed gap),
-- so there is nothing to link retroactively.
ALTER TABLE compliance.billing_rates
  ADD COLUMN IF NOT EXISTS contract_id text REFERENCES compliance.billing_contracts(id);
CREATE INDEX IF NOT EXISTS idx_billing_rates_contract_id ON compliance.billing_rates(contract_id);

-- ─── RLS ──────────────────────────────────────────────────────────────────
-- billing_contracts: real commercial/authorization data, same posture as
-- billing_rates (0526) for the identical reason -- directive rules 9-11
-- ("commercial rates are owner-controlled", "AI cannot change commercial
-- terms", "org admins cannot change commercial terms without
-- authorization"). Every row has org_id NOT NULL (unlike billing_rates,
-- there is no "standard/platform" contract concept), so the app_runtime
-- policy is a plain org-scoped SELECT, not the OR-null pattern
-- billing_rates needed. All writes are service_role-only -- an org can see
-- its own contract, it can never create, approve, or modify one. The
-- Owner Billing Control Panel (§26, when it exists) will write through
-- service_role from a server action after its own app-layer role check,
-- exactly like billing_rates' own documented plan.
ALTER TABLE compliance.billing_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.billing_contracts FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.billing_contracts FOR SELECT TO app_runtime
    USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_billing_contracts ON compliance.billing_contracts FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT ON compliance.billing_contracts TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.billing_contracts TO service_role;

-- ─── Universal Metadata Registry (Rule 9/Priority 4) ─────────────────────
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('billing_contracts', 'other', 'contract_name', NULL, NULL, 'org_id', 'approved_by', NULL);

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.billing_contracts
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();
