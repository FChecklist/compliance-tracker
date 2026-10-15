-- PRE-APPROVED-LIVE-DDL: Owner (Rajat Agarwal) approved first-party visitor-journey tracking for veridian-aios.com in chat on 2026-10-06 ("ok do it")
-- NOT applied live by the session that wrote it -- the lead applies it after review (see the PR for the steps and the secret to set first: DPDP_VISIT_KEY).
--
-- DPDP VISITOR JOURNEY (first-party marketing + conversion tracking for the public site). Four small tables in the `dpdp` schema, written ONLY by the
-- dpdp-track Edge Function through the service-role RPCs below; read ONLY by the owner-only report in the same function (every read goes to dpdp.audit_access_log).
--
--   dpdp.visit_session  one row per browser tab-session: where the visitor came from (referrer host, UTM, search engine), landing page, device, language, country/city
--                       (Cloudflare headers), a SHORTENED ip (IPv4 last octet zeroed, IPv6 /48) and a KEYED HMAC hash of the full ip (secret DPDP_VISIT_KEY, computed in the
--                       Edge Function -- the raw ip is never stored), the exit page / section / time / scroll, and whether it is a bot (kept apart from human funnels).
--   dpdp.visit_event    what happened inside a session: page views, sections seen (+ dwell), calls to action, choices (a slug from a closed set, never typed text), exits.
--   dpdp.visit_link     visitor id -> identity id, written server-side when a signed-in person's browser reports its visitor id. No e-mail, no name is stored here.
--   dpdp.visit_agg      anonymised aggregate counts per day. Written by the retention job BEFORE it deletes raw rows; kept (it holds no identifier of any person).
--   dpdp.visit_rate     per-minute counters for the per-visitor / per-ip-hash / count-only rate limits; emptied daily.
--
-- GLOBAL PRIVACY CONTROL / DO NOT TRACK: the browser script then sends one count-only beacon (no visitor id, no session id); dpdp_visit_count_only() bumps a daily counter
-- in visit_agg and writes NO row about that visit, no ip, no hash.
--
-- FUNNEL (visit -> key page -> CTA -> sign-up -> organisation -> first-visit wizard -> paid) is computed at report time from these tables plus the product's own records:
-- visit_link (sign-up), dpdp.event 'organisation_created', dpdp.membership.first_visit_seen_at, dpdp.event 'payment_confirmed' (the product's existing payment-proof /
-- online-payment confirmation record). The unit is the visitor (visitor id, or the session for a visitor without one); the source is the FIRST session's source (first touch).
--
-- RETENTION: 365 days. dpdp_visit_retention() (pg_cron, daily 00:40 UTC, plain SQL, no HTTP) writes the anonymised aggregates for what is about to go, then deletes the raw rows.
--
-- Roll-back: drizzle/down/0733_dpdp_visitor_journey.down.sql.
-- Conventions as 0731: functions in `public`, SECURITY DEFINER, search_path = '', execute for service_role only.

-- ---------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------
create table if not exists dpdp.visit_session (
  id text primary key,
  visitor_id text,
  started_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  ip_short text,
  ip_hash text,
  source_kind text not null default 'direct',
  referrer_host text,
  search_engine text,
  utm_source text, utm_medium text, utm_campaign text, utm_term text, utm_content text,
  landing_path text,
  exit_path text, exit_section text, exit_ms integer, exit_scroll smallint,
  device text,
  language text,
  country text,
  city text,
  is_bot boolean not null default false,
  bot_name text,
  visit_no integer not null default 1,
  events_n integer not null default 0,
  constraint visit_session_source_ok check (source_kind in ('direct', 'search', 'social', 'referral', 'campaign', 'internal', 'email')),
  constraint visit_session_device_ok check (device is null or device in ('mobile', 'tablet', 'desktop'))
);
create index if not exists visit_session_visitor_idx on dpdp.visit_session (visitor_id) where visitor_id is not null;
create index if not exists visit_session_iphash_idx on dpdp.visit_session (ip_hash) where ip_hash is not null;
create index if not exists visit_session_started_idx on dpdp.visit_session (started_at);

