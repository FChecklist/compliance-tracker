-- R53 Phase 2 -- the two tables the shell needs and nothing else persists.
--
-- WHY THESE TWO AND NO OTHERS: M24 rules that the pill strip is ranked per
-- user on a rolling 7-day window (MP-RULE-3), that PINNED PILLS NEVER DECAY,
-- and that LAST-USED-EVER breaks ties below the 7-day window (MP-RISK-3:
-- "otherwise month-end work vanishes for three weeks"). M24 also rules that
-- HISTORY shows the WHOLE chain, DEDUPLICATED ("running Daily entry six
-- times leaves ONE row"), INCLUDING FAILED CHAINS. Nothing in
-- compliance.* stores any of that today -- verified 26 Aug 2026 against
-- information_schema: no pill_usage, no chain_history, and no column on
-- submissions/pipeline_tasks that could stand in for either.
--
-- EXPAND ONLY (AR-11). Two new tables, four new indexes, one new enum. No
-- column is dropped, narrowed, renamed or re-typed anywhere.
--
-- NO NEW TRACKING TABLE, METRIC OR TAXONOMY beyond these two: the R53 work
-- order names exactly pill_usage and chain_history and forbids anything
-- further. l0_hit_rate (Phase 7) is COMPUTED from the existing phrase_map /
-- gap_log rows, not stored in a new metric table.

CREATE TYPE "compliance"."chain_outcome" AS ENUM('ok', 'failed');--> statement-breakpoint

-- MP-RULE-3's storage. One row per (org, user, pill) -- the rolling 7-day
-- window is a QUERY over last_used_at, not a second table of daily buckets.
CREATE TABLE "compliance"."pill_usage" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"user_id" text NOT NULL,
	"pill_key" text NOT NULL,
	"function_id" text,
	"derived_chain" jsonb,
	"last_used_at" timestamp DEFAULT now() NOT NULL,
	"use_count" integer DEFAULT 0 NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- M24's HISTORY drop-down. full_chain is TEXT, not jsonb, and that is a
-- deliberate choice, not an oversight: the UNIQUE below is the dedup rule
-- ("DEDUPLICATE. Running Daily entry six times leaves ONE row"), and two
-- jsonb values that render as the same chain but differ in key order or
-- whitespace would defeat it. The chain the user READS is the identity, so
-- the rendered chain string is what the constraint keys on. pipeline_tasks.
-- derived_chain stays jsonb -- that is the machine-side artifact; this is
-- the human-side one.
CREATE TABLE "compliance"."chain_history" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"user_id" text NOT NULL,
	"full_chain" text NOT NULL,
	"function_id" text,
	"mode" text,
	"project_id" text,
	-- INCLUDE FAILED CHAINS (M24: "the commonest reason to re-run something
	-- is that it went wrong"). A failed chain is history, not an error to hide.
	"outcome" "compliance"."chain_outcome" DEFAULT 'ok' NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"last_used_at" timestamp DEFAULT now() NOT NULL,
	"use_count" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- DEDUP IS A CONSTRAINT, NOT CODE (R53 Phase 2, verbatim). An upsert on
-- these keys is the only way a second identical chain can be recorded.
CREATE UNIQUE INDEX IF NOT EXISTS "chain_history_org_user_chain_unique" ON "compliance"."chain_history" ("org_id","user_id","full_chain");--> statement-breakpoint
-- Same reasoning one level down: a pill is one row per user, so use_count
-- and pinned mean something. Without this, "increment the count" would be a
-- read-modify-write race that silently forks a pill into duplicate rows.
CREATE UNIQUE INDEX IF NOT EXISTS "pill_usage_org_user_pill_unique" ON "compliance"."pill_usage" ("org_id","user_id","pill_key");--> statement-breakpoint

-- The ranking read path, exactly as the work order specifies it.
CREATE INDEX IF NOT EXISTS "pill_usage_org_user_last_used_idx" ON "compliance"."pill_usage" ("org_id","user_id","last_used_at" DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chain_history_org_user_last_used_idx" ON "compliance"."chain_history" ("org_id","user_id","last_used_at" DESC);--> statement-breakpoint

-- RLS: same shape as the siblings created in 0294 (submissions,
-- pipeline_tasks, phrase_map, gap_log) -- app_runtime is confined to its own
-- org, service_role bypasses.
ALTER TABLE "compliance"."pill_usage" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "compliance"."chain_history" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$ BEGIN CREATE POLICY app_runtime_tenant_isolation ON "compliance"."pill_usage" FOR ALL TO app_runtime USING (org_id = compliance.current_org_id()) WITH CHECK (org_id = compliance.current_org_id()); EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN CREATE POLICY service_role_bypass_pill_usage ON "compliance"."pill_usage" FOR ALL TO service_role USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN CREATE POLICY app_runtime_tenant_isolation ON "compliance"."chain_history" FOR ALL TO app_runtime USING (org_id = compliance.current_org_id()) WITH CHECK (org_id = compliance.current_org_id()); EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN CREATE POLICY service_role_bypass_chain_history ON "compliance"."chain_history" FOR ALL TO service_role USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
