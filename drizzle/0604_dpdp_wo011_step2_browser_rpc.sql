-- WO-DPDP-011 Step 2 (the go/no-go spike): the browser talks to Supabase
-- directly, but NEVER to a dpdp.* table. Every read and write goes through
-- one of these public-schema SECURITY DEFINER functions, which scope
-- everything by the signed-in email (auth.jwt() ->> 'email', Supabase Auth
-- magic link = WO-011 §2.2 option A) and are the only thing the anon key +
-- a user JWT can reach. Why RPC-only rather than RLS on the tables:
--   * PostgREST exposes only public/graphql_public/compliance here (verified
--     live: Accept-Profile: dpdp -> PGRST106), so dpdp.* is unreachable from
--     a browser regardless -- keeping it that way is deliberate.
--   * 17 dpdp tables have NO row-level security at all (identity, identity_
--     email, membership, session, login_token, obligation_template, ...),
--     safe today only because no browser role holds any grant on them.
--     Exposing the schema would turn that into a cross-tenant leak.
-- Additive only (WO-011 §6): new functions, no table changes, the existing
-- app_runtime GUC-based policies the Next.js app relies on are untouched,
-- so both apps coexist against the same rows.
--
-- Every write appends to dpdp.event with the SAME hash chain the TS side
-- computes (dpdp-event-service.ts computeDpdpEventHash / canonicalize):
-- sha256(prevHash || JSON.stringify(payload, sortedKeys)). That JSON has no
-- whitespace and a fixed key order; json_build_object would insert spaces
-- and jsonb would reorder keys, so the canonical string is assembled by
-- hand below. occurred_at is a naive timestamp holding UTC digits (what
-- drizzle writes for a JS Date) truncated to milliseconds, so the stored
-- row re-hashes to the same value from JS's toISOString() --
-- verifyDpdpEventChain() is the test.

-- ---------------------------------------------------------------------
-- Internal helpers -- not callable from the browser (revoked below).
-- ---------------------------------------------------------------------

