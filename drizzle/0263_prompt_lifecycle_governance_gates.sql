-- VERIDIAN_Architecture_v2.0 phase_3_governance_policy_cost_engines
-- (2026-07-26). Additive columns supporting the approval-gate ENFORCEMENT
-- phase_1's bare Draft/Review/Staging/Production/Deprecated state machine
-- (drizzle/0262) deferred to this phase -- see that migration's own header
-- and prompt-os-service.ts's transitionPromptLifecycle()/
-- prompt-governance-service.ts for the code these columns back. Purely
-- additive: no existing column changed, every pre-existing call site keeps
-- working unchanged. NOT applied live -- left for the supervising session,
-- same convention drizzle/0262 already established for this exact table.

ALTER TABLE compliance.prompt_templates
  ADD COLUMN IF NOT EXISTS owner_id text;

ALTER TABLE compliance.prompt_versions
  ADD COLUMN IF NOT EXISTS approved_by_id text,
  ADD COLUMN IF NOT EXISTS approved_at timestamp,
  ADD COLUMN IF NOT EXISTS staging_entered_at timestamp;

-- Business Rule Engine (gap analysis item engine-business-rule, prompt-
-- lifecycle sense): register a real module + real platform-default rows in
-- the EXISTING module_registry/module_rule_configs mechanism (Wave 21)
-- rather than inventing a parallel rules table -- module_rule_configs.
-- module_key has a real FK to module_registry.module_key (drizzle/0018), so
-- the registry row must exist first. These platform-scope defaults are
-- read by prompt-governance-service.ts's getPromptLifecycleRule() and are
-- overridable per-org exactly the way every other module_rule_configs row
-- already is (setModuleRule()/module-rule-service.ts, scope_type='org').
INSERT INTO compliance.module_registry (module_key, display_name, table_name, domain, category, is_core, description)
VALUES ('prompt_lifecycle', 'Prompt Lifecycle Governance', 'prompt_versions', 'prompt_os', 'GOVERNANCE', false,
        'VERIDIAN_Architecture_v2.0 phase_3: business-rule thresholds gating prompt_versions'' Draft/Review/Staging/Production state machine (eval pass rate, canary duration, eval spend budget).')
ON CONFLICT (module_key) DO NOTHING;

-- Postgres UNIQUE(module_key, rule_key, scope_type, scope_id) treats
-- scope_id=NULL values as always-distinct (standard NULL-not-equal-NULL
-- semantics), so ON CONFLICT on that constraint would never actually catch
-- a re-run of this seed for these platform-scope (scope_id IS NULL) rows --
-- INSERT ... WHERE NOT EXISTS is the correct idempotency guard here.
INSERT INTO compliance.module_rule_configs (module_key, rule_key, rule_value, scope_type, scope_id)
SELECT v.module_key, v.rule_key, v.rule_value, v.scope_type, NULL
FROM (VALUES
  ('prompt_lifecycle', 'min_eval_pass_rate', '{"value": 0.8}'::jsonb, 'platform'),
  ('prompt_lifecycle', 'min_canary_duration_hours', '{"value": 24}'::jsonb, 'platform'),
  ('prompt_lifecycle', 'eval_daily_budget_usd', '{"value": 5}'::jsonb, 'platform')
) AS v(module_key, rule_key, rule_value, scope_type)
WHERE NOT EXISTS (
  SELECT 1 FROM compliance.module_rule_configs existing
  WHERE existing.module_key = v.module_key AND existing.rule_key = v.rule_key
    AND existing.scope_type = v.scope_type AND existing.scope_id IS NULL
);
