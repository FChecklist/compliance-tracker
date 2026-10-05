-- PRE-APPROVED-LIVE-DDL: Owner decision in chat, 2026-10-05 (via the coordinator) -- "the e-mail's own plain-text paste box uses a SEPARATE short-lived link (48 h for the weekly Monday e-mail, 24 h for one-off mails), expired = same as unknown token ... unfamiliar-use alert (once per 24 h per link, no link in it, first use no alert)".
--
-- 1. dpdp_timer_mint_email_ai_link accepts 2 days (48 hours) as well as 1, 7 and 30. Everything else in it is the 0664 definition, unchanged:
--    a link made for an e-mail is its own row (label 'Monday email'), independent of the person's persistent link made on the AI Link page;
--    dpdp_timer_finish_email_ai_link only ever touches 'Monday email' rows. An expired link answers exactly as an unknown token
--    (dpdp__ai_link_for_token raises one sentence for both: "This link has expired or was revoked").
-- 2. Unfamiliar-use alert: dpdp.ai_link_seen remembers which network prefix (IPv4 /24, IPv6 /48) and which tool family each link has been used from.
--    dpdp_ai_link_note_use(token, ip_prefix, ua_family) is called by the dpdp-ai-link function on every call. It says "alert" only when
--    (a) the link has been used before (the first ever use never alerts), (b) this call's prefix or tool family is new for the link, and
--    (c) no alert has gone for this link in the last 24 hours (ai_link.unfamiliar_alert_at). The function that sends the e-mail puts no link in it.
--    Nothing here returns a token or a personal detail beyond the address the alert goes to (the link owner's own sign-in address).

create or replace function public.dpdp_timer_mint_email_ai_link(
  p_membership_id text,
  p_level integer default 1,
  p_days integer default 2
)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_m dpdp.membership;
  v_token text;
  v_hash text;
  v_now timestamp := (clock_timestamp() at time zone 'UTC');
  v_expires timestamp;
  v_id text;
  v_level integer := coalesce(p_level, 1);
  v_days integer := coalesce(p_days, 2);
  v_warning jsonb;
begin
  select m.* into v_m from dpdp.membership m where m.id = p_membership_id and m.state = 'active';
  if v_m.id is null then
    raise exception 'No active membership %', p_membership_id using errcode = 'P0002';
  end if;
  if v_level not in (0, 1) then
    raise exception 'level must be 0 (read, analyse, report) or 1 (small edits, directly). Anything with legal weight is always a draft.' using errcode = '22023';
  end if;
  if v_days not in (1, 2, 7, 30) then
    raise exception 'An e-mailed link can last 1 day (a one-off mail), 2 days (the weekly mail), 7 or 30' using errcode = '22023';
  end if;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  v_hash := encode(sha256(convert_to(v_token, 'UTF8')), 'hex');
  v_expires := v_now + make_interval(days => v_days);
  v_id := replace(gen_random_uuid()::text, '-', '');

  insert into dpdp.ai_link (
    id, org_id, identity_id, membership_id, token, token_hash, created_at, expires_at, read_count,
    authority_level, hide_emails, created_by_membership_id, label, call_count
  ) values (
    v_id, v_m.org_id, v_m.identity_id, v_m.id, null, v_hash, v_now, v_expires, 0,
    v_level, false, v_m.id, 'Monday email', 0
  );

  v_warning := public.dpdp__ai_link_warning_for(v_m.id);
  return jsonb_build_object(
    'linkId', v_id,
    'token', v_token,
    'level', v_level,
    'expiresAt', to_char(v_expires, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'jobs', v_warning -> 'jobs',
    'people', v_warning -> 'people'
  );
end
$$;

alter table dpdp.ai_link add column if not exists unfamiliar_alert_at timestamp;

create table if not exists dpdp.ai_link_seen (
  link_id text not null,
  kind text not null check (kind in ('ip', 'ua')),
  value text not null,
  first_seen_at timestamp not null default (clock_timestamp() at time zone 'UTC'),
  primary key (link_id, kind, value)
);
revoke all on table dpdp.ai_link_seen from public, anon, authenticated;
grant select, insert on table dpdp.ai_link_seen to service_role, app_runtime;
grant update on table dpdp.ai_link to service_role;

create or replace function public.dpdp_ai_link_note_use(p_token text, p_ip_prefix text, p_ua_family text)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_l dpdp.ai_link;
  v_ip text := left(trim(coalesce(p_ip_prefix, '')), 64);
  v_ua text := left(trim(coalesce(p_ua_family, '')), 64);
  v_first boolean;
  v_new_ip boolean := false;
  v_new_ua boolean := false;
  v_now timestamp := (clock_timestamp() at time zone 'UTC');
  v_claimed text;
  v_email text;
  v_org text;
  v_kind text;
begin
  v_l := public.dpdp__ai_link_for_token(p_token);
  if v_ip = '' and v_ua = '' then
    return jsonb_build_object('alert', false);
  end if;
  v_first := not exists (select 1 from dpdp.ai_link_seen s where s.link_id = v_l.id);
  if v_ip <> '' then
    v_new_ip := not exists (select 1 from dpdp.ai_link_seen s where s.link_id = v_l.id and s.kind = 'ip' and s.value = v_ip);
    insert into dpdp.ai_link_seen (link_id, kind, value) values (v_l.id, 'ip', v_ip) on conflict do nothing;
  end if;
  if v_ua <> '' then
    v_new_ua := not exists (select 1 from dpdp.ai_link_seen s where s.link_id = v_l.id and s.kind = 'ua' and s.value = v_ua);
    insert into dpdp.ai_link_seen (link_id, kind, value) values (v_l.id, 'ua', v_ua) on conflict do nothing;
  end if;
  if v_first or not (v_new_ip or v_new_ua) then
    return jsonb_build_object('alert', false);
  end if;

  -- At most one alert per link per 24 hours, decided atomically.
  update dpdp.ai_link set unfamiliar_alert_at = v_now
  where id = v_l.id and (unfamiliar_alert_at is null or unfamiliar_alert_at < v_now - interval '24 hours')
  returning id into v_claimed;
  if v_claimed is null then
    return jsonb_build_object('alert', false);
  end if;

  select i.primary_email into v_email from dpdp.membership m join dpdp.identity i on i.id = m.identity_id where m.id = v_l.membership_id;
  select o.name into v_org from dpdp.organisation o where o.id = v_l.org_id;
  v_kind := public.dpdp__viewer_kind(v_l.membership_id);
  return jsonb_build_object(
    'alert', true,
    'to', v_email,
    'org', v_org,
    'role', v_kind,
    'label', v_l.label,
    'linkId', v_l.id,
    'newNetwork', v_new_ip,
    'newTool', v_new_ua,
    'at', to_char(v_now, 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  );
end
$$;

revoke all on function public.dpdp_ai_link_note_use(text, text, text) from public, anon, authenticated;
grant execute on function public.dpdp_ai_link_note_use(text, text, text) to service_role, app_runtime;
