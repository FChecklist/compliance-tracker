-- PROJEXA-BUILD-001 U-41 part B (PROJEXA-COST-001, PMD-12): metric alerts (six checks and a wrapper) move off the Vercel cron onto pg_cron.
-- Replaces vercel.json "/api/internal/metric-alerts/run", 0 5 * * *.
--
-- WHAT
--   seven functions, each returning jsonb: cron_metric_alert_rules, cron_ticket_sla_breaches, cron_ticket_escalations,
--     cron_task_overdue, cron_task_reprioritise, cron_cost_cap and the wrapper cron_metric_alerts(p_dedup, p_dry_run), which runs the
--     six checks each in its own sub-transaction (one failing check does not stop the others).
--   cron job 'cost001-metric-alerts' at '0 5 * * *' (UTC), command: select compliance.cron_metric_alerts();
--   Pure SQL: no /api/internal route, no net.http_post, no Vault secret, no table, no grant (only a revoke).
--
-- SOURCE
--   supabase/prepared/cost001/04_metric_alerts.sql: the function text is copied with four changes. (1) The dollar-quote tag is fn where the
--   prepared file used the bare pair. (2) In cron_ticket_escalations the loop record variable t is renamed tk. The prepared file declares
--   `t record` and also aliases compliance.tickets as t in the loop query, and PL/pgSQL then reads t.id as a field of the still
--   unassigned record: the function stops with 'record "t" is not assigned yet' (SQLSTATE 55000) on every run, even when the tickets
--   table is empty (reproduced on PGlite, PostgreSQL 18.3). The wrapper catches that error inside its own sub-block and returns it under
--   ticketEscalations instead of raising, so a call of the wrapper that only checks it did not raise cannot show it. The prepared file
--   is left as it is (it is not edited here); the PGlite test of this migration fails on the unrenamed text. (3) In cron_task_overdue the
--   dedup also skips a recipient whose unread digest lists the task as overdue (see DECISIONS APPLIED). (4) In the wrapper each catch block
--   also raises a WARNING, 'cost001 cron_metric_alerts: check <key> failed: <message> (<sqlstate>)', so a failed check shows in the
--   Postgres log and not only under its result key. That file holds the reasoning, the column checks and the owner decision table; its
--   README records the live dry runs of 2026-09-22 and 2026-09-24.
--   Every table and column used was re-checked on 2026-09-26 against src/lib/db/schema.ts and the live catalog (read only): none missing.
--
-- DECISIONS APPLIED (PM, under the owner's delegation)
--  Notification dedup stays ON (p_dedup default true, decisions 3 and 7): a recipient with an unread notification of the same
--  type and metadata kind (plus the same entity id) gets no second one.
--  The wrapper runs cron_task_overdue too, and the digest of 0636 is kept (PMD-44). The two overlap: both tell the owner of a task that
--  it is overdue. Their metadata kinds differ (task_overdue and task_nudge_digest), so the per-kind dedup alone does not make either
--  skip the other and a user would get both. The two functions therefore check each other by task id: cron_task_overdue skips a
--  recipient whose unread digest already lists the task in overdueTaskIds, and the digest leaves out an overdue task the owner
--  already has an unread task_overdue notice for. Both checks are part of p_dedup, so p_dedup => false still repeats everything.
--  The assigner (assigned_by_id) is never a digest recipient, so the assigner keeps getting the task_overdue notice.
--
-- LIVE COUNTS 2026-09-26 (read only)
--  metric_alert_rules active 0. Open tickets past their SLA deadline: 2 (the prepared README counted 0 on 2026-09-24), so the
--  first live run writes up to 2 tickets x 2 recipients of 'SLA breached' rows; the 132 legacy rows carry no kind, so they do not
--  suppress it. Tasks: statuses are completed and failed only, 0 overdue and not done, 0 to reprioritise.
--  Organisations with cost-cap enforcement on and a cap set: 255 (the README counted 0), all at 20.00; 0 are near or over this
--  UTC month, so cost_cap writes nothing today.
--
-- GRANTS: SECURITY INVOKER (no privilege of its own), search_path pinned to compliance, platform, public, EXECUTE revoked from
--   public, anon and authenticated. The job runs as postgres, which owns the function, so it also bypasses row level security:
--   this switches on cross-org behaviour that read zero rows while the production connection was app_runtime.
--
-- DATA LOSS: none from this file. A run inserts notification rows (kinds metric_alert, ticket_sla_breach, ticket_escalation, task_overdue, cost_cap_breach), may raise tasks.priority and may reassign tickets.team_id and assignee_id. Those field changes cannot be undone from SQL.
--
-- FIRST LIVE CALL: select compliance.cron_metric_alerts(p_dry_run => true);
--   Read every key of the result. The wrapper catches a raise inside any of its six checks and returns it as {error, sqlstate} under
--   that check's key, so cron.job_run_details shows the run as succeeded even when a check failed. Any error key means a check raised.
--   A scheduled run leaves no result to read (job_run_details keeps only the command status), so watch the Postgres log for the
--   WARNING text 'cost001 cron_metric_alerts: check' instead.
--
-- HOW IT IS APPLIED: through the Supabase MCP by the PM after the always-aborted rehearsal of
--   ai-os/projexa-build-001/ROLLBACK_REHEARSALS.md (do-block --schemas compliance). Idempotent: create or replace, and the job is
--   unscheduled before it is scheduled again. The cron part runs only where the cron schema exists.
--
-- ROLLBACK: drizzle/down/0633_build001_cron_metric_alerts.down.sql

BEGIN;

SET LOCAL lock_timeout = '5s';

-- 1. the functions ---------------------------------------------------------
create or replace function compliance.cron_metric_alert_rules(
  p_dedup   boolean default true,
  p_dry_run boolean default false
) returns jsonb
language plpgsql
set search_path = compliance, platform, public
as $fn$
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
$fn$;

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
as $fn$
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
$fn$;

comment on function compliance.cron_ticket_sla_breaches(boolean, boolean) is
  'COST-001 pg_cron port of checkTicketSlaBreaches() (ticket-service.ts:264-284). Prepared, owner-applied.';


-- ----------------------------------------------------------------------------
-- 3/6  ticket_escalations  (ticket-service.ts:295-348)
--      Idempotent per (ticket, escalation rule) via ticket_escalation_events
--      exactly as the TS is; p_dedup is additionally honoured for the
--      notification rows (harmless, the events table already prevents a
--      second fire).
-- ----------------------------------------------------------------------------
-- Changed from the prepared file: the loop record is tk, not t, because the loop query aliases compliance.tickets as t (see SOURCE above).
create or replace function compliance.cron_ticket_escalations(
  p_dedup   boolean default true,
  p_dry_run boolean default false
) returns jsonb
language plpgsql
set search_path = compliance, platform, public
as $fn$
declare
  tk           record;
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
  for tk in
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
    continue when coalesce(tk.resolution_hours, 0) <= 0;

    -- :308-310  elapsedPercent = (now - (deadline - resolutionHours)) / resolutionHours * 100
    v_elapsed := extract(epoch from (now() - (tk.sla_deadline - make_interval(hours => tk.resolution_hours))))
                 / (tk.resolution_hours * 3600.0) * 100;

    -- :312  rules for this policy (OWNER DECISION #4c: explicit step_order)
    for rl in
      select id, threshold_percent, escalate_to_team_id, escalate_to_user_id, notify_user_ids
      from compliance.escalation_rules
      where sla_policy_id = tk.policy_id
      order by step_order, created_at, id
    loop
      -- :314  not yet matured
      continue when v_elapsed < rl.threshold_percent;

      -- :316-319  already fired for this (ticket, rule) -> idempotent skip
      continue when exists (
        select 1 from compliance.ticket_escalation_events e
        where e.ticket_id = tk.id and e.escalation_rule_id = rl.id);

      -- :321-326  reassign team and/or assignee, stamp updatedAt
      if rl.escalate_to_team_id is not null or rl.escalate_to_user_id is not null then
        if not p_dry_run then
          update compliance.tickets
          set team_id     = coalesce(rl.escalate_to_team_id, team_id),
              assignee_id = coalesce(rl.escalate_to_user_id, assignee_id),
              updated_at  = now()
          where id = tk.id;
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
            and n.metadata->>'ticketId' = tk.id
            and n.metadata->>'escalationRuleId' = rl.id
        ) then
          v_deduped := v_deduped + 1;
          continue;
        end if;

        if not p_dry_run then
          insert into compliance.notifications (user_id, title, message, type, metadata)
          values (
            v_uid,
            'Ticket escalated: ' || tk.subject,
            'Ticket "' || tk.subject || '" reached ' || rl.threshold_percent::text
              || '% of its SLA window and was escalated.',
            'system',
            jsonb_build_object(
              'kind', 'ticket_escalation',              -- added by this port (dedup key)
              'ticketId', tk.id,
              'conversationId', tk.conversation_id,
              'escalationRuleId', rl.id)
          );
        end if;
        v_notified := v_notified + 1;
      end loop;

      -- :342  record the fire (this is what makes the whole check idempotent)
      if not p_dry_run then
        insert into compliance.ticket_escalation_events (ticket_id, escalation_rule_id)
        values (tk.id, rl.id);
      end if;
      v_escalated := v_escalated + 1;
    end loop;
  end loop;

  return jsonb_build_object(
    'candidates', v_candidates, 'escalated', v_escalated,
    'ticketsUpdated', v_tickets_updated, 'notified', v_notified,
    'deduped', v_deduped, 'dryRun', p_dry_run);
end
$fn$;

comment on function compliance.cron_ticket_escalations(boolean, boolean) is
  'COST-001 pg_cron port of checkTicketEscalations() (ticket-service.ts:295-348). Prepared, owner-applied.';


-- ----------------------------------------------------------------------------
-- 4/6  task_overdue  (task-service.ts:564-584)   -- see OWNER DECISION #3 and DECISIONS APPLIED above
-- ----------------------------------------------------------------------------
create or replace function compliance.cron_task_overdue(
  p_dedup   boolean default true,
  p_dry_run boolean default false
) returns jsonb
language plpgsql
set search_path = compliance, platform, public
as $fn$
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
      if p_dedup and (
        exists (
          select 1 from compliance.notifications n
          where n.user_id = v_uid and n.type = 'deadline_reminder' and n.is_read = false
            and n.metadata->>'kind' = 'task_overdue'
            and n.metadata->>'taskId' = t.id
        )
        -- added by this port: the digest of migration 0636 already lists this task as overdue for this user (unread)
        or exists (
          select 1 from compliance.notifications n
          where n.user_id = v_uid and n.type = 'deadline_reminder' and n.is_read = false
            and n.metadata->>'kind' = 'task_nudge_digest'
            and n.metadata->'overdueTaskIds' @> to_jsonb(t.id)
        )
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
$fn$;

comment on function compliance.cron_task_overdue(boolean, boolean) is
  'COST-001 pg_cron port of checkTaskOverdue() (task-service.ts:564-584). Prepared, owner-applied. Decision 3: runs next to cron_task_nudge_digest; a recipient whose unread digest already lists the task as overdue gets no second notice.';


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
as $fn$
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
$fn$;

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
as $fn$
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
$fn$;

comment on function compliance.cron_cost_cap(boolean, boolean) is
  'COST-001 pg_cron port of checkCostCeilingBreaches() (cost-guard.ts:99-144). Prepared, owner-applied.';


-- ----------------------------------------------------------------------------
-- WRAPPER  cron_metric_alerts  (route.ts:51-58 Promise.all)
--   Each check runs in its own BEGIN ... EXCEPTION block (a plpgsql
--   subtransaction): a failing check's partial writes roll back and its
--   error is returned under its key and logged as a WARNING, while the
--   other five still run and commit -- the SQL equivalent of six independent promises.
-- ----------------------------------------------------------------------------
create or replace function compliance.cron_metric_alerts(
  p_dedup   boolean default true,
  p_dry_run boolean default false
) returns jsonb
language plpgsql
set search_path = compliance, platform, public
as $fn$
declare
  v_out jsonb := jsonb_build_object('ranAt', now(), 'dedup', p_dedup, 'dryRun', p_dry_run);
  v_res jsonb;
begin
  if not pg_try_advisory_xact_lock(hashtext('cost001'), hashtext('metric_alerts')) then
    return jsonb_build_object('skipped', 'overlap');
  end if;

  begin v_res := compliance.cron_metric_alert_rules(p_dedup, p_dry_run);
  exception when others then
    v_res := jsonb_build_object('error', sqlerrm, 'sqlstate', sqlstate);
    raise warning 'cost001 cron_metric_alerts: check metricAlerts failed: % (%)', sqlerrm, sqlstate;
  end;
  v_out := v_out || jsonb_build_object('metricAlerts', v_res);

  begin v_res := compliance.cron_ticket_sla_breaches(p_dedup, p_dry_run);
  exception when others then
    v_res := jsonb_build_object('error', sqlerrm, 'sqlstate', sqlstate);
    raise warning 'cost001 cron_metric_alerts: check ticketSla failed: % (%)', sqlerrm, sqlstate;
  end;
  v_out := v_out || jsonb_build_object('ticketSla', v_res);

  begin v_res := compliance.cron_ticket_escalations(p_dedup, p_dry_run);
  exception when others then
    v_res := jsonb_build_object('error', sqlerrm, 'sqlstate', sqlstate);
    raise warning 'cost001 cron_metric_alerts: check ticketEscalations failed: % (%)', sqlerrm, sqlstate;
  end;
  v_out := v_out || jsonb_build_object('ticketEscalations', v_res);

  begin v_res := compliance.cron_task_overdue(p_dedup, p_dry_run);
  exception when others then
    v_res := jsonb_build_object('error', sqlerrm, 'sqlstate', sqlstate);
    raise warning 'cost001 cron_metric_alerts: check taskOverdue failed: % (%)', sqlerrm, sqlstate;
  end;
  v_out := v_out || jsonb_build_object('taskOverdue', v_res);

  begin v_res := compliance.cron_task_reprioritise(p_dry_run => p_dry_run);
  exception when others then
    v_res := jsonb_build_object('error', sqlerrm, 'sqlstate', sqlstate);
    raise warning 'cost001 cron_metric_alerts: check taskReprioritization failed: % (%)', sqlerrm, sqlstate;
  end;
  v_out := v_out || jsonb_build_object('taskReprioritization', v_res);

  begin v_res := compliance.cron_cost_cap(p_dedup, p_dry_run);
  exception when others then
    v_res := jsonb_build_object('error', sqlerrm, 'sqlstate', sqlstate);
    raise warning 'cost001 cron_metric_alerts: check costCeiling failed: % (%)', sqlerrm, sqlstate;
  end;
  v_out := v_out || jsonb_build_object('costCeiling', v_res);

  return v_out;
end
$fn$;

comment on function compliance.cron_metric_alerts(boolean, boolean) is
  'COST-001 pg_cron wrapper for /api/internal/metric-alerts/run (route.ts:51-58): runs the six checks in isolated subtransactions and returns all six results. Prepared, owner-applied.';


-- 1b. no access for public, anon or authenticated
REVOKE ALL ON FUNCTION compliance.cron_metric_alert_rules(boolean, boolean) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION compliance.cron_ticket_sla_breaches(boolean, boolean) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION compliance.cron_ticket_escalations(boolean, boolean) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION compliance.cron_task_overdue(boolean, boolean) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION compliance.cron_task_reprioritise(boolean, timestamptz) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION compliance.cron_cost_cap(boolean, boolean) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION compliance.cron_metric_alerts(boolean, boolean) FROM public, anon, authenticated;

-- 2. the cron job (only where pg_cron is installed) -----------------------------------
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cost001-metric-alerts') THEN
      PERFORM cron.unschedule('cost001-metric-alerts');
    END IF;
    PERFORM cron.schedule('cost001-metric-alerts', '0 5 * * *', $cron$select compliance.cron_metric_alerts();$cron$);
  END IF;
END
$do$;

COMMIT;
