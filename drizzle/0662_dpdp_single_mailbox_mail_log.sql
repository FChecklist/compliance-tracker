-- PRE-APPROVED-LIVE-DDL: Owner instruction in chat, 2026-09-29 -- "is it possible we use only dpdp@veridian-aios.com from gmail ... and externally and internally multiple email IDs uses dpdp@veridian-aios.com and do the work" (the single-mailbox project). Authorizes the GRANT/REVOKE/SECURITY DEFINER statements below; nothing here is applied to a live database by the session that wrote it.
--
-- DPDP single mailbox -- the mail log. The public shows ONE address,
-- dpdp@veridian-aios.com. Everything the platform sends carries a
-- machine-readable Reply-To (dpdp+<tag>.<ref>@, see
-- supabase/functions/_shared/mail-taxonomy.ts) and every message that comes
-- back is sorted into a class (Monday reply, sales, sales thread, invoice,
-- grievance, data request, partner, support, auto, review) by the
-- dpdp-inbound-mail Edge Function. This migration is the database half:
--
--   dpdp.mail_outbound       one row per message the platform sent from the
--                            mailbox: the ref that is in its Reply-To, its
--                            class, the provider's message id, who it went
--                            to. A reply is matched to its row by ref (the
--                            plus-tag) or by message id (In-Reply-To /
--                            References).
--   dpdp.mail_inbound        one row per message that arrived, with a ticket
--                            number, the class it was given and WHY
--                            (classifier_reason), the legal-response due date
--                            for the classes that start a clock, and whether
--                            the sender was acknowledged and the operator
--                            told. Text excerpt only (first 4096 characters);
--                            attachments are never stored.
--   dpdp.mail_ticket_counter one counter per (class prefix, year): G-2026-0042.
--
-- WHERE THE LOGIC LIVES, AND WHY. dpdp.* is not exposed to PostgREST (only
-- public / graphql_public / compliance are -- 0604's header), so the Edge
-- Function reaches it through public.dpdp_mail_* SECURITY DEFINER functions
-- granted to service_role ONLY, the same shape as public.dpdp_timer_* (0606).
-- Unlike the timer's thin wrappers, the logic sits directly in these public
-- functions: there is no second caller (no app_runtime test path, no browser),
-- so a dpdp.* layer underneath would only be a second place for a grant to be
-- wrong. The one internal helper, dpdp.mail_next_ticket, is executable by
-- nobody (only the definer functions call it).
--
-- WHAT THIS IS NOT.
--   * Not a legal position. due_at is received_at + a number of days the
--     CALLER passes (the Edge Function reads DPDP_LEGAL_RESPONSE_DAYS, default
--     90); which number is right is the owner's and counsel's to confirm.
--   * Not a store of attachments or of full mail bodies. excerpt is capped at
--     4096 characters by a CHECK, and it still holds whatever personal data
--     the sender typed there: a retention rule for it is the owner's call and
--     nothing in this migration deletes anything.
--   * Ticket numbers are race-safe (one row lock per (prefix, year)) and gap-
--     free for successful inserts: the counter bump and the insert share one
--     sub-transaction, so a duplicate that loses the race rolls its bump back.
--
-- Additive only: three new tables, five new public functions and one internal
-- helper. No existing table, column or function is changed.

-- ---------------------------------------------------------------------
-- 1. Tables -- service_role only. No grant to anon or authenticated.
-- ---------------------------------------------------------------------
create table if not exists dpdp.mail_outbound (
  id text primary key default replace(gen_random_uuid()::text, '-', ''),
  -- The ref that is in the Reply-To (mail-taxonomy.ts newRef(): 10 characters
  -- of a 32-glyph alphabet with no i, l, o or u). One row per message.
  ref text not null,
  class text not null,
  org_id text,
  membership_id text,
  -- Resend's id for the message, and/or the RFC 5322 Message-ID header we
  -- know it went out with. Both are stored lower-cased without angle brackets,
  -- the same normalisation the Edge Function applies to In-Reply-To and
  -- References before it looks a reply up.
  provider_message_id text,
  message_id_header text,
  subject text,
  to_addr text not null,
  -- Set on an acknowledgement, so a reply to the acknowledgement can be tied
  -- back to the ticket it acknowledged.
  ticket_no text,
  sent_at timestamptz not null default now(),
  constraint mail_outbound_class_check check (class in (
    'monday', 'sales', 'sales_chain', 'invoice', 'grievance', 'data_request', 'partner', 'support', 'auto', 'review'
  )),
  constraint mail_outbound_ref_check check (ref ~ '^[0-9abcdefghjkmnpqrstvwxyz]{10}$')
);
create unique index if not exists dpdp_mail_outbound_ref_key on dpdp.mail_outbound (ref);
create index if not exists dpdp_mail_outbound_provider_message_id_idx
  on dpdp.mail_outbound (provider_message_id) where provider_message_id is not null;
create index if not exists dpdp_mail_outbound_message_id_header_idx
  on dpdp.mail_outbound (message_id_header) where message_id_header is not null;
create index if not exists dpdp_mail_outbound_sent_at_idx on dpdp.mail_outbound (sent_at desc);

create table if not exists dpdp.mail_inbound (
  id text primary key default replace(gen_random_uuid()::text, '-', ''),
  ticket_no text not null unique,
  class text not null,
  -- The ref read from the recipient's plus-tag, when there was one.
  ref text,
  from_addr text not null,
  to_addr text,
  subject text,
  message_id text,
  in_reply_to text,
  references_hdr text,
  received_at timestamptz not null default now(),
  -- received_at + the caller's response window, for the classes that start a
  -- legal clock; null for the rest.
  due_at timestamptz,
  status text not null default 'open',
  ack_sent_at timestamptz,
  -- First 4096 characters of the text body. Never an attachment.
  excerpt text,
  -- Which rule fired and on what, e.g. 'tag:grv', 'thread:sales->sales_chain',
  -- 'keyword:data_request:"delete my data"', 'default:no rule matched'.
  classifier_reason text,
  -- The dpdp.mail_outbound.ref this message answers, when one was found.
  matched_outbound_ref text,
  -- True when the operator got the raw mail instead of a classified notice
  -- because the classifier itself failed.
  raw_forwarded boolean not null default false,
  operator_notified_at timestamptz,
  created_at timestamptz not null default now(),
  constraint mail_inbound_class_check check (class in (
    'monday', 'sales', 'sales_chain', 'invoice', 'grievance', 'data_request', 'partner', 'support', 'auto', 'review'
  )),
  constraint mail_inbound_status_check check (status in ('open', 'acknowledged', 'closed')),
  constraint mail_inbound_excerpt_length_check check (excerpt is null or char_length(excerpt) <= 4096)
);
-- A delivery retried by the Worker must not become a second ticket: the same
-- sender's same Message-ID is one message. Keyed on the sender as well so one
-- party reusing another's Message-ID cannot stop that other party's mail.
create unique index if not exists dpdp_mail_inbound_sender_message_id_key
  on dpdp.mail_inbound (lower(from_addr), message_id) where message_id is not null;
create index if not exists dpdp_mail_inbound_class_received_idx on dpdp.mail_inbound (class, received_at desc);
create index if not exists dpdp_mail_inbound_due_idx
  on dpdp.mail_inbound (due_at) where due_at is not null and status <> 'closed';
create index if not exists dpdp_mail_inbound_ack_idx
  on dpdp.mail_inbound (lower(from_addr), ack_sent_at) where ack_sent_at is not null;

create table if not exists dpdp.mail_ticket_counter (
  prefix text not null,
  year integer not null,
  last_no integer not null default 0,
  primary key (prefix, year)
);

alter table dpdp.mail_outbound enable row level security;
alter table dpdp.mail_inbound enable row level security;
alter table dpdp.mail_ticket_counter enable row level security;

do $$
declare t text;
begin
  for t in select unnest(array['mail_outbound', 'mail_inbound', 'mail_ticket_counter'])
  loop
    begin
      execute format('create policy service_role_bypass on dpdp.%I for all to service_role using (true) with check (true)', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

revoke all on dpdp.mail_outbound, dpdp.mail_inbound, dpdp.mail_ticket_counter from public, anon, authenticated;
grant select, insert, update, delete on dpdp.mail_outbound, dpdp.mail_inbound, dpdp.mail_ticket_counter to service_role;

-- ---------------------------------------------------------------------
-- 2. Ticket numbers: G-2026-0042. One counter row per (prefix, year); the
--    ON CONFLICT DO UPDATE takes that row's lock, so two mails arriving at
--    once get two different numbers. Year is the IST calendar year, the
--    same clock dpdp.monday_week_key uses.
--      G grievance   D data request   R review      S sales      T sales thread
--      I invoice     M monday reply   P partner     H support    A auto
-- ---------------------------------------------------------------------
create or replace function dpdp.mail_next_ticket(p_class text, p_at timestamptz default now())
returns text
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_prefix text;
  v_year integer;
  v_no integer;
begin
  v_prefix := case p_class
    when 'grievance' then 'G'
    when 'data_request' then 'D'
    when 'review' then 'R'
    when 'sales' then 'S'
    when 'sales_chain' then 'T'
    when 'invoice' then 'I'
    when 'monday' then 'M'
    when 'partner' then 'P'
    when 'support' then 'H'
    when 'auto' then 'A'
    else null
  end;
  if v_prefix is null then
    raise exception 'Unknown mail class %', p_class using errcode = '22023';
  end if;
  v_year := extract(year from (coalesce(p_at, now()) at time zone 'Asia/Kolkata'))::integer;
  insert into dpdp.mail_ticket_counter (prefix, year, last_no)
  values (v_prefix, v_year, 1)
  on conflict (prefix, year) do update set last_no = dpdp.mail_ticket_counter.last_no + 1
  returning last_no into v_no;
  -- lpad would silently truncate a fifth digit; past 9999 the number just grows.
  return v_prefix || '-' || v_year::text || '-' || case when v_no < 10000 then lpad(v_no::text, 4, '0') else v_no::text end;
end
$$;

-- ---------------------------------------------------------------------
-- 3. Outbound log. The digest and invoice Edge Functions call it once per
--    message, AFTER the provider accepted it (a failed send leaves no row);
--    the inbound acknowledgement path calls it before the send and again
--    after it with the provider's id. A second call for the same ref fills
--    the ids in and changes nothing else. A ref already used by a different
--    class or recipient is refused, never merged.
-- ---------------------------------------------------------------------
create or replace function public.dpdp_mail_log_outbound(
  p_ref text,
  p_class text,
  p_to_addr text,
  p_subject text default null,
  p_provider_message_id text default null,
  p_org_id text default null,
  p_membership_id text default null,
  p_message_id_header text default null,
  p_ticket_no text default null
)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_row dpdp.mail_outbound;
  v_to text := left(btrim(coalesce(p_to_addr, '')), 320);
begin
  if p_ref is null or p_ref !~ '^[0-9abcdefghjkmnpqrstvwxyz]{10}$' then
    raise exception 'Invalid mail ref' using errcode = '22023';
  end if;
  if p_class is null or p_class not in (
    'monday', 'sales', 'sales_chain', 'invoice', 'grievance', 'data_request', 'partner', 'support', 'auto', 'review'
  ) then
    raise exception 'Unknown mail class %', p_class using errcode = '22023';
  end if;
  if v_to = '' then
    raise exception 'A recipient address is required' using errcode = '22023';
  end if;

  insert into dpdp.mail_outbound (
    ref, class, org_id, membership_id, provider_message_id, message_id_header, subject, to_addr, ticket_no
  ) values (
    p_ref, p_class, p_org_id, p_membership_id,
    nullif(lower(btrim(p_provider_message_id, E' <>\t\r\n')), ''),
    nullif(lower(btrim(p_message_id_header, E' <>\t\r\n')), ''),
    left(p_subject, 500), v_to, p_ticket_no
  )
  on conflict (ref) do update set
    provider_message_id = coalesce(excluded.provider_message_id, dpdp.mail_outbound.provider_message_id),
    message_id_header = coalesce(excluded.message_id_header, dpdp.mail_outbound.message_id_header)
  where dpdp.mail_outbound.class = excluded.class and dpdp.mail_outbound.to_addr = excluded.to_addr
  returning * into v_row;

  if v_row.id is null then
    raise exception 'Mail ref % is already used by a different message', p_ref using errcode = '23505';
  end if;
  return jsonb_build_object('id', v_row.id, 'ref', v_row.ref, 'class', v_row.class);
end
$$;

-- ---------------------------------------------------------------------
-- 4. Outbound lookup for an arriving reply. The ref (from the plus-tag) wins
--    over a message-id match; among message-id matches the newest wins.
--    Returns NULL when nothing matches. p_message_ids must already be
--    normalised the way section 3 stores them.
-- ---------------------------------------------------------------------
create or replace function public.dpdp_mail_lookup_outbound(
  p_ref text default null,
  p_message_ids text[] default '{}'::text[]
)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'ref', o.ref,
    'class', o.class,
    'ticketNo', o.ticket_no,
    'orgId', o.org_id,
    'membershipId', o.membership_id,
    'sentAt', o.sent_at,
    'matchedBy', case when p_ref is not null and o.ref = p_ref then 'ref' else 'message_id' end
  )
  from dpdp.mail_outbound o
  where (p_ref is not null and o.ref = p_ref)
     or (coalesce(cardinality(p_message_ids), 0) > 0
         and (o.provider_message_id = any (p_message_ids) or o.message_id_header = any (p_message_ids)))
  order by (p_ref is not null and o.ref = p_ref) desc, o.sent_at desc
  limit 1
$$;

-- ---------------------------------------------------------------------
-- 5. Inbound insert. Idempotent per (sender, Message-ID): a retried delivery
--    returns the existing ticket with duplicate = true. ackDue is true only
--    when the caller wants an acknowledgement sent, none has been sent for
--    this ticket, and fewer than 3 have gone to this sender in 24 hours (the
--    stop for an auto-responder that answers our acknowledgement).
--    p_due_days is passed by the caller: null = no legal clock for this class.
-- ---------------------------------------------------------------------
create or replace function public.dpdp_mail_insert_inbound(
  p_class text,
  p_from_addr text,
  p_subject text,
  p_message_id text,
  p_received_at timestamptz default null,
  p_due_days integer default null,
  p_ref text default null,
  p_to_addr text default null,
  p_in_reply_to text default null,
  p_references_hdr text default null,
  p_excerpt text default null,
  p_classifier_reason text default null,
  p_matched_outbound_ref text default null,
  p_raw_forwarded boolean default false,
  p_wants_ack boolean default false
)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_at timestamptz := coalesce(p_received_at, now());
  v_from text := left(coalesce(nullif(btrim(p_from_addr), ''), '(unknown sender)'), 320);
  v_msgid text := left(nullif(btrim(p_message_id), ''), 998);
  v_ref text := case when p_ref ~ '^[0-9abcdefghjkmnpqrstvwxyz]{10}$' then p_ref else null end;
  v_matched text := case when p_matched_outbound_ref ~ '^[0-9abcdefghjkmnpqrstvwxyz]{10}$' then p_matched_outbound_ref else null end;
  v_row dpdp.mail_inbound;
  v_dup boolean := false;
  v_recent integer;
  v_ack_due boolean := false;
begin
  if p_class is null or p_class not in (
    'monday', 'sales', 'sales_chain', 'invoice', 'grievance', 'data_request', 'partner', 'support', 'auto', 'review'
  ) then
    raise exception 'Unknown mail class %', p_class using errcode = '22023';
  end if;
  if p_due_days is not null and (p_due_days < 1 or p_due_days > 3650) then
    raise exception 'p_due_days must be between 1 and 3650' using errcode = '22023';
  end if;

  if v_msgid is not null then
    select * into v_row from dpdp.mail_inbound where lower(from_addr) = lower(v_from) and message_id = v_msgid;
    v_dup := found;
  end if;

  if not v_dup then
    begin
      insert into dpdp.mail_inbound (
        ticket_no, class, ref, from_addr, to_addr, subject, message_id, in_reply_to, references_hdr,
        received_at, due_at, excerpt, classifier_reason, matched_outbound_ref, raw_forwarded
      ) values (
        dpdp.mail_next_ticket(p_class, v_at), p_class, v_ref, v_from, left(p_to_addr, 320), left(p_subject, 500),
        v_msgid, left(p_in_reply_to, 998), left(p_references_hdr, 8000),
        v_at, case when p_due_days is null then null else v_at + make_interval(days => p_due_days) end,
        left(p_excerpt, 4096), left(p_classifier_reason, 500), v_matched, coalesce(p_raw_forwarded, false)
      ) returning * into v_row;
    exception when unique_violation then
      -- Lost a race with the same delivery: hand back the winner's ticket.
      select * into v_row from dpdp.mail_inbound where lower(from_addr) = lower(v_from) and message_id = v_msgid;
      if v_row.id is null then
        raise;
      end if;
      v_dup := true;
    end;
  end if;

  if coalesce(p_wants_ack, false) and v_row.ack_sent_at is null then
    select count(*) into v_recent from dpdp.mail_inbound
    where lower(from_addr) = lower(v_from) and ack_sent_at > now() - interval '24 hours' and id <> v_row.id;
    v_ack_due := v_recent < 3;
  end if;

  return jsonb_build_object(
    'id', v_row.id,
    'ticketNo', v_row.ticket_no,
    'class', v_row.class,
    'status', v_row.status,
    'dueAt', v_row.due_at,
    'duplicate', v_dup,
    'ackDue', v_ack_due,
    'operatorNotified', v_row.operator_notified_at is not null
  );
end
$$;

-- ---------------------------------------------------------------------
-- 6. Marks. Both are idempotent: the first call sets the time, later calls
--    leave it. mark_ack also moves an 'open' ticket to 'acknowledged'.
-- ---------------------------------------------------------------------
create or replace function public.dpdp_mail_mark_ack(p_ticket_no text)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_row dpdp.mail_inbound;
begin
  update dpdp.mail_inbound
  set ack_sent_at = coalesce(ack_sent_at, now()),
      status = case when status = 'open' then 'acknowledged' else status end
  where ticket_no = p_ticket_no
  returning * into v_row;
  if v_row.id is null then
    return jsonb_build_object('ok', false);
  end if;
  return jsonb_build_object('ok', true, 'status', v_row.status, 'ackSentAt', v_row.ack_sent_at);
end
$$;

create or replace function public.dpdp_mail_mark_notified(p_ticket_no text)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_row dpdp.mail_inbound;
begin
  update dpdp.mail_inbound
  set operator_notified_at = coalesce(operator_notified_at, now())
  where ticket_no = p_ticket_no
  returning * into v_row;
  if v_row.id is null then
    return jsonb_build_object('ok', false);
  end if;
  return jsonb_build_object('ok', true, 'operatorNotifiedAt', v_row.operator_notified_at);
end
$$;

-- ---------------------------------------------------------------------
-- 7. Grants. The helper: nobody. The public functions: service_role only.
-- ---------------------------------------------------------------------
revoke all on function dpdp.mail_next_ticket(text, timestamptz) from public, anon, authenticated, service_role;

revoke all on function public.dpdp_mail_log_outbound(text, text, text, text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.dpdp_mail_lookup_outbound(text, text[]) from public, anon, authenticated;
revoke all on function public.dpdp_mail_insert_inbound(text, text, text, text, timestamptz, integer, text, text, text, text, text, text, text, boolean, boolean) from public, anon, authenticated;
revoke all on function public.dpdp_mail_mark_ack(text) from public, anon, authenticated;
revoke all on function public.dpdp_mail_mark_notified(text) from public, anon, authenticated;

grant execute on function public.dpdp_mail_log_outbound(text, text, text, text, text, text, text, text, text) to service_role;
grant execute on function public.dpdp_mail_lookup_outbound(text, text[]) to service_role;
grant execute on function public.dpdp_mail_insert_inbound(text, text, text, text, timestamptz, integer, text, text, text, text, text, text, text, boolean, boolean) to service_role;
grant execute on function public.dpdp_mail_mark_ack(text) to service_role;
grant execute on function public.dpdp_mail_mark_notified(text) to service_role;
