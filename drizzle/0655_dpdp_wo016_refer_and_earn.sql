-- WO-DPDP-016 "Refer and earn" -- closes the gap R75/exploration found: the
-- referral code + share button (drizzle/0611) already worked, but the new
-- self-signup RPC (drizzle/0654's dpdp_create_my_org) never captured a
-- referral code, so attribution from the static app was silently a no-op.
-- Also adds what never existed at all: a "became a paying customer" hook
-- and a commission ledger, matching the Owner's real pricing (chat,
-- 2026-09-29): both editions (firm/institution) sold yearly-only at
-- Rs 9999/yr (Rs 1999/mo shown for comparison only) --
--   * yearly plan: 20% commission, on EVERY renewal, for as long as the
--     referred client stays -- matched purely on the org's own referral
--     attribution, no time limit.
--   * monthly plan (not actually sold today, rule kept ready anyway): 5%
--     commission, first confirmed month only, nothing on later months.
-- A payment only counts once Shobha Kamal Solutions Pvt Ltd (the Owner)
-- manually confirms it (dpdp_record_confirmed_payment, service_role only --
-- there is no payment gateway in this codebase to hang an automatic trigger
-- off of). Payout itself stays manual (UPI/bank, outside this system);
-- dpdp_admin_pending_payouts / dpdp_mark_commission_paid just give the
-- Owner a ledger to work off instead of a spreadsheet.
--
-- Also widens WO-014 §3's share ask from decision-makers-only to every
-- signed-in person (Owner instruction, this session: "every email gets a
-- default share link for refer") -- dpdp__share_role now returns 'member'
-- instead of refusing/nulling for coordinator/GO/staff/teacher, so
-- dpdp_my_referral_code and dpdp_record_share_press (unchanged below) hand
-- out a code to anyone with an active membership, not just owner/CA.
--
-- §7-8: the trial/billing status the Owner described (chat, same session):
-- every new org gets 30 free days from its own created_at (no calendar
-- alignment -- "the payment cycle is from the date of registration"). The
-- org's owner can self-declare "I've paid" (dpdp_declare_payment) any time;
-- that is a claim, not a fact -- it flips the org to awaiting_confirmation
-- and is shown to the Owner as a promise ("we usually confirm within 48
-- hours"), but changes NOTHING about what the org can do (Owner, this
-- session: "just an SLA label, access never changes" -- a compliance tool
-- must not lock a client out of their own statutory obligations over an
-- unpaid invoice). Only dpdp_record_confirmed_payment (§4 above) -- the
-- Owner's own manual act, once the money is actually seen -- moves the org
-- to active and is the one moment a referral commission is ever created.
-- dpdp.subscription (0415) already existed for exactly this and had never
-- been written to by anything (confirmed by the exploration pass); it
-- gains three columns here rather than a new table.
--
-- Same rules as every dpdp browser-RPC file: public schema only, SECURITY
-- DEFINER, search_path = '', caller resolved server-side, one dpdp.event
-- per write, refusals in plain English. Additive except for
-- dpdp_create_my_org and dpdp__share_role, which change signature/behaviour
-- and are explicitly dropped and recreated (documented at each point) --
-- everything else here is new.

-- ---------------------------------------------------------------------
-- 1. Widen the share gate: every member gets a role (never null), so the
--    only refusal left is "not a member of this organisation at all".
-- ---------------------------------------------------------------------
create or replace function public.dpdp__share_role(p_org_id text default null)
returns text
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_m dpdp.membership;
  v_role text;
begin
  v_m := public.dpdp__caller_membership(p_org_id);
  if v_m.id is null then
    raise exception 'Not a member of this organisation' using errcode = '42501';
  end if;
  if v_m.level = 'owner' then
    return 'owner';
  end if;
  select coalesce(case
    when bool_or(t.role_tag = 'CAPARTNER') then 'partner'
    when bool_or(t.role_tag = 'CAMGR') then 'manager'
  end, 'member') into v_role
  from dpdp.obligation o join dpdp.obligation_template t on t.id = o.template_id
  where o.org_id = v_m.org_id and o.assigned_person_id = v_m.identity_id and o.state <> 'not_applicable';
  return coalesce(v_role, 'member');
end
$$;

-- dpdp_record_share_press (0611) must be re-created too: its v_label CASE
-- had only three branches with `else 'CA manager'` as the catch-all, which
-- was safe while dpdp__share_role could only return owner/partner/manager
-- (or null, refused before reaching here). Now that it can return
-- 'member', that same ELSE would mislabel every plain member's own
-- share_press event as "CA manager" -- found by writing this migration's
-- own test (dpdp-brand-share-rpc.test.ts), not left for someone else to
-- find. Everything else in this function is identical to 0611's.
create or replace function public.dpdp_record_share_press(p_org_id text default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_role text;
  v_m dpdp.membership;
  v_label text;
begin
  v_role := public.dpdp__share_role(p_org_id);
  if v_role is null then
    raise exception 'Only the owner, a CA partner or a CA manager can share a referral code' using errcode = '42501';
  end if;
  v_m := public.dpdp__caller_membership(p_org_id);
  v_label := case v_role when 'owner' then 'Owner' when 'partner' then 'CA partner' when 'manager' then 'CA manager' else 'Member' end;
  perform public.dpdp__append_event(v_m.org_id, v_m.identity_id, v_label, 'share_press', v_label || ' pressed Share', v_role);
  return jsonb_build_object('ok', true, 'role', v_role);
end
$$;

-- ---------------------------------------------------------------------
-- 2. Referral attribution at self-signup. Signature grows by one optional
--    param, so the old 2-arg function is dropped first (Postgres does not
--    "or replace" across a different argument list).
-- ---------------------------------------------------------------------
drop function if exists public.dpdp_create_my_org(text, text);

create or replace function public.dpdp_create_my_org(p_name text, p_product text, p_referral_code text default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_email text := lower(trim(coalesce(auth.jwt() ->> 'email', '')));
  v_name text := trim(coalesce(p_name, ''));
  v_identity text;
  v_base text;
  v_slug text;
  v_n int := 1;
  v_org_id text;
  v_membership_id text;
  v_jobs int;
  v_existing record;
  v_ref dpdp.referral;
  v_block_reason text;
  v_event_id text;
begin
  if v_email = '' then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if v_name = '' then
    raise exception 'An organisation name is required' using errcode = '22023';
  end if;
  if length(v_name) > 120 then
    raise exception 'The organisation name is too long (120 characters at most)' using errcode = '22023';
  end if;
  if p_product is null or p_product not in ('firm', 'institution') then
    raise exception 'product must be ''firm'' or ''institution''' using errcode = '22023';
  end if;

  v_identity := public.dpdp__find_or_create_identity(v_email);

  -- A double click, a refresh or a retry returns the organisation just made.
  select o.id, o.slug, m.id as membership_id into v_existing
  from dpdp.membership m join dpdp.organisation o on o.id = m.org_id
  where m.identity_id = v_identity and m.level = 'owner' and m.joined_via = 'created'
    and o.name = v_name and o.product = p_product and o.created_at > (clock_timestamp() at time zone 'UTC') - interval '10 minutes'
  order by o.created_at desc limit 1;
  if v_existing.id is not null then
    return jsonb_build_object('ok', true, 'orgId', v_existing.id, 'slug', v_existing.slug, 'membershipId', v_existing.membership_id, 'jobs', 0, 'existing', true);
  end if;

  if (select count(*) from dpdp.membership m join dpdp.organisation o on o.id = m.org_id
      where m.identity_id = v_identity and m.level = 'owner' and m.joined_via = 'created'
        and o.created_at > (clock_timestamp() at time zone 'UTC') - interval '1 day') >= 5 then
    raise exception 'That is enough new organisations for one day. Try again tomorrow.' using errcode = '22023';
  end if;

  v_base := trim(both '-' from regexp_replace(lower(v_name), '[^a-z0-9]+', '-', 'g'));
  if v_base = '' then
    v_base := 'org';
  end if;
  v_slug := v_base;
  while exists (select 1 from dpdp.organisation o where o.slug = v_slug) loop
    v_n := v_n + 1;
    v_slug := v_base || '-' || v_n;
  end loop;

  v_org_id := replace(gen_random_uuid()::text, '-', '');
  insert into dpdp.organisation (id, name, slug, product) values (v_org_id, v_name, v_slug, p_product);

  v_membership_id := replace(gen_random_uuid()::text, '-', '');
  insert into dpdp.membership (id, identity_id, org_id, level, joined_via)
  values (v_membership_id, v_identity, v_org_id, 'owner', 'created');
  -- can_sign is never set at join time (membership_no_sign_at_join): a deliberate, separate update.
  update dpdp.membership set can_sign = true where id = v_membership_id;

  perform public.dpdp__append_event(v_org_id, v_identity, v_email, 'organisation_created', 'Organisation "' || v_name || '" created');
  v_jobs := public.dpdp__instantiate_obligations(v_org_id, v_identity);

  -- §7: 30 free days from registration, not from any calendar boundary.
  insert into dpdp.subscription (org_id, trial_ends_at, state)
  values (v_org_id, (clock_timestamp() at time zone 'UTC') + interval '30 days', 'trial')
  on conflict (org_id) do nothing;

  -- Referral attribution (WO-016), ported from src/lib/services/dpdp-
  -- referral-service.ts's decideReferralConflict/recordReferralAttempt so
  -- the static app never has to call back into the Next.js path:
  --   self_referral  -- the code belongs to the very person who just
  --                     signed up (their own new org is, trivially, one of
  --                     their own active orgs).
  --   shared_advisor -- one of the referrer's own orgs already 'advises'
  --                     this brand-new org, which cannot happen for an org
  --                     that is seconds old -- kept anyway so the two paths
  --                     (this one and the legacy Next.js route) can never
  --                     disagree if that ever changes.
  -- A code that does not resolve to an active dpdp.referral row is ignored
  -- (typo, revoked code, or simply none given): silently, the org is still
  -- created, exactly as the legacy path's best-effort recordReferralAttempt
  -- swallows a bad code rather than failing the signup over it.
  if p_referral_code is not null and trim(p_referral_code) <> '' then
    select r.* into v_ref from dpdp.referral r where upper(r.code) = upper(trim(p_referral_code)) and r.state = 'active';
    if v_ref.identity_id is not null then
      if v_ref.identity_id = v_identity then
        v_block_reason := 'self_referral';
      elsif exists (
        select 1 from dpdp.relationship rel
        join dpdp.membership rm on rm.org_id = rel.from_org and rm.identity_id = v_ref.identity_id and rm.state = 'active'
        where rel.to_org = v_org_id and rel.kind = 'advises' and rel.ended_at is null
      ) then
        v_block_reason := 'shared_advisor';
      else
        v_block_reason := null;
      end if;
      v_event_id := replace(gen_random_uuid()::text, '-', '');
      insert into dpdp.referral_event (id, referral_id, referred_org_id, at, outcome, block_reason)
      values (v_event_id, v_ref.identity_id, v_org_id, (clock_timestamp() at time zone 'UTC'),
        case when v_block_reason is null then 'signed_up' else 'blocked' end, v_block_reason);
    end if;
  end if;

  return jsonb_build_object('ok', true, 'orgId', v_org_id, 'slug', v_slug, 'membershipId', v_membership_id, 'jobs', v_jobs, 'existing', false);
end
$$;

revoke all on function public.dpdp_create_my_org(text, text, text) from public, anon;
grant execute on function public.dpdp_create_my_org(text, text, text) to authenticated, app_runtime;

-- ---------------------------------------------------------------------
-- 3. The commission ledger, plus the three columns dpdp.subscription (0415)
--    needed to actually track trial/billing status -- band_key/seats_used
--    are the OLD, never-wired band model (confirmed unused anywhere but
--    their own CREATE TABLE by a repo-wide grep) and are left untouched,
--    not reused: the Owner's real pricing is flat-rate-by-edition with a
--    percentage commission, not a floor/ceiling band with month-credits.
--    The two new tables are dpdp schema, no RLS, same as referral/
--    referral_event (0415's own comment: not exposed to PostgREST, reached
--    only through a public.dpdp_* RPC).
-- ---------------------------------------------------------------------
alter table dpdp.subscription
  add column if not exists "interval" text check ("interval" in ('month', 'year')),
  add column if not exists self_declared_at timestamp,
  add column if not exists self_declared_interval text check (self_declared_interval in ('month', 'year')),
  add column if not exists self_declared_amount_paise integer,
  add column if not exists last_confirmed_at timestamp;

create table if not exists dpdp.payment (
  id text primary key,
  org_id text not null references dpdp.organisation(id),
  plan text not null check (plan in ('firm', 'institution')),
  "interval" text not null check ("interval" in ('month', 'year')),
  amount_paise integer not null check (amount_paise > 0),
  period_start date not null default current_date,
  confirmed_at timestamp not null default (clock_timestamp() at time zone 'UTC'),
  confirmed_note text,
  created_at timestamp not null default (clock_timestamp() at time zone 'UTC')
);
create index if not exists dpdp_payment_org_id_idx on dpdp.payment (org_id, confirmed_at);

create table if not exists dpdp.referral_commission (
  id text primary key,
  referral_event_id text not null references dpdp.referral_event(id),
  payment_id text not null references dpdp.payment(id),
  referrer_identity_id text not null references dpdp.identity(id),
  rate numeric(5, 4) not null,
  amount_paise integer not null check (amount_paise >= 0),
  basis text not null check (basis in ('first_month', 'yearly')),
  payout_status text not null default 'pending' check (payout_status in ('pending', 'paid')),
  paid_at timestamp,
  paid_note text,
  created_at timestamp not null default (clock_timestamp() at time zone 'UTC')
);
create index if not exists dpdp_referral_commission_referrer_idx on dpdp.referral_commission (referrer_identity_id, payout_status);
create index if not exists dpdp_referral_commission_payment_idx on dpdp.referral_commission (payment_id);

-- ---------------------------------------------------------------------
-- 4. Record a confirmed payment; compute the commission (if any) in the
--    same transaction. service_role only -- there is no payment gateway
--    integration in this codebase (confirmed by the exploration pass: zero
--    code anywhere reads/writes dpdp.subscription/dpdp.band besides their
--    own CREATE TABLE), so "the payment has been confirmed by us" (the
--    Owner's own words) is, today, necessarily a human action -- run via
--    the Supabase SQL editor or MCP, the same way this repo already
--    applies most out-of-band operational changes. app_runtime is granted
--    too, only so a DB-gated test can call it under a simulated JWT, the
--    same reason every other service_role-only function here grants it.
-- ---------------------------------------------------------------------
create or replace function public.dpdp_record_confirmed_payment(
  p_org_id text, p_plan text, p_interval text, p_amount_paise integer, p_period_start date default current_date, p_note text default null
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_payment_id text;
  v_event dpdp.referral_event;
  v_rate numeric(5, 4);
  v_basis text;
  v_commission_amount integer;
  v_commission_id text;
  v_referrer_org_id text;
begin
  if not exists (select 1 from dpdp.organisation o where o.id = p_org_id) then
    raise exception 'No such organisation' using errcode = '22023';
  end if;
  if p_plan not in ('firm', 'institution') then
    raise exception 'plan must be ''firm'' or ''institution''' using errcode = '22023';
  end if;
  if p_interval not in ('month', 'year') then
    raise exception 'interval must be ''month'' or ''year''' using errcode = '22023';
  end if;
  if p_amount_paise is null or p_amount_paise <= 0 then
    raise exception 'amount_paise must be a positive number' using errcode = '22023';
  end if;

  v_payment_id := replace(gen_random_uuid()::text, '-', '');
  insert into dpdp.payment (id, org_id, plan, "interval", amount_paise, period_start, confirmed_note)
  values (v_payment_id, p_org_id, p_plan, p_interval, p_amount_paise, coalesce(p_period_start, current_date), p_note);

  perform public.dpdp__append_event(p_org_id, null, 'System', 'payment_confirmed',
    'Payment confirmed: Rs ' || to_char(p_amount_paise / 100.0, 'FM999999999.00') || ' (' || p_plan || ', ' || p_interval || 'ly)', p_interval);

  -- §8: this is the one moment an org leaves trial/awaiting_confirmation
  -- for good. self_declared_* is left as history (what they claimed),
  -- not cleared -- only state and last_confirmed_at change. An upsert, not
  -- a plain update: an org created before this migration, or via the
  -- older dpdp_create_client_org (CA-created client orgs never got a
  -- subscription row from anything), would otherwise silently no-op here
  -- and read back as 'trial' forever despite a real confirmed payment.
  insert into dpdp.subscription (org_id, trial_ends_at, state, "interval", last_confirmed_at)
  values (p_org_id, (clock_timestamp() at time zone 'UTC'), 'active', p_interval, (clock_timestamp() at time zone 'UTC'))
  on conflict (org_id) do update set state = 'active', "interval" = p_interval, last_confirmed_at = (clock_timestamp() at time zone 'UTC');

  -- The org's own referral attribution, if any (dpdp_create_my_org records
  -- at most one per org, at signup). A blocked event never earns anything.
  select re.* into v_event
  from dpdp.referral_event re
  where re.referred_org_id = p_org_id and re.outcome in ('signed_up', 'chose_band')
  order by re.at asc
  limit 1;

  if v_event.id is not null then
    if p_interval = 'year' then
      -- Every yearly renewal earns again, for as long as the client stays:
      -- matched purely by org_id, with no count/date limit.
      v_rate := 0.20;
      v_basis := 'yearly';
    elsif not exists (select 1 from dpdp.payment p2 where p2.org_id = p_org_id and p2.id <> v_payment_id) then
      -- Monthly plan, and this is the first payment ever confirmed for this
      -- org: the only month that earns anything.
      v_rate := 0.05;
      v_basis := 'first_month';
    end if;

    if v_rate is not null then
      v_commission_amount := round(p_amount_paise * v_rate)::integer;
      v_commission_id := replace(gen_random_uuid()::text, '-', '');
      insert into dpdp.referral_commission (id, referral_event_id, payment_id, referrer_identity_id, rate, amount_paise, basis)
      values (v_commission_id, v_event.id, v_payment_id, v_event.referral_id, v_rate, v_commission_amount, v_basis);

      update dpdp.referral_event set outcome = 'chose_band' where id = v_event.id and outcome = 'signed_up';

      select m.org_id into v_referrer_org_id
      from dpdp.membership m
      where m.identity_id = v_event.referral_id and m.level = 'owner' and m.state = 'active'
      order by m.created_at asc limit 1;
      if v_referrer_org_id is not null then
        perform public.dpdp__append_event(v_referrer_org_id, v_event.referral_id, 'System', 'referral_commission_earned',
          'Referral commission earned: Rs ' || to_char(v_commission_amount / 100.0, 'FM999999999.00') || ' (' || v_basis || ')', v_basis);
      end if;
    end if;
  end if;

  return jsonb_build_object('ok', true, 'paymentId', v_payment_id, 'commissionId', v_commission_id, 'commissionAmountPaise', v_commission_amount);
end
$$;

revoke all on function public.dpdp_record_confirmed_payment(text, text, text, integer, date, text) from public, anon, authenticated;
grant execute on function public.dpdp_record_confirmed_payment(text, text, text, integer, date, text) to service_role, app_runtime;

-- ---------------------------------------------------------------------
-- 5. What a referrer sees of their own programme: their code (if they have
--    one -- this does NOT create one; dpdp_my_referral_code still owns
--    that), and their own earnings. Any signed-in identity, matching
--    WO-016 §1's "every email" widening -- not gated to decision-makers,
--    since anyone (coordinator, GO, staff...) may hold a code and refer
--    someone even if they cannot see the org's private page.
-- ---------------------------------------------------------------------
create or replace function public.dpdp_my_referral_summary(p_org_id text default null)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_identity text;
  v_code text;
  v_total integer;
  v_pending integer;
  v_paid integer;
  v_referred_count integer;
begin
  -- p_org_id is accepted only for symmetry with every other dpdp_my_* RPC
  -- and is not otherwise used below, since a referral code and its
  -- earnings belong to the PERSON, not to one org. A caller who is signed
  -- in but has no dpdp.identity yet (never created/joined an org) simply
  -- gets all-zero, code:null back -- there is nothing to refuse.
  v_identity := public.dpdp__caller_identity_id();

  select r.code into v_code from dpdp.referral r where r.identity_id = v_identity;

  select coalesce(sum(c.amount_paise), 0)::integer,
         coalesce(sum(c.amount_paise) filter (where c.payout_status = 'pending'), 0)::integer,
         coalesce(sum(c.amount_paise) filter (where c.payout_status = 'paid'), 0)::integer
    into v_total, v_pending, v_paid
  from dpdp.referral_commission c
  where c.referrer_identity_id = v_identity;

  select count(distinct re.referred_org_id) into v_referred_count
  from dpdp.referral_event re
  where re.referral_id = v_identity and re.outcome <> 'blocked';

  return jsonb_build_object(
    'code', v_code,
    'referredCount', coalesce(v_referred_count, 0),
    'totalEarnedPaise', v_total,
    'pendingPaise', v_pending,
    'paidPaise', v_paid
  );
end
$$;

revoke all on function public.dpdp_my_referral_summary(text) from public, anon;
grant execute on function public.dpdp_my_referral_summary(text) to authenticated, app_runtime;

-- ---------------------------------------------------------------------
-- 6. The Owner's own payout worklist: every pending commission, oldest
--    first, with just enough to act on it manually (UPI/bank, outside this
--    system -- the Owner's own decision, this session: payout stays
--    manual). service_role only, same reason as dpdp_record_confirmed_payment.
-- ---------------------------------------------------------------------
create or replace function public.dpdp_admin_pending_payouts()
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'commissionId', c.id,
    'referrerIdentityId', c.referrer_identity_id,
    'referrerEmail', ie.email,
    'amountPaise', c.amount_paise,
    'rate', c.rate,
    'basis', c.basis,
    'createdAt', c.created_at
  ) order by c.created_at asc), '[]'::jsonb)
  from dpdp.referral_commission c
  left join dpdp.identity_email ie on ie.identity_id = c.referrer_identity_id and ie.is_primary
  where c.payout_status = 'pending'
$$;

revoke all on function public.dpdp_admin_pending_payouts() from public, anon, authenticated;
grant execute on function public.dpdp_admin_pending_payouts() to service_role, app_runtime;

-- Marks one commission paid once the Owner has actually sent the money
-- (UPI/bank, outside this system) -- idempotent, so re-running it after a
-- retry never double-counts.
create or replace function public.dpdp_mark_commission_paid(p_commission_id text, p_note text default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
begin
  update dpdp.referral_commission
  set payout_status = 'paid', paid_at = (clock_timestamp() at time zone 'UTC'), paid_note = p_note
  where id = p_commission_id and payout_status = 'pending';
  if not found then
    if exists (select 1 from dpdp.referral_commission where id = p_commission_id) then
      return jsonb_build_object('ok', true, 'alreadyPaid', true);
    end if;
    raise exception 'No such commission' using errcode = '22023';
  end if;
  return jsonb_build_object('ok', true, 'alreadyPaid', false);
end
$$;

revoke all on function public.dpdp_mark_commission_paid(text, text) from public, anon, authenticated;
grant execute on function public.dpdp_mark_commission_paid(text, text) to service_role, app_runtime;

-- ---------------------------------------------------------------------
-- 7. Billing status, for the panel on the owner's own page (lower-left,
--    per the Owner's own instruction, this session). Owner-only -- a
--    coordinator/staff/CA member sees the referral summary (§5) but not
--    the org's money; dpdp__caller_membership raises 42501 for a
--    non-member, and the explicit owner check below refuses everyone else
--    with the same plain-English style as the rest of this file.
-- ---------------------------------------------------------------------
create or replace function public.dpdp_my_billing(p_org_id text default null)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_m dpdp.membership;
  v_sub dpdp.subscription;
  v_org dpdp.organisation;
begin
  v_m := public.dpdp__caller_membership(p_org_id);
  if v_m.id is null then
    raise exception 'Not a member of this organisation' using errcode = '42501';
  end if;
  if v_m.level <> 'owner' then
    raise exception 'Only the owner can see billing' using errcode = '42501';
  end if;

  select * into v_sub from dpdp.subscription where org_id = v_m.org_id;
  select * into v_org from dpdp.organisation where id = v_m.org_id;

  return jsonb_build_object(
    'orgId', v_m.org_id,
    'product', v_org.product,
    'state', coalesce(v_sub.state, 'trial'),
    'trialEndsAt', v_sub.trial_ends_at,
    'interval', v_sub."interval",
    'selfDeclaredAt', v_sub.self_declared_at,
    'selfDeclaredInterval', v_sub.self_declared_interval,
    'selfDeclaredAmountPaise', v_sub.self_declared_amount_paise,
    'lastConfirmedAt', v_sub.last_confirmed_at
  );
end
$$;

revoke all on function public.dpdp_my_billing(text) from public, anon;
grant execute on function public.dpdp_my_billing(text) to authenticated, app_runtime;

-- "I've paid": a claim, not a fact -- moves the org to awaiting_confirmation
-- and appends one event; changes no access anywhere (Owner, this session:
-- "just an SLA label"). The Owner's own dpdp_record_confirmed_payment (§4)
-- is the only thing that ever moves an org to 'active'.
create or replace function public.dpdp_declare_payment(p_interval text, p_amount_paise integer, p_org_id text default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_m dpdp.membership;
begin
  v_m := public.dpdp__caller_membership(p_org_id);
  if v_m.id is null then
    raise exception 'Not a member of this organisation' using errcode = '42501';
  end if;
  if v_m.level <> 'owner' then
    raise exception 'Only the owner can declare a payment' using errcode = '42501';
  end if;
  if p_interval not in ('month', 'year') then
    raise exception 'interval must be ''month'' or ''year''' using errcode = '22023';
  end if;
  if p_amount_paise is null or p_amount_paise <= 0 then
    raise exception 'amount_paise must be a positive number' using errcode = '22023';
  end if;

  -- Same upsert reasoning as dpdp_record_confirmed_payment above: an org
  -- with no subscription row yet (pre-migration, or a CA-created client
  -- org) must not silently no-op the owner's own "I've paid" click.
  insert into dpdp.subscription (org_id, trial_ends_at, state, "interval", self_declared_at, self_declared_interval, self_declared_amount_paise)
  values (v_m.org_id, (clock_timestamp() at time zone 'UTC'), 'awaiting_confirmation', p_interval, (clock_timestamp() at time zone 'UTC'), p_interval, p_amount_paise)
  on conflict (org_id) do update set
    state = 'awaiting_confirmation', "interval" = p_interval,
    self_declared_at = (clock_timestamp() at time zone 'UTC'), self_declared_interval = p_interval, self_declared_amount_paise = p_amount_paise;

  perform public.dpdp__append_event(v_m.org_id, v_m.identity_id, 'Owner', 'payment_declared',
    'Owner said they paid Rs ' || to_char(p_amount_paise / 100.0, 'FM999999999.00') || ' (' || p_interval || 'ly) -- awaiting confirmation', p_interval);

  return jsonb_build_object('ok', true, 'state', 'awaiting_confirmation');
end
$$;

revoke all on function public.dpdp_declare_payment(text, integer, text) from public, anon;
grant execute on function public.dpdp_declare_payment(text, integer, text) to authenticated, app_runtime;
