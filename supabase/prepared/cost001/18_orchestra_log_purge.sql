-- =============================================================================
-- PROJEXA-COST-001 -- prepared pg_cron replacement for a Vercel cron
-- File:   supabase/prepared/cost001/18_orchestra_log_purge.sql
-- Status: PREPARED, NOT APPLIED. Nothing in this file has been executed against
--         any database. Apply only per README.md (owner, SQL editor as postgres,
--         one file at a time). Branch-only work order: "Prepare, do not execute."
-- -----------------------------------------------------------------------------
-- WHAT THE VERCEL CRON DID
--   Route:     GET/POST /api/internal/orchestra-log-purge/run
--   Schedule:  45 9 * * *  (UTC; vercel.json "crons" entry)
--   Handler:   src/app/api/internal/orchestra-log-purge/run/route.ts:20-37
--              retentionDays = ORCHESTRA_PAYLOAD_RETENTION_DAYS if finite and > 0,
--              else DEFAULT_ORCHESTRA_PAYLOAD_RETENTION_DAYS (90). On error it
--              also inserted a compliance.application_errors row (route.ts:31-34);
--              a pg_cron failure is recorded in cron.job_run_details instead.
--   Logic:     src/lib/orchestra-execution-logger.ts:147-157 purgeExpiredOrchestraPayloads()
--              DEFAULT_ORCHESTRA_PAYLOAD_RETENTION_DAYS = 90 (:143)
--   One UPDATE on compliance.orchestra_executions:
--     SET input = {} , output = NULL , payload_purged_at = now()
--     WHERE payload_purged_at IS NULL AND created_at < now() - retentionDays*24h
--   `input` is set to the EMPTY OBJECT, not NULL: the column is NOT NULL DEFAULT
--   '{}' and other code reads `input->'escalation'` (2,313 of 2,624 live rows
--   carry that key today), so NULL would both violate the constraint and break
--   readers. Every other column (status/model/tokens/cost/duration/timestamps)
--   is left untouched so the audit trail survives the payload purge.
-- -----------------------------------------------------------------------------
-- SWITCH-ON NOTE (why this is a behaviour change, not a no-op port)
--   The UPDATE runs on the raw `db` export (src/lib/db/index.ts -> DATABASE_URL),
--   which in production authenticates as `app_runtime` (rolbypassrls = false,
--   verified live 2026-09-22). compliance.orchestra_executions has RLS ENABLED +
--   FORCED with the app_runtime policy `org_id = compliance.current_org_id()`,
--   which reads the GUC `app.current_org_id` -- set only inside withTenantContext()
--   (src/lib/db/tenant-scoped.ts:472). The cross-org purge has no tenant context,
--   so its UPDATE has matched ZERO rows since ~2026-08-23.
--   THIS CRON HAS NEVER PURGED A ROW IN PRODUCTION: live 2026-09-22 there are
--   2,624 rows, payload_purged_at IS NULL on all 2,624, the oldest created_at is
--   2026-07-04 14:04 UTC, and 90 days before "now" is 2026-06-24 -- so even with
--   full privileges the predicate matches 0 rows today. The first row crosses the
--   90-day line on 2026-10-02 (UTC). A pg_cron job runs as `postgres`
--   (rolbypassrls = true), so scheduling this function makes the purge REAL from
--   that date on. Intended by PROJEXA-COST-001; owner signs off explicitly
--   (README decision table).
-- -----------------------------------------------------------------------------
-- OWNER DECISION POINTS (see README.md decision table)
--   * Switch-on (above): prompt/response payloads older than the retention window
--     will start being erased (irreversibly) from 2026-10-02 onwards.
--   * Retention: `p_retention_days integer default 90` replaces the env var
--     ORCHESTRA_PAYLOAD_RETENTION_DAYS. The TS silently fell back to 90 on an
--     invalid env value; here an invalid parameter RAISES instead (a wrong value
--     in a cron command should fail loudly, not silently purge at 90). To use
--     another window, schedule `select compliance.cron_orchestra_log_purge(180);`.
-- -----------------------------------------------------------------------------
-- FIDELITY / SAFETY NOTES
--   * Same table, same predicate, same three written values as the TS.
--   * Idempotent: `payload_purged_at IS NULL` in the predicate.
--   * Overlap-safe by construction (a row is purged at most once); a
--     transaction-scoped advisory lock additionally prevents two runs interleaving.
--   * Cross-org by design, like the TS.
-- -----------------------------------------------------------------------------
-- COLUMNS VERIFIED LIVE 2026-09-22 (information_schema.columns, pcrjmlpuqsbocqfwoxod)
--   orchestra_executions: id, org_id, input (jsonb NOT NULL default '{}'),
--     output (jsonb nullable), created_at (timestamptz), payload_purged_at
--     (timestamptz nullable)
--   Drift noted: schema.ts declares created_at/payload_purged_at as timezone-naive
--     timestamp(); live is timestamptz. Names match; no column drift.
-- =============================================================================

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

-- Functions default to EXECUTE for PUBLIC; nothing but the pg_cron job (postgres,
-- the owner) should call this. SECURITY INVOKER (the default) is deliberate.
revoke execute on function compliance.cron_orchestra_log_purge(integer) from public;

-- -----------------------------------------------------------------------------
-- SCHEDULE (commented out on purpose -- owner runs this line, after README steps)
-- -----------------------------------------------------------------------------
-- select cron.schedule('cost001-orchestra-log-purge', '45 9 * * *', $$select compliance.cron_orchestra_log_purge();$$);

-- -----------------------------------------------------------------------------
-- ROLLBACK (note: rows already purged cannot be restored -- the payload is gone)
-- -----------------------------------------------------------------------------
-- select cron.unschedule('cost001-orchestra-log-purge');
-- drop function if exists compliance.cron_orchestra_log_purge(integer);
