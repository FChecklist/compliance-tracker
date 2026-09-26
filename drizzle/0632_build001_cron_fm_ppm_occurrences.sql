-- PROJEXA-BUILD-001 U-41 part B (PROJEXA-COST-001, PMD-12): fm-ppm occurrence generation moves off the Vercel cron onto pg_cron.
-- Replaces vercel.json "/api/internal/fm-ppm/generate-occurrences/run", 0 2 * * *.
--
-- WHAT
--   compliance.cron_fm_ppm_generate_occurrences(p_lookahead_days integer = 14, p_today date = null) returns jsonb
--     generates one fm_ppm_occurrences row per active schedule due inside the look-ahead window, advances the schedule, then marks
--     past-due 'due' occurrences overdue (once). Idempotent on UNIQUE (schedule_id, due_date).
--   cron job 'cost001-fm-ppm-generate-occurrences' at '0 2 * * *' (UTC), command: select compliance.cron_fm_ppm_generate_occurrences();
--   Pure SQL: no /api/internal route, no net.http_post, no Vault secret, no table, no grant (only a revoke).
--
-- SOURCE
--   supabase/prepared/cost001/01_fm_ppm_generate_occurrences.sql: the function text is copied unchanged. That file holds the
--   reasoning, the column checks and the owner decision table; its README records the live dry runs of 2026-09-22 and 2026-09-24.
--   Every table and column used was re-checked on 2026-09-26 against src/lib/db/schema.ts and the live catalog (read only): none missing.
--
-- DECISIONS APPLIED (PM, under the owner's delegation)
--  S1: occurrence generation and overdue marking are switched on for every org.
--  An unknown frequency value is skipped and counted (skipped_unknown_frequency), not raised. The live enum has exactly the 7 labels.
--
-- LIVE COUNTS 2026-09-26 (read only)
--  fm_ppm_schedules 0 rows, fm_ppm_occurrences 0 rows: the first run acts on 0 rows.
--
-- GRANTS: SECURITY INVOKER (no privilege of its own), search_path pinned to compliance, platform, public, EXECUTE revoked from
--   public, anon and authenticated. The job runs as postgres, which owns the function, so it also bypasses row level security:
--   this switches on cross-org behaviour that read zero rows while the production connection was app_runtime.
--
-- DATA LOSS: none from this file. A run inserts occurrence rows and moves schedule dates forward; the down file does not revert a run's writes.
--
-- FIRST LIVE CALL: This function has no dry-run parameter (the prepared file has none). To read its counts before the first scheduled run,
--   call it inside a transaction that is rolled back, with begin, the call and rollback in ONE execute_sql call: begin; select compliance.cron_fm_ppm_generate_occurrences(); rollback;
--
-- HOW IT IS APPLIED: through the Supabase MCP by the PM after the always-aborted rehearsal of
--   ai-os/projexa-build-001/ROLLBACK_REHEARSALS.md (do-block --schemas compliance). Idempotent: create or replace, and the job is
--   unscheduled before it is scheduled again. The cron part runs only where the cron schema exists.
--
-- ROLLBACK: drizzle/down/0632_build001_cron_fm_ppm_occurrences.down.sql

BEGIN;

SET LOCAL lock_timeout = '5s';

-- 1. the function ---------------------------------------------------------
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

-- 1b. no access for public, anon or authenticated
REVOKE ALL ON FUNCTION compliance.cron_fm_ppm_generate_occurrences(integer, date) FROM public, anon, authenticated;

-- 2. the cron job (only where pg_cron is installed) -----------------------------------
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cost001-fm-ppm-generate-occurrences') THEN
      PERFORM cron.unschedule('cost001-fm-ppm-generate-occurrences');
    END IF;
    PERFORM cron.schedule('cost001-fm-ppm-generate-occurrences', '0 2 * * *', $cron$select compliance.cron_fm_ppm_generate_occurrences();$cron$);
  END IF;
END
$do$;

COMMIT;
