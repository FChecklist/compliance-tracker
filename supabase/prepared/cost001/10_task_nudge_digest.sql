-- ============================================================================
-- PROJEXA-COST-001 -- prepared pg_cron port -- cron 10: task-nudge-digest
-- ============================================================================
-- STATUS      : PREPARED, NOT APPLIED. Owner rule: "Prepare, do not execute.
--               Branch only." Only the SELECT half was dry-run read-only on
--               2026-09-22 (counts in README_b.md).
-- Vercel route: GET /api/internal/task-nudge-digest/run
-- Vercel cron : "0 8 * * *"  (vercel.json:16 -- daily 08:00 UTC)
-- Route file  : src/app/api/internal/task-nudge-digest/run/route.ts:21
-- Mirrors     : src/lib/services/task-nudge-digest-service.ts
--                 :35-36   ACTIVE_STATUSES = pending|in_progress, window 3 days
--                 :48-61   groupTasksForNudge()  (overdue = dueDate < now,
--                          dueSoon = now <= dueDate <= now+3d)
--                 :69-79   summarizeNudgeGroup()  (overdue wins over due-soon;
--                          1 task -> its title, N tasks -> "N tasks")
--                 :91-122  runTaskNudgeDigest()   (ONE row per user, never
--                          one per task; users with nothing get nothing)
--               src/lib/response-engine.ts
--                 :38      RESPONSE_TEXT.pending = "Pending"
--                 :56-58   formatShortReply(): detail trimmed, '' -> undefined
--                 :61-63   renderShortReply(): `${text} — ${detail}` -- the
--                          separator is U+2014 EM DASH, written below as
--                          chr(8212) so the file's own encoding cannot alter it.
--
-- WHY THIS EXISTS: see 04_metric_alerts.sql's header (app_runtime has no
-- BYPASSRLS, so this route has read zero rows since ~2026-08-23; a pg_cron
-- job runs as postgres and re-enables it -- intended, owner-signed).
--
-- DEDUP CONVENTION (OWNER DECISION #3 / #7): `p_dedup boolean default true`
--   skips a user who already has an UNREAD notification with type
--   'deadline_reminder' and metadata->>'kind' = 'task_nudge_digest'. This
--   function has no per-entity id (the digest IS the entity), so the key is
--   (user, type, kind). The TS today writes one digest per user per day
--   regardless. `p_dedup => false` reproduces today's TS behaviour exactly --
--   the TS already sets metadata.kind, so there is no added key here.
--   Note the trade-off with dedup ON: while a user's digest sits unread the
--   overdueTaskIds/dueSoonTaskIds lists in it go stale; the next fresh digest
--   is written only after they read (or mark read) the old one.
--
-- OWNER DECISION POINTS (this file)
--   #3  This DUPLICATES cron 04's cron_task_overdue: both fire type
--       'deadline_reminder' to a task's assignee on the same morning about
--       the same overdue task (04 at 05:00 one row per task, this at 08:00
--       one row per user). KEEP ONE. Recommendation, not a decision: keep
--       this digest (batched, lower noise) and leave cron_task_overdue
--       unscheduled -- but cron_task_overdue also notifies assignedById,
--       which this digest does not.
--   #10a Live today `tasks.status` contains only 'completed' and 'failed'
--        (1917 rows, 9 with a due_date) -- ACTIVE_STATUSES matches zero rows,
--        so this function is a no-op until real pending/in_progress tasks
--        with due dates exist. Dry-run: 0 users.
--   #10b Task id ordering inside the jsonb arrays is (due_date, id); the TS
--        preserved findMany's unspecified order.
--
-- SWITCH-ON (owner runs): apply file -> select compliance.cron_task_nudge_digest(p_dry_run => true);
--   -> uncomment cron.schedule below -> remove the Vercel cron entry in a
--   separate reviewed PR (vercel.json is out of this task's scope).
-- ============================================================================

create or replace function compliance.cron_task_nudge_digest(
  p_dedup                boolean     default true,
  p_dry_run              boolean     default false,
  p_due_soon_window_days int         default 3,
  p_now                  timestamptz default now()
) returns jsonb
language plpgsql
set search_path = compliance, platform, public
as $$
declare
  g          record;
  v_cutoff   timestamptz;
  v_detail   text;
  v_message  text;
  v_users    int := 0;
  v_tasks    int := 0;
  v_deduped  int := 0;
begin
  if not pg_try_advisory_xact_lock(hashtext('cost001'), hashtext('task_nudge_digest')) then
    return jsonb_build_object('skipped', 'overlap');
  end if;

  -- :50  dueSoonCutoff = now + windowDays
  v_cutoff := p_now + make_interval(days => p_due_soon_window_days);

  -- :92-100  active, dated, owned tasks grouped per user; :105 skip users with
  -- neither bucket populated (done in HAVING so they never reach the loop)
  for g in
    select
      user_id,
      coalesce(jsonb_agg(id order by due_date, id) filter (where due_date < p_now), '[]'::jsonb)                          as overdue_ids,
      coalesce(jsonb_agg(id order by due_date, id) filter (where due_date >= p_now and due_date <= v_cutoff), '[]'::jsonb) as due_soon_ids,
      (array_agg(title order by due_date, id) filter (where due_date < p_now))[1]                                         as first_overdue_title,
      (array_agg(title order by due_date, id) filter (where due_date >= p_now and due_date <= v_cutoff))[1]               as first_due_soon_title
    from compliance.tasks
    where status in ('pending', 'in_progress')      -- :35 ACTIVE_STATUSES
      and due_date is not null
      and user_id is not null
    group by user_id
    having count(*) filter (where due_date <= v_cutoff) > 0
    order by user_id
  loop
    if p_dedup and exists (
      select 1 from compliance.notifications n
      where n.user_id = g.user_id and n.type = 'deadline_reminder' and n.is_read = false
        and n.metadata->>'kind' = 'task_nudge_digest'
    ) then
      v_deduped := v_deduped + 1;
      continue;
    end if;

    -- :69-79  summarizeNudgeGroup(): overdue takes priority over due-soon
    if jsonb_array_length(g.overdue_ids) > 0 then
      v_detail := case when jsonb_array_length(g.overdue_ids) = 1
                       then g.first_overdue_title
                       else jsonb_array_length(g.overdue_ids)::text || ' tasks' end || ' overdue';
    else
      v_detail := case when jsonb_array_length(g.due_soon_ids) = 1
                       then g.first_due_soon_title
                       else jsonb_array_length(g.due_soon_ids)::text || ' tasks' end || ' due soon';
    end if;

    -- response-engine.ts:56-58 formatShortReply(): detail?.trim() || undefined
    -- response-engine.ts:61-63 renderShortReply(): "Pending — <detail>" (U+2014)
    v_detail  := nullif(btrim(v_detail), '');
    v_message := case when v_detail is null then 'Pending'
                      else 'Pending ' || chr(8212) || ' ' || v_detail end;

    -- :107-117  exactly ONE row per user
    if not p_dry_run then
      insert into compliance.notifications (user_id, title, message, type, metadata)
      values (
        g.user_id,
        'Task nudge',
        v_message,
        'deadline_reminder',
        jsonb_build_object(
          'kind', 'task_nudge_digest',
          'overdueTaskIds', g.overdue_ids,
          'dueSoonTaskIds', g.due_soon_ids)
      );
    end if;

    v_users := v_users + 1;
    v_tasks := v_tasks + jsonb_array_length(g.overdue_ids) + jsonb_array_length(g.due_soon_ids);
  end loop;

  -- :121  { usersNotified, tasksCovered }
  return jsonb_build_object(
    'usersNotified', v_users, 'tasksCovered', v_tasks,
    'deduped', v_deduped, 'dryRun', p_dry_run);
end
$$;

comment on function compliance.cron_task_nudge_digest(boolean, boolean, int, timestamptz) is
  'COST-001 pg_cron port of runTaskNudgeDigest() (task-nudge-digest-service.ts:91-122). Prepared, owner-applied. OWNER DECISION #3: overlaps cron 04 cron_task_overdue -- keep one.';


-- ============================================================================
-- SCHEDULE (OWNER ACTION -- commented out; same "0 8 * * *" as vercel.json:16)
-- ============================================================================
-- select cron.schedule('cost001-task-nudge-digest', '0 8 * * *', $$select compliance.cron_task_nudge_digest();$$);
--
-- Exact TS behaviour (no dedup):
-- select cron.schedule('cost001-task-nudge-digest', '0 8 * * *', $$select compliance.cron_task_nudge_digest(p_dedup => false);$$);

-- ============================================================================
-- ROLLBACK (OWNER ACTION -- commented out)
-- ============================================================================
-- select cron.unschedule('cost001-task-nudge-digest');
-- drop function if exists compliance.cron_task_nudge_digest(boolean, boolean, int, timestamptz);
-- Rows written by this function: metadata->>'kind' = 'task_nudge_digest'
-- (indistinguishable from the TS's own rows -- same key, by design).
