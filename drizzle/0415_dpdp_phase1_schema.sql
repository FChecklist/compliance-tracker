CREATE SCHEMA "dpdp";
CREATE TYPE "dpdp"."answerable_by" AS ENUM('internal', 'processor', 'either');--> statement-breakpoint
CREATE TYPE "dpdp"."appointment_mode" AS ENUM('board_resolution', 'office_order', 'outsourced');--> statement-breakpoint
CREATE TYPE "dpdp"."artefact_lifecycle_state" AS ENUM('TRANSIENT', 'CANDIDATE', 'CONFIRMED', 'ACTIVE', 'SUPERSEDED', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "dpdp"."capability" AS ENUM('advisor', 'fiduciary', 'processor', 'auditor');--> statement-breakpoint
CREATE TYPE "dpdp"."holder_kind" AS ENUM('internal_person', 'processor_org');--> statement-breakpoint
CREATE TYPE "dpdp"."joined_via" AS ENUM('created', 'invited', 'code', 'named_in_role', 'domain');--> statement-breakpoint
CREATE TYPE "dpdp"."location_state" AS ENUM('unknown', 'asked', 'confirmed', 'blocked_no_agreement');--> statement-breakpoint
CREATE TYPE "dpdp"."membership_level" AS ENUM('owner', 'staff');--> statement-breakpoint
CREATE TYPE "dpdp"."membership_state" AS ENUM('active', 'pending', 'revoked');--> statement-breakpoint
CREATE TYPE "dpdp"."proof_kind" AS ENUM('doc', 'photo', 'declaration');--> statement-breakpoint
CREATE TYPE "dpdp"."referral_outcome" AS ENUM('signed_up', 'chose_band', 'free_only', 'blocked');--> statement-breakpoint
CREATE TYPE "dpdp"."relationship_kind" AS ENUM('advises', 'processes_for', 'audits', 'adjudicates');--> statement-breakpoint
CREATE TYPE "dpdp"."verified_via" AS ENUM('domain', 'gst', 'cin', 'document');--> statement-breakpoint
CREATE TABLE "dpdp"."access_log" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"actor_label" text NOT NULL,
	"what" text NOT NULL,
	"basis" text NOT NULL,
	"touched_personal_data" boolean DEFAULT false NOT NULL,
	"at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dpdp"."artefact" (
	"id" text PRIMARY KEY NOT NULL,
	"obligation_id" text NOT NULL,
	"org_id" text NOT NULL,
	"filename" text NOT NULL,
	"mime" text,
	"size_bytes" integer,
	"sha256" text,
	"t_activity" timestamp,
	"t_document_stated" timestamp,
	"t_exif" timestamp,
	"t_file_modified" timestamp,
	"t_uploaded" timestamp DEFAULT now() NOT NULL,
	"t_submitted" timestamp,
	"t_accepted" timestamp,
	"effective_from" timestamp DEFAULT now() NOT NULL,
	"effective_to" timestamp,
	"superseded_by_id" text,
	"lifecycle_state" "dpdp"."artefact_lifecycle_state" DEFAULT 'TRANSIENT' NOT NULL,
	"device" text,
	"geo" text,
	"uploaded_by" text,
	"accepted_by" text,
	"redacted_at" timestamp,
	"redacted_by" text,
	"redaction_reason" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dpdp"."artefact_flag" (
	"id" text PRIMARY KEY NOT NULL,
	"artefact_id" text NOT NULL,
	"kind" text NOT NULL,
	"detail" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dpdp"."band" (
	"key" text PRIMARY KEY NOT NULL,
	"floor" integer NOT NULL,
	"ceiling" integer,
	"annual_paise" integer,
	"is_ngo_half" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dpdp"."breach" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"became_aware_at" timestamp DEFAULT now() NOT NULL,
	"deadline_at" timestamp NOT NULL,
	"scope_person_count" integer,
	"board_notified_at" timestamp,
	"individuals_notified_at" timestamp,
	"state" text DEFAULT 'open' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dpdp"."consent_campaign" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"group_id" text NOT NULL,
	"notice_version_id" text NOT NULL,
	"sent_at" timestamp,
	"channel" text DEFAULT 'email' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dpdp"."consent_record" (
	"id" text PRIMARY KEY NOT NULL,
	"token_id" text NOT NULL,
	"purpose_key" text NOT NULL,
	"granted" boolean NOT NULL,
	"notice_version_id" text NOT NULL,
	"language" text DEFAULT 'en' NOT NULL,
	"recorded_at" timestamp DEFAULT now() NOT NULL,
	"withdrawn_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "dpdp"."consent_token" (
	"id" text PRIMARY KEY NOT NULL,
	"campaign_id" text NOT NULL,
	"token" text NOT NULL,
	"contact_hash" text NOT NULL,
	"opened_at" timestamp,
	"acted_at" timestamp,
	"expires_at" timestamp NOT NULL,
	CONSTRAINT "consent_token_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "dpdp"."daily_seal" (
	"seal_date" date PRIMARY KEY NOT NULL,
	"head_hash" text NOT NULL,
	"entry_count" integer NOT NULL,
	"written_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dpdp"."data_category" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"category" text NOT NULL,
	"subject_group" text,
	"is_children_data" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dpdp"."data_location" (
	"id" text PRIMARY KEY NOT NULL,
	"category_id" text NOT NULL,
	"system_name" text,
	"path_text" text,
	"physical_location" text,
	"holder_kind" "dpdp"."holder_kind" NOT NULL,
	"holder_person_id" text,
	"holder_org_id" text,
	"state" "dpdp"."location_state" DEFAULT 'unknown' NOT NULL,
	"confirmed_by" text,
	"confirmed_at" timestamp,
	"asked_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "dpdp"."event" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"actor_identity_id" text,
	"actor_label" text NOT NULL,
	"kind" text NOT NULL,
	"summary" text NOT NULL,
	"detail" text,
	"route" text,
	"device" text,
	"occurred_at" timestamp DEFAULT now() NOT NULL,
	"prev_hash" text,
	"hash" text NOT NULL,
	"sealed_in_batch" text
);
--> statement-breakpoint
CREATE TABLE "dpdp"."exposure_estimate" (
	"org_id" text PRIMARY KEY NOT NULL,
	"employees" integer DEFAULT 0 NOT NULL,
	"customers" integer DEFAULT 0 NOT NULL,
	"applicants" integer DEFAULT 0 NOT NULL,
	"cctv_monthly" integer DEFAULT 0 NOT NULL,
	"other" integer DEFAULT 0 NOT NULL,
	"vendor_count" integer DEFAULT 0 NOT NULL,
	"vendor_staff_each" integer DEFAULT 0 NOT NULL,
	"advisor_count" integer DEFAULT 0 NOT NULL,
	"computed_total" integer DEFAULT 0 NOT NULL,
	"band" text
);
--> statement-breakpoint
CREATE TABLE "dpdp"."grievance" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"ref" text NOT NULL,
	"summary" text NOT NULL,
	"tier" smallint DEFAULT 1 NOT NULL,
	"officer_due_at" timestamp NOT NULL,
	"reviewer_due_at" timestamp,
	"state" text DEFAULT 'open' NOT NULL,
	"officer_decision" text,
	"reviewer_determination" text,
	"reviewer_identity_id" text,
	CONSTRAINT "grievance_ref_unique" UNIQUE("ref")
);
--> statement-breakpoint
CREATE TABLE "dpdp"."grievance_officer" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"person_name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"address" text,
	"appointment_mode" "dpdp"."appointment_mode" NOT NULL,
	"resolution_ref" text,
	"resolution_text" text,
	"signatories" text[],
	"published_since" timestamp DEFAULT now() NOT NULL,
	"superseded_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "dpdp"."identity" (
	"id" text PRIMARY KEY NOT NULL,
	"primary_email" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_seen_at" timestamp,
	CONSTRAINT "identity_primary_email_unique" UNIQUE("primary_email")
);
--> statement-breakpoint
CREATE TABLE "dpdp"."identity_email" (
	"id" text PRIMARY KEY NOT NULL,
	"identity_id" text NOT NULL,
	"email" text NOT NULL,
	"verified_at" timestamp,
	"is_primary" boolean DEFAULT false NOT NULL,
	CONSTRAINT "identity_email_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "dpdp"."library_version" (
	"id" text PRIMARY KEY NOT NULL,
	"version" text NOT NULL,
	"released_on" date NOT NULL,
	"changelog" text,
	"is_current" boolean DEFAULT false NOT NULL,
	CONSTRAINT "library_version_version_unique" UNIQUE("version")
);
--> statement-breakpoint
CREATE TABLE "dpdp"."membership" (
	"id" text PRIMARY KEY NOT NULL,
	"identity_id" text NOT NULL,
	"org_id" text NOT NULL,
	"level" "dpdp"."membership_level" NOT NULL,
	"can_sign" boolean DEFAULT false NOT NULL,
	"state" "dpdp"."membership_state" DEFAULT 'active' NOT NULL,
	"joined_via" "dpdp"."joined_via" NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"revoked_at" timestamp,
	CONSTRAINT "dpdp_membership_identity_org_key" UNIQUE("identity_id","org_id")
);
--> statement-breakpoint
CREATE TABLE "dpdp"."notice_version" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"doc_kind" text NOT NULL,
	"version" text NOT NULL,
	"released_on" date NOT NULL,
	"effective_from" timestamp NOT NULL,
	"effective_to" timestamp,
	"languages" text[],
	"approved_by" text,
	"state" text DEFAULT 'draft' NOT NULL,
	CONSTRAINT "dpdp_notice_version_org_kind_version_key" UNIQUE("org_id","doc_kind","version")
);
--> statement-breakpoint
CREATE TABLE "dpdp"."obligation" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"template_id" text NOT NULL,
	"library_version_used" text NOT NULL,
	"assigned_person_id" text,
	"assigned_processor_org_id" text,
	"due_on" date NOT NULL,
	"state" text DEFAULT 'open' NOT NULL,
	"progress_done" integer DEFAULT 0 NOT NULL,
	"progress_total" integer DEFAULT 1 NOT NULL,
	"na_reason" text,
	"closed_at" timestamp,
	"closed_by" text
);
--> statement-breakpoint
CREATE TABLE "dpdp"."obligation_template" (
	"id" text PRIMARY KEY NOT NULL,
	"library_version_id" text NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"plain_text" text NOT NULL,
	"section_ref" text,
	"proof_kind" "dpdp"."proof_kind" NOT NULL,
	"default_days" integer NOT NULL,
	"recurrence" text DEFAULT 'none' NOT NULL,
	"proof_expiry_days" integer,
	"answerable_by" "dpdp"."answerable_by" NOT NULL,
	"role_tag" text,
	"applies_when" jsonb,
	"feeds_documents" text[],
	CONSTRAINT "dpdp_obligation_template_version_key_key" UNIQUE("library_version_id","key")
);
--> statement-breakpoint
CREATE TABLE "dpdp"."org_capability" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"capability" "dpdp"."capability" NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "dpdp_org_capability_org_capability_key" UNIQUE("org_id","capability")
);
--> statement-breakpoint
CREATE TABLE "dpdp"."organisation" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"sector" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "organisation_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "dpdp"."partner" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"kind" text NOT NULL,
	"describes_self" text,
	"code" text NOT NULL,
	"attribution_days" integer DEFAULT 90 NOT NULL,
	"state" text DEFAULT 'active' NOT NULL,
	CONSTRAINT "partner_email_unique" UNIQUE("email"),
	CONSTRAINT "partner_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "dpdp"."principal_group" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"label" text NOT NULL,
	"est_count" integer
);
--> statement-breakpoint
CREATE TABLE "dpdp"."public_page" (
	"org_id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"is_live" boolean DEFAULT false NOT NULL,
	"verified_via" "dpdp"."verified_via",
	"last_generated_at" timestamp,
	CONSTRAINT "public_page_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "dpdp"."referral" (
	"identity_id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"consented_at" timestamp,
	"state" text DEFAULT 'active' NOT NULL,
	CONSTRAINT "referral_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "dpdp"."referral_event" (
	"id" text PRIMARY KEY NOT NULL,
	"referral_id" text NOT NULL,
	"referred_org_id" text NOT NULL,
	"at" timestamp DEFAULT now() NOT NULL,
	"outcome" "dpdp"."referral_outcome" NOT NULL,
	"block_reason" text,
	"credit_months" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dpdp"."relationship" (
	"id" text PRIMARY KEY NOT NULL,
	"from_org" text NOT NULL,
	"to_org" text NOT NULL,
	"kind" "dpdp"."relationship_kind" NOT NULL,
	"agreement_signed_at" timestamp,
	"scope" text,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"ended_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "dpdp"."rights_request" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"ref" text NOT NULL,
	"kind" text NOT NULL,
	"arrived_via" text NOT NULL,
	"received_at" timestamp DEFAULT now() NOT NULL,
	"due_at" timestamp NOT NULL,
	"state" text DEFAULT 'open' NOT NULL,
	"answered_at" timestamp,
	"answer_text" text,
	CONSTRAINT "rights_request_ref_unique" UNIQUE("ref")
);
--> statement-breakpoint
CREATE TABLE "dpdp"."subscription" (
	"org_id" text PRIMARY KEY NOT NULL,
	"band_key" text,
	"seats_used" integer DEFAULT 0 NOT NULL,
	"trial_ends_at" timestamp,
	"state" text DEFAULT 'trial' NOT NULL
);
--> statement-breakpoint
--> statement-breakpoint
-- ═══════════════════════════════════════════════════════════════════════
-- WO-DPDP-001 Phase 1, hand-authored additions below this line.
-- Everything above this line is drizzle-kit-generated DDL (CREATE SCHEMA /
-- CREATE TYPE / CREATE TABLE), extracted from the raw `db:generate` output
-- for this migration -- that raw output also contained ~380 lines of
-- unrelated CREATE TABLE/CREATE TYPE statements for tables that ALREADY
-- EXIST live (confirmed via information_schema before this file was
-- finalized: compliance.billing_contracts, platform.dispatch_outcomes,
-- compliance.hr_employee_loans, compliance.crm_pipeline_stages, and more).
-- That's drizzle/meta/_journal.json's pre-existing lag (documented in
-- CLAUDE.md) surfacing as diff noise, not new work -- applying it here
-- would have re-issued CREATE TABLE against tables that already exist and
-- would have bundled unrelated, unreviewed schema drift into a DPDP
-- migration. Removed; not this migration's problem to fix.
-- ═══════════════════════════════════════════════════════════════════════

