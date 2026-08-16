-- Wave 21 (VERIDIAN module-reusability): Module Rules Configuration
-- resolver + wiring 3 representative modules + Worker Agent Domain Index
-- backfill. See PLATFORM_STRATEGY.md's Wave 20-21 section.
--
-- module_rule_configs generalizes orchestra-model-resolver.ts's
-- resolveModelConfig() "most-specific-scope-wins" pattern to module
-- behavior. One polymorphic scope_type/scope_id discriminator (not 5
-- nullable FK columns) -- scales cleanly across 6 levels, same
-- unconstrained-but-service-validated scope pointer trade-off
-- approval_requests.entity_id/entity_type already makes in this codebase.
--
-- Resolution chain (most-specific-first): user -> client -> project -> org
-- -> product_branch -> platform. 'user' scope_type is supported by the
-- resolver's shape for completeness but NO rule-setting API/UI is exposed
-- for it this wave, and none of the 3 seeded platform-default rules below
-- use it -- most GRC rules are organizational, not personal; a stray
-- per-user override risks the exact audit-trail confusion
-- classification.ts's role-based ceiling is designed to prevent.

CREATE TABLE IF NOT EXISTS compliance.module_rule_configs (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  module_key text NOT NULL REFERENCES compliance.module_registry(module_key),
  rule_key text NOT NULL,
  rule_value jsonb NOT NULL DEFAULT '{}'::jsonb,
  scope_type text NOT NULL, -- 'platform' | 'product_branch' | 'org' | 'project' | 'client' | 'user'
  scope_id text, -- NULL only when scope_type='platform'
  is_active boolean NOT NULL DEFAULT true,
  created_by_id text REFERENCES compliance.users(id),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  UNIQUE(module_key, rule_key, scope_type, scope_id)
);

ALTER TABLE compliance.module_rule_configs ENABLE ROW LEVEL SECURITY;

-- Read: platform/product_branch rows are global (everyone sees platform
-- defaults); org/project/client/user rows only visible when the scope
-- resolves to the caller's own org (project/client scope requires a join
-- since org_id isn't directly on this table for those narrower levels).
DO $$ BEGIN
  CREATE POLICY app_runtime_read_module_rule_configs ON compliance.module_rule_configs FOR SELECT TO app_runtime
    USING (
      scope_type IN ('platform', 'product_branch')
      OR (scope_type = 'org' AND scope_id = compliance.current_org_id())
      OR (scope_type = 'project' AND EXISTS (SELECT 1 FROM compliance.projects p WHERE p.id = module_rule_configs.scope_id AND p.org_id = compliance.current_org_id()))
      OR (scope_type = 'client' AND EXISTS (SELECT 1 FROM compliance.clients c WHERE c.id = module_rule_configs.scope_id AND c.org_id = compliance.current_org_id()))
      OR (scope_type = 'user' AND scope_id = compliance.current_user_id())
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Write: excludes platform/product_branch entirely -- only service_role may
-- write platform/branch defaults, same discipline as worker_agents'
-- tier='global' write-exclusion from Wave 16.
DO $$ BEGIN
  CREATE POLICY app_runtime_write_module_rule_configs ON compliance.module_rule_configs FOR INSERT TO app_runtime
    WITH CHECK (
      (scope_type = 'org' AND scope_id = compliance.current_org_id())
      OR (scope_type = 'project' AND EXISTS (SELECT 1 FROM compliance.projects p WHERE p.id = module_rule_configs.scope_id AND p.org_id = compliance.current_org_id()))
      OR (scope_type = 'client' AND EXISTS (SELECT 1 FROM compliance.clients c WHERE c.id = module_rule_configs.scope_id AND c.org_id = compliance.current_org_id()))
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY app_runtime_update_module_rule_configs ON compliance.module_rule_configs FOR UPDATE TO app_runtime
    USING (
      (scope_type = 'org' AND scope_id = compliance.current_org_id())
      OR (scope_type = 'project' AND EXISTS (SELECT 1 FROM compliance.projects p WHERE p.id = module_rule_configs.scope_id AND p.org_id = compliance.current_org_id()))
      OR (scope_type = 'client' AND EXISTS (SELECT 1 FROM compliance.clients c WHERE c.id = module_rule_configs.scope_id AND c.org_id = compliance.current_org_id()))
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY app_runtime_delete_module_rule_configs ON compliance.module_rule_configs FOR DELETE TO app_runtime
    USING (
      (scope_type = 'org' AND scope_id = compliance.current_org_id())
      OR (scope_type = 'project' AND EXISTS (SELECT 1 FROM compliance.projects p WHERE p.id = module_rule_configs.scope_id AND p.org_id = compliance.current_org_id()))
      OR (scope_type = 'client' AND EXISTS (SELECT 1 FROM compliance.clients c WHERE c.id = module_rule_configs.scope_id AND c.org_id = compliance.current_org_id()))
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_module_rule_configs ON compliance.module_rule_configs FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.module_rule_configs TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.module_rule_configs TO service_role;

CREATE INDEX IF NOT EXISTS idx_module_rule_configs_module_key ON compliance.module_rule_configs(module_key);
CREATE INDEX IF NOT EXISTS idx_module_rule_configs_scope ON compliance.module_rule_configs(scope_type, scope_id);
CREATE INDEX IF NOT EXISTS idx_module_rule_configs_created_by ON compliance.module_rule_configs(created_by_id);

-- Platform-default seed rows for the 3 representative modules wired this
-- wave -- every org has a working fallback from day one, identical to
-- today's actual (hardcoded) behavior until an org/client/project sets an
-- override.
INSERT INTO compliance.module_rule_configs (module_key, rule_key, rule_value, scope_type, scope_id) VALUES
  ('risks', 'severity_matrix', '{"bands": [{"min": 1, "max": 6, "label": "low"}, {"min": 7, "max": 15, "label": "medium"}, {"min": 16, "max": 25, "label": "high"}]}'::jsonb, 'platform', NULL),
  ('incidents', 'regulatory_notify_triggers', '{"categoryRegex": "security|breach"}'::jsonb, 'platform', NULL),
  ('posh_complaints', 'classification_ceiling_override', '{"role_overrides": {}}'::jsonb, 'platform', NULL)
ON CONFLICT (module_key, rule_key, scope_type, scope_id) DO NOTHING;

-- ============================================================
-- Worker Agent Domain Index -- backfill from existing worker_agents.domain
-- ============================================================
-- Additive: every existing agent's single `domain` column value becomes its
-- first (and today, only) domain_path entry. No-op for any agent that
-- somehow already has an index row (re-runnable).
INSERT INTO compliance.worker_agent_domain_index (worker_agent_id, domain_path)
SELECT wa.id, wa.domain
FROM compliance.worker_agents wa
WHERE wa.domain IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM compliance.worker_agent_domain_index wadi
    WHERE wadi.worker_agent_id = wa.id AND wadi.domain_path = wa.domain
  );

-- No new indexes here: get_advisors confirmed worker_agent_domain_index
-- already has worker_agent_domain_index_path_idx (domain_path, Wave 3) and
-- a UNIQUE composite index on (worker_agent_id, domain_path) whose leftmost
-- column already serves single-column worker_agent_id lookups -- adding
-- either as a new index would have been a pure duplicate.
