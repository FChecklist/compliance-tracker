-- PRE-APPROVED-LIVE-DDL: Task instruction 2026-10-14 (owner order: the DPDP audit fixes of DPDP_DATA_AUDIT_2026-10-14.md section 7, fix 3: deletion for the tables the retention sweep did not cover). Applied by the project manager.
--
-- 0724 built the daily retention sweep but left four places with no deletion at all, while the Privacy Notice promises limits for them:
--   * dpdp.email_send      the log of e-mails we sent: the notice says 13 months          -> email_send_days = 395, by created_at
--   * dpdp.ai_link_call    the log of every AI work-link call (append-only table)         -> ai_link_call_days = 365 (a security log: the one-year rule), and
--                                                                                          ai_link_call_unknown_days = 90 for calls whose token matched no link
--   * dpdp.ai_link        AI work links that ended (expired or revoked)                   -> ai_link_ended_days = 90 after the end
--   * dpdp.ai_link_read    the old read log of an AI link (user-agent family, network prefix) -> ai_link_read_days = 90
-- These are rules in dpdp_timer_retention_sweep (below, a full replacement of the 0724 function with the same behaviour for its old rules). They obey the existing
-- live switch (dpdp.retention_setting.live) like every other rule: while it is false they only count.
--
-- BILLING DATA IS NEVER DELETED by any job. Invoices, payments, payment attempts, the payment ledger (A/B/C), subscriptions, commissions and the payment-proof files
-- are kept for audit and tax reasons. This migration therefore (1) adds all of those tables to dpdp.retention_kept_tables(), so that even an organisation offboarding
-- leaves them in place, and (2) ships the payment-proof file job with NO period (payment_proof_days is null = keep): the job and its plan function exist and are
-- tested, but delete nothing until a period is deliberately set.
-- The proof FILES cannot be removed with SQL (deleting a storage.objects row leaves the file in the storage layer), so if a period is ever set the sweep only plans them
-- here: dpdp_retention_proof_plan lists the expired objects and the Edge Function dpdp-retention-files removes them through the Storage API, then calls
-- dpdp_retention_proof_done.
-- dpdp.ai_link_call is append-only; its guard now also lets a DELETE through, but only inside the sweep's own transaction (a transaction-local setting the sweep
-- sets and clears), so no other statement can remove a call row.
-- Roll-back: drizzle/down/0761_dpdp_retention_more_tables.down.sql (restores the 0724 sweep, the old guard and the old kept-tables list; drops the new columns).

alter table dpdp.retention_setting add column if not exists email_send_days integer not null default 395;
alter table dpdp.retention_setting add column if not exists ai_link_call_days integer not null default 365;
alter table dpdp.retention_setting add column if not exists ai_link_call_unknown_days integer not null default 90;
alter table dpdp.retention_setting add column if not exists ai_link_ended_days integer not null default 90;
alter table dpdp.retention_setting add column if not exists ai_link_read_days integer not null default 90;
alter table dpdp.retention_setting add column if not exists payment_proof_days integer; -- null = keep (billing records)
do $$ begin
  alter table dpdp.retention_setting add constraint retention_setting_more_days_check check (
    email_send_days >= 30 and ai_link_call_days >= 90 and ai_link_call_unknown_days >= 1 and ai_link_ended_days >= 1 and ai_link_read_days >= 1 and (payment_proof_days is null or payment_proof_days >= 30));
exception when duplicate_object then null; end $$;

-- The append-only guard of the call log: unchanged, except that the sweep (and only the sweep) may delete.
create or replace function dpdp.ai_link_call_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if coalesce(current_setting('dpdp.retention_sweep', true), '') = 'on' then
      return old;
    end if;
    raise exception 'dpdp.ai_link_call is append-only' using errcode = '42501';
  end if;
  if old.status is not null
     or new.id is distinct from old.id
     or new.link_id is distinct from old.link_id
     or new.org_id is distinct from old.org_id
     or new.method is distinct from old.method
     or new.path is distinct from old.path
     or new.called_at is distinct from old.called_at then
    raise exception 'dpdp.ai_link_call is append-only -- only a pending row''s status/bytes/finished_at may be set, once' using errcode = '42501';
  end if;
  return new;
