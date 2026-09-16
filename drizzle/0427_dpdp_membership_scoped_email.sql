-- WO-DPDP-007 Sections 2 and 4: inbound message routing, digest-send caps,
-- independence conflict blocking, and membership-scoped email tokens.
CREATE TYPE "dpdp"."digest_format" AS ENUM('single', 'batched');--> statement-breakpoint
CREATE TABLE "dpdp"."digest_send" (
	"id" text PRIMARY KEY NOT NULL,
	"identity_id" text NOT NULL,
	"sent_at" timestamp DEFAULT now() NOT NULL,
	"membership_ids" text[] NOT NULL,
	"format" "dpdp"."digest_format" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dpdp"."inbound_message" (
	"id" text PRIMARY KEY NOT NULL,
	"membership_id" text,
	"task_id" text,
	"received_at" timestamp DEFAULT now() NOT NULL,
	"from_address" text NOT NULL,
	"body_stripped" text,
	"raw_retained_until" timestamp,
	"action_taken" text,
	"discarded_reason" text
);
--> statement-breakpoint
CREATE TABLE "dpdp"."independence_block" (
	"id" text PRIMARY KEY NOT NULL,
	"membership_id" text NOT NULL,
	"target_org_id" text NOT NULL,
	"attempted_at" timestamp DEFAULT now() NOT NULL,
	"action" text NOT NULL,
	"reason" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dpdp"."email_token" ADD COLUMN "membership_id" text NOT NULL;--> statement-breakpoint

-- WO-007 4.3: "the token is the enforcement, not a check" -- a trigger,
-- not a service-layer if-statement, so a future insert path that forgets
-- to check this still cannot create a cross-organisation token.
--
-- SET search_path pins name resolution the same way 0416/0425 already do
-- for this schema's other functions -- found live (2026-09-16, Supabase's
-- own security advisor, function_search_path_mutable) that this one was
-- the sole exception. Without it, this plpgsql function resolves dpdp.task/
-- dpdp.membership via whatever search_path is active at call time rather
-- than a pinned one, which is exactly the class of risk a trigger firing on
-- every email_token insert should not carry, defense-in-depth regardless of
-- SECURITY INVOKER vs DEFINER.
CREATE OR REPLACE FUNCTION dpdp.email_token_membership_matches_task_org() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = 'dpdp', 'pg_temp' AS $$
DECLARE
  task_org text;
  member_org text;
BEGIN
  SELECT org_id INTO task_org FROM dpdp.task WHERE id = NEW.task_id;
  SELECT org_id INTO member_org FROM dpdp.membership WHERE id = NEW.membership_id;
  IF task_org IS NULL OR member_org IS NULL OR task_org <> member_org THEN
    RAISE EXCEPTION 'dpdp.email_token: membership % does not belong to task %''s organisation (WO-DPDP-007 4.3)', NEW.membership_id, NEW.task_id;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER dpdp_email_token_membership_scope
  BEFORE INSERT ON dpdp.email_token
  FOR EACH ROW EXECUTE FUNCTION dpdp.email_token_membership_matches_task_org();--> statement-breakpoint

-- RLS, matching established patterns. inbound_message/digest_send/
-- independence_block have no org_id of their own -- scoped through
-- membership_id -> membership.org_id (a subquery policy, same shape as
-- ai_proposal_line/erasure_place before it).
ALTER TABLE "dpdp"."inbound_message" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY app_runtime_via_membership_org ON "dpdp"."inbound_message" FOR SELECT TO app_runtime
    USING (membership_id IS NOT NULL AND EXISTS (SELECT 1 FROM dpdp.membership m WHERE m.id = membership_id AND m.org_id = dpdp.current_org_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
-- The inbound webhook itself has no session/org context -- preauth insert,
-- same shape as every other no-context write path in this schema.
DO $$ BEGIN
  CREATE POLICY app_runtime_preauth_insert ON "dpdp"."inbound_message" FOR INSERT TO app_runtime WITH CHECK (dpdp.current_org_id() IS NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint

ALTER TABLE "dpdp"."digest_send" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
-- digest_send has no org_id at all (it's identity-scoped, spanning
-- however many orgs that identity belongs to) -- readable by app_runtime
-- only through a context-free preauth path (the digest job itself runs
-- with no single org's context, by design) until a real per-identity
-- read surface is built; flagged, not over-engineered speculatively.
DO $$ BEGIN
  CREATE POLICY app_runtime_preauth_all ON "dpdp"."digest_send" FOR ALL TO app_runtime USING (dpdp.current_org_id() IS NULL) WITH CHECK (dpdp.current_org_id() IS NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint

ALTER TABLE "dpdp"."independence_block" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY app_runtime_via_target_org ON "dpdp"."independence_block" FOR ALL TO app_runtime USING (target_org_id = dpdp.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON
  "dpdp"."digest_send", "dpdp"."inbound_message", "dpdp"."independence_block"
TO service_role;