create table if not exists dpdp.visit_event (
  id bigint generated always as identity primary key,
  session_id text not null references dpdp.visit_session (id) on delete cascade,
  at timestamptz not null default now(),
  kind text not null,
  path text,
  name text,
  value text,
  ms integer,
  scroll smallint,
  constraint visit_event_kind_ok check (kind in ('pv', 'sec', 'cta', 'choice', 'exit', 'step'))
);
create index if not exists visit_event_session_idx on dpdp.visit_event (session_id, id);

create table if not exists dpdp.visit_link (
  visitor_id text not null,
  auth_user_id text not null,
  identity_id text,
  linked_at timestamptz not null default now(),
  primary key (visitor_id, auth_user_id)
);
create index if not exists visit_link_identity_idx on dpdp.visit_link (identity_id) where identity_id is not null;

create table if not exists dpdp.visit_agg (
  day date not null,
  dimension text not null,
  key text not null,
  human boolean not null default true,
  n bigint not null default 0,
  ms_total bigint not null default 0,
  primary key (day, dimension, key, human)
);

create table if not exists dpdp.visit_rate (
  bucket text not null,
  window_start timestamptz not null,
  n integer not null default 0,
  primary key (bucket, window_start)
);

revoke all on table dpdp.visit_session, dpdp.visit_event, dpdp.visit_link, dpdp.visit_agg, dpdp.visit_rate from public, anon, authenticated;
revoke all on table dpdp.visit_session, dpdp.visit_event, dpdp.visit_link, dpdp.visit_agg, dpdp.visit_rate from app_runtime;
alter table dpdp.visit_session enable row level security;
alter table dpdp.visit_event enable row level security;
alter table dpdp.visit_link enable row level security;
alter table dpdp.visit_agg enable row level security;
alter table dpdp.visit_rate enable row level security;

-- ---------------------------------------------------------------------
-- 2. Rate limit: one counter per bucket per minute. Returns true while the bucket is within `p_limit`.
-- ---------------------------------------------------------------------
create or replace function dpdp.visit_rate_hit(p_bucket text, p_add integer, p_limit integer)
returns boolean
language plpgsql
set search_path = ''
as $$
declare v_n integer; v_w timestamptz := date_trunc('minute', clock_timestamp());
begin
  if p_bucket is null then return true; end if;
  insert into dpdp.visit_rate (bucket, window_start, n) values (left(p_bucket, 80), v_w, greatest(p_add, 1))
  on conflict (bucket, window_start) do update set n = dpdp.visit_rate.n + greatest(p_add, 1)
  returning n into v_n;
  return v_n <= p_limit;
end
$$;

-- ---------------------------------------------------------------------
-- 3. Ingest: one batch from one browser. Everything personal-looking was refused or cut by the Edge Function before this is called; this function also caps what a session may hold.
--    p = { sid, vid, ip_short, ip_hash, source_kind, referrer_host, search_engine, utm:{source,medium,campaign,term,content}, landing_path, device, language, country, city,
--          is_bot, bot_name, limit, events:[{k,p,n,v,ms,sc}] }
-- ---------------------------------------------------------------------
create or replace function public.dpdp_visit_ingest(p jsonb)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_sid text := nullif(p->>'sid', '');
  v_vid text := nullif(p->>'vid', '');
  v_hash text := nullif(p->>'ip_hash', '');
  v_bot boolean := coalesce((p->>'is_bot')::boolean, false);
  v_limit integer := coalesce(nullif(p->>'limit', '')::integer, 60);
  v_events jsonb := coalesce(p->'events', '[]'::jsonb);
  v_n integer := least(jsonb_array_length(v_events), 30);
  v_utm jsonb := coalesce(p->'utm', '{}'::jsonb);
  v_visit_no integer := 1;
  v_have integer;
  e jsonb;
  v_kind text;
  v_room integer;
  v_inserted integer := 0;
