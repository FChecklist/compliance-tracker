-- =============================================================================
-- PROJEXA-COST-001 -- prepared pg_cron replacement for a Vercel cron
-- File:   supabase/prepared/cost001/08_audit_cadence.sql
-- Status: PREPARED, NOT APPLIED. Nothing in this file has been executed against
--         any database. Apply only per README.md (owner, SQL editor as postgres,
--         one file at a time). Branch-only work order: "Prepare, do not execute."
-- -----------------------------------------------------------------------------
-- WHAT THE VERCEL CRON DID
--   Route:     GET/POST /api/internal/audit-cadence/run
--   Schedule:  15 8 * * *  (UTC; vercel.json "crons" entry). Was every 3 hours
--              until 2026-07-14, moved to daily for the Vercel Hobby cron limit
--              (route.ts:10-14).
--   Handler:   src/app/api/internal/audit-cadence/run/route.ts:22-33
--              Promise.all([scanForL2Violations(), scanForL4PendingEscalations()])
--   Logic:     src/lib/audit-cadence-scan.ts:36-67   scanForL2Violations()
--                L2_SCAN_WINDOW_HOURS = 3 (:18), L2_REASON (:19)
--              src/lib/activity-log-service.ts:333-353  flagForReAudit()
--   L2 step: select activity_log rows WHERE lifecycle_stage = 'failed'
--     AND re_audit_requested_at IS NULL AND created_at >= now() - 3h (raw db,
--     cross-org). For each, flagForReAudit({orgId, activityLogId, reason:
--     L2_REASON, requestedBy: 'system:audit-cadence-scan'}) which, inside
--     withTenantContext({orgId}), re-reads the row, returns not_found /
--     not_terminal without writing if it is missing or its lifecycle_stage is not
--     in {completed, failed, closed}, else UPDATEs exactly four columns:
--       re_audit_requested_at = now, re_audit_reason = <reason>,
--       re_audit_requested_by = 'system:audit-cadence-scan', updated_at = now.
--     For rows selected by the L2 predicate, 'failed' IS terminal, so the
--     not_terminal branch is unreachable and not_found only fires on a race.
--   L4 step: scanForL4PendingEscalations() (audit-cadence-scan.ts:87-97) is a
--     READ-ONLY count -- activity_log rows with risk_level in ('high','critical'),
--     lifecycle_stage in ('completed','failed','closed'), executive_reviewed_at IS
--     NULL -- returned only in the HTTP response body. Nothing persisted it and
--     nothing consumed it (the response went to Vercel's cron logs). DROPPED here;
--     the equivalent query is kept as a comment at the bottom for ad-hoc use.
-- -----------------------------------------------------------------------------
-- SWITCH-ON NOTE (why this is a behaviour change, not a no-op port)
--   The candidate SELECT runs on the raw `db` export (src/lib/db/index.ts ->
--   DATABASE_URL), which in production authenticates as `app_runtime`
--   (rolbypassrls = false, verified live 2026-09-22). compliance.activity_log has
--   RLS ENABLED with the app_runtime policy `org_id = compliance.current_org_id()`;
--   that function reads the GUC `app.current_org_id`, set only inside
--   withTenantContext() (src/lib/db/tenant-scoped.ts:472). The cross-org candidate
--   read has no tenant context, so it has returned ZERO rows since ~2026-08-23 and
--   no row has been flagged since. A pg_cron job runs as `postgres`
--   (rolbypassrls = true), so scheduling this function RE-ENABLES automated
--   re-audit flagging platform-wide. Intended by PROJEXA-COST-001; owner signs off
--   explicitly (README decision table). Dry-run 2026-09-22: activity_log has 0
--   rows in total, so a first run acts on 0 rows.
-- -----------------------------------------------------------------------------
-- OWNER DECISION #5 -- scan window (p_window_hours)
--   The TS scans only the last L2_SCAN_WINDOW_HOURS = 3 hours, a constant left
--   over from the original every-3-hours schedule. Since the cadence became DAILY
--   (2026-07-14) that is a confirmed bug: a failure created between 08:15 and
--   05:15 the next day (21 of every 24 hours) is never inside any run's window
--   and is never flagged. This function takes `p_window_hours integer default 24`:
--     24 = the value that makes a daily run cover the whole day (DEFAULT,
--          recommended). Runs overlap by a few seconds of drift at most; the
--          `re_audit_requested_at IS NULL` guard makes double-flagging impossible.
--      3 = the faithful-but-buggy TS value. To run with it, schedule
--          `select compliance.cron_audit_cadence(3);` instead.
--   A larger value (e.g. 48 or 168) is also safe and would additionally back-fill
--   failures older than one day on the first run; the owner may prefer that for
--   the switch-on run only.
-- -----------------------------------------------------------------------------
-- OTHER OWNER DECISION POINTS (see README.md decision table)
--   * Switch-on (above).
--   * L4 read-only count dropped (no consumer existed). Reinstating it would mean
--     deciding where to persist it first; out of scope here.
--   * re_audit_reason keeps the TS string verbatim, including the
--     "(audit-cadence-scan.ts)" suffix, so existing dashboards/filters that match
--     on it keep working. Changing the wording is an owner call, not made here.
-- -----------------------------------------------------------------------------
-- FIDELITY / SAFETY NOTES
--   * One UPDATE with the candidate predicate AND the flagForReAudit guards folded
--     in (lifecycle_stage = 'failed' satisfies the terminal-stage check). Written
--     values are byte-identical to flagForReAudit()'s.
--   * Idempotent: `re_audit_requested_at IS NULL` in the predicate.
--   * `already_flagged` (TS: rows where flagForReAudit returned flagged=false) is
--     structurally 0 in a single-statement version -- it could only be non-zero in
--     the TS when another writer flagged a row between the candidate SELECT and
--     that row's UPDATE. Kept in the summary for parity.
--   * Transaction-scoped advisory lock prevents overlapping runs.
--   * Cross-org by design, like the TS candidate read.
-- -----------------------------------------------------------------------------
-- COLUMNS VERIFIED LIVE 2026-09-22 (information_schema.columns, pcrjmlpuqsbocqfwoxod)
--   activity_log: id, org_id, lifecycle_stage (text, default 'requested'),
--     created_at (timestamptz), updated_at (timestamptz), re_audit_requested_at
--     (timestamptz), re_audit_reason (text), re_audit_requested_by (text),
--     risk_level (text), executive_reviewed_at (timestamptz)
--   Drift noted: schema.ts declares the timestamps as timezone-naive timestamp();
--     live is timestamptz. Names match; no column drift.
-- =============================================================================

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

-- Functions default to EXECUTE for PUBLIC; nothing but the pg_cron job (postgres,
-- the owner) should call this. SECURITY INVOKER (the default) is deliberate.
revoke execute on function compliance.cron_audit_cadence(integer) from public;

-- -----------------------------------------------------------------------------
-- SCHEDULE (commented out on purpose -- owner runs this line, after README steps;
-- substitute cron_audit_cadence(3) if OWNER DECISION #5 keeps the TS window)
-- -----------------------------------------------------------------------------
-- select cron.schedule('cost001-audit-cadence', '15 8 * * *', $$select compliance.cron_audit_cadence();$$);

-- -----------------------------------------------------------------------------
-- ROLLBACK
-- -----------------------------------------------------------------------------
-- select cron.unschedule('cost001-audit-cadence');
-- drop function if exists compliance.cron_audit_cadence(integer);

-- -----------------------------------------------------------------------------
-- DROPPED L4 COUNT (read-only; ad-hoc equivalent of scanForL4PendingEscalations)
-- -----------------------------------------------------------------------------
-- select count(*) as l4_pending_count
--   from compliance.activity_log
--  where risk_level in ('high', 'critical')
--    and lifecycle_stage in ('completed', 'failed', 'closed')
--    and executive_reviewed_at is null;
