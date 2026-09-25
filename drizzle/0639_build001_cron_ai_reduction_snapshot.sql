-- PROJEXA-BUILD-001 U-41 part B (PROJEXA-COST-001, PMD-12): the monthly AI reduction snapshot moves off the Vercel cron onto pg_cron.
-- Replaces vercel.json "/api/internal/ai-reduction-snapshot/run", 0 2 1 * *.
--
-- WHAT
--   compliance.cron_ai_reduction_snapshot(p_platform_only boolean = false, p_snapshot_date date = null) returns jsonb
--     inserts one ai_reduction_snapshots row holding the sums of the three counters of platform.task_capabilities.
--   cron job 'cost001-ai-reduction-snapshot' at '0 2 1 * *' (UTC), command: select compliance.cron_ai_reduction_snapshot();
--   Pure SQL: no /api/internal route, no net.http_post, no Vault secret, no table, no grant (only a revoke).
--
-- SOURCE
--   supabase/prepared/cost001/20_ai_reduction_snapshot.sql: the function text is copied unchanged. That file holds the
--   reasoning, the column checks and the owner decision table; its README records the live dry runs of 2026-09-22 and 2026-09-24.
--   Every table and column used was re-checked on 2026-09-26 against src/lib/db/schema.ts and the live catalog (read only): none missing.
--
-- DECISIONS APPLIED (PM, under the owner's delegation)
--  S5: sums all task_capabilities rows (the design of drizzle/0233). p_platform_only => true pins the org_id IS NULL reading.
--  Both readings give the same numbers today.
--
-- LIVE COUNTS 2026-09-26 (read only)
--  task_capabilities 1 row (org_id null). ai_reduction_snapshots 1 row (2026-08-01). The next scheduled run is 1 October 02:00 UTC.
--
-- GRANTS: SECURITY INVOKER (no privilege of its own), search_path pinned to compliance, platform, public, EXECUTE revoked from
--   public, anon and authenticated. The job runs as postgres, which owns the function, so it also bypasses row level security:
--   this switches on cross-org behaviour that read zero rows while the production connection was app_runtime.
--
-- DATA LOSS: none from this file. A run inserts one snapshot row; duplicates on one date are harmless by design.
--
-- FIRST LIVE CALL: This function has no dry-run parameter (the prepared file has none). To read its counts before the first scheduled run,
--   call it inside a transaction that is rolled back: begin; select compliance.cron_ai_reduction_snapshot(); rollback;
--
-- HOW IT IS APPLIED: through the Supabase MCP by the PM after the always-aborted rehearsal of
--   ai-os/projexa-build-001/ROLLBACK_REHEARSALS.md (do-block --schemas compliance). Idempotent: create or replace, and the job is
--   unscheduled before it is scheduled again. The cron part runs only where the cron schema exists.
--
-- ROLLBACK: drizzle/down/0639_build001_cron_ai_reduction_snapshot.down.sql

BEGIN;

SET LOCAL lock_timeout = '5s';

-- 1. the function ---------------------------------------------------------
create or replace function compliance.cron_ai_reduction_snapshot(
  p_platform_only boolean default false,   -- true = sum only org_id IS NULL rows (app_runtime reading)
  p_snapshot_date date    default null     -- null = current UTC date (testing override)
)
returns jsonb
language plpgsql
set search_path = compliance, platform, public
as $fn$
declare
  v_date        date := coalesce(p_snapshot_date, (now() at time zone 'utc')::date);
  v_source_rows integer := 0;
  v_row         record;
begin
  -- Overlap guard: released automatically at transaction end.
  if not pg_try_advisory_xact_lock(hashtext('cost001:ai-reduction-snapshot')::bigint) then
    return jsonb_build_object('ran_at', now(), 'skipped', true,
                              'reason', 'another run of this job holds the advisory lock');
  end if;

  insert into compliance.ai_reduction_snapshots
    (snapshot_date, full_software_count, package_available_count, novel_count, total_count)
  select v_date,
         coalesce(sum(tc.full_software_count), 0)::integer,
         coalesce(sum(tc.package_available_count), 0)::integer,
         coalesce(sum(tc.novel_count), 0)::integer,
         (coalesce(sum(tc.full_software_count), 0)
          + coalesce(sum(tc.package_available_count), 0)
          + coalesce(sum(tc.novel_count), 0))::integer
    from platform.task_capabilities tc
   where (not p_platform_only) or tc.org_id is null
  returning id, snapshot_date, full_software_count, package_available_count, novel_count, total_count
       into v_row;

  select count(*) into v_source_rows
    from platform.task_capabilities tc
   where (not p_platform_only) or tc.org_id is null;

  return jsonb_build_object(
    'ran_at',        now(),
    'platform_only', p_platform_only,
    'source_rows',   v_source_rows,
    'snapshot',      to_jsonb(v_row)          -- TS: snapshot {snapshotDate, fullSoftwareCount, ...}
  );
end;
$fn$;

-- 1b. no access for public, anon or authenticated
REVOKE ALL ON FUNCTION compliance.cron_ai_reduction_snapshot(boolean, date) FROM public, anon, authenticated;

-- 2. the cron job (only where pg_cron is installed) -----------------------------------
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cost001-ai-reduction-snapshot') THEN
      PERFORM cron.unschedule('cost001-ai-reduction-snapshot');
    END IF;
    PERFORM cron.schedule('cost001-ai-reduction-snapshot', '0 2 1 * *', $cron$select compliance.cron_ai_reduction_snapshot();$cron$);
  END IF;
END
$do$;

COMMIT;
