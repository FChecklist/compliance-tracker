-- PRE-APPROVED-LIVE-DDL: Owner instruction in chat, 2026-09-29 -- asked
-- directly for "the whole payment process" (bank/UPI/QR, proof, owner
-- review/approve, invoice) to be built end to end, under this session's
-- standing autonomy directive ("you take all decisions, dont ask me, i
-- am non technical, i want completion"). Authorizes the GRANT/REVOKE/
-- DROP POLICY/SECURITY DEFINER statements below and in 0659-0661.
--
-- WO-DPDP-016 follow-on -- manual payment confirmation, end to end
-- (Owner instruction, this session, 2026-09-29): dpdp_declare_payment
-- already let an org owner say "I've paid" (drizzle/0655), and
-- dpdp_record_confirmed_payment already existed to move an org to
-- active and pay out any referral commission -- but that second
-- function was service_role-only, so the ONLY way to actually confirm
-- a real payment was to run raw SQL by hand. This migration adds:
--   1. a proof trail on the self-declared claim (reference/UTR + an
--      optional screenshot path + a note), so "I've paid" carries
--      something to check, not just an amount;
--   2. dpdp.platform_admin -- a tiny allowlist (not a membership level;
--      this is VERIDIAN's own team, not any one org's) so the two new
--      Owner-facing RPCs below can gate on "is this really the Owner",
--      the same way dpdp_my_billing already gates on "is this the
--      org's own owner";
--   3. dpdp_owner_pending_claims / dpdp_owner_approve_payment /
--      dpdp_owner_reject_payment -- callable from the browser
--      (authenticated), each wrapping the existing service_role-only
--      machinery, so the Owner can work from a screen in the app
--      instead of the Supabase SQL editor.
-- Nothing here changes what dpdp_declare_payment or
-- dpdp_record_confirmed_payment themselves decide -- same states, same
-- referral-commission trigger -- this only adds a front door to each.

-- ---------------------------------------------------------------------
-- 1. Proof fields on the existing self-declared claim.
-- ---------------------------------------------------------------------
alter table dpdp.subscription
  add column if not exists self_declared_reference text,
  add column if not exists self_declared_proof_path text,
  add column if not exists self_declared_note text;

-- ---------------------------------------------------------------------
-- 2. Who is allowed to see/approve every org's billing -- VERIDIAN's own
--    team, kept as data (not a hard-coded email in every function) so
--    adding a second admin later is a row, not a migration. Nobody can
--    write to this from the browser (no grant to authenticated/anon);
--    only a service_role session (Supabase SQL editor, or this session
--    via the Supabase MCP) can add or remove a row.
-- ---------------------------------------------------------------------
create table if not exists dpdp.platform_admin (
  email text primary key,
  added_at timestamp not null default (clock_timestamp() at time zone 'UTC'),
  note text
);
alter table dpdp.platform_admin enable row level security;

insert into dpdp.platform_admin (email, note) values
  ('raajat.agarwal@gmail.com', 'Owner')
on conflict (email) do nothing;

create or replace function public.dpdp__is_platform_admin()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from dpdp.platform_admin pa
    where pa.email = lower(trim(coalesce(auth.jwt() ->> 'email', '')))
  )
$$;

revoke all on function public.dpdp__is_platform_admin() from public, anon;
grant execute on function public.dpdp__is_platform_admin() to authenticated, service_role, app_runtime;

