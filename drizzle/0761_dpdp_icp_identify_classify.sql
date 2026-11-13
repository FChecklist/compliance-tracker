-- PRE-APPROVED-LIVE-DDL: Owner requirement relayed by the boss session on 2026-11-14 ("fix the DPDP product on lines of Identify, Classify, Prove (ICP) ... complete lifecycle ... every week"). FILE ONLY: this migration is NOT applied to any database; applying it to the live project needs the owner's separate go and a recorded rollback id (drizzle/down/0761_dpdp_icp_identify_classify.down.sql).
--
-- DPDP ICP weekly lifecycle, slice 1 of 3: IDENTIFY and CLASSIFY, the weekly record, and one fix to the History chain.
--
--   IDENTIFY   dpdp.icp_item        the organisation's live register of what it holds: data sets, systems, outside helpers (vendors) and groups of people.
--                                   The register holds NAMES OF THINGS, never a person's data (a guard refuses a name that looks like an e-mail address or a phone number).
--                                   A data set is mirrored into the existing dpdp.data_category / dpdp.data_location so the AI work link's data-map read and the CA client list
--                                   ("where it is") see the register too, instead of a second, disconnected list.
--   CLASSIFY   columns on the same row: whose data (principal type), children yes/no, purpose, lawful basis, a plain internal tier (NOT a legal category), how long it is
--              kept, who receives it. dpdp.icp_item_flags() derives the risk flags from those facts; public.dpdp_icp_apply_rules() switches the children's-data jobs back ON
--              (never off) when the register lists children's data and those jobs were marked "does not apply".
--   WEEKLY     dpdp.icp_run (append-only): one row per stage per week; public.dpdp_icp_status() is the single "this week" checklist for Identify, Classify and Prove, with a
--              routine score that is a count of this week's routine steps done, NOT a legal rating. The PROVE section is a replaceable function (dpdp.icp_prove): this file
--              ships the version that reads what exists today; drizzle/0762 replaces it with the evidence, breach, rights, vendor and erasure steps.
--   CHAIN FIX  public.dpdp__append_event() now takes a per-organisation advisory lock before it reads the previous hash, so two writers at the same moment can no longer
--              both chain onto the same previous event and fork the History chain. Same signature, same hash formula as 0605; only the lock line is new.
--
-- Supersedes the proposal dpdp-app/docs/proposed-migrations/0760_dpdp_weekly_run.sql (Discover/Act/Confirm): same idea, now under the owner's own words Identify/Classify/Prove.
-- Every new table has row level security ON and no grant to anon / authenticated; only the SECURITY DEFINER functions below touch them. ADDITIVE and re-runnable.
-- Wording rule: nothing here says "compliant", "certified" or "guaranteed". A flag is a prompt to look, not a finding of breach.

begin;
set local lock_timeout = '5s';

-- ---------------------------------------------------------------------
-- 1. The History chain: one writer at a time per organisation.
-- ---------------------------------------------------------------------
create or replace function public.dpdp__append_event(
  p_org_id text, p_actor_identity_id text, p_actor_label text, p_kind text, p_summary text, p_detail text default null
)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_prev text;
  v_prev_ts timestamp;
  v_ts timestamp;
  v_canonical text;
  v_hash text;
begin
  -- Held until the end of the calling transaction: the next writer for this organisation waits here, then reads the head this one wrote.
  perform pg_advisory_xact_lock(hashtextextended('dpdp.event:' || coalesce(p_org_id, ''), 0));

  select e.hash, e.occurred_at into v_prev, v_prev_ts
  from dpdp.event e
  where e.org_id = p_org_id
  order by e.occurred_at desc
  limit 1;

  v_ts := date_trunc('milliseconds', (clock_timestamp() at time zone 'UTC'));
  if v_prev_ts is not null and v_ts <= v_prev_ts then
    v_ts := v_prev_ts + interval '1 millisecond';
  end if;

  v_canonical := '{"actorLabel":' || to_json(p_actor_label)::text
    || ',"detail":'     || coalesce(to_json(p_detail)::text, 'null')
    || ',"kind":'       || to_json(p_kind)::text
    || ',"occurredAt":' || to_json(to_char(v_ts, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))::text
    || ',"orgId":'      || to_json(p_org_id)::text
    || ',"prevHash":'   || coalesce(to_json(v_prev)::text, 'null')
    || ',"summary":'    || to_json(p_summary)::text
    || '}';
  v_hash := encode(sha256(convert_to(coalesce(v_prev, '') || v_canonical, 'UTF8')), 'hex');

  insert into dpdp.event (id, org_id, actor_identity_id, actor_label, kind, summary, detail, occurred_at, prev_hash, hash)
  values (replace(gen_random_uuid()::text, '-', ''), p_org_id, p_actor_identity_id, p_actor_label, p_kind, p_summary, p_detail, v_ts, v_prev, v_hash);
