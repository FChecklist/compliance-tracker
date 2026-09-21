-- WO-DPDP-010 (2026-09-21): schema additions for the one-page-per-role
-- product (veridian-dpdp.html spec). Purely additive -- no existing column
-- dropped or retyped, no existing migration edited. Adds:
--   * obligation_template: part/data_set/data_types/law_codes/product/
--     depends_on_key -- the sheet's columns, plus which library (firm vs
--     institution) and escalation-chain wiring a template belongs to.
--   * obligation: depends_on_obligation_id (resolved chain link) +
--     assigned_staff_group_id (group-assigned job, the "All staff"/"All
--     teachers" case).
--   * membership: ca_role (CA firm manager/staff, partner = level='owner'),
--     first_visit_seen_at/said_not_me_at (welcome-state, WO §4).
--   * organisation: set_up_by_membership_id/owner_confirmed_at ("set it up
--     for them" -> owner confirms flow, WO §4).
--   * NEW dpdp.staff_group / dpdp.staff_group_member / dpdp.group_answer
--     enum / dpdp.obligation_group_answer -- per-member private answers to
--     a group job, with History-grade attribution (obligation.progress_done/
--     progress_total, already on the table, remains the UI's running count;
--     this table is who/when/what for each individual answer).
-- The 59-job library content itself (LIB in the spec) is seeded as DATA in
-- a follow-up migration (0602), never hardcoded into app logic, per the
-- WO's own instruction ("the library will be replaced by a lawyer-reviewed
-- version, so make that a data change, not a code change").
CREATE TYPE "dpdp"."group_answer" AS ENUM('done', 'never_had_any', 'cannot');--> statement-breakpoint
CREATE TABLE "dpdp"."obligation_group_answer" (
	"id" text PRIMARY KEY NOT NULL,
	"obligation_id" text NOT NULL,
	"membership_id" text NOT NULL,
	"answer" "dpdp"."group_answer" NOT NULL,
	"answered_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "dpdp_obligation_group_answer_obligation_membership_key" UNIQUE("obligation_id","membership_id")
);
--> statement-breakpoint
CREATE TABLE "dpdp"."staff_group" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"label" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dpdp"."staff_group_member" (
	"id" text PRIMARY KEY NOT NULL,
	"group_id" text NOT NULL,
	"membership_id" text NOT NULL,
	"added_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "dpdp_staff_group_member_group_membership_key" UNIQUE("group_id","membership_id")
);
--> statement-breakpoint
ALTER TABLE "dpdp"."membership" ADD COLUMN "ca_role" text;--> statement-breakpoint
ALTER TABLE "dpdp"."membership" ADD COLUMN "first_visit_seen_at" timestamp;--> statement-breakpoint
ALTER TABLE "dpdp"."membership" ADD COLUMN "said_not_me_at" timestamp;--> statement-breakpoint
ALTER TABLE "dpdp"."obligation" ADD COLUMN "depends_on_obligation_id" text;--> statement-breakpoint
ALTER TABLE "dpdp"."obligation" ADD COLUMN "assigned_staff_group_id" text;--> statement-breakpoint
ALTER TABLE "dpdp"."obligation_template" ADD COLUMN "product" text;--> statement-breakpoint
ALTER TABLE "dpdp"."obligation_template" ADD COLUMN "part" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "dpdp"."obligation_template" ADD COLUMN "data_set" text;--> statement-breakpoint
ALTER TABLE "dpdp"."obligation_template" ADD COLUMN "data_types" text[];--> statement-breakpoint
ALTER TABLE "dpdp"."obligation_template" ADD COLUMN "law_codes" text[];--> statement-breakpoint
ALTER TABLE "dpdp"."obligation_template" ADD COLUMN "depends_on_key" text;--> statement-breakpoint
ALTER TABLE "dpdp"."organisation" ADD COLUMN "set_up_by_membership_id" text;--> statement-breakpoint
ALTER TABLE "dpdp"."organisation" ADD COLUMN "owner_confirmed_at" timestamp;--> statement-breakpoint

-- ─── RLS: staff_group is directly org-scoped, same pattern as every other
-- direct-org_id table (0415). staff_group_member and obligation_group_answer
-- have no org_id column of their own -- scoped via a join, same pattern
-- 0600 used for email_token via task. ─────────────────────────────────────
ALTER TABLE "dpdp"."staff_group" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "dpdp"."staff_group_member" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "dpdp"."obligation_group_answer" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON dpdp.staff_group
    FOR ALL TO app_runtime
    USING (org_id = dpdp.current_org_id())
    WITH CHECK (org_id = dpdp.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint

DO $$ BEGIN
  CREATE POLICY app_runtime_via_group_org ON dpdp.staff_group_member
    FOR ALL TO app_runtime
    USING (EXISTS (SELECT 1 FROM dpdp.staff_group g WHERE g.id = staff_group_member.group_id AND g.org_id = dpdp.current_org_id()))
    WITH CHECK (EXISTS (SELECT 1 FROM dpdp.staff_group g WHERE g.id = staff_group_member.group_id AND g.org_id = dpdp.current_org_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint

DO $$ BEGIN
  CREATE POLICY app_runtime_via_obligation_org ON dpdp.obligation_group_answer
    FOR ALL TO app_runtime
    USING (EXISTS (SELECT 1 FROM dpdp.obligation o WHERE o.id = obligation_group_answer.obligation_id AND o.org_id = dpdp.current_org_id()))
    WITH CHECK (EXISTS (SELECT 1 FROM dpdp.obligation o WHERE o.id = obligation_group_answer.obligation_id AND o.org_id = dpdp.current_org_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint

DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY['staff_group', 'staff_group_member', 'obligation_group_answer'])
  LOOP
    EXECUTE format('CREATE POLICY service_role_bypass ON dpdp.%I FOR ALL TO service_role USING (true)', t);
  END LOOP;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON
  "dpdp"."staff_group", "dpdp"."staff_group_member", "dpdp"."obligation_group_answer"
TO app_runtime;--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON
  "dpdp"."staff_group", "dpdp"."staff_group_member", "dpdp"."obligation_group_answer"
TO service_role;