-- WO-DPDP-011 Step 4: everything that must run while every browser is
-- closed now runs on a timer INSIDE Supabase (pg_cron -> pg_net -> the
-- dpdp-monday-email Edge Function -> the SECURITY DEFINER functions below).
-- Vercel is not in the path. Additive only (WO-011 §6): three new tables,
-- new functions, one existing function (public.dpdp_my_page) re-issued with
-- the SAME signature and a real `sent` count in place of the hard-coded 0.
-- No existing table or column is changed.
--
-- WHAT LIVES WHERE, AND WHY
--   * dpdp.*            the real logic. Not reachable from PostgREST at all
--                       (only public/graphql_public/compliance are exposed --
--                       verified live in 0604's own header), so nothing here
--                       is callable from a browser by accident.
--   * public.dpdp_timer_* thin wrappers the Edge Function calls through the
--                       service-role client (PostgREST can only see public).
--                       EXECUTE granted to service_role ONLY.
--   * public.dpdp_apply_email_action / dpdp_preview_email_action /
--     dpdp_unsubscribe  the two static pages' entry points (WO-011 §2.3 one-
--                       click confirmation page, and the unsubscribe page).
--                       Callable with the anon key -- the opaque token IS the
--                       credential, exactly as /api/dpdp/task-link/[token]
--                       worked, and every refusal path is logged.
--   * public.dpdp_my_page the browser RPC from 0604, verbatim, except `sent`.
--
-- ESCALATION (WO-011 §2.5), computed here and only here so the email, the
-- page and the tests all read the same decision:
--   late (days_late > 0)                       -> red, top of the list
--   late >= 14 days (7 if required today)      -> coordinator copied
--   late >= 30 days (15 if required today)     -> owner told by name
--   "I cannot" (state = 'stuck', or any 'cannot' group answer) -> coordinator
--   outside party (template.answerable_by = 'processor') late -> the owner,
--     who holds the relationship
--   "required today" mirrors view-model.ts's isToday(): any law code whose
--     first letter is 's' (SPDI) or 'a' (Aadhaar Act) is in force today.
-- "Copied"/"told" is delivered as a section in the coordinator's/owner's OWN
-- Monday email, never as a literal CC: every Monday email carries that
-- person's sign-in link and one-click tokens, and §0 limit 2 says a person's
-- browser only ever works on their own data -- a CC would hand one person
-- another person's credentials.
--
-- ONE EMAIL PER MEMBERSHIP, never per identity: dpdp.digest_send (WO-007
-- 4.2) capped sends per identity; WO-011 §2.5 reverses that on purpose. A
-- person with two memberships gets two emails, each with only that
-- organisation's jobs.
--
-- Every write appends to dpdp.event through public.dpdp__append_event
-- (0604) -- the SAME hash chain the TS side verifies (verifyDpdpEventChain).

-- ---------------------------------------------------------------------
-- 0. pg_net (outbound HTTP from pg_cron). pg_cron itself is already
--    installed (1.6.4, zero jobs before this migration).
-- ---------------------------------------------------------------------
create extension if not exists pg_net with schema extensions;

-- ---------------------------------------------------------------------
-- 1. Tables -- service_role only. No grant to anon, authenticated or
--    app_runtime: every read/write goes through a definer function.
-- ---------------------------------------------------------------------
create table if not exists dpdp.email_send (
  id text primary key default replace(gen_random_uuid()::text, '-', ''),
  org_id text not null,
  membership_id text not null,
  identity_id text not null,
  obligation_ids text[] not null default '{}'::text[],
  kind text not null check (kind in ('monday_digest', 'escalation', 'leak_clock', 'rights_clock', 'statutory')),
  -- Idempotency key: 'IYYY-Wnn' (IST) for the Monday email, '<clock>:<id>:<day>'
  -- for a legal-clock notice. One row per (membership, kind, period_key)
  -- that did not fail -- a re-run cannot double-send.
  period_key text,
  to_email text not null,
  subject text,
  -- dry_run only: exactly what would have gone out, with the sign-in link
  -- and one-click tokens left as placeholders (never a real credential).
  body_text text,
  resend_message_id text,
  status text not null default 'queued' check (status in ('queued', 'sent', 'dry_run', 'failed')),
  error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  list_unsubscribe_token_hash text
);
create unique index if not exists dpdp_email_send_membership_kind_period_key
  on dpdp.email_send (membership_id, kind, period_key)
  where period_key is not null and status <> 'failed';
create index if not exists dpdp_email_send_obligation_ids_idx on dpdp.email_send using gin (obligation_ids);
create index if not exists dpdp_email_send_org_id_idx on dpdp.email_send (org_id);
create unique index if not exists dpdp_email_send_unsubscribe_hash_key
  on dpdp.email_send (list_unsubscribe_token_hash) where list_unsubscribe_token_hash is not null;

create table if not exists dpdp.email_preference (
  membership_id text primary key,
  unsubscribed_at timestamptz,
  statutory_only boolean not null default false,
  updated_at timestamptz not null default now()
);

-- One-click tokens for the Monday email's buttons. dpdp.email_token (WO-005)
-- is bound to dpdp.task (task_id NOT NULL + the 0427 trigger); the one-page
-- product acts on dpdp.obligation directly, so this is its own table rather
-- than a nullable-task_id change to the old one. Same shape otherwise:
-- opaque token, sha256 hash stored, single use, expiry, membership-bound.
create table if not exists dpdp.email_action_token (
  id text primary key default replace(gen_random_uuid()::text, '-', ''),
  obligation_id text not null,
  membership_id text not null,
  identity_id text not null,
  action text not null check (action in ('done', 'cannot', 'never_had_any')),
  token_hash text not null unique,
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  email_send_id text
);
create index if not exists dpdp_email_action_token_obligation_idx on dpdp.email_action_token (obligation_id);

alter table dpdp.email_send enable row level security;
alter table dpdp.email_preference enable row level security;
alter table dpdp.email_action_token enable row level security;

do $$
declare t text;
begin
  for t in select unnest(array['email_send', 'email_preference', 'email_action_token'])
  loop
    begin
      execute format('create policy service_role_bypass on dpdp.%I for all to service_role using (true) with check (true)', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

grant select, insert, update, delete on dpdp.email_send, dpdp.email_preference, dpdp.email_action_token to service_role;

-- ---------------------------------------------------------------------
-- 2. Internal helpers (definer-only; revoked from every browser role).
-- ---------------------------------------------------------------------

-- sha256 hex of the raw token -- byte-for-byte what dpdp-task-service.ts's
-- hashToken() computes, so a token minted here and a token minted there
-- are checked the same way.
create or replace function dpdp.email_token_hash(p_raw text)
returns text
language sql immutable
set search_path = ''
as $$
  select encode(sha256(convert_to(coalesce(p_raw, ''), 'UTF8')), 'hex')
$$;

-- 64 hex chars from two v4 UUIDs (244 random bits). pg_catalog only -- no
-- pgcrypto dependency for something gen_random_uuid() already gives.
create or replace function dpdp.new_opaque_token()
returns text
language sql volatile
set search_path = ''
as $$
  select replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
$$;

-- view-model.ts isToday(): any code starting 's' (SPDI Rules 2011) or 'a'
-- (Aadhaar Act) is law in force today, unlike 'd' (DPDP, 13 May 2027).
create or replace function dpdp.required_today(p_law_codes text[])
returns boolean
language sql immutable
set search_path = ''
as $$
  select exists (
    select 1 from unnest(coalesce(p_law_codes, '{}'::text[])) c where left(c, 1) in ('s', 'a')
  )
$$;

-- The Monday email's idempotency key: ISO year-week of the IST date.
create or replace function dpdp.monday_week_key(p_now timestamptz)
returns text
language sql stable
set search_path = ''
as $$
  select to_char(p_now at time zone 'Asia/Kolkata', 'IYYY-"W"IW')
$$;

-- Who gets a statutory notice for an org: every active owner, plus whoever
-- holds a 'DPDP coordinator' job (the same role_tag question
-- detectRoleFromObligations() asks). Distinct by membership.
create or replace function dpdp.org_notice_recipients(p_org_id text)
returns jsonb
language sql stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'membershipId', r.membership_id, 'identityId', r.identity_id, 'email', r.email, 'role', r.role
    ) order by r.role, r.email), '[]'::jsonb)
  from (
    select m.id as membership_id, m.identity_id, i.primary_email as email, 'owner' as role
    from dpdp.membership m join dpdp.identity i on i.id = m.identity_id
    where m.org_id = p_org_id and m.level = 'owner' and m.state = 'active'
    union
    select m.id, m.identity_id, i.primary_email, 'coordinator'
    from dpdp.membership m join dpdp.identity i on i.id = m.identity_id
    where m.org_id = p_org_id and m.state = 'active' and m.level <> 'owner' and exists (
      select 1 from dpdp.obligation ob join dpdp.obligation_template t on t.id = ob.template_id
      where ob.org_id = p_org_id and ob.assigned_person_id = m.identity_id
        and t.role_tag = 'DPDP coordinator' and ob.state <> 'not_applicable'
    )
  ) r
$$;

-- ---------------------------------------------------------------------
-- 3. public.dpdp_my_page -- 0604 verbatim except `sent`, which now counts
--    the emails actually sent (status = 'sent'; a dry run is not an email)
--    whose obligation_ids contain this job.
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
      (
        select count(*)::int from dpdp.email_send es
        where es.status = 'sent' and es.obligation_ids @> array[o.id]
      ) as sent
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

-- ---------------------------------------------------------------------
-- 4. dpdp.build_monday_digests -- one entry PER ACTIVE MEMBERSHIP. Only
--    that membership's own jobs (assigned to its identity, or to a staff
--    group it belongs to; an owner additionally sees every open job in
--    the org, flagged isMine=false), skipping not_applicable/closed/
--    submitted jobs, jobs still blocked by the escalation chain ("this
--    obligation gets no email until the one it points to is closed" --
--    schema.ts on depends_on_obligation_id), and group jobs this member
--    has already answered. p_org_id narrows to one org (tests, manual
--    re-runs); p_now is injectable so a test can move the calendar.
-- ---------------------------------------------------------------------
create or replace function dpdp.build_monday_digests(p_now timestamptz default now(), p_org_id text default null)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_today date := (p_now at time zone 'Asia/Kolkata')::date;
  v_week text := dpdp.monday_week_key(p_now);
  v_out jsonb;
