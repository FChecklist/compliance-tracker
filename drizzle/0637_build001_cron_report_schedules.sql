-- PROJEXA-BUILD-001 U-41 part B (PROJEXA-COST-001, PMD-12): due report schedules move off the Vercel cron onto pg_cron.
-- Replaces vercel.json "/api/internal/report-schedules/run", 45 8 * * *.
--
-- WHAT
--   compliance.cron_report_schedules(p_dedup boolean = true, p_dry_run boolean = false, p_now timestamptz = now(),
--     p_default_hour integer = 8, p_once_per_slot boolean = true) returns jsonb: evaluates every active report_schedules row on the
--     UTC wall clock and writes one 'system' notification per recipient of each schedule that is due in this hour.
--   cron job 'cost001-report-schedules' at '5 * * * *' (UTC), command: select compliance.cron_report_schedules();
--   Pure SQL: no /api/internal route, no net.http_post, no Vault secret, no table, no grant (only a revoke).
--
-- SOURCE
--   supabase/prepared/cost001/15_report_schedules.sql: the function text is copied unchanged except that the dollar-quote tag is fn where the prepared file used the bare pair. That file holds the
--   reasoning, the column checks and the owner decision table; its README records the live dry runs of 2026-09-22 and 2026-09-24.
--   Every table and column used was re-checked on 2026-09-26 against src/lib/db/schema.ts and the live catalog (read only): none missing.
--
-- DECISIONS APPLIED (PM, under the owner's delegation)
--  Decision 6: the job runs HOURLY at minute 5, once per slot, not the old daily 08:45 (the old cron could only ever match the
--  08 hour). A schedule with no times_of_day fires at p_default_hour (8), except cadence 'hourly', which fires every hour.
--  The report generators are not ported: every schedule gets the body-less notice the TypeScript wrote for an unknown generator.
--  Notification dedup stays ON.
--
-- LIVE COUNTS 2026-09-26 (read only)
--  report_schedules 0 active rows: each hourly run acts on 0 rows.
--
-- GRANTS: SECURITY INVOKER (no privilege of its own), search_path pinned to compliance, platform, public, EXECUTE revoked from
--   public, anon and authenticated. The job runs as postgres, which owns the function, so it also bypasses row level security:
--   this switches on cross-org behaviour that read zero rows while the production connection was app_runtime.
--
-- DATA LOSS: none from this file. A run inserts notification rows with metadata kind report_schedule.
--
-- FIRST LIVE CALL: select compliance.cron_report_schedules(p_dry_run => true);
--
-- HOW IT IS APPLIED: through the Supabase MCP by the PM after the always-aborted rehearsal of
--   ai-os/projexa-build-001/ROLLBACK_REHEARSALS.md (do-block --schemas compliance). Idempotent: create or replace, and the job is
--   unscheduled before it is scheduled again. The cron part runs only where the cron schema exists.
--
-- ROLLBACK: drizzle/down/0637_build001_cron_report_schedules.down.sql

BEGIN;

SET LOCAL lock_timeout = '5s';

-- 1. the function ---------------------------------------------------------
create or replace function compliance.cron_report_schedules(
  p_dedup         boolean     default true,
  p_dry_run       boolean     default false,
  p_now           timestamptz default now(),
  p_default_hour  int         default 8,
  p_once_per_slot boolean     default true
) returns jsonb
language plpgsql
set search_path = compliance, platform, public
as $fn$
declare
  s              record;
  v_uid          text;
  v_ts           timestamp;     -- UTC wall clock (TS uses getUTC*)
  v_hour         text;          -- "HH" zero-padded (matchesTimeOfDay :153)
  v_last_dom     int;
  v_due          boolean;
  v_times        jsonb;
  v_time_match   boolean;
  v_checked      int := 0;
  v_due_n        int := 0;
  v_delivered    int := 0;
  v_deduped      int := 0;
  v_slot_skipped int := 0;
  v_errors       int := 0;
begin
  if not pg_try_advisory_xact_lock(hashtext('cost001'), hashtext('report_schedules')) then
    return jsonb_build_object('skipped', 'overlap');
  end if;

  v_ts       := p_now at time zone 'UTC';
  v_hour     := to_char(v_ts, 'HH24');
  v_last_dom := extract(day from (date_trunc('month', v_ts) + interval '1 month' - interval '1 day'))::int;  -- :124

  -- :227  every active schedule across every org
  for s in
    select id, report_id, cadence, day_of_week, day_of_month, times_of_day,
           start_date, end_date, recipient_user_ids
    from compliance.report_schedules
    where is_active = true
    order by created_at, id
  loop
    v_checked := v_checked + 1;

    -- :100-148  isScheduleDue()
    v_due := case
      when s.cadence in ('immediate', 'on_demand') then false
      when s.cadence in ('hourly', 'daily')        then true
      when s.cadence in ('weekly', 'fortnightly')  then
           s.day_of_week is not null and extract(dow from v_ts)::int = s.day_of_week
      when s.cadence = 'biweekly' then
           s.day_of_week is not null
           and extract(dow from v_ts)::int in (s.day_of_week, (s.day_of_week + 3) % 7)
      when s.cadence in ('monthly', 'bimonthly', 'quarterly', 'half_yearly', 'yearly', 'biyearly') then
           s.day_of_month is not null
           and extract(day from v_ts)::int = least(s.day_of_month, v_last_dom)
      when s.cadence = 'year_to_date' then
           extract(month from v_ts) = 1 and extract(day from v_ts) = 1
      when s.cadence = 'custom_range' then
           s.start_date is not null and s.end_date is not null
           and v_ts::date = s.end_date and s.start_date <= s.end_date
      else false end;
    continue when not v_due;

    -- :151-155  matchesTimeOfDay(), plus OWNER DECISION #6(c) for empty times_of_day
    v_times := case when jsonb_typeof(s.times_of_day) = 'array' then s.times_of_day else '[]'::jsonb end;
    if jsonb_array_length(v_times) = 0 then
      v_time_match := (s.cadence = 'hourly') or (v_hour = lpad(p_default_hour::text, 2, '0'));
    else
      v_time_match := exists (
        select 1 from jsonb_array_elements_text(v_times) t
        where t like v_hour || ':%');
    end if;
    continue when not v_time_match;

    v_due_n := v_due_n + 1;

    begin
      -- :238-251  one notification per recipientUserIds entry
      for v_uid in
        select value #>> '{}'
        from jsonb_array_elements(case when jsonb_typeof(s.recipient_user_ids) = 'array'
                                       then s.recipient_user_ids else '[]'::jsonb end)
        where jsonb_typeof(value) = 'string'
      loop
        -- OWNER DECISION #6(d): never deliver twice inside one hour slot
        if p_once_per_slot and exists (
          select 1 from compliance.notifications n
          where n.user_id = v_uid and n.type = 'system'
            and n.metadata->>'kind' = 'report_schedule'
            and n.metadata->>'reportScheduleId' = s.id
            and n.created_at >= date_trunc('hour', p_now)
        ) then
          v_slot_skipped := v_slot_skipped + 1;
          continue;
        end if;

        if p_dedup and exists (
          select 1 from compliance.notifications n
          where n.user_id = v_uid and n.type = 'system' and n.is_read = false
            and n.metadata->>'kind' = 'report_schedule'
            and n.metadata->>'reportScheduleId' = s.id
        ) then
          v_deduped := v_deduped + 1;
          continue;
        end if;

        if not p_dry_run then
          insert into compliance.notifications (user_id, title, message, type, metadata)
          values (
            v_uid,
            'Scheduled report ready: ' || s.report_id,                                  -- :243
            'Your ' || s.cadence || ' "' || s.report_id                                 -- :246 (body-less branch)
              || '" report is due. Open Reports to view it (no auto-generator is wired for this report id yet, so no content is attached here).',
            'system',
            jsonb_build_object(
              'kind', 'report_schedule',                -- added by this port (dedup key)
              'reportScheduleId', s.id,
              'reportId', s.report_id,
              'cadence', s.cadence,
              'report', null)                           -- OWNER DECISION #6(a)
          );
        end if;
        v_delivered := v_delivered + 1;
      end loop;

    exception when others then
      -- :252-254  per-schedule try/catch
      v_errors := v_errors + 1;
      raise warning 'cost001 cron_report_schedules: schedule % failed: % (%)', s.id, sqlerrm, sqlstate;
    end;
  end loop;

  -- :257  { checked, due, delivered } + this port's extra counters
  return jsonb_build_object(
    'checked', v_checked, 'due', v_due_n, 'delivered', v_delivered,
    'deduped', v_deduped, 'slotSkipped', v_slot_skipped, 'errors', v_errors,
    'utcHour', v_hour, 'dryRun', p_dry_run);
end
$fn$;

comment on function compliance.cron_report_schedules(boolean, boolean, timestamptz, int, boolean) is
  'COST-001 pg_cron port of runDueReportSchedules() (report-schedule-service.ts:226-258), BODY-LESS variant (OWNER DECISION #6), meant to run hourly. Prepared, owner-applied.';


-- 1b. no access for public, anon or authenticated
REVOKE ALL ON FUNCTION compliance.cron_report_schedules(boolean, boolean, timestamptz, integer, boolean) FROM public, anon, authenticated;

-- 2. the cron job (only where pg_cron is installed) -----------------------------------
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cost001-report-schedules') THEN
      PERFORM cron.unschedule('cost001-report-schedules');
    END IF;
    PERFORM cron.schedule('cost001-report-schedules', '5 * * * *', $cron$select compliance.cron_report_schedules();$cron$);
  END IF;
END
$do$;

COMMIT;