begin
  if v_sid is null then raise exception 'sid is required' using errcode = '22023'; end if;
  if not dpdp.visit_rate_hit(case when v_vid is not null then 'v:' || v_vid else null end, v_n + 1, v_limit)
     or not dpdp.visit_rate_hit(case when v_hash is not null then 'i:' || v_hash else null end, v_n + 1, v_limit * 3) then
    return jsonb_build_object('ok', false, 'reason', 'rate');
  end if;

  if not exists (select 1 from dpdp.visit_session where id = v_sid) then
    -- Returning visitor: the same visitor id, or (no visitor id) the same keyed ip hash, seen before.
    select count(distinct s.id) + 1 into v_visit_no from dpdp.visit_session s
    where not s.is_bot and ((v_vid is not null and s.visitor_id = v_vid) or (v_vid is null and v_hash is not null and s.ip_hash = v_hash));
  end if;

  insert into dpdp.visit_session (id, visitor_id, ip_short, ip_hash, source_kind, referrer_host, search_engine,
    utm_source, utm_medium, utm_campaign, utm_term, utm_content, landing_path, device, language, country, city, is_bot, bot_name, visit_no)
  values (v_sid, v_vid, left(p->>'ip_short', 45), v_hash, coalesce(nullif(p->>'source_kind', ''), 'direct'), left(p->>'referrer_host', 120), left(p->>'search_engine', 40),
    left(v_utm->>'source', 80), left(v_utm->>'medium', 80), left(v_utm->>'campaign', 80), left(v_utm->>'term', 80), left(v_utm->>'content', 80),
    left(p->>'landing_path', 120), nullif(p->>'device', ''), left(p->>'language', 12), left(p->>'country', 2), left(p->>'city', 80), v_bot, left(p->>'bot_name', 60), v_visit_no)
  on conflict (id) do update set last_seen_at = clock_timestamp()
    where dpdp.visit_session.visitor_id is not distinct from excluded.visitor_id;

  select events_n into v_have from dpdp.visit_session where id = v_sid and visitor_id is not distinct from v_vid;
  if not found then return jsonb_build_object('ok', false, 'reason', 'sid'); end if;
  v_room := greatest(0, 400 - coalesce(v_have, 0));

  for e in select value from jsonb_array_elements(v_events) limit 30 loop
    exit when v_inserted >= v_room;
    v_kind := e->>'k';
    if v_kind not in ('pv', 'sec', 'cta', 'choice', 'exit', 'step') then continue; end if;
    if v_bot and v_kind <> 'pv' then continue; end if;
    insert into dpdp.visit_event (session_id, kind, path, name, value, ms, scroll)
    values (v_sid, v_kind, left(e->>'p', 120), left(e->>'n', 60), left(e->>'v', 40), least(nullif(e->>'ms', '')::integer, 86400000), least(nullif(e->>'sc', '')::smallint, 100));
    v_inserted := v_inserted + 1;
    if v_kind = 'pv' then
      update dpdp.visit_session set exit_path = left(e->>'p', 120) where id = v_sid;
    elsif v_kind = 'exit' then
      update dpdp.visit_session set exit_path = left(e->>'p', 120), exit_section = left(e->>'n', 60), exit_ms = least(nullif(e->>'ms', '')::integer, 86400000), exit_scroll = least(nullif(e->>'sc', '')::smallint, 100) where id = v_sid;
    end if;
  end loop;
  update dpdp.visit_session set events_n = events_n + v_inserted, last_seen_at = clock_timestamp() where id = v_sid;
  return jsonb_build_object('ok', true, 'visit_no', (select visit_no from dpdp.visit_session where id = v_sid), 'events', v_inserted);
