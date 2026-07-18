-- AIROUTER-01 (CONTROLLER.yaml, Owner directive 2026-07-18): "Mother Router"
-- Phase 1 -- a real, unifying AI model/provider registry + versioned routing
-- policy + audit log, sitting alongside (not replacing) the existing
-- resolution mechanisms: orchestra-model-resolver.ts (per-org/per-feature,
-- the "end_user_org" scope below), model-tier-eligibility.ts (capability
-- gating, the "software_team" scope below), and roster.ts (per-role model
-- assignment, feeding the new "sales_marketing" scope). None of those 3
-- files are modified by this migration or by src/lib/ai-router/mother-router.ts
-- -- this is purely additive metadata + audit trail layered on top of them,
-- by deliberate scope decision (see that file's own header comment and this
-- PR's PROGRESS.md for why a full rewrite of all ~23+3 existing call sites
-- was not attempted in one pass).

CREATE TYPE compliance.ai_router_scope AS ENUM ('software_team', 'end_user_org', 'sales_marketing');
CREATE TYPE compliance.ai_model_status AS ENUM ('active', 'disabled', 'deprecated');
CREATE TYPE compliance.ai_model_health AS ENUM ('healthy', 'degraded', 'down');

-- One row per (provider, model) pair already hardcoded across llm-client.ts's
-- MODEL_PRICING / model-tier-eligibility.ts's JUDGMENT_ELIGIBLE+INTEGRATIVE_ELIGIBLE
-- / roster.ts's per-role model assignments -- this table is a migration of
-- that EXISTING truth into a queryable, hot-editable registry, not a
-- redesign of which models are allowed. `provider` is free text, not
-- compliance.ai_provider (which deliberately excludes "cerebras" -- see
-- llm-client.ts's own LLMProvider type comment, Wave 2026-07-10: cerebras is
-- a same-model-failover-only target, never a customer-facing BYO config
-- value) -- this registry needs to describe cerebras rows too.
CREATE TABLE IF NOT EXISTS compliance.ai_model_registry (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  provider text NOT NULL,
  model text NOT NULL,
  tier text NOT NULL, -- mirrors task-tightening.ts's ComplexityTier ('mechanical'|'integrative'|'judgment'); free text here (not a DB enum) so this table can register a model's descriptive tier without a migration every time model-tier-eligibility.ts's own TS sets change
  status compliance.ai_model_status NOT NULL DEFAULT 'active',
  cost_per_1k_input numeric(10, 6),
  cost_per_1k_output numeric(10, 6),
  health_status compliance.ai_model_health NOT NULL DEFAULT 'healthy',
  notes text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  UNIQUE (provider, model)
);

-- Versioned routing rules per domain scope. Only one version per scope may
-- be active at a time (enforced by the partial unique index below) --
-- "rollback" = flipping is_active to a prior version's row, which
-- mother-router.ts's resolveModel() picks up on its very next call (short
-- in-process TTL cache, see that file) with no app restart required.
CREATE TABLE IF NOT EXISTS compliance.ai_routing_policies (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  scope compliance.ai_router_scope NOT NULL,
  version integer NOT NULL,
  is_active boolean NOT NULL DEFAULT false,
  rule jsonb NOT NULL DEFAULT '{}',
  created_at timestamp NOT NULL DEFAULT now(),
  created_by text,
  UNIQUE (scope, version)
);

CREATE UNIQUE INDEX IF NOT EXISTS ai_routing_policies_one_active_per_scope
  ON compliance.ai_routing_policies (scope) WHERE is_active = true;

-- Append-only. One row per mother-router.ts resolveModel() call, real
-- fields only -- this is the audit trail Owner asked for, not a stub.
CREATE TABLE IF NOT EXISTS compliance.ai_routing_audit_log (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  scope compliance.ai_router_scope NOT NULL,
  context jsonb NOT NULL DEFAULT '{}',
  resolved_provider text NOT NULL,
  resolved_model text NOT NULL,
  policy_version integer,
  reason text,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_routing_audit_log_created_at_idx ON compliance.ai_routing_audit_log (created_at);
CREATE INDEX IF NOT EXISTS ai_routing_audit_log_scope_idx ON compliance.ai_routing_audit_log (scope);

-- Owner directive 2026-07-18: "In 1st phase we will give number of user
-- based subscription packages." compliance.subscription_plans ALREADY
-- EXISTS (schema.ts, Wave 1) with exactly the shape this needs
-- (user_pack_size, assistants_per_user, features jsonb) but had ZERO seed
-- rows and ZERO consumers anywhere in src/ -- confirmed by a real grep
-- before writing this, not assumed. Seeding real rows here rather than
-- inventing a new table, per this task's own "don't duplicate" constraint.
-- `features.aiPackage` is the key mother-router.ts's getOrgAiPackage() reads
-- -- deliberately named "aiPackage", not "tier", to avoid the exact
-- LAYER-vs-TIER conflation ai-os/CONSTITUTION.yaml's ai_orchestra_tiers
-- section already warns against (that section's "tier" means model-trust
-- level; this is a billing/entitlement concept, a third, distinct axis).
-- price_monthly intentionally left NULL -- real pricing is a business
-- decision outside this task's scope, not invented here.
INSERT INTO compliance.subscription_plans (name, user_pack_size, assistants_per_user, features)
VALUES
  ('Basic', 10, 3, '{"aiPackage": "basic"}'),
  ('Standard', 25, 5, '{"aiPackage": "standard"}'),
  ('Professional', 50, 8, '{"aiPackage": "professional"}'),
  ('Enterprise', 100, 15, '{"aiPackage": "enterprise"}')
ON CONFLICT (name) DO NOTHING;

-- Bring Your Own AI (BYOB) -- Owner directive 2026-07-18: "keep byob ai
-- PENDING." NOTE (do not silently lose this on a future re-read of this
-- migration): the RAW capability already exists today, unconditionally,
-- for every org -- compliance.customer_model_config (schema.ts) already
-- lets an org configure its own provider/model/encrypted-key per Orchestra
-- Layer, consulted first by orchestra-model-resolver.ts's resolveModelConfig().
-- This migration deliberately does NOT add new byob_enabled/byob_config
-- columns anywhere -- doing so would duplicate that real, already-wired
-- table. What is genuinely PENDING (Phase 2, not built here): gating BYOB
-- *by subscription package* (e.g. restricting customer_model_config to
-- Enterprise-tier orgs only) -- today any org can configure it regardless
-- of aiPackage, unchanged by this migration.
