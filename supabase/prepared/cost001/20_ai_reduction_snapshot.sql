-- =============================================================================
-- PROJEXA-COST-001 -- prepared pg_cron replacement for a Vercel cron
-- File:   supabase/prepared/cost001/20_ai_reduction_snapshot.sql
-- Status: PREPARED, NOT APPLIED. Nothing in this file has been executed against
--         any database. Apply only per README.md (owner, SQL editor as postgres,
--         one file at a time). Branch-only work order: "Prepare, do not execute."
-- -----------------------------------------------------------------------------
-- WHAT THE VERCEL CRON DID
--   Route:     GET/POST /api/internal/ai-reduction-snapshot/run
--   Schedule:  0 2 1 * *  (UTC; 1st of every month; vercel.json "crons" entry)
--   Handler:   src/app/api/internal/ai-reduction-snapshot/run/route.ts:18-29
--   Logic:     src/lib/services/ai-reduction-service.ts:31-49 takeAiReductionSnapshot()
--   Design:    drizzle/0233_ai_reduction_snapshots.sql (header) -- "a monthly,
--              platform-wide snapshot of the SUM of those cumulative counters across
--              every task_capabilities row"; diffing two consecutive rows gives
--              that month's real bucket distribution.
--   One INSERT into compliance.ai_reduction_snapshots (snapshot_date,
--   full_software_count, package_available_count, novel_count, total_count) from
--     SELECT coalesce(sum(full_software_count),0), coalesce(sum(package_available_count),0),
--            coalesce(sum(novel_count),0) FROM platform.task_capabilities
--   with total_count = the three sums added and snapshot_date = today's UTC date.
--   Counter column names confirmed live AND in drizzle/0233's header:
--   full_software_count / package_available_count / novel_count (integer NOT NULL
--   default 0 on platform.task_capabilities).
--   One row per run; duplicates on the same date are harmless BY DESIGN
--   (ai-reduction-service.ts:30: "Safe to call more than once on the same
--   calendar day ... each call is a new, independent row"). No unique constraint
--   exists on snapshot_date (verified live: PK only).
-- -----------------------------------------------------------------------------
-- ROLE NOTE -- this cron is the partial EXCEPTION to the "zero rows" pattern
--   Both statements run on the raw `db` export (DATABASE_URL -> `app_runtime`,
--   rolbypassrls = false). platform.task_capabilities has RLS ENABLED + FORCED
--   with TWO app_runtime policies: `org_id = compliance.current_org_id()` (ALL) and
--   `app_runtime_read_platform_defaults` (SELECT, `org_id IS NULL`). With no tenant
--   context the first yields nothing but the second still exposes the platform-
--   default rows, and compliance.ai_reduction_snapshots grants app_runtime INSERT
--   WITH CHECK (true). So under app_runtime the TS summed ONLY `org_id IS NULL`
--   rows and could still insert -- consistent with the one live snapshot row
--   (snapshot_date 2026-08-01). No 2026-09-01 row exists.
--   SEMANTIC DIFFERENCE, stated plainly: as `postgres` (BYPASSRLS) this function
--   sums ALL task_capabilities rows, org-scoped ones included, which is what
--   drizzle/0233's header documents as the design ("across every
--   task_capabilities row"). Today the two readings are IDENTICAL: live
--   2026-09-22 the table has exactly 1 row and it has org_id IS NULL
--   (full_software 3 / package_available 0 / novel 0 -> total 3). They diverge the
--   day an org-scoped task_capabilities row gets a non-zero counter.
--   `p_platform_only boolean default false` lets the owner pin the app_runtime
--   reading (`org_id IS NULL` only) if the narrower semantics are preferred.
-- -----------------------------------------------------------------------------
-- OWNER DECISION POINTS (see README.md decision table)
--   * Semantics: all rows (default, matches drizzle/0233 design) vs platform-only
--     rows (`p_platform_only => true`, matches what app_runtime effectively did).
--   * Switch-on is mild here: a monthly snapshot resumes (the September row was
--     missed). Schedule kept at 0 2 1 * * (UTC).
-- -----------------------------------------------------------------------------
-- FIDELITY / SAFETY NOTES
--   * snapshot_date is the UTC calendar date (TS: toISOString().slice(0,10)).
--     The live column is `date`; a date value is inserted directly rather than a
--     to_char() text (text -> date has no assignment cast in Postgres).
--   * Aggregates without GROUP BY always return one row, so an empty
--     task_capabilities table snapshots 0/0/0/0 -- same as the TS's coalesce/Number(...?? 0).
--   * Transaction-scoped advisory lock prevents two runs interleaving (a manual
--     re-run after the cron would still add a second, harmless row -- by design).
-- -----------------------------------------------------------------------------
-- COLUMNS VERIFIED LIVE 2026-09-22 (information_schema.columns, pcrjmlpuqsbocqfwoxod)
--   ai_reduction_snapshots: id, snapshot_date (date NOT NULL), full_software_count,
--     package_available_count, novel_count, total_count (all integer NOT NULL),
--     created_at (timestamptz)
--   platform.task_capabilities: full_software_count, package_available_count,
--     novel_count (integer NOT NULL default 0), org_id (text nullable)
--   Drift noted: drizzle/0233 and schema.ts declare created_at as timezone-naive
--     timestamp; live is timestamptz. Names match; no column drift.
-- =============================================================================

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

-- Functions default to EXECUTE for PUBLIC; nothing but the pg_cron job (postgres,
-- the owner) should call this. SECURITY INVOKER (the default) is deliberate.
revoke execute on function compliance.cron_ai_reduction_snapshot(boolean, date) from public;

-- -----------------------------------------------------------------------------
-- SCHEDULE (commented out on purpose -- owner runs this line, after README steps;
-- use cron_ai_reduction_snapshot(true) to pin the platform-only reading)
-- -----------------------------------------------------------------------------
-- select cron.schedule('cost001-ai-reduction-snapshot', '0 2 1 * *', $$select compliance.cron_ai_reduction_snapshot();$$);

-- -----------------------------------------------------------------------------
-- ROLLBACK
-- -----------------------------------------------------------------------------
-- select cron.unschedule('cost001-ai-reduction-snapshot');
-- drop function if exists compliance.cron_ai_reduction_snapshot(boolean, date);