begin
  with jobs as (
    select
      ob.id, ob.org_id, ob.assigned_person_id, ob.assigned_staff_group_id, ob.due_on, ob.state,
      t.key, t.name, t.part,
      (t.answerable_by = 'processor') as outside_party,
      dpdp.required_today(t.law_codes) as required_today,
      greatest(0, v_today - ob.due_on) as days_late,
      (ob.state = 'stuck' or exists (
        select 1 from dpdp.obligation_group_answer ga where ga.obligation_id = ob.id and ga.answer = 'cannot'
      )) as stuck,
      (select i.primary_email from dpdp.identity i where i.id = ob.assigned_person_id) as assignee_email,
      (select g.label from dpdp.staff_group g where g.id = ob.assigned_staff_group_id) as group_label
    from dpdp.obligation ob
    join dpdp.obligation_template t on t.id = ob.template_id
    where ob.state not in ('not_applicable', 'closed', 'submitted')
      and (p_org_id is null or ob.org_id = p_org_id)
      and not exists (
        select 1 from dpdp.obligation d
        where d.id = ob.depends_on_obligation_id and d.state not in ('closed', 'submitted', 'not_applicable')
      )
  ),
  scored as (
    select j.*,
      (j.days_late > 0) as late,
      case when j.required_today then 7 else 14 end as cc_threshold,
      case when j.required_today then 15 else 30 end as owner_threshold
    from jobs j
  ),
  flagged as (
    select s.*,
      ((s.late and s.days_late >= s.cc_threshold) or s.stuck) as cc_coordinator,
      (s.late and s.days_late >= s.owner_threshold) as owner_named,
      s.stuck as coordinator_now,
      (s.outside_party and s.late) as relationship_owner
    from scored s
  ),
  org_contacts as (
    select o.id as org_id,
      coalesce((
        select jsonb_agg(jsonb_build_object('membershipId', m.id, 'email', i.primary_email) order by m.created_at)
        from dpdp.membership m join dpdp.identity i on i.id = m.identity_id
        where m.org_id = o.id and m.level = 'owner' and m.state = 'active'
      ), '[]'::jsonb) as owners,
      coalesce((
        select jsonb_agg(jsonb_build_object('membershipId', m.id, 'email', i.primary_email) order by m.created_at)
        from dpdp.membership m join dpdp.identity i on i.id = m.identity_id
        where m.org_id = o.id and m.state = 'active' and exists (
          select 1 from dpdp.obligation ob join dpdp.obligation_template t on t.id = ob.template_id
          where ob.org_id = o.id and ob.assigned_person_id = m.identity_id
            and t.role_tag = 'DPDP coordinator' and ob.state <> 'not_applicable'
        )
      ), '[]'::jsonb) as coordinators
    from dpdp.organisation o
    where p_org_id is null or o.id = p_org_id
  )
  select coalesce(jsonb_agg(to_jsonb(d) order by d."orgId", d."membershipId"), '[]'::jsonb)
  into v_out
  from (
    select
      m.id as "membershipId",
      m.identity_id as "identityId",
      m.org_id as "orgId",
      org.name as "orgName",
      coalesce(org.product, 'firm') as "orgProduct",
      i.primary_email as email,
      m.level,
      case when m.level = 'owner' then 'owner' when rc.is_coord then 'coord' else 'staff' end as "roleKind",
      v_week as "weekKey",
      to_char(v_today, 'YYYY-MM-DD') as today,
      (ep.unsubscribed_at is not null) as unsubscribed,
      (ep.unsubscribed_at is not null or coalesce(ep.statutory_only, false)) as "statutoryOnly",
      exists (
        select 1 from dpdp.email_send es
        where es.membership_id = m.id and es.kind in ('monday_digest', 'statutory')
          and es.period_key = v_week and es.status <> 'failed'
      ) as "alreadySentThisWeek",
      c.owners,
      c.coordinators,
      (
        select coalesce(jsonb_agg(jsonb_build_object(
            'obligationId', f.id,
            'key', f.key,
            'what', f.name,
            'part', f.part,
            'dueOn', to_char(f.due_on, 'YYYY-MM-DD'),
            'daysLate', f.days_late,
            'late', f.late,
            'requiredToday', f.required_today,
            'isGroup', (f.assigned_staff_group_id is not null),
            'groupLabel', f.group_label,
            'assigneeEmail', f.assignee_email,
            'isMine', (coalesce(f.assigned_person_id = m.identity_id, false) or coalesce(f.assigned_staff_group_id = any(mg.ids), false)),
            'stuck', f.stuck,
            'outsideParty', f.outside_party,
            'escalation', jsonb_build_object(
              'red', f.late,
              'ccCoordinator', f.cc_coordinator,
              'ownerNamed', f.owner_named,
              'coordinatorNow', f.coordinator_now,
              'relationshipOwner', f.relationship_owner,
              'ccThresholdDays', f.cc_threshold,
              'ownerThresholdDays', f.owner_threshold
            )
          ) order by f.days_late desc, f.due_on asc, f.key asc), '[]'::jsonb)
        from flagged f
        where f.org_id = m.org_id
          and (
            m.level = 'owner'
            or f.assigned_person_id = m.identity_id
            or f.assigned_staff_group_id = any(mg.ids)
          )
          and not (
            coalesce(f.assigned_staff_group_id = any(mg.ids), false)
            and exists (select 1 from dpdp.obligation_group_answer ga where ga.obligation_id = f.id and ga.membership_id = m.id)
          )
      ) as jobs,
      (
        select coalesce(jsonb_agg(jsonb_build_object(
            'obligationId', f.id,
            'what', f.name,
            'assigneeEmail', coalesce(f.assignee_email, f.group_label),
            'daysLate', f.days_late,
            'requiredToday', f.required_today,
            'stuck', f.stuck,
            'outsideParty', f.outside_party,
            'reason', case
              when rc.is_coord and f.coordinator_now then 'stuck'
              when m.level = 'owner' and f.owner_named then 'late_owner'
              when m.level = 'owner' and f.relationship_owner then 'outside_party_silent'
              when rc.is_coord and f.cc_coordinator then 'late_coordinator'
            end
          ) order by f.days_late desc, f.key asc), '[]'::jsonb)
        from flagged f
        where f.org_id = m.org_id
          and f.assigned_person_id is distinct from m.identity_id
          and (
            (m.level = 'owner' and (f.owner_named or f.relationship_owner))
            or (rc.is_coord and (f.cc_coordinator or f.coordinator_now))
          )
      ) as "escalatedToMe"
    from dpdp.membership m
    join dpdp.identity i on i.id = m.identity_id
    join dpdp.organisation org on org.id = m.org_id
    join org_contacts c on c.org_id = m.org_id
    left join dpdp.email_preference ep on ep.membership_id = m.id
    cross join lateral (
      select coalesce(array_agg(sgm.group_id), '{}'::text[]) as ids
      from dpdp.staff_group_member sgm where sgm.membership_id = m.id
    ) mg
    cross join lateral (
      select exists (
        select 1 from dpdp.obligation ob join dpdp.obligation_template t on t.id = ob.template_id
        where ob.org_id = m.org_id and ob.assigned_person_id = m.identity_id
          and t.role_tag = 'DPDP coordinator' and ob.state <> 'not_applicable'
      ) as is_coord
    ) rc
    where m.state = 'active'
      and m.said_not_me_at is null
      and (p_org_id is null or m.org_id = p_org_id)
  ) d;
  return v_out;
