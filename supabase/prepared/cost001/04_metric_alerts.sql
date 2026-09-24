-- ============================================================================
-- PROJEXA-COST-001 -- prepared pg_cron port -- cron 04: metric-alerts
-- ============================================================================
-- STATUS      : PREPARED, NOT APPLIED. Owner rule: "Prepare, do not execute.
--               Branch only." Nothing in this file has been run against any
--               database. Only the SELECT halves were dry-run read-only on
--               2026-09-22 (counts in README_b.md).
-- Vercel route: GET /api/internal/metric-alerts/run
-- Vercel cron : "0 5 * * *"  (vercel.json:10 -- daily 05:00 UTC)
-- Route file  : src/app/api/internal/metric-alerts/run/route.ts:51-58
--               (Promise.all over SIX independent checks)
--
-- WHY THIS EXISTS (framing, same for every file in this directory)
--   Production DATABASE_URL connects as `app_runtime`, a role WITHOUT
--   BYPASSRLS. Every one of these cron routes queries the raw `db` client
--   with no tenant context, so under RLS they have read ZERO rows since
--   ~2026-08-23 (live evidence: the last "SLA breached:" / stuck-deal
--   notification rows are dated 2026-08-21). A pg_cron job runs as the role
--   that called cron.schedule() -- `postgres`, which HAS BYPASSRLS -- so
--   scheduling these functions RE-ENABLES behaviour that has been silently
--   off for a month. That is intended, but it is an owner-signed switch-on,
--   not a neutral move. The functions below are SECURITY INVOKER on purpose:
--   called by `app_runtime` they would see the same zero rows the routes do
--   today; called by `postgres` (pg_cron) they see everything.
--
-- WHAT IS PORTED (six functions + one wrapper, mirroring the route's
-- Promise.all so a failure in one check cannot block the others):
--   compliance.cron_metric_alert_rules   <- src/lib/services/metric-alert-service.ts:88-156
--   compliance.cron_ticket_sla_breaches  <- src/lib/services/ticket-service.ts:264-284
--   compliance.cron_ticket_escalations   <- src/lib/services/ticket-service.ts:295-348
--   compliance.cron_task_overdue         <- src/lib/services/task-service.ts:564-584
--   compliance.cron_task_reprioritise    <- src/lib/services/task-reprioritization-service.ts:83-162
--   compliance.cron_cost_cap             <- src/lib/cost-guard.ts:32-47, 93-144
--                                           (buildSpendForecast is NOT used in
--                                           the notify decision -- ignored)
--   compliance.cron_metric_alerts        <- the route's Promise.all + per-check
--                                           try/catch (route.ts:51-63)
--
-- DEDUP CONVENTION (OWNER DECISION #3 / #7 -- applies to every
-- notification-writing function in this directory)
--   Every notification-writing function takes `p_dedup boolean default true`.
--   When true, a notification is NOT inserted for a user if an UNREAD
--   (is_read = false) notification with the same `type`, the same
--   `metadata->>'kind'` and the same entity id in metadata already exists
--   for that user. The TypeScript today re-notifies every run with no dedup
--   at all: live, the two demo tickets produced 132 "SLA breached:" rows =
--   2 tickets x 2 recipients x 33 daily runs (2026-07-10..2026-08-21).
--   `p_dedup => false` reproduces today's TS behaviour exactly (one row per
--   run per recipient, forever), with ONE deliberate difference that applies
--   with either setting: the TS metadata for the five checks in this file
--   carries NO `kind` key, so this port ADDS `metadata.kind` to every row it
--   writes (values listed per function below). Without it there is nothing
--   stable to dedup on. Consequence: the 132 legacy rows have no `kind`, so
--   the first pg_cron run with p_dedup=true will still write one fresh row
--   per (ticket, recipient) -- 4 today -- and only from the second run on
--   is the dedup effective. Dry-run proof in README_b.md.
--
-- OTHER NOTES
--   * `tasks`, `tickets` and `metric_alert_rules` all carry the live trigger
--     `auto_register_asset_trg` (AFTER INSERT/UPDATE/DELETE, SECURITY
--     DEFINER, owner postgres, -> compliance.auto_register_asset()). The
--     UPDATEs in cron_task_reprioritise, cron_ticket_escalations and
--     cron_metric_alert_rules fire it exactly as the Drizzle updates do
--     today. `tasks` additionally fires `trg_tsv_tasks` (BEFORE UPDATE).
--     Neither needs anything from this file.
--   * Overlap-safe: each function takes a transaction-scoped advisory lock
--     and returns {"skipped":"overlap"} instead of running twice.
--   * `p_dry_run => true` evaluates everything and returns the counts but
--     performs no INSERT/UPDATE -- the recommended first call after install.
--   * Each function returns jsonb counts; the wrapper returns all six under
--     the same keys the route's JSON response uses.
--   * Live column check (information_schema, 2026-09-22): every column
--     referenced below exists with the type assumed. Enum-typed columns
--     used by the metric-alert filter (compliance_items.status/priority,
--     notices.status, risks.status/category, pms_issues.priority,
--     incidents.stage) are cast from filter_value exactly as Drizzle's
--     parameter binding does -- an invalid label raises, is caught by the
--     per-rule exception block and counted in `errors`, matching the TS
--     per-rule try/catch at metric-alert-service.ts:134-152.
--
-- OWNER DECISION POINTS (this file)
--   #3  cron_task_overdue duplicates cron 10 (task-nudge-digest): both
--       notify a task's assignee about the same overdue task, on the same
--       morning, with type 'deadline_reminder'. Keep ONE. See 10_*.sql.
--   #4a The sourceEntity -> table/column whitelist (metric-alert-service.ts
--       :96-119) is re-encoded as a SQL CASE below. It MUST stay in sync
--       with custom-report-service.ts's GROUP_BY_FIELDS (:21-33). Mapping:
--         compliance_items : status(enum compliance_status), priority(enum
--                            priority), departmentId -> department_id
--         notices          : status(enum notice_status), authority
--         risks            : status(enum risk_status), category(enum risk_category)
--         pms_issues       : priority(enum pms_issue_priority), statusId -> status_id
--         incidents        : severity(text), stage(enum incident_stage)
--         construction_boqs / construction_work_progress_entries /
--         construction_attendance : VALID sourceEntity per GROUP_BY_FIELDS
--                            but NO branch in countMetric() -> TS returns 0
--                            (`default: return 0`, :117-118). Ported as 0,
--                            which means an `lt`/`lte`/`eq 0` rule on those
--                            entities "breaches" every run -- same as today.
--         anything else    : isValidSourceEntity() false -> skipped (:133).
--   #4b countMetric() did `SELECT *` then `.length` (:92-93); ported as
--       count(*). Same number, no row transfer.
--   #4c cron_ticket_escalations applies escalation_rules in step_order
--       (then created_at, id). The TS iterated in unspecified DB order; when
--       two rules fire on the same run the LAST applied rule's team/assignee
--       wins, so ordering by step_order makes "highest step wins" explicit.
--   #4d cron_cost_cap dedups on (orgId, breach level): an unread "near"
--       alert does NOT suppress a later "over" alert. Recipients are users
--       with role admin/manager regardless of is_active (TS does not filter
--       on is_active either -- cost-guard.ts:118-120).
--   #4e Metadata key names are camelCase exactly as the TS writes them
--       (metricAlertRuleId, ticketId, conversationId, escalationRuleId,
--       taskId, orgId ...) so the existing topbar click-through keeps working.
--
-- SWITCH-ON (owner runs, in order; nothing here does it)
--   1. Apply this file (creates/replaces 7 functions, no data change).
--   2. select compliance.cron_metric_alerts(p_dry_run => true);   -- inspect
--   3. Uncomment and run the cron.schedule line at the bottom.
--   4. Observe: select * from cron.job_run_details order by start_time desc;
--   5. Remove the route from vercel.json's "crons" array in a separate,
--      reviewed PR (NOT done here -- vercel.json is out of this task's scope).
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1/6  metric_alert_rules  (metric-alert-service.ts:88-156)
-- ----------------------------------------------------------------------------
create or replace function compliance.cron_metric_alert_rules(
  p_dedup   boolean default true,
  p_dry_run boolean default false
) returns jsonb
language plpgsql
set search_path = compliance, platform, public
as $$
declare
  r               record;
  v_uid           text;
  v_value         bigint;
  v_breached      boolean;
  v_checked       int := 0;
  v_breached_n    int := 0;
  v_skipped       int := 0;
  v_notified      int := 0;
  v_deduped       int := 0;
  v_errors        int := 0;
begin
  if not pg_try_advisory_xact_lock(hashtext('cost001'), hashtext('metric_alert_rules')) then
    return jsonb_build_object('skipped', 'overlap');
  end if;

  -- :129  every active rule across every org (raw db, no tenant scope)
  for r in
    select * from compliance.metric_alert_rules
    where is_active = true
    order by created_at, id
  loop
    v_checked := v_checked + 1;

    -- :133  isValidSourceEntity() == key of GROUP_BY_FIELDS (custom-report-service.ts:21-33)
    if r.source_entity not in (
      'compliance_items', 'notices', 'risks', 'pms_issues', 'incidents',
      'construction_boqs', 'construction_work_progress_entries', 'construction_attendance'
    ) then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    begin
      -- :88-120  countMetric(): whitelisted count, filter applied only when the
      -- filterField maps to a known column AND filterValue is not null (:91).
      v_value := case r.source_entity
        when 'compliance_items' then (
          select count(*) from compliance.compliance_items t
          where t.org_id = r.org_id
            and (r.filter_value is null or case r.filter_field
                  when 'status'       then t.status   = r.filter_value::compliance.compliance_status
                  when 'priority'     then t.priority = r.filter_value::compliance.priority
                  when 'departmentId' then t.department_id = r.filter_value
                  else true end))
        when 'notices' then (
          select count(*) from compliance.notices t
          where t.org_id = r.org_id
            and (r.filter_value is null or case r.filter_field
                  when 'status'    then t.status    = r.filter_value::compliance.notice_status
                  when 'authority' then t.authority = r.filter_value
                  else true end))
        when 'risks' then (
          select count(*) from compliance.risks t
          where t.org_id = r.org_id
            and (r.filter_value is null or case r.filter_field
                  when 'status'   then t.status   = r.filter_value::compliance.risk_status
                  when 'category' then t.category = r.filter_value::compliance.risk_category
                  else true end))
        when 'pms_issues' then (
          select count(*) from compliance.pms_issues t
          where t.org_id = r.org_id
            and (r.filter_value is null or case r.filter_field
                  when 'priority' then t.priority  = r.filter_value::compliance.pms_issue_priority
                  when 'statusId' then t.status_id = r.filter_value
                  else true end))
        when 'incidents' then (
          select count(*) from compliance.incidents t
          where t.org_id = r.org_id
            and (r.filter_value is null or case r.filter_field
                  when 'severity' then t.severity = r.filter_value
                  when 'stage'    then t.stage    = r.filter_value::compliance.incident_stage
                  else true end))
        else 0   -- construction_* : valid entity, no countMetric branch -> 0 (:117-118)
      end;

      -- :22-30  compare(); an unknown operator yields undefined (falsy) in TS -> false here
      v_breached := case r.operator
        when 'gt'  then v_value >  r.threshold
        when 'gte' then v_value >= r.threshold
        when 'lt'  then v_value <  r.threshold
        when 'lte' then v_value <= r.threshold
        when 'eq'  then v_value =  r.threshold
        else false end;

      if v_breached then
        v_breached_n := v_breached_n + 1;

        -- :138-147  one notification per notifyUserIds entry (type 'system')
        if jsonb_typeof(r.notify_user_ids) = 'array' then
          for v_uid in
            select value #>> '{}' from jsonb_array_elements(r.notify_user_ids)
            where jsonb_typeof(value) = 'string'
          loop
            if p_dedup and exists (
              select 1 from compliance.notifications n
              where n.user_id = v_uid and n.type = 'system' and n.is_read = false
                and n.metadata->>'kind' = 'metric_alert'
                and n.metadata->>'metricAlertRuleId' = r.id
            ) then
              v_deduped := v_deduped + 1;
              continue;
            end if;

            if not p_dry_run then
              insert into compliance.notifications (user_id, title, message, type, metadata)
              values (
                v_uid,
                'Metric alert: ' || r.name,
                r.source_entity
                  || case when nullif(r.filter_field, '') is not null
                          then ' (' || r.filter_field || '=' || coalesce(r.filter_value, 'null') || ')'
                          else '' end
                  || ' is ' || v_value::text || ', which is ' || r.operator || ' ' || r.threshold::text || '.',
                'system',
                jsonb_build_object(
                  'kind', 'metric_alert',                 -- added by this port (dedup key)
                  'metricAlertRuleId', r.id,
                  'value', v_value,
                  'threshold', r.threshold,
                  'operator', r.operator)
              );
            end if;
            v_notified := v_notified + 1;
          end loop;
        end if;

        -- :148  lastTriggeredAt is stamped whenever the rule breached, notified or not
        if not p_dry_run then
          update compliance.metric_alert_rules set last_triggered_at = now() where id = r.id;
        end if;
      end if;

    exception when others then
      -- :150-152  per-rule try/catch: log and move on
      v_errors := v_errors + 1;
      raise warning 'cost001 cron_metric_alert_rules: rule % failed: % (%)', r.id, sqlerrm, sqlstate;
    end;
  end loop;

  return jsonb_build_object(
    'checked', v_checked, 'breached', v_breached_n,
    'skippedInvalidEntity', v_skipped, 'notified', v_notified,
    'deduped', v_deduped, 'errors', v_errors, 'dryRun', p_dry_run);
end
$$;

comment on function compliance.cron_metric_alert_rules(boolean, boolean) is
  'COST-001 pg_cron port of evaluateAllMetricAlertRules() (metric-alert-service.ts:128-156). Prepared, owner-applied. See supabase/prepared/cost001/04_metric_alerts.sql.';


-- ----------------------------------------------------------------------------
-- 2/6  ticket_sla_breaches  (ticket-service.ts:264-284)
-- ----------------------------------------------------------------------------
create or replace function compliance.cron_ticket_sla_breaches(
  p_dedup   boolean default true,
  p_dry_run boolean default false
) returns jsonb
language plpgsql
set search_path = compliance, platform, public
as $$
declare
  t          record;
  v_uid      text;
  v_breached int := 0;
  v_notified int := 0;
  v_deduped  int := 0;
begin
  if not pg_try_advisory_xact_lock(hashtext('cost001'), hashtext('ticket_sla_breaches')) then
    return jsonb_build_object('skipped', 'overlap');
  end if;

  -- :266-268  slaDeadline < now AND status not in (resolved, closed)
  for t in
    select id, subject, status, sla_deadline, conversation_id, assignee_id, created_by_id
    from compliance.tickets
    where sla_deadline < now()
      and status not in ('resolved', 'closed')
    order by sla_deadline, id
  loop
    v_breached := v_breached + 1;

    -- :271  new Set([assigneeId, createdById].filter(Boolean))
    for v_uid in
      select distinct x from unnest(array[t.assignee_id, t.created_by_id]) as x
      where nullif(x, '') is not null
    loop
      if p_dedup and exists (
        select 1 from compliance.notifications n
        where n.user_id = v_uid and n.type = 'system' and n.is_read = false
          and n.metadata->>'kind' = 'ticket_sla_breach'
          and n.metadata->>'ticketId' = t.id
      ) then
        v_deduped := v_deduped + 1;
        continue;
      end if;

      if not p_dry_run then
        insert into compliance.notifications (user_id, title, message, type, metadata)
        values (
          v_uid,
          'SLA breached: ' || t.subject,
          -- :276  slaDeadline.toISOString() == YYYY-MM-DDTHH:MM:SS.mmmZ (UTC)
          'Ticket "' || t.subject || '" missed its SLA deadline ('
            || to_char(t.sla_deadline at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
            || ') and is still ' || t.status || '.',
          'system',
          jsonb_build_object(
            'kind', 'ticket_sla_breach',                -- added by this port (dedup key)
            'ticketId', t.id,
            'conversationId', t.conversation_id)
        );
      end if;
      v_notified := v_notified + 1;
    end loop;
  end loop;

  return jsonb_build_object(
    'breached', v_breached, 'notified', v_notified,
    'deduped', v_deduped, 'dryRun', p_dry_run);
end
$$;

comment on function compliance.cron_ticket_sla_breaches(boolean, boolean) is
  'COST-001 pg_cron port of checkTicketSlaBreaches() (ticket-service.ts:264-284). Prepared, owner-applied.';


-- ----------------------------------------------------------------------------
-- 3/6  ticket_escalations  (ticket-service.ts:295-348)
--      Idempotent per (ticket, escalation rule) via ticket_escalation_events
--      exactly as the TS is; p_dedup is additionally honoured for the
--      notification rows (harmless, the events table already prevents a
--      second fire).
-- ----------------------------------------------------------------------------
create or replace function compliance.cron_ticket_escalations(
  p_dedup   boolean default true,
  p_dry_run boolean default false
) returns jsonb
language plpgsql
set search_path = compliance, platform, public
as $$
declare
  t            record;
  rl           record;
  v_uid        text;
  v_elapsed    numeric;
  v_candidates int := 0;
  v_escalated  int := 0;
  v_tickets_updated int := 0;
  v_notified   int := 0;
  v_deduped    int := 0;
begin
  if not pg_try_advisory_xact_lock(hashtext('cost001'), hashtext('ticket_escalations')) then
    return jsonb_build_object('skipped', 'overlap');
  end if;

  -- :297-304  open tickets with a real slaPolicyId + slaDeadline; policy must exist
  --           (findFirst has no is_active filter -- mirrored: plain inner join)
  for t in
    select t.id, t.subject, t.conversation_id, t.sla_deadline,
           p.id as policy_id, p.resolution_hours
    from compliance.tickets t
    join compliance.sla_policies p on p.id = t.sla_policy_id
    where t.status not in ('resolved', 'closed')
      and t.sla_policy_id is not null
      and t.sla_deadline is not null
    order by t.created_at, t.id
  loop
    v_candidates := v_candidates + 1;

    -- :306-307  totalMs <= 0 -> skip
    continue when coalesce(t.resolution_hours, 0) <= 0;

    -- :308-310  elapsedPercent = (now - (deadline - resolutionHours)) / resolutionHours * 100
    v_elapsed := extract(epoch from (now() - (t.sla_deadline - make_interval(hours => t.resolution_hours))))
                 / (t.resolution_hours * 3600.0) * 100;

    -- :312  rules for this policy (OWNER DECISION #4c: explicit step_order)
    for rl in
      select id, threshold_percent, escalate_to_team_id, escalate_to_user_id, notify_user_ids
      from compliance.escalation_rules
      where sla_policy_id = t.policy_id
      order by step_order, created_at, id
    loop
      -- :314  not yet matured
      continue when v_elapsed < rl.threshold_percent;

      -- :316-319  already fired for this (ticket, rule) -> idempotent skip
      continue when exists (
        select 1 from compliance.ticket_escalation_events e
        where e.ticket_id = t.id and e.escalation_rule_id = rl.id);

      -- :321-326  reassign team and/or assignee, stamp updatedAt
      if rl.escalate_to_team_id is not null or rl.escalate_to_user_id is not null then
        if not p_dry_run then
          update compliance.tickets
          set team_id     = coalesce(rl.escalate_to_team_id, team_id),
              assignee_id = coalesce(rl.escalate_to_user_id, assignee_id),
              updated_at  = now()
          where id = t.id;
        end if;
        v_tickets_updated := v_tickets_updated + 1;
      end if;

      -- :328-331  Set([escalateToUserId, ...notifyUserIds]) filtered to non-empty strings
      for v_uid in
        select distinct x from (
          select rl.escalate_to_user_id as x
          union all
          select value #>> '{}'
          from jsonb_array_elements(case when jsonb_typeof(rl.notify_user_ids) = 'array'
                                         then rl.notify_user_ids else '[]'::jsonb end)
          where jsonb_typeof(value) = 'string'
        ) s
        where nullif(x, '') is not null
      loop
        if p_dedup and exists (
          select 1 from compliance.notifications n
          where n.user_id = v_uid and n.type = 'system' and n.is_read = false
            and n.metadata->>'kind' = 'ticket_escalation'
            and n.metadata->>'ticketId' = t.id
            and n.metadata->>'escalationRuleId' = rl.id
        ) then
          v_deduped := v_deduped + 1;
          continue;
        end if;

        if not p_dry_run then
          insert into compliance.notifications (user_id, title, message, type, metadata)
          values (
            v_uid,
            'Ticket escalated: ' || t.subject,
            'Ticket "' || t.subject || '" reached ' || rl.threshold_percent::text
              || '% of its SLA window and was escalated.',
            'system',
            jsonb_build_object(
              'kind', 'ticket_escalation',              -- added by this port (dedup key)
              'ticketId', t.id,
              'conversationId', t.conversation_id,
              'escalationRuleId', rl.id)
          );
        end if;
        v_notified := v_notified + 1;
      end loop;

      -- :342  record the fire (this is what makes the whole check idempotent)
      if not p_dry_run then
        insert into compliance.ticket_escalation_events (ticket_id, escalation_rule_id)
        values (t.id, rl.id);
      end if;
      v_escalated := v_escalated + 1;
    end loop;
  end loop;

  return jsonb_build_object(
    'candidates', v_candidates, 'escalated', v_escalated,
    'ticketsUpdated', v_tickets_updated, 'notified', v_notified,
    'deduped', v_deduped, 'dryRun', p_dry_run);
end
$$;

comment on function compliance.cron_ticket_escalations(boolean, boolean) is
  'COST-001 pg_cron port of checkTicketEscalations() (ticket-service.ts:295-348). Prepared, owner-applied.';


-- ----------------------------------------------------------------------------
-- 4/6  task_overdue  (task-service.ts:564-584)   -- see OWNER DECISION #3
-- ----------------------------------------------------------------------------
create or replace function compliance.cron_task_overdue(
  p_dedup   boolean default true,
  p_dry_run boolean default false
) returns jsonb
language plpgsql
set search_path = compliance, platform, public
as $$
declare
  t          record;
  v_uid      text;
  v_overdue  int := 0;
  v_notified int := 0;
  v_deduped  int := 0;
begin
  if not pg_try_advisory_xact_lock(hashtext('cost001'), hashtext('task_overdue')) then
    return jsonb_build_object('skipped', 'overlap');
  end if;

  -- :566-568  dueDate < now AND status not in (completed, cancelled)
  for t in
    select id, title, status, due_date, user_id, assigned_by_id
    from compliance.tasks
    where due_date < now()
      and status not in ('completed', 'cancelled')
    order by due_date, id
  loop
    v_overdue := v_overdue + 1;

    -- :571  new Set([userId, assignedById].filter(Boolean))
    for v_uid in
      select distinct x from unnest(array[t.user_id, t.assigned_by_id]) as x
      where nullif(x, '') is not null
    loop
      if p_dedup and exists (
        select 1 from compliance.notifications n
        where n.user_id = v_uid and n.type = 'deadline_reminder' and n.is_read = false
          and n.metadata->>'kind' = 'task_overdue'
          and n.metadata->>'taskId' = t.id
      ) then
        v_deduped := v_deduped + 1;
        continue;
      end if;

      if not p_dry_run then
        insert into compliance.notifications (user_id, title, message, type, metadata)
        values (
          v_uid,
          'Task overdue: ' || t.title,
          'Task "' || t.title || '" missed its due date ('
            || to_char(t.due_date at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
            || ') and is still ' || t.status || '.',
          'deadline_reminder',
          jsonb_build_object(
            'kind', 'task_overdue',                     -- added by this port (dedup key)
            'taskId', t.id)
        );
      end if;
      v_notified := v_notified + 1;
    end loop;
  end loop;

  return jsonb_build_object(
    'overdue', v_overdue, 'notified', v_notified,
    'deduped', v_deduped, 'dryRun', p_dry_run);
end
$$;

comment on function compliance.cron_task_overdue(boolean, boolean) is
  'COST-001 pg_cron port of checkTaskOverdue() (task-service.ts:564-584). Prepared, owner-applied. OWNER DECISION #3: overlaps cron 10 task-nudge-digest -- keep one.';


-- ----------------------------------------------------------------------------
-- 5/6  task_reprioritise  (task-reprioritization-service.ts:83-162)
--      Real WRITE to tasks.priority. Escalation-only, never lowers.
--      Idempotent per row (floor <= priority -> no write). Writes no
--      notifications, so no p_dedup parameter; p_now mirrors the TS `now`
--      argument so a run can be replayed against a fixed instant.
-- ----------------------------------------------------------------------------
create or replace function compliance.cron_task_reprioritise(
  p_dry_run boolean     default false,
  p_now     timestamptz default now()
) returns jsonb
language plpgsql
set search_path = compliance, platform, public
as $$
declare
  t           record;
  v_secs      numeric;
  v_floor     int;
  v_reason    text;
  v_evaluated int := 0;
  v_updates   jsonb := '[]'::jsonb;
begin
  if not pg_try_advisory_xact_lock(hashtext('cost001'), hashtext('task_reprioritise')) then
    return jsonb_build_object('skipped', 'overlap');
  end if;

  -- :135-137  dueDate not null AND status not in TERMINAL_STATUSES
  for t in
    select id, org_id, priority, due_date
    from compliance.tasks
    where due_date is not null
      and status not in ('completed', 'cancelled')
    order by due_date, id
  loop
    v_evaluated := v_evaluated + 1;

    -- :90-105  computeReprioritizedPriority(): deterministic floor by proximity
    v_secs := extract(epoch from (t.due_date - p_now));
    if v_secs < 0 then
      v_floor := 3; v_reason := 'overdue';            -- PRIORITY_URGENT
    elsif v_secs < 24 * 3600 then
      v_floor := 2; v_reason := 'due_within_24h';     -- PRIORITY_HIGH
    elsif v_secs < 72 * 3600 then
      v_floor := 1; v_reason := 'due_within_72h';     -- PRIORITY_NORMAL
    else
      continue;                                       -- too far out, no signal
    end if;

    -- :107  already at/above the floor -> no write (this is the idempotency)
    continue when v_floor <= t.priority;
    -- :146  VALID_PRIORITIES guard (task-service.ts:352 = [0,1,2,3]); defensive
    continue when v_floor not in (0, 1, 2, 3);

    -- :148-156
    if not p_dry_run then
      update compliance.tasks
      set priority                     = v_floor,
          last_reprioritized_at        = p_now,
          last_reprioritization_reason = v_reason,
          updated_at                   = p_now
      where id = t.id;
    end if;

    v_updates := v_updates || jsonb_build_object(
      'id', t.id, 'orgId', t.org_id, 'from', t.priority, 'to', v_floor, 'reason', v_reason);
  end loop;

  return jsonb_build_object(
    'evaluated', v_evaluated, 'updated', jsonb_array_length(v_updates),
    'updates', v_updates, 'dryRun', p_dry_run);
end
$$;

comment on function compliance.cron_task_reprioritise(boolean, timestamptz) is
  'COST-001 pg_cron port of reprioritizeTasks() (task-reprioritization-service.ts:130-162). Escalation-only write to tasks.priority. Prepared, owner-applied.';


-- ----------------------------------------------------------------------------
-- 6/6  cost_cap  (cost-guard.ts:32-47 getMonthlySpend, :49-58 getCostStatus,
--      :93-97 classifyCostBreach, :99-144 checkCostCeilingBreaches)
-- ----------------------------------------------------------------------------
create or replace function compliance.cron_cost_cap(
  p_dedup   boolean default true,
  p_dry_run boolean default false
) returns jsonb
language plpgsql
set search_path = compliance, platform, public
as $$
declare
  o             record;
  u             record;
  v_month_start timestamptz;
  v_cap         numeric;
  v_spend       numeric;
  v_breach      text;
  v_title       text;
  v_message     text;
  v_checked     int := 0;
  v_over        int := 0;
  v_near        int := 0;
  v_notified    int := 0;
  v_deduped     int := 0;
  v_errors      int := 0;
begin
  if not pg_try_advisory_xact_lock(hashtext('cost001'), hashtext('cost_cap')) then
    return jsonb_build_object('skipped', 'overlap');
  end if;

  -- :32-35  startOfCurrentMonthUtc() -- computed in UTC regardless of session TimeZone
  v_month_start := (date_trunc('month', now() at time zone 'UTC')) at time zone 'UTC';

  -- :100-102  enforcement on AND a cap set
  for o in
    select id, name, monthly_cost_cap_usd
    from compliance.organisations
    where cost_cap_enforcement_enabled = true
      and monthly_cost_cap_usd is not null
    order by id
  loop
    v_checked := v_checked + 1;
    begin
      v_cap := o.monthly_cost_cap_usd;

      -- :37-47  getMonthlySpend(): product_orchestra rows this UTC month
      select coalesce(sum(estimated_cost_usd), 0) into v_spend
      from compliance.token_usage_ledger
      where org_id = o.id
        and scope = 'product_orchestra'
        and created_at >= v_month_start;

      -- :55-56, :93-97  isOverLimit / isNearLimit (0.8) -> 'over' | 'near' | 'none'
      v_breach := case
        when v_spend >= v_cap       then 'over'
        when v_spend >= v_cap * 0.8 then 'near'
        else 'none' end;
      continue when v_breach = 'none';

      if v_breach = 'over' then v_over := v_over + 1; else v_near := v_near + 1; end if;

      -- :122-127  title/message; toFixed(2) == FM...0.00, Math.round == round()
      if v_breach = 'over' then
        v_title   := 'AI spend cap reached: ' || o.name;
        v_message := o.name || ' has reached its monthly AI spend cap of $'
          || to_char(v_cap, 'FM999999999990.00') || ' (current spend: $'
          || to_char(v_spend, 'FM999999999990.00')
          || '). Further AI usage is blocked until the cap is raised or the month resets.';
      else
        v_title   := 'AI spend approaching cap: ' || o.name;
        v_message := o.name || ' has used $' || to_char(v_spend, 'FM999999999990.00')
          || ' of its $' || to_char(v_cap, 'FM999999999990.00')
          || ' monthly AI spend cap (' || round(v_spend / v_cap * 100)::text || '%).';
      end if;

      -- :118-120  recipients: admin/manager of the org (no is_active filter in TS)
      for u in
        select id from compliance.users
        where org_id = o.id and role in ('admin', 'manager')
        order by id
      loop
        -- OWNER DECISION #4d: dedup key includes the breach level
        if p_dedup and exists (
          select 1 from compliance.notifications n
          where n.user_id = u.id and n.type = 'system' and n.is_read = false
            and n.metadata->>'kind' = 'cost_cap_breach'
            and n.metadata->>'orgId' = o.id
            and n.metadata->>'breach' = v_breach
        ) then
          v_deduped := v_deduped + 1;
          continue;
        end if;

        if not p_dry_run then
          insert into compliance.notifications (user_id, title, message, type, metadata)
          values (
            u.id, v_title, v_message, 'system',
            jsonb_build_object(
              'kind', 'cost_cap_breach',                -- added by this port (dedup key)
              'orgId', o.id,
              'breach', v_breach,
              'monthlyCostCapUsd', v_cap,
              'currentSpendUsd', v_spend)
          );
        end if;
        v_notified := v_notified + 1;
      end loop;

    exception when others then
      -- :138-140  per-org try/catch
      v_errors := v_errors + 1;
      raise warning 'cost001 cron_cost_cap: org % failed: % (%)', o.id, sqlerrm, sqlstate;
    end;
  end loop;

  return jsonb_build_object(
    'checked', v_checked, 'overLimit', v_over, 'nearLimit', v_near,
    'notified', v_notified, 'deduped', v_deduped, 'errors', v_errors, 'dryRun', p_dry_run);
end
$$;

comment on function compliance.cron_cost_cap(boolean, boolean) is
  'COST-001 pg_cron port of checkCostCeilingBreaches() (cost-guard.ts:99-144). Prepared, owner-applied.';


-- ----------------------------------------------------------------------------
-- WRAPPER  cron_metric_alerts  (route.ts:51-58 Promise.all)
--   Each check runs in its own BEGIN ... EXCEPTION block (a plpgsql
--   subtransaction): a failing check's partial writes roll back and its
--   error is returned under its key, while the other five still run and
--   commit -- the SQL equivalent of six independent promises.
-- ----------------------------------------------------------------------------
create or replace function compliance.cron_metric_alerts(
  p_dedup   boolean default true,
  p_dry_run boolean default false
) returns jsonb
language plpgsql
set search_path = compliance, platform, public
as $$
declare
  v_out jsonb := jsonb_build_object('ranAt', now(), 'dedup', p_dedup, 'dryRun', p_dry_run);
  v_res jsonb;
begin
  if not pg_try_advisory_xact_lock(hashtext('cost001'), hashtext('metric_alerts')) then
    return jsonb_build_object('skipped', 'overlap');
  end if;

  begin v_res := compliance.cron_metric_alert_rules(p_dedup, p_dry_run);
  exception when others then v_res := jsonb_build_object('error', sqlerrm, 'sqlstate', sqlstate); end;
  v_out := v_out || jsonb_build_object('metricAlerts', v_res);

  begin v_res := compliance.cron_ticket_sla_breaches(p_dedup, p_dry_run);
  exception when others then v_res := jsonb_build_object('error', sqlerrm, 'sqlstate', sqlstate); end;
  v_out := v_out || jsonb_build_object('ticketSla', v_res);

  begin v_res := compliance.cron_ticket_escalations(p_dedup, p_dry_run);
  exception when others then v_res := jsonb_build_object('error', sqlerrm, 'sqlstate', sqlstate); end;
  v_out := v_out || jsonb_build_object('ticketEscalations', v_res);

  begin v_res := compliance.cron_task_overdue(p_dedup, p_dry_run);
  exception when others then v_res := jsonb_build_object('error', sqlerrm, 'sqlstate', sqlstate); end;
  v_out := v_out || jsonb_build_object('taskOverdue', v_res);

  begin v_res := compliance.cron_task_reprioritise(p_dry_run => p_dry_run);
  exception when others then v_res := jsonb_build_object('error', sqlerrm, 'sqlstate', sqlstate); end;
  v_out := v_out || jsonb_build_object('taskReprioritization', v_res);

  begin v_res := compliance.cron_cost_cap(p_dedup, p_dry_run);
  exception when others then v_res := jsonb_build_object('error', sqlerrm, 'sqlstate', sqlstate); end;
  v_out := v_out || jsonb_build_object('costCeiling', v_res);

  return v_out;
end
$$;

comment on function compliance.cron_metric_alerts(boolean, boolean) is
  'COST-001 pg_cron wrapper for /api/internal/metric-alerts/run (route.ts:51-58): runs the six checks in isolated subtransactions and returns all six results. Prepared, owner-applied.';


-- ============================================================================
-- SCHEDULE (OWNER ACTION -- deliberately commented out; same "0 5 * * *" as
-- vercel.json:10. pg_cron uses the server's TimeZone, which is UTC here.)
-- ============================================================================
-- select cron.schedule('cost001-metric-alerts', '0 5 * * *', $$select compliance.cron_metric_alerts();$$);
--
-- To reproduce today's TS behaviour exactly (no dedup), schedule instead:
-- select cron.schedule('cost001-metric-alerts', '0 5 * * *', $$select compliance.cron_metric_alerts(p_dedup => false);$$);

-- ============================================================================
-- ROLLBACK (OWNER ACTION -- commented out)
-- ============================================================================
-- select cron.unschedule('cost001-metric-alerts');
-- drop function if exists compliance.cron_metric_alerts(boolean, boolean);
-- drop function if exists compliance.cron_cost_cap(boolean, boolean);
-- drop function if exists compliance.cron_task_reprioritise(boolean, timestamptz);
-- drop function if exists compliance.cron_task_overdue(boolean, boolean);
-- drop function if exists compliance.cron_ticket_escalations(boolean, boolean);
-- drop function if exists compliance.cron_ticket_sla_breaches(boolean, boolean);
-- drop function if exists compliance.cron_metric_alert_rules(boolean, boolean);
-- Notification rows written by these functions are identifiable by
-- metadata->>'kind' in ('metric_alert','ticket_sla_breach','ticket_escalation',
-- 'task_overdue','cost_cap_breach') if the owner ever wants to purge them;
-- tasks.priority / tickets.team_id|assignee_id changes are NOT reversible
-- from this file (the TS never was either).