end
$$;

-- ---------------------------------------------------------------------
-- 4. Count-only (Global Privacy Control / Do Not Track): a daily counter, no row about the visit, no ip, no hash. One global bucket limits abuse.
-- ---------------------------------------------------------------------
create or replace function public.dpdp_visit_count_only(p jsonb)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_day date := (clock_timestamp() at time zone 'UTC')::date;
  v_human boolean := not coalesce((p->>'is_bot')::boolean, false);
begin
  if not dpdp.visit_rate_hit('off', 1, coalesce(nullif(p->>'limit', '')::integer, 300)) then return jsonb_build_object('ok', false, 'reason', 'rate'); end if;
  insert into dpdp.visit_agg (day, dimension, key, human, n) values (v_day, 'off_pv', coalesce(left(p->>'path', 120), '/'), v_human, 1)
  on conflict (day, dimension, key, human) do update set n = dpdp.visit_agg.n + 1;
  insert into dpdp.visit_agg (day, dimension, key, human, n) values (v_day, 'off_country', coalesce(nullif(left(p->>'country', 2), ''), '--'), v_human, 1)
  on conflict (day, dimension, key, human) do update set n = dpdp.visit_agg.n + 1;
  return jsonb_build_object('ok', true);
end
$$;

-- ---------------------------------------------------------------------
-- 5. Link a signed-in person to the visitor id their browser reported. The identity is resolved HERE from the verified e-mail (never stored); only a visitor that has
--    sessions on record can be linked; the link can be completed on a later call when the identity did not exist yet at the first sign-in.
-- ---------------------------------------------------------------------
create or replace function public.dpdp_visit_link(p_visitor_id text, p_auth_user_id text, p_email text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare v_identity text;
begin
  if coalesce(p_visitor_id, '') !~ '^[a-f0-9]{16,64}$' or coalesce(p_auth_user_id, '') = '' then return jsonb_build_object('linked', false); end if;
  if not exists (select 1 from dpdp.visit_session where visitor_id = p_visitor_id) then return jsonb_build_object('linked', false); end if;
  select ie.identity_id into v_identity from dpdp.identity_email ie where lower(ie.email) = lower(coalesce(p_email, '')) order by ie.is_primary desc limit 1;
  insert into dpdp.visit_link (visitor_id, auth_user_id, identity_id) values (p_visitor_id, left(p_auth_user_id, 80), v_identity)
  on conflict (visitor_id, auth_user_id) do update set identity_id = coalesce(excluded.identity_id, dpdp.visit_link.identity_id);
  return jsonb_build_object('linked', true, 'identity', v_identity is not null);
end
$$;

-- ---------------------------------------------------------------------
-- 6. Funnel. One row per (source kind, source detail) of the first session of each human visitor first seen in [p_from, p_to). Stages are "reached" counts: a later stage
--    implies the earlier ones (someone who paid certainly visited). p_last_before (retention) keeps only visitors whose LAST session is older than that instant.
-- ---------------------------------------------------------------------
create or replace function dpdp.visit_funnel(p_from timestamptz, p_to timestamptz, p_last_before timestamptz default null)
returns table (source_kind text, source_detail text, visits bigint, key_page bigint, cta bigint, signed_up bigint, org_created bigint, wizard_done bigint, paid bigint)
language sql stable
set search_path = ''
as $$
  with sf as (
    select s.*, coalesce(s.visitor_id, 'S' || s.id) as vk,
      exists (select 1 from dpdp.visit_event e where e.session_id = s.id and (e.kind in ('sec', 'choice') or (e.kind = 'pv' and e.path = any (array['/dpdp-firm/', '/dpdp-institution/', '/pricing/', '/partner/', '/about/', '/ai-assistant/'])))) as f_key,
      exists (select 1 from dpdp.visit_event e where e.session_id = s.id and e.kind = 'cta') as f_cta
    from dpdp.visit_session s where not s.is_bot
  ),
  v as (
    select vk, min(started_at) as first_at, max(started_at) as last_at,
      (array_agg(source_kind order by started_at))[1] as source_kind,
      (array_agg(coalesce(utm_source, search_engine, referrer_host, '') order by started_at))[1] as source_detail,
      bool_or(f_key) as f_key, bool_or(f_cta) as f_cta
    from sf group by vk
  ),
  f as (
    select v.*,
      exists (select 1 from dpdp.visit_link l where l.visitor_id = v.vk) as f_signed,
      exists (select 1 from dpdp.visit_link l join dpdp.event ev on ev.actor_identity_id = l.identity_id
              where l.visitor_id = v.vk and ev.kind = 'organisation_created' and ev.occurred_at >= (v.first_at at time zone 'UTC')) as f_org,
      exists (select 1 from dpdp.visit_link l join dpdp.membership m on m.identity_id = l.identity_id
              where l.visitor_id = v.vk and m.first_visit_seen_at is not null and m.said_not_me_at is null and m.first_visit_seen_at >= (v.first_at at time zone 'UTC')) as f_wiz,
      exists (select 1 from dpdp.visit_link l join dpdp.membership m on m.identity_id = l.identity_id and m.level::text = 'owner' and m.state::text = 'active'
              join dpdp.event ev on ev.org_id = m.org_id
              where l.visitor_id = v.vk and ev.kind = 'payment_confirmed' and ev.occurred_at >= (v.first_at at time zone 'UTC')) as f_paid
    from v
    where v.first_at >= p_from and v.first_at < p_to and (p_last_before is null or v.last_at < p_last_before)
  ),
  r as (
    select source_kind, source_detail,
      f_paid as r_paid,
      (f_wiz or f_paid) as r_wiz,
      (f_org or f_wiz or f_paid) as r_org,
      (f_signed or f_org or f_wiz or f_paid) as r_signed,
      (f_cta or f_signed or f_org or f_wiz or f_paid) as r_cta,
      (f_key or f_cta or f_signed or f_org or f_wiz or f_paid) as r_key
    from f
  )
  select r.source_kind, r.source_detail, count(*)::bigint,
    count(*) filter (where r_key)::bigint, count(*) filter (where r_cta)::bigint, count(*) filter (where r_signed)::bigint,
    count(*) filter (where r_org)::bigint, count(*) filter (where r_wiz)::bigint, count(*) filter (where r_paid)::bigint
  from r group by r.source_kind, r.source_detail
$$;

-- ---------------------------------------------------------------------
-- 7. Owner report: one JSON document. Humans and bots are counted apart; bots never enter the funnel or the section / choice tables.
-- ---------------------------------------------------------------------
create or replace function public.dpdp_visit_report(p_days integer default 30)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_days integer := greatest(1, least(coalesce(p_days, 30), 365));
  v_since timestamptz := clock_timestamp() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 365)));
  v_out jsonb;
