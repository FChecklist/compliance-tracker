-- R81 SEC-04 -- stop anonymous callers executing SECURITY DEFINER functions.
--
-- WHAT WAS WRONG. Four functions in the `compliance` schema are SECURITY
-- DEFINER (they run with the definer's rights, not the caller's) and all four
-- were executable by PUBLIC -- three because their proacl was NULL, which in
-- PostgreSQL means the default grant of EXECUTE to PUBLIC, and
-- gap_log_orgs_with_recent_activity because its ACL literally begins `=X/postgres`,
-- where the empty left-hand side IS PUBLIC.
--
-- That matters here and not in an ordinary database because the `compliance`
-- schema is exposed over PostgREST. An unauthenticated caller holding only the
-- publishable anon key can therefore reach them at /rest/v1/rpc/<name> by
-- sending the `Content-Profile: compliance` header. This was proved live, not
-- inferred: that request returned HTTP 200. Without the profile header the same
-- call 404s with PGRST202 because PostgREST only searches `public`, which is
-- exactly why a naive probe would have concluded these were unreachable.
--
-- The two that matter most:
--   * gap_log_orgs_with_recent_activity() returns a DISTINCT list of org_ids
--     active in the last 24 hours -- a cross-tenant customer list handed to
--     anyone with the public key.
--   * backfill_registered_assets(text) loops over every active row of
--     asset_registration_config and upserts into platform_assets for EVERY
--     tenant. It is not SQL-injectable (the caller's text is only an equality
--     filter) but it is an unauthenticated, unbounded, cross-tenant WRITE, run
--     against a pool whose max is 5 (src/lib/db/tenant-scoped.ts).
--
-- WHY THIS IS A REVOKE FROM **PUBLIC**, AND NOT FROM anon/authenticated.
-- Revoking from anon and authenticated by name looks equivalent and is not:
-- the grant being exercised is the implicit PUBLIC one, so revoking the named
-- roles would leave PUBLIC intact and change nothing at all. The check would
-- then report success while the endpoint stayed open -- the exact false-green
-- shape this programme keeps finding. Revoke PUBLIC, then grant back
-- explicitly to the roles that genuinely need it.
--
-- WHY THE GRANTS BACK ARE NOT OPTIONAL. compliance.conversation_org_id(text)
-- is called inside a live RLS policy --
-- `app_runtime_insert_own_org_conversation` on compliance.conversation_participants,
-- `USING (compliance.conversation_org_id(conversation_id) = compliance.current_org_id())`.
-- That policy is declared FOR {app_runtime}, so app_runtime must keep EXECUTE
-- or every insert into that table starts failing. A blanket revoke without
-- these grants would have converted a security finding into an outage, which
-- is why the policy dependency was checked before the statement was written
-- rather than after it shipped.
--
-- auto_register_asset() returns `trigger`; PostgREST does not expose
-- trigger-returning functions over /rpc, so it was never actually reachable
-- that way. It is included anyway: it costs nothing, and "not reachable by the
-- route we happened to test" is not the same as "not reachable".
-- REPLAY SAFETY, added after the statements below were already applied live.
-- Three of these four functions are created by migrations that ARE journaled
-- (0152/0157/0039-era, all far below this one). The fourth,
-- gap_log_orgs_with_recent_activity, is created ONLY by
-- drizzle/0296_r42_seq15_fix_l2_cross_org_discovery.sql -- which is one of the
-- eight orphaned files that have no journal entry (fault R81_F37) and are
-- therefore never applied and never replayed.
--
-- So on a database built by replaying drizzle/ from empty, that function does
-- not exist, and a bare REVOKE naming it would abort the whole migration run --
-- which is all-or-nothing in one transaction. The security fix would have
-- become the thing that broke the build, on exactly the environment we are
-- trying to make releasable. Each statement is therefore guarded on the
-- function actually existing.
--
-- A NOTE FOR WHOEVER CLOSES R81_F37: if 0296 is later journaled, it must be
-- ordered BEFORE this migration. `CREATE OR REPLACE FUNCTION` preserves an
-- existing ACL, but on a fresh database it creates the function anew with the
-- default grant of EXECUTE to PUBLIC -- so 0296 running AFTER this file would
-- silently re-open the hole this file closes.
--
-- Deliberately NOT done here: `ALTER DEFAULT PRIVILEGES IN SCHEMA compliance
-- REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC`, which would fix the whole class
-- rather than these four instances. It is the right long-term posture, but it
-- silently changes every FUTURE function -- app_runtime currently reaches new
-- functions through the default PUBLIC grant, so every subsequent migration
-- would need an explicit GRANT or fail in a way that looks unrelated to this
-- change. With another session actively writing migrations, that is a trap, not
-- a fix. It belongs in its own migration, announced.
DO $r81_sec04$
DECLARE
  fn text;
  fns text[] := ARRAY[
    'compliance.auto_register_asset()',
    'compliance.backfill_registered_assets(text)',
    'compliance.conversation_org_id(text)',
    'compliance.gap_log_orgs_with_recent_activity()'
  ];
BEGIN
  FOREACH fn IN ARRAY fns LOOP
    IF to_regprocedure(fn) IS NOT NULL THEN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', fn);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
    ELSE
      RAISE NOTICE 'R81 SEC-04: % not present, skipping (expected on a replay-from-empty database while R81_F37 orphans remain unjournaled)', fn;
    END IF;
  END LOOP;

  -- app_runtime needs these two specifically: conversation_org_id is called by
  -- the RLS policy app_runtime_insert_own_org_conversation on
  -- compliance.conversation_participants, and revoking without granting back
  -- would deny every insert into that table.
  IF to_regprocedure('compliance.conversation_org_id(text)') IS NOT NULL THEN
    GRANT EXECUTE ON FUNCTION compliance.conversation_org_id(text) TO app_runtime;
  END IF;
  IF to_regprocedure('compliance.gap_log_orgs_with_recent_activity()') IS NOT NULL THEN
    GRANT EXECUTE ON FUNCTION compliance.gap_log_orgs_with_recent_activity() TO app_runtime;
  END IF;
END
$r81_sec04$;
