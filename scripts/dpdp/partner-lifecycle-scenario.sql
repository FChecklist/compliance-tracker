-- The behaviour test for drizzle/0674_dpdp_sales_partner_lifecycle.sql, as ONE self-rolling-back script.
--
-- It is run in two places, unchanged:
--   * src/lib/services/dpdp-partner-lifecycle.pglite.test.ts -- on PGlite, against stand-ins for the
--     tables and functions this migration builds on (the real function bodies are copied out of
--     drizzle/0604, 0605, 0655 and 0658, not retyped);
--   * scripts/dpdp/partner-lifecycle-live-test.mjs -- on the live database through the Supabase
--     Management API, after the migration text, in the same request.
--
-- Everything it writes (identities, organisations, payments, commissions, payouts, notices) is made
-- inside this one transaction, and the last statement RAISES the results, so nothing is ever committed.
-- Result lines start with PASS, FAIL or SKIP. The script must be run as a superuser / service role.
create temp table _r (n serial, ok boolean, skipped boolean not null default false, label text, info text);
create function pg_temp.chk(p_label text, p_ok boolean, p_info text default null) returns void language sql as
$f$ insert into _r (ok, label, info) values (coalesce(p_ok, false), p_label, p_info) $f$;
create function pg_temp.skip(p_label text) returns void language sql as
$f$ insert into _r (ok, skipped, label) values (true, true, p_label) $f$;
create function pg_temp.as_user(p_email text) returns void language sql as
$f$ select set_config('request.jwt.claims', json_build_object('email', p_email)::text, true) $f$;
-- true when the statement text raises an error that contains p_needle
create function pg_temp.refuses(p_sql text, p_needle text) returns boolean language plpgsql as
$f$
begin
  execute p_sql;
  return false;
exception when others then
  return position(lower(p_needle) in lower(sqlerrm)) > 0;
end
$f$;

do $t$
declare
  v_sfx text := substr(md5(random()::text), 1, 8);
  e_admin text := 'owner-' || v_sfx || '@partner-test.invalid';
  e_a text := 'partner-a-' || v_sfx || '@partner-test.invalid';
  e_b text := 'client-b-' || v_sfx || '@partner-test.invalid';
  e_p2 text := 'partner-p2-' || v_sfx || '@partner-test.invalid';
  e_p3 text := 'partner-p3-' || v_sfx || '@partner-test.invalid';
  e_d text := 'plain-d-' || v_sfx || '@partner-test.invalid';
  e_x text := 'nobody-' || v_sfx || '@partner-test.invalid';
  v_ver text;
  v_a text; v_b text; v_p2 text; v_p3 text; v_d text;
  o_x text := 'ox' || v_sfx; o_y text := 'oy' || v_sfx; o_m text := 'om' || v_sfx; o_s text := 'os' || v_sfx;
  o_p2 text := 'op2' || v_sfx; o_p3 text := 'op3' || v_sfx; o_d text := 'od' || v_sfx; o_small text := 'osm' || v_sfx; o_small2 text := 'osn' || v_sfx;
  r jsonb; r2 jsonb;
  v_code text; v_code2 text;
  v_prev text := to_char(date_trunc('month', (clock_timestamp() at time zone 'UTC')) - interval '1 month', 'YYYY-MM');
  v_this text := to_char(date_trunc('month', (clock_timestamp() at time zone 'UTC')), 'YYYY-MM');
  v_future text := to_char(date_trunc('month', (clock_timestamp() at time zone 'UTC')) + interval '2 month', 'YYYY-MM');
  v_n int; v_gross int; v_tds int; v_net int; v_exp_tds int; v_exp_net int;
  v_cid text; v_txt text;
