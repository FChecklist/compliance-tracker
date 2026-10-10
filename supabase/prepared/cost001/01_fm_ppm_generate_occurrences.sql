-- =============================================================================
-- PROJEXA-COST-001 -- prepared pg_cron replacement for a Vercel cron
-- File:   supabase/prepared/cost001/01_fm_ppm_generate_occurrences.sql
-- Status: PREPARED, NOT APPLIED. Nothing in this file has been executed against
--         any database. Apply only per README.md (owner, SQL editor as postgres,
--         one file at a time). Branch-only work order: "Prepare, do not execute."
-- -----------------------------------------------------------------------------
-- WHAT THE VERCEL CRON DID
--   Route:     GET/POST /api/internal/fm-ppm/generate-occurrences/run
--   Schedule:  0 2 * * *  (UTC; vercel.json "crons" entry)
--   Handler:   src/app/api/internal/fm-ppm/generate-occurrences/run/route.ts:19-30
--              (CRON_SECRET bearer check, then generateDueOccurrences())
--   Logic:     src/lib/services/fm-ppm-service.ts:187-238  generateDueOccurrences()
--              src/lib/services/fm-ppm-service.ts:33-45    advanceDueDate()
--              src/lib/services/fm-ppm-service.ts:24       GENERATION_LOOKAHEAD_DAYS = 14
--   Two responsibilities, in this order (mirrored below as two statements):
--     1. For every ACTIVE fm_ppm_schedules row whose next_due_date <= today+14:
--        look up its fm_checklist_templates row (skip if missing -- "orphaned
--        schedule"), skip if an fm_ppm_occurrences row already exists at
--        (schedule_id, next_due_date), else INSERT one occurrence
--        (org_id, schedule_id, asset_id, due_date = next_due_date,
--        assignee_id = default_assignee_id; status defaults to 'due') and then
--        UPDATE the schedule: next_due_date advanced by the template's
--        frequency, last_generated_occurrence_id = new occurrence id,
--        updated_at = now. ONE occurrence per schedule per run (no catch-up loop).
--     2. Every fm_ppm_occurrences row with status = 'due' and due_date <= today
--        whose overdue_notified_at IS NULL -> status = 'overdue',
--        overdue_notified_at = now, updated_at = now.
-- -----------------------------------------------------------------------------
-- SWITCH-ON NOTE (why this is a behaviour change, not a no-op port)
--   The TS runs on the raw `db` export (src/lib/db/index.ts -> getConnectionString()
--   -> DATABASE_URL). In production that connection string authenticates as the
--   `app_runtime` role, which has rolbypassrls = false (verified live 2026-09-22).
--   Every table this cron touches has RLS ENABLED + FORCED, with the app_runtime
--   policy `org_id = compliance.current_org_id()` (fm_ppm_schedules,
--   fm_ppm_occurrences) or `org_id IS NULL OR org_id = current_org_id()`
--   (fm_checklist_templates). compliance.current_org_id() reads the GUC
--   `app.current_org_id`, which is only ever set inside withTenantContext()
--   (src/lib/db/tenant-scoped.ts:472). A cross-org cron has no tenant context, so
--   the GUC is unset, the predicate is NULL, and the cron's SELECT has returned
--   ZERO rows since ~2026-08-23 -- it has been silently doing nothing.
--   A pg_cron job runs as `postgres` (rolbypassrls = true, verified live), so
--   scheduling this function RE-ENABLES occurrence generation and overdue marking
--   platform-wide. That is the intent of PROJEXA-COST-001, but it is a real
--   behaviour switch-on and the owner signs it off explicitly (README decision
--   table). Dry-run 2026-09-22: 0 schedules, 0 occurrences, 0 templates exist,
--   so the first run after apply would act on 0 rows today.
-- -----------------------------------------------------------------------------
-- FIDELITY NOTES
--   * Frequencies: daily +1d, weekly +7d, fortnightly +14d, monthly +1mo,
--     quarterly +3mo, half_yearly +6mo, annually +12mo -- identical to
--     advanceDueDate(). date-fns addMonths() CLAMPS to month-end (31 Jan + 1 -> 28/29
--     Feb) and Postgres `date + interval 'N months'` clamps identically, so the
--     monthly/quarterly/half_yearly/annually arithmetic is semantically the same.
--     Day arithmetic is on UTC-midnight dates in TS and on `date` here: no DST.
--   * Unknown frequency: the TS THROWS (advanceDueDate default branch), which
--     aborts the whole cron run. Here the CASE has an ELSE NULL branch: such a
--     schedule is skipped (no insert, no advance) and counted in
--     `skipped_unknown_frequency`. Today this branch is unreachable -- the live
--     column is the enum compliance.fm_ppm_frequency whose labels are exactly the
--     seven above -- it exists so an enum extension can never abort the run.
--   * Idempotency / overlap safety: the live table has
--     UNIQUE (schedule_id, due_date) (fm_ppm_occurrences_schedule_id_due_date_key),
--     so the insert uses ON CONFLICT DO NOTHING and the schedule is advanced ONLY
--     for rows actually inserted -- exactly the TS "already generated -> continue
--     WITHOUT advancing" behaviour. A per-run transaction-scoped advisory lock
--     makes two overlapping runs impossible (the second returns skipped=true).
--   * The overdue pass runs as a SECOND statement so it can see occurrences
--     generated by the first statement in the same run, matching the TS order
--     (a newly generated occurrence already past due is marked overdue at once).
--   * Cross-org by design, like the TS (raw db, no org scoping).
--   * "today" is the UTC calendar date (TS: new Date().toISOString().slice(0,10);
--     DB TimeZone is UTC). p_today overrides it for testing only.
-- -----------------------------------------------------------------------------
-- OWNER DECISION POINTS (see README.md decision table)
--   * Switch-on (above): re-enables generation + overdue marking platform-wide.
--   * Unknown-frequency handling: skip-and-count (here) vs abort-the-run (TS).
--     Unreachable today (enum), recorded for completeness.
--   * Schedule: 0 2 * * * is kept as-is (UTC in both Vercel and pg_cron; live
--     cron.timezone is GMT).
-- -----------------------------------------------------------------------------
-- COLUMNS VERIFIED LIVE 2026-09-22 (information_schema.columns, pcrjmlpuqsbocqfwoxod)
--   fm_ppm_schedules: id, org_id, asset_id, checklist_template_id, is_active,
--     next_due_date (date), last_generated_occurrence_id, default_assignee_id,
--     updated_at (timestamptz)
--   fm_ppm_occurrences: id, org_id, schedule_id, asset_id, due_date (date),
--     status (enum fm_ppm_occurrence_status: due,in_progress,completed,overdue,
--     skipped; default 'due'), assignee_id, overdue_notified_at (timestamptz),
--     updated_at (timestamptz)
--   fm_checklist_templates: id, frequency (enum fm_ppm_frequency)
--   Drift noted: schema.ts declares these timestamps as timezone-naive
--     timestamp(); live columns are timestamptz. Names match; no column drift.
-- =============================================================================

create or replace function compliance.cron_fm_ppm_generate_occurrences(
  p_lookahead_days integer default 14,     -- GENERATION_LOOKAHEAD_DAYS
  p_today          date    default null    -- null = current UTC date (testing override)
)
returns jsonb
language plpgsql
set search_path = compliance, platform, public
as $fn$
declare
  v_today                     date := coalesce(p_today, (now() at time zone 'utc')::date);
  v_cutoff                    date;
  v_due_in_window             integer := 0;
  v_skipped_orphan            integer := 0;
  v_skipped_unknown_frequency integer := 0;
  v_eligible                  integer := 0;
  v_generated                 integer := 0;
  v_marked_overdue            integer := 0;
begin
  if p_lookahead_days is null or p_lookahead_days < 0 then
    raise exception 'cron_fm_ppm_generate_occurrences: p_lookahead_days must be >= 0 (got %)', p_lookahead_days;
  end if;

  -- Overlap guard: released automatically at transaction end.
  if not pg_try_advisory_xact_lock(hashtext('cost001:fm-ppm-generate-occurrences')::bigint) then
    return jsonb_build_object('ran_at', now(), 'skipped', true,
                              'reason', 'another run of this job holds the advisory lock');
  end if;

  v_cutoff := v_today + p_lookahead_days;

  -- Summary-only pre-count of the TS loop's `continue` branches (orphaned
  -- template, unknown frequency). Read-only; the write below re-derives its
  -- own eligibility, so a concurrent app write between the two cannot corrupt
  -- anything -- at worst the counts in the summary are off by that write.
  select count(*),
         count(*) filter (where t.id is null),
         count(*) filter (where t.id is not null
                            and t.frequency::text not in ('daily','weekly','fortnightly','monthly',
                                                          'quarterly','half_yearly','annually'))
    into v_due_in_window, v_skipped_orphan, v_skipped_unknown_frequency
    from compliance.fm_ppm_schedules s
    left join compliance.fm_checklist_templates t on t.id = s.checklist_template_id
   where s.is_active
     and s.next_due_date <= v_cutoff;

  -- Responsibility 1: generate + advance, in one atomic statement.
  with due as materialized (
    select s.id                  as schedule_id,
           s.org_id,
           s.asset_id,
           s.next_due_date,
           s.default_assignee_id,
           case t.frequency::text
             when 'daily'       then s.next_due_date + 1
             when 'weekly'      then s.next_due_date + 7
             when 'fortnightly' then s.next_due_date + 14
             when 'monthly'     then (s.next_due_date + interval '1 month')::date
             when 'quarterly'   then (s.next_due_date + interval '3 months')::date
             when 'half_yearly' then (s.next_due_date + interval '6 months')::date
             when 'annually'    then (s.next_due_date + interval '12 months')::date
             else null                                    -- unknown frequency: skip (TS throws)
           end                   as advanced_due_date
      from compliance.fm_ppm_schedules s
      join compliance.fm_checklist_templates t on t.id = s.checklist_template_id   -- orphans drop out here
     where s.is_active
       and s.next_due_date <= v_cutoff
  ),
  ins as (
    insert into compliance.fm_ppm_occurrences (org_id, schedule_id, asset_id, due_date, assignee_id)
    select d.org_id, d.schedule_id, d.asset_id, d.next_due_date, d.default_assignee_id
      from due d
     where d.advanced_due_date is not null
    on conflict (schedule_id, due_date) do nothing        -- already generated: skip, do NOT advance
    returning id, schedule_id
  ),
  adv as (
    update compliance.fm_ppm_schedules s
       set next_due_date                = d.advanced_due_date,
           last_generated_occurrence_id = i.id,
           updated_at                   = now()
      from ins i
      join due d on d.schedule_id = i.schedule_id
     where s.id = i.schedule_id
    returning s.id
  )
  select (select count(*) from due where advanced_due_date is not null),
         (select count(*) from adv)
    into v_eligible, v_generated;

  -- Responsibility 2: mark past-due 'due' occurrences overdue, once.
  update compliance.fm_ppm_occurrences
     set status              = 'overdue',
         overdue_notified_at = now(),
         updated_at          = now()
   where status = 'due'
     and due_date <= v_today
     and overdue_notified_at is null;
  get diagnostics v_marked_overdue = row_count;

  return jsonb_build_object(
    'ran_at',                     now(),
    'today_utc',                  v_today,
    'lookahead_days',             p_lookahead_days,
    'cutoff',                     v_cutoff,
    'due_schedules_in_window',    v_due_in_window,
    'generated',                  v_generated,                 -- TS: generated
    'marked_overdue',             v_marked_overdue,            -- TS: markedOverdue
    'skipped_existing_occurrence', v_eligible - v_generated,
    'skipped_orphan_schedule',    v_skipped_orphan,
    'skipped_unknown_frequency',  v_skipped_unknown_frequency
  );
end;
$fn$;

-- Functions default to EXECUTE for PUBLIC; nothing but the pg_cron job (postgres,
-- the owner) should call this. SECURITY INVOKER (the default) is deliberate: the
-- function has no privilege of its own -- it does what its caller may do.
revoke execute on function compliance.cron_fm_ppm_generate_occurrences(integer, date) from public;

-- -----------------------------------------------------------------------------
-- SCHEDULE (commented out on purpose -- owner runs this line, after README steps)
-- -----------------------------------------------------------------------------
-- select cron.schedule('cost001-fm-ppm-generate-occurrences', '0 2 * * *', $$select compliance.cron_fm_ppm_generate_occurrences();$$);

-- -----------------------------------------------------------------------------
-- ROLLBACK
-- -----------------------------------------------------------------------------
-- select cron.unschedule('cost001-fm-ppm-generate-occurrences');
-- drop function if exists compliance.cron_fm_ppm_generate_occurrences(integer, date);
