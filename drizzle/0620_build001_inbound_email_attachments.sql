-- PROJEXA-BUILD-001 U-31 (register row BR-413, PM Gap 6 "email attachments discarded"): the table the Resend inbound
-- webhook stores an email's attachments in. Schema only; no row is written, changed or deleted by this file.
--
-- WHAT
--   compliance.inbound_email_attachments, one row per attachment of one compliance.inbound_email_messages row:
--     id                    text, primary key (a cuid written by the webhook)
--     org_id                text NOT NULL: the organisation the recipient alias resolved to. The webhook reads attachments
--                           only for a message whose recipient resolved, so every row has an organisation.
--     inbound_message_id    text NOT NULL, references compliance.inbound_email_messages(id) ON DELETE CASCADE: deleting the
--                           message deletes its attachments.
--     file_name             text NOT NULL: the base name the sender gave, with no directory part.
--     content_type          text: as Resend reports it.
--     size_bytes            integer NOT NULL
--     content               bytea NOT NULL: the file itself. It is stored, never parsed or executed here (parsing an .xlsx
--                           into BOQ proposals is units U-36 and U-37).
--     resend_attachment_id  text: Resend's own id for the attachment; the webhook skips an attachment whose
--                           (inbound_message_id, resend_attachment_id) row already exists.
--     created_at            timestamptz NOT NULL DEFAULT now()
--   CHECK inbound_email_attachments_size_check: size_bytes and octet_length(content) are each at most 10485760 (10 MB)
--   and size_bytes equals octet_length(content). The webhook skips a larger attachment and records it in the message's
--   processing_error; it never truncates one, and this CHECK refuses a row that would say otherwise.
--   Index idx_inbound_email_attachments_inbound_message_id on (inbound_message_id): the webhook's lookup and the cascade.
--
-- ROW-LEVEL SECURITY: enabled and forced. Policies in the pattern of compliance.inbound_email_messages
--   (drizzle/0598_r_c17_email_engine_alias_and_inbound_log.sql; live shape in
--   scripts/verify/fixtures/0620_build001_inbound_email_attachments.base.sql): app_runtime may SELECT the rows of the
--   organisation in compliance.current_org_id(), and service_role bypasses. The webhook writes through the plain db client
--   (the table owner, postgres, which has BYPASSRLS), as it already does for inbound_email_messages. One difference from
--   that table, on purpose: FORCE is set here and is not set on inbound_email_messages, so a future non-bypass owner is
--   held to the policies too.
--
-- GRANTS: SELECT, INSERT, UPDATE, DELETE to app_runtime and service_role, the same as inbound_email_messages (schema
--   compliance's default privileges give a new table exactly these; they are written here so the PGlite replay, which has
--   no default privileges, builds the same table).
--
-- DATA LOSS: none. Additive: one new table; compliance.inbound_email_messages is not changed.
--
-- HOW IT IS APPLIED: through the Supabase MCP (apply_migration) by the PM, after the claim (ai-os/boss/ACTIVE-CLAIMS.yaml,
--   PHASE 4 EMAIL ADDENDUM) is on main and after the always-aborted rehearsal of ai-os/projexa-build-001/ROLLBACK_REHEARSALS.md
--   (its error text must begin PASS_ROLLED_BACK) and the PGlite proofs (bash scripts/verify/rollback-replay.sh and
--   src/lib/services/inbound-email-attachments-migration.pglite.test.ts). Idempotent: CREATE TABLE IF NOT EXISTS, CREATE
--   INDEX IF NOT EXISTS, a policy that already exists is kept, and the RLS flags and grants are the same on a second run.
--
-- ROLLBACK: drizzle/down/0620_build001_inbound_email_attachments.down.sql

BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS compliance.inbound_email_attachments (
  id text NOT NULL,
  org_id text NOT NULL,
  inbound_message_id text NOT NULL,
  file_name text NOT NULL,
  content_type text,
  size_bytes integer NOT NULL,
  content bytea NOT NULL,
  resend_attachment_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inbound_email_attachments_pkey PRIMARY KEY (id),
  CONSTRAINT inbound_email_attachments_inbound_message_id_fkey FOREIGN KEY (inbound_message_id)
    REFERENCES compliance.inbound_email_messages(id) ON DELETE CASCADE,
  CONSTRAINT inbound_email_attachments_size_check CHECK (
    size_bytes <= 10485760 AND octet_length(content) <= 10485760 AND size_bytes = octet_length(content)
  )
);

CREATE INDEX IF NOT EXISTS idx_inbound_email_attachments_inbound_message_id
  ON compliance.inbound_email_attachments (inbound_message_id);

ALTER TABLE compliance.inbound_email_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.inbound_email_attachments FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY app_runtime_read_own_org_inbound_email_attachments ON compliance.inbound_email_attachments
    FOR SELECT TO app_runtime USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY service_role_bypass_inbound_email_attachments ON compliance.inbound_email_attachments
    FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.inbound_email_attachments TO app_runtime, service_role;

COMMIT;
