-- PROJEXA-BUILD-001 U-41 part B (PROJEXA-COST-001, PMD-12): audit-cadence re-audit flagging moves off the Vercel cron onto pg_cron.
-- Replaces vercel.json "/api/internal/audit-cadence/run", 15 8 * * *.
--
-- WHAT
--   compliance.cron_audit_cadence(p_window_hours integer = 24) returns jsonb
--     flags failed activity_log rows created inside the window for re-audit (sets the four re_audit_* columns), once per row.
--   cron job 'cost001-audit-cadence' at '15 8 * * *' (UTC), command: select compliance.cron_audit_cadence();
--   Pure SQL: no /api/internal route, no net.http_post, no Vault secret, no table, no grant (only a revoke).
--
-- SOURCE
--   supabase/prepared/cost001/08_audit_cadence.sql: the function text is copied unchanged. That file holds the
--   reasoning, the column checks and the owner decision table; its README records the live dry runs of 2026-09-22 and 2026-09-24.
--   Every table and column used was re-checked on 2026-09-26 against src/lib/db/schema.ts and the live catalog (read only): none missing.
--
-- DECISIONS APPLIED (PM, under the owner's delegation)
--  Decision 5: the scan window is 24 hours on a daily job. The TypeScript scanned 3 hours, which missed 21 hours of every day.
--  The read-only L4 count of the TypeScript route is dropped (nothing consumed it).
--
-- LIVE COUNTS 2026-09-26 (read only)
--  activity_log 0 rows: the first run acts on 0 rows.
--
-- GRANTS: SECURITY INVOKER (no privilege of its own), search_path pinned to compliance, platform, public, EXECUTE revoked from
--   public, anon and authenticated. The job runs as postgres, which owns the function, so it also bypasses row level security:
--   this switches on cross-org behaviour that read zero rows while the production connection was app_runtime.
--
-- DATA LOSS: none from this file. A run sets re_audit_requested_at, re_audit_reason, re_audit_requested_by and updated_at on failed rows.
--
-- FIRST LIVE CALL: This function has no dry-run parameter (the prepared file has none). To read its counts before the first scheduled run,
--   call it inside a transaction that is rolled back: begin; select compliance.cron_audit_cadence(); rollback;
--
-- HOW IT IS APPLIED: through the Supabase MCP by the PM after the always-aborted rehearsal of
--   ai-os/projexa-build-001/ROLLBACK_REHEARSALS.md (do-block --schemas compliance). Idempotent: create or replace, and the job is
--   unscheduled before it is scheduled again. The cron part runs only where the cron schema exists.
--
-- ROLLBACK: drizzle/down/0635_build001_cron_audit_cadence.down.sql

BEGIN;

SET LOCAL lock_timeout = '5s';

-- 1. the function ---------------------------------------------------------
create or replace function compliance.cron_audit_cadence(
  p_window_hours integer default 24      -- OWNER DECISION #5: 24 (recommended) | 3 (faithful TS bug)
)
returns jsonb
language plpgsql
set search_path = compliance, platform, public
as $fn$
declare
  v_cutoff  timestamptz;
  v_flagged integer := 0;
begin
  if p_window_hours is null or p_window_hours <= 0 then
    raise exception 'cron_audit_cadence: p_window_hours must be > 0 (got %)', p_window_hours;
  end if;

  -- Overlap guard: released automatically at transaction end.
  if not pg_try_advisory_xact_lock(hashtext('cost001:audit-cadence')::bigint) then
    return jsonb_build_object('ran_at', now(), 'skipped', true,
                              'reason', 'another run of this job holds the advisory lock');
  end if;

  v_cutoff := now() - make_interval(hours => p_window_hours);

  -- L2 Continuous Monitoring: flag recent failures for re-audit (once).
  update compliance.activity_log
     set re_audit_requested_at = now(),
         re_audit_reason       = 'L2 Continuous Monitoring: automated failure detection (audit-cadence-scan.ts)',
         re_audit_requested_by = 'system:audit-cadence-scan',
         updated_at            = now()
   where lifecycle_stage = 'failed'                 -- candidate predicate + terminal-stage guard
     and re_audit_requested_at is null              -- not yet flagged (idempotent)
     and created_at >= v_cutoff;
  get diagnostics v_flagged = row_count;

  return jsonb_build_object(
    'ran_at',               now(),
    'scanned_window_hours', p_window_hours,     -- TS: scannedWindowHours
    'window_start',         v_cutoff,
    'candidates_found',     v_flagged,          -- TS: candidatesFound
    'flagged',              v_flagged,          -- TS: flagged
    'already_flagged',      0                   -- TS: alreadyFlagged (see notes)
  );
end;
$fn$;

-- 1b. no access for public, anon or authenticated
REVOKE ALL ON FUNCTION compliance.cron_audit_cadence(integer) FROM public, anon, authenticated;

-- 2. the cron job (only where pg_cron is installed) -----------------------------------
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cost001-audit-cadence') THEN
      PERFORM cron.unschedule('cost001-audit-cadence');
    END IF;
    PERFORM cron.schedule('cost001-audit-cadence', '15 8 * * *', $cron$select compliance.cron_audit_cadence();$cron$);
  END IF;
END
$do$;

COMMIT;
