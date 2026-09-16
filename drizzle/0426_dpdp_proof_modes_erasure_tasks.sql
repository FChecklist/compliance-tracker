-- WO-DPDP-005 Sections 1-3: three proof modes (declare/fingerprint/hold,
-- replacing document custody with metadata-only proof by default),
-- erasure-as-coordination (we never touch a client's own systems), and the
-- email-as-interface task/token model.
CREATE TYPE "dpdp"."email_token_action" AS ENUM('yes', 'no', 'sign_in');--> statement-breakpoint
CREATE TYPE "dpdp"."erasure_place_state" AS ENUM('waiting', 'done', 'cannot', 'lawful_hold');--> statement-breakpoint
CREATE TYPE "dpdp"."erasure_place_type" AS ENUM('app', 'folder', 'email', 'paper', 'vendor', 'backup', 'law');--> statement-breakpoint
CREATE TYPE "dpdp"."proof_mode" AS ENUM('declare', 'fingerprint', 'hold');--> statement-breakpoint
CREATE TYPE "dpdp"."storage_state" AS ENUM('never_stored', 'held', 'deleted');--> statement-breakpoint
CREATE TYPE "dpdp"."task_answer" AS ENUM('yes', 'no');--> statement-breakpoint
CREATE TYPE "dpdp"."task_answered_via" AS ENUM('email', 'app');--> statement-breakpoint
CREATE TABLE "dpdp"."email_token" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"identity_id" text NOT NULL,
	"action" "dpdp"."email_token_action" NOT NULL,
	"token_hash" text NOT NULL,
	"issued_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	"used_at" timestamp,
	CONSTRAINT "email_token_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "dpdp"."erasure_answer" (
	"id" text PRIMARY KEY NOT NULL,
	"erasure_id" text NOT NULL,
	"sent_at" timestamp DEFAULT now() NOT NULL,
	"body" text NOT NULL,
	"sent_by" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dpdp"."erasure_place" (
	"id" text PRIMARY KEY NOT NULL,
	"erasure_id" text NOT NULL,
	"data_location_id" text NOT NULL,
	"place_type" "dpdp"."erasure_place_type" NOT NULL,
	"holder_person_id" text,
	"holder_org_id" text,
	"state" "dpdp"."erasure_place_state" DEFAULT 'waiting' NOT NULL,
	"confirmed_by" text,
	"confirmed_at" timestamp,
	"method_note" text,
	"refusal_law" text
);
--> statement-breakpoint
CREATE TABLE "dpdp"."erasure_request" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"rights_request_id" text NOT NULL,
	"received_at" timestamp DEFAULT now() NOT NULL,
	"due_at" timestamp NOT NULL,
	"state" text DEFAULT 'open' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dpdp"."task" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"obligation_id" text NOT NULL,
	"seq" integer NOT NULL,
	"text" text NOT NULL,
	"subtext" text,
	"option_yes" text NOT NULL,
	"option_no" text NOT NULL,
	"answer" "dpdp"."task_answer",
	"answered_by" text,
	"answered_at" timestamp,
	"answered_via" "dpdp"."task_answered_via",
	"token_id" text
);
--> statement-breakpoint
ALTER TABLE "dpdp"."artefact" ADD COLUMN "proof_mode" "dpdp"."proof_mode" DEFAULT 'declare' NOT NULL;--> statement-breakpoint
ALTER TABLE "dpdp"."artefact" ADD COLUMN "storage_state" "dpdp"."storage_state" DEFAULT 'never_stored' NOT NULL;--> statement-breakpoint
ALTER TABLE "dpdp"."artefact" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "dpdp"."artefact" ADD COLUMN "client_location" text;--> statement-breakpoint
ALTER TABLE "dpdp"."artefact" ADD COLUMN "storage_path" text;--> statement-breakpoint
ALTER TABLE "dpdp"."obligation_template" ADD COLUMN "proof_mode" "dpdp"."proof_mode" DEFAULT 'declare' NOT NULL;--> statement-breakpoint

-- WO-005 1: "storage_state='never_stored' must be impossible to pair with
-- a storage path. Enforce with a CHECK constraint" -- the actual database-
-- level guarantee, not app-layer discipline.
ALTER TABLE "dpdp"."artefact" ADD CONSTRAINT "artefact_never_stored_no_path"
  CHECK (storage_state <> 'never_stored' OR storage_path IS NULL);--> statement-breakpoint

-- RLS: org_id-scoped, matching 0415's generic pattern. erasure_place has
-- no org_id of its own (scoped through erasure_id -> erasure_request.org_id),
-- same shape as ai_proposal_line's own subquery policy in 0424.
ALTER TABLE "dpdp"."erasure_request" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON "dpdp"."erasure_request" FOR ALL TO app_runtime USING (org_id = dpdp.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint

ALTER TABLE "dpdp"."erasure_place" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY app_runtime_via_erasure_org ON "dpdp"."erasure_place" FOR ALL TO app_runtime
    USING (EXISTS (SELECT 1 FROM dpdp.erasure_request e WHERE e.id = erasure_id AND e.org_id = dpdp.current_org_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint

ALTER TABLE "dpdp"."erasure_answer" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY app_runtime_via_erasure_org ON "dpdp"."erasure_answer" FOR ALL TO app_runtime
    USING (EXISTS (SELECT 1 FROM dpdp.erasure_request e WHERE e.id = erasure_id AND e.org_id = dpdp.current_org_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint

ALTER TABLE "dpdp"."task" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON "dpdp"."task" FOR ALL TO app_runtime USING (org_id = dpdp.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
-- Answering FROM an email (the whole point of WO-005 3) has no session/org
-- context at all -- mirrors 0420's app_runtime_event_preauth_insert
-- precedent, scoped to UPDATE (answering an existing task) rather than
-- INSERT (tasks are only ever created from within the app, session-gated).
DO $$ BEGIN
  CREATE POLICY app_runtime_preauth_answer ON "dpdp"."task" FOR UPDATE TO app_runtime
    USING (dpdp.current_org_id() IS NULL) WITH CHECK (dpdp.current_org_id() IS NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint

-- email_token has no org_id of its own (scoped through task_id ->
-- task.org_id); the public email-click route needs no context to look
-- itself up and mark itself used, same preauth shape as above.
ALTER TABLE "dpdp"."email_token" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY app_runtime_via_task_org ON "dpdp"."email_token" FOR SELECT TO app_runtime
    USING (EXISTS (SELECT 1 FROM dpdp.task t WHERE t.id = task_id AND t.org_id = dpdp.current_org_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY app_runtime_preauth_insert ON "dpdp"."email_token" FOR INSERT TO app_runtime WITH CHECK (dpdp.current_org_id() IS NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY app_runtime_preauth_use ON "dpdp"."email_token" FOR UPDATE TO app_runtime
    USING (dpdp.current_org_id() IS NULL) WITH CHECK (dpdp.current_org_id() IS NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON
  "dpdp"."erasure_request", "dpdp"."erasure_place", "dpdp"."erasure_answer",
  "dpdp"."task", "dpdp"."email_token"
TO service_role;
