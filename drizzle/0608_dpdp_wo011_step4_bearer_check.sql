-- WO-DPDP-011 Step 4, addendum: the Edge Function must work with ONLY the
-- platform-injected env (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY) plus
-- Vault, because `supabase secrets set` is not runnable from the PM's
-- machine. When DPDP_TIMER_SECRET is not set as a function secret, the
-- function verifies the cron's bearer through this service_role-only RPC
-- instead, against the SAME Vault secret the cron reads
-- (vault.decrypted_secrets name 'dpdp_timer_secret', see 0606 §12).
--
-- Both sides are sha256-hashed before comparison, so the comparison is on
-- fixed-length digests rather than the raw secret (constant-time-ish; the
-- caller already holds service_role, this only guards the timer path).
-- Additive: one function, one grant. Applied separately from 0606.
create or replace function public.dpdp_timer_check_bearer(p_bearer text)
returns boolean
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_secret text;
begin
  if p_bearer is null or length(p_bearer) < 24 then
    return false;
  end if;
  select s.decrypted_secret into v_secret
  from vault.decrypted_secrets s
  where s.name = 'dpdp_timer_secret'
  order by s.created_at desc
  limit 1;
  if v_secret is null or length(v_secret) < 24 then
    return false;
  end if;
  return encode(sha256(convert_to(p_bearer, 'UTF8')), 'hex') = encode(sha256(convert_to(v_secret, 'UTF8')), 'hex');
end
$$;

revoke all on function public.dpdp_timer_check_bearer(text) from public, anon, authenticated;
grant execute on function public.dpdp_timer_check_bearer(text) to service_role;

-- ---------------------------------------------------------------------
-- Fix found by the live run of dpdp-timer.test.ts on the applied 0606
-- (2026-09-22): the escalatedToMe `reason` CASE tested owner_named
-- BEFORE relationship_owner, so an outside-party job that was ALSO >= 30
-- days late was reported to the owner with the generic 'late_owner'
-- reason instead of the more specific 'outside_party_silent' (WO-011
-- 2.5 "outside party silent -> relationship owner"). Re-issued here in
-- full (0606 is applied and ledger-registered by file hash, so it is not
-- edited); the ONLY change is the order of those two WHEN arms --
-- coordinator 'stuck' stays first. The flags themselves were already
-- correct; only the label was.
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
              when m.level = 'owner' and f.relationship_owner then 'outside_party_silent'
              when m.level = 'owner' and f.owner_named then 'late_owner'
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
