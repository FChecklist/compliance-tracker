-- PRE-APPROVED-LIVE-DDL: Owner decision, 2026-10-01 (chat, passed on verbatim in the work order for this change) -- "per-message operator emails stop for every class EXCEPT grievance and data_request ... add a once-a-day digest to the operator, sent ONLY if at least one non-auto ticket arrived in the last 24h and was not already in a previous digest ... pick ~09:00 IST". Authorizes the two SECURITY DEFINER functions, their GRANT/REVOKE statements and the pg_cron job below; NOT applied live by the session that wrote it -- the owner / PM applies it with the documented procedure (dpdp-app/OPERATIONS.md, "Operator daily digest").
--
-- DPDP single mailbox -- the operator's once-a-day digest (follows drizzle/0662).
--
-- WHAT CHANGED IN THE PRODUCT. dpdp-inbound-mail used to email the operator (DPDP_OPERATOR_EMAIL) once for EVERY
-- message in every class but `auto`. From now on it does that only for the two classes that start a legal clock,
-- `grievance` and `data_request`. Every other class is only recorded in dpdp.mail_inbound -- and shows up in ONE
-- plain-text email per day, sent at about 09:00 IST, only on a day when something new arrived.
--
-- WHAT THIS FILE ADDS (additive: one nullable column, one partial index, two functions, one cron job):
--   dpdp.mail_inbound.digested_at   set (once) when a ticket has been listed in a digest, so nothing is listed twice.
--   public.dpdp_mail_digest_pending(p_now, p_hours)
--       the tickets the next digest would list: class <> 'auto', not closed, never digested, created in the last
--       p_hours hours (default 25: the cron runs every 24, and the extra hour keeps a run that is a few minutes late from
--       dropping a message that arrived just after the previous run; digested_at is what stops repeats, not the window).
--       Newest last, at most 200. Returns { count, tickets: [ { ticketNo, class, from, subject, receivedAt } ] }.
--       It reads `created_at` (when WE recorded it), not `received_at` (the sender's / provider's clock).
--   public.dpdp_mail_digest_mark(p_ticket_nos)
--       called by the Edge Function AFTER the provider accepted the digest email; sets digested_at on exactly the
--       tickets that were listed, so a message that arrives between the two calls is NOT marked and goes in tomorrow's.
--   cron job `dpdp-operator-digest`, 30 3 * * * (03:30 UTC = 09:00 IST), the same request shape as
--       `dpdp-monday-retry` (drizzle/0654): the bearer is the Vault secret `dpdp_timer_secret`, and the URL is the Vault
--       secret `dpdp_timer_url` (which points at dpdp-monday-email) with the function name swapped for
--       dpdp-inbound-mail, so no new Vault secret is needed. The function checks the bearer through
--       public.dpdp_timer_check_bearer (drizzle/0608) -- the same Vault secret -- or DPDP_INBOUND_SECRET.
--       cron.schedule upserts by name, so re-running this file replaces the job instead of adding a second one.
--
-- WHAT THIS IS NOT. It does not send anything: the Edge Function does, and it sends nothing when there is nothing
-- to list. It does not change dpdp_mail_insert_inbound or any other 0662 object. A ticket that was already emailed
-- to the operator one by one (grievance, data_request) is also listed in the digest, once, as a roll-call of what is
-- still open.

alter table dpdp.mail_inbound add column if not exists digested_at timestamptz;

-- Only the rows a digest could still pick up are indexed; it empties itself as digests are sent.
create index if not exists dpdp_mail_inbound_undigested_idx
  on dpdp.mail_inbound (created_at)
  where digested_at is null and class <> 'auto' and status <> 'closed';

create or replace function public.dpdp_mail_digest_pending(p_now timestamptz default now(), p_hours integer default 25)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_hours integer := least(greatest(coalesce(p_hours, 25), 1), 168);
  v_out jsonb;
begin
  select jsonb_build_object(
           'count', count(*),
           'tickets', coalesce(jsonb_agg(jsonb_build_object(
             'ticketNo', t.ticket_no,
             'class', t.class,
             'from', t.from_addr,
             'subject', t.subject,
             'receivedAt', t.received_at
           ) order by t.created_at, t.ticket_no), '[]'::jsonb)
         )
  into v_out
  from (
    select m.ticket_no, m.class, m.from_addr, m.subject, m.received_at, m.created_at
    from dpdp.mail_inbound m
    where m.digested_at is null
      and m.class <> 'auto'
      and m.status <> 'closed'
      and m.created_at > coalesce(p_now, now()) - make_interval(hours => v_hours)
      and m.created_at <= coalesce(p_now, now())
    order by m.created_at, m.ticket_no
    limit 200
  ) t;
  return v_out;
end
$$;

create or replace function public.dpdp_mail_digest_mark(p_ticket_nos text[])
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  if p_ticket_nos is null or cardinality(p_ticket_nos) = 0 then
    return jsonb_build_object('ok', true, 'marked', 0);
  end if;
  update dpdp.mail_inbound
  set digested_at = coalesce(digested_at, now())
  where ticket_no = any (p_ticket_nos);
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'marked', v_n);
end
$$;

revoke all on function public.dpdp_mail_digest_pending(timestamptz, integer) from public, anon, authenticated;
revoke all on function public.dpdp_mail_digest_mark(text[]) from public, anon, authenticated;
grant execute on function public.dpdp_mail_digest_pending(timestamptz, integer) to service_role;
grant execute on function public.dpdp_mail_digest_mark(text[]) to service_role;

-- 03:30 UTC = 09:00 IST, every day. A day with nothing new sends no email (the function decides, not the cron).
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') and exists (select 1 from pg_extension where extname = 'pg_net') then
    perform cron.schedule(
      'dpdp-operator-digest',
      '30 3 * * *',
      $cron$
        select net.http_post(
          url := replace((select decrypted_secret from vault.decrypted_secrets where name = 'dpdp_timer_url'), 'dpdp-monday-email', 'dpdp-inbound-mail'),
          headers := jsonb_build_object(
            'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'dpdp_timer_secret'),
            'Content-Type', 'application/json'
          ),
          body := '{"job":"operator_digest"}'::jsonb,
          timeout_milliseconds := 60000
        )
      $cron$
    );
  end if;
end
$$;
