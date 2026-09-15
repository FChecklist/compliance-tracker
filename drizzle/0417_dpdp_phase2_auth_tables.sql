CREATE TABLE "dpdp"."login_token" (
	"id" text PRIMARY KEY NOT NULL,
	"identity_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"requested_org_id" text,
	"expires_at" timestamp NOT NULL,
	"consumed_at" timestamp,
	"reuse_attempted_at" timestamp,
	"request_ip" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "login_token_token_hash_unique" UNIQUE("token_hash")
);
CREATE TABLE "dpdp"."session" (
	"id" text PRIMARY KEY NOT NULL,
	"identity_id" text NOT NULL,
	"active_org_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"revoked_at" timestamp,
	"last_seen_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "session_token_hash_unique" UNIQUE("token_hash")
);

ALTER TABLE "dpdp"."login_token" ADD CONSTRAINT "dpdp_login_token_identity_id_identity_id_fk" FOREIGN KEY ("identity_id") REFERENCES "dpdp"."identity"("id") ON DELETE CASCADE;
ALTER TABLE "dpdp"."login_token" ADD CONSTRAINT "dpdp_login_token_requested_org_id_organisation_id_fk" FOREIGN KEY ("requested_org_id") REFERENCES "dpdp"."organisation"("id") ON DELETE SET NULL;
ALTER TABLE "dpdp"."session" ADD CONSTRAINT "dpdp_session_identity_id_identity_id_fk" FOREIGN KEY ("identity_id") REFERENCES "dpdp"."identity"("id") ON DELETE CASCADE;
ALTER TABLE "dpdp"."session" ADD CONSTRAINT "dpdp_session_active_org_id_organisation_id_fk" FOREIGN KEY ("active_org_id") REFERENCES "dpdp"."organisation"("id") ON DELETE CASCADE;

-- Lookups always go by hash (never by identity_id alone -- there is no
-- "list my tokens" screen), so these are the only indexes that matter.
CREATE INDEX "dpdp_login_token_identity_idx" ON "dpdp"."login_token" ("identity_id");
CREATE INDEX "dpdp_session_identity_idx" ON "dpdp"."session" ("identity_id");

-- No RLS on either table: both are looked up by an unguessable hash BEFORE
-- any org context exists (that's the entire point of a login/session
-- token), so there is no dpdp.current_org_id() to scope by yet at the
-- point these are queried. Isolation here is the hash's own entropy plus
-- app_runtime being the only role with SELECT, not RLS -- same posture
-- compliance.api_keys' own preauth lookups already take (see
-- src/lib/db/preauth-lookups.ts).
GRANT SELECT, INSERT, UPDATE, DELETE ON "dpdp"."login_token", "dpdp"."session" TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON "dpdp"."login_token", "dpdp"."session" TO service_role;