-- ---------------------------------------------------------------------
-- 3. dpdp_declare_payment widened (WO-016 signature: p_interval,
--    p_amount_paise, p_org_id) with three new, optional, trailing
--    params -- every existing positional caller (BillingPanel.tsx)
--    still compiles unchanged; the new UI passes the extra three once
--    it exists.
-- ---------------------------------------------------------------------
create or replace function public.dpdp_declare_payment(
  p_interval text, p_amount_paise integer, p_org_id text default null,
  p_reference text default null, p_proof_path text default null, p_note text default null
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_m dpdp.membership;
  v_reference text := nullif(trim(coalesce(p_reference, '')), '');
  v_note text := nullif(trim(coalesce(p_note, '')), '');
begin
  v_m := public.dpdp__caller_membership(p_org_id);
  if v_m.id is null then
    raise exception 'Not a member of this organisation' using errcode = '42501';
  end if;
  if v_m.level <> 'owner' then
    raise exception 'Only the owner can record a payment' using errcode = '42501';
  end if;
  if p_interval not in ('month', 'year') then
    raise exception 'interval must be ''month'' or ''year''' using errcode = '22023';
  end if;
  if p_amount_paise is null or p_amount_paise <= 0 then
    raise exception 'amount_paise must be a positive number' using errcode = '22023';
  end if;

  insert into dpdp.subscription (
    org_id, trial_ends_at, state, "interval",
    self_declared_at, self_declared_interval, self_declared_amount_paise,
    self_declared_reference, self_declared_proof_path, self_declared_note
  )
  values (
    v_m.org_id, (clock_timestamp() at time zone 'UTC'), 'awaiting_confirmation', p_interval,
    (clock_timestamp() at time zone 'UTC'), p_interval, p_amount_paise,
    v_reference, p_proof_path, v_note
  )
  on conflict (org_id) do update set
    state = 'awaiting_confirmation', "interval" = p_interval,
    self_declared_at = (clock_timestamp() at time zone 'UTC'), self_declared_interval = p_interval, self_declared_amount_paise = p_amount_paise,
    self_declared_reference = v_reference, self_declared_proof_path = p_proof_path, self_declared_note = v_note;

  perform public.dpdp__append_event(v_m.org_id, v_m.identity_id, 'Owner',
    'payment_declared',
    'Owner said they paid Rs ' || to_char(p_amount_paise / 100.0, 'FM999999999.00') || ' (' || p_interval || 'ly) -- awaiting confirmation',
    p_interval);

  return jsonb_build_object('ok', true, 'state', 'awaiting_confirmation');
end
$$;

revoke all on function public.dpdp_declare_payment(text, integer, text, text, text, text) from public, anon;
grant execute on function public.dpdp_declare_payment(text, integer, text, text, text, text) to authenticated, app_runtime;

-- ---------------------------------------------------------------------
-- 4. The Owner's worklist: every org currently awaiting confirmation,
--    oldest first, with everything needed to check the claim without
--    leaving the app. Only dpdp__is_platform_admin() may call this --
--    this is money across every organisation on the platform, not one
--    org's own data.
-- ---------------------------------------------------------------------
create or replace function public.dpdp_owner_pending_claims()
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select case when public.dpdp__is_platform_admin() then coalesce(jsonb_agg(jsonb_build_object(
    'orgId', o.id,
    'orgName', o.name,
    'product', o.product,
    'interval', s.self_declared_interval,
    'amountPaise', s.self_declared_amount_paise,
    'reference', s.self_declared_reference,
    'proofPath', s.self_declared_proof_path,
    'note', s.self_declared_note,
    'declaredAt', s.self_declared_at,
    'ownerEmail', ie.email
  ) order by s.self_declared_at asc), '[]'::jsonb)
  else (select null::jsonb where public.dpdp__require_platform_admin()) end
  from dpdp.subscription s
  join dpdp.organisation o on o.id = s.org_id
  left join dpdp.membership m on m.org_id = s.org_id and m.level = 'owner'
  left join dpdp.identity_email ie on ie.identity_id = m.identity_id and ie.is_primary
  where s.state = 'awaiting_confirmation'
$$;

-- dpdp__require_platform_admin() only exists to make the refusal above
-- raise with a clear message instead of the sql-language function
-- silently returning an empty list to someone who isn't the Owner --
-- same "refuse loudly" convention as every other dpdp_my_* RPC.
create or replace function public.dpdp__require_platform_admin()
returns boolean
language plpgsql stable security definer
set search_path = ''
as $$
begin
  raise exception 'Owner only' using errcode = '42501';
end
$$;
revoke all on function public.dpdp__require_platform_admin() from public, anon, authenticated;
grant execute on function public.dpdp__require_platform_admin() to service_role, app_runtime;

revoke all on function public.dpdp_owner_pending_claims() from public, anon;
grant execute on function public.dpdp_owner_pending_claims() to authenticated, app_runtime;

-- ---------------------------------------------------------------------
-- 5. Approve: the Owner's one real act. Wraps the existing
--    dpdp_record_confirmed_payment (service_role-only, unchanged) so
--    the state transition, the payment row, and the referral-commission
--    trigger are exactly what WO-016 §4/§8 already built and tested --
--    this just gives the Owner a callable front door instead of a
--    service_role SQL session. The plan comes from the organisation's
--    own product (an org's plan never differs from what it signed up
--    as); the interval/amount come from what was actually declared,
--    not from the caller, so an Owner approving cannot silently change
--    the amount -- amend the claim first via reject, or note the
--    discrepancy in p_note, if the numbers don't match what arrived.
-- ---------------------------------------------------------------------
create or replace function public.dpdp_owner_approve_payment(p_org_id text, p_note text default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_org dpdp.organisation;
  v_sub dpdp.subscription;
  v_note text;
begin
  if not public.dpdp__is_platform_admin() then
    raise exception 'Owner only' using errcode = '42501';
  end if;
  select * into v_org from dpdp.organisation where id = p_org_id;
  if v_org.id is null then
    raise exception 'No such organisation' using errcode = '22023';
  end if;
  select * into v_sub from dpdp.subscription where org_id = p_org_id;
  if v_sub.org_id is null or v_sub.state <> 'awaiting_confirmation' then
    raise exception 'This organisation has no payment awaiting confirmation' using errcode = '22023';
  end if;

  v_note := trim(coalesce(p_note, ''));
  if v_sub.self_declared_reference is not null then
    v_note := trim('Ref ' || v_sub.self_declared_reference || '. ' || v_note);
  end if;

  return public.dpdp_record_confirmed_payment(
    p_org_id, v_org.product, v_sub.self_declared_interval, v_sub.self_declared_amount_paise,
    current_date, nullif(v_note, '')
  );
end
$$;

revoke all on function public.dpdp_owner_approve_payment(text, text) from public, anon;
grant execute on function public.dpdp_owner_approve_payment(text, text) to authenticated, app_runtime;

-- ---------------------------------------------------------------------
-- 6. Reject: sends the org back to a plain trial (not "no plan"), and
--    clears the claim so the pill goes back to showing days left
--    rather than "confirming your payment..." forever. The claim
--    itself is not deleted, only superseded -- dpdp.event keeps the
--    real record of what was declared and why it was refused.
-- ---------------------------------------------------------------------
create or replace function public.dpdp_owner_reject_payment(p_org_id text, p_note text default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_sub dpdp.subscription;
begin
  if not public.dpdp__is_platform_admin() then
    raise exception 'Owner only' using errcode = '42501';
  end if;
  select * into v_sub from dpdp.subscription where org_id = p_org_id;
  if v_sub.org_id is null or v_sub.state <> 'awaiting_confirmation' then
    raise exception 'This organisation has no payment awaiting confirmation' using errcode = '22023';
  end if;

  update dpdp.subscription
  set state = 'trial',
      self_declared_at = null, self_declared_interval = null, self_declared_amount_paise = null,
      self_declared_reference = null, self_declared_proof_path = null, self_declared_note = null
  where org_id = p_org_id;

  perform public.dpdp__append_event(p_org_id, null, 'Owner', 'payment_rejected',
    'Payment claim could not be confirmed' || case when trim(coalesce(p_note, '')) <> '' then ': ' || p_note else '' end,
    null);

  return jsonb_build_object('ok', true, 'state', 'trial');
end
$$;

revoke all on function public.dpdp_owner_reject_payment(text, text) from public, anon;
grant execute on function public.dpdp_owner_reject_payment(text, text) to authenticated, app_runtime;

-- ---------------------------------------------------------------------
-- 7. Storage for the proof screenshot. Any signed-in person may upload
--    (a spammed bad upload costs nothing but storage; the Owner never
--    trusts an upload on its own, only alongside the reference number
--    and the claim it belongs to) -- only a platform admin may read one
--    back, since these are payment screenshots, not public files.
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('dpdp-payment-proofs', 'dpdp-payment-proofs', false)
on conflict (id) do nothing;

drop policy if exists "dpdp payment proof insert" on storage.objects;
create policy "dpdp payment proof insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'dpdp-payment-proofs');

drop policy if exists "dpdp payment proof read (admin only)" on storage.objects;
create policy "dpdp payment proof read (admin only)" on storage.objects
  for select to authenticated
  using (bucket_id = 'dpdp-payment-proofs' and public.dpdp__is_platform_admin());
