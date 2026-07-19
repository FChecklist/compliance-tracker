-- AI Router registry-backed model resolution follow-up (2026-07-19, Gap 2).
-- orchestra-model-resolver.ts hardcoded 4 named failover-chain slots as TS
-- constants (PLATFORM_DEFAULT_PROVIDER/PLATFORM_DEFAULT_MODEL,
-- PLATFORM_FALLBACK_MODEL, CEREBRAS_GPT_OSS_MODEL, ESCALATED_PROVIDER/
-- ESCALATED_MODEL) -- swapping any of them required a code deploy,
-- contradicting the platform's own "model-agnostic, swappable without a
-- deploy" principle. This migration adds a `role` column to the existing
-- platform.ai_model_registry table (see drizzle/0231_ai_router_mother_router.sql
-- for the table's own origin) so orchestra-model-resolver.ts's getRoleModel()
-- can look each one up by a named role instead. The FAILOVER SEQUENCE/
-- DECISION LOGIC itself stays entirely in code -- this only lets WHICH
-- model/provider fills each named slot move to data. model-tier-eligibility.ts
-- is untouched by this migration, same as every other AI Router migration to
-- date -- see that file's own header for why "is this a real/known model"
-- and "is it TRUSTED for judgment-critical work" stay separate questions.
--
-- Idempotent (IF NOT EXISTS / repeatable UPDATE), same convention as every
-- other migration in this directory -- see drizzle/0035's own header for why
-- ALTER TYPE ... ADD VALUE (a separate concern, see drizzle/0248) must never
-- share a transaction/migration file with other DDL.

ALTER TABLE platform.ai_model_registry ADD COLUMN IF NOT EXISTS role text;

-- Backfills the 4 named roles onto the exact rows drizzle/0231's own seed
-- INSERT already created for these same (provider, model) pairs -- verified
-- against that migration's seed data before writing this, not guessed. Only
-- one row exists per (provider, model) (that table's own UNIQUE constraint),
-- so each UPDATE below touches at most one row.
UPDATE platform.ai_model_registry SET role = 'platform_default'
  WHERE provider = 'groq' AND model = 'openai/gpt-oss-120b' AND role IS NULL;

UPDATE platform.ai_model_registry SET role = 'cerebras_failover'
  WHERE provider = 'cerebras' AND model = 'gpt-oss-120b' AND role IS NULL;

UPDATE platform.ai_model_registry SET role = 'platform_fallback'
  WHERE provider = 'openrouter' AND model = 'meta-llama/llama-3.3-70b-instruct:free' AND role IS NULL;

UPDATE platform.ai_model_registry SET role = 'escalated_default'
  WHERE provider = 'openrouter' AND model = 'z-ai/glm-5.2' AND role IS NULL;

-- At most one ACTIVE row per named role at a time -- same partial-unique-
-- index pattern ai_routing_policies_one_active_per_scope already uses
-- (drizzle/0231_ai_router_mother_router.sql). NULL roles (the vast
-- majority -- roster.ts role assignments, vision overrides, etc. have no
-- "role" in this sense) are unconstrained by this index, matching Postgres's
-- own "NULLs are never considered equal" unique-index semantics.
CREATE UNIQUE INDEX IF NOT EXISTS ai_model_registry_one_active_per_role
  ON platform.ai_model_registry (role) WHERE status = 'active' AND role IS NOT NULL;
