-- VERIDIAN Review Framework gap-closure: Checks & Balances / Audit Trail &
-- Immutable Logging (task-20260718-084006). Two independent fixes, both
-- scoped to compliance.audit_logs and 4 highest-risk source tables.
--
-- Hand-authored SQL, applied out-of-band via the Supabase MCP by a
-- DB-access-capable session -- same convention as every other migration in
-- this directory since 0005 (see drizzle/meta/_journal.json: only 0000 is a
-- real drizzle-kit-tracked entry, everything after it is applied live and
-- checked in here for history/review, not replayed by `drizzle-kit migrate`).
-- This session has no DATABASE_URL/live DB access -- not run here.
--
-- ============================================================
-- PART A -- Immutable Activity Logs (re-closing a gap that was already
-- fixed once and silently reopened)
-- ============================================================
--
-- drizzle/0005_wave7_hierarchy_and_audit_foundation.sql already did
-- `REVOKE UPDATE, DELETE ON compliance.audit_logs FROM app_runtime` --
-- confirmed live via information_schema.role_table_grants per that wave's
-- own change-log entry (orchestra_changes.md #57). That part of this
-- finding has been true and enforced since 2026-07-02.
--
-- But drizzle/0008_wave10_grant_service_role_compliance_schema.sql
-- (2026-07-03, fixing an unrelated MCP-auth bug) ran:
--   GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA compliance
--     TO service_role;
--   ALTER DEFAULT PRIVILEGES IN SCHEMA compliance
--     GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO service_role;
-- "ALL TABLES IN SCHEMA compliance" includes audit_logs -- this silently
-- re-opened the exact hole 0005 had closed, for the `service_role`
-- credential specifically. `service_role` is `rolbypassrls=true` (bypasses
-- every RLS policy on this table) AND, after 0008, has a live UPDATE/DELETE
-- grant on it -- i.e. currently nothing at the DB-privilege level stops any
-- of the ~10 call sites using SUPABASE_SERVICE_ROLE_KEY (src/app/api/mcp,
-- src/lib/services/esignature-service.ts, src/app/api/documents/**, etc.)
-- from altering or deleting audit history, even though none of them
-- currently do.
REVOKE UPDATE, DELETE ON compliance.audit_logs FROM service_role;

-- Honest limitation, not fixed by this migration (documented, not silently
-- dropped): `postgres` -- the role compliance/src/lib/db/index.ts's plain
-- `db` export connects as via DATABASE_URL -- owns the compliance schema
-- and every table in it (confirmed live per orchestra_changes.md entry #17
-- and the ownership note in drizzle/0223_force_rls_hr_attendance_
-- holidays.sql's header). REVOKE cannot strip a table owner's implicit
-- privileges; only changing ownership (or retiring DATABASE_URL's use of
-- `postgres` in favor of app_runtime everywhere, already flagged as open
-- debt at the end of orchestra_changes.md entry #57) closes that path. That
-- is a genuine infrastructure change outside a single migration file's
-- reach and outside this task's scope -- flagging it rather than claiming
-- full immutability. app_runtime and service_role (the two roles every
-- actual application code path writes through) are now both correctly
-- append-only on this table, which is the real, closable part of this gap.
--
-- No code path has ever updated or deleted an audit_logs row (same
-- confirmation 0005 already made, re-checked for this migration via
-- `grep -rn "auditLogs)" src/app src/lib | grep -iE "update|delete"` --
-- zero hits), so both REVOKEs are safe no-ops against every real write
-- path today, purely closing off future possibility. Because none exists,
-- there is also no live "compensating-entry" correction flow to migrate --
-- the finding's recommendation to route corrections through an explicit
-- compensating entry instead of an in-place edit is forward-looking policy
-- guidance for whenever a correction need first arises, not a change
-- against existing code.

-- ============================================================
-- PART B -- Complete Audit Trail: DB-level backstop triggers
-- ============================================================
--
-- src/lib/audit.ts's logActivity() is the single application-level call
-- site every route is supposed to use, but nothing at the DB level enforces
-- that every write path actually calls it -- a write path that forgets
-- produces a silent gap with nothing to detect it after the fact.
--
-- This adds a generic AFTER-trigger backstop on the 4 tables that best
-- match the finding's own recommended scope ("financial, compliance,
-- user/role"): compliance.users (user/role), compliance.compliance_items
-- (compliance), compliance.erp_journal_entries + compliance.erp_payment_
-- entries (financial). Deliberately NOT applied schema-wide -- most tables
-- in this schema are high-churn/derived (line items, ledger entries,
-- session/cache-like rows) where a blanket trigger would mostly produce
-- noise, not a meaningful backstop; this list can grow additively later
-- the same way ERP_ACTION_ROLES does.
--
-- Design choices, each deliberate:
--   * Writes into the SAME compliance.audit_logs table (action prefixed
--     `db_trigger.insert|update|delete`, entity_type = the source table
--     name) rather than a separate table -- one audit trail to query/
--     export/retain, not two. A row from this trigger sitting next to (or
--     in place of, if the app-level call was skipped) the equivalent
--     logActivity() row for the same change is the intended signal: an
--     auditor can filter `action LIKE 'db_trigger.%'` and diff against the
--     app-level rows for the same entity_id to find exactly the silent
--     gaps this finding is about. Some duplication for writes that ALREADY
--     call logActivity() is an accepted, intentional tradeoff of a
--     backstop, not a bug.
--   * Actor identity: reads the same `app.current_user_id`/`app.current_
--     org_id` GUCs src/lib/db/tenant-scoped.ts's withTenantContext() sets
--     (see that file's own header comment), falling back to the changed
--     row's own org_id column, then to a literal 'system (db-trigger
--     backstop)' actor / unknown-org sentinel for any write path that goes
--     through the plain `db` export (src/lib/db/index.ts, DATABASE_URL,
--     no GUCs set) instead of withTenantContext -- never blocks the
--     backstop insert for lack of a resolvable actor.
--   * `id` is generated with gen_random_uuid()::text (same function already
--     used for branches.id/clients.id in 0005) because audit_logs.id has no
--     DB-level DEFAULT -- schema.ts's $defaultFn(() => createId()) is a
--     Drizzle/TypeScript-side default only, invisible to a raw SQL INSERT
--     from inside a trigger.
--   * The entire body is wrapped in EXCEPTION WHEN OTHERS -> RAISE WARNING
--     + swallow: a backstop's own failure (unexpected schema drift, a
--     permission edge case, RLS denying the actor lookup) must never be
--     able to roll back the real write it's trying to shadow-log. A
--     safety net that can itself take down the primary path is worse than
--     no safety net. This is the same class of honest tradeoff as this
--     migration's Part A limitation note above -- documented, not hidden.

CREATE OR REPLACE FUNCTION compliance.fn_audit_trail_backstop()
RETURNS trigger AS $$
DECLARE
  v_row_id text;
  v_org_id text;
  v_user_id text;
  v_actor_name text;
  v_actor_role text;
BEGIN
  v_row_id := COALESCE(NEW.id, OLD.id);
  v_org_id := COALESCE(
    NEW.org_id,
    OLD.org_id,
    NULLIF(current_setting('app.current_org_id', true), ''),
    'unknown-db-trigger-backstop'
  );
  v_user_id := NULLIF(current_setting('app.current_user_id', true), '');

  IF v_user_id IS NOT NULL THEN
    SELECT u.name, u.role::text INTO v_actor_name, v_actor_role
    FROM compliance.users u WHERE u.id = v_user_id;
  END IF;

  IF v_actor_name IS NULL THEN
    v_actor_name := 'system (db-trigger backstop)';
    v_actor_role := 'system';
    v_user_id := NULL;
  END IF;

  INSERT INTO compliance.audit_logs
    (id, action, entity_type, entity_id, user_id, actor_name, actor_role, org_id, details)
  VALUES (
    gen_random_uuid()::text,
    'db_trigger.' || lower(TG_OP),
    TG_TABLE_NAME,
    v_row_id,
    v_user_id,
    v_actor_name,
    v_actor_role,
    v_org_id,
    'Automatic DB-level backstop record -- does not confirm (or rule out) that an application-level logActivity() call also happened for this change.'
  );

  RETURN NULL; -- AFTER trigger; return value is ignored either way
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'fn_audit_trail_backstop: failed to write backstop row for %.% (id=%): %',
    TG_TABLE_NAME, TG_OP, v_row_id, SQLERRM;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_backstop ON compliance.users;
CREATE TRIGGER trg_audit_backstop
  AFTER INSERT OR UPDATE OR DELETE ON compliance.users
  FOR EACH ROW EXECUTE FUNCTION compliance.fn_audit_trail_backstop();

DROP TRIGGER IF EXISTS trg_audit_backstop ON compliance.compliance_items;
CREATE TRIGGER trg_audit_backstop
  AFTER INSERT OR UPDATE OR DELETE ON compliance.compliance_items
  FOR EACH ROW EXECUTE FUNCTION compliance.fn_audit_trail_backstop();

DROP TRIGGER IF EXISTS trg_audit_backstop ON compliance.erp_journal_entries;
CREATE TRIGGER trg_audit_backstop
  AFTER INSERT OR UPDATE OR DELETE ON compliance.erp_journal_entries
  FOR EACH ROW EXECUTE FUNCTION compliance.fn_audit_trail_backstop();

DROP TRIGGER IF EXISTS trg_audit_backstop ON compliance.erp_payment_entries;
CREATE TRIGGER trg_audit_backstop
  AFTER INSERT OR UPDATE OR DELETE ON compliance.erp_payment_entries
  FOR EACH ROW EXECUTE FUNCTION compliance.fn_audit_trail_backstop();
