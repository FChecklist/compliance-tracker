-- PRE-APPROVED-LIVE-DDL: Owner instruction in chat, 2026-09-29 -- see
-- drizzle/0658's own citation line; this file is part of the same
-- payment-confirmation work it authorizes.
--
-- Payment confirmation flow, part 4 -- two things the invoice function
-- (0659) needs that weren't there yet: 'invoice' as a real dpdp.email_send
-- kind (0606 only ever anticipated the five Monday-timer kinds), and the
-- owner's identity_id alongside their email in dpdp_timer_invoice_details
-- (dpdp.email_send.identity_id is not-null; dpdp_timer_invoice_details
-- only returned the membership id and email until now).

alter table dpdp.email_send drop constraint if exists email_send_kind_check;
alter table dpdp.email_send add constraint email_send_kind_check
  check (kind in ('monday_digest', 'escalation', 'leak_clock', 'rights_clock', 'statutory', 'invoice'));

create or replace function dpdp.record_email_send(
  p_org_id text,
  p_membership_id text,
  p_identity_id text,
  p_obligation_ids text[],
  p_kind text,
  p_period_key text,
  p_to_email text,
  p_subject text,
  p_status text default 'queued',
  p_body_text text default null
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_id text := replace(gen_random_uuid()::text, '-', '');
  v_raw text := dpdp.new_opaque_token();
begin
  if p_kind not in ('monday_digest', 'escalation', 'leak_clock', 'rights_clock', 'statutory', 'invoice') then
    raise exception 'Unknown email kind %', p_kind using errcode = '22023';
  end if;
  if p_status not in ('queued', 'dry_run') then
    raise exception 'record_email_send accepts status queued or dry_run, not %', p_status using errcode = '22023';
  end if;
  begin
    insert into dpdp.email_send (
      id, org_id, membership_id, identity_id, obligation_ids, kind, period_key, to_email, subject, body_text, status, list_unsubscribe_token_hash
    ) values (
      v_id, p_org_id, p_membership_id, p_identity_id, coalesce(p_obligation_ids, '{}'::text[]), p_kind, p_period_key, p_to_email, p_subject,
      case when p_status = 'dry_run' then p_body_text end, p_status, dpdp.email_token_hash(v_raw)
    );
  exception when unique_violation then
    return jsonb_build_object('id', null, 'duplicate', true);
  end;
  return jsonb_build_object('id', v_id, 'unsubscribeToken', v_raw, 'duplicate', false);
end
$$;

create or replace function public.dpdp_timer_invoice_details(p_payment_id text)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'paymentId', p.id,
    'orgId', p.org_id,
    'orgName', o.name,
    'plan', p.plan,
    'interval', p."interval",
    'amountPaise', p.amount_paise,
    'periodStart', p.period_start,
    'confirmedAt', p.confirmed_at,
    'confirmedNote', p.confirmed_note,
    'ownerMembershipId', m.id,
    'ownerIdentityId', m.identity_id,
    'ownerEmail', ie.email
  )
  from dpdp.payment p
  join dpdp.organisation o on o.id = p.org_id
  left join dpdp.membership m on m.org_id = p.org_id and m.level = 'owner'
  left join dpdp.identity_email ie on ie.identity_id = m.identity_id and ie.is_primary
  where p.id = p_payment_id
$$;
