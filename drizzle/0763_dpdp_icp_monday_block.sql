-- PRE-APPROVED-LIVE-DDL: Owner requirement relayed by the boss session on 2026-11-14 ("the weekly e-mail must drive one ICP cycle per organisation per week: a per-stage 'this week' checklist, a weekly ICP score, carry-over of open items, a weekly proof snapshot, a per-client roll-up for the Professional (CA) edition"). FILE ONLY: not applied to any database; the owner applies it through the Supabase MCP after reading drizzle/down/0763_dpdp_icp_monday_block.down.sql and recording a rollback id.
--
-- DPDP ICP weekly lifecycle, slice 3 of 3: what the Monday e-mail needs. ONE function, for the timer's service role only:
--
--   public.dpdp_timer_icp_weekly(p_org_id, p_now, p_record)
--     * the organisation's ICP status for the week p_now falls in (the same dpdp.icp_status_for the signed-in page and the weekly record use),
--       cut into three stages with their steps, so the e-mail shows the same checklist the page does;
--     * CARRY-OVER: a step that is not done now AND was not done in the organisation's latest earlier record ("last recorded", which can be older than last
--       week). Steps that are by nature this week's own (anything new, a record this week, the week's sign-off) are never carried: on a Monday they are open
--       for everyone, so carrying them would only be noise;
--     * WHO MAY SEE IT: the active memberships whose viewer kind is a whole-organisation one (owner, grievance officer, coordinator, CA partner or manager)
--       -- the same rule as dpdp__icp_member, so a staff member's e-mail never carries the register's status;
--     * THE WEEKLY PROOF SNAPSHOT: when p_record is true, one software run per stage ("Monday snapshot") is added to the append-only weekly record, once per
--       stage per week (a retry adds nothing). It records the counts at that moment; it is not a statement about anyone's legal position;
--     * PER-CLIENT ROLL-UP (Professional / firm organisations only), PER RECIPIENT: each whole-organisation member of the firm gets the clients THEY act for and
--       no one else's: the same two routes as the CA's own "My clients" (public.dpdp_my_clients, 0612): named on a live CAPARTNER / CAMGR job in the client
--       organisation, OR set that organisation up (the institution library has no CA-tagged job); and the client's owner has confirmed the set-up. A person
--       can therefore only ever be shown what their own "My clients" page already shows them, whatever memberships anybody else has added to the firm
--       (naming a CA's e-mail in a made-up firm gains the firm's owner nothing). The result is keyed by membership in `clientsByViewer`; the aggregate
--       `clients` / `clientTotal` are always empty. Stricter than "My clients" in two ways: an unconfirmed set-up is hidden, and a client with no jobs counts.
--       dpdp.relationship is deliberately not used: no flow fills it and nothing in it records that the client agreed. Counts only: no register line, no free
--       text, no name of any person. Worst first, 100 at most per recipient, 25 recipients at most.
--
-- Nothing here says "compliant", "certified" or "guaranteed"; the score is a count of this week's routine steps and the return value says so.
-- ADDITIVE and re-runnable. No new table. Depends on 0761 and 0762 (dpdp.icp_status_for, dpdp_icp_run_software, dpdp.icp_week, dpdp.icp_item, dpdp.icp_run).

begin;
set local lock_timeout = '5s';

-- the Monday snapshot is written once per organisation, stage and week, even when two runs overlap
create unique index if not exists icp_run_monday_once on dpdp.icp_run (org_id, stage, week_start) where by_kind = 'software' and note = 'Monday snapshot';

-- the clients one person acts for: the same two routes as "My clients" (0612 dpdp_my_clients), and the client's owner has confirmed the set-up.
-- Internal: the timer function below is the only caller, and it asks for each recipient's OWN identity.
create or replace function dpdp.icp_clients_of(p_identity_id text, p_exclude_org_id text)
returns table (id text, name text)
language sql stable security definer
set search_path = ''
as $f$
  select distinct o.id, o.name
    from dpdp.membership mc
    join dpdp.organisation o on o.id = mc.org_id
   where mc.identity_id = p_identity_id and mc.state = 'active'
     and o.id <> p_exclude_org_id
     and not (o.set_up_by_membership_id is not null and o.owner_confirmed_at is null)   -- still waiting for the client's owner to confirm: not shown
     and (o.set_up_by_membership_id = mc.id
          or exists (select 1 from dpdp.obligation ob join dpdp.obligation_template t on t.id = ob.template_id
                      where ob.org_id = o.id and ob.assigned_person_id = mc.identity_id and ob.state <> 'not_applicable' and t.role_tag in ('CAPARTNER', 'CAMGR')))
$f$;
revoke all on function dpdp.icp_clients_of(text, text) from public, anon, authenticated;

create or replace function public.dpdp_timer_icp_weekly(p_org_id text, p_now timestamptz default null, p_record boolean default true)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_now timestamptz := coalesce(p_now, clock_timestamp());
  v_week date := ((v_now at time zone 'UTC')::date - ((extract(isodow from (v_now at time zone 'UTC')::date)::int) - 1));
  v_org dpdp.organisation;
  v_status jsonb;
  v_prev jsonb;
  v_stages jsonb := '[]'::jsonb;
  v_carried jsonb := '[]'::jsonb;
  v_viewers jsonb;
  v_clients jsonb := '[]'::jsonb;
  v_client_total integer := 0;
  v_by_viewer jsonb := '{}'::jsonb;
  v_vm record;
  v_stage text;
  v_title text;
  v_sec jsonb;
  v_step jsonb;
  v_pstep jsonb;
  v_recorded integer := 0;
  v_n integer;
