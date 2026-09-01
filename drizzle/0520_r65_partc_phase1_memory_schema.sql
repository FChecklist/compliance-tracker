-- R65 Part C Phase 1: persistent-memory schema foundation for the
-- VERIDIAN persistent memory/RAG subsystem.
--
-- Three new tables in the `compliance` schema:
--   memory_records  -- the semantic-memory table (one row per remembered
--                       fact/preference/rule/... at some scope)
--   memory_sources  -- provenance detail: where a memory_records row came
--                       from (a conversation, a task, a document, ...)
--   memory_versions -- append-only version history of a memory_records
--                       row's content over time
--
-- Explicit reuse decisions (do not re-litigate, see PR description):
--   - compliance.memory_store (existing KV-fact tier, drizzle/0324) is left
--     untouched -- a different, already-shipped capability, not superseded
--     by this table.
--   - compliance.assistant_memories is left untouched, same reasoning.
--   - compliance.embeddings / compliance.embedding_cache are NOT
--     duplicated here. Phase 1 is schema-only: no embedding column, no
--     embedding-generation code. A later phase adds an embedding column
--     via a follow-up migration and calls into src/lib/embeddings.ts's
--     existing storeEmbedding()/findSimilar() rather than re-implementing
--     vector search.
--   - The field the originating directive called "UMR" is named
--     registry_ref instead -- "UMR" already names a different, unrelated
--     mechanism in this codebase (compliance.platform_assets, the
--     Universal Metadata Registry dual-mode shared/private asset
--     registry; see drizzle/0150/0152). registry_ref is a plain nullable
--     text column with no FK constraint for now, deliberately avoiding
--     the name collision.
--
-- Scope model: memory_type_type is genuinely platform-wide for
-- scope_type IN ('GLOBAL','INDUSTRY') (org_id IS NULL, readable by every
-- org, writable only by service_role/an admin path -- never by a regular
-- app_runtime request), and strictly org-scoped for every other scope_type
-- (org_id NOT NULL, readable/writable only by that org). This is the same
-- "own org or global" shape compliance.screen_definitions already uses
-- (drizzle/0295_r42_seq20_screen_registry.sql, org_id nullable, policy
-- app_runtime_read_own_org_or_global) -- reused here rather than inventing
-- a new pattern, but with app_runtime write access added back for the
-- org-scoped case (screen_definitions is registry-editor-only; memory
-- records are written directly by ordinary org-scoped app requests).
--
-- No FK constraint is added on org_id itself: it is intentionally nullable
-- for the GLOBAL/INDUSTRY case, matching screen_definitions.org_id's own
-- precedent (nullable org-or-global columns in this repo do not carry an
-- organisations(id) FK -- see drizzle/0350_add_org_fk_constraints.sql's
-- own header on this being an incremental, not blanket, effort). scope_id/
-- user_id/industry_id/project_id/task_id/source_type/source_id are cross-
-- cutting pointers whose real target table depends on scope_type/
-- source_type -- same polymorphic-reference shape as platform_assets'
-- own source_table/source_id pair, so no single FK target applies and none
-- is added, consistent with that precedent.
--
-- CREATE TABLE bodies below follow this repo's drizzle-kit-generated
-- shape (quoted identifiers, tab indent) -- see drizzle/0295, 0324, 0325
-- for the same style paired with a $defaultFn(() => createId()) id column
-- in schema.ts (no DB-level id default, the application always supplies a
-- cuid2). CHECK constraints, RLS, indexes and the Universal Metadata
-- Registry registration are hand-appended below, the same way
-- asset_registration_config's own CHECK constraint
-- (drizzle/0152_priority4_umr_auto_registration.sql) and
-- platform_billing_invoices' RLS (drizzle/0400) are.

