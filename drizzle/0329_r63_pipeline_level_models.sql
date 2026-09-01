-- R63 (owner directive, 2026-08-29): AI-agnostic pipeline levels. A
-- dedicated table, NOT a reuse of platform.ai_model_registry.role -- that
-- column's own migration header already enumerates exactly 4 reserved
-- meanings ('platform_default', 'platform_fallback', 'cerebras_failover',
-- 'escalated_default') for orchestra-model-resolver.ts's failover chain.
-- Overloading it with a 5th, unrelated meaning would contradict that
-- table's own documented contract. This table answers a different
-- question -- "which model does src/lib/pipeline's L1/L2 classifier use,
-- platform-wide" -- and is read by src/lib/ai/level-model-registry.ts,
-- which providers/openrouter.ts now consults instead of a hardcoded
-- constant. No RLS: platform-wide (every org, every product on this
-- backend, including PROJEXA-AI.COM), not org-scoped -- same posture as
-- ai_model_registry/ai_routing_policies, which also carry no RLS policy.

CREATE TYPE "platform"."pipeline_level" AS ENUM('pipeline_l1', 'pipeline_l2');--> statement-breakpoint

-- Reuses platform.ai_model_status (active|disabled|deprecated), the SAME
-- enum ai_model_registry already uses -- one status vocabulary for every
-- AI-model-bearing table in this schema, not a second one with different
-- values.
CREATE TABLE "platform"."pipeline_level_models" (
	"id" text PRIMARY KEY NOT NULL,
	"level" "platform"."pipeline_level" NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"status" "platform"."ai_model_status" DEFAULT 'active' NOT NULL,
	"reason" text,
	"updated_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- At most one ACTIVE row per level -- level-model-registry.ts's
-- resolvePipelineModel() takes the most-recently-updated active row, but
-- this index makes "which one is live" a data invariant, not a query-order
-- assumption, matching ai_routing_policies_one_active_per_scope's own
-- established pattern in this schema.
CREATE UNIQUE INDEX IF NOT EXISTS "pipeline_level_models_one_active_per_level"
  ON "platform"."pipeline_level_models" ("level")
  WHERE "status" = 'active';--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "pipeline_level_models_level_updated_idx"
  ON "platform"."pipeline_level_models" ("level", "updated_at" DESC);
