-- WO-DPDP-011 Step 3: the OWNER's page on the static app -- the first-visit
-- wizard (areasForProduct + completeOwnerFirstVisit) and the owner-only
-- actions (assign a person, mark a job "doesn't apply") ported from
-- src/lib/services/dpdp-onepage-service.ts / dpdp-obligation-service.ts
-- onto the Step 2 RPC path (drizzle/0604), plus the History timeline read.
-- Same rules as 0604, restated so this file stands on its own:
--   * public schema only (PostgREST here exposes public/graphql_public/
--     compliance; dpdp.* is deliberately unreachable from a browser).
--   * SECURITY DEFINER, search_path = '', caller resolved from the Supabase
--     Auth JWT's email via public.dpdp__caller_identity_id() /
--     public.dpdp__caller_membership(p_org_id) -- never from an argument.
--   * Every write appends exactly one dpdp.event per logical action via
--     public.dpdp__append_event, inside the same transaction, with the SAME
--     kinds and summaries the TypeScript services write.
--   * Refusals raise with the same plain-English messages the TS uses:
--     "Not a member of this organisation" / "Only the owner can do this" /
--     "Not your job" (42501), "Job not found" (P0002), "Already closed" /
--     "Doesn't apply" (P0001, the TS's 409s).
--   * Additive only (WO-011 §6): new functions, no table changes. The one
--     existing function this file touches is public.dpdp__append_event,
--     CREATE OR REPLACEd with the same signature and the same hash formula
--     -- see its own comment for the one-line behavioural fix and why.
--
-- WO-011 §4 bug fix carried here: the TS assignObligation() set
-- obligation.assigned_person_id but never created the named person's
-- dpdp.membership row, so the person could never sign in to see the job
-- (getDpdpAuthContext / dpdp_my_page both require a membership).
-- dpdp_assign_person below finds-or-creates BOTH, the way
-- completeOwnerFirstVisit already did.

-- ---------------------------------------------------------------------
-- public.dpdp__append_event: same signature and hash formula as 0604, with
-- one addition -- occurred_at is now STRICTLY INCREASING per org.
--
-- Why: the chain's "previous event" is `order by occurred_at desc limit 1`,
-- and verifyDpdpEventChain() (dpdp-event-service.ts) replays the chain in
-- `order by occurred_at asc`. 0604's writers append one event per RPC call,
-- with a network round trip between calls, so two events never shared a
-- millisecond. dpdp_complete_owner_first_visit below appends one event per
-- AREA inside a single plpgsql loop -- sub-millisecond apart -- and
-- date_trunc('milliseconds', clock_timestamp()) can then hand two events
-- the same occurred_at. Two equal timestamps make both ORDER BYs
-- non-deterministic: the second event can chain onto the wrong prev_hash,
-- or verify can replay them swapped, and the org's chain reads as broken
-- from JS even though every hash was computed correctly. Bumping a tied
-- timestamp by 1ms keeps every event's canonical JSON self-consistent (the
-- bumped value is what gets stored AND what gets hashed) and costs nothing
-- when there is no tie, which is every case 0604 already had.
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

-- ---------------------------------------------------------------------
-- Internal helpers -- not callable from the browser (revoked below).
-- ---------------------------------------------------------------------

-- completeOwnerFirstVisit's findOrCreateIdentityByEmail(): the identity for
-- an email, creating dpdp.identity + its primary dpdp.identity_email when
-- none exists. Matched with lower() on both sides (the same reason 0604's
-- dpdp__caller_identity_id does), and also against identity.primary_email so
-- a hand-seeded identity with no identity_email row is found rather than
-- tripping identity's own unique(primary_email) on insert. Returns null for
-- a blank email; callers skip those.
create or replace function public.dpdp__find_or_create_identity(p_email text)
returns text
language plpgsql security definer
set search_path = ''
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_id text;
begin
  if v_email = '' then
    return null;
  end if;
  select ie.identity_id into v_id
  from dpdp.identity_email ie
  where lower(ie.email) = v_email
  order by ie.is_primary desc
  limit 1;
  if v_id is not null then
    return v_id;
  end if;
  select i.id into v_id from dpdp.identity i where lower(i.primary_email) = v_email limit 1;
  if v_id is null then
    v_id := replace(gen_random_uuid()::text, '-', '');
    insert into dpdp.identity (id, primary_email) values (v_id, v_email);
  end if;
  insert into dpdp.identity_email (id, identity_id, email, is_primary)
  values (replace(gen_random_uuid()::text, '-', ''), v_id, v_email, true);
  return v_id;