end
$$;
revoke all on function public.dpdp__append_event(text, text, text, text, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. The register (IDENTIFY + CLASSIFY on one row).
-- ---------------------------------------------------------------------
create table if not exists dpdp.icp_item (
  id text primary key default replace(gen_random_uuid()::text, '-', ''),
  org_id text not null references dpdp.organisation (id),
  kind text not null check (kind in ('data_set', 'system', 'vendor', 'person_group')),
  name text not null check (char_length(btrim(name)) between 2 and 120),
  where_held text check (where_held is null or char_length(where_held) <= 160),
  holder_label text check (holder_label is null or char_length(holder_label) <= 120),   -- a role or team ("Admissions office"), not a person's name
  status text not null default 'active' check (status in ('active', 'retired')),
  retired_reason text check (retired_reason is null or char_length(retired_reason) <= 200),
  source text not null default 'manual' check (source in ('manual', 'starter')),
  first_seen_week date not null,
  last_confirmed_week date,
  -- CLASSIFY
  principal_type text check (principal_type is null or principal_type in ('student', 'parent_guardian', 'staff', 'applicant', 'alumni', 'client_staff', 'customer', 'visitor', 'other')),
  children boolean,                                  -- null = not classified yet
  purpose text check (purpose is null or char_length(purpose) <= 200),
  lawful_basis text check (lawful_basis is null or lawful_basis in ('consent', 'legitimate_use', 'legal_obligation', 'state_function', 'employment', 'child_exemption', 'not_sure')),
  sensitivity text check (sensitivity is null or sensitivity in ('ordinary', 'elevated', 'high')),   -- our own plain tier for ordering work, not a legal category
  retention_days integer check (retention_days is null or retention_days between 1 and 36500),
  retention_note text check (retention_note is null or char_length(retention_note) <= 160),
  recipients text check (recipients is null or char_length(recipients) <= 200),
  classified_at timestamp,
  -- vendors (the helper business): the agreement. Round 2 adds the evidence link.
  agreement_status text check (agreement_status is null or agreement_status in ('none', 'requested', 'signed')),
  agreement_ref text check (agreement_ref is null or char_length(agreement_ref) <= 120),
  agreement_on date,
  -- mirrors into the older register tables
  category_id text,
  location_id text,
  created_by text,
  created_at timestamp not null default (clock_timestamp() at time zone 'UTC'),
  updated_at timestamp not null default (clock_timestamp() at time zone 'UTC'),
  constraint icp_item_name_not_contact check (name !~ '@' and name !~ '[0-9][0-9 -]{8,}[0-9]'),
  constraint icp_item_retired_has_reason check (status = 'active' or retired_reason is not null),
  -- every free-text column: the register holds names of THINGS, never a person's e-mail address or phone number ('|' keeps one column's digits from joining the next)
  constraint icp_item_text_not_contact check (
    (coalesce(where_held, '') || '|' || coalesce(holder_label, '') || '|' || coalesce(purpose, '') || '|' || coalesce(retention_note, '') || '|' || coalesce(recipients, '') || '|' || coalesce(agreement_ref, '') || '|' || coalesce(retired_reason, '')) !~ '@'
    and (coalesce(where_held, '') || '|' || coalesce(holder_label, '') || '|' || coalesce(purpose, '') || '|' || coalesce(retention_note, '') || '|' || coalesce(recipients, '') || '|' || coalesce(agreement_ref, '') || '|' || coalesce(retired_reason, '')) !~ '[0-9][0-9 -]{8,}[0-9]')
);
create unique index if not exists icp_item_org_kind_name_uq on dpdp.icp_item (org_id, kind, lower(btrim(name))) where status = 'active';
create index if not exists icp_item_org_status_idx on dpdp.icp_item (org_id, status, kind);
alter table dpdp.icp_item enable row level security;
revoke all on table dpdp.icp_item from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. The weekly record (append-only). A person's sign-off, or the Monday job (service role).
-- ---------------------------------------------------------------------
create table if not exists dpdp.icp_run (
  id text primary key default replace(gen_random_uuid()::text, '-', ''),
  org_id text not null references dpdp.organisation (id),
  stage text not null check (stage in ('identify', 'classify', 'prove')),
  week_start date not null check (extract(isodow from week_start) = 1),   -- always a Monday (UTC)
  ran_at timestamp not null default (clock_timestamp() at time zone 'UTC'),
  by_kind text not null check (by_kind in ('person', 'software')),
  actor_label text,                                  -- the person's ROLE ("Owner"), never an e-mail address: every member can read the record
  actor_identity_id text,                            -- who, for accountability; never returned to the browser
  outcome text not null default 'ok' check (outcome in ('ok', 'partial', 'failed', 'skipped')),   -- 'skipped' = "nothing new / nothing to attach this week"
  note text check (note is null or (char_length(note) <= 300 and note !~ '@' and note !~ '[0-9][0-9 -]{8,}[0-9]')),
  snapshot jsonb                                   -- the counts at that moment: the weekly proof snapshot
);
create index if not exists icp_run_org_week_idx on dpdp.icp_run (org_id, week_start desc, stage, ran_at desc);
alter table dpdp.icp_run enable row level security;
revoke all on table dpdp.icp_run from public, anon, authenticated;

