-- ============================================================================
-- PROJEXA-COST-001 -- prepared pg_cron port -- cron 15: report-schedules
-- ============================================================================
-- STATUS      : PREPARED, NOT APPLIED. Owner rule: "Prepare, do not execute.
--               Branch only." Only the SELECT half was dry-run read-only on
--               2026-09-22 (counts in README_b.md).
-- Vercel route: GET /api/internal/report-schedules/run
-- Vercel cron : "45 8 * * *"  (vercel.json:21 -- daily 08:45 UTC)
-- Route file  : src/app/api/internal/report-schedules/run/route.ts:29
-- Mirrors     : src/lib/services/report-schedule-service.ts
--                 :100-148  isScheduleDue()      -- every cadence branch, see table
--                 :151-155  matchesTimeOfDay()   -- current UTC hour prefix "HH:"
--                 :226-258  runDueReportSchedules() -- active schedules, one
--                           notification per recipientUserIds entry
--               src/lib/services/report-taxonomy.ts:77-81 PERIODICITY_BASE_VALUES
--                 (15 values: hourly daily weekly biweekly fortnightly monthly
--                  bimonthly quarterly half_yearly yearly biyearly year_to_date
--                  custom_range immediate on_demand)
--
-- WHY THIS EXISTS: see 04_metric_alerts.sql's header (app_runtime has no
-- BYPASSRLS, so this route has read zero rows since ~2026-08-23; a pg_cron
-- job runs as postgres and re-enables it -- intended, owner-signed).
--
-- OWNER DECISION #6 -- THE BODY-LESS VARIANT, SCHEDULED HOURLY
--   (a) The TS report generators (KNOWN_REPORT_GENERATORS :220-224 ->
--       report-cadence-service.ts generateEscalationsReport /
--       generateRecommendationsReport / generateRiskTrendsReport) are NOT
--       ported. Every schedule -- including report_id 'escalations',
--       'recommendations' and 'risk_trends' -- gets the body-less
--       notification the TS already writes for an unknown generator at
--       :246 ("...no auto-generator is wired for this report id yet, so no
--       content is attached here."), with metadata.report = null and
--       metadata.reportId set. (The TS omits the `report` key entirely for
--       that path; this port writes it as an explicit JSON null so the
--       shape is uniform. `metadata->>'report'` reads NULL either way.)
--   (b) LATENT BUG in the Vercel schedule, explained: matchesTimeOfDay()
--       compares the CURRENT hour against times_of_day, and the Vercel cron
--       only ever ran at 08:45 UTC. So a daily schedule with
--       times_of_day = ["17:00"] could NEVER fire -- the only hour prefix
--       that ever matched was "08:". To let every configured hour match,
--       this job is scheduled HOURLY at minute 5 ('5 * * * *'); the function
--       then decides per schedule whether THIS hour is one of its hours.
--   (c) Consequence of (b) that needed a rule: for a schedule with EMPTY
--       times_of_day the TS says "fire once, whenever the cron itself runs"
--       (:150), which under a daily cron meant once at 08:xx. Under an
--       hourly cron the literal port would fire 24 times a day. So:
--       `p_default_hour int default 8` -- an empty times_of_day is treated
--       as [ '08:00' ], reproducing the old once-a-day-at-08 behaviour for
--       daily/weekly/monthly/... schedules. The one exception is cadence
--       'hourly' with empty times_of_day, which fires every hour -- that is
--       what "hourly" means, and what the TS comment at :107 intends.
--   (d) `p_once_per_slot boolean default true` -- skips a recipient who
--       already received this schedule's notification since the top of the
--       current hour (read or unread), so a manual re-run or a cron overlap
--       inside the same hour cannot double-deliver. This is a guard the TS
--       never needed under a once-a-day cron.
--
-- DEDUP CONVENTION (OWNER DECISION #3 / #7): `p_dedup boolean default true`
--   skips a recipient who already has an UNREAD notification with type
--   'system', metadata->>'kind' = 'report_schedule' and the same
--   metadata->>'reportScheduleId'. The TS metadata has no `kind` key; this
--   port ADDS it. `p_dedup => false` (with p_once_per_slot => false and
--   p_default_hour left at 8) reproduces today's TS delivery behaviour exactly
--   for every schedule that could actually fire under the old 08:45 cron,
--   apart from the added `kind` key. Trade-off with dedup ON: a weekly
--   report that sits unread suppresses the next week's notification.
--
-- CADENCE TABLE (isScheduleDue :100-148, evaluated on the UTC wall clock
-- exactly as the TS's getUTC*() calls do):
--   immediate, on_demand -> never cron-fired (:106)
--   hourly, daily        -> due every invocation (:107-108); times_of_day gates the hour
--   weekly, fortnightly  -> day_of_week == UTC dow (Sunday = 0, same as getUTCDay) (:110-119)
--   biweekly             -> day_of_week OR (day_of_week + 3) % 7 (:116)
--   monthly, bimonthly, quarterly, half_yearly, yearly, biyearly
--                        -> day_of_month clamped to the month's last day (:122-127).
--                           Honest limitation carried over from the TS (:92-98):
--                           the N-month cadences fire EVERY month on that day.
--   year_to_date         -> Jan 1 only (:129-132)
--   custom_range         -> start_date/end_date both set, today == end_date,
--                           start <= end (:134-145, date-only comparison)
--   anything else        -> false (:147)
--
-- OTHER NOTES
--   * Live columns verified 2026-09-22: report_schedules.times_of_day jsonb
--     (nullable), recipient_user_ids jsonb NOT NULL, start_date/end_date
--     date, day_of_week/day_of_month int4, created_by (not created_by_id).
--   * Live today: report_schedules has 0 rows -- this function is a no-op
--     until someone creates a schedule.
--   * Per-schedule try/catch (:235-254) -> per-schedule exception block,
--     counted in `errors`.
--
-- SWITCH-ON (owner runs): apply file -> select compliance.cron_report_schedules(p_dry_run => true);
--   -> uncomment cron.schedule below -> remove the Vercel cron entry in a
--   separate reviewed PR (vercel.json is out of this task's scope).
-- ============================================================================

create or replace function compliance.cron_report_schedules(
  p_dedup         boolean     default true,
  p_dry_run       boolean     default false,
  p_now           timestamptz default now(),
  p_default_hour  int         default 8,
  p_once_per_slot boolean     default true
) returns jsonb
language plpgsql
set search_path = compliance, platform, public
as $$
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
$$;

comment on function compliance.cron_report_schedules(boolean, boolean, timestamptz, int, boolean) is
  'COST-001 pg_cron port of runDueReportSchedules() (report-schedule-service.ts:226-258), BODY-LESS variant (OWNER DECISION #6), meant to run hourly. Prepared, owner-applied.';


-- ============================================================================
-- SCHEDULE (OWNER ACTION -- commented out)
--   HOURLY at :05, NOT the Vercel "45 8 * * *": see OWNER DECISION #6(b).
-- ============================================================================
-- select cron.schedule('cost001-report-schedules', '5 * * * *', $$select compliance.cron_report_schedules();$$);
--
-- Closest reproduction of the old Vercel behaviour (daily 08:45, no dedup,
-- no slot guard) if the owner prefers not to fix the latent bug yet:
-- select cron.schedule('cost001-report-schedules', '45 8 * * *', $$select compliance.cron_report_schedules(p_dedup => false, p_once_per_slot => false);$$);

-- ============================================================================
-- ROLLBACK (OWNER ACTION -- commented out)
-- ============================================================================
-- select cron.unschedule('cost001-report-schedules');
-- drop function if exists compliance.cron_report_schedules(boolean, boolean, timestamptz, int, boolean);
-- Rows written by this function: metadata->>'kind' = 'report_schedule'.
