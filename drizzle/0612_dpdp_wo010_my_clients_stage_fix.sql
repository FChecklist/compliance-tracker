-- WO-DPDP-010 §3 "CA firm view", two findings from the Step 6 acceptance
-- run (dpdp-app/e2e/ACCEPTANCE-70.md, findings 1 and 2), fixed here by
-- re-issuing public.dpdp_my_clients (drizzle/0609) with the same shape:
--
--   1. A SCHOOL a CA creates with "+ Add a client" never appeared in "My
--      clients": the institution library (0602) has no CAPARTNER/CAMGR job,
--      and 0609 listed an org only when the caller was named on such a job.
--      Now the CA who set the org up (organisation.set_up_by_membership_id
--      = the caller's membership) counts as its CA partner too, whichever
--      product it is. A CA named on a CAPARTNER/CAMGR job is unchanged.
--
--   2. "Where it is" said "Waiting for the owner to confirm" for an org a
--      CA set up WITHOUT naming an owner (no active owner membership
--      exists, so nobody could ever confirm). That case now reads
--      "No owner named yet"; "Waiting for the owner to confirm" is kept for
--      the case it was written for -- an owner exists and has not confirmed.
--
-- Additive: same function name, arguments, return shape and grants; one
-- new label value. Idempotent (create or replace).
create or replace function public.dpdp_my_clients()
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_identity text;
  v_out jsonb;
begin
  v_identity := public.dpdp__caller_identity_id();
  if v_identity is null then
    raise exception 'Not a member of this organisation' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'org', jsonb_build_object('id', c.org_id, 'name', c.name, 'product', coalesce(c.product, 'firm')),
      'caSub', c.ca_sub,
      'done', c.done,
      'total', c.total,
      'whereItIs', case
        when c.set_up_by is not null and c.owner_confirmed_at is null and not c.has_owner then 'No owner named yet'
        when c.set_up_by is not null and c.owner_confirmed_at is null then 'Waiting for the owner to confirm'
        when c.done = 0 then 'Not started'
        when c.total > 0 and c.done = c.total then 'Signed off'
        when c.open_other = 0 and c.open_mgr = 0 then 'Ready to sign'
        when c.open_other = 0 then 'With the CA manager'
        else 'In progress'
      end,
      'dataLocations', c.data_locations,
      'ownerConfirmedAt', c.owner_confirmed_at,
      'setUpByMe', coalesce(c.set_up_by = c.membership_id, false)
    ) order by c.created_at, c.org_id), '[]'::jsonb)
  into v_out
  from (
    select
      m.id as membership_id, m.org_id, m.created_at, o.name, o.product, o.set_up_by_membership_id as set_up_by, o.owner_confirmed_at,
      case when bool_or(t.role_tag = 'CAPARTNER' and ob.assigned_person_id = v_identity and ob.state <> 'not_applicable') then 'partner'
           when bool_or(t.role_tag = 'CAMGR' and ob.assigned_person_id = v_identity and ob.state <> 'not_applicable') then 'manager'
           -- finding 1: the CA who set the org up is its partner even when
           -- the product's library has no CA-tagged job (schools)
           when o.set_up_by_membership_id = m.id then 'partner' end as ca_sub,
      (count(*) filter (where ob.state in ('closed', 'submitted')))::int as done,
      (count(*) filter (where ob.state <> 'not_applicable'))::int as total,
      (count(*) filter (where ob.state not in ('closed', 'submitted', 'not_applicable') and t.role_tag = 'CAMGR'))::int as open_mgr,
      (count(*) filter (where ob.state not in ('closed', 'submitted', 'not_applicable') and coalesce(t.role_tag, '') not in ('CAMGR', 'CAPARTNER')))::int as open_other,
      (select count(*)::int from dpdp.data_location dl join dpdp.data_category dc on dc.id = dl.category_id where dc.org_id = m.org_id) as data_locations,
      -- finding 2: is there anybody who COULD confirm?
      exists (select 1 from dpdp.membership mo where mo.org_id = m.org_id and mo.level = 'owner' and mo.state = 'active') as has_owner
    from dpdp.membership m
    join dpdp.organisation o on o.id = m.org_id
    join dpdp.obligation ob on ob.org_id = m.org_id
    join dpdp.obligation_template t on t.id = ob.template_id
    where m.identity_id = v_identity and m.state = 'active'
    group by m.id, m.org_id, m.created_at, o.name, o.product, o.set_up_by_membership_id, o.owner_confirmed_at
  ) c
  where c.ca_sub is not null;
  return v_out;
end
$$;

revoke all on function public.dpdp_my_clients() from public, anon;
grant execute on function public.dpdp_my_clients() to authenticated;
