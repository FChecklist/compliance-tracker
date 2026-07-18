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

-- Idempotent CREATE TYPE (this repo's own established convention -- see
-- e.g. drizzle/0222_training_lms_module.sql) so a retried/partially-applied
-- run of this migration doesn't abort on "type already exists" the way a
-- bare CREATE TYPE would.
DO $$ BEGIN
  CREATE TYPE compliance.ai_router_scope AS ENUM ('software_team', 'end_user_org', 'sales_marketing');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE compliance.ai_model_status AS ENUM ('active', 'disabled', 'deprecated');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE compliance.ai_model_health AS ENUM ('healthy', 'degraded', 'down');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

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

-- Seeds the real, already-hardcoded model truth from llm-client.ts's
-- MODEL_PRICING and model-tier-eligibility.ts's JUDGMENT_ELIGIBLE/
-- INTEGRATIVE_ELIGIBLE sets (as of 2026-07-18) into the new registry -- an
-- independent review of this PR correctly flagged that without this,
-- ai_model_registry ships as a permanently empty table despite its own
-- header comment claiming to be "a migration of that EXISTING truth ...
-- into a queryable, hot-editable registry." `tier` mirrors those TS sets
-- exactly (mechanical is every model not explicitly in the other two,
-- matching model-tier-eligibility.ts's own "default posture: most
-- restrictive" rule). Pricing columns left NULL for the 2 models
-- (deepseek/deepseek-v4-pro, google/gemini-2.5-pro) that MODEL_PRICING
-- itself has no row for -- not guessed, matching estimateCostUsd()'s own
-- "returns null for any unrecognized model rather than guessing" contract.
INSERT INTO compliance.ai_model_registry (provider, model, tier, cost_per_1k_input, cost_per_1k_output, notes)
VALUES
  ('groq', 'openai/gpt-oss-120b', 'mechanical', 0.000036, 0.00018, 'Platform-default floor tier (orchestra-model-resolver.ts PLATFORM_DEFAULT_MODEL)'),
  ('cerebras', 'gpt-oss-120b', 'mechanical', 0.00035, 0.00075, 'Same-model paid failover host for the Groq floor tier above'),
  ('groq', 'meta-llama/llama-4-scout-17b-16e-instruct', 'mechanical', 0.00011, 0.00034, 'Vision-capable override for vision_document_extraction source type'),
  ('openrouter', 'meta-llama/llama-3.3-70b-instruct:free', 'mechanical', 0, 0, 'Platform fallback model (free tier)'),
  ('openrouter', 'z-ai/glm-5.2', 'judgment', 0.00042, 0.00132, 'Sole judgment-tier-eligible model (model-tier-eligibility.ts)'),
  ('openrouter', 'z-ai/glm-5v-turbo', 'integrative', 0.0012, 0.004, 'Vision-capable AI Dev Team role model'),
  ('openrouter', 'z-ai/glm-5-turbo', 'integrative', 0.0012, 0.004, 'High-volume/low-stakes AI Dev Team role model'),
  ('openrouter', 'deepseek/deepseek-v4-pro', 'integrative', NULL, NULL, 'Integrative-eligible; no pricing row exists yet in llm-client.ts MODEL_PRICING'),
  ('openrouter', 'google/gemini-2.5-pro', 'integrative', NULL, NULL, 'Integrative-eligible (Research Analyst role); no pricing row exists yet in llm-client.ts MODEL_PRICING'),
  ('anthropic', 'claude-sonnet-5', 'mechanical', 0.003, 0.015, 'Super Boss / Claude Desktop -- not in JUDGMENT_ELIGIBLE or INTEGRATIVE_ELIGIBLE sets, most-restrictive default applies')
ON CONFLICT (provider, model) DO NOTHING;

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
