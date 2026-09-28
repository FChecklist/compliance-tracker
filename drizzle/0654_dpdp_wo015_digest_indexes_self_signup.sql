-- WO-DPDP-015 (owner instruction 2026-09-28): fix the Monday digest timeout,
-- make the Monday run self-healing, and give a brand-new firm or school a
-- way to open its own organisation from the static app.
--
-- 1. WHY THE MONDAY DIGEST TIMED OUT (found live 2026-09-28: the 00:30 UTC
--    run answered HTTP 500 "dpdp_timer_build_monday_digests: canceling
--    statement due to statement timeout"; pg_cron still logged "succeeded"
--    because it only queues the HTTP call). dpdp.obligation had ONLY its
--    primary-key index, dpdp.membership none on org_id, so
--    dpdp.build_monday_digests scanned every obligation for every
--    membership: 588 ms cold for ONE organisation with 31 jobs, and the
--    all-organisation call ran past the API role's 8 s statement limit.
--    Fix: the missing indexes (below) plus per-organisation batching in the
--    Edge Function (dpdp-monday-email), which is why dpdp_timer_org_ids
--    exists.
-- 2. SELF-HEALING. Every timer invocation now writes one dpdp.timer_run row
--    (start, then finish with the counts and ok/partial). pg_cron job
--    dpdp-monday-retry re-invokes the Monday run at 01:30, 03:30 and 06:30
--    UTC on Mondays ONLY when no complete, ok run exists for this ISO week
--    (dpdp_timer_monday_done). Re-running is safe: a digest is unique per
--    (membership, kind, week) and an already-sent one is skipped.
-- 3. dpdp_create_my_org: the landing pages' "Start free" had nowhere to go
--    on the static host (it pointed at the Next.js login, which the owner has
--    moved off Vercel). A signed-in visitor with no organisation opens their
--    own -- name + 'firm' or 'institution' -- and becomes its owner, exactly
--    as the Next.js signup (createDpdpOrganisation) did: owner membership
--    (joined_via 'created', can_sign granted by a separate update), the
--    organisation_created event, the library's jobs opened. Idempotent for a
--    double click (same caller, same name and product within 10 minutes
--    returns the same organisation) and capped at 5 organisations per
--    caller per day.
--
-- Nothing here changes an existing function's behaviour or any existing row.

-- ---------------------------------------------------------------------
-- 1. The missing indexes.
-- ---------------------------------------------------------------------
create index if not exists dpdp_obligation_org_id_idx on dpdp.obligation (org_id);
create index if not exists dpdp_obligation_assigned_person_idx on dpdp.obligation (assigned_person_id) where assigned_person_id is not null;
create index if not exists dpdp_obligation_assigned_group_idx on dpdp.obligation (assigned_staff_group_id) where assigned_staff_group_id is not null;
create index if not exists dpdp_obligation_depends_on_idx on dpdp.obligation (depends_on_obligation_id) where depends_on_obligation_id is not null;
create index if not exists dpdp_obligation_template_idx on dpdp.obligation (template_id);
create index if not exists dpdp_membership_org_state_idx on dpdp.membership (org_id, state);

-- ---------------------------------------------------------------------
-- 2. The timer's run log. No policies: RLS on with nothing granted means
--    only service_role (which bypasses RLS) can touch it.
-- ---------------------------------------------------------------------
create table if not exists dpdp.timer_run (
  id text primary key default replace(gen_random_uuid()::text, '-', ''),
  job text not null check (job in ('monday', 'legal_clocks')),
  week_key text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  ok boolean not null default false,
  partial boolean not null default false,
  orgs integer not null default 0,
  digests integer not null default 0,
  sent integer not null default 0,
  dry_run integer not null default 0,
  failed integer not null default 0,
  skipped integer not null default 0,
  error text
);
create index if not exists dpdp_timer_run_job_week_idx on dpdp.timer_run (job, week_key, ok);
alter table dpdp.timer_run enable row level security;
revoke all on dpdp.timer_run from public, anon, authenticated;
grant select, insert, update on dpdp.timer_run to service_role;

-- Organisations that have at least one active member: the Edge Function
-- builds and delivers one organisation at a time so no single call can run
-- past the API statement limit and one bad organisation cannot stop the rest.
create or replace function public.dpdp_timer_org_ids(p_now timestamptz default now())
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(o.id order by o.id), '[]'::jsonb)
  from dpdp.organisation o
  where exists (select 1 from dpdp.membership m where m.org_id = o.id and m.state = 'active')
$$;

create or replace function public.dpdp_timer_start_run(p_job text, p_now timestamptz default now())
returns text
language plpgsql security definer
set search_path = ''
as $$
declare
  v_id text;
begin
  if p_job not in ('monday', 'legal_clocks') then
    raise exception 'unknown job %', p_job using errcode = '22023';
  end if;
  insert into dpdp.timer_run (job, week_key, started_at) values (p_job, dpdp.monday_week_key(p_now), now()) returning id into v_id;
  return v_id;
end
$$;

create or replace function public.dpdp_timer_finish_run(
  p_id text, p_ok boolean, p_partial boolean, p_orgs integer, p_digests integer, p_sent integer,
  p_dry_run integer, p_failed integer, p_skipped integer, p_error text default null
)
returns void
language sql security definer
set search_path = ''
as $$
  update dpdp.timer_run
  set finished_at = now(), ok = coalesce(p_ok, false), partial = coalesce(p_partial, false),
      orgs = coalesce(p_orgs, 0), digests = coalesce(p_digests, 0), sent = coalesce(p_sent, 0),
      dry_run = coalesce(p_dry_run, 0), failed = coalesce(p_failed, 0), skipped = coalesce(p_skipped, 0),
      error = left(p_error, 2000)
  where id = p_id