end
$$;

-- Tables a sweep or an offboarding must never delete from: the append-only records, the sweep's own books, and ALL billing data.
create or replace function dpdp.retention_kept_tables()
returns text[]
language sql immutable
set search_path = ''
as $$ select array['event', 'access_log', 'daily_seal', 'organisation', 'org_offboarding', 'retention_run', 'retention_setting',
  'payment', 'payment_attempt', 'payment_ledger', 'subscription', 'account_commission', 'referral_commission', 'partner_payout', 'partner_payout_store',
  'ledger_commission_sync', 'ledger_event_seen', 'ledger_payment_attempt', 'ledger_refund', 'ledger_state', 'razorpay_event',
  'billing_setting', 'billing_notice_sent', 'billing_notice_token', 'billing_email_optout']::text[] $$;

-- The daily sweep: the 0724 rules unchanged, plus the five above (the first four here, the files through the plan function).
create or replace function public.dpdp_timer_retention_sweep(p_force_dry_run boolean default false)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_set dpdp.retention_setting;
  v_live boolean;
  v_now timestamp := (clock_timestamp() at time zone 'UTC');
  v_nowtz timestamptz := clock_timestamp();
  v_counts jsonb := '{}'::jsonb;
  v_n bigint;
  v_off record;
  v_report jsonb;
  v_orgs jsonb := '[]'::jsonb;