begin
  select jsonb_build_object(
    'days', v_days,
    'since', v_since,
    'totals', (select jsonb_build_object(
        'human_sessions', count(*) filter (where not is_bot),
        'human_visitors', count(distinct coalesce(visitor_id, 'S' || id)) filter (where not is_bot),
        'returning_visitors', (select count(*) from (select coalesce(visitor_id, 'S' || id) vk from dpdp.visit_session where not is_bot and started_at >= v_since group by 1 having count(*) > 1) q),
        'returning_sessions', count(*) filter (where not is_bot and visit_no > 1),
        'bot_sessions', count(*) filter (where is_bot))
      from dpdp.visit_session where started_at >= v_since),
    'count_only_visits', coalesce((select sum(n) from dpdp.visit_agg where dimension = 'off_pv' and human and day >= v_since::date), 0),
    'bots', coalesce((select jsonb_agg(x) from (select jsonb_build_object('bot', coalesce(bot_name, 'unknown'), 'sessions', count(*)) x from dpdp.visit_session where is_bot and started_at >= v_since group by bot_name order by count(*) desc limit 15) q), '[]'),
    'sources', coalesce((select jsonb_agg(x) from (select jsonb_build_object('kind', source_kind, 'detail', coalesce(utm_source, search_engine, referrer_host, ''), 'sessions', count(*)) x from dpdp.visit_session where not is_bot and started_at >= v_since group by source_kind, coalesce(utm_source, search_engine, referrer_host, '') order by count(*) desc limit 25) q), '[]'),
    'campaigns', coalesce((select jsonb_agg(x) from (select jsonb_build_object('campaign', utm_campaign, 'medium', utm_medium, 'sessions', count(*)) x from dpdp.visit_session where not is_bot and utm_campaign is not null and started_at >= v_since group by utm_campaign, utm_medium order by count(*) desc limit 20) q), '[]'),
    'landing_pages', coalesce((select jsonb_agg(x) from (select jsonb_build_object('path', landing_path, 'sessions', count(*)) x from dpdp.visit_session where not is_bot and started_at >= v_since group by landing_path order by count(*) desc limit 20) q), '[]'),
    'devices', coalesce((select jsonb_agg(x) from (select jsonb_build_object('device', coalesce(device, '?'), 'sessions', count(*)) x from dpdp.visit_session where not is_bot and started_at >= v_since group by device order by count(*) desc) q), '[]'),
    'languages', coalesce((select jsonb_agg(x) from (select jsonb_build_object('language', coalesce(language, '?'), 'sessions', count(*)) x from dpdp.visit_session where not is_bot and started_at >= v_since group by language order by count(*) desc limit 10) q), '[]'),
    'places', coalesce((select jsonb_agg(x) from (select jsonb_build_object('country', coalesce(country, '?'), 'city', coalesce(city, ''), 'sessions', count(*)) x from dpdp.visit_session where not is_bot and started_at >= v_since group by country, city order by count(*) desc limit 25) q), '[]'),
    'sections', coalesce((select jsonb_agg(x) from (select jsonb_build_object('path', e.path, 'section', e.name, 'views', count(*), 'sessions', count(distinct e.session_id), 'avg_dwell_ms', round(avg(e.ms))::int) x
        from dpdp.visit_event e join dpdp.visit_session s on s.id = e.session_id where e.kind = 'sec' and not s.is_bot and s.started_at >= v_since group by e.path, e.name order by count(*) desc limit 40) q), '[]'),
    'exits', coalesce((select jsonb_agg(x) from (select jsonb_build_object('path', exit_path, 'section', exit_section, 'sessions', count(*), 'avg_ms', round(avg(exit_ms))::int, 'avg_scroll', round(avg(exit_scroll))::int) x
        from dpdp.visit_session where not is_bot and exit_path is not null and started_at >= v_since group by exit_path, exit_section order by count(*) desc limit 30) q), '[]'),
    'ctas', coalesce((select jsonb_agg(x) from (select jsonb_build_object('cta', e.name, 'clicks', count(*), 'sessions', count(distinct e.session_id)) x
        from dpdp.visit_event e join dpdp.visit_session s on s.id = e.session_id where e.kind = 'cta' and not s.is_bot and s.started_at >= v_since group by e.name order by count(*) desc limit 30) q), '[]'),
    'choices', coalesce((select jsonb_agg(x) from (select jsonb_build_object('choice', e.name, 'value', e.value, 'count', count(*)) x
        from dpdp.visit_event e join dpdp.visit_session s on s.id = e.session_id where e.kind in ('choice', 'step') and not s.is_bot and s.started_at >= v_since group by e.name, e.value order by count(*) desc limit 40) q), '[]'),
    'funnel_by_source', coalesce((select jsonb_agg(to_jsonb(f) order by f.visits desc) from dpdp.visit_funnel(v_since, clock_timestamp() + interval '1 day') f), '[]'),
    'returning_ip_hashes', coalesce((select jsonb_agg(x) from (select jsonb_build_object('ip_hash', left(ip_hash, 12), 'ip_short', max(ip_short), 'sessions', count(*), 'visitors', count(distinct coalesce(visitor_id, 'S' || id)), 'country', max(country)) x
        from dpdp.visit_session where not is_bot and ip_hash is not null and started_at >= v_since group by ip_hash having count(*) > 1 order by count(*) desc limit 25) q), '[]')
  ) into v_out;
  return v_out;