$$;

-- True when a COMPLETE, ok Monday run exists for the ISO week of p_now.
create or replace function public.dpdp_timer_monday_done(p_now timestamptz default now())
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from dpdp.timer_run r
    where r.job = 'monday' and r.week_key = dpdp.monday_week_key(p_now) and r.ok and not r.partial
  )
$$;

revoke all on function public.dpdp_timer_org_ids(timestamptz) from public, anon, authenticated;
revoke all on function public.dpdp_timer_start_run(text, timestamptz) from public, anon, authenticated;
revoke all on function public.dpdp_timer_finish_run(text, boolean, boolean, integer, integer, integer, integer, integer, integer, text) from public, anon, authenticated;
revoke all on function public.dpdp_timer_monday_done(timestamptz) from public, anon, authenticated;
grant execute on function public.dpdp_timer_org_ids(timestamptz) to service_role, app_runtime;
grant execute on function public.dpdp_timer_start_run(text, timestamptz) to service_role;
grant execute on function public.dpdp_timer_finish_run(text, boolean, boolean, integer, integer, integer, integer, integer, integer, text) to service_role;
grant execute on function public.dpdp_timer_monday_done(timestamptz) to service_role;

-- ---------------------------------------------------------------------
-- 3. The retry job. Same request as dpdp-monday-digest (jobid 1), only when
--    this week's run is not complete. cron.schedule upserts by name.
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') and exists (select 1 from pg_extension where extname = 'pg_net') then
    perform cron.schedule(
      'dpdp-monday-retry',
      '30 1,3,6 * * 1',
      $cron$
        select case when public.dpdp_timer_monday_done(now()) then null::bigint else net.http_post(
          url := (select decrypted_secret from vault.decrypted_secrets where name = 'dpdp_timer_url'),
          headers := jsonb_build_object(
            'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'dpdp_timer_secret'),
            'Content-Type', 'application/json'
          ),
          body := '{"job":"monday"}'::jsonb,
          timeout_milliseconds := 300000
        ) end
      $cron$
    );
  end if;
end
$$;

-- ---------------------------------------------------------------------
-- 4. A visitor opens their own organisation.
-- ---------------------------------------------------------------------
create or replace function public.dpdp_create_my_org(p_name text, p_product text)
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

  return jsonb_build_object('ok', true, 'orgId', v_org_id, 'slug', v_slug, 'membershipId', v_membership_id, 'jobs', v_jobs, 'existing', false);
end
$$;

revoke all on function public.dpdp_create_my_org(text, text) from public, anon;
-- app_runtime too: the repo's DB-gated tests (dpdp-editions-roles.test.ts) call it over the test connection,
-- the same reasoning 0604/0606/0610 gave for their own app_runtime grants.
grant execute on function public.dpdp_create_my_org(text, text) to authenticated, service_role, app_runtime;

-- ---------------------------------------------------------------------
-- 5. Staff are shown only what is theirs (found by dpdp-editions-roles.test.ts,
--    2026-09-28). dpdp_my_page returned EVERY job in the organisation, with
--    every assignee's email, to every member -- plain staff included. The
--    one-page screen hid the rest client-side (view-model.ts mineFor) and the
--    AI link already applies the rule in SQL, but a staff member calling the
--    RPC directly with their own sign-in read colleagues' email addresses --
--    in a product whose job is protecting personal data. Now: owner,
--    Grievance Officer, coordinator and CA run the file and still see all of
--    it (unchanged); staff see their own jobs, the group jobs they belong to
--    and -- so "waiting for someone" and the blocked-by chain still work --
--    the job one of their own depends on, its assignee shown as 'a colleague'.
--    Everything else is 0606's dpdp_my_page verbatim (same columns, same
--    order, the real `sent` count). dpdp__rows_for_membership (the AI link's
--    row builder, pinned "verbatim" by dpdp-ai-link-rpc.test.ts) is NOT
--    touched: the AI link applies its own visibility downstream.
-- ---------------------------------------------------------------------
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
        when o.assigned_person_id is not null and v_kind = 'staff' and o.assigned_person_id <> v_identity then 'a colleague'
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
      (
        select count(*)::int from dpdp.email_send es
        where es.status = 'sent' and es.obligation_ids @> array[o.id]
      ) as sent
    from dpdp.obligation o
    join dpdp.obligation_template t on t.id = o.template_id
    where o.org_id = v_m.org_id
      and (
        v_kind <> 'staff'
        or o.assigned_person_id = v_identity
        or (o.assigned_staff_group_id is not null and exists (
          select 1 from dpdp.staff_group_member sgm where sgm.group_id = o.assigned_staff_group_id and sgm.membership_id = v_m.id))
        or exists (
          select 1 from dpdp.obligation mine
          where mine.org_id = o.org_id and mine.depends_on_obligation_id = o.id
            and (mine.assigned_person_id = v_identity or (mine.assigned_staff_group_id is not null and exists (
              select 1 from dpdp.staff_group_member sgm2 where sgm2.group_id = mine.assigned_staff_group_id and sgm2.membership_id = v_m.id)))
        )
      )
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