end
$$;

-- completeOwnerFirstVisit's findOrCreateMembership(): the person's
-- membership in THIS org (any state -- the TS checks existence, not state),
-- created as level 'staff' / joined_via 'named_in_role' when missing. This
-- is the row that lets a named person actually sign in (WO-011 §4).
create or replace function public.dpdp__find_or_create_membership(p_org_id text, p_identity_id text)
returns dpdp.membership
language plpgsql security definer
set search_path = ''
as $$
declare
  v_m dpdp.membership;
begin
  select m.* into v_m
  from dpdp.membership m
  where m.identity_id = p_identity_id and m.org_id = p_org_id
  order by m.created_at desc
  limit 1;
  if v_m.id is null then
    insert into dpdp.membership (id, identity_id, org_id, level, joined_via)
    values (replace(gen_random_uuid()::text, '-', ''), p_identity_id, p_org_id, 'staff', 'named_in_role')
    returning * into v_m;
  end if;
  return v_m;
end
$$;

-- ---------------------------------------------------------------------
-- Browser-callable surface (authenticated role only).
-- ---------------------------------------------------------------------

-- areasForProduct(): the first-visit wizard's "who looks after what" rows.
-- Templates of the CURRENT library version (dpdp.library_version.is_current,
-- exactly what getCurrentLibraryVersion() reads) for that product, grouped by
-- role_tag, skipping untagged templates and the OWNER/CAMGR/CAPARTNER chain
-- roles (those are never "assigned" from the wizard). Areas come out in the
-- order their first template appears by key, jobs within an area by key --
-- the same order the TS's Map-insertion-by-sorted-key produces -- and an
-- area is a group area if ANY of its templates carries applies_when.grp.
-- Reference data with no tenant in it, so no membership check: any signed-in
-- user may read the library's job names (they are public product copy).
create or replace function public.dpdp_areas_for_product(p_product text)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_version text;
  v_out jsonb;
begin
  select v.id into v_version from dpdp.library_version v where v.is_current = true limit 1;
  if v_version is null then
    raise exception 'No dpdp.library_version marked is_current -- run ensureDraftObligationLibrarySeeded() or seed one';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('area', a.area, 'jobs', a.jobs, 'isGroup', a.is_group) order by a.first_key), '[]'::jsonb)
  into v_out
  from (
    select
      t.role_tag as area,
      jsonb_agg(t.name order by t.key) as jobs,
      bool_or(coalesce(t.applies_when -> 'grp' = 'true'::jsonb, false)) as is_group,
      min(t.key) as first_key
    from dpdp.obligation_template t
    where t.library_version_id = v_version
      and t.product = p_product
      and t.role_tag is not null
      and t.role_tag not in ('OWNER', 'CAMGR', 'CAPARTNER')
    group by t.role_tag
  ) a;
  return v_out;
end
$$;

