-- CRR P2-SCHEMA Drizzle sync (2026-08-27)
-- This migration exists to reconcile this codebase's migration history with
-- schema that was already built directly against the live database via
-- Supabase migrations crr041_048_054_p2_schema_foundation through
-- crr045_tsvector_gin, crr224_supersession_columns, and
-- crr068_fix_missed_rls_gaps (see platform.crr_spec CRR-041..CRR-069 for
-- the point-by-point spec/proofs, docs/CRR_SCHEMA.md for the data
-- dictionary). Every statement below is idempotent (IF NOT EXISTS / a
-- duplicate_object-tolerant DO block) so this is a safe no-op if it ever
-- runs against a database that already has these objects, and a correct
-- from-scratch build if it runs against one that does not.
--
-- NOTE ON HOW THIS FILE WAS PRODUCED: `drizzle-kit generate` was tried
-- first and rejected -- this repo's committed drizzle/meta/*.json snapshot
-- history has drifted from both schema.ts and the live database (it
-- produced CREATE TABLE statements for ~25 tables that already exist,
-- e.g. chain_history, hr_employee_loans, submissions, plus destructive-
-- looking ALTER COLUMN statements on live tables unrelated to this
-- change). That drift is a real, pre-existing repo issue, out of scope
-- for this migration -- flagged in the PR, not fixed here. This file was
-- hand-written instead, scoped to exactly the 8 new CRR tables and 3 new
-- enums, and independently verified column-by-column against the live
-- database before being written.
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "compliance"."source_object_origin" AS ENUM('upload', 'connector', 'email', 'inapp', 'api');
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "compliance"."precedent_outcome" AS ENUM('SUCCESS', 'FAILURE', 'ABANDONED');
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "compliance"."chunk_policy_split_on" AS ENUM('paragraph', 'sentence', 'page', 'fixed');
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "compliance"."source_object" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"client_id" text,
	"origin" text NOT NULL,
	"origin_ref" text,
	"mime_type" text,
	"byte_size" bigint,
	"storage_path" text,
	"sha256" text,
	"title" text,
	"linked_entity_type" text,
	"linked_entity_id" text,
	"business_object_type" text,
	"extract_status" text DEFAULT 'PENDING' NOT NULL,
	"extract_error" text,
	"page_count" integer,
	"char_count" integer,
	"created_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"doc_uid" text NOT NULL,
	"content_sha256" text,
	"display_name" text,
	"content_erased_at" timestamp with time zone,
	"erased_by_id" text,
	"erasure_authority" text,
	"supersedes_doc_uid" text,
	"superseded_by_doc_uid" text,
	"is_current" boolean DEFAULT true NOT NULL,
	CONSTRAINT "source_object_doc_uid_unique" UNIQUE("doc_uid"),
	CONSTRAINT "source_object_extract_status_check" CHECK ("extract_status" in ('PENDING','EXTRACTING','EXTRACTED','CHUNKED','EMBEDDED','FAILED','SKIPPED_UNSUPPORTED','SKIPPED_NO_TEXT_LAYER')),
	CONSTRAINT "source_object_origin_check" CHECK ("origin" in ('upload','connector','email','inapp','api'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "source_object_org_sha256_unique" ON "compliance"."source_object" ("org_id","sha256") WHERE "deleted_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "source_object_extract_status_created_at_idx" ON "compliance"."source_object" ("extract_status","created_at") WHERE "deleted_at" IS NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "compliance"."document_chunk" (
	"id" text PRIMARY KEY NOT NULL,
	"source_object_id" text NOT NULL,
	"org_id" text NOT NULL,
	"seq" integer NOT NULL,
	"page" integer,
	"char_start" integer,
	"char_end" integer,
	"content" text,
	"content_hash" text,
	"token_estimate" integer,
	"is_real" boolean DEFAULT false NOT NULL,
	"content_erased_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_chunk_source_object_id_seq_unique" UNIQUE("source_object_id","seq")
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "compliance"."document_chunk" ADD CONSTRAINT "document_chunk_source_object_id_source_object_id_fk" FOREIGN KEY ("source_object_id") REFERENCES "compliance"."source_object"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_chunk_org_id_idx" ON "compliance"."document_chunk" ("org_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_chunk_source_object_seq_idx" ON "compliance"."document_chunk" ("source_object_id","seq");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_chunk_content_hash_idx" ON "compliance"."document_chunk" ("content_hash");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "compliance"."extraction_profile" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text,
	"business_object_type" text NOT NULL,
	"name" text NOT NULL,
	"field_spec" jsonb NOT NULL,
	"prompt_preamble" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_platform_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "compliance"."precedent" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"user_id" text,
	"normalised_intent" text NOT NULL,
	"function_id" text,
	"params" jsonb,
	"outcome" text NOT NULL,
	"source_task_id" text,
	"occurred_at" timestamp with time zone,
	"reuse_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "precedent_outcome_check" CHECK ("outcome" in ('SUCCESS','FAILURE','ABANDONED'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "compliance"."retrieval_citation" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"chunk_id" text NOT NULL,
	"query_text" text,
	"response_id" text,
	"cited_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "compliance"."retrieval_citation" ADD CONSTRAINT "retrieval_citation_chunk_id_document_chunk_id_fk" FOREIGN KEY ("chunk_id") REFERENCES "compliance"."document_chunk"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "compliance"."chunk_policy" (
	"id" text PRIMARY KEY NOT NULL,
	"business_object_type" text NOT NULL,
	"max_chars" integer NOT NULL,
	"overlap_chars" integer NOT NULL,
	"split_on" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chunk_policy_business_object_type_unique" UNIQUE("business_object_type"),
	CONSTRAINT "chunk_policy_split_on_check" CHECK ("split_on" in ('paragraph','sentence','page','fixed'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "compliance"."crr_erasure_log" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"subject_ref" text NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	"source_objects_deleted" integer,
	"chunks_deleted" integer,
	"citations_deleted" integer,
	"embeddings_deleted" integer,
	"completed_at" timestamp with time zone,
	"performed_by_id" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "compliance"."crr_ingest_error" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text,
	"source_object_id" text,
	"stage" text NOT NULL,
	"error_code" text,
	"error_message" text,
	"retry_count" integer DEFAULT 0,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- RLS: enabled + tenant-isolation policies on every table above with an
-- org_id column (all except chunk_policy, which is shared platform config).
-- Guarded so this is a safe no-op if already applied (it is, live).
ALTER TABLE "compliance"."source_object" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "compliance"."document_chunk" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "compliance"."extraction_profile" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "compliance"."precedent" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "compliance"."retrieval_citation" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "compliance"."crr_erasure_log" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "compliance"."crr_ingest_error" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY "app_runtime_tenant_isolation" ON "compliance"."source_object" FOR ALL TO app_runtime USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY "service_role_bypass_source_object" ON "compliance"."source_object" FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY "app_runtime_tenant_isolation" ON "compliance"."document_chunk" FOR ALL TO app_runtime USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY "service_role_bypass_document_chunk" ON "compliance"."document_chunk" FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY "app_runtime_tenant_or_platform_default" ON "compliance"."extraction_profile" FOR ALL TO app_runtime USING (org_id = compliance.current_org_id() OR is_platform_default = true);
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY "service_role_bypass_extraction_profile" ON "compliance"."extraction_profile" FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY "app_runtime_tenant_isolation" ON "compliance"."precedent" FOR ALL TO app_runtime USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY "service_role_bypass_precedent" ON "compliance"."precedent" FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY "app_runtime_tenant_isolation" ON "compliance"."retrieval_citation" FOR ALL TO app_runtime USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY "service_role_bypass_retrieval_citation" ON "compliance"."retrieval_citation" FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY "app_runtime_tenant_isolation" ON "compliance"."crr_erasure_log" FOR ALL TO app_runtime USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY "service_role_bypass_crr_erasure_log" ON "compliance"."crr_erasure_log" FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY "app_runtime_tenant_isolation" ON "compliance"."crr_ingest_error" FOR ALL TO app_runtime USING (org_id is not null and org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY "service_role_bypass_crr_ingest_error" ON "compliance"."crr_ingest_error" FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
-- Vector columns, HNSW index, and the generated tsvector+GIN index are
-- deliberately NOT in this file -- same reason document_chunk.embedding is
-- omitted from schema.ts: Drizzle has no first-class pgvector type here.
-- They already exist live (migrations crr041_048_054_p2_schema_foundation,
-- crr_p2_schema_tier3, crr045_tsvector_gin). If this migration is ever run
-- against a database that does NOT have them yet, add them separately via
-- raw SQL with the vector extension already enabled, matching the
-- embeddings table's own established pattern.
