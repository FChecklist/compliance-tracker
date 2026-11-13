-- PRE-APPROVED-LIVE-DDL: Owner requirement relayed by the boss session on 2026-11-14 ("the weekly e-mail must drive one ICP cycle per organisation per week: a per-stage 'this week' checklist, a weekly ICP score, carry-over of open items, a weekly proof snapshot, a per-client roll-up for the Professional (CA) edition"). FILE ONLY: not applied to any database; the owner applies it through the Supabase MCP after reading drizzle/down/0763_dpdp_icp_monday_block.down.sql and recording a rollback id.
--
-- DPDP ICP weekly lifecycle, slice 3 of 3: what the Monday e-mail needs. ONE function, for the timer's service role only:
--
--   public.dpdp_timer_icp_weekly(p_org_id, p_now, p_record)
--     * the organisation's ICP status for the week p_now falls in (the same dpdp.icp_status_for the signed-in page and the weekly record use),
--       cut into three stages with their steps, so the e-mail shows the same checklist the page does;
--     * CARRY-OVER: a step that is not done now AND was not done in the organisation's latest earlier record (the previous week's last snapshot);
--     * WHO MAY SEE IT: the active memberships whose viewer kind is a whole-organisation one (owner, grievance officer, coordinator, CA partner or manager)
--       -- the same rule as dpdp__icp_member, so a staff member's e-mail never carries the register's status;
--     * THE WEEKLY PROOF SNAPSHOT: when p_record is true, one software run per stage ("Monday snapshot") is added to the append-only weekly record, once per
--       stage per week (a retry adds nothing). It records the counts at that moment; it is not a statement about anyone's legal position;
--     * PER-CLIENT ROLL-UP (Professional / firm organisations only): for each organisation the firm currently advises (dpdp.relationship kind 'advises',
--       not ended), that client's weekly score and step counts. Counts only: no register line, no free text, no name of any person.
--
-- Nothing here says "compliant", "certified" or "guaranteed"; the score is a count of this week's routine steps and the return value says so.
-- ADDITIVE and re-runnable. No new table. Depends on 0761 and 0762 (dpdp.icp_status_for, dpdp_icp_run_software, dpdp.icp_week, dpdp.icp_item, dpdp.icp_run).

begin;
set local lock_timeout = '5s';

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
  v_stage text;
  v_title text;
  v_sec jsonb;
  v_step jsonb;
  v_pstep jsonb;
  v_recorded integer := 0;
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
        if not coalesce((v_step ->> 'done')::boolean, false) then
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

  -- the weekly proof snapshot: one software run per stage per week, never twice
  if p_record then
    for v_stage in select unnest(array['identify', 'classify', 'prove']) loop
      if not exists (select 1 from dpdp.icp_run r where r.org_id = p_org_id and r.week_start = v_week and r.stage = v_stage and r.by_kind = 'software') then
        insert into dpdp.icp_run (org_id, stage, week_start, by_kind, actor_label, outcome, note, snapshot)
        values (p_org_id, v_stage, v_week, 'software', 'Automatic helper', 'ok', 'Monday snapshot', v_status - 'notALegalRating');
        v_recorded := v_recorded + 1;
      end if;
    end loop;
  end if;

  if v_org.product = 'firm' then
    select count(*) into v_client_total from dpdp.relationship r where r.kind = 'advises' and r.from_org = p_org_id and r.ended_at is null;
    select coalesce(jsonb_agg(c order by (c ->> 'percent')::int, c ->> 'name'), '[]'::jsonb) into v_clients from (
      select jsonb_build_object(
               'orgId', o.id, 'name', o.name,
               'started', exists (select 1 from dpdp.icp_item i where i.org_id = o.id and i.status = 'active'),
               'percent', (s.j ->> 'percent')::int, 'done', (s.j ->> 'done')::int, 'total', (s.j ->> 'total')::int,
               'identify', jsonb_build_object('done', (s.j -> 'identify' ->> 'done')::int, 'total', (s.j -> 'identify' ->> 'total')::int),
               'classify', jsonb_build_object('done', (s.j -> 'classify' ->> 'done')::int, 'total', (s.j -> 'classify' ->> 'total')::int),
               'prove', jsonb_build_object('done', (s.j -> 'prove' ->> 'done')::int, 'total', (s.j -> 'prove' ->> 'total')::int)) as c
        from dpdp.relationship r
        join dpdp.organisation o on o.id = r.to_org
        cross join lateral (select dpdp.icp_status_for(o.id, v_week) as j) s
       where r.kind = 'advises' and r.from_org = p_org_id and r.ended_at is null
       order by o.name
       limit 100) q;
  end if;

  return jsonb_build_object(
    'orgId', p_org_id, 'orgName', v_org.name, 'product', v_org.product,
    'weekStart', to_char(v_week, 'YYYY-MM-DD'),
    'percent', (v_status ->> 'percent')::int, 'done', (v_status ->> 'done')::int, 'total', (v_status ->> 'total')::int, 'status', v_status ->> 'status',
    'stages', v_stages,
    'carriedOver', v_carried,
    'viewerMembershipIds', v_viewers,
    'snapshotsAdded', v_recorded,
    'clients', v_clients, 'clientTotal', v_client_total,
    'notALegalRating', true,
    'note', 'A count of this week''s routine steps. It is not a rating of anyone''s legal position.');
end
$$;

revoke all on function public.dpdp_timer_icp_weekly(text, timestamptz, boolean) from public, anon, authenticated;
grant execute on function public.dpdp_timer_icp_weekly(text, timestamptz, boolean) to service_role;

commit;