begin
  select * into v_set from dpdp.retention_setting where id = 1;
  v_live := coalesce(v_set.live, false) and not coalesce(p_force_dry_run, false);

  if to_regclass('dpdp.login_token') is not null then
    select count(*) into v_n from dpdp.login_token where expires_at < v_now - make_interval(days => v_set.login_token_days);
    if v_live and v_n > 0 then delete from dpdp.login_token where expires_at < v_now - make_interval(days => v_set.login_token_days); end if;
    v_counts := v_counts || jsonb_build_object('login_token', v_n);
  end if;

  if to_regclass('dpdp.session') is not null then
    select count(*) into v_n from dpdp.session where expires_at < v_now - make_interval(days => v_set.session_days);
    if v_live and v_n > 0 then delete from dpdp.session where expires_at < v_now - make_interval(days => v_set.session_days); end if;
    v_counts := v_counts || jsonb_build_object('session', v_n);
  end if;

  if to_regclass('dpdp.email_token') is not null then
    select count(*) into v_n from dpdp.email_token where expires_at < v_now - make_interval(days => v_set.email_token_days);
    if v_live and v_n > 0 then delete from dpdp.email_token where expires_at < v_now - make_interval(days => v_set.email_token_days); end if;
    v_counts := v_counts || jsonb_build_object('email_token', v_n);
  end if;

  if to_regclass('dpdp.mail_outbound') is not null then
    select count(*) into v_n from dpdp.mail_outbound where sent_at < v_nowtz - make_interval(days => v_set.mail_outbound_days);
    if v_live and v_n > 0 then delete from dpdp.mail_outbound where sent_at < v_nowtz - make_interval(days => v_set.mail_outbound_days); end if;
    v_counts := v_counts || jsonb_build_object('mail_outbound', v_n);
  end if;

  -- Only CLOSED inbound tickets age out; an open ticket is kept however old it is.
  if to_regclass('dpdp.mail_inbound') is not null then
    select count(*) into v_n from dpdp.mail_inbound where closed_at is not null and closed_at < v_nowtz - make_interval(days => v_set.mail_inbound_closed_days);
    if v_live and v_n > 0 then delete from dpdp.mail_inbound where closed_at is not null and closed_at < v_nowtz - make_interval(days => v_set.mail_inbound_closed_days); end if;
    v_counts := v_counts || jsonb_build_object('mail_inbound_closed', v_n);
  end if;

  if to_regclass('dpdp.ai_link_seen') is not null then
    select count(*) into v_n from dpdp.ai_link_seen where first_seen_at < v_now - make_interval(days => v_set.ip_prefix_days);
    if v_live and v_n > 0 then delete from dpdp.ai_link_seen where first_seen_at < v_now - make_interval(days => v_set.ip_prefix_days); end if;
    v_counts := v_counts || jsonb_build_object('ai_link_seen', v_n);
  end if;

  -- NEW (0761). The log of e-mails sent: 13 months from the day the row was made (the notice's promise).
  if to_regclass('dpdp.email_send') is not null then
    select count(*) into v_n from dpdp.email_send where created_at < v_nowtz - make_interval(days => v_set.email_send_days);
    if v_live and v_n > 0 then delete from dpdp.email_send where created_at < v_nowtz - make_interval(days => v_set.email_send_days); end if;
    v_counts := v_counts || jsonb_build_object('email_send', v_n);
  end if;

  -- NEW (0761). The AI work-link call log (append-only: the guard lets this transaction delete, nothing else). A call whose token matched no link is noise from a
  -- scanner or an old link and goes sooner (link_id is null).
  if to_regclass('dpdp.ai_link_call') is not null then
    select count(*) into v_n from dpdp.ai_link_call
     where (link_id is not null and called_at < v_now - make_interval(days => v_set.ai_link_call_days))
        or (link_id is null and called_at < v_now - make_interval(days => v_set.ai_link_call_unknown_days));
    if v_live and v_n > 0 then
      perform set_config('dpdp.retention_sweep', 'on', true);
      delete from dpdp.ai_link_call
       where (link_id is not null and called_at < v_now - make_interval(days => v_set.ai_link_call_days))
          or (link_id is null and called_at < v_now - make_interval(days => v_set.ai_link_call_unknown_days));
      perform set_config('dpdp.retention_sweep', 'off', true);
    end if;
    v_counts := v_counts || jsonb_build_object('ai_link_call', v_n);
  end if;

  -- NEW (0761). The old read log of an AI link.
  if to_regclass('dpdp.ai_link_read') is not null then
    select count(*) into v_n from dpdp.ai_link_read where at < v_now - make_interval(days => v_set.ai_link_read_days);
    if v_live and v_n > 0 then delete from dpdp.ai_link_read where at < v_now - make_interval(days => v_set.ai_link_read_days); end if;
    v_counts := v_counts || jsonb_build_object('ai_link_read', v_n);
  end if;

  -- NEW (0761). AI work links that ended (expired or revoked) more than the period ago. A link still in force is never touched. Its read rows go first.
  if to_regclass('dpdp.ai_link') is not null then
    select count(*) into v_n from dpdp.ai_link l
     where least(coalesce(l.revoked_at, l.expires_at), l.expires_at) < v_now - make_interval(days => v_set.ai_link_ended_days);
    if v_live and v_n > 0 then
      if to_regclass('dpdp.ai_link_read') is not null then
        delete from dpdp.ai_link_read r using dpdp.ai_link l
         where r.link_id = l.id and least(coalesce(l.revoked_at, l.expires_at), l.expires_at) < v_now - make_interval(days => v_set.ai_link_ended_days);
      end if;
      delete from dpdp.ai_link l
       where least(coalesce(l.revoked_at, l.expires_at), l.expires_at) < v_now - make_interval(days => v_set.ai_link_ended_days);
    end if;
    v_counts := v_counts || jsonb_build_object('ai_link', v_n);
  end if;

  -- Ended organisations whose export period is over and whose export was made.
  for v_off in
    select o.org_id from dpdp.org_offboarding o
     where o.state = 'exporting' and o.export_until < v_now and o.exported_at is not null
     order by o.org_id
  loop
    v_orgs := v_orgs || jsonb_build_array(public.dpdp__offboard_delete(v_off.org_id, v_live));
  end loop;

  v_report := jsonb_build_object('live', v_live, 'ranAt', to_char(v_now, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'counts', v_counts, 'organisations', v_orgs);
  insert into dpdp.retention_run (live, report) values (v_live, v_report);
  return v_report;
end
$$;

-- Payment-proof files. Step 1 (the Edge Function dpdp-retention-files calls it daily): the expired objects of the private bucket, and whether deletion is live.
create or replace function public.dpdp_retention_proof_plan(p_force_dry_run boolean default false)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_set dpdp.retention_setting;
  v_live boolean;
  v_names jsonb := '[]'::jsonb;
  v_n bigint := 0;
begin
  select * into v_set from dpdp.retention_setting where id = 1;
  v_live := coalesce(v_set.live, false) and not coalesce(p_force_dry_run, false);
  if v_set.payment_proof_days is not null and to_regclass('storage.objects') is not null then
    select count(*), coalesce(jsonb_agg(o.name order by o.created_at), '[]'::jsonb)
      into v_n, v_names
      from (select name, created_at from storage.objects
             where bucket_id = 'dpdp-payment-proofs' and created_at < clock_timestamp() - make_interval(days => v_set.payment_proof_days)
             order by created_at limit 500) o;
  end if;
  return jsonb_build_object('live', v_live, 'days', v_set.payment_proof_days, 'count', v_n, 'names', case when v_live then v_names else '[]'::jsonb end);
end
$$;

-- Step 2: the files are gone from storage; forget their paths and write the count into the sweep's own book (dpdp.retention_run).
create or replace function public.dpdp_retention_proof_done(p_removed text[], p_live boolean, p_would_remove integer default 0)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_cleared bigint := 0;
  v_report jsonb;
begin
  if coalesce(p_live, false) and coalesce(array_length(p_removed, 1), 0) > 0 and to_regclass('dpdp.subscription') is not null then
    update dpdp.subscription set self_declared_proof_path = null where self_declared_proof_path = any(p_removed);
    get diagnostics v_cleared = row_count;
  end if;
  v_report := jsonb_build_object('live', coalesce(p_live, false), 'ranAt', to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'counts', jsonb_build_object('payment_proof_files', coalesce(array_length(p_removed, 1), 0), 'payment_proof_paths_cleared', v_cleared, 'payment_proof_files_past_period', coalesce(p_would_remove, 0)), 'organisations', '[]'::jsonb);
  insert into dpdp.retention_run (live, report) values (coalesce(p_live, false), v_report);
  return v_report;
end
$$;

revoke all on function public.dpdp_timer_retention_sweep(boolean) from public, anon, authenticated;
revoke all on function public.dpdp_retention_proof_plan(boolean) from public, anon, authenticated;
revoke all on function public.dpdp_retention_proof_done(text[], boolean, integer) from public, anon, authenticated;
grant execute on function public.dpdp_timer_retention_sweep(boolean) to service_role;
grant execute on function public.dpdp_retention_proof_plan(boolean) to service_role;
grant execute on function public.dpdp_retention_proof_done(text[], boolean, integer) to service_role;

-- The daily file job: calls the Edge Function with the same Vault bearer the other dpdp jobs use (02:40 UTC, after the 02:10 sweep). Skipped where pg_cron/pg_net are absent.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') and exists (select 1 from pg_extension where extname = 'pg_net') then
    perform cron.schedule(
      'dpdp-retention-files',
      '40 2 * * *',
      $cron$
        select net.http_post(
          url := replace((select decrypted_secret from vault.decrypted_secrets where name = 'dpdp_timer_url'), 'dpdp-monday-email', 'dpdp-retention-files'),
          headers := jsonb_build_object(
            'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'dpdp_timer_secret'),
            'Content-Type', 'application/json'
          ),
          body := '{"job":"retention_files"}'::jsonb,
          timeout_milliseconds := 120000
        )
      $cron$
    );
  end if;
end
$$;
