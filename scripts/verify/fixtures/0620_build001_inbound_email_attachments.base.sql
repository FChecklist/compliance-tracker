-- Base snapshot for the PGlite rollback replay (BR-207). Generated 2026-09-25T14:12:51Z by:
--   node scripts/verify/gen-base-snapshot.mjs --tables compliance.inbound_email_messages --function compliance.current_org_id
-- Schema only, read from the live catalog (pcrjmlpuqsbocqfwoxod). Regenerate with the same command; do not edit by hand
-- except to add an object the generator leaves out (see the generator's header).
-- left out: foreign key inbound_email_messages_user_id_fkey on compliance.inbound_email_messages references compliance.users, not in the snapshot
SET check_function_bodies = off;
CREATE SCHEMA IF NOT EXISTS compliance;
CREATE OR REPLACE FUNCTION compliance.current_org_id()
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'compliance', 'pg_temp'
AS $function$
  SELECT NULLIF(current_setting('app.current_org_id', true), '')
$function$;
CREATE TABLE compliance.inbound_email_messages (
  id text NOT NULL,
  org_id text,
  user_id text,
  from_address text NOT NULL,
  to_address text NOT NULL,
  subject text,
  resend_message_id text NOT NULL,
  received_at timestamp without time zone NOT NULL,
  processed_at timestamp without time zone,
  processing_error text,
  created_at timestamp without time zone DEFAULT now() NOT NULL
);
ALTER TABLE compliance.inbound_email_messages ADD CONSTRAINT inbound_email_messages_pkey PRIMARY KEY (id);
ALTER TABLE compliance.inbound_email_messages ADD CONSTRAINT inbound_email_messages_resend_message_id_unique UNIQUE (resend_message_id);
CREATE INDEX idx_inbound_email_messages_org_id ON compliance.inbound_email_messages USING btree (org_id);
CREATE INDEX idx_inbound_email_messages_to_address ON compliance.inbound_email_messages USING btree (to_address);
CREATE INDEX idx_inbound_email_messages_user_id ON compliance.inbound_email_messages USING btree (user_id);
ALTER TABLE compliance.inbound_email_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY app_runtime_read_own_org_inbound_email_messages ON compliance.inbound_email_messages AS PERMISSIVE FOR SELECT TO app_runtime USING ((org_id = compliance.current_org_id()));
CREATE POLICY service_role_bypass_inbound_email_messages ON compliance.inbound_email_messages AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT DELETE ON TABLE compliance.inbound_email_messages TO app_runtime;
GRANT INSERT ON TABLE compliance.inbound_email_messages TO app_runtime;
GRANT SELECT ON TABLE compliance.inbound_email_messages TO app_runtime;
GRANT UPDATE ON TABLE compliance.inbound_email_messages TO app_runtime;
GRANT DELETE ON TABLE compliance.inbound_email_messages TO service_role;
GRANT INSERT ON TABLE compliance.inbound_email_messages TO service_role;
GRANT SELECT ON TABLE compliance.inbound_email_messages TO service_role;
GRANT UPDATE ON TABLE compliance.inbound_email_messages TO service_role;
RESET check_function_bodies;
