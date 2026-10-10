-- WO-DPDP-014 "One brand line, everywhere a person looks" -- §3 the share
-- action and §7 the measures, on the WO-011 browser-RPC path (drizzle/
-- 0604's rules, restated so this file stands on its own):
--   * public schema only; dpdp.* stays unreachable from a browser.
--   * SECURITY DEFINER, search_path = '', caller resolved from the JWT via
--     public.dpdp__caller_identity_id() / public.dpdp__caller_membership()
--     -- never from an argument.
--   * Every write appends exactly one dpdp.event via
--     public.dpdp__append_event, in the same transaction.
--   * Refusals raise plain English with 42501.
--   * Additive only: three new functions, no table changes, nothing from
--     0415/0604-0610 re-issued. dpdp.referral / dpdp.referral_event are the
--     0415 tables; the referral RULES (one free month per referral; blocks
--     on shared advisor, self-referral, free tier; credit only on a paid
--     signup) already live in src/lib/services/dpdp-referral-service.ts and
--     the sign-up path, and are NOT re-implemented here -- this file only
--     hands a decision-maker their own code and counts what happens.
--
-- Who is a decision-maker (WO-014 §3's table): the org's owner/principal
-- (membership.level = 'owner'), or a CA partner / CA manager -- the same
-- "named on a live CAPARTNER/CAMGR-tagged job" rule dpdp_my_page (0604)
-- and dpdp_my_clients (0609) use, so the page's viewer.kind/caSub and this
-- gate can never disagree. Coordinator, Grievance Officer, staff, teacher,
-- vendor, parent: refused.

-- ---------------------------------------------------------------------
-- Internal helper -- not callable from the browser (revoked below).
-- ---------------------------------------------------------------------

-- The caller's share role in p_org_id (or their newest membership):
-- 'owner' | 'partner' | 'manager', or null when they are a member but not
-- a decision-maker. Raises 42501 when they are not a member at all.
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
  select case
    when bool_or(t.role_tag = 'CAPARTNER') then 'partner'
    when bool_or(t.role_tag = 'CAMGR') then 'manager'
  end into v_role
  from dpdp.obligation o join dpdp.obligation_template t on t.id = o.template_id
  where o.org_id = v_m.org_id and o.assigned_person_id = v_m.identity_id and o.state <> 'not_applicable';
  return v_role;
end
$$;

-- ---------------------------------------------------------------------
-- Browser-callable surface (authenticated role).
-- ---------------------------------------------------------------------

-- The caller's own referral code, for `?ref=<code>` on the public site.
-- getOrCreateMyReferral() as an RPC, faithfully: an identity that already
-- has a dpdp.referral row gets its code back (stable across calls and
-- orgs -- the code belongs to the PERSON, referral.identity_id is the
-- primary key); otherwise one consented row is made now, with an 8-char
-- code from the same unambiguous alphabet the TS uses (no 0/O/1/I, so it
-- can be read aloud), retried until unique. Decision-makers only.
create or replace function public.dpdp_my_referral_code(p_org_id text default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_role text;
  v_identity text;
  v_code text;
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_try int := 0;
  v_i int;
begin
  v_role := public.dpdp__share_role(p_org_id);
  if v_role is null then
    raise exception 'Only the owner, a CA partner or a CA manager can share a referral code' using errcode = '42501';
  end if;
  v_identity := public.dpdp__caller_identity_id();

  select r.code into v_code from dpdp.referral r where r.identity_id = v_identity;
  if v_code is not null then
    return jsonb_build_object('code', v_code, 'role', v_role);
  end if;

  loop
    v_try := v_try + 1;
    v_code := '';
    for v_i in 1..8 loop
      v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from dpdp.referral r where r.code = v_code);
    if v_try >= 10 then
      raise exception 'Could not generate a referral code, try again' using errcode = 'P0001';
    end if;
  end loop;

  insert into dpdp.referral (identity_id, code, consented_at, state)
  values (v_identity, v_code, (clock_timestamp() at time zone 'UTC'), 'active')
  on conflict (identity_id) do nothing;
  -- A concurrent first call may have won the insert: read back whichever code stuck.
  select r.code into v_code from dpdp.referral r where r.identity_id = v_identity;
  return jsonb_build_object('code', v_code, 'role', v_role);
end
$$;

-- WO-014 §7 "share presses per week, by role": one dpdp.event per press,
-- kind share_press, summary "<Role> pressed Share", detail = the role key
-- ('owner' | 'partner' | 'manager') and nothing else. The actor label is
-- the role word, NOT the person's email (every other event uses the
-- email; this one is a marketing measure and deliberately carries no
-- personal data -- the identity id column still links it for the audit
-- chain, as an opaque id). Decision-makers only, same gate as the code.
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
  v_label := case v_role when 'owner' then 'Owner' when 'partner' then 'CA partner' else 'CA manager' end;
  perform public.dpdp__append_event(v_m.org_id, v_m.identity_id, v_label, 'share_press', v_label || ' pressed Share', v_role);
  return jsonb_build_object('ok', true, 'role', v_role);
end
$$;

-- ---------------------------------------------------------------------
-- WO-014 §7 -- the measures. service_role only (plus app_runtime so the
-- repo's DB-gated test can call it), never a browser role: it reads across
-- every org. Aggregates only -- no id, no email, no org name.
-- ---------------------------------------------------------------------

-- One row per ISO week (IYYY-Wnn, the same key dpdp.monday_week_key uses)
-- for the last p_weeks weeks including this one, newest first:
--   sharePresses      { owner, partner, manager, total } from dpdp.event
--                     kind share_press (detail = role key)
--   referralSignups   dpdp.referral_event rows with outcome signed_up
--   paidReferrals     outcome chose_band (a paid band was chosen -- the
--                     only outcome that earns credit) -- credit_months is
--                     summed alongside as creditMonths
--   referralsBlocked  outcome blocked (shared advisor / self-referral)
--   reportsGenerated  0, always, today: no dpdp.event kind records a
--                     report being generated/printed/emailed yet (checked
--                     against every kind the TS services and 0604-0610
--                     write). The reportsNote column says so, so a reader
--                     of the row never mistakes 0 for "nobody did".
-- Visits to the public site carrying ?ref= are a Cloudflare Pages
-- analytics question, not a database one; they are not counted here.
create or replace function public.dpdp_brand_measures(p_weeks int default 12)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_weeks int := greatest(1, least(coalesce(p_weeks, 12), 104));
  v_from timestamp := date_trunc('week', (clock_timestamp() at time zone 'UTC')) - ((v_weeks - 1) || ' weeks')::interval;
  v_out jsonb;
begin
  with weeks as (
    select generate_series(v_from, date_trunc('week', (clock_timestamp() at time zone 'UTC')), '1 week'::interval) as week_start
  ),
  presses as (
    select date_trunc('week', e.occurred_at) as week_start,
           count(*) filter (where e.detail = 'owner')::int as owner,
           count(*) filter (where e.detail = 'partner')::int as partner,
           count(*) filter (where e.detail = 'manager')::int as manager,
           count(*)::int as total
    from dpdp.event e
    where e.kind = 'share_press' and e.occurred_at >= v_from
    group by 1
  ),
  referrals as (
    select date_trunc('week', r.at) as week_start,
           count(*) filter (where r.outcome = 'signed_up')::int as signups,
           count(*) filter (where r.outcome = 'chose_band')::int as paid,
           coalesce(sum(r.credit_months) filter (where r.outcome = 'chose_band'), 0)::int as credit_months,
           count(*) filter (where r.outcome = 'blocked')::int as blocked
    from dpdp.referral_event r
    where r.at >= v_from
    group by 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'week', to_char(w.week_start, 'IYYY-"W"IW'),
      'weekStart', to_char(w.week_start, 'YYYY-MM-DD'),
      'sharePresses', jsonb_build_object(
        'owner', coalesce(p.owner, 0), 'partner', coalesce(p.partner, 0), 'manager', coalesce(p.manager, 0), 'total', coalesce(p.total, 0)),
      'referralSignups', coalesce(r.signups, 0),
      'paidReferrals', coalesce(r.paid, 0),
      'creditMonths', coalesce(r.credit_months, 0),
      'referralsBlocked', coalesce(r.blocked, 0),
      'reportsGenerated', 0,
      'reportsNote', 'no event kind records a generated report yet (WO-014 §7); 0 means not measured, not none'
    ) order by w.week_start desc), '[]'::jsonb)
  into v_out
  from weeks w
  left join presses p on p.week_start = w.week_start
  left join referrals r on r.week_start = w.week_start;
  return v_out;
end
$$;

-- ---------------------------------------------------------------------
-- Grants: 0604/0609's policy for the two signed-in functions (authenticated
-- + app_runtime, the latter so the DB-gated test exercises the real path
-- with set_config('request.jwt.claims', ...) standing in for the JWT);
-- the helper is callable by nobody directly; the measures are service_role
-- (and app_runtime for the test) only.
-- ---------------------------------------------------------------------
revoke all on function public.dpdp__share_role(text) from public, anon, authenticated;

revoke all on function public.dpdp_my_referral_code(text) from public, anon;
revoke all on function public.dpdp_record_share_press(text) from public, anon;
grant execute on function public.dpdp_my_referral_code(text) to authenticated, app_runtime;
grant execute on function public.dpdp_record_share_press(text) to authenticated, app_runtime;

revoke all on function public.dpdp_brand_measures(int) from public, anon, authenticated;
grant execute on function public.dpdp_brand_measures(int) to service_role, app_runtime;
