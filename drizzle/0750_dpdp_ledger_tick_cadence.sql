-- 0750: the ledger summary push really runs on every 30-minute tick.
--
-- Found 2026-10-14. 0749 schedules the pg_cron job `dpdp-ledger-tick` every 30 minutes, and dpdp_ledger_summary_claim only lets a push through when the last
-- push is at least 30 minutes old. The cron fires a moment BEFORE the last push time + 30 minutes (the push is stamped when it finishes, the next tick is on the
-- clock), so the next tick was always refused and only every second tick pushed: the summary went out about hourly instead of every 30 minutes.
--
-- Fix: the "at most every" rule becomes 29 minutes, so a 30-minute tick always passes and two overlapping runs are still stopped by the row lock and the
-- 5-minute retry rule. Only that one constant changes. The function body is otherwise identical to the one in 0749, so this migration is safe to run again
-- (create or replace; no table, grant or cron change). The same number is SUMMARY_EVERY_MS in supabase/functions/dpdp-pay/ledger.ts; keep the two equal.

create or replace function public.dpdp_ledger_summary_claim(p_force boolean default false)
returns boolean
language plpgsql security definer
set search_path = ''
as $$
declare
  v_push timestamptz;
  v_try timestamptz;
begin
  insert into dpdp.ledger_state (k, at) values ('last_push', 'epoch'), ('last_try', 'epoch') on conflict (k) do nothing;
  select s.at into v_push from dpdp.ledger_state s where s.k = 'last_push' for update;
  select s.at into v_try from dpdp.ledger_state s where s.k = 'last_try' for update;
  if not coalesce(p_force, false) and (clock_timestamp() - v_push < interval '29 minutes' or clock_timestamp() - v_try < interval '5 minutes') then
    return false;
  end if;
  update dpdp.ledger_state set at = clock_timestamp() where k = 'last_try';
  return true;
end
$$;
