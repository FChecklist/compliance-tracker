-- PROJEXA-BUILD-001 U-41 part B (PROJEXA-COST-001, PMD-12): the orchestra payload purge moves off the Vercel cron onto pg_cron.
-- Replaces vercel.json "/api/internal/orchestra-log-purge/run", 45 9 * * *.
--
-- WHAT
--   compliance.cron_orchestra_log_purge(p_retention_days integer = 90) returns jsonb
--     sets input = '{}', output = null and payload_purged_at = now() on orchestra_executions rows older than the retention window.
--     An invalid retention value raises (the TypeScript silently fell back to 90).
--   cron job 'cost001-orchestra-log-purge' at '45 9 * * *' (UTC), command: select compliance.cron_orchestra_log_purge();
--   Pure SQL: no /api/internal route, no net.http_post, no Vault secret, no table, no grant (only a revoke).
--
-- SOURCE
--   supabase/prepared/cost001/18_orchestra_log_purge.sql: the function text is copied unchanged. That file holds the
--   reasoning, the column checks and the owner decision table; its README records the live dry runs of 2026-09-22 and 2026-09-24.
--   Every table and column used was re-checked on 2026-09-26 against src/lib/db/schema.ts and the live catalog (read only): none missing.
--
-- DECISIONS APPLIED (PM, under the owner's delegation)
--  S4: switch-on of a purge that erases stored prompt and response payloads. Retention 90 days.
--
-- LIVE COUNTS 2026-09-26 (read only)
--  orchestra_executions 2,624 rows, 0 purged. The oldest row is from 2026-07-04, so the first row becomes eligible on 2026-10-02
--  (UTC) and 29 rows are within 10 days of the 90 day line. Nothing is purged today.
--
-- GRANTS: SECURITY INVOKER (no privilege of its own), search_path pinned to compliance, platform, public, EXECUTE revoked from
--   public, anon and authenticated. The job runs as postgres, which owns the function, so it also bypasses row level security:
--   this switches on cross-org behaviour that read zero rows while the production connection was app_runtime.
--
-- DATA LOSS: IRREVERSIBLE once a payload passes the retention window: input and output are overwritten and the down file cannot restore them. The first eligible row is dated 2026-10-02 (UTC).
--
-- FIRST LIVE CALL: This function has no dry-run parameter (the prepared file has none). To read its counts before the first scheduled run,
--   call it inside a transaction that is rolled back, with begin, the call and rollback in ONE execute_sql call: begin; select compliance.cron_orchestra_log_purge(); rollback;
--
-- HOW IT IS APPLIED: through the Supabase MCP by the PM after the always-aborted rehearsal of
--   ai-os/projexa-build-001/ROLLBACK_REHEARSALS.md (do-block --schemas compliance). Idempotent: create or replace, and the job is
--   unscheduled before it is scheduled again. The cron part runs only where the cron schema exists.
--
-- ROLLBACK: drizzle/down/0638_build001_cron_orchestra_log_purge.down.sql

BEGIN;

SET LOCAL lock_timeout = '5s';

-- 1. the function ---------------------------------------------------------
create or replace function compliance.cron_orchestra_log_purge(
  p_retention_days integer default 90    -- was env ORCHESTRA_PAYLOAD_RETENTION_DAYS (default 90)
)
returns jsonb
language plpgsql
set search_path = compliance, platform, public
as $fn$
declare
  v_cutoff timestamptz;
  v_purged integer := 0;
begin
  if p_retention_days is null or p_retention_days <= 0 then
    raise exception 'cron_orchestra_log_purge: p_retention_days must be > 0 (got %)', p_retention_days;
  end if;

  -- Overlap guard: released automatically at transaction end.
  if not pg_try_advisory_xact_lock(hashtext('cost001:orchestra-log-purge')::bigint) then
    return jsonb_build_object('ran_at', now(), 'skipped', true,
                              'reason', 'another run of this job holds the advisory lock');
  end if;

  v_cutoff := now() - make_interval(days => p_retention_days);

  update compliance.orchestra_executions
     set input            = '{}'::jsonb,      -- NOT null: NOT NULL column, readers use input->'escalation'
         output           = null,
         payload_purged_at = now()
   where payload_purged_at is null
     and created_at < v_cutoff;
  get diagnostics v_purged = row_count;

  return jsonb_build_object(
    'ran_at',         now(),
    'retention_days', p_retention_days,      -- TS: retentionDays
    'cutoff',         v_cutoff,
    'purged_count',   v_purged               -- TS: purgedCount
  );
end;
$fn$;

-- 1b. no access for public, anon or authenticated
REVOKE ALL ON FUNCTION compliance.cron_orchestra_log_purge(integer) FROM public, anon, authenticated;

-- 2. the cron job (only where pg_cron is installed) -----------------------------------
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cost001-orchestra-log-purge') THEN
      PERFORM cron.unschedule('cost001-orchestra-log-purge');
    END IF;
    PERFORM cron.schedule('cost001-orchestra-log-purge', '45 9 * * *', $cron$select compliance.cron_orchestra_log_purge();$cron$);
  END IF;
END
$do$;

COMMIT;
