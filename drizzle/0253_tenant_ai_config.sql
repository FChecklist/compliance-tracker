-- Super Boss v2 plan task V2-5 (BYOB bring-your-own-AI-model, 2026-07-20):
-- per-org BYO AI model for the Mother Router's software_team scope. A tenant
-- configures their own model id + (encrypted) API key + optional base URL;
-- the Mother Router PREFERS it for that org's software_team dispatches but
-- STILL runs it through checkTierEligibility() -- an ineligible tenant model
-- silently downgrades to the roster baseline, never bypasses the tier-
-- eligibility guardrail (AGENTS.md Operating Rule 9). See schema.ts's comment
-- on tenant_ai_config and mother-router.ts's computeSoftwareTeamResolution-
-- WithTenant() for the enforcement.
--
-- DISTINCT from customer_model_config (the end_user_org / Orchestra Layer BYO
-- path, migrations 0008/0015/0036): this serves the software_team scope. One
-- active row per org (the org's model is a single choice, not a per-layer
-- matrix) enforced by the partial unique index below, same pattern
-- ai_routing_policies_one_active_per_scope already uses.
--
-- RLS posture mirrors client_model_config (0036): app_runtime may read/write
-- its own org's rows (admin-gated in the service layer via requireRole
-- 'admin', same pattern as every other admin-only write), service_role has
-- full bypass. The encrypted_api_key column holds pgcrypto ciphertext (see
-- ai-config-crypto.ts's encryptApiKey); the row is inert without a key +
-- model_name (resolveTenantAiConfig() gates on both, matching
-- resolveModelConfig()'s own customerConfig?.encryptedApiKey && modelName check).
CREATE TABLE IF NOT EXISTS compliance.tenant_ai_config (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  provider ai_provider NOT NULL,
  encrypted_api_key text,
  model_name text,
  base_url text,
  is_active boolean NOT NULL DEFAULT true,
  last_used_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

-- At most one ACTIVE tenant_ai_config row per org. Inactive rows are allowed
-- (an admin toggling isActive off, or a superseded historical row) without
-- tripping this constraint -- partial unique index, same shape as
-- ai_routing_policies_one_active_per_scope. An admin setting a NEW active
-- row while one is already active is handled in the service layer
-- (upsert-and-deactivate-others), not assumed here.
CREATE UNIQUE INDEX IF NOT EXISTS tenant_ai_config_one_active_per_org
  ON compliance.tenant_ai_config(org_id)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_tenant_ai_config_org_id ON compliance.tenant_ai_config(org_id);

ALTER TABLE compliance.tenant_ai_config ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  -- RLS posture mirrors the established org-scoped convention used by 299+
  -- other org_id-carrying tables in this schema: app_runtime may only reach
  -- its own org's rows via compliance.current_org_id() (which reads the
  -- app.current_org_id GUC that withTenantContext/tenant-scoped.ts sets per
  -- request), service_role has a full bypass. The API route
  -- (src/app/api/settings/tenant-ai-config/route.ts) goes through
  -- withTenantContext for every read/write, so the app_runtime policy is
  -- the one that actually governs admin saves; resolveTenantAiConfig() in
  -- mother-router.ts uses the raw service_role db client (bypasses RLS) --
  -- it is a platform-level resolution step, same posture as
  -- resolveModelConfig(). Belt-and-suspenders: the service layer also
  -- predicates every query by both id and orgId, so even an empty
  -- current_org_id() (no tenant context) yields no rows rather than a
  -- cross-tenant leak.
  CREATE POLICY app_runtime_tenant_ai_config ON compliance.tenant_ai_config FOR ALL TO app_runtime
    USING (org_id = compliance.current_org_id())
    WITH CHECK (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_tenant_ai_config ON compliance.tenant_ai_config FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.tenant_ai_config TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.tenant_ai_config TO service_role;