end
$$;

-- ---------------------------------------------------------------------
-- 8. One visitor's whole journey from the first visit, by visitor id or by identity id. No e-mail, no name: the identity id is the only link to a person.
-- ---------------------------------------------------------------------
create or replace function public.dpdp_visit_journey(p_visitor_id text default null, p_identity_id text default null)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare v_ids text[]; v_out jsonb;
begin
  select coalesce(array_agg(distinct x), '{}') into v_ids from (
    select nullif(p_visitor_id, '') as x
    union select l.visitor_id from dpdp.visit_link l where p_identity_id is not null and l.identity_id = p_identity_id
  ) q where x is not null;
  select jsonb_build_object(
    'visitor_ids', to_jsonb(v_ids),
    'linked_identities', coalesce((select jsonb_agg(distinct l.identity_id) from dpdp.visit_link l where l.visitor_id = any (v_ids) and l.identity_id is not null), '[]'),
    'sessions', coalesce((select jsonb_agg(sx order by (sx->>'started_at')) from (
      select jsonb_build_object('id', s.id, 'visitor_id', s.visitor_id, 'started_at', s.started_at, 'last_seen_at', s.last_seen_at, 'visit_no', s.visit_no,
          'source_kind', s.source_kind, 'referrer_host', s.referrer_host, 'search_engine', s.search_engine, 'utm_source', s.utm_source, 'utm_medium', s.utm_medium, 'utm_campaign', s.utm_campaign,
          'landing_path', s.landing_path, 'device', s.device, 'language', s.language, 'country', s.country, 'city', s.city, 'ip_short', s.ip_short, 'ip_hash', left(s.ip_hash, 12),
          'exit_path', s.exit_path, 'exit_section', s.exit_section, 'exit_ms', s.exit_ms, 'exit_scroll', s.exit_scroll,
          'events', coalesce((select jsonb_agg(jsonb_build_object('at', e.at, 'kind', e.kind, 'path', e.path, 'name', e.name, 'value', e.value, 'ms', e.ms) order by e.id) from dpdp.visit_event e where e.session_id = s.id), '[]')) as sx
      from dpdp.visit_session s where s.visitor_id = any (v_ids) and not s.is_bot limit 200) q2), '[]')
  ) into v_out;
  return v_out;