begin
  select terms_version into v_ver from dpdp.partner_setting where id = 1;
  perform pg_temp.chk('settings row exists with the documented defaults',
    (select payable_after_days = 30 and payout_day = 10 and min_payout_paise = 50000 and tds_percent_set = false from dpdp.partner_setting where id = 1));
  insert into dpdp.platform_admin (email, note) values (e_admin, 'partner lifecycle test') on conflict (email) do nothing;

  ------------------------------------------------------------------ 1. applying
  perform pg_temp.as_user(e_a);
  r := public.dpdp_partner_dashboard();
  perform pg_temp.chk('dashboard before applying: no status, terms needed', r->>'status' is null and (r->>'needsTerms')::boolean and r->>'currentTermsVersion' = v_ver);
  perform pg_temp.chk('payout details before accepting terms are refused',
    pg_temp.refuses($q$select public.dpdp_partner_save_payout_details('upi', 'ravi.k@okaxis')$q$, 'Accept the partner terms first'));
  perform pg_temp.chk('accepting a version that is not current is refused',
    pg_temp.refuses($q$select public.dpdp_partner_accept_terms('0.0')$q$, 'not the current partner terms'));
  r := public.dpdp_partner_accept_terms(v_ver, 'Ravi Kumar');
  perform pg_temp.chk('accepting the terms makes an applied partner (not active yet)', r->>'status' = 'applied' and not (r->>'activated')::boolean);
  v_a := public.dpdp__caller_identity_id();
  perform pg_temp.chk('the acceptance is recorded with version and email',
    exists (select 1 from dpdp.partner_terms_acceptance where identity_id = v_a and version = v_ver and accepted_by_email = e_a));
  perform pg_temp.chk('an applied partner has no link yet', pg_temp.refuses($q$select public.dpdp_partner_get_code()$q$, 'set-up is finished'));

  perform pg_temp.chk('a bad UPI id is refused', pg_temp.refuses($q$select public.dpdp_partner_save_payout_details('upi', 'notupi')$q$, 'UPI id does not look right'));
  perform pg_temp.chk('a short bank account number is refused', pg_temp.refuses($q$select public.dpdp_partner_save_payout_details('bank', null, 'Ravi Kumar', '1234', 'HDFC0001234')$q$, '9 to 18 digits'));
  perform pg_temp.chk('a bad IFSC is refused', pg_temp.refuses($q$select public.dpdp_partner_save_payout_details('bank', null, 'Ravi Kumar', '123456789012', 'HDFC123')$q$, 'IFSC'));
  perform pg_temp.chk('a bad PAN is refused', pg_temp.refuses($q$select public.dpdp_partner_save_payout_details('upi', 'ravi.k@okaxis', null, null, null, 'ABC')$q$, 'PAN'));
  perform pg_temp.chk('no method is refused', pg_temp.refuses($q$select public.dpdp_partner_save_payout_details('')$q$, 'UPI or bank'));
  r := public.dpdp_partner_save_payout_details('upi', ' Ravi.K@okaxis ', null, null, null, 'abcde1234f');
  perform pg_temp.chk('terms + payout details turn the partner active', r->>'status' = 'active' and (r->>'activated')::boolean);
  perform pg_temp.chk('the welcome email is queued once', (select count(*) from dpdp.partner_notice where identity_id = v_a and kind = 'welcome') = 1);

  r := public.dpdp_partner_dashboard();
  v_txt := r::text;
  perform pg_temp.chk('the dashboard shows the UPI id masked, never in full', position('ra****@okaxis' in v_txt) > 0 and position('ravi.k@okaxis' in lower(v_txt)) = 0);
  perform pg_temp.chk('the dashboard never shows the PAN in full', position('ABCDE1234F' in v_txt) = 0 and position('AB*******F' in v_txt) > 0);
  perform pg_temp.chk('the audit rows hold no payout detail',
    not exists (select 1 from dpdp.partner_event e where e.identity_id = v_a and (coalesce(e.summary, '') || coalesce(e.detail, '')) ~* '(ravi\.k|okaxis|abcde1234f)')
    and not exists (select 1 from dpdp.event e where e.actor_identity_id = v_a and (e.summary || coalesce(e.detail, '')) ~* '(ravi\.k|okaxis|abcde1234f)'));

  -- changing the details tells the partner by email (a stolen session cannot change them silently)
  r := public.dpdp_partner_save_payout_details('bank', null, 'Ravi Kumar', '1234 5678 9012', 'hdfc0001234');
  perform pg_temp.chk('changing the details queues a "details changed" email', (select count(*) from dpdp.partner_notice where identity_id = v_a and kind = 'details_changed') = 1);
  r := public.dpdp_partner_dashboard();
  perform pg_temp.chk('bank details are masked too',
    r #>> '{payoutDetails,accountMasked}' = 'XXXXXXXX9012' and r #>> '{payoutDetails,ifscMasked}' = 'HDFC*******' and r #>> '{payoutDetails,nameMasked}' = 'R*** K***'
    and position('123456789012' in r::text) = 0);

  r := public.dpdp_partner_get_code();
  v_code := r->>'code';
  perform pg_temp.chk('an active partner gets an 8-character code', v_code ~ '^[A-HJ-NP-Z2-9]{8}$');
  perform pg_temp.chk('the code is stable', public.dpdp_partner_get_code()->>'code' = v_code);

  ------------------------------------------------------------------ 2. other partners and referral guards
  perform pg_temp.as_user(e_p2);
  perform public.dpdp_partner_accept_terms(v_ver, 'Pause Me');
  perform public.dpdp_partner_save_payout_details('upi', 'pause.me@oksbi');
  v_p2 := public.dpdp__caller_identity_id();
  v_code2 := public.dpdp_partner_get_code()->>'code';
  perform pg_temp.as_user(e_p3);
  perform public.dpdp_partner_accept_terms(v_ver, 'Half Done');
  v_p3 := public.dpdp__caller_identity_id();
  insert into dpdp.referral (identity_id, code, consented_at, state) values (v_p3, 'P3' || upper(substr(v_sfx, 1, 6)), now(), 'active');
  perform pg_temp.as_user(e_d);
  v_d := public.dpdp__find_or_create_identity(e_d);
  insert into dpdp.referral (identity_id, code, consented_at, state) values (v_d, 'D' || upper(substr(v_sfx, 1, 7)), now(), 'active');
  v_b := public.dpdp__find_or_create_identity(e_b);

  -- organisations: x (a real client of A), y (A belongs to it), m (monthly), s (A joins after sign-up), p2, p3, d, small
  insert into dpdp.organisation (id, name, slug, product) values
    (o_x, 'Client X ' || v_sfx, 'client-x-' || v_sfx, 'firm'), (o_y, 'Own Y ' || v_sfx, 'own-y-' || v_sfx, 'firm'),
    (o_m, 'Monthly M ' || v_sfx, 'monthly-m-' || v_sfx, 'firm'), (o_s, 'Late S ' || v_sfx, 'late-s-' || v_sfx, 'firm'),
    (o_p2, 'Paused P2 ' || v_sfx, 'paused-p2-' || v_sfx, 'firm'), (o_p3, 'Applied P3 ' || v_sfx, 'applied-p3-' || v_sfx, 'firm'),
    (o_d, 'Plain D ' || v_sfx, 'plain-d-' || v_sfx, 'institution'), (o_small, 'Small ' || v_sfx, 'small-' || v_sfx, 'firm');
  insert into dpdp.membership (id, identity_id, org_id, level, joined_via)
  select replace(gen_random_uuid()::text, '-', ''), v_b, o, 'owner', 'created' from unnest(array[o_x, o_m, o_s, o_p2, o_p3, o_d, o_small]) o;
  insert into dpdp.membership (id, identity_id, org_id, level, joined_via) values (replace(gen_random_uuid()::text, '-', ''), v_a, o_y, 'owner', 'created');
  insert into dpdp.subscription (org_id, trial_ends_at, state)
  select o, (clock_timestamp() at time zone 'UTC') + interval '30 days', 'trial' from unnest(array[o_x, o_y, o_m, o_s, o_p2, o_p3, o_d, o_small]) o;

  insert into dpdp.referral_event (id, referral_id, referred_org_id, outcome) values ('ex' || v_sfx, v_a, o_x, 'signed_up');
  perform pg_temp.chk('a sign-up through an active partner counts', (select outcome::text from dpdp.referral_event where id = 'ex' || v_sfx) = 'signed_up');
  perform pg_temp.chk('"a client you referred signed up" is queued, with no client name',
    (select count(*) from dpdp.partner_notice where identity_id = v_a and kind = 'referred_signup') = 1
    and not exists (select 1 from dpdp.partner_notice where identity_id = v_a and payload::text ilike '%Client X%'));

  insert into dpdp.referral_event (id, referral_id, referred_org_id, outcome) values ('ey' || v_sfx, v_a, o_y, 'signed_up');
  perform pg_temp.chk('a partner cannot earn on an organisation they belong to (sign-up)',
    (select outcome::text || '/' || block_reason from dpdp.referral_event where id = 'ey' || v_sfx) = 'blocked/self_referral');

  insert into dpdp.referral_event (id, referral_id, referred_org_id, outcome) values ('ep3' || v_sfx, v_p3, o_p3, 'signed_up');
  perform pg_temp.chk('a sign-up through a partner who is only "applied" is blocked',
    (select outcome::text || '/' || block_reason from dpdp.referral_event where id = 'ep3' || v_sfx) = 'blocked/partner_not_active');

  insert into dpdp.referral_event (id, referral_id, referred_org_id, outcome) values ('ed' || v_sfx, v_d, o_d, 'signed_up');
  perform pg_temp.chk('a person with no partner profile keeps working as before (sign-up counts)', (select outcome::text from dpdp.referral_event where id = 'ed' || v_sfx) = 'signed_up');
  perform pg_temp.chk('...and gets no partner email', not exists (select 1 from dpdp.partner_notice where identity_id = v_d));

  -- the partner's own funnel
  perform pg_temp.as_user(e_a);
  r := public.dpdp_partner_dashboard();
  perform pg_temp.chk('funnel counts: 1 signed up, 1 in trial, 0 paying, 1 not counted',
    (r #>> '{funnel,signedUp}')::int = 1 and (r #>> '{funnel,inTrial}')::int = 1 and (r #>> '{funnel,paying}')::int = 0 and (r #>> '{funnel,notCounted}')::int = 1);

  ------------------------------------------------------------------ 3. confirmed payments and commissions
  insert into dpdp.referral_event (id, referral_id, referred_org_id, outcome) values ('em' || v_sfx, v_a, o_m, 'signed_up');
  insert into dpdp.referral_event (id, referral_id, referred_org_id, outcome) values ('es' || v_sfx, v_a, o_s, 'signed_up');
  insert into dpdp.membership (id, identity_id, org_id, level, joined_via) values (replace(gen_random_uuid()::text, '-', ''), v_a, o_s, 'staff', 'named_in_role');
  insert into dpdp.referral_event (id, referral_id, referred_org_id, outcome) values ('esm' || v_sfx, v_a, o_small, 'signed_up');
  insert into dpdp.referral_event (id, referral_id, referred_org_id, outcome) values ('ep2' || v_sfx, v_p2, o_p2, 'signed_up');

  r := public.dpdp_record_confirmed_payment(o_x, 'firm', 'year', 999900);
  perform pg_temp.chk('yearly payment: commission is 20%', (r->>'commissionAmountPaise')::int = 199980 and r->>'commissionSkipped' is null, r::text);
  v_cid := r->>'commissionId';
  perform pg_temp.chk('the commission becomes payable 30 days after the payment',
    (select payable_at between (clock_timestamp() at time zone 'UTC') + interval '29 days 23 hours' and (clock_timestamp() at time zone 'UTC') + interval '30 days 1 hour'
       from dpdp.referral_commission where id = v_cid));
  perform pg_temp.chk('"commission earned" is queued for the active partner', (select count(*) from dpdp.partner_notice where identity_id = v_a and kind = 'commission_earned') = 1);
  r := public.dpdp_record_confirmed_payment(o_x, 'firm', 'year', 999900);
  perform pg_temp.chk('every yearly renewal earns again (20%)', (r->>'commissionAmountPaise')::int = 199980);
  -- keep one yearly commission for the payout tests
  delete from dpdp.partner_notice where kind = 'commission_earned' and identity_id = v_a;
  delete from dpdp.referral_commission where id = r->>'commissionId';

  r := public.dpdp_record_confirmed_payment(o_m, 'firm', 'month', 199900);
  perform pg_temp.chk('first monthly payment: commission is 5%', (r->>'commissionAmountPaise')::int = 9995);
  r := public.dpdp_record_confirmed_payment(o_m, 'firm', 'month', 199900);
  perform pg_temp.chk('second monthly payment: no commission', r->>'commissionId' is null and r->>'commissionSkipped' is null);

  r := public.dpdp_record_confirmed_payment(o_s, 'firm', 'year', 999900);
  perform pg_temp.chk('a partner who joined the paying organisation after sign-up earns nothing on its payment',
    r->>'commissionId' is null and r->>'commissionSkipped' = 'self_referral', r::text);
  perform pg_temp.chk('...and the skip is on the partner audit trail', exists (select 1 from dpdp.partner_event where identity_id = v_a and kind = 'commission_skipped'));

  perform pg_temp.as_user(e_a);
  perform pg_temp.chk('a partner cannot pause another partner', pg_temp.refuses(format($q$select public.dpdp_admin_partner_set_status(%L, 'paused')$q$, v_p2), 'Owner only'));
  perform pg_temp.chk('a partner cannot mark a payout paid', pg_temp.refuses(format($q$select public.dpdp_admin_partner_mark_paid(%L, %L, 'UTR0000001')$q$, v_prev, v_a), 'Owner only'));
  perform pg_temp.as_user(e_admin);
  perform public.dpdp_admin_partner_set_status(v_p2, 'paused', 'test');
  r := public.dpdp_record_confirmed_payment(o_p2, 'firm', 'year', 999900);
  perform pg_temp.chk('a payment for a paused partner earns nothing', r->>'commissionId' is null and r->>'commissionSkipped' = 'partner_not_active', r::text);

  r := public.dpdp_record_confirmed_payment(o_d, 'institution', 'year', 999900);
  perform pg_temp.chk('a person with no partner profile still gets the commission in the ledger', (r->>'commissionAmountPaise')::int = 199980);

  r := public.dpdp_record_confirmed_payment(o_small, 'firm', 'month', 1000);
  perform pg_temp.chk('a very small monthly payment makes a 50 paise commission', (r->>'commissionAmountPaise')::int = 50);

  perform pg_temp.as_user(e_a);
  r := public.dpdp_partner_dashboard();
  perform pg_temp.chk('dashboard: everything is still waiting (not payable for 30 days)',
    (r #>> '{money,waitingPaise}')::int = 199980 + 9995 + 50 and (r #>> '{money,payablePaise}')::int = 0 and (r #>> '{money,paidNetPaise}')::int = 0);
  perform pg_temp.chk('dashboard funnel after payments: 4 signed up, 4 paying, 0 in trial, 1 not counted',
    (r #>> '{funnel,signedUp}')::int = 4 and (r #>> '{funnel,paying}')::int = 4 and (r #>> '{funnel,inTrial}')::int = 0 and (r #>> '{funnel,notCounted}')::int = 1, (r -> 'funnel')::text);
  perform pg_temp.chk('dashboard shows the payout terms', (r->>'payableAfterDays')::int = 30 and (r->>'payoutDay')::int = 10 and (r->>'minPayoutPaise')::int = 50000);
  perform pg_temp.chk('dashboard lines carry no client name or id',
    position('Client X' in (r->'lines')::text) = 0 and position(o_x in (r->'lines')::text) = 0);

  ------------------------------------------------------------------ 4. the Owner's payout run
  perform pg_temp.chk('a partner cannot open the payout run', pg_temp.refuses($q$select public.dpdp_admin_partner_payout_run()$q$, 'Owner only'));
  perform pg_temp.chk('a partner cannot see the partner list', pg_temp.refuses($q$select public.dpdp_admin_partner_list()$q$, 'Owner only'));
  perform pg_temp.chk('a partner cannot change the settings', pg_temp.refuses($q$select public.dpdp_admin_partner_set_settings(null, null, null, 0)$q$, 'Owner only'));
  perform pg_temp.as_user(e_admin);
  r := public.dpdp_admin_partner_payout_run();
  perform pg_temp.chk('payout run: nothing is payable yet, TDS rate not set',
    r->>'period' = v_prev and not (r->>'tdsPercentSet')::boolean and jsonb_array_length(r->'partners') = 0, r::text);
  perform pg_temp.chk('payout run: a month that has not finished is refused', pg_temp.refuses(format($q$select public.dpdp_admin_partner_payout_run(%L)$q$, v_this), 'not finished'));

  update dpdp.referral_commission set payable_at = date_trunc('month', (clock_timestamp() at time zone 'UTC')) - interval '5 days'
   where referrer_identity_id in (v_a, v_d);
  r := public.dpdp_admin_partner_payout_run();
  perform pg_temp.chk('payout run lists the active partner with 3 payable commissions and the unmasked details for the Owner',
    jsonb_array_length(r->'partners') = 1 and (r #>> '{partners,0,commissions}')::int = 3 and r #>> '{partners,0,accountNumber}' = '123456789012'
    and r #>> '{partners,0,ifsc}' = 'HDFC0001234' and (r #>> '{partners,0,detailsChangedRecently}')::boolean, r::text);
  perform pg_temp.chk('payout run: the person with no partner profile is held, with a reason',
    jsonb_array_length(r->'held') = 1 and r #>> '{held,0,reason}' like 'not a partner yet%', (r->'held')::text);
  perform pg_temp.chk('mark paid is refused until the TDS percentage has been set',
    pg_temp.refuses(format($q$select public.dpdp_admin_partner_mark_paid(%L, %L, 'UTR1234567')$q$, v_prev, v_a), 'Set the TDS percentage first'));

  r2 := public.dpdp_admin_partner_set_settings(null, null, null, 10);
  perform pg_temp.chk('the TDS percentage is set by the Owner (10 is a test value only)', (r2->>'tdsPercentSet')::boolean and (r2->>'tdsPercent')::numeric = 10);
  v_exp_tds := round(199980 * 0.1)::int + round(9995 * 0.1)::int + round(50 * 0.1)::int;
  r := public.dpdp_admin_partner_payout_run();
  perform pg_temp.chk('payout run: gross, TDS and net add up',
    (r #>> '{partners,0,grossPaise}')::int = 199980 + 9995 + 50 and (r #>> '{partners,0,tdsPaise}')::int = v_exp_tds
    and (r #>> '{partners,0,netPaise}')::int = 199980 + 9995 + 50 - v_exp_tds and (r #>> '{partners,0,meetsMinimum}')::boolean, r::text);

  perform pg_temp.chk('a short reference is refused', pg_temp.refuses(format($q$select public.dpdp_admin_partner_mark_paid(%L, %L, 'x')$q$, v_prev, v_a), 'UTR'));
  perform pg_temp.chk('a month that has not finished cannot be paid', pg_temp.refuses(format($q$select public.dpdp_admin_partner_mark_paid(%L, %L, 'UTR1234567')$q$, v_this, v_a), 'not finished'));
  perform pg_temp.chk('an unknown partner cannot be paid', pg_temp.refuses(format($q$select public.dpdp_admin_partner_mark_paid(%L, 'nobody', 'UTR1234567')$q$, v_prev), 'cannot be paid'));
  perform pg_temp.chk('a person with no partner profile cannot be paid', pg_temp.refuses(format($q$select public.dpdp_admin_partner_mark_paid(%L, %L, 'UTR1234567')$q$, v_prev, v_d), 'cannot be paid'));

  r := public.dpdp_admin_partner_mark_paid(v_prev, v_a, 'UTR1234567', 'test payout');
  perform pg_temp.chk('mark paid: 3 commissions, TDS and net as in the run',
    not (r->>'alreadyPaid')::boolean and (r->>'commissions')::int = 3 and (r->>'tdsPaise')::int = v_exp_tds and (r->>'netPaise')::int = 199980 + 9995 + 50 - v_exp_tds, r::text);
  perform pg_temp.chk('the ledger keeps gross, TDS and net on every paid commission',
    (select count(*) = 3 and bool_and(payout_status = 'paid' and tds_paise is not null and net_paise = amount_paise - tds_paise and payout_id is not null and paid_note like '%UTR1234567%')
       from dpdp.referral_commission where referrer_identity_id = v_a));
  perform pg_temp.chk('the payout row exists once', (select count(*) from dpdp.partner_payout where referrer_identity_id = v_a and period = v_prev and reference = 'UTR1234567') = 1);
  perform pg_temp.chk('"payout sent" is queued for the partner', (select count(*) from dpdp.partner_notice where identity_id = v_a and kind = 'payout_sent') = 1);
  r2 := public.dpdp_admin_partner_mark_paid(v_prev, v_a, 'UTR1234567');
  perform pg_temp.chk('the same reference again pays nothing twice', (r2->>'alreadyPaid')::boolean and (select count(*) from dpdp.partner_payout where referrer_identity_id = v_a) = 1);
  perform pg_temp.chk('a second reference has nothing left to pay', pg_temp.refuses(format($q$select public.dpdp_admin_partner_mark_paid(%L, %L, 'UTR7654321')$q$, v_prev, v_a), 'Nothing is payable'));
  r := public.dpdp_admin_partner_payout_run();
  perform pg_temp.chk('payout run after paying: the partner is gone from the list', jsonb_array_length(r->'partners') = 0);

  perform pg_temp.as_user(e_a);
  r := public.dpdp_partner_dashboard();
  perform pg_temp.chk('dashboard after paying: paid gross, TDS and net',
    (r #>> '{money,paidGrossPaise}')::int = 199980 + 9995 + 50 and (r #>> '{money,paidTdsPaise}')::int = v_exp_tds
    and (r #>> '{money,paidNetPaise}')::int = 199980 + 9995 + 50 - v_exp_tds and (r #>> '{money,payablePaise}')::int = 0);
  r := public.dpdp_partner_statement(v_this);
  perform pg_temp.chk('statement for this month: the payout and the paid lines',
    jsonb_array_length(r->'payouts') = 1 and r #>> '{payouts,0,reference}' = 'UTR1234567' and jsonb_array_length(r->'lines') >= 3
    and (r #>> '{totals,paidNetPaise}')::int = 199980 + 9995 + 50 - v_exp_tds, r::text);
  perform pg_temp.chk('statement: a bad month is refused', pg_temp.refuses($q$select public.dpdp_partner_statement('2026-13')$q$, 'Choose a month'));
  perform pg_temp.as_user(e_x);
  perform pg_temp.chk('statement: someone who is not a partner is refused', pg_temp.refuses($q$select public.dpdp_partner_statement('2026-09')$q$, 'not a Sales Partner'));

  -- below the minimum carries forward
  perform pg_temp.as_user(e_admin);
  insert into dpdp.organisation (id, name, slug, product) values (o_small2, 'Small Two ' || v_sfx, 'small-two-' || v_sfx, 'firm');
  insert into dpdp.membership (id, identity_id, org_id, level, joined_via) values (replace(gen_random_uuid()::text, '-', ''), v_b, o_small2, 'owner', 'created');
  insert into dpdp.subscription (org_id, trial_ends_at, state) values (o_small2, (clock_timestamp() at time zone 'UTC') + interval '30 days', 'trial');
  insert into dpdp.referral_event (id, referral_id, referred_org_id, outcome) values ('esm2' || v_sfx, v_a, o_small2, 'signed_up');
  perform public.dpdp_record_confirmed_payment(o_small2, 'firm', 'month', 1000);
  update dpdp.referral_commission set payable_at = date_trunc('month', (clock_timestamp() at time zone 'UTC')) - interval '3 days'
   where referrer_identity_id = v_a and payout_status = 'pending';
  r := public.dpdp_admin_partner_payout_run();
  perform pg_temp.chk('a balance under Rs 500 is listed but does not meet the minimum',
    jsonb_array_length(r->'partners') = 1 and not (r #>> '{partners,0,meetsMinimum}')::boolean and (r #>> '{partners,0,netPaise}')::int = 45, r::text);
  perform pg_temp.chk('...and cannot be marked paid (it carries forward)',
    pg_temp.refuses(format($q$select public.dpdp_admin_partner_mark_paid(%L, %L, 'UTR9990001')$q$, v_prev, v_a), 'below the minimum'));
  perform pg_temp.chk('...and stays pending afterwards', (select count(*) from dpdp.referral_commission where referrer_identity_id = v_a and payout_status = 'pending') = 1);
  r2 := public.dpdp_admin_partner_set_settings(null, null, 0, null);
  perform pg_temp.chk('with the minimum lowered by the Owner it can be paid',
    (public.dpdp_admin_partner_mark_paid(v_prev, v_a, 'UTR9990002')->>'netPaise')::int = 45);
  perform public.dpdp_admin_partner_set_settings(null, null, 50000, null);

  ------------------------------------------------------------------ 5. status changes
  r := public.dpdp_admin_partner_list();
  perform pg_temp.chk('the Owner sees every partner with email, status and balances',
    jsonb_array_length(r) >= 3 and exists (select 1 from jsonb_array_elements(r) x where x->>'email' = e_a and x->>'status' = 'active')
    and exists (select 1 from jsonb_array_elements(r) x where x->>'email' = e_p2 and x->>'status' = 'paused')
    and exists (select 1 from jsonb_array_elements(r) x where x->>'email' = e_p3 and x->>'status' = 'applied' and not (x->>'hasPayoutDetails')::boolean));
  perform pg_temp.chk('an unfinished partner cannot be made active', pg_temp.refuses(format($q$select public.dpdp_admin_partner_set_status(%L, 'active')$q$, v_p3), 'not finished set-up'));
  perform pg_temp.chk('"applied" cannot be set by hand', pg_temp.refuses(format($q$select public.dpdp_admin_partner_set_status(%L, 'applied')$q$, v_p3), 'active, paused or ended'));
  perform public.dpdp_admin_partner_set_status(v_p2, 'active');
  perform public.dpdp_admin_partner_set_status(v_p2, 'ended', 'test end');
  perform pg_temp.as_user(e_p2);
  perform pg_temp.chk('an ended partner cannot re-apply or change details',
    pg_temp.refuses($q$select public.dpdp_partner_accept_terms('$q$ || v_ver || $q$')$q$, 'has ended') and pg_temp.refuses($q$select public.dpdp_partner_save_payout_details('upi','a.b@oksbi')$q$, 'has ended'));
  perform pg_temp.as_user(e_a);
  perform pg_temp.chk('a partner cannot see the partner list', pg_temp.refuses($q$select public.dpdp_admin_partner_list()$q$, 'Owner only'));
  perform pg_temp.as_user(e_admin);

  ------------------------------------------------------------------ 6. emails: statements and the outbox
  r := public.dpdp_partner_enqueue_statements(v_this);
  perform pg_temp.chk('monthly statements are queued for partners with activity', (r->>'queued')::int >= 1 and exists (select 1 from dpdp.partner_notice where identity_id = v_a and kind = 'statement' and dedupe_key = v_this), r::text);
  perform pg_temp.chk('...once per partner per month', (public.dpdp_partner_enqueue_statements(v_this)->>'queued')::int = 0);
  r := public.dpdp_partner_notices_pending(100);
  perform pg_temp.chk('the outbox lists notices with the partner email, name and a payload',
    exists (select 1 from jsonb_array_elements(r) x where x->>'kind' = 'welcome' and x->>'to' = e_a and x->>'name' = 'Ravi Kumar')
    and exists (select 1 from jsonb_array_elements(r) x where x->>'kind' = 'payout_sent' and (x #>> '{payload,netPaise}')::int > 0));
  perform pg_temp.chk('no notice payload carries payout details or a client name',
    not exists (select 1 from dpdp.partner_notice where payload::text ~* '(123456789012|HDFC0001234|ravi\.k|okaxis|Client X|Late S|Monthly M)'));
  v_cid := (select x->>'id' from jsonb_array_elements(r) x where x->>'kind' = 'welcome' and x->>'to' = e_a limit 1);
  perform public.dpdp_partner_notice_mark(v_cid, 'sent');
  perform pg_temp.chk('a sent notice leaves the outbox', not exists (select 1 from jsonb_array_elements(public.dpdp_partner_notices_pending(100)) x where x->>'id' = v_cid));
  v_cid := (select x->>'id' from jsonb_array_elements(public.dpdp_partner_notices_pending(100)) x limit 1);
  for v_n in 1..5 loop perform public.dpdp_partner_notice_mark(v_cid, 'failed', 'boom'); end loop;
  perform pg_temp.chk('a notice that fails 5 times stops being retried', not exists (select 1 from jsonb_array_elements(public.dpdp_partner_notices_pending(100)) x where x->>'id' = v_cid));

  ------------------------------------------------------------------ 7. the old one-off path still works and fills the ledger
  insert into dpdp.payment (id, org_id, plan, "interval", amount_paise) values ('pay-legacy-' || v_sfx, o_d, 'institution', 'year', 100000);
  insert into dpdp.referral_commission (id, referral_event_id, payment_id, referrer_identity_id, rate, amount_paise, basis)
  values ('c-legacy-' || v_sfx, 'ed' || v_sfx, 'pay-legacy-' || v_sfx, v_d, 0.20, 20000, 'yearly');
  r := public.dpdp_mark_commission_paid('c-legacy-' || v_sfx, 'by hand');
  perform pg_temp.chk('dpdp_mark_commission_paid keeps its answer and now fills gross/TDS/net',
    r->>'alreadyPaid' = 'false' and (select tds_paise = 2000 and net_paise = 18000 from dpdp.referral_commission where id = 'c-legacy-' || v_sfx));
  perform pg_temp.chk('dpdp_admin_pending_payouts still answers', jsonb_typeof(public.dpdp_admin_pending_payouts()) = 'array');

  ------------------------------------------------------------------ 8. records cannot be rewritten; privileges
  perform pg_temp.chk('the partner audit trail is append-only', pg_temp.refuses($q$update dpdp.partner_event set summary = 'x'$q$, 'append-only'));
  perform pg_temp.chk('payouts are append-only', pg_temp.refuses($q$delete from dpdp.partner_payout$q$, 'append-only'));
  perform pg_temp.chk('terms acceptances are append-only', pg_temp.refuses($q$update dpdp.partner_terms_acceptance set version = 'x'$q$, 'append-only'));
  perform pg_temp.chk('no browser role can read or write the payout detail table',
    not has_table_privilege('anon', 'dpdp.partner_payout_detail', 'select') and not has_table_privilege('authenticated', 'dpdp.partner_payout_detail', 'select')
    and not has_table_privilege('authenticated', 'dpdp.partner_payout_detail', 'insert') and not has_table_privilege('authenticated', 'dpdp.sales_partner', 'select')
    and not has_table_privilege('authenticated', 'dpdp.partner_payout', 'select') and not has_table_privilege('authenticated', 'dpdp.partner_notice', 'select'));
  perform pg_temp.chk('the new tables have row level security on',
    (select count(*) = 7 and bool_and(relrowsecurity) from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'dpdp' and c.relname in ('partner_setting', 'sales_partner', 'partner_terms_acceptance', 'partner_payout_detail', 'partner_payout', 'partner_notice', 'partner_event')));
  perform pg_temp.chk('anon cannot call any partner function',
    not has_function_privilege('anon', 'public.dpdp_partner_dashboard()', 'execute') and not has_function_privilege('anon', 'public.dpdp_admin_partner_payout_run(text)', 'execute')
    and not has_function_privilege('anon', 'public.dpdp_partner_accept_terms(text, text)', 'execute'));
  perform pg_temp.chk('a signed-in user can call the partner screens',
    has_function_privilege('authenticated', 'public.dpdp_partner_dashboard()', 'execute') and has_function_privilege('authenticated', 'public.dpdp_partner_statement(text)', 'execute'));
  perform pg_temp.chk('the mail and cron helpers are service_role only',
    not has_function_privilege('authenticated', 'public.dpdp_partner_notices_pending(integer)', 'execute') and not has_function_privilege('authenticated', 'public.dpdp_partner_enqueue_statements(text)', 'execute')
    and not has_function_privilege('authenticated', 'public.dpdp_partner_notice_mark(text, text, text)', 'execute')
    and has_function_privilege('service_role', 'public.dpdp_partner_notices_pending(integer)', 'execute'));
  perform pg_temp.chk('the internal helpers are not callable by a browser role',
    not has_function_privilege('authenticated', 'public.dpdp__partner_event(text, text, text, text)', 'execute') and not has_function_privilege('authenticated', 'public.dpdp__partner_notify(text, text, text, jsonb, boolean)', 'execute')
    and not has_function_privilege('authenticated', 'public.dpdp__partner_try_activate(text)', 'execute'));
  perform pg_temp.chk('the money functions stay service_role only',
    not has_function_privilege('authenticated', 'public.dpdp_record_confirmed_payment(text, text, text, integer, date, text)', 'execute')
    and not has_function_privilege('authenticated', 'public.dpdp_mark_commission_paid(text, text)', 'execute'));

  ------------------------------------------------------------------ 9. live only: the real sign-up RPC (needs the obligation library)
  if to_regprocedure('public.dpdp_create_my_org(text, text, text)') is not null and to_regclass('dpdp.obligation_template') is not null then
    perform pg_temp.as_user(e_x);
    r := public.dpdp_create_my_org('Carry Test ' || v_sfx, 'firm', v_code);
    perform pg_temp.chk('real sign-up with a partner code attributes the new organisation to the partner',
      exists (select 1 from dpdp.referral_event re where re.referral_id = v_a and re.referred_org_id = r->>'orgId' and re.outcome::text = 'signed_up'), r::text);
    perform pg_temp.chk('...and the new organisation starts a 30-day trial', (select state from dpdp.subscription where org_id = r->>'orgId') = 'trial');
    perform pg_temp.as_user(e_admin);
    r2 := public.dpdp_record_confirmed_payment(r->>'orgId', 'firm', 'year', 999900);
    perform pg_temp.chk('...and its confirmed yearly payment makes a 20% commission for the partner', (r2->>'commissionAmountPaise')::int = 199980 and (select referrer_identity_id from dpdp.referral_commission where id = r2->>'commissionId') = v_a, r2::text);
    perform pg_temp.as_user(e_a);
    r := public.dpdp_create_my_org('Own Org ' || v_sfx, 'firm', v_code);
    perform pg_temp.chk('real sign-up through your own code is blocked as a self-referral',
      (select outcome::text || '/' || block_reason from dpdp.referral_event where referred_org_id = r->>'orgId') = 'blocked/self_referral');
    perform pg_temp.as_user(e_p3);
    r := public.dpdp_create_my_org('Via Applied ' || v_sfx, 'firm', (select code from dpdp.referral where identity_id = v_p3));
    perform pg_temp.chk('real sign-up through a not-yet-active partner code is blocked',
      (select outcome::text || '/' || block_reason from dpdp.referral_event where referred_org_id = r->>'orgId') = 'blocked/partner_not_active');
    perform pg_temp.as_user(e_x);
    r := public.dpdp_create_my_org('Typo Code ' || v_sfx, 'firm', 'ZZZZZZZZ');
    perform pg_temp.chk('real sign-up with an unknown code still creates the organisation and records no referral',
      (r->>'ok')::boolean and not exists (select 1 from dpdp.referral_event re where re.referred_org_id = r->>'orgId'));
  else
    perform pg_temp.skip('real dpdp_create_my_org attribution (needs the live obligation library; run by scripts/dpdp/partner-lifecycle-live-test.mjs)');
  end if;

  raise exception E'RESULT\n%', (select string_agg(case when skipped then 'SKIP ' when ok then 'PASS ' else 'FAIL ' end || label || coalesce(' -- ' || info, ''), E'\n' order by n) from _r);
end
$t$;
