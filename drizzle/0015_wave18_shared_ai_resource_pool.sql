-- Wave 18 (VAIOS Shared AI Resource Pool) -- see PLATFORM_STRATEGY.md §10-11.
--
-- CRITICAL DESIGN CONSTRAINT, confirmed directly by the user: this is
-- org-to-PLATFORM only, never org-to-org. A customer org's own
-- resolveModelConfig(orgId, layerKey) resolution path is completely
-- untouched by this migration/wave -- what's new here only backs a
-- separate, platform-scoped resolvePlatformModelConfig(layerKey) function
-- (no orgId parameter at all) used exclusively by the platform's own
-- internal orchestration work (e.g. the meta_oa loop-engineering-audit
-- synthesis step), never a customer's own workflow.

ALTER TABLE compliance.customer_model_config ADD COLUMN IF NOT EXISTS shared_pool_eligible boolean NOT NULL DEFAULT false;
ALTER TABLE compliance.customer_model_config ADD COLUMN IF NOT EXISTS last_used_at timestamp;

CREATE TABLE IF NOT EXISTS compliance.shared_pool_allocations (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  lender_org_id text NOT NULL REFERENCES compliance.organisations(id),
  purpose text NOT NULL,
  customer_model_config_id text NOT NULL REFERENCES compliance.customer_model_config(id),
  orchestra_layer_key text NOT NULL,
  allocated_at timestamp NOT NULL DEFAULT now()
);

-- Platform-operational, same posture as loop_executions (Wave 5): no
-- app_runtime tenant-isolation policy at all -- a lender org must never see
-- this via the normal app_runtime path (that's Layer-1-only visibility).
-- The dedicated GET /api/settings/model-config/pool-usage route reads this
-- via the raw (RLS-bypassing) db client, explicitly filtered to the
-- caller's own orgId server-side -- narrower, deliberate transparency, not
-- full RLS-based access.
ALTER TABLE compliance.shared_pool_allocations ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_shared_pool_allocations ON compliance.shared_pool_allocations FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT, INSERT ON compliance.shared_pool_allocations TO service_role;

CREATE INDEX IF NOT EXISTS idx_shared_pool_allocations_lender_org_id ON compliance.shared_pool_allocations(lender_org_id);
CREATE INDEX IF NOT EXISTS idx_shared_pool_allocations_customer_model_config_id ON compliance.shared_pool_allocations(customer_model_config_id);
CREATE INDEX IF NOT EXISTS idx_customer_model_config_shared_pool_eligible ON compliance.customer_model_config(shared_pool_eligible) WHERE shared_pool_eligible = true;