end
$$;

-- ---------------------------------------------------------------------
-- 9. Retention (365 days). Aggregates first, then deletion, in ONE transaction: every raw row is counted exactly once. Aggregates hold no identifier of any person.
-- ---------------------------------------------------------------------
create or replace function public.dpdp_visit_retention(p_days integer default 365)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_cut timestamptz := clock_timestamp() - make_interval(days => greatest(30, coalesce(p_days, 365)));
  v_sessions bigint; v_events bigint; v_links bigint; v_rate bigint;
begin
  -- raw sessions about to go
  insert into dpdp.visit_agg (day, dimension, key, human, n)
  select (s.started_at at time zone 'UTC')::date, d.dim, d.k, not s.is_bot, count(*)
  from dpdp.visit_session s
  cross join lateral (values ('sessions', s.source_kind), ('landing', coalesce(s.landing_path, '')), ('country', coalesce(s.country, '--')), ('device', coalesce(s.device, '?')),
                             ('exit', coalesce(s.exit_path, '')), ('returning', case when s.visit_no > 1 then 'yes' else 'no' end)) d(dim, k)
  where s.started_at < v_cut group by 1, 2, 3, 4
  on conflict (day, dimension, key, human) do update set n = dpdp.visit_agg.n + excluded.n;
  -- raw events about to go (sections with dwell, ctas, choices)
  insert into dpdp.visit_agg (day, dimension, key, human, n, ms_total)
  select (s.started_at at time zone 'UTC')::date, case e.kind when 'sec' then 'section' when 'cta' then 'cta' else 'choice' end,
         case e.kind when 'sec' then coalesce(e.path, '') || '#' || coalesce(e.name, '') when 'cta' then coalesce(e.name, '') else coalesce(e.name, '') || '=' || coalesce(e.value, '') end,
         not s.is_bot, count(*), coalesce(sum(e.ms), 0)
  from dpdp.visit_event e join dpdp.visit_session s on s.id = e.session_id
  where s.started_at < v_cut and e.kind in ('sec', 'cta', 'choice', 'step') group by 1, 2, 3, 4
  on conflict (day, dimension, key, human) do update set n = dpdp.visit_agg.n + excluded.n, ms_total = dpdp.visit_agg.ms_total + excluded.ms_total;
  -- funnel of visitors whose last session is among those going (first-touch cohort day, per source kind)
  insert into dpdp.visit_agg (day, dimension, key, human, n)
  select (v_cut at time zone 'UTC')::date, 'funnel_' || st.stage, f.source_kind, true, st.n
  from dpdp.visit_funnel('-infinity'::timestamptz, 'infinity'::timestamptz, v_cut) f
  cross join lateral (values ('visit', f.visits), ('key_page', f.key_page), ('cta', f.cta), ('signed_up', f.signed_up), ('org_created', f.org_created), ('wizard_done', f.wizard_done), ('paid', f.paid)) st(stage, n)
  where st.n > 0
  on conflict (day, dimension, key, human) do update set n = dpdp.visit_agg.n + excluded.n;

  delete from dpdp.visit_session where started_at < v_cut;
  get diagnostics v_sessions = row_count;
  delete from dpdp.visit_link l where not exists (select 1 from dpdp.visit_session s where s.visitor_id = l.visitor_id);
  get diagnostics v_links = row_count;
  delete from dpdp.visit_rate where window_start < clock_timestamp() - interval '1 day';
  get diagnostics v_rate = row_count;
  select count(*) into v_events from dpdp.visit_event e where not exists (select 1 from dpdp.visit_session s where s.id = e.session_id);
  return jsonb_build_object('cut', v_cut, 'sessions_deleted', v_sessions, 'links_deleted', v_links, 'rate_rows_deleted', v_rate, 'orphan_events', v_events);
end
$$;

-- ---------------------------------------------------------------------
-- 10. Execute rights: service_role only.
-- ---------------------------------------------------------------------
revoke all on function dpdp.visit_rate_hit(text, integer, integer) from public, anon, authenticated;
revoke all on function dpdp.visit_funnel(timestamptz, timestamptz, timestamptz) from public, anon, authenticated;
do $$
declare f text;
begin
  foreach f in array array[
    'dpdp_visit_ingest(jsonb)', 'dpdp_visit_count_only(jsonb)', 'dpdp_visit_link(text, text, text)', 'dpdp_visit_report(integer)',
    'dpdp_visit_journey(text, text)', 'dpdp_visit_retention(integer)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end
$$;

-- ---------------------------------------------------------------------
-- 11. Daily retention job, 00:40 UTC. Plain SQL: no HTTP, no Vault secret. cron.schedule upserts by name.
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('dpdp-visit-retention', '40 0 * * *', $cron$ select public.dpdp_visit_retention(365) $cron$);
  end if;
end
$$;
