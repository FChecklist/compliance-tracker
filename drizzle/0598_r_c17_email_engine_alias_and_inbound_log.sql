-- R-C17 (platform.sumeet_requirements, Owner-initiated 2026-09-13,
-- "Platform: Email Engine"). Hand-authored, matching this repo's own
-- established precedent for a migration whose CREATE TABLE/RLS/GRANT
-- statements go beyond what `bun run db:generate`'s raw diff would produce
-- unattended (drizzle/0255_priority11_deployment_events.sql,
-- drizzle/0597_r85a3_p10_boq_scenarios.sql) -- a genuine `db:generate` run
-- against this worktree's current drizzle-kit snapshot state produced an
-- ~1,370-line migration re-declaring several hundred already-live tables
-- (drizzle-kit's own snapshot is stale relative to production, a known,
-- already-documented gap -- see CLAUDE.md's R75 Part 2 state note on
-- `drizzle/` vs the live DB, and drizzle/meta/_journal.json already being
-- behind by migrations 0546-0550). That generated file was discarded
-- (never committed); this migration instead contains ONLY the two new
-- tables this task adds, written by hand in the same style as the two
-- precedents above.
--
-- NOT yet applied live against pcrjmlpuqsbocqfwoxod as of this commit --
-- same posture as drizzle/0597's own header: this worktree has no
-- Supabase/DATABASE_URL credentials configured, so this migration could
-- only be hand-authored and reviewed, never actually run against the live
-- database. Whoever merges this PR (or runs the next live-migration pass)
-- must apply it via the Supabase MCP (or `bun run db:migrate`) before
-- email-alias-service.ts / the resend-inbound webhook route can serve real
-- traffic. Every unit test in email-alias-service.test.ts and
-- resend-inbound/route.test.ts mocks the DB layer (this codebase's
-- established pattern for a table that does not exist in a developer's own
-- environment either -- see boq-baseline-service.test.ts's identical
-- approach) and therefore does not itself prove these tables exist live.
--
-- user_email_addresses: per-user inbound email alias
-- (localPart@domain -> orgId/userId). RLS is a normal org-scoped policy
-- (app_runtime, FOR ALL, org_id = current_org_id()) for in-app access
-- (e.g. a future "your email address" settings screen) PLUS the standard
-- service_role bypass -- but the one call site that genuinely needs to
-- read this table WITHOUT an org context (the resend-inbound webhook,
-- resolving an unknown recipient address back to an org) uses the plain
-- `db` client from src/lib/db/index.ts, which -- like every route not yet
-- migrated to withTenantContext -- is the table owner and bypasses RLS row
-- filtering by default (same precedent as deployment_events' writer, and
-- auth-guard.ts's autoProvisionUser(), per that function's own "Uses the
-- raw (RLS-bypassing) db client deliberately" comment).
--
-- inbound_email_messages: durable receipt log for every inbound webhook
-- delivery. org_id/user_id are BOTH nullable (a delivery to an unresolvable
-- recipient still gets a row, so it's visible for investigation rather
-- than silently dropped). Written via the same plain `db` client as
-- deployment_events (this migration's RLS/GRANT shape mirrors
-- drizzle/0255's deployment_events almost exactly, adding only an org-scoped
-- SELECT instead of an unconditional one, since -- unlike a Vercel
-- deployment -- an inbound email genuinely does belong to one tenant org
-- once resolved).

CREATE TABLE IF NOT EXISTS compliance.user_email_addresses (
  id text PRIMARY KEY,
  org_id text NOT NULL,
  user_id text NOT NULL REFERENCES compliance.users(id),
  local_part text NOT NULL,
  domain text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT user_email_addresses_local_part_domain_unique UNIQUE (local_part, domain)
);

CREATE INDEX IF NOT EXISTS idx_user_email_addresses_org_id ON compliance.user_email_addresses(org_id);
CREATE INDEX IF NOT EXISTS idx_user_email_addresses_user_id ON compliance.user_email_addresses(user_id);

ALTER TABLE compliance.user_email_addresses ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.user_email_addresses
    FOR ALL TO app_runtime
    USING (org_id = compliance.current_org_id())
    WITH CHECK (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY service_role_bypass_user_email_addresses ON compliance.user_email_addresses
    FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS compliance.inbound_email_messages (
  id text PRIMARY KEY,
  org_id text,
  user_id text REFERENCES compliance.users(id),
  from_address text NOT NULL,
  to_address text NOT NULL,
  subject text,
  resend_message_id text NOT NULL,
  received_at timestamp NOT NULL,
  processed_at timestamp,
  processing_error text,
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT inbound_email_messages_resend_message_id_unique UNIQUE (resend_message_id)
);

CREATE INDEX IF NOT EXISTS idx_inbound_email_messages_org_id ON compliance.inbound_email_messages(org_id);
CREATE INDEX IF NOT EXISTS idx_inbound_email_messages_user_id ON compliance.inbound_email_messages(user_id);
CREATE INDEX IF NOT EXISTS idx_inbound_email_messages_to_address ON compliance.inbound_email_messages(to_address);

ALTER TABLE compliance.inbound_email_messages ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY app_runtime_read_own_org_inbound_email_messages ON compliance.inbound_email_messages
    FOR SELECT TO app_runtime USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY service_role_bypass_inbound_email_messages ON compliance.inbound_email_messages
    FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.user_email_addresses TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.inbound_email_messages TO service_role;