-- completeOwnerFirstVisit() as an RPC. p_assignments is the wizard's own
-- shape: [{ area, emails: [..], na }]. Per area, in order:
--   * na            -> every obligation whose template.role_tag = area goes
--                      not_applicable (reason "Marked ‘doesn’t apply’ at
--                      first visit"); event obligation_not_my_job.
--   * group area    -> find-or-create dpdp.staff_group (org_id, label=area),
--                      every named email becomes identity + membership +
--                      staff_group_member; obligations get
--                      assigned_staff_group_id and progress_total = the
--                      group's member count (min 1); event
--                      membership_named_in_role "Named <n> people to ...".
--   * person area   -> the first email becomes identity + membership and
--                      assigned_person_id on every matching obligation;
--                      applies_when.fromArea jobs ("Name the Grievance
--                      Officer"/"Name a DPDP coordinator") auto-close,
--                      credited to the OWNER (closed_by = caller), the spec's
--                      own ex.fromArea behaviour; event
--                      membership_named_in_role "Named <email> as <area>".
--   * areas with no matching obligations, or no emails and not na, are
--      skipped, as in the TS.
-- Finally the caller's own membership.first_visit_seen_at is stamped, which
-- is what stops the wizard showing again. Ownership is enforced HERE: the
-- caller must hold an ACTIVE membership in p_org_id at level 'owner'.
-- Returns { ok, assigned: <areas given a person/group>, notApplicable:
-- <areas marked na> }.
--
-- Two deliberate, small departures from the TS, both toward correctness:
-- blank/whitespace emails are dropped before anything else (the TS's person
-- branch would have created an identity with an empty address), and
-- progress_total is the group's REAL member count after this call (the TS
-- counted every listed email, so the same address pasted twice made a
-- 2-person group that could never reach "everyone answered").
create or replace function public.dpdp_complete_owner_first_visit(p_org_id text, p_assignments jsonb)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_identity text;
  v_label text;
  v_m dpdp.membership;
  v_now timestamp := (clock_timestamp() at time zone 'UTC');
  v_a jsonb;
  v_area text;
  v_na boolean;
  v_emails text[];
  v_addr text;
  v_matching int;
  v_is_group boolean;
  v_group_id text;
  v_person text;
  v_member dpdp.membership;
  v_member_count int;
  v_assigned int := 0;
  v_na_count int := 0;
begin
  v_identity := public.dpdp__caller_identity_id();
  if v_identity is null then
    raise exception 'Not a member of this organisation' using errcode = '42501';
  end if;
  v_m := public.dpdp__caller_membership(p_org_id);
  if v_m.id is null then
    raise exception 'Not a member of this organisation' using errcode = '42501';
  end if;
  if v_m.level <> 'owner' then
    raise exception 'Only the owner can do this' using errcode = '42501';
  end if;
  if p_assignments is null or jsonb_typeof(p_assignments) <> 'array' then
    raise exception 'assignments must be a list' using errcode = '22023';
  end if;
  select i.primary_email into v_label from dpdp.identity i where i.id = v_identity;

  for v_a in select e.value from jsonb_array_elements(p_assignments) e loop
    v_area := v_a ->> 'area';
    if v_area is null or trim(v_area) = '' then
      continue;
    end if;
    v_na := coalesce((v_a ->> 'na')::boolean, false);
    -- Non-blank emails, trimmed and lowercased, in the order given (the
    -- person branch takes the first).
    select coalesce(array_agg(x.addr order by x.ord), '{}'::text[]) into v_emails
    from (
      select lower(trim(e.value)) as addr, e.ordinality as ord
      from jsonb_array_elements_text(
        case when jsonb_typeof(v_a -> 'emails') = 'array' then v_a -> 'emails' else '[]'::jsonb end
      ) with ordinality as e(value, ordinality)
      where trim(e.value) <> ''
    ) x;

    select count(*), bool_or(coalesce(t.applies_when -> 'grp' = 'true'::jsonb, false))
    into v_matching, v_is_group
    from dpdp.obligation o
    join dpdp.obligation_template t on t.id = o.template_id
    where o.org_id = v_m.org_id and t.role_tag = v_area;
    if v_matching = 0 then
      continue;
    end if;

    if v_na then
      update dpdp.obligation o
      set state = 'not_applicable', na_reason = 'Marked ‘doesn’t apply’ at first visit'
      from dpdp.obligation_template t
      where t.id = o.template_id and o.org_id = v_m.org_id and t.role_tag = v_area;
      perform public.dpdp__append_event(v_m.org_id, v_identity, v_label, 'obligation_not_my_job', 'Marked "' || v_area || '" as not applicable');
      v_na_count := v_na_count + 1;
      continue;
    end if;
    if coalesce(array_length(v_emails, 1), 0) = 0 then
      continue;
    end if;

    if v_is_group then
      select g.id into v_group_id
      from dpdp.staff_group g
      where g.org_id = v_m.org_id and g.label = v_area
      order by g.created_at asc
      limit 1;
      if v_group_id is null then
        v_group_id := replace(gen_random_uuid()::text, '-', '');
        insert into dpdp.staff_group (id, org_id, label) values (v_group_id, v_m.org_id, v_area);
      end if;
      foreach v_addr in array v_emails loop
        v_person := public.dpdp__find_or_create_identity(v_addr);
        v_member := public.dpdp__find_or_create_membership(v_m.org_id, v_person);
        insert into dpdp.staff_group_member (id, group_id, membership_id)
        select replace(gen_random_uuid()::text, '-', ''), v_group_id, v_member.id
        where not exists (
          select 1 from dpdp.staff_group_member sgm where sgm.group_id = v_group_id and sgm.membership_id = v_member.id
        );
      end loop;
      select count(*) into v_member_count from dpdp.staff_group_member sgm where sgm.group_id = v_group_id;
      update dpdp.obligation o
      set assigned_staff_group_id = v_group_id, progress_total = greatest(v_member_count, 1)
      from dpdp.obligation_template t
      where t.id = o.template_id and o.org_id = v_m.org_id and t.role_tag = v_area;
      perform public.dpdp__append_event(
        v_m.org_id, v_identity, v_label, 'membership_named_in_role',
        'Named ' || (select count(distinct e) from unnest(v_emails) e) || ' people to "' || v_area || '"'
      );
      v_assigned := v_assigned + 1;
      continue;
    end if;

    v_addr := v_emails[1];
    v_person := public.dpdp__find_or_create_identity(v_addr);
    perform public.dpdp__find_or_create_membership(v_m.org_id, v_person);
    update dpdp.obligation o
    set assigned_person_id = v_person
    from dpdp.obligation_template t
    where t.id = o.template_id and o.org_id = v_m.org_id and t.role_tag = v_area;
    update dpdp.obligation o
    set state = 'closed', progress_done = o.progress_total, closed_at = v_now, closed_by = v_identity
    from dpdp.obligation_template t
    where t.id = o.template_id and o.org_id = v_m.org_id and t.role_tag = v_area
      and coalesce(t.applies_when -> 'fromArea' = 'true'::jsonb, false);
    perform public.dpdp__append_event(v_m.org_id, v_identity, v_label, 'membership_named_in_role', 'Named ' || v_addr || ' as ' || v_area);
    v_assigned := v_assigned + 1;
  end loop;

  update dpdp.membership set first_visit_seen_at = v_now where id = v_m.id;
  return jsonb_build_object('ok', true, 'assigned', v_assigned, 'notApplicable', v_na_count);
end
$$;

-- assignObligation() as an RPC, with the WO-011 §4 fix: the named email gets
-- an identity AND a membership in the job's org (level staff, joined_via
-- named_in_role), so they can sign in and see it. Owner-only. A job the
-- caller cannot see (no membership in its org) is "Job not found", not a
-- different message that would confirm the id exists. A closed or
-- not-applicable job is refused the way the TS's 409s are; anything else
-- goes back to 'open' with the new person on it.
create or replace function public.dpdp_assign_person(p_obligation_id text, p_email text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_identity text;
  v_label text;
  v_o dpdp.obligation;
  v_m dpdp.membership;
  v_addr text := lower(trim(coalesce(p_email, '')));
  v_person text;
  v_name text;
begin
  v_identity := public.dpdp__caller_identity_id();
  select o.* into v_o from dpdp.obligation o where o.id = p_obligation_id;
  if v_identity is null or v_o.id is null then
    raise exception 'Job not found' using errcode = 'P0002';
  end if;
  v_m := public.dpdp__caller_membership(v_o.org_id);
  if v_m.id is null then
    raise exception 'Job not found' using errcode = 'P0002';
  end if;
  if v_m.level <> 'owner' then
    raise exception 'Only the owner can do this' using errcode = '42501';
  end if;
  if v_addr = '' then
    raise exception 'An email address is required' using errcode = '22023';
  end if;
  if v_o.state = 'closed' then
    raise exception 'Already closed' using errcode = 'P0001';
  end if;
  if v_o.state = 'not_applicable' then
    raise exception 'Doesn''t apply' using errcode = 'P0001';
  end if;

  v_person := public.dpdp__find_or_create_identity(v_addr);
  perform public.dpdp__find_or_create_membership(v_o.org_id, v_person);
  update dpdp.obligation set assigned_person_id = v_person, state = 'open' where id = v_o.id;

  select i.primary_email into v_label from dpdp.identity i where i.id = v_identity;
  select t.name into v_name from dpdp.obligation_template t where t.id = v_o.template_id;
  perform public.dpdp__append_event(v_o.org_id, v_identity, v_label, 'obligation_assigned', 'Assigned "' || coalesce(v_name, 'a job') || '" to ' || v_addr);
  return jsonb_build_object('ok', true);
end
$$;

-- "Doesn't apply" for one job: the owner, or the person the job is assigned
-- to. na_reason is the caller's own words, trimmed, or the default
-- "Marked ‘doesn’t apply’" when they gave none; the reason (if any) also
-- travels on the event's detail so History keeps it. Same visibility rule as
-- dpdp_assign_person: no membership in the job's org -> "Job not found".
create or replace function public.dpdp_mark_not_applicable(p_obligation_id text, p_reason text default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_identity text;
  v_label text;
  v_o dpdp.obligation;
  v_m dpdp.membership;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_name text;
begin
  v_identity := public.dpdp__caller_identity_id();
  select o.* into v_o from dpdp.obligation o where o.id = p_obligation_id;
  if v_identity is null or v_o.id is null then
    raise exception 'Job not found' using errcode = 'P0002';
  end if;
  v_m := public.dpdp__caller_membership(v_o.org_id);
  if v_m.id is null then
    raise exception 'Job not found' using errcode = 'P0002';
  end if;
  if v_o.assigned_person_id is distinct from v_identity and v_m.level <> 'owner' then
    raise exception 'Not your job' using errcode = '42501';
  end if;

  update dpdp.obligation
  set state = 'not_applicable', na_reason = coalesce(v_reason, 'Marked ‘doesn’t apply’')
  where id = v_o.id;

  select i.primary_email into v_label from dpdp.identity i where i.id = v_identity;
  select t.name into v_name from dpdp.obligation_template t where t.id = v_o.template_id;
  perform public.dpdp__append_event(v_o.org_id, v_identity, v_label, 'obligation_not_my_job', 'Marked "' || coalesce(v_name, 'a job') || '" as not applicable', v_reason);
  return jsonb_build_object('ok', true);
end
$$;

-- listOnePageHistory() as an RPC: the org's events, newest first, for the
-- History timeline. Member-only (any level -- the Next.js page shows it to
-- owner/coordinator/GO, and the staff branch simply never asks). p_limit is
-- clamped to [1, 50]; the UI only ever shows 15. occurredAt is the stored
-- UTC digits with a Z, i.e. the same string the chain hashed.
create or replace function public.dpdp_org_history(p_org_id text default null, p_limit int default 15)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_m dpdp.membership;
  v_limit int := greatest(least(coalesce(p_limit, 15), 50), 1);
  v_out jsonb;
begin
  v_m := public.dpdp__caller_membership(p_org_id);
  if v_m.id is null then
    raise exception 'Not a member of this organisation' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', e.id,
    'kind', e.kind,
    'summary', e.summary,
    'detail', e.detail,
    'actorLabel', e.actor_label,
    'occurredAt', to_char(e.occurred_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  ) order by e.occurred_at desc), '[]'::jsonb)
  into v_out
  from (
    select ev.*
    from dpdp.event ev
    where ev.org_id = v_m.org_id
    order by ev.occurred_at desc
    limit v_limit
  ) e;
  return v_out;