-- ─── Foreign keys (fresh schema, safe to add inline -- no existing rows) ──
ALTER TABLE "dpdp"."org_capability" ADD CONSTRAINT "dpdp_org_capability_org_id_organisation_id_fk" FOREIGN KEY ("org_id") REFERENCES "dpdp"."organisation"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "dpdp"."identity_email" ADD CONSTRAINT "dpdp_identity_email_identity_id_identity_id_fk" FOREIGN KEY ("identity_id") REFERENCES "dpdp"."identity"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "dpdp"."membership" ADD CONSTRAINT "dpdp_membership_identity_id_identity_id_fk" FOREIGN KEY ("identity_id") REFERENCES "dpdp"."identity"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "dpdp"."membership" ADD CONSTRAINT "dpdp_membership_org_id_organisation_id_fk" FOREIGN KEY ("org_id") REFERENCES "dpdp"."organisation"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "dpdp"."relationship" ADD CONSTRAINT "dpdp_relationship_from_org_organisation_id_fk" FOREIGN KEY ("from_org") REFERENCES "dpdp"."organisation"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "dpdp"."relationship" ADD CONSTRAINT "dpdp_relationship_to_org_organisation_id_fk" FOREIGN KEY ("to_org") REFERENCES "dpdp"."organisation"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "dpdp"."data_category" ADD CONSTRAINT "dpdp_data_category_org_id_organisation_id_fk" FOREIGN KEY ("org_id") REFERENCES "dpdp"."organisation"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "dpdp"."data_location" ADD CONSTRAINT "dpdp_data_location_category_id_data_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "dpdp"."data_category"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "dpdp"."obligation_template" ADD CONSTRAINT "dpdp_obligation_template_library_version_id_library_version_id_fk" FOREIGN KEY ("library_version_id") REFERENCES "dpdp"."library_version"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "dpdp"."obligation" ADD CONSTRAINT "dpdp_obligation_org_id_organisation_id_fk" FOREIGN KEY ("org_id") REFERENCES "dpdp"."organisation"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "dpdp"."obligation" ADD CONSTRAINT "dpdp_obligation_template_id_obligation_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "dpdp"."obligation_template"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "dpdp"."artefact" ADD CONSTRAINT "dpdp_artefact_obligation_id_obligation_id_fk" FOREIGN KEY ("obligation_id") REFERENCES "dpdp"."obligation"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "dpdp"."artefact" ADD CONSTRAINT "dpdp_artefact_org_id_organisation_id_fk" FOREIGN KEY ("org_id") REFERENCES "dpdp"."organisation"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "dpdp"."artefact" ADD CONSTRAINT "dpdp_artefact_superseded_by_id_artefact_id_fk" FOREIGN KEY ("superseded_by_id") REFERENCES "dpdp"."artefact"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "dpdp"."artefact_flag" ADD CONSTRAINT "dpdp_artefact_flag_artefact_id_artefact_id_fk" FOREIGN KEY ("artefact_id") REFERENCES "dpdp"."artefact"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "dpdp"."principal_group" ADD CONSTRAINT "dpdp_principal_group_org_id_organisation_id_fk" FOREIGN KEY ("org_id") REFERENCES "dpdp"."organisation"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "dpdp"."notice_version" ADD CONSTRAINT "dpdp_notice_version_org_id_organisation_id_fk" FOREIGN KEY ("org_id") REFERENCES "dpdp"."organisation"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "dpdp"."consent_campaign" ADD CONSTRAINT "dpdp_consent_campaign_org_id_organisation_id_fk" FOREIGN KEY ("org_id") REFERENCES "dpdp"."organisation"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "dpdp"."consent_campaign" ADD CONSTRAINT "dpdp_consent_campaign_group_id_principal_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "dpdp"."principal_group"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "dpdp"."consent_campaign" ADD CONSTRAINT "dpdp_consent_campaign_notice_version_id_notice_version_id_fk" FOREIGN KEY ("notice_version_id") REFERENCES "dpdp"."notice_version"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "dpdp"."consent_token" ADD CONSTRAINT "dpdp_consent_token_campaign_id_consent_campaign_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "dpdp"."consent_campaign"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "dpdp"."consent_record" ADD CONSTRAINT "dpdp_consent_record_token_id_consent_token_id_fk" FOREIGN KEY ("token_id") REFERENCES "dpdp"."consent_token"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "dpdp"."consent_record" ADD CONSTRAINT "dpdp_consent_record_notice_version_id_notice_version_id_fk" FOREIGN KEY ("notice_version_id") REFERENCES "dpdp"."notice_version"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "dpdp"."rights_request" ADD CONSTRAINT "dpdp_rights_request_org_id_organisation_id_fk" FOREIGN KEY ("org_id") REFERENCES "dpdp"."organisation"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "dpdp"."grievance" ADD CONSTRAINT "dpdp_grievance_org_id_organisation_id_fk" FOREIGN KEY ("org_id") REFERENCES "dpdp"."organisation"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "dpdp"."grievance_officer" ADD CONSTRAINT "dpdp_grievance_officer_org_id_organisation_id_fk" FOREIGN KEY ("org_id") REFERENCES "dpdp"."organisation"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "dpdp"."public_page" ADD CONSTRAINT "dpdp_public_page_org_id_organisation_id_fk" FOREIGN KEY ("org_id") REFERENCES "dpdp"."organisation"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "dpdp"."breach" ADD CONSTRAINT "dpdp_breach_org_id_organisation_id_fk" FOREIGN KEY ("org_id") REFERENCES "dpdp"."organisation"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "dpdp"."event" ADD CONSTRAINT "dpdp_event_org_id_organisation_id_fk" FOREIGN KEY ("org_id") REFERENCES "dpdp"."organisation"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "dpdp"."access_log" ADD CONSTRAINT "dpdp_access_log_org_id_organisation_id_fk" FOREIGN KEY ("org_id") REFERENCES "dpdp"."organisation"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "dpdp"."exposure_estimate" ADD CONSTRAINT "dpdp_exposure_estimate_org_id_organisation_id_fk" FOREIGN KEY ("org_id") REFERENCES "dpdp"."organisation"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "dpdp"."subscription" ADD CONSTRAINT "dpdp_subscription_org_id_organisation_id_fk" FOREIGN KEY ("org_id") REFERENCES "dpdp"."organisation"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "dpdp"."subscription" ADD CONSTRAINT "dpdp_subscription_band_key_band_key_fk" FOREIGN KEY ("band_key") REFERENCES "dpdp"."band"("key") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "dpdp"."referral_event" ADD CONSTRAINT "dpdp_referral_event_referral_id_referral_identity_id_fk" FOREIGN KEY ("referral_id") REFERENCES "dpdp"."referral"("identity_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "dpdp"."referral_event" ADD CONSTRAINT "dpdp_referral_event_referred_org_id_organisation_id_fk" FOREIGN KEY ("referred_org_id") REFERENCES "dpdp"."organisation"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "dpdp"."referral" ADD CONSTRAINT "dpdp_referral_identity_id_identity_id_fk" FOREIGN KEY ("identity_id") REFERENCES "dpdp"."identity"("id") ON DELETE CASCADE;--> statement-breakpoint

-- ─── D1/D2/D3/D4: IMG-001/002/003/004 on dpdp.artefact ─────────────────
-- IMG-003: SUPERSEDED requires a non-null superseded_by_id.
ALTER TABLE "dpdp"."artefact" ADD CONSTRAINT "dpdp_artefact_superseded_requires_pointer"
  CHECK (lifecycle_state <> 'SUPERSEDED' OR superseded_by_id IS NOT NULL);--> statement-breakpoint

-- IMG-001: append-only, enforced by GRANT shape, not a trigger -- app_runtime
-- gets UPDATE on only the columns a lifecycle transition or a lawyer-
-- reviewed redaction (IMG-004, B4 -- still unwritten, see schema.ts comment)
-- is allowed to touch. Every other column, including every t_* timestamp,
-- filename, sha256, has no UPDATE grant at all: an attempt to change them
-- fails with a Postgres permission error (D2's required "failing UPDATE,
-- error text"), not an app-level check that a raw query could bypass.
GRANT SELECT, INSERT ON "dpdp"."artefact" TO app_runtime;--> statement-breakpoint
GRANT UPDATE (effective_to, superseded_by_id, lifecycle_state, redacted_at, redacted_by, redaction_reason, updated_at) ON "dpdp"."artefact" TO app_runtime;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "dpdp"."artefact" TO service_role;--> statement-breakpoint

-- ─── 4.1 constraints "enforced in the database, not the app" ───────────
-- Every organisation gets a 'fiduciary' capability row automatically.
CREATE OR REPLACE FUNCTION dpdp.auto_fiduciary_capability() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO dpdp.org_capability (id, org_id, capability)
  VALUES (gen_random_uuid()::text, NEW.id, 'fiduciary')
  ON CONFLICT (org_id, capability) DO NOTHING;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER dpdp_organisation_auto_fiduciary
  AFTER INSERT ON dpdp.organisation
  FOR EACH ROW EXECUTE FUNCTION dpdp.auto_fiduciary_capability();--> statement-breakpoint

-- can_sign is never set at join time -- only by a later explicit act.
CREATE OR REPLACE FUNCTION dpdp.membership_no_sign_at_join() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.can_sign THEN
    RAISE EXCEPTION 'dpdp.membership: can_sign cannot be set to true on INSERT -- it is granted by a later, separate act (WO-DPDP-001 4.1)';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER dpdp_membership_no_sign_at_join
  BEFORE INSERT ON dpdp.membership
  FOR EACH ROW EXECUTE FUNCTION dpdp.membership_no_sign_at_join();--> statement-breakpoint

-- processes_for / audits cannot be self-declared: the inserting session's
-- org (dpdp.current_org_id(), set by withDpdpContext) must be to_org -- the
-- party being processed-for/audited is the one asserting the relationship,
-- never the processor/auditor unilaterally claiming it. Only enforced when
-- a session context is actually set (current_org_id() IS NOT NULL), so a
-- service_role-run seed/import script is unaffected -- see this migration's
-- own note on withDpdpContext for the known limitation this leaves open.
CREATE OR REPLACE FUNCTION dpdp.relationship_no_self_declare() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  acting_org text := dpdp.current_org_id();
BEGIN
  IF acting_org IS NOT NULL AND NEW.kind IN ('processes_for', 'audits') AND NEW.to_org <> acting_org THEN
    RAISE EXCEPTION 'dpdp.relationship: a % relationship must be asserted by to_org (%), not by from_org (WO-DPDP-001 4.1)', NEW.kind, NEW.to_org;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER dpdp_relationship_no_self_declare
  BEFORE INSERT ON dpdp.relationship
  FOR EACH ROW EXECUTE FUNCTION dpdp.relationship_no_self_declare();--> statement-breakpoint

-- ─── 4.9 RLS: tenant isolation by org_id, current_org_id() reads the GUC
-- withDpdpContext sets (app.dpdp_org_id) -- same shape as
-- compliance.current_org_id() / app.current_org_id, deliberately a
-- SEPARATE function and GUC name per Amendment A1 ("separate RLS
-- policies"), not a reuse of the compliance one. ─────────────────────────
CREATE OR REPLACE FUNCTION dpdp.current_org_id() RETURNS text
  LANGUAGE sql STABLE
  SET search_path TO 'dpdp', 'pg_temp'
AS $function$
  SELECT NULLIF(current_setting('app.dpdp_org_id', true), '')
$function$;--> statement-breakpoint

-- dpdp.organisation itself: visible to the org's own session, plus any org
-- with an active relationship to it in either direction (advisor sees its
-- clients, client sees its advisor/processors/auditors, processor/auditor
-- see who they serve) -- "walled off from each other" (work order 4.9) is
-- satisfied because this is scoped to the CURRENT session's own org, not a
-- global list: a processor serving 5 clients gets 5 separate query results,
-- never a join across them.
ALTER TABLE "dpdp"."organisation" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY app_runtime_visible_orgs ON "dpdp"."organisation" FOR ALL TO app_runtime
    USING (
      id = dpdp.current_org_id()
      OR EXISTS (
        SELECT 1 FROM dpdp.relationship r
        WHERE r.from_org = dpdp.current_org_id() AND r.to_org = organisation.id AND r.ended_at IS NULL
      )
      OR EXISTS (
        SELECT 1 FROM dpdp.relationship r
        WHERE r.to_org = dpdp.current_org_id() AND r.from_org = organisation.id AND r.ended_at IS NULL
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint

ALTER TABLE "dpdp"."relationship" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY app_runtime_party_scoped ON "dpdp"."relationship" FOR ALL TO app_runtime
    USING (from_org = dpdp.current_org_id() OR to_org = dpdp.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint

-- D6: a processor without a signed agreement cannot be queried for an
-- obligation. D5/D7 (cross-tenant isolation, auditor visibility) share
-- this same policy -- capability-based WRITE restriction (auditor cannot
-- write, only Owner can sign) is enforced at the API/service layer via
-- requireRole, the same convention authz-gap-inventory.test.ts already
-- established for the rest of this app -- RLS here is tenant/relationship
-- READ scoping, not a capability system.
ALTER TABLE "dpdp"."obligation" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY app_runtime_relationship_scoped ON "dpdp"."obligation" FOR ALL TO app_runtime
    USING (
      org_id = dpdp.current_org_id()
      OR (
        assigned_processor_org_id = dpdp.current_org_id()
        AND EXISTS (
          SELECT 1 FROM dpdp.relationship r
          WHERE r.kind = 'processes_for' AND r.from_org = dpdp.current_org_id()
            AND r.to_org = obligation.org_id AND r.agreement_signed_at IS NOT NULL AND r.ended_at IS NULL
        )
      )
      OR EXISTS (
        SELECT 1 FROM dpdp.relationship r
        WHERE r.kind IN ('advises', 'audits') AND r.from_org = dpdp.current_org_id()
          AND r.to_org = obligation.org_id AND r.ended_at IS NULL
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint

-- Direct org_id tenant isolation for every other org-scoped table. Broader
-- relationship-aware visibility (an advisor's "their to-do list" screen
-- reading data_category/rights_request/etc. for a client) is Phase 2 work,
-- added when the route that needs it exists -- deliberately not guessed
-- at here.
DO $$
DECLARE
  t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'org_capability', 'data_category', 'principal_group', 'consent_campaign',
    'rights_request', 'grievance', 'grievance_officer', 'public_page',
    'notice_version', 'breach', 'event', 'access_log', 'exposure_estimate',
    'subscription', 'artefact'
  ])
  LOOP
    EXECUTE format('ALTER TABLE dpdp.%I ENABLE ROW LEVEL SECURITY', t);
    BEGIN
      EXECUTE format('CREATE POLICY app_runtime_org_scoped ON dpdp.%I FOR ALL TO app_runtime USING (org_id = dpdp.current_org_id())', t);
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END LOOP;
END $$;--> statement-breakpoint

-- service_role bypass, mirroring compliance's own pattern exactly (used by
-- background jobs / the R-70/71/72 importer once it is reused here).
DO $$
DECLARE
  t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'organisation', 'relationship', 'obligation', 'org_capability', 'data_category',
    'principal_group', 'consent_campaign', 'rights_request', 'grievance',
    'grievance_officer', 'public_page', 'notice_version', 'breach', 'event',
    'access_log', 'exposure_estimate', 'subscription', 'artefact'
  ])
  LOOP
    EXECUTE format('CREATE POLICY service_role_bypass ON dpdp.%I FOR ALL TO service_role USING (true)', t);
  END LOOP;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

-- ─── Grants: SELECT/INSERT/UPDATE/DELETE for app_runtime + service_role on
-- every dpdp table not already grant-restricted above (dpdp.artefact was
-- granted narrowly further up; this list deliberately excludes it). Tables
-- with no direct org_id (identity, identity_email, membership,
-- data_location, consent_token, consent_record, artefact_flag,
-- obligation_template, library_version, band, referral, referral_event,
-- daily_seal, partner) get grants but NOT RLS in this migration -- they are
-- either global reference data (library_version/obligation_template/band),
-- reached only via a join to something that IS scoped (data_location via
-- data_category, consent_token/consent_record via consent_campaign,
-- artefact_flag via artefact), or cross-org by design (identity/
-- identity_email/membership -- one identity can belong to several orgs).
-- RLS for these is Phase 2 work once the service layer exists to test
-- against; flagged here rather than silently assumed complete. ─────────
GRANT SELECT, INSERT, UPDATE, DELETE ON
  "dpdp"."organisation", "dpdp"."org_capability", "dpdp"."identity", "dpdp"."identity_email",
  "dpdp"."membership", "dpdp"."relationship", "dpdp"."data_category", "dpdp"."data_location",
  "dpdp"."library_version", "dpdp"."obligation_template", "dpdp"."obligation",
  "dpdp"."artefact_flag", "dpdp"."principal_group", "dpdp"."consent_campaign",
  "dpdp"."consent_token", "dpdp"."consent_record", "dpdp"."rights_request", "dpdp"."grievance",
  "dpdp"."grievance_officer", "dpdp"."public_page", "dpdp"."notice_version", "dpdp"."breach",
  "dpdp"."event", "dpdp"."access_log", "dpdp"."daily_seal", "dpdp"."exposure_estimate",
  "dpdp"."band", "dpdp"."subscription", "dpdp"."referral", "dpdp"."referral_event", "dpdp"."partner"
TO app_runtime;--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON
  "dpdp"."organisation", "dpdp"."org_capability", "dpdp"."identity", "dpdp"."identity_email",
  "dpdp"."membership", "dpdp"."relationship", "dpdp"."data_category", "dpdp"."data_location",
  "dpdp"."library_version", "dpdp"."obligation_template", "dpdp"."obligation",
  "dpdp"."artefact_flag", "dpdp"."principal_group", "dpdp"."consent_campaign",
  "dpdp"."consent_token", "dpdp"."consent_record", "dpdp"."rights_request", "dpdp"."grievance",
  "dpdp"."grievance_officer", "dpdp"."public_page", "dpdp"."notice_version", "dpdp"."breach",
  "dpdp"."event", "dpdp"."access_log", "dpdp"."daily_seal", "dpdp"."exposure_estimate",
  "dpdp"."band", "dpdp"."subscription", "dpdp"."referral", "dpdp"."referral_event", "dpdp"."partner"
TO service_role;--> statement-breakpoint

GRANT USAGE ON SCHEMA dpdp TO app_runtime, service_role;--> statement-breakpoint

-- ─── Band boundaries only -- NO prices. annual_paise is reserved to Rajat
-- (work order #11); left NULL here deliberately. ────────────────────────
INSERT INTO dpdp.band (key, floor, ceiling, is_ngo_half) VALUES
  ('micro', 0, 50, false),
  ('small', 51, 250, false),
  ('medium', 251, 1000, false),
  ('large', 1001, NULL, false)
ON CONFLICT (key) DO NOTHING;--> statement-breakpoint

-- ─── Seed the current obligation library VERSION marker only -- the 40
-- lawyer-reviewed obligation_template rows themselves are B6, still
-- unwritten (work order Phase 5: "B6 is the product. Everything else is
-- the container."). Creating library_version 0.1-draft now means
-- dpdp.obligation.library_version_used has something real to point at the
-- moment the first template is added, without a later migration having to
-- retrofit it.
INSERT INTO dpdp.library_version (id, version, released_on, changelog, is_current)
VALUES ('dpdp_lib_0_1_draft', '0.1-draft', CURRENT_DATE, 'Schema foundation only -- zero obligation_template rows yet. Not B6.', true)
ON CONFLICT (version) DO NOTHING;