CREATE TABLE "compliance"."memory_records" (
	"id" text PRIMARY KEY NOT NULL,
	"scope_type" text NOT NULL,
	"scope_id" text,
	"org_id" text,
	"user_id" text,
	"industry_id" text,
	"project_id" text,
	"task_id" text,
	"memory_type" text NOT NULL,
	"content" text NOT NULL,
	"content_hash" text NOT NULL,
	"confidence" numeric,
	"provenance_type" text NOT NULL,
	"lifecycle_state" text DEFAULT 'CANDIDATE' NOT NULL,
	"source_type" text,
	"source_id" text,
	"registry_ref" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"superseded_by_id" text REFERENCES "compliance"."memory_records"("id"),
	"effective_from" timestamp DEFAULT now() NOT NULL,
	"effective_to" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "memory_records_scope_type_check" CHECK ("scope_type" IN ('GLOBAL','INDUSTRY','ORGANIZATION','USER','PROJECT','TASK','CONVERSATION','DOCUMENT')),
	CONSTRAINT "memory_records_memory_type_check" CHECK ("memory_type" IN ('FACT','PREFERENCE','RULE','PROCEDURE','DECISION','CONTEXT','HISTORY','LESSON','PATTERN','WORKFLOW','TASK_RESULT','DOCUMENT_KNOWLEDGE','USER_INSTRUCTION','ORGANIZATION_INSTRUCTION','INDUSTRY_KNOWLEDGE')),
	CONSTRAINT "memory_records_provenance_type_check" CHECK ("provenance_type" IN ('USER_CONFIRMED','DATABASE_CONFIRMED','SYSTEM_DERIVED','AI_INFERRED','EXTERNAL_SOURCE')),
	CONSTRAINT "memory_records_lifecycle_state_check" CHECK ("lifecycle_state" IN ('TRANSIENT','CANDIDATE','CONFIRMED','ACTIVE','SUPERSEDED','ARCHIVED')),
	CONSTRAINT "memory_records_org_id_scope_consistency_check" CHECK (
		("scope_type" IN ('GLOBAL','INDUSTRY') AND "org_id" IS NULL)
		OR ("scope_type" NOT IN ('GLOBAL','INDUSTRY') AND "org_id" IS NOT NULL)
	)
);
--> statement-breakpoint
CREATE TABLE "compliance"."memory_sources" (
	"id" text PRIMARY KEY NOT NULL,
	"memory_record_id" text NOT NULL REFERENCES "compliance"."memory_records"("id") ON DELETE CASCADE,
	"source_kind" text NOT NULL,
	"conversation_id" text,
	"task_id" text,
	"document_id" text,
	"sheet_row_ref" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "memory_sources_source_kind_check" CHECK ("source_kind" IN ('CONVERSATION','TASK','DOCUMENT','SHEET_ROW','MANUAL'))
);
--> statement-breakpoint
CREATE TABLE "compliance"."memory_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"memory_record_id" text NOT NULL REFERENCES "compliance"."memory_records"("id") ON DELETE CASCADE,
	"version_number" integer NOT NULL,
	"content_snapshot" text NOT NULL,
	"content_hash" text NOT NULL,
	"changed_by_type" text NOT NULL,
	"changed_by_id" text,
	"change_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "memory_versions_changed_by_type_check" CHECK ("changed_by_type" IN ('USER','SYSTEM','AI')),
	-- Append-only integrity: never two rows for the same version of the
	-- same memory record (defense in depth alongside the RLS policies
	-- below, which additionally never grant app_runtime UPDATE/DELETE on
	-- this table at all -- see the GRANT statements further down).
	CONSTRAINT "memory_versions_record_version_unique" UNIQUE ("memory_record_id", "version_number")
);
--> statement-breakpoint

