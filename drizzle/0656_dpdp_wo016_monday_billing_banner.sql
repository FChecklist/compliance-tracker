-- WO-DPDP-016 §9: the Monday digest needs to say "DPDP is important --
-- complete the billing" before its usual content, for any membership whose
-- org is not yet on an 'active' subscription (Owner, this session: the
-- email keeps going every Monday "even if customer doesn't make
-- payment" -- a nag, never a lockout, matching §7-8's "access never
-- changes" rule). dpdp.build_monday_digests (drizzle/0606) is the one
-- function that builds every row the email loops over
-- (dpdp_timer_build_monday_digests is a thin, unchanged wrapper around it
-- -- see that file's own header), so the banner condition is added there
-- as one more field on its existing per-membership jsonb row, not as a
-- second query. dpdp.subscription didn't have a `state` column read by
-- anything until drizzle/0655; a LEFT JOIN (not an inner join) is used
-- here on purpose, defensively, even though 0655's dpdp_create_my_org now
-- inserts a row for every new org -- an org made a different way, or
-- predating 0655, may still have none, and coalesce(sub.state, 'trial')
-- matches the exact fallback dpdp_my_billing (0655) already uses.
--
-- This is a full create-or-replace of an existing function (Postgres has
-- no way to patch one column into a function body) -- everything below is
-- copied from drizzle/0606_dpdp_wo011_step4_timer.sql's own
-- dpdp.build_monday_digests unchanged except the two lines marked WO-016.
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
      coalesce(sub.state, 'trial') as "subscriptionState", -- WO-016 §9
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
    left join dpdp.subscription sub on sub.org_id = m.org_id -- WO-016 §9
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