create or replace function public.dpdp__caller_identity_id()
returns text
language sql stable security definer
set search_path = ''
as $$
  -- lower() on BOTH sides: the sign-up path stores emails lowercased, but
  -- older/hand-seeded identity_email rows may not be, and an email is
  -- case-insensitive either way. Found live: a mixed-case test row made
  -- the first smoke call refuse a real owner.
  select ie.identity_id
  from dpdp.identity_email ie
  where lower(ie.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  order by ie.is_primary desc
  limit 1
$$;

-- The caller's active membership: in p_org_id if given, else the most
-- recently created one (same "newest membership wins" default the
-- magic-link sign-in in dpdp-auth-service.ts already uses).
create or replace function public.dpdp__caller_membership(p_org_id text default null)
returns dpdp.membership
language sql stable security definer
set search_path = ''
as $$
  select m.*
  from dpdp.membership m
  where m.identity_id = public.dpdp__caller_identity_id()
    and m.state = 'active'
    and (p_org_id is null or m.org_id = p_org_id)
  order by m.created_at desc
  limit 1
$$;

create or replace function public.dpdp__append_event(
  p_org_id text, p_actor_identity_id text, p_actor_label text, p_kind text, p_summary text, p_detail text default null
)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_prev text;
  v_ts timestamp;
  v_canonical text;
  v_hash text;
begin
  select e.hash into v_prev
  from dpdp.event e
  where e.org_id = p_org_id
  order by e.occurred_at desc
  limit 1;

  v_ts := date_trunc('milliseconds', (clock_timestamp() at time zone 'UTC'));

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
-- Browser-callable surface (authenticated role only).
-- ---------------------------------------------------------------------

-- Mirrors getOnePageData() + home/page.tsx's viewer resolution, as one
-- jsonb: { org, viewer, rows }. rows[] is the view-model's ObligationRow
-- shape (camelCase, `due` as YYYY-MM-DD), sorted by template key -- the
-- same stable order the TS side had to add after a real row-reordering
-- bug (PR #1787).
create or replace function public.dpdp_my_page(p_org_id text default null)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_m dpdp.membership;
  v_identity text;
  v_email text;
  v_org dpdp.organisation;
  v_kind text;
  v_ca_sub text;
  v_rows jsonb;
begin
  v_identity := public.dpdp__caller_identity_id();
  if v_identity is null then
    raise exception 'Not a member of this organisation' using errcode = '42501';
  end if;
  v_m := public.dpdp__caller_membership(p_org_id);
  if v_m.id is null then
    raise exception 'Not a member of this organisation' using errcode = '42501';
  end if;
  select i.primary_email into v_email from dpdp.identity i where i.id = v_identity;
  select o.* into v_org from dpdp.organisation o where o.id = v_m.org_id;

  -- Role detection = the same "is a roleTag-tagged obligation assigned to
  -- this email" question detectRoleFromObligations() asks; owner wins.
  if v_m.level = 'owner' then
    v_kind := 'owner';
  else
    v_ca_sub := (
      select case
        when bool_or(t.role_tag = 'CAPARTNER') then 'partner'
        when bool_or(t.role_tag = 'CAMGR') then 'manager'
      end
      from dpdp.obligation o join dpdp.obligation_template t on t.id = o.template_id
      where o.org_id = v_m.org_id and o.assigned_person_id = v_identity and o.state <> 'not_applicable'
    );
    select case
      when bool_or(t.role_tag = 'Grievance Officer (responsible for DPDP policy)') then 'go'
      when bool_or(t.role_tag = 'DPDP coordinator') then 'coord'
      when v_ca_sub is not null then 'ca'
      else 'staff'
    end into v_kind
    from dpdp.obligation o join dpdp.obligation_template t on t.id = o.template_id
    where o.org_id = v_m.org_id and o.assigned_person_id = v_identity and o.state <> 'not_applicable';
    v_kind := coalesce(v_kind, 'staff');
  end if;

  select coalesce(jsonb_agg(to_jsonb(r) - 'template_key' order by r.template_key), '[]'::jsonb)
  into v_rows
  from (
    select
      t.key as template_key,
      o.id,
      t.part,
      t.name as what,
      t.data_set as "dataSet",
      to_jsonb(t.data_types) as "dataTypes",
      to_jsonb(t.law_codes) as "lawCodes",
      case
        when o.assigned_staff_group_id is not null then (select g.label from dpdp.staff_group g where g.id = o.assigned_staff_group_id)
        when o.assigned_person_id is not null then (select i.primary_email from dpdp.identity i where i.id = o.assigned_person_id)
      end as by,
      (o.assigned_staff_group_id is not null) as "isGroup",
      case when o.assigned_staff_group_id is not null then o.progress_done end as "groupDone",
      case when o.assigned_staff_group_id is not null then o.progress_total end as "groupTotal",
      case when o.assigned_staff_group_id is not null then exists (
        select 1 from dpdp.staff_group_member sgm where sgm.group_id = o.assigned_staff_group_id and sgm.membership_id = v_m.id
      ) end as "viewerIsGroupMember",
      case when o.assigned_staff_group_id is not null then (
        select a.answer::text from dpdp.obligation_group_answer a where a.obligation_id = o.id and a.membership_id = v_m.id
      ) end as "myGroupAnswer",
      to_char(o.due_on, 'YYYY-MM-DD') as due,
      (o.state in ('closed', 'submitted')) as yes,
      (o.state = 'not_applicable') as na,
      o.depends_on_obligation_id as "dependsOnObligationId",
      0 as sent
    from dpdp.obligation o
    join dpdp.obligation_template t on t.id = o.template_id
    where o.org_id = v_m.org_id
  ) r;

  return jsonb_build_object(
    'org', jsonb_build_object('id', v_org.id, 'name', v_org.name, 'product', coalesce(v_org.product, 'firm')),
    'viewer', jsonb_build_object(
      'email', v_email, 'kind', v_kind, 'caSub', v_ca_sub,
      'firstVisitSeenAt', v_m.first_visit_seen_at, 'saidNotMeAt', v_m.said_not_me_at, 'membershipId', v_m.id
    ),
    'rows', v_rows
  );
end
$$;

-- markObligationDone() as an RPC: the escalation-chain gate, then close +
-- log in one transaction. Ownership is enforced HERE (not just hidden in
-- the UI as the Next.js server action relies on): the job must be
-- assigned to the caller, or the caller must be the org's owner.
create or replace function public.dpdp_mark_done(p_obligation_id text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_identity text;
  v_email text;
  v_o dpdp.obligation;
  v_m dpdp.membership;
  v_dep_state text;
  v_name text;
begin
  v_identity := public.dpdp__caller_identity_id();
  select o.* into v_o from dpdp.obligation o where o.id = p_obligation_id;
  if v_identity is null or v_o.id is null then
    raise exception 'Job not found' using errcode = 'P0002';
  end if;
  v_m := public.dpdp__caller_membership(v_o.org_id);
  if v_m.id is null then
    raise exception 'Not a member of this organisation' using errcode = '42501';
  end if;
  if v_o.assigned_person_id is distinct from v_identity and v_m.level <> 'owner' then
    raise exception 'Not your job' using errcode = '42501';
  end if;
  if v_o.depends_on_obligation_id is not null then
    select d.state into v_dep_state from dpdp.obligation d where d.id = v_o.depends_on_obligation_id;
    if v_dep_state is not null and v_dep_state <> 'closed' then
      raise exception 'Waiting — the step before this one isn''t done yet' using errcode = 'P0001';
    end if;
  end if;

  update dpdp.obligation
  set state = 'closed', progress_done = progress_total, closed_at = (clock_timestamp() at time zone 'UTC'), closed_by = v_identity
  where id = v_o.id;

  select i.primary_email into v_email from dpdp.identity i where i.id = v_identity;
  select t.name into v_name from dpdp.obligation_template t where t.id = v_o.template_id;
  perform public.dpdp__append_event(v_o.org_id, v_identity, v_email, 'obligation_accepted', 'Said Yes to "' || coalesce(v_name, 'a job') || '"');
  return jsonb_build_object('ok', true);
end
$$;

-- acknowledgeRoleWelcome() / flagNotMe() as RPCs (PR #1794's semantics:
-- flagNotMe sets BOTH stamps so the welcome screen never loops).
create or replace function public.dpdp_acknowledge_welcome(p_org_id text default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_m dpdp.membership;
  v_email text;
begin
  v_m := public.dpdp__caller_membership(p_org_id);
  if v_m.id is null then
    raise exception 'Not a member of this organisation' using errcode = '42501';
  end if;
  update dpdp.membership set first_visit_seen_at = (clock_timestamp() at time zone 'UTC') where id = v_m.id;
  select i.primary_email into v_email from dpdp.identity i where i.id = v_m.identity_id;
  perform public.dpdp__append_event(v_m.org_id, v_m.identity_id, v_email, 'membership_first_visit_acknowledged', v_email || ' saw their DPDP jobs for the first time');
  return jsonb_build_object('ok', true);
end
$$;

create or replace function public.dpdp_flag_not_me(p_org_id text default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_m dpdp.membership;
  v_email text;
  v_now timestamp := (clock_timestamp() at time zone 'UTC');
begin
  v_m := public.dpdp__caller_membership(p_org_id);
  if v_m.id is null then
    raise exception 'Not a member of this organisation' using errcode = '42501';
  end if;
  update dpdp.membership set first_visit_seen_at = v_now, said_not_me_at = v_now where id = v_m.id;
  select i.primary_email into v_email from dpdp.identity i where i.id = v_m.identity_id;
  perform public.dpdp__append_event(v_m.org_id, v_m.identity_id, v_email, 'membership_said_not_me', v_email || ' said this isn''t them -- needs reassigning');
  return jsonb_build_object('ok', true);
end
$$;

-- ---------------------------------------------------------------------
-- Grants: the browser holds the anon key and, after a magic link, an
-- `authenticated` JWT. Only that role may call the four public functions;
-- nobody may call the helpers directly (the wrappers run as definer and
-- do not need a grant to reach them).
-- ---------------------------------------------------------------------
revoke all on function public.dpdp__caller_identity_id() from public, anon, authenticated;
revoke all on function public.dpdp__caller_membership(text) from public, anon, authenticated;
revoke all on function public.dpdp__append_event(text, text, text, text, text, text) from public, anon, authenticated;

revoke all on function public.dpdp_my_page(text) from public, anon;
revoke all on function public.dpdp_mark_done(text) from public, anon;
revoke all on function public.dpdp_acknowledge_welcome(text) from public, anon;
revoke all on function public.dpdp_flag_not_me(text) from public, anon;
grant execute on function public.dpdp_my_page(text) to authenticated;
grant execute on function public.dpdp_mark_done(text) to authenticated;
grant execute on function public.dpdp_acknowledge_welcome(text) to authenticated;
grant execute on function public.dpdp_flag_not_me(text) to authenticated;
-- app_runtime is the Next.js server's own role (DATABASE_URL), never a
-- browser role -- this lets the repo's DB-gated tests exercise the real
-- RPC path over the existing test connection (set_config('request.jwt.
-- claims', ...) stands in for the JWT). With no claims set, every function
-- above raises, so this adds no data exposure.
grant execute on function public.dpdp_my_page(text) to app_runtime;
grant execute on function public.dpdp_mark_done(text) to app_runtime;
grant execute on function public.dpdp_acknowledge_welcome(text) to app_runtime;
grant execute on function public.dpdp_flag_not_me(text) to app_runtime;