end
$$;

-- ---------------------------------------------------------------------
-- Grants: identical policy to 0604. Helpers are callable by nobody
-- directly; the five public functions by `authenticated` (the browser after
-- a magic link) and by app_runtime (the Next.js server's own role, so the
-- repo's DB-gated tests can exercise the real RPC path over the existing
-- test connection with set_config('request.jwt.claims', ...) standing in
-- for the JWT -- with no claims set every function above refuses, so this
-- adds no data exposure). dpdp__append_event's revoke is restated because
-- it was re-created above (CREATE OR REPLACE keeps privileges; restating is
-- belt and braces, not a change).
-- ---------------------------------------------------------------------
revoke all on function public.dpdp__append_event(text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.dpdp__find_or_create_identity(text) from public, anon, authenticated;
revoke all on function public.dpdp__find_or_create_membership(text, text) from public, anon, authenticated;

revoke all on function public.dpdp_areas_for_product(text) from public, anon;
revoke all on function public.dpdp_complete_owner_first_visit(text, jsonb) from public, anon;
revoke all on function public.dpdp_assign_person(text, text) from public, anon;
revoke all on function public.dpdp_mark_not_applicable(text, text) from public, anon;
revoke all on function public.dpdp_org_history(text, int) from public, anon;

grant execute on function public.dpdp_areas_for_product(text) to authenticated, app_runtime;
grant execute on function public.dpdp_complete_owner_first_visit(text, jsonb) to authenticated, app_runtime;
grant execute on function public.dpdp_assign_person(text, text) to authenticated, app_runtime;
grant execute on function public.dpdp_mark_not_applicable(text, text) to authenticated, app_runtime;
grant execute on function public.dpdp_org_history(text, int) to authenticated, app_runtime;