-- ─── Indexes ───────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "idx_memory_records_content_hash" ON "compliance"."memory_records" ("content_hash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_memory_records_org_id_scope_type" ON "compliance"."memory_records" ("org_id", "scope_type");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_memory_records_superseded_by_id" ON "compliance"."memory_records" ("superseded_by_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_memory_sources_memory_record_id" ON "compliance"."memory_sources" ("memory_record_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_memory_versions_memory_record_id" ON "compliance"."memory_versions" ("memory_record_id");
--> statement-breakpoint

-- ─── RLS: memory_records (modified Pattern A -- own org OR global read) ──
ALTER TABLE "compliance"."memory_records" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "compliance"."memory_records" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- SELECT: an org's own rows, PLUS every GLOBAL/INDUSTRY row (org_id IS NULL).
DO $$ BEGIN
  CREATE POLICY "app_runtime_org_scoped" ON "compliance"."memory_records" FOR SELECT TO app_runtime USING (org_id = compliance.current_org_id() OR org_id IS NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
-- INSERT/UPDATE/DELETE: only the requesting org's own rows. org_id = current_org_id()
-- is NULL (never TRUE) when org_id IS NULL, so a regular app_runtime request can
-- never write a GLOBAL/INDUSTRY row -- that remains an admin/service_role-only path.
DO $$ BEGIN
  CREATE POLICY "app_runtime_org_scoped_insert" ON "compliance"."memory_records" FOR INSERT TO app_runtime WITH CHECK (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY "app_runtime_org_scoped_update" ON "compliance"."memory_records" FOR UPDATE TO app_runtime USING (org_id = compliance.current_org_id()) WITH CHECK (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY "app_runtime_org_scoped_delete" ON "compliance"."memory_records" FOR DELETE TO app_runtime USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY "service_role_bypass_memory_records" ON "compliance"."memory_records" FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "compliance"."memory_records" TO app_runtime;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "compliance"."memory_records" TO service_role;
--> statement-breakpoint

-- ─── RLS: memory_sources (child table, EXISTS-join through memory_records,
-- same shape as erp_sales_invoice_items -> erp_sales_invoices in
-- drizzle/0041_wave49_erp_branch_and_accounting_schema.sql) ─────────────
ALTER TABLE "compliance"."memory_sources" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "compliance"."memory_sources" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY "app_runtime_org_scoped" ON "compliance"."memory_sources" FOR ALL TO app_runtime
    USING (EXISTS (SELECT 1 FROM compliance.memory_records mr WHERE mr.id = memory_sources.memory_record_id AND (mr.org_id = compliance.current_org_id() OR mr.org_id IS NULL)))
    WITH CHECK (EXISTS (SELECT 1 FROM compliance.memory_records mr WHERE mr.id = memory_sources.memory_record_id AND mr.org_id = compliance.current_org_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY "service_role_bypass_memory_sources" ON "compliance"."memory_sources" FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "compliance"."memory_sources" TO app_runtime;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "compliance"."memory_sources" TO service_role;
--> statement-breakpoint

-- ─── RLS: memory_versions (child table, EXISTS-join through memory_records,
-- same shape as memory_sources above) -- append-only: app_runtime gets
-- SELECT + INSERT policies only, no UPDATE/DELETE policy is created and no
-- UPDATE/DELETE grant is issued to app_runtime below, so "never UPDATEd,
-- only INSERTed" is enforced at the database, not just by service-layer
-- discipline. service_role retains full access for admin/migration use. ──
ALTER TABLE "compliance"."memory_versions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "compliance"."memory_versions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY "app_runtime_org_scoped_select" ON "compliance"."memory_versions" FOR SELECT TO app_runtime
    USING (EXISTS (SELECT 1 FROM compliance.memory_records mr WHERE mr.id = memory_versions.memory_record_id AND (mr.org_id = compliance.current_org_id() OR mr.org_id IS NULL)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY "app_runtime_org_scoped_insert" ON "compliance"."memory_versions" FOR INSERT TO app_runtime
    WITH CHECK (EXISTS (SELECT 1 FROM compliance.memory_records mr WHERE mr.id = memory_versions.memory_record_id AND mr.org_id = compliance.current_org_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY "service_role_bypass_memory_versions" ON "compliance"."memory_versions" FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
GRANT SELECT, INSERT ON "compliance"."memory_versions" TO app_runtime;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "compliance"."memory_versions" TO service_role;
--> statement-breakpoint

-- ─── Universal Metadata Registry (Rule 9/Priority 4) ────────────────────
-- Only memory_records is registered -- it is the top-level "asset" a user
-- would search the registry for. memory_sources/memory_versions are
-- provenance/history detail rows of a memory_records row, the same
-- relationship erp_sales_invoice_items has to erp_sales_invoices -- and
-- erp_sales_invoice_items itself is NOT given its own
-- asset_registration_config row either (verified: no
-- 'erp_sales_invoice_items' entry exists anywhere in this table). Child/
-- line-item tables are surfaced through their parent's registry entry, not
-- separately, so the same convention is followed here rather than
-- inventing a new one.
--
-- memory_records is org-scoped for the common case but can be org_id NULL
-- (GLOBAL/INDUSTRY) -- org_column is still set to org_id, same as
-- platform_assets.orgId/screen_definitions.org_id's own "nullable =
-- platform-tier" convention; a NULL org_id row registers as a
-- platform-tier asset. name_column uses content (the canonical
-- human-readable field on this table) -- there is no separate title/name
-- column, matching platform_billing_invoices' own precedent of using its
-- best available human-readable field (invoice_number) rather than
-- skipping registration for want of a dedicated name column.
-- owner_column is user_id (the memory's creating user, when known).
-- active_column is left NULL: lifecycle_state is a multi-value enum
-- ('TRANSIENT'|'CANDIDATE'|...), not the boolean-shaped column
-- compliance.auto_register_asset() checks for (row_data ->> active_column) = 'false'
-- against -- same reasoning platform_billing_invoices/erp_sales_invoices
-- used to leave active_column NULL rather than force-fit a non-boolean
-- column into it.
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('memory_records', 'other', 'content', NULL, NULL, 'org_id', 'user_id', NULL);
--> statement-breakpoint

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.memory_records
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();