end
$$;

-- ---------------------------------------------------------------------
-- 5. dpdp.legal_clocks -- the only two things that break the weekly
--    rhythm (WO-011 §2.5): a data leak on its 72-hour clock (dpdp.breach:
--    deadline_at = became_aware_at + 72h, set by the service layer) and a
--    rights request within 10 days of its 90-day limit (dpdp.rights_
--    request.due_at). Both tables exist; nothing is invented. Recipients:
--    owners + coordinator. periodKey is per IST day, so an open clock is
--    reminded once a day until it is answered.
-- ---------------------------------------------------------------------
create or replace function dpdp.legal_clocks(p_now timestamptz default now(), p_org_id text default null)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_day text := to_char(p_now at time zone 'Asia/Kolkata', 'YYYY-MM-DD');
  v_utc timestamp := (p_now at time zone 'UTC');
  v_leaks jsonb;
  v_rights jsonb;
begin
  select coalesce(jsonb_agg(to_jsonb(x) order by x."deadlineAt"), '[]'::jsonb) into v_leaks
  from (
    select
      b.id as "breachId",
      b.org_id as "orgId",
      o.name as "orgName",
      to_char(b.became_aware_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as "becameAwareAt",
      to_char(b.deadline_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as "deadlineAt",
      round((extract(epoch from (b.deadline_at - v_utc)) / 3600.0)::numeric, 1) as "hoursLeft",
      (b.board_notified_at is not null) as "boardNotified",
      (b.individuals_notified_at is not null) as "individualsNotified",
      b.scope_person_count as "scopePersonCount",
      ('leak:' || b.id || ':' || v_day) as "periodKey",
      dpdp.org_notice_recipients(b.org_id) as recipients
    from dpdp.breach b
    join dpdp.organisation o on o.id = b.org_id
    where b.state <> 'closed'
      and (b.board_notified_at is null or b.individuals_notified_at is null)
      and (p_org_id is null or b.org_id = p_org_id)
  ) x;

  select coalesce(jsonb_agg(to_jsonb(x) order by x."dueAt"), '[]'::jsonb) into v_rights
  from (
    select
      r.id as "requestId",
      r.ref,
      r.kind,
      r.org_id as "orgId",
      o.name as "orgName",
      to_char(r.received_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as "receivedAt",
      to_char(r.due_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as "dueAt",
      floor(extract(epoch from (r.due_at - v_utc)) / 86400.0)::int as "daysLeft",
      ('rights:' || r.id || ':' || v_day) as "periodKey",
      dpdp.org_notice_recipients(r.org_id) as recipients
    from dpdp.rights_request r
    join dpdp.organisation o on o.id = r.org_id
    where r.answered_at is null
      and r.state <> 'closed'
      and r.due_at <= v_utc + interval '10 days'
      and (p_org_id is null or r.org_id = p_org_id)
  ) x;

  return jsonb_build_object('day', v_day, 'leaks', v_leaks, 'rights', v_rights);
end
$$;

-- ---------------------------------------------------------------------
-- 6. The send log. record -> (send) -> mark. record mints the unsubscribe
--    token and returns it raw exactly once (only its hash is stored);
--    a duplicate (membership, kind, period_key) returns {duplicate:true}
--    instead of a second row, which is what makes a re-run safe.
-- ---------------------------------------------------------------------
create or replace function dpdp.record_email_send(
  p_org_id text,
  p_membership_id text,
  p_identity_id text,
  p_obligation_ids text[],
  p_kind text,
  p_period_key text,
  p_to_email text,
  p_subject text,
  p_status text default 'queued',
  p_body_text text default null
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_id text := replace(gen_random_uuid()::text, '-', '');
  v_raw text := dpdp.new_opaque_token();
begin
  if p_kind not in ('monday_digest', 'escalation', 'leak_clock', 'rights_clock', 'statutory') then
    raise exception 'Unknown email kind %', p_kind using errcode = '22023';
  end if;
  if p_status not in ('queued', 'dry_run') then
    raise exception 'record_email_send accepts status queued or dry_run, not %', p_status using errcode = '22023';
  end if;
  begin
    insert into dpdp.email_send (
      id, org_id, membership_id, identity_id, obligation_ids, kind, period_key, to_email, subject, body_text, status, list_unsubscribe_token_hash
    ) values (
      v_id, p_org_id, p_membership_id, p_identity_id, coalesce(p_obligation_ids, '{}'::text[]), p_kind, p_period_key, p_to_email, p_subject,
      case when p_status = 'dry_run' then p_body_text end, p_status, dpdp.email_token_hash(v_raw)
    );
  exception when unique_violation then
    return jsonb_build_object('id', null, 'duplicate', true);
  end;
  return jsonb_build_object('id', v_id, 'unsubscribeToken', v_raw, 'duplicate', false);
end
$$;

create or replace function dpdp.mark_email_send_result(
  p_id text,
  p_status text,
  p_resend_message_id text default null,
  p_error text default null
)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if p_status not in ('queued', 'sent', 'dry_run', 'failed') then
    raise exception 'Unknown email status %', p_status using errcode = '22023';
  end if;
  update dpdp.email_send
  set status = p_status,
      resend_message_id = coalesce(p_resend_message_id, resend_message_id),
      error = p_error,
      sent_at = case when p_status = 'sent' then now() else sent_at end
  where id = p_id;
  if not found then
    raise exception 'email_send % not found', p_id using errcode = 'P0002';
  end if;
end
$$;

-- ---------------------------------------------------------------------
-- 7. One-click tokens (WO-011 §2.3). Minted server-side right before a
--    real send, never in a dry run. Binding is enforced at mint time AND
--    at apply time: the membership must be active, the job must be in
--    that membership's org, and (unless the member is the owner) the job
--    must be theirs -- the same rule dpdp_mark_done applies.
-- ---------------------------------------------------------------------
create or replace function dpdp.issue_email_action_tokens(
  p_membership_id text,
  p_obligation_ids text[],
  p_ttl interval default interval '7 days',
  p_email_send_id text default null
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_m dpdp.membership;
  v_ob dpdp.obligation;
  v_id text;
  v_done text;
  v_cannot text;
  v_never text;
  v_exp timestamptz := now() + p_ttl;
  v_out jsonb := '[]'::jsonb;
  v_in_group boolean;
begin
  select m.* into v_m from dpdp.membership m where m.id = p_membership_id and m.state = 'active';
  if v_m.id is null then
    raise exception 'Membership % is not active', p_membership_id using errcode = 'P0002';
  end if;
  foreach v_id in array coalesce(p_obligation_ids, '{}'::text[]) loop
    select o.* into v_ob from dpdp.obligation o where o.id = v_id;
    if v_ob.id is null or v_ob.org_id <> v_m.org_id then
      raise exception 'Job % does not belong to membership %''s organisation', v_id, p_membership_id using errcode = '42501';
    end if;
    v_in_group := v_ob.assigned_staff_group_id is not null and exists (
      select 1 from dpdp.staff_group_member sgm where sgm.group_id = v_ob.assigned_staff_group_id and sgm.membership_id = v_m.id
    );
    if v_m.level <> 'owner' and v_ob.assigned_person_id is distinct from v_m.identity_id and not v_in_group then
      raise exception 'Not your job' using errcode = '42501';
    end if;
    v_done := dpdp.new_opaque_token();
    v_cannot := dpdp.new_opaque_token();
    insert into dpdp.email_action_token (obligation_id, membership_id, identity_id, action, token_hash, expires_at, email_send_id)
    values
      (v_ob.id, v_m.id, v_m.identity_id, 'done', dpdp.email_token_hash(v_done), v_exp, p_email_send_id),
      (v_ob.id, v_m.id, v_m.identity_id, 'cannot', dpdp.email_token_hash(v_cannot), v_exp, p_email_send_id);
    if v_ob.assigned_staff_group_id is not null then
      v_never := dpdp.new_opaque_token();
      insert into dpdp.email_action_token (obligation_id, membership_id, identity_id, action, token_hash, expires_at, email_send_id)
      values (v_ob.id, v_m.id, v_m.identity_id, 'never_had_any', dpdp.email_token_hash(v_never), v_exp, p_email_send_id);
    else
      v_never := null;
    end if;
    v_out := v_out || jsonb_build_object(
      'obligationId', v_ob.id, 'done', v_done, 'cannot', v_cannot, 'neverHadAny', v_never, 'expiresAt', v_exp
    );
  end loop;
  return v_out;
end
$$;

-- Read-only: what the static confirmation page shows BEFORE the button is
-- pressed. Same checks as apply, zero writes (a mail scanner prefetching
-- the link cannot change anything -- the 2026-09-18 task-link fix, kept).
create or replace function dpdp.preview_email_action(p_token text)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_t dpdp.email_action_token;
  v_o dpdp.obligation;
  v_m dpdp.membership;
  v_name text;
  v_org text;
begin
  select t.* into v_t from dpdp.email_action_token t where t.token_hash = dpdp.email_token_hash(p_token);
  if v_t.id is null then
    return jsonb_build_object('ok', false, 'reason', 'This link is not valid.');
  end if;
  select m.* into v_m from dpdp.membership m where m.id = v_t.membership_id;
  select o.* into v_o from dpdp.obligation o where o.id = v_t.obligation_id;
  if v_m.id is null or v_o.id is null or v_m.org_id <> v_o.org_id then
    return jsonb_build_object('ok', false, 'reason', 'This link is not valid.');
  end if;
  if v_t.used_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'This link has already been used. Nothing has changed.');
  end if;
  if v_t.expires_at < now() then
    return jsonb_build_object('ok', false, 'reason', 'This link has expired. Ask for a new one.');
  end if;
  select t.name into v_name from dpdp.obligation_template t where t.id = v_o.template_id;
  select o.name into v_org from dpdp.organisation o where o.id = v_o.org_id;
  return jsonb_build_object(
    'ok', true, 'action', v_t.action, 'what', v_name, 'orgName', v_org,
    'isGroup', (v_o.assigned_staff_group_id is not null),
    'alreadyDone', (v_o.state in ('closed', 'submitted', 'not_applicable'))
  );
end
$$;

-- The button (WO-011 §2.3): token hash, expiry, single use, membership
-- binding -- then the SAME write + event as dpdp_mark_done (individual
-- job, 'done'), markObligationStuck (individual job, 'cannot' -- state
-- becomes 'stuck' so the Monday escalation can see it; the Next.js-era
-- event alone carried no obligation reference), or answerGroupObligation
-- (group job, any of the three answers). Every refusal of a real token is
-- itself logged, as answerTaskViaEmailToken did.
create or replace function dpdp.apply_email_action(p_token text, p_answer text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_t dpdp.email_action_token;
  v_m dpdp.membership;
  v_o dpdp.obligation;
  v_email text;
  v_label text;
  v_name text;
  v_dep_state text;
  v_now timestamptz := now();
  v_answered int;
  v_all boolean;
begin
  if p_answer is null or p_answer not in ('done', 'cannot', 'never_had_any') then
    return jsonb_build_object('ok', false, 'reason', 'That is not an answer this link can record.');
  end if;
  select t.* into v_t from dpdp.email_action_token t where t.token_hash = dpdp.email_token_hash(p_token);
  if v_t.id is null then
    return jsonb_build_object('ok', false, 'reason', 'This link is not valid.');
  end if;
  select m.* into v_m from dpdp.membership m where m.id = v_t.membership_id;
  select o.* into v_o from dpdp.obligation o where o.id = v_t.obligation_id;
  if v_m.id is null or v_o.id is null or v_m.org_id <> v_o.org_id then
    return jsonb_build_object('ok', false, 'reason', 'This link is not valid.');
  end if;
  select i.primary_email into v_email from dpdp.identity i where i.id = v_t.identity_id;
  v_label := coalesce(v_email, 'A person on a link');
  select t.name into v_name from dpdp.obligation_template t where t.id = v_o.template_id;

  if v_t.used_at is not null then
    perform public.dpdp__append_event(v_o.org_id, v_t.identity_id, v_label, 'task_answer_refused',
      'A spent email link was pressed again', 'job ' || v_o.id || ', answer ' || v_t.action);
    return jsonb_build_object('ok', false, 'reason', 'This link has already been used. Nothing has changed.');
  end if;
  if v_t.expires_at < v_now then
    perform public.dpdp__append_event(v_o.org_id, v_t.identity_id, v_label, 'task_answer_refused',
      'An expired email link was pressed', 'job ' || v_o.id || ', answer ' || v_t.action);
    return jsonb_build_object('ok', false, 'reason', 'This link has expired. Ask for a new one.');
  end if;
  if v_m.state <> 'active' then
    return jsonb_build_object('ok', false, 'reason', 'This link no longer works — you are not an active member of this organisation.');
  end if;
  if v_t.action <> p_answer then
    return jsonb_build_object('ok', false, 'reason', 'This link does not match that answer.');
  end if;
  if v_o.state in ('closed', 'submitted', 'not_applicable') then
    update dpdp.email_action_token set used_at = v_now where id = v_t.id;
    return jsonb_build_object('ok', false, 'reason', 'This job is already marked done. Nothing has changed.');
  end if;
  if v_o.assigned_staff_group_id is not null then
    if not exists (
      select 1 from dpdp.staff_group_member sgm where sgm.group_id = v_o.assigned_staff_group_id and sgm.membership_id = v_m.id
    ) then
      return jsonb_build_object('ok', false, 'reason', 'You aren''t a member of the group this job is assigned to');
    end if;
  else
    if p_answer = 'never_had_any' then
      return jsonb_build_object('ok', false, 'reason', 'That answer is only for group jobs.');
    end if;
    if v_o.assigned_person_id is distinct from v_m.identity_id and v_m.level <> 'owner' then
      return jsonb_build_object('ok', false, 'reason', 'Not your job');
    end if;
  end if;
  if v_o.depends_on_obligation_id is not null then
    select d.state into v_dep_state from dpdp.obligation d where d.id = v_o.depends_on_obligation_id;
    if v_dep_state is not null and v_dep_state <> 'closed' then
      return jsonb_build_object('ok', false, 'reason', 'Waiting — the step before this one isn''t done yet');
    end if;
  end if;

  -- Every check passed: spend the token, then write exactly what the
  -- in-app path writes.
  update dpdp.email_action_token set used_at = v_now where id = v_t.id;

  if v_o.assigned_staff_group_id is not null then
    insert into dpdp.obligation_group_answer (id, obligation_id, membership_id, answer, answered_at)
    values (replace(gen_random_uuid()::text, '-', ''), v_o.id, v_m.id, p_answer::dpdp.group_answer, (v_now at time zone 'UTC'))
    on conflict (obligation_id, membership_id) do update set answer = excluded.answer, answered_at = excluded.answered_at;
    select count(*)::int into v_answered from dpdp.obligation_group_answer ga where ga.obligation_id = v_o.id;
    v_all := v_answered >= v_o.progress_total;
    update dpdp.obligation
    set progress_done = v_answered,
        state = case when v_all then 'closed' else state end,
        closed_at = case when v_all then (v_now at time zone 'UTC') else closed_at end,
        closed_by = case when v_all then v_t.identity_id else closed_by end
    where id = v_o.id;
    perform public.dpdp__append_event(v_o.org_id, v_t.identity_id, v_label,
      case when p_answer = 'cannot' then 'task_answer_refused' else 'task_answered' end,
      v_label || ' answered "' || case p_answer when 'done' then 'Done' when 'never_had_any' then 'Doesn''t apply to me' else 'I can''t' end
        || '" for "' || coalesce(v_name, 'a job') || '" (' || v_answered || ' of ' || v_o.progress_total || ')');
  elsif p_answer = 'done' then
    update dpdp.obligation
    set state = 'closed', progress_done = progress_total, closed_at = (v_now at time zone 'UTC'), closed_by = v_t.identity_id
    where id = v_o.id;
    perform public.dpdp__append_event(v_o.org_id, v_t.identity_id, v_label, 'obligation_accepted',
      'Said Yes to "' || coalesce(v_name, 'a job') || '"');
  else
    update dpdp.obligation set state = 'stuck' where id = v_o.id;
    perform public.dpdp__append_event(v_o.org_id, v_t.identity_id, v_label, 'obligation_stuck',
      'Said they are stuck', 'Pressed "I can''t" on the Monday email for "' || coalesce(v_name, 'a job') || '"');
  end if;

  return jsonb_build_object('ok', true, 'obligationId', v_o.id, 'answer', p_answer, 'what', v_name);
end
$$;

-- ---------------------------------------------------------------------
-- 8. Unsubscribe (RFC 8058 one-click, and the static page). The token is
--    the one minted by record_email_send for that very email; it stays
--    valid so the link in an old email keeps working. Dropping to
--    statutory notices only -- never to nothing (WO-011 §2.5).
-- ---------------------------------------------------------------------
create or replace function dpdp.unsubscribe(p_token text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_es dpdp.email_send;
  v_email text;
begin
  select es.* into v_es from dpdp.email_send es where es.list_unsubscribe_token_hash = dpdp.email_token_hash(p_token);
  if v_es.id is null then
    return jsonb_build_object('ok', false, 'reason', 'This link is not valid.');
  end if;
  insert into dpdp.email_preference (membership_id, unsubscribed_at, statutory_only, updated_at)
  values (v_es.membership_id, now(), true, now())
  on conflict (membership_id) do update
    set unsubscribed_at = coalesce(dpdp.email_preference.unsubscribed_at, excluded.unsubscribed_at),
        statutory_only = true,
        updated_at = now();
  select i.primary_email into v_email from dpdp.identity i where i.id = v_es.identity_id;
  perform public.dpdp__append_event(v_es.org_id, v_es.identity_id, coalesce(v_email, 'A person on a link'),
    'membership_email_unsubscribed', coalesce(v_email, 'Someone') || ' stopped the weekly email (statutory notices continue)');
  return jsonb_build_object('ok', true, 'email', v_es.to_email);
end
$$;

-- ---------------------------------------------------------------------
-- 9. Browser-facing entry points (anon key + the token as credential).
-- ---------------------------------------------------------------------
create or replace function public.dpdp_apply_email_action(p_token text, p_answer text)
returns jsonb
language sql volatile security definer
set search_path = ''
as $$ select dpdp.apply_email_action(p_token, p_answer) $$;

create or replace function public.dpdp_preview_email_action(p_token text)
returns jsonb
language sql stable security definer
set search_path = ''
as $$ select dpdp.preview_email_action(p_token) $$;

create or replace function public.dpdp_unsubscribe(p_token text)
returns jsonb
language sql volatile security definer
set search_path = ''
as $$ select dpdp.unsubscribe(p_token) $$;

-- ---------------------------------------------------------------------
-- 10. Service-role wrappers for the Edge Function (PostgREST sees public).
-- ---------------------------------------------------------------------
create or replace function public.dpdp_timer_build_monday_digests(p_now timestamptz default now(), p_org_id text default null)
returns jsonb
language sql stable security definer
set search_path = ''
as $$ select dpdp.build_monday_digests(p_now, p_org_id) $$;

create or replace function public.dpdp_timer_legal_clocks(p_now timestamptz default now(), p_org_id text default null)
returns jsonb
language sql stable security definer
set search_path = ''
as $$ select dpdp.legal_clocks(p_now, p_org_id) $$;

create or replace function public.dpdp_timer_issue_action_tokens(p_membership_id text, p_obligation_ids text[], p_email_send_id text default null)
returns jsonb
language sql volatile security definer
set search_path = ''
as $$ select dpdp.issue_email_action_tokens(p_membership_id, p_obligation_ids, interval '7 days', p_email_send_id) $$;

create or replace function public.dpdp_timer_record_email_send(
  p_org_id text, p_membership_id text, p_identity_id text, p_obligation_ids text[], p_kind text, p_period_key text,
  p_to_email text, p_subject text, p_status text default 'queued', p_body_text text default null
)
returns jsonb
language sql volatile security definer
set search_path = ''
as $$ select dpdp.record_email_send(p_org_id, p_membership_id, p_identity_id, p_obligation_ids, p_kind, p_period_key, p_to_email, p_subject, p_status, p_body_text) $$;

create or replace function public.dpdp_timer_mark_email_send_result(p_id text, p_status text, p_resend_message_id text default null, p_error text default null)
returns void
language sql volatile security definer
set search_path = ''
as $$ select dpdp.mark_email_send_result(p_id, p_status, p_resend_message_id, p_error) $$;

-- ---------------------------------------------------------------------
-- 11. Grants. Helpers: nobody. dpdp.* logic: service_role, plus
--     app_runtime so the repo's DB-gated tests (dpdp-timer.test.ts) can
--     exercise the real functions over the existing test connection --
--     same reasoning 0604 gave for its own app_runtime grants. Timer
--     wrappers: service_role only. Page entry points: anon+authenticated.
-- ---------------------------------------------------------------------
revoke all on function dpdp.email_token_hash(text) from public, anon, authenticated;
revoke all on function dpdp.new_opaque_token() from public, anon, authenticated;
revoke all on function dpdp.required_today(text[]) from public, anon, authenticated;
revoke all on function dpdp.monday_week_key(timestamptz) from public, anon, authenticated;
revoke all on function dpdp.org_notice_recipients(text) from public, anon, authenticated;

revoke all on function dpdp.build_monday_digests(timestamptz, text) from public, anon, authenticated;
revoke all on function dpdp.legal_clocks(timestamptz, text) from public, anon, authenticated;
revoke all on function dpdp.record_email_send(text, text, text, text[], text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function dpdp.mark_email_send_result(text, text, text, text) from public, anon, authenticated;
revoke all on function dpdp.issue_email_action_tokens(text, text[], interval, text) from public, anon, authenticated;
revoke all on function dpdp.preview_email_action(text) from public, anon, authenticated;
revoke all on function dpdp.apply_email_action(text, text) from public, anon, authenticated;
revoke all on function dpdp.unsubscribe(text) from public, anon, authenticated;
grant execute on function dpdp.build_monday_digests(timestamptz, text) to service_role, app_runtime;
grant execute on function dpdp.legal_clocks(timestamptz, text) to service_role, app_runtime;
grant execute on function dpdp.record_email_send(text, text, text, text[], text, text, text, text, text, text) to service_role, app_runtime;
grant execute on function dpdp.mark_email_send_result(text, text, text, text) to service_role, app_runtime;
grant execute on function dpdp.issue_email_action_tokens(text, text[], interval, text) to service_role, app_runtime;
grant execute on function dpdp.preview_email_action(text) to service_role, app_runtime;
grant execute on function dpdp.apply_email_action(text, text) to service_role, app_runtime;
grant execute on function dpdp.unsubscribe(text) to service_role, app_runtime;

revoke all on function public.dpdp_timer_build_monday_digests(timestamptz, text) from public, anon, authenticated;
revoke all on function public.dpdp_timer_legal_clocks(timestamptz, text) from public, anon, authenticated;
revoke all on function public.dpdp_timer_issue_action_tokens(text, text[], text) from public, anon, authenticated;
revoke all on function public.dpdp_timer_record_email_send(text, text, text, text[], text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.dpdp_timer_mark_email_send_result(text, text, text, text) from public, anon, authenticated;
grant execute on function public.dpdp_timer_build_monday_digests(timestamptz, text) to service_role;
grant execute on function public.dpdp_timer_legal_clocks(timestamptz, text) to service_role;
grant execute on function public.dpdp_timer_issue_action_tokens(text, text[], text) to service_role;
grant execute on function public.dpdp_timer_record_email_send(text, text, text, text[], text, text, text, text, text, text) to service_role;
grant execute on function public.dpdp_timer_mark_email_send_result(text, text, text, text) to service_role;

revoke all on function public.dpdp_apply_email_action(text, text) from public;
revoke all on function public.dpdp_preview_email_action(text) from public;
revoke all on function public.dpdp_unsubscribe(text) from public;
grant execute on function public.dpdp_apply_email_action(text, text) to anon, authenticated, service_role, app_runtime;
grant execute on function public.dpdp_preview_email_action(text) to anon, authenticated, service_role, app_runtime;
grant execute on function public.dpdp_unsubscribe(text) to anon, authenticated, service_role, app_runtime;

-- dpdp_my_page keeps 0604's exact grant posture (create or replace
-- preserves existing grants; restated so this file is self-describing).
revoke all on function public.dpdp_my_page(text) from public, anon;
grant execute on function public.dpdp_my_page(text) to authenticated, app_runtime;

-- ---------------------------------------------------------------------
-- 12. The timer. 06:00 IST Monday == 00:30 UTC Monday; 09:00 IST daily ==
--     03:30 UTC. URL and bearer secret come from Vault, never from this
--     file -- the PM creates them first (see supabase/functions/
--     dpdp-monday-email/README.md):
--       select vault.create_secret('<random 48+ chars>', 'dpdp_timer_secret');
--       select vault.create_secret('https://<ref>.supabase.co/functions/v1/dpdp-monday-email', 'dpdp_timer_url');
--     cron.schedule(name, ...) upserts by name, so re-applying is safe.
-- ---------------------------------------------------------------------
select cron.schedule(
  'dpdp-monday-digest',
  '30 0 * * 1',
  $cron$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'dpdp_timer_url'),
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'dpdp_timer_secret'),
        'Content-Type', 'application/json'
      ),
      body := '{"job":"monday"}'::jsonb,
      timeout_milliseconds := 300000
    )
  $cron$
);

select cron.schedule(
  'dpdp-legal-clocks',
  '30 3 * * *',
  $cron$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'dpdp_timer_url'),
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'dpdp_timer_secret'),
        'Content-Type', 'application/json'
      ),
      body := '{"job":"legal_clocks"}'::jsonb,
      timeout_milliseconds := 300000
    )
  $cron$
);
