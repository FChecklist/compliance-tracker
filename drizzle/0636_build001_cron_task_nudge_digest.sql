-- PROJEXA-BUILD-001 U-41 part B (PROJEXA-COST-001, PMD-12): the task nudge digest moves off the Vercel cron onto pg_cron.
-- Replaces vercel.json "/api/internal/task-nudge-digest/run", 0 8 * * *.
--
-- WHAT
--   compliance.cron_task_nudge_digest(p_dedup boolean = true, p_dry_run boolean = false, p_due_soon_window_days integer = 3,
--     p_now timestamptz = now()) returns jsonb: one 'deadline_reminder' notification per user with overdue or due-soon active tasks.
--   cron job 'cost001-task-nudge-digest' at '0 8 * * *' (UTC), command: select compliance.cron_task_nudge_digest();
--   Pure SQL: no /api/internal route, no net.http_post, no Vault secret, no table, no grant (only a revoke).
--
-- SOURCE
--   supabase/prepared/cost001/10_task_nudge_digest.sql: the function text is copied with two changes. (1) The dollar-quote tag is fn where
--   the prepared file used the bare pair. (2) The task query leaves out an overdue task the owner already has an unread task_overdue
--   notice for, and a user left with nothing to report is counted under deduped (see DECISIONS APPLIED). That file holds the
--   reasoning, the column checks and the owner decision table; its README records the live dry runs of 2026-09-22 and 2026-09-24.
--   Every table and column used was re-checked on 2026-09-26 against src/lib/db/schema.ts and the live catalog (read only): none missing.
--
-- DECISIONS APPLIED (PM, under the owner's delegation)
--  Notification dedup stays ON (decisions 3 and 7). The digest is kept (PMD-44).
--  The digest's dedup key (kind task_nudge_digest) differs from cron_task_overdue's (kind task_overdue, migration 0633), and migration
--  0633 runs the overdue check inside its wrapper at 05:00. A per-kind dedup alone would let an owner with an overdue task receive one
--  row from each. The two therefore check each other by task id: the digest leaves out an overdue task for which the owner already has
--  an unread task_overdue notice, and cron_task_overdue skips a recipient whose unread digest lists the task in overdueTaskIds. Both
--  checks are part of p_dedup (p_dedup => false repeats everything). Due-soon tasks are only ever in the digest.
--
-- LIVE COUNTS 2026-09-26 (read only)
--  tasks.status holds only completed and failed, so 0 active dated tasks: the first run notifies 0 users.
--
-- GRANTS: SECURITY INVOKER (no privilege of its own), search_path pinned to compliance, platform, public, EXECUTE revoked from
--   public, anon and authenticated. The job runs as postgres, which owns the function, so it also bypasses row level security:
--   this switches on cross-org behaviour that read zero rows while the production connection was app_runtime.
--
-- DATA LOSS: none from this file. A run inserts notification rows with metadata kind task_nudge_digest.
--   While a user's digest is unread, cron_task_overdue does not write a task_overdue row for the tasks it lists as overdue.
--
-- FIRST LIVE CALL: select compliance.cron_task_nudge_digest(p_dry_run => true);
--
-- HOW IT IS APPLIED: through the Supabase MCP by the PM after the always-aborted rehearsal of
--   ai-os/projexa-build-001/ROLLBACK_REHEARSALS.md (do-block --schemas compliance). Idempotent: create or replace, and the job is
--   unscheduled before it is scheduled again. The cron part runs only where the cron schema exists.
--
-- ROLLBACK: drizzle/down/0636_build001_cron_task_nudge_digest.down.sql

BEGIN;

SET LOCAL lock_timeout = '5s';

-- 1. the function ---------------------------------------------------------
create or replace function compliance.cron_task_nudge_digest(
  p_dedup                boolean     default true,
  p_dry_run              boolean     default false,
  p_due_soon_window_days int         default 3,
  p_now                  timestamptz default now()
) returns jsonb
language plpgsql
set search_path = compliance, platform, public
as $fn$
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
      s.user_id,
      coalesce(jsonb_agg(s.id order by s.due_date, s.id) filter (where s.due_date < p_now and not s.alerted), '[]'::jsonb)                          as overdue_ids,
      coalesce(jsonb_agg(s.id order by s.due_date, s.id) filter (where s.due_date >= p_now and s.due_date <= v_cutoff), '[]'::jsonb)               as due_soon_ids,
      (array_agg(s.title order by s.due_date, s.id) filter (where s.due_date < p_now and not s.alerted))[1]                                         as first_overdue_title,
      (array_agg(s.title order by s.due_date, s.id) filter (where s.due_date >= p_now and s.due_date <= v_cutoff))[1]                              as first_due_soon_title
    from (
      select tk.id, tk.title, tk.due_date, tk.user_id,
             -- added by this port: the owner already has an unread task_overdue notice (migration 0633) for this overdue task
             (coalesce(p_dedup, false) and tk.due_date < p_now and exists (
                select 1 from compliance.notifications n
                where n.user_id = tk.user_id and n.type = 'deadline_reminder' and n.is_read = false
                  and n.metadata->>'kind' = 'task_overdue'
                  and n.metadata->>'taskId' = tk.id
             )) as alerted
      from compliance.tasks tk
      where tk.status in ('pending', 'in_progress')      -- :35 ACTIVE_STATUSES
        and tk.due_date is not null
        and tk.user_id is not null
    ) s
    group by s.user_id
    having count(*) filter (where s.due_date <= v_cutoff) > 0
    order by s.user_id
  loop
    if p_dedup and exists (
      select 1 from compliance.notifications n
      where n.user_id = g.user_id and n.type = 'deadline_reminder' and n.is_read = false
        and n.metadata->>'kind' = 'task_nudge_digest'
    ) then
      v_deduped := v_deduped + 1;
      continue;
    end if;

    -- added by this port: every overdue task of this user was already notified by cron_task_overdue and nothing is due soon
    if jsonb_array_length(g.overdue_ids) = 0 and jsonb_array_length(g.due_soon_ids) = 0 then
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
    -- response-engine.ts:61-63 renderShortReply(): "Pending", a space, U+2014, a space, then the detail
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
$fn$;

comment on function compliance.cron_task_nudge_digest(boolean, boolean, int, timestamptz) is
  'COST-001 pg_cron port of runTaskNudgeDigest() (task-nudge-digest-service.ts:91-122). Prepared, owner-applied. Decision 3: runs next to cron_task_overdue; an overdue task the owner already has an unread task_overdue notice for is left out of the digest.';


-- 1b. no access for public, anon or authenticated
REVOKE ALL ON FUNCTION compliance.cron_task_nudge_digest(boolean, boolean, integer, timestamptz) FROM public, anon, authenticated;

-- 2. the cron job (only where pg_cron is installed) -----------------------------------
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cost001-task-nudge-digest') THEN
      PERFORM cron.unschedule('cost001-task-nudge-digest');
    END IF;
    PERFORM cron.schedule('cost001-task-nudge-digest', '0 8 * * *', $cron$select compliance.cron_task_nudge_digest();$cron$);
  END IF;
END
$do$;

COMMIT;
