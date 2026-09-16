-- WO-DPDP-004 Section 5.10 -- "The AI Link", full formal schema
-- (supersedes this session's own earlier, simpler draft, never applied to
-- production -- see schema.ts's own comment on this table).
CREATE TYPE "dpdp"."ai_proposal_state" AS ENUM('pending', 'applied', 'discarded', 'expired');--> statement-breakpoint
CREATE TABLE "dpdp"."ai_link" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"identity_id" text NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	"revoked_at" timestamp,
	CONSTRAINT "ai_link_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "dpdp"."ai_link_read" (
	"id" text PRIMARY KEY NOT NULL,
	"link_id" text NOT NULL,
	"at" timestamp DEFAULT now() NOT NULL,
	"user_agent_family" text,
	"ip_prefix" text
);
--> statement-breakpoint
CREATE TABLE "dpdp"."ai_proposal" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"ref" text NOT NULL,
	"source_label" text NOT NULL,
	"arrived_at" timestamp DEFAULT now() NOT NULL,
	"raw" text NOT NULL,
	"state" "dpdp"."ai_proposal_state" DEFAULT 'pending' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dpdp"."ai_proposal_line" (
	"id" text PRIMARY KEY NOT NULL,
	"proposal_id" text NOT NULL,
	"seq" integer NOT NULL,
	"verb" text NOT NULL,
	"target_key" text NOT NULL,
	"payload" jsonb,
	"allowed" boolean NOT NULL,
	"refusal_reason" text,
	"approved" boolean DEFAULT false NOT NULL,
	"applied_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "dpdp"."ai_link" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY app_runtime_own_org ON "dpdp"."ai_link" FOR ALL TO app_runtime USING (org_id = dpdp.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
-- The public token-lookup route (GET /api/dpdp/ai/[token]) has no tenant
-- context at all by design -- same no-context preauth shape as
-- 0420's app_runtime_event_preauth_insert.
DO $$ BEGIN
  CREATE POLICY app_runtime_preauth_lookup ON "dpdp"."ai_link" FOR SELECT TO app_runtime USING (dpdp.current_org_id() IS NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint

-- ai_link_read has no org_id of its own (scoped through link_id ->
-- ai_link.org_id) -- RLS via a subquery, and the preauth INSERT (the
-- public route logging its own read) needs no context either.
ALTER TABLE "dpdp"."ai_link_read" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY app_runtime_via_link_org ON "dpdp"."ai_link_read" FOR SELECT TO app_runtime
    USING (EXISTS (SELECT 1 FROM dpdp.ai_link l WHERE l.id = link_id AND l.org_id = dpdp.current_org_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY app_runtime_preauth_log_read ON "dpdp"."ai_link_read" FOR INSERT TO app_runtime WITH CHECK (dpdp.current_org_id() IS NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint

ALTER TABLE "dpdp"."ai_proposal" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON "dpdp"."ai_proposal" FOR ALL TO app_runtime USING (org_id = dpdp.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint

ALTER TABLE "dpdp"."ai_proposal_line" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY app_runtime_via_proposal_org ON "dpdp"."ai_proposal_line" FOR ALL TO app_runtime
    USING (EXISTS (SELECT 1 FROM dpdp.ai_proposal p WHERE p.id = proposal_id AND p.org_id = dpdp.current_org_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON
  "dpdp"."ai_link", "dpdp"."ai_link_read", "dpdp"."ai_proposal", "dpdp"."ai_proposal_line"
TO service_role;
