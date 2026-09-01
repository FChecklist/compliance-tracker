-- R42 seq20: M28 screen registry + M29 draft lifecycle, S1.
-- Verified live before writing (information_schema/pg_type): neither table
-- nor the screen_archetype enum exist yet.

CREATE TYPE "compliance"."screen_archetype" AS ENUM('LIST', 'OBJECT', 'FORM', 'DASHBOARD', 'REPORT', 'TIMELINE', 'COMPARE', 'CUSTOM');

CREATE TABLE "compliance"."screen_definitions" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text,
	"function_id" text NOT NULL,
	"archetype" "compliance"."screen_archetype" NOT NULL,
	"custom_component" text,
	"data_source" text NOT NULL,
	"columns" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"filters" jsonb,
	"actions" jsonb,
	"drill_to" text,
	"breadcrumb_template" text,
	"flow_parent" text,
	"flow_children" jsonb,
	"create_with_reference" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "compliance"."screen_drafts" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"user_id" text NOT NULL,
	"function_id" text NOT NULL,
	"object_id" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"lock_expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

-- *** THE "never two drafts on one entity" RULE, ENFORCED IN THE DATABASE
-- (M29), NOT IN CODE *** -- a partial unique index so multiple CREATE-mode
-- drafts (object_id IS NULL) on the same function are still allowed (two
-- different users independently starting a new Permit, say), but only one
-- draft may ever exist per real object_id.
CREATE UNIQUE INDEX screen_drafts_function_object_unique
  ON "compliance"."screen_drafts" ("function_id", "object_id")
  WHERE "object_id" IS NOT NULL;

CREATE INDEX screen_definitions_function_org_idx ON "compliance"."screen_definitions" ("function_id", "org_id");
CREATE INDEX screen_drafts_org_user_idx ON "compliance"."screen_drafts" ("org_id", "user_id");

-- *** M30/SAP's OWN RULE, ENFORCED IN THE DATABASE: field_status=SUPPRESSED
-- cannot combine with required=true ("this combination is an error"). The
-- rule lives INSIDE the columns jsonb array (one element per field), so a
-- plain scalar-column CHECK can't express it directly -- CHECK constraints
-- may not contain subqueries, even ones that only touch the row's own
-- column. jsonb array containment (@>) has no such restriction: verified
-- live before writing this (not assumed) --
--   '[{"field_status":"SUPPRESSED","required":true},{"other":1}]'::jsonb
--     @> '[{"field_status":"SUPPRESSED","required":true}]'::jsonb  -> true
--   '[{"field_status":"SUPPRESSED","required":false}]'::jsonb
--     @> '[{"field_status":"SUPPRESSED","required":true}]'::jsonb  -> false
-- so NOT (columns @> '[{"field_status":"SUPPRESSED","required":true}]') is
-- true exactly when no column element has that forbidden combination.
ALTER TABLE "compliance"."screen_definitions"
  ADD CONSTRAINT screen_definitions_no_suppressed_required
  CHECK (NOT (columns @> '[{"field_status":"SUPPRESSED","required":true}]'::jsonb));

ALTER TABLE "compliance"."screen_definitions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "compliance"."screen_drafts" ENABLE ROW LEVEL SECURITY;
-- screen_definitions has org_id NULL for global rows -- app_runtime may read
-- its own org's rows AND every global row; only service_role may write
-- (the registry is edited by a human/L3 action, not runtime app code).
DO $$ BEGIN CREATE POLICY app_runtime_read_own_org_or_global ON "compliance"."screen_definitions" FOR SELECT TO app_runtime USING (org_id = compliance.current_org_id() OR org_id IS NULL); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY service_role_bypass_screen_definitions ON "compliance"."screen_definitions" FOR ALL TO service_role USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY app_runtime_tenant_isolation ON "compliance"."screen_drafts" FOR ALL TO app_runtime USING (org_id = compliance.current_org_id()); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY service_role_bypass_screen_drafts ON "compliance"."screen_drafts" FOR ALL TO service_role USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