-- True while the organisation is in its export period before deletion (dpdp.org_offboarding.state = 'exporting'): the append-only guards let the retention job delete then.
create or replace function dpdp.icp_offboarding(p_org_id text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  v boolean := false;
begin
  if to_regclass('dpdp.org_offboarding') is not null then
    execute 'select exists (select 1 from dpdp.org_offboarding o where o.org_id = $1 and o.state = ''exporting'')' into v using p_org_id;
  end if;
  return coalesce(v, false);
end
$$;
revoke all on function dpdp.icp_offboarding(text) from public, anon, authenticated;

-- A free-text answer must not be a person's contact detail.
create or replace function dpdp.icp_not_contact(p text)
returns boolean language sql immutable set search_path = '' as $$
  select p is null or (p !~ '@' and p !~ '[0-9][0-9 -]{8,}[0-9]')
$$;
revoke all on function dpdp.icp_not_contact(text) from public, anon, authenticated;

-- The label that goes on a record: the person's role, never their e-mail address.
create or replace function dpdp.icp_actor_label(m dpdp.membership)
returns text language sql stable set search_path = '' as $$
  select initcap(m.level::text)
$$;
revoke all on function dpdp.icp_actor_label(dpdp.membership) from public, anon, authenticated;

create or replace function dpdp.icp_run_no_change()
returns trigger language plpgsql set search_path = '' as $$
begin
  -- the one exception: while an organisation that has ended is being deleted (dpdp.org_offboarding, drizzle/0724) its rows go with it
  if tg_op = 'DELETE' and dpdp.icp_offboarding(old.org_id) then
    return old;
  end if;
  raise exception 'The weekly record is append-only' using errcode = '42501';
end
$$;
drop trigger if exists icp_run_no_update on dpdp.icp_run;
create trigger icp_run_no_update before update or delete on dpdp.icp_run for each row execute function dpdp.icp_run_no_change();

-- ---------------------------------------------------------------------
-- 4. Helpers (not callable from a browser).
-- ---------------------------------------------------------------------
-- The Monday (UTC) that starts the week containing p_at.
create or replace function dpdp.icp_week(p_at timestamp default null)
returns date language sql stable set search_path = '' as $$
  select (date_trunc('week', coalesce(p_at, (clock_timestamp() at time zone 'UTC'))))::date
$$;

-- The caller's membership in the organisation. p_write = true means "someone who sees the whole organisation" (owner, grievance officer, coordinator, CA):
-- NOT a staff or parent view. Reads of the register and the weekly record use it too: a staff member sees only their own jobs elsewhere in the product.
create or replace function public.dpdp__icp_member(p_org_id text, p_write boolean default false)
returns dpdp.membership
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_m dpdp.membership;
begin
  v_m := public.dpdp__caller_membership(p_org_id);
  if public.dpdp__caller_identity_id() is null or v_m.id is null then
    raise exception 'Organisation not found' using errcode = 'P0002';   -- never confirm that an id exists
  end if;
  if p_write and coalesce(public.dpdp__viewer_kind(v_m.id) in ('staff', 'parent'), true) then
    raise exception 'Only the people who see the whole organisation can change this' using errcode = '42501';
  end if;
  return v_m;
end
$$;

create or replace function dpdp.icp_flag_label(p_key text)
returns text language sql immutable set search_path = '' as $$
  select case p_key
    when 'unclassified' then 'Not classified yet: say whose data it is, why you hold it, on what basis and for how long.'
    when 'children_basis_missing' then 'Children''s data with no basis recorded. The Act needs a parent''s verifiable consent, unless a specific exemption applies. Record which.'
    when 'children_basis_check' then 'Children''s data on a basis other than a parent''s consent. The Act allows only narrow exemptions (the Fourth Schedule; for a school, only tracking or monitoring for education or safety). Say which one applies, or collect parental consent.'
    when 'children_consent_not_collected' then 'Children''s data held on consent, but not every parent link has been answered yet.'
    when 'vendor_agreement_missing' then 'An outside helper without a signed agreement on record.'
    when 'stale' then 'Not re-checked for more than three weeks.'
    else p_key
  end
$$;

-- The risk flags for one register row. Pure: the same row and the same answers always give the same flags.
create or replace function dpdp.icp_item_flags(i dpdp.icp_item, p_week date, p_child_consent_answered boolean)
returns text[] language plpgsql immutable set search_path = '' as $$
declare
  v text[] := '{}';
begin
  if i.status <> 'active' then
    return v;
  end if;
  if i.kind in ('data_set', 'person_group') and (
       i.principal_type is null or i.children is null or i.purpose is null or i.lawful_basis is null
       or (i.retention_days is null and i.retention_note is null)) then
    v := array_append(v, 'unclassified');
  end if;
  if i.kind in ('data_set', 'person_group') and i.children is true then
    if i.lawful_basis is null or i.lawful_basis = 'not_sure' then
      v := array_append(v, 'children_basis_missing');
    elsif i.lawful_basis = 'consent' then
      if not p_child_consent_answered then
        v := array_append(v, 'children_consent_not_collected');
      end if;
    elsif i.lawful_basis <> 'child_exemption' then
      v := array_append(v, 'children_basis_check');   -- s.7 or employment alone do not stand in for a parent's consent: ask which exemption applies
    end if;
  end if;
  if i.kind = 'vendor' and coalesce(i.agreement_status, 'none') <> 'signed' then
    v := array_append(v, 'vendor_agreement_missing');
  end if;
  if coalesce(i.last_confirmed_week, i.first_seen_week) < p_week - 21 then
    v := array_append(v, 'stale');
  end if;
  return v;
end
$$;

-- Has EVERY parent link that was issued for a child in this organisation been answered (yes or no)? A link nobody answered, or that ran out, keeps this false.
-- (the consent tables are older than the register; reading them is all this does)
create or replace function dpdp.icp_child_consent_answered(p_org_id text)
returns boolean language sql stable security definer set search_path = '' as $$
  select count(*) > 0 and count(*) = count(t.acted_at)
    from dpdp.consent_campaign c join dpdp.consent_token t on t.campaign_id = c.id
   where c.org_id = p_org_id and c.principal_is_child
$$;

-- Mirror a data set into the older register tables (category + one location) so the AI link's data-map and the CA client list see it.
create or replace function dpdp.icp_mirror(p_item_id text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  i dpdp.icp_item;
  v_cat text;
  v_loc text;
  v_group text;
begin
  select * into i from dpdp.icp_item where id = p_item_id;
  if i.id is null or i.kind <> 'data_set' then
    return;
  end if;
  v_group := coalesce(i.principal_type, 'other');
  if i.status = 'retired' then
    if i.location_id is not null then
      delete from dpdp.data_location where id = i.location_id;
    end if;
    -- the category goes only if nothing else (another flow's location) hangs off it
    if i.category_id is not null and not exists (select 1 from dpdp.data_location l where l.category_id = i.category_id) then
      delete from dpdp.data_category where id = i.category_id;
    end if;
    update dpdp.icp_item set category_id = null, location_id = null where id = i.id;
    return;
  end if;
  v_cat := coalesce(i.category_id, 'icp_c_' || i.id);
  insert into dpdp.data_category (id, org_id, category, subject_group, is_children_data)
  values (v_cat, i.org_id, i.name, v_group, coalesce(i.children, false))
  on conflict (id) do update set category = excluded.category, subject_group = excluded.subject_group, is_children_data = excluded.is_children_data;
  if i.where_held is not null then
    v_loc := coalesce(i.location_id, 'icp_l_' || i.id);
    insert into dpdp.data_location (id, category_id, system_name, holder_kind, state, confirmed_at)
    values (v_loc, v_cat, i.where_held, 'internal_person',
            case when i.last_confirmed_week is not null then 'confirmed'::dpdp.location_state else 'unknown'::dpdp.location_state end,
            case when i.last_confirmed_week is not null then (clock_timestamp() at time zone 'UTC') end)
    on conflict (id) do update set system_name = excluded.system_name,
      state = case when dpdp.data_location.state = 'unknown' then excluded.state else dpdp.data_location.state end,   -- never overwrite what another flow recorded
      confirmed_at = coalesce(dpdp.data_location.confirmed_at, excluded.confirmed_at);
  else
    v_loc := null;
    if i.location_id is not null then
      delete from dpdp.data_location where id = i.location_id;
    end if;
  end if;
  update dpdp.icp_item set category_id = v_cat, location_id = v_loc where id = i.id;
end
$$;

revoke all on function dpdp.icp_week(timestamp) from public, anon, authenticated;
revoke all on function dpdp.icp_flag_label(text) from public, anon, authenticated;
revoke all on function dpdp.icp_item_flags(dpdp.icp_item, date, boolean) from public, anon, authenticated;
revoke all on function dpdp.icp_child_consent_answered(text) from public, anon, authenticated;
revoke all on function dpdp.icp_mirror(text) from public, anon, authenticated;
revoke all on function public.dpdp__icp_member(text, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 5. IDENTIFY: read, add or change, retire, confirm, starter list.
-- ---------------------------------------------------------------------
create or replace function dpdp.icp_item_json(i dpdp.icp_item, p_week date, p_child_answered boolean)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'id', i.id, 'kind', i.kind, 'name', i.name, 'whereHeld', i.where_held, 'holderLabel', i.holder_label, 'status', i.status, 'source', i.source,
    'firstSeenWeek', to_char(i.first_seen_week, 'YYYY-MM-DD'), 'lastConfirmedWeek', to_char(i.last_confirmed_week, 'YYYY-MM-DD'),
    'principalType', i.principal_type, 'children', i.children, 'purpose', i.purpose, 'lawfulBasis', i.lawful_basis, 'sensitivity', i.sensitivity,
    'retentionDays', i.retention_days, 'retentionNote', i.retention_note, 'recipients', i.recipients,
    'agreementStatus', i.agreement_status, 'agreementRef', i.agreement_ref, 'agreementOn', to_char(i.agreement_on, 'YYYY-MM-DD'),
    'flags', (select coalesce(jsonb_agg(jsonb_build_object('key', f, 'text', dpdp.icp_flag_label(f))), '[]'::jsonb) from unnest(dpdp.icp_item_flags(i, p_week, p_child_answered)) f)
  )
$$;
revoke all on function dpdp.icp_item_json(dpdp.icp_item, date, boolean) from public, anon, authenticated;

create or replace function public.dpdp_icp_register(p_org_id text)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_week date := dpdp.icp_week();
  v_child boolean;
begin
  perform public.dpdp__icp_member(p_org_id, true);
  v_child := dpdp.icp_child_consent_answered(p_org_id);
  return coalesce((
    select jsonb_agg(dpdp.icp_item_json(i, v_week, v_child) order by i.kind, lower(i.name))
    from dpdp.icp_item i where i.org_id = p_org_id and i.status = 'active'
  ), '[]'::jsonb);
end
$$;

-- Add (no id) or change (id) one register row. The payload keys are the camelCase ones dpdp_icp_register returns. Unknown keys are ignored.
create or replace function public.dpdp_icp_save_item(p_org_id text, p_item jsonb)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_m dpdp.membership;
  v_label text;
  v_week date := dpdp.icp_week();
  v_now timestamp := (clock_timestamp() at time zone 'UTC');
  v_id text := nullif(p_item ->> 'id', '');
  i dpdp.icp_item;
  v_kind text;
  v_name text;
  v_new boolean := false;
  v_k text;
begin
  v_m := public.dpdp__icp_member(p_org_id, true);
  if p_item is null or jsonb_typeof(p_item) <> 'object' then
    raise exception 'That is not something the register can record' using errcode = '22023';
  end if;
  v_label := dpdp.icp_actor_label(v_m);
  foreach v_k in array array['whereHeld', 'holderLabel', 'purpose', 'retentionNote', 'recipients', 'agreementRef'] loop
    if not dpdp.icp_not_contact(p_item ->> v_k) then
      raise exception 'That looks like a person''s e-mail address or phone number. The register holds names of things, never a person''s contact' using errcode = '22023';
    end if;
  end loop;
  if (p_item ? 'principalType' and coalesce(p_item ->> 'principalType', '') not in ('', 'student', 'parent_guardian', 'staff', 'applicant', 'alumni', 'client_staff', 'customer', 'visitor', 'other'))
     or (p_item ? 'lawfulBasis' and coalesce(p_item ->> 'lawfulBasis', '') not in ('', 'consent', 'legitimate_use', 'legal_obligation', 'state_function', 'employment', 'child_exemption', 'not_sure'))
     or (p_item ? 'sensitivity' and coalesce(p_item ->> 'sensitivity', '') not in ('', 'ordinary', 'elevated', 'high'))
     or (p_item ? 'agreementStatus' and coalesce(p_item ->> 'agreementStatus', '') not in ('', 'none', 'requested', 'signed')) then
    raise exception 'Pick one of the choices offered' using errcode = '22023';
  end if;
  if p_item ? 'retentionDays' and jsonb_typeof(p_item -> 'retentionDays') = 'number'
     and ((p_item ->> 'retentionDays')::numeric <> trunc((p_item ->> 'retentionDays')::numeric) or (p_item ->> 'retentionDays')::numeric not between 1 and 36500) then
    raise exception 'Keep for a whole number of days, between 1 and 36500' using errcode = '22023';
  end if;

  if v_id is null then
    v_new := true;
    v_kind := p_item ->> 'kind';
    v_name := nullif(btrim(regexp_replace(coalesce(p_item ->> 'name', ''), '\s+', ' ', 'g')), '');
    if v_kind is null or v_kind not in ('data_set', 'system', 'vendor', 'person_group') then
      raise exception 'Say whether this is a data set, a system, an outside helper or a group of people' using errcode = '22023';
    end if;
    if v_name is null then
      raise exception 'Give it a name' using errcode = '22023';
    end if;
    if v_name ~ '@' or v_name ~ '[0-9][0-9 -]{8,}[0-9]' then
      raise exception 'Name the kind of data or the system, not a person: no e-mail address or phone number here' using errcode = '22023';
    end if;
    if exists (select 1 from dpdp.icp_item x where x.org_id = p_org_id and x.kind = v_kind and lower(btrim(x.name)) = lower(v_name) and x.status = 'active') then
      raise exception 'That is already in your register' using errcode = 'P0001';
    end if;
    insert into dpdp.icp_item (org_id, kind, name, first_seen_week, created_by) values (p_org_id, v_kind, v_name, v_week, v_m.identity_id)
    returning * into i;
  else
    select x.* into i from dpdp.icp_item x where x.id = v_id and x.org_id = p_org_id;
    if i.id is null or i.status <> 'active' then
      raise exception 'Not found in your register' using errcode = 'P0002';
    end if;
  end if;

  if p_item ? 'name' and not v_new then
    v_name := nullif(btrim(regexp_replace(coalesce(p_item ->> 'name', ''), '\s+', ' ', 'g')), '');
  end if;
  if v_name is not null and (v_name ~ '@' or v_name ~ '[0-9][0-9 -]{8,}[0-9]') then
    raise exception 'Name the kind of data or the system, not a person: no e-mail address or phone number here' using errcode = '22023';
  end if;

  begin
  if p_item ? 'name' and not v_new and v_name is not null and exists (
       select 1 from dpdp.icp_item x where x.org_id = p_org_id and x.kind = i.kind and lower(btrim(x.name)) = lower(v_name) and x.status = 'active' and x.id <> i.id) then
    raise exception 'That is already in your register' using errcode = 'P0001';
  end if;
  update dpdp.icp_item set
    name = case when p_item ? 'name' and not v_new then coalesce(nullif(btrim(regexp_replace(p_item ->> 'name', '\s+', ' ', 'g')), ''), name) else name end,
    where_held = case when p_item ? 'whereHeld' then nullif(btrim(p_item ->> 'whereHeld'), '') else where_held end,
    holder_label = case when p_item ? 'holderLabel' then nullif(btrim(p_item ->> 'holderLabel'), '') else holder_label end,
    principal_type = case when p_item ? 'principalType' then nullif(p_item ->> 'principalType', '') else principal_type end,
    children = case when p_item ? 'children' then (case when jsonb_typeof(p_item -> 'children') = 'boolean' then (p_item ->> 'children')::boolean else null end) else children end,
    purpose = case when p_item ? 'purpose' then nullif(btrim(p_item ->> 'purpose'), '') else purpose end,
    lawful_basis = case when p_item ? 'lawfulBasis' then nullif(p_item ->> 'lawfulBasis', '') else lawful_basis end,
    sensitivity = case when p_item ? 'sensitivity' then nullif(p_item ->> 'sensitivity', '') else sensitivity end,
    retention_days = case when p_item ? 'retentionDays' then (case when jsonb_typeof(p_item -> 'retentionDays') = 'number' then (p_item ->> 'retentionDays')::integer else null end) else retention_days end,
    retention_note = case when p_item ? 'retentionNote' then nullif(btrim(p_item ->> 'retentionNote'), '') else retention_note end,
    recipients = case when p_item ? 'recipients' then nullif(btrim(p_item ->> 'recipients'), '') else recipients end,
    agreement_status = case when p_item ? 'agreementStatus' then nullif(p_item ->> 'agreementStatus', '') else agreement_status end,
    agreement_ref = case when p_item ? 'agreementRef' then nullif(btrim(p_item ->> 'agreementRef'), '') else agreement_ref end,
    agreement_on = case when p_item ? 'agreementOn' then nullif(p_item ->> 'agreementOn', '')::date else agreement_on end,
    updated_at = v_now
  where id = i.id;
  exception
    when check_violation then raise exception 'One of the answers is not allowed: check the choices and the lengths' using errcode = '22023';
    when invalid_text_representation or numeric_value_out_of_range or invalid_datetime_format or datetime_field_overflow then raise exception 'Check the date and the numbers' using errcode = '22023';
    when unique_violation then raise exception 'That is already in your register' using errcode = 'P0001';
  end;

  select x.* into i from dpdp.icp_item x where x.id = i.id;
  -- classified: the five facts a person can answer. Stamped once they are all there, cleared if one is taken away again.
  update dpdp.icp_item set classified_at = case
      when principal_type is not null and children is not null and purpose is not null and lawful_basis is not null and (retention_days is not null or retention_note is not null)
      then coalesce(classified_at, v_now) else null end
  where id = i.id;
  perform dpdp.icp_mirror(i.id);
  -- The event carries no free text: the register's own words stay in the register (an event can never be erased).
  perform public.dpdp__append_event(p_org_id, v_m.identity_id, v_label, case when v_new then 'icp_item_added' else 'icp_item_changed' end,
    case when v_new then 'Added a ' || replace(i.kind, '_', ' ') || ' to the register' else 'Updated a ' || replace(i.kind, '_', ' ') || ' in the register' end);
  select x.* into i from dpdp.icp_item x where x.id = i.id;
  return jsonb_build_object('ok', true, 'item', dpdp.icp_item_json(i, v_week, dpdp.icp_child_consent_answered(p_org_id)));
end
$$;

create or replace function public.dpdp_icp_retire_item(p_org_id text, p_item_id text, p_reason text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_m dpdp.membership;
  v_label text;
  i dpdp.icp_item;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  v_m := public.dpdp__icp_member(p_org_id, true);
  if v_reason is null or char_length(v_reason) > 200 then
    raise exception 'Say in a few words why it is no longer held (up to 200 characters)' using errcode = '22023';
  end if;
  select x.* into i from dpdp.icp_item x where x.id = p_item_id and x.org_id = p_org_id and x.status = 'active';
  if i.id is null then
    raise exception 'Not found in your register' using errcode = 'P0002';
  end if;
  if not dpdp.icp_not_contact(v_reason) then
    raise exception 'That looks like a person''s e-mail address or phone number. Leave it out' using errcode = '22023';
  end if;
  -- a retired line keeps only its name, its kind and the reason: the free-text answers are cleared so nothing typed there outlives the line
  update dpdp.icp_item set status = 'retired', retired_reason = v_reason, updated_at = (clock_timestamp() at time zone 'UTC'),
         where_held = null, holder_label = null, purpose = null, recipients = null, retention_note = null, agreement_ref = null
   where id = i.id;
  perform dpdp.icp_mirror(i.id);
  v_label := dpdp.icp_actor_label(v_m);
  perform public.dpdp__append_event(p_org_id, v_m.identity_id, v_label, 'icp_item_retired', 'Took a ' || replace(i.kind, '_', ' ') || ' off the register');
  return jsonb_build_object('ok', true);
end
$$;

-- "Still true": the weekly re-check. With no list, every active row is confirmed.
create or replace function public.dpdp_icp_confirm_items(p_org_id text, p_item_ids text[] default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_m dpdp.membership;
  v_label text;
  v_week date := dpdp.icp_week();
  v_n integer;
  r record;
begin
  v_m := public.dpdp__icp_member(p_org_id, true);
  update dpdp.icp_item set last_confirmed_week = v_week, updated_at = (clock_timestamp() at time zone 'UTC')
   where org_id = p_org_id and status = 'active' and (p_item_ids is null or id = any (p_item_ids));
  get diagnostics v_n = row_count;
  for r in select id from dpdp.icp_item where org_id = p_org_id and status = 'active' and kind = 'data_set' and (p_item_ids is null or id = any (p_item_ids)) loop
    perform dpdp.icp_mirror(r.id);
  end loop;
  if v_n > 0 then
    v_label := dpdp.icp_actor_label(v_m);
    perform public.dpdp__append_event(p_org_id, v_m.identity_id, v_label, 'icp_register_confirmed', 'Confirmed ' || v_n || ' register line(s) as still true this week');
  end if;
  return jsonb_build_object('ok', true, 'confirmed', v_n);
end
$$;

-- A starter list from the library: the data sets the jobs of this organisation's product already name (Part 2 of the library). Nothing is classified
-- for the person; each row arrives as "not classified yet". Re-runnable: a name already on the register is skipped.
create or replace function public.dpdp_icp_starter(p_org_id text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_m dpdp.membership;
  v_label text;
  v_week date := dpdp.icp_week();
  v_n integer := 0;
  v_product text;
  r record;
  v_id text;
begin
  v_m := public.dpdp__icp_member(p_org_id, true);
  select o.product into v_product from dpdp.organisation o where o.id = p_org_id;
  for r in
    select distinct t.data_set from dpdp.obligation ob join dpdp.obligation_template t on t.id = ob.template_id
    where ob.org_id = p_org_id and t.part = 2 and t.data_set is not null and btrim(t.data_set) <> '' and ob.state <> 'not_applicable'
    order by t.data_set
  loop
    if not exists (select 1 from dpdp.icp_item x where x.org_id = p_org_id and x.kind = 'data_set' and lower(btrim(x.name)) = lower(btrim(r.data_set)) and x.status = 'active') then
      insert into dpdp.icp_item (org_id, kind, name, source, first_seen_week, created_by)
      values (p_org_id, 'data_set', btrim(r.data_set), 'starter', v_week, v_m.identity_id) returning id into v_id;
      perform dpdp.icp_mirror(v_id);
      v_n := v_n + 1;
    end if;
  end loop;
  if v_n > 0 then
    v_label := dpdp.icp_actor_label(v_m);
    perform public.dpdp__append_event(p_org_id, v_m.identity_id, v_label, 'icp_register_started', 'Started the register from the library: ' || v_n || ' data set(s)');
  end if;
  return jsonb_build_object('ok', true, 'added', v_n);
end
$$;

-- ---------------------------------------------------------------------
-- 6. CLASSIFY rules that act on jobs: switch the children's-data jobs back ON (never off).
-- ---------------------------------------------------------------------
create or replace function dpdp.icp_children_job_keys()
returns text[] language sql immutable set search_path = '' as $$
  select array['institution-07', 'institution-08', 'institution-11', 'institution-12', 'institution-13', 'institution-21', 'institution-22', 'institution-25', 'institution-27']
$$;
revoke all on function dpdp.icp_children_job_keys() from public, anon, authenticated;

create or replace function public.dpdp_icp_apply_rules(p_org_id text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_m dpdp.membership;
  v_label text;
  v_n integer := 0;
begin
  v_m := public.dpdp__icp_member(p_org_id, true);
  if not exists (select 1 from dpdp.icp_item x where x.org_id = p_org_id and x.status = 'active' and x.children is true and x.kind in ('data_set', 'person_group')) then
    return jsonb_build_object('ok', true, 'reopened', 0);
  end if;
  select count(*) into v_n from dpdp.obligation ob join dpdp.obligation_template t on t.id = ob.template_id
   where ob.org_id = p_org_id and t.key = any (dpdp.icp_children_job_keys()) and ob.state = 'not_applicable';
  if v_n > 0 then
    -- the event (and with it the History lock) first, then the job rows: no row lock is held while waiting for the lock
    v_label := dpdp.icp_actor_label(v_m);
    perform public.dpdp__append_event(p_org_id, v_m.identity_id, v_label, 'icp_jobs_switched_on',
      'Switched ' || v_n || ' children''s-data job(s) back on, because the register lists children''s data');
    update dpdp.obligation ob set state = 'open', na_reason = null
     from dpdp.obligation_template t
     where ob.org_id = p_org_id and t.id = ob.template_id and t.key = any (dpdp.icp_children_job_keys()) and ob.state = 'not_applicable';
    get diagnostics v_n = row_count;
  end if;
  return jsonb_build_object('ok', true, 'reopened', v_n);
end
$$;

-- ---------------------------------------------------------------------
-- 7. The weekly checklist: Identify, Classify, Prove. Each section returns {done, total, todo:[{key,label,done,count}]}.
--    PROVE is its own function so the next migration replaces just that part.
-- ---------------------------------------------------------------------
create or replace function dpdp.icp_step(p_key text, p_label text, p_done boolean, p_count integer default null, p_action text default null)
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object('key', p_key, 'label', p_label, 'done', p_done, 'count', p_count, 'action', p_action)
$$;

create or replace function dpdp.icp_section(p_steps jsonb[])
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'done', (select count(*) from unnest(p_steps) s where (s ->> 'done')::boolean),
    'total', coalesce(array_length(p_steps, 1), 0),
    'steps', to_jsonb(p_steps))
$$;

create or replace function dpdp.icp_identify(p_org_id text, p_week date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_active integer;
  v_unconfirmed integer;
  v_new integer;
  v_logged boolean;
begin
  select count(*) into v_active from dpdp.icp_item where org_id = p_org_id and status = 'active';
  select count(*) into v_unconfirmed from dpdp.icp_item where org_id = p_org_id and status = 'active' and coalesce(last_confirmed_week, '1900-01-01') < p_week and first_seen_week < p_week;
  select count(*) into v_new from dpdp.icp_item where org_id = p_org_id and first_seen_week = p_week and status = 'active';
  select exists (select 1 from dpdp.icp_run r where r.org_id = p_org_id and r.week_start = p_week and r.stage = 'identify' and r.outcome = 'skipped' and r.by_kind = 'person') into v_logged;   -- 'skipped' = nothing new this week
  return dpdp.icp_section(array[
    dpdp.icp_step('register_started', 'Start your register: list what you hold, where, and who holds it', v_active > 0, v_active, 'register'),
    dpdp.icp_step('confirm_register', 'Check each line of your register is still true', v_active > 0 and v_unconfirmed = 0, v_unconfirmed, 'register'),
    dpdp.icp_step('anything_new', 'Add anything new this week, or say there is nothing new', v_new > 0 or v_logged, v_new, 'register')
  ]);
end
$$;

create or replace function dpdp.icp_classify(p_org_id text, p_week date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_child boolean := dpdp.icp_child_consent_answered(p_org_id);
  v_unclassified integer := 0;
  v_children_flags integer := 0;
  v_vendor_flags integer := 0;
  v_jobs_off integer := 0;
  i dpdp.icp_item;
  f text[];
begin
  for i in select * from dpdp.icp_item where org_id = p_org_id and status = 'active' loop
    f := dpdp.icp_item_flags(i, p_week, v_child);
    if 'unclassified' = any (f) then v_unclassified := v_unclassified + 1; end if;
    if 'children_basis_missing' = any (f) or 'children_consent_not_collected' = any (f) then v_children_flags := v_children_flags + 1; end if;
    if 'vendor_agreement_missing' = any (f) then v_vendor_flags := v_vendor_flags + 1; end if;
  end loop;
  select count(*) into v_jobs_off
    from dpdp.obligation ob join dpdp.obligation_template t on t.id = ob.template_id
   where ob.org_id = p_org_id and ob.state = 'not_applicable' and t.key = any (dpdp.icp_children_job_keys())
     and exists (select 1 from dpdp.icp_item x where x.org_id = p_org_id and x.status = 'active' and x.children is true and x.kind in ('data_set', 'person_group'));
  return dpdp.icp_section(array[
    dpdp.icp_step('classify_items', 'Classify every line: whose data, children or not, why, on what basis, for how long', v_unclassified = 0 and exists (select 1 from dpdp.icp_item where org_id = p_org_id and status = 'active'), v_unclassified, 'register'),
    dpdp.icp_step('children_rules', 'Settle the basis for children''s data (parental consent or the educational purpose)', v_children_flags = 0, v_children_flags, 'register'),
    dpdp.icp_step('vendor_rules', 'Outside helpers: an agreement on record for each', v_vendor_flags = 0, v_vendor_flags, 'register'),
    dpdp.icp_step('jobs_follow_register', 'Children''s-data jobs switched on where the register lists children', v_jobs_off = 0, v_jobs_off, 'rules')
  ]);
end
$$;

-- PROVE, as it stands today (replaced by drizzle/0762): jobs, the weekly sign-off, the History chain.
create or replace function dpdp.icp_prove(p_org_id text, p_week date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_late integer;
  v_events integer;
  v_signed boolean;
begin
  select count(*) into v_late from dpdp.obligation ob where ob.org_id = p_org_id and ob.state not in ('closed', 'submitted', 'not_applicable') and ob.due_on < (clock_timestamp() at time zone 'UTC')::date;
  select count(*) into v_events from dpdp.event e where e.org_id = p_org_id and e.occurred_at >= p_week::timestamp;
  select exists (select 1 from dpdp.icp_run r where r.org_id = p_org_id and r.week_start = p_week and r.stage = 'prove' and r.by_kind = 'person' and r.outcome = 'ok') into v_signed;
  return dpdp.icp_section(array[
    dpdp.icp_step('jobs_not_late', 'No job is late', v_late = 0, v_late, 'jobs'),
    dpdp.icp_step('history_written', 'This week''s work is on the record (History)', v_events > 0, v_events, 'history'),
    dpdp.icp_step('week_signed_off', 'A person signs off the week', v_signed, null, 'signoff')
  ]);
end
$$;
revoke all on function dpdp.icp_step(text, text, boolean, integer, text) from public, anon, authenticated;
revoke all on function dpdp.icp_section(jsonb[]) from public, anon, authenticated;
revoke all on function dpdp.icp_identify(text, date) from public, anon, authenticated;
revoke all on function dpdp.icp_classify(text, date) from public, anon, authenticated;
revoke all on function dpdp.icp_prove(text, date) from public, anon, authenticated;

-- The snapshot for one organisation and week, the same for the browser, the e-mail and the weekly record.
create or replace function dpdp.icp_status_for(p_org_id text, p_week date default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_week date := coalesce(p_week, dpdp.icp_week());
  v_i jsonb := dpdp.icp_identify(p_org_id, v_week);
  v_c jsonb := dpdp.icp_classify(p_org_id, v_week);
  v_p jsonb := dpdp.icp_prove(p_org_id, v_week);
  v_done integer := (v_i ->> 'done')::int + (v_c ->> 'done')::int + (v_p ->> 'done')::int;
  v_total integer := (v_i ->> 'total')::int + (v_c ->> 'total')::int + (v_p ->> 'total')::int;
  v_pct integer := case when v_total = 0 then 0 else round(100.0 * v_done / v_total)::int end;
begin
  return jsonb_build_object(
    'weekStart', to_char(v_week, 'YYYY-MM-DD'),
    'identify', v_i, 'classify', v_c, 'prove', v_p,
    'done', v_done, 'total', v_total, 'percent', v_pct,
    -- a plain reading of how much of THIS WEEK'S routine is done. It is not a rating of the organisation's legal position.
    'status', case when v_done = 0 then 'not_started' when v_done = v_total then 'complete' else 'in_progress' end,
    'notALegalRating', true);
end
$$;
revoke all on function dpdp.icp_status_for(text, date) from public, anon, authenticated;

create or replace function public.dpdp_icp_status(p_org_id text)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_week date := dpdp.icp_week();
  v_out jsonb;
begin
  perform public.dpdp__icp_member(p_org_id, true);
  v_out := dpdp.icp_status_for(p_org_id, v_week);
  return v_out || jsonb_build_object(
    'runs', coalesce((
      select jsonb_agg(jsonb_build_object('stage', r.stage, 'weekStart', to_char(r.week_start, 'YYYY-MM-DD'), 'ranAt', r.ran_at, 'byKind', r.by_kind, 'actor', r.actor_label, 'outcome', r.outcome, 'note', r.note, 'percent', (r.snapshot ->> 'percent')::int) order by r.ran_at desc)
      from (select * from dpdp.icp_run x where x.org_id = p_org_id and x.week_start >= v_week - 28 order by x.ran_at desc limit 120) r), '[]'::jsonb));
end
$$;

-- A person's sign-off of one stage. The snapshot is the counts at that moment. outcome 'ok' = signed off; 'skipped' = "nothing new this week" (Identify) or
-- "nothing to attach this week" (Prove); only those two tick a checklist step of their own, a plain sign-off never ticks another step.
create or replace function public.dpdp_icp_log(p_org_id text, p_stage text, p_outcome text default 'ok', p_note text default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_m dpdp.membership;
  v_label text;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_week date := dpdp.icp_week();
  v_id text;
begin
  v_m := public.dpdp__icp_member(p_org_id, true);   -- an organisation that is not yours is "not found", the same answer as one that does not exist
  if p_stage not in ('identify', 'classify', 'prove') then raise exception 'Unknown stage' using errcode = '22023'; end if;
  if p_outcome not in ('ok', 'partial', 'skipped') then raise exception 'Unknown outcome' using errcode = '22023'; end if;
  if char_length(v_note) > 300 then raise exception 'A note can be 300 characters at most' using errcode = '22023'; end if;
  if not dpdp.icp_not_contact(v_note) then raise exception 'Leave out e-mail addresses and phone numbers' using errcode = '22023'; end if;
  v_label := dpdp.icp_actor_label(v_m);
  insert into dpdp.icp_run (org_id, stage, week_start, by_kind, actor_label, actor_identity_id, outcome, note, snapshot)
  values (p_org_id, p_stage, v_week, 'person', v_label, v_m.identity_id, p_outcome, v_note, dpdp.icp_status_for(p_org_id, v_week) - 'notALegalRating')
  returning id into v_id;
  perform public.dpdp__append_event(p_org_id, v_m.identity_id, v_label, 'icp_stage_signed_off',
    case when p_outcome = 'skipped' then (case p_stage when 'identify' then 'Recorded: nothing new this week' else 'Recorded: nothing to attach this week' end)
         else (case p_stage when 'identify' then 'Signed off Identify for the week' when 'classify' then 'Signed off Classify for the week' else 'Signed off Prove for the week' end) end);
  return jsonb_build_object('ok', true, 'id', v_id, 'weekStart', to_char(v_week, 'YYYY-MM-DD'));
end
$$;

-- The Monday job (service role ONLY, by grant) recording what it counted for one organisation. Never callable from a browser.
create or replace function public.dpdp_icp_run_software(p_org_id text, p_stage text, p_outcome text default 'ok', p_note text default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_week date := dpdp.icp_week();
  v_id text;
begin
  if p_stage not in ('identify', 'classify', 'prove') then raise exception 'Unknown stage' using errcode = '22023'; end if;
  if p_outcome not in ('ok', 'partial', 'failed', 'skipped') then raise exception 'Unknown outcome' using errcode = '22023'; end if;
  if char_length(v_note) > 300 or not dpdp.icp_not_contact(v_note) then raise exception 'Check the note' using errcode = '22023'; end if;
  if not exists (select 1 from dpdp.organisation o where o.id = p_org_id) then raise exception 'Organisation not found' using errcode = 'P0002'; end if;
  insert into dpdp.icp_run (org_id, stage, week_start, by_kind, actor_label, outcome, note, snapshot)
  values (p_org_id, p_stage, v_week, 'software', 'Automatic helper', p_outcome, v_note, dpdp.icp_status_for(p_org_id, v_week) - 'notALegalRating')
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'weekStart', to_char(v_week, 'YYYY-MM-DD'));
end
$$;

revoke all on function public.dpdp_icp_register(text) from public, anon;
revoke all on function public.dpdp_icp_save_item(text, jsonb) from public, anon;
revoke all on function public.dpdp_icp_retire_item(text, text, text) from public, anon;
revoke all on function public.dpdp_icp_confirm_items(text, text[]) from public, anon;
revoke all on function public.dpdp_icp_starter(text) from public, anon;
revoke all on function public.dpdp_icp_apply_rules(text) from public, anon;
revoke all on function public.dpdp_icp_status(text) from public, anon;
revoke all on function public.dpdp_icp_log(text, text, text, text) from public, anon;
revoke all on function public.dpdp_icp_run_software(text, text, text, text) from public, anon, authenticated;
grant execute on function public.dpdp_icp_register(text) to authenticated, app_runtime, service_role;
grant execute on function public.dpdp_icp_save_item(text, jsonb) to authenticated, app_runtime, service_role;
grant execute on function public.dpdp_icp_retire_item(text, text, text) to authenticated, app_runtime, service_role;
grant execute on function public.dpdp_icp_confirm_items(text, text[]) to authenticated, app_runtime, service_role;
grant execute on function public.dpdp_icp_starter(text) to authenticated, app_runtime, service_role;
grant execute on function public.dpdp_icp_apply_rules(text) to authenticated, app_runtime, service_role;
grant execute on function public.dpdp_icp_status(text) to authenticated, app_runtime, service_role;
grant execute on function public.dpdp_icp_log(text, text, text, text) to authenticated, app_runtime, service_role;
grant execute on function public.dpdp_icp_run_software(text, text, text, text) to service_role;

commit;
