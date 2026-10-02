-- PRE-APPROVED-LIVE-DDL: Owner instruction in chat, 2026-10-02 -- "complete the remaining features and make sure all work is published and dont stop till everything is completed except for payment gateway integration"
--
-- NOT applied live by the session that wrote it -- the PM applies it after review (dpdp-app/OPERATIONS.md).
-- Authorizes the SECURITY DEFINER functions and GRANT/REVOKE statements below.
--
-- Three small fixes found by the 2026-10-02 use-case test pass (dpdp-app/TEST-REPORT.md, O-4, O-5) and the
-- AI-link simulation (dpdp-app/AI-LINK-SIMULATION-REPORT.md). Nothing here changes a table; three functions only.
--
--  1. public.dpdp_owner_reject_payment (0658): rejecting a payment claim sent EVERY organisation back to 'trial',
--     including one that was already 'active' and had only claimed a renewal. That org then showed "Payment
--     pending" with an old trial date and lost its renewal reminders. Now it goes back to what it was: 'active'
--     if a payment was ever confirmed for it (dpdp.subscription.last_confirmed_at, or a dpdp.payment row),
--     else 'trial'. The claim is cleared and the event is written as before.
--  2. public.dpdp_owner_approve_payment (0658): an organisation with no edition (product is null) made the booking
--     fail on a NOT NULL column with a raw database message ("null value in column plan ..."). The check
--     "p_plan not in ('firm','institution')" never fires for NULL. Now a plain-English refusal is raised BEFORE
--     anything is written; nothing is booked either way (that was already true).
--  3. public.dpdp_ai_link_billing_notice (new, service_role / app_runtime only): for the AI work link -- is this
--     link's organisation past the end of its free trial with nothing paid? The Edge function dpdp-ai-link turns
--     'trialEnded' into a notice on the manual ("Payment pending -- the owner needs to choose a plan; access
--     stays open"). It is ONLY a notice: the function reads the state and changes nothing, and nothing in it can
--     lock a link (owner rule: access never locks). The link is resolved the same way every other dpdp_ai_link_*
--     call resolves it (dpdp__ai_link_for_token), so a bad / expired / revoked token is refused identically.

-- ---------------------------------------------------------------------
-- 1. Reject: back to what the organisation was.
-- ---------------------------------------------------------------------
create or replace function public.dpdp_owner_reject_payment(p_org_id text, p_note text default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_sub dpdp.subscription;
  v_back text;
begin
  if not public.dpdp__is_platform_admin() then
    raise exception 'Owner only' using errcode = '42501';
  end if;
  select * into v_sub from dpdp.subscription where org_id = p_org_id;
  if v_sub.org_id is null or v_sub.state <> 'awaiting_confirmation' then
    raise exception 'This organisation has no payment awaiting confirmation' using errcode = '22023';
  end if;

  -- A payment was confirmed for this organisation before: it was an active customer claiming a renewal.
  v_back := case
    when v_sub.last_confirmed_at is not null or exists (select 1 from dpdp.payment p where p.org_id = p_org_id) then 'active'
    else 'trial'
  end;

  update dpdp.subscription
  set state = v_back,
      self_declared_at = null, self_declared_interval = null, self_declared_amount_paise = null,
      self_declared_reference = null, self_declared_proof_path = null, self_declared_note = null
  where org_id = p_org_id;

  perform public.dpdp__append_event(p_org_id, null, 'Owner', 'payment_rejected',
    'Payment claim could not be confirmed' || case when trim(coalesce(p_note, '')) <> '' then ': ' || p_note else '' end,
    null);

  return jsonb_build_object('ok', true, 'state', v_back);
end
$$;

-- ---------------------------------------------------------------------
-- 2. Approve: a clear message for an organisation with no edition.
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
  if v_org.product is null or v_org.product not in ('firm', 'institution') then
    raise exception 'This organisation has not chosen an edition (Firm or Institution) yet, so the payment cannot be booked. Ask them to choose one, or reject the claim.' using errcode = '22023';
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

-- ---------------------------------------------------------------------
-- 3. AI work link: has this organisation's free trial ended with nothing paid?
-- ---------------------------------------------------------------------
create or replace function public.dpdp_ai_link_billing_notice(p_token text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_l dpdp.ai_link;
  v_m dpdp.membership;
  v_sub dpdp.subscription;
  v_state text;
begin
  v_l := public.dpdp__ai_link_for_token(p_token);
  select m.* into v_m from dpdp.membership m where m.id = v_l.membership_id;
  select s.* into v_sub from dpdp.subscription s where s.org_id = v_m.org_id;
  v_state := coalesce(v_sub.state, 'trial');
  return jsonb_build_object(
    'state', v_state,
    -- Only a plain trial counts. A claim already made ('awaiting_confirmation') or a paid plan ('active') is not "payment pending".
    'trialEnded', v_state = 'trial' and v_sub.trial_ends_at is not null and v_sub.trial_ends_at <= (clock_timestamp() at time zone 'UTC'),
    'trialEndsOn', case when v_sub.trial_ends_at is null then null else to_char(v_sub.trial_ends_at, 'YYYY-MM-DD') end
  );
end
$$;

revoke all on function public.dpdp_owner_reject_payment(text, text) from public, anon;
revoke all on function public.dpdp_owner_approve_payment(text, text) from public, anon;
revoke all on function public.dpdp_ai_link_billing_notice(text) from public, anon, authenticated;
grant execute on function public.dpdp_owner_reject_payment(text, text) to authenticated, app_runtime;
grant execute on function public.dpdp_owner_approve_payment(text, text) to authenticated, app_runtime;
grant execute on function public.dpdp_ai_link_billing_notice(text) to service_role, app_runtime;