begin
  select o.* into v_org from dpdp.organisation o where o.id = p_org_id;
  if v_org.id is null then
    raise exception 'Organisation not found' using errcode = 'P0002';
  end if;
  v_status := dpdp.icp_status_for(p_org_id, v_week);

  -- the latest record from an EARLIER week (the person's last sign-off of that week, or the Monday snapshot): what was still open then
  select r.snapshot into v_prev from dpdp.icp_run r where r.org_id = p_org_id and r.week_start < v_week order by r.ran_at desc, r.id desc limit 1;

  for v_stage, v_title in select * from (values ('identify', 'Identify: what you hold'), ('classify', 'Classify: why, on what basis, for how long'), ('prove', 'Prove: the records that show what you did')) t(s, tt) loop
    v_sec := v_status -> v_stage;
    v_stages := v_stages || jsonb_build_array(jsonb_build_object('stage', v_stage, 'title', v_title, 'done', (v_sec ->> 'done')::int, 'total', (v_sec ->> 'total')::int, 'steps', v_sec -> 'steps'));
    if v_prev is not null then
      for v_step in select * from jsonb_array_elements(v_sec -> 'steps') loop
        if not coalesce((v_step ->> 'done')::boolean, false) and (v_step ->> 'key') not in ('anything_new', 'evidence_this_week', 'week_signed_off', 'confirm_register') then
          select p into v_pstep from jsonb_array_elements(coalesce(v_prev -> v_stage -> 'steps', '[]'::jsonb)) p where p ->> 'key' = v_step ->> 'key' limit 1;
          if v_pstep is not null and not coalesce((v_pstep ->> 'done')::boolean, false) then
            v_carried := v_carried || jsonb_build_array(jsonb_build_object('stage', v_stage, 'key', v_step ->> 'key', 'label', v_step ->> 'label', 'count', v_step -> 'count'));
          end if;
        end if;
      end loop;
    end if;
  end loop;

  select coalesce(jsonb_agg(m.id order by m.id), '[]'::jsonb) into v_viewers
    from dpdp.membership m
   where m.org_id = p_org_id and m.state = 'active' and coalesce(public.dpdp__viewer_kind(m.id), 'staff') not in ('staff', 'parent');

  -- the weekly proof snapshot: one software run per stage per week, never twice (the unique index makes a racing second run add nothing).
  -- It is the week's STARTING line, taken when the e-mail goes out, and only for the week that is current now, never for a date passed in.
  if p_record and v_week = dpdp.icp_week() then
    for v_stage in select unnest(array['identify', 'classify', 'prove']) loop
      insert into dpdp.icp_run (org_id, stage, week_start, by_kind, actor_label, outcome, note, snapshot)
      values (p_org_id, v_stage, v_week, 'software', 'Automatic helper', 'ok', 'Monday snapshot', v_status - 'notALegalRating')
      on conflict do nothing;
      get diagnostics v_n = row_count;
      v_recorded := v_recorded + v_n;
    end loop;
  end if;

  -- PER RECIPIENT: each whole-organisation member is shown the clients they act for, ranked BEFORE the cut (their weakest 100, not the first 100 by name)
  if coalesce(v_org.product, 'firm') = 'firm' then
    for v_vm in
      select m.id, m.identity_id from dpdp.membership m
       where m.org_id = p_org_id and m.state = 'active' and coalesce(public.dpdp__viewer_kind(m.id), 'staff') not in ('staff', 'parent')
       order by m.id limit 25
    loop
      select count(*) into v_client_total from dpdp.icp_clients_of(v_vm.identity_id, p_org_id);
      if v_client_total > 0 then
        select coalesce(jsonb_agg(q.c order by (q.c ->> 'percent')::int, q.c ->> 'name'), '[]'::jsonb) into v_clients from (
          select jsonb_build_object(
                   'orgId', sc.id, 'name', sc.name,
                   'started', exists (select 1 from dpdp.icp_item i where i.org_id = sc.id and i.status = 'active'),
                   'percent', (sc.j ->> 'percent')::int, 'done', (sc.j ->> 'done')::int, 'total', (sc.j ->> 'total')::int,
                   'identify', jsonb_build_object('done', (sc.j -> 'identify' ->> 'done')::int, 'total', (sc.j -> 'identify' ->> 'total')::int),
                   'classify', jsonb_build_object('done', (sc.j -> 'classify' ->> 'done')::int, 'total', (sc.j -> 'classify' ->> 'total')::int),
                   'prove', jsonb_build_object('done', (sc.j -> 'prove' ->> 'done')::int, 'total', (sc.j -> 'prove' ->> 'total')::int)) as c
            from (select f.id, f.name, s.j
                    from dpdp.icp_clients_of(v_vm.identity_id, p_org_id) f
                   cross join lateral (select dpdp.icp_status_for(f.id, v_week) as j) s
                   order by (s.j ->> 'percent')::int, f.name
                   limit 100) sc) q;
        v_by_viewer := v_by_viewer || jsonb_build_object(v_vm.id, jsonb_build_object('clientTotal', v_client_total, 'clients', v_clients));
      end if;
    end loop;
  end if;

  return jsonb_build_object(
    'orgId', p_org_id, 'orgName', v_org.name, 'product', coalesce(v_org.product, 'firm'),
    'weekStart', to_char(v_week, 'YYYY-MM-DD'),
    'percent', (v_status ->> 'percent')::int, 'done', (v_status ->> 'done')::int, 'total', (v_status ->> 'total')::int, 'status', v_status ->> 'status',
    'stages', v_stages,
    'carriedOver', v_carried,
    'viewerMembershipIds', v_viewers,
    'snapshotsAdded', v_recorded,
    'clients', '[]'::jsonb, 'clientTotal', 0, 'clientsByViewer', v_by_viewer,
    'notALegalRating', true,
    'note', 'A count of this week''s routine steps. It is not a rating of anyone''s legal position.');
end
$$;

revoke all on function public.dpdp_timer_icp_weekly(text, timestamptz, boolean) from public, anon, authenticated;
grant execute on function public.dpdp_timer_icp_weekly(text, timestamptz, boolean) to service_role;

commit;
