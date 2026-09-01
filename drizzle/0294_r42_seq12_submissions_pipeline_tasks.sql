-- R42 seq12: M25 submission -> segmentation -> task pipeline, P2 (data model
-- only, no AI). Hand-curated from a `drizzle-kit generate` run whose output
-- was NOT applied as-is: this local clone's drizzle/meta snapshot is stale
-- relative to the live DB (it proposed re-creating construction_material_receipts,
-- hr_employee_loans, crm_pipeline_stages, performance_review_goals, and
-- ~30 other already-live tables/columns from unrelated prior work). Verified
-- live via information_schema.tables/pg_type before writing this file: none
-- of the 4 tables or 4 enums below exist yet; every other table drizzle
-- proposed already does. Only the genuinely-new statements are kept here.
--
-- NAMING NOTE: the work order's own "how" names the task table `tasks`, but
-- compliance.tasks ALREADY EXISTS (1,904 rows, unrelated AI-workforce/
-- dynamic-chain dispatch table -- client_id, assistant_id, task_embedding,
-- resolved_worker_agent_id, dynamic_chain_id, search_vector). Named
-- `pipeline_tasks` instead to avoid a real collision; everything else in the
-- "how" (columns, statuses, project-resolution rule) is unchanged.

CREATE TYPE "compliance"."submission_status" AS ENUM('chat', 'in_progress', 'done', 'partial', 'failed');--> statement-breakpoint
CREATE TYPE "compliance"."pipeline_task_status" AS ENUM('to_do', 'in_progress', 'waiting', 'done', 'blocked');--> statement-breakpoint
CREATE TYPE "compliance"."pipeline_task_executor" AS ENUM('software', 'ai', 'person');--> statement-breakpoint
CREATE TYPE "compliance"."pipeline_task_project_source" AS ENUM('inherited', 'stated');--> statement-breakpoint

CREATE TABLE "compliance"."submissions" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"project_id" text,
	"mode" text NOT NULL,
	"selected_chain" jsonb,
	"raw_input" text NOT NULL,
	"user_id" text NOT NULL,
	"status" "compliance"."submission_status" DEFAULT 'in_progress' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."pipeline_tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"submission_id" text NOT NULL,
	"sequence" integer NOT NULL,
	"depends_on" text,
	"org_id" text NOT NULL,
	"project_id" text,
	"project_source" "compliance"."pipeline_task_project_source" NOT NULL,
	"derived_chain" jsonb,
	"function_id" text,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"chain_matched_hint" boolean DEFAULT false NOT NULL,
	"executor" "compliance"."pipeline_task_executor" DEFAULT 'software' NOT NULL,
	"status" "compliance"."pipeline_task_status" DEFAULT 'to_do' NOT NULL,
	"result" jsonb,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."phrase_map" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"normalised_phrase" text NOT NULL,
	"function_id" text NOT NULL,
	"fixed_params" jsonb,
	"hit_count" integer DEFAULT 0 NOT NULL,
	"promoted_by_id" text,
	"promoted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance"."gap_log" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"user_id" text NOT NULL,
	"submission_id" text,
	"segment_text" text NOT NULL,
	"normalised_intent" text,
	"reason" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

ALTER TABLE "compliance"."pipeline_tasks" ADD CONSTRAINT "pipeline_tasks_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "compliance"."submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance"."gap_log" ADD CONSTRAINT "gap_log_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "compliance"."submissions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- depends_on is self-referential within pipeline_tasks -- added as its own
-- ALTER TABLE (never inline in CREATE TABLE) so the FK can point at a table
-- that didn't exist yet mid-statement, same forward-reference pattern used
-- throughout this file (pms_time_entries.invoice_item_id, etc).
ALTER TABLE "compliance"."pipeline_tasks" ADD CONSTRAINT "pipeline_tasks_depends_on_pipeline_tasks_id_fk" FOREIGN KEY ("depends_on") REFERENCES "compliance"."pipeline_tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS submissions_org_user_idx ON "compliance"."submissions" ("org_id", "user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS pipeline_tasks_submission_idx ON "compliance"."pipeline_tasks" ("submission_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS pipeline_tasks_org_project_idx ON "compliance"."pipeline_tasks" ("org_id", "project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS gap_log_org_created_idx ON "compliance"."gap_log" ("org_id", "created_at");--> statement-breakpoint
-- The "never two drafts"-style hard constraint for L0 (M26): at most one
-- phrase_map row per (org, phrase). A DB constraint, not app-level
-- discipline -- classify.ts's L0 lookup depends on this.
CREATE UNIQUE INDEX IF NOT EXISTS phrase_map_org_phrase_unique ON "compliance"."phrase_map" ("org_id", "normalised_phrase");--> statement-breakpoint

-- RLS, copying construction_materials (drizzle/0317) verbatim in shape.
ALTER TABLE "compliance"."submissions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "compliance"."pipeline_tasks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "compliance"."phrase_map" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "compliance"."gap_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$ BEGIN CREATE POLICY app_runtime_tenant_isolation ON "compliance"."submissions" FOR ALL TO app_runtime USING (org_id = compliance.current_org_id()); EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN CREATE POLICY service_role_bypass_submissions ON "compliance"."submissions" FOR ALL TO service_role USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN CREATE POLICY app_runtime_tenant_isolation ON "compliance"."pipeline_tasks" FOR ALL TO app_runtime USING (org_id = compliance.current_org_id()); EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN CREATE POLICY service_role_bypass_pipeline_tasks ON "compliance"."pipeline_tasks" FOR ALL TO service_role USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN CREATE POLICY app_runtime_tenant_isolation ON "compliance"."phrase_map" FOR ALL TO app_runtime USING (org_id = compliance.current_org_id()); EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN CREATE POLICY service_role_bypass_phrase_map ON "compliance"."phrase_map" FOR ALL TO service_role USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN CREATE POLICY app_runtime_tenant_isolation ON "compliance"."gap_log" FOR ALL TO app_runtime USING (org_id = compliance.current_org_id()); EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN CREATE POLICY service_role_bypass_gap_log ON "compliance"."gap_log" FOR ALL TO service_role USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- M30/M31's DB-enforced "cannot combine SUPPRESSED with required" rule lives
-- on screen_definitions (seq20), not here -- this migration has no such
-- field-status column. The one M25-specific DB-enforced rule this migration
-- DOES carry is phrase_map_org_phrase_unique above (EXACT MATCH ONLY, no
-- fuzzy, no duplicate phrase per org).
