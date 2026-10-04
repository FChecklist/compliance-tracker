-- PRE-APPROVED-LIVE-DDL: Owner instruction in chat, 2026-10-04 -- "The external AI work link should be SHORT ... The external AI reads the bigger prompt ... and works as per its role ... SAME IN VERIDIAN (DPDP)": the AI may do what the person's own role can do when logged in, short of payments, signing, erasure/export and personal data.
--
-- DPDP AI work link: a READ-ONLY register of the organisation's other records, so the AI can see the whole picture a logged-in owner / coordinator /
-- Grievance Officer / CA sees (the data map, notices, people, requests, complaints, the breach register, the public page, processors, groups, proof, plan),
-- not only the job list. One new function, public.dpdp_ai_link_register(p_token, p_kind). Nothing is written; nothing is dropped.
--
--   * Roles: owner, coord, go, ca (the roles that see the whole organisation). A staff member or parent link is refused (42501) -- a lesser role's
--     link gains no admin view.
--   * Personal data is never returned: no requester or complainant details, no answer or summary text, no file names, no payment rows, no
--     phone numbers or addresses. Counts, states and dates only. Email addresses of members and the officer only when the link does not hide them.
--   * Same shape as the other dpdp_ai_link_* functions: security definer, empty search_path, token resolved by dpdp__ai_link_for_token (which raises the
--     plain "This link has expired or was revoked" for a dead link), service_role / app_runtime only.

create or replace function public.dpdp_ai_link_register(p_token text, p_kind text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_l dpdp.ai_link;
  v_m dpdp.membership;
  v_org text;
  v_kind text;
  v_k text := lower(trim(coalesce(p_kind, '')));
  v_out jsonb;
begin
  v_l := public.dpdp__ai_link_for_token(p_token);
  select m.* into v_m from dpdp.membership m where m.id = v_l.membership_id;
  v_org := v_m.org_id;
  v_kind := public.dpdp__viewer_kind(v_m.id);
  if v_kind is null or v_kind not in ('owner', 'coord', 'go', 'ca') then
    raise exception 'This part of the organisation is for the owner, the DPDP coordinator, the Grievance Officer or the CA firm. This link''s person sees only their own jobs: use GET /jobs.' using errcode = '42501';
  end if;

  if v_k = 'data-map' then
    select coalesce(jsonb_agg(jsonb_build_object(
      'category', c.category, 'subjectGroup', c.subject_group, 'childrenData', c.is_children_data,
      'locations', (select coalesce(jsonb_agg(jsonb_build_object('system', l.system_name, 'where', l.physical_location, 'holderKind', l.holder_kind::text, 'state', l.state::text, 'confirmedAt', l.confirmed_at) order by l.system_name), '[]'::jsonb) from dpdp.data_location l where l.category_id = c.id)
    ) order by c.category), '[]'::jsonb) into v_out from dpdp.data_category c where c.org_id = v_org;

  elsif v_k = 'notices' then
    select coalesce(jsonb_agg(jsonb_build_object('docKind', n.doc_kind::text, 'version', n.version, 'releasedOn', n.released_on, 'effectiveFrom', n.effective_from, 'effectiveTo', n.effective_to, 'languages', n.languages, 'state', n.state::text) order by n.released_on desc nulls last), '[]'::jsonb)
      into v_out from dpdp.notice_version n where n.org_id = v_org;

  elsif v_k = 'people' then
    select coalesce(jsonb_agg(jsonb_build_object(
      'who', case when v_l.hide_emails and m.id <> v_m.id then m.level::text else i.primary_email end,
      'isYou', m.id = v_m.id, 'level', m.level::text, 'role', public.dpdp__viewer_kind(m.id), 'canSign', m.can_sign, 'state', m.state::text, 'joinedVia', m.joined_via::text
    ) order by m.created_at), '[]'::jsonb)
      into v_out from dpdp.membership m join dpdp.identity i on i.id = m.identity_id where m.org_id = v_org;

  elsif v_k = 'rights' then
    select jsonb_build_object(
      'byState', (select coalesce(jsonb_object_agg(s.state, s.n), '{}'::jsonb) from (select r.state::text as state, count(*) as n from dpdp.rights_request r where r.org_id = v_org group by 1) s),
      'open', (select coalesce(jsonb_agg(jsonb_build_object('ref', r.ref, 'kind', r.kind::text, 'receivedAt', r.received_at, 'dueAt', r.due_at, 'state', r.state::text, 'overdue', r.due_at < (clock_timestamp() at time zone 'UTC')) order by r.due_at), '[]'::jsonb) from dpdp.rights_request r where r.org_id = v_org and r.answered_at is null)
    ) into v_out;

  elsif v_k = 'grievances' then
    select coalesce(jsonb_agg(jsonb_build_object('ref', g.ref, 'tier', g.tier::text, 'state', g.state::text, 'officerDueAt', g.officer_due_at, 'reviewerDueAt', g.reviewer_due_at) order by g.officer_due_at), '[]'::jsonb)
      into v_out from dpdp.grievance g where g.org_id = v_org;

  elsif v_k = 'breach' then
    select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'becameAwareAt', b.became_aware_at, 'deadlineAt', b.deadline_at, 'peopleAffected', b.scope_person_count, 'boardNotifiedAt', b.board_notified_at, 'individualsNotifiedAt', b.individuals_notified_at, 'state', b.state::text) order by b.became_aware_at desc), '[]'::jsonb)
      into v_out from dpdp.breach b where b.org_id = v_org;

  elsif v_k = 'public-page' then
    select jsonb_build_object(
      'page', (select jsonb_build_object('slug', p.slug, 'isLive', p.is_live, 'verifiedVia', p.verified_via::text, 'lastGeneratedAt', p.last_generated_at) from dpdp.public_page p where p.org_id = v_org),
      'grievanceOfficer', (select jsonb_build_object('name', go.person_name, 'email', case when v_l.hide_emails then null else go.email end, 'appointmentMode', go.appointment_mode::text, 'publishedSince', go.published_since) from dpdp.grievance_officer go where go.org_id = v_org and go.superseded_at is null order by go.published_since desc nulls last limit 1)
    ) into v_out;

  elsif v_k = 'processors' then
    select coalesce(jsonb_agg(jsonb_build_object(
      'direction', case when r.from_org = v_org then 'we share data with' else 'shares data with us' end,
      'firm', o.name, 'kind', r.kind::text, 'agreementSignedAt', r.agreement_signed_at, 'scope', r.scope, 'startedAt', r.started_at, 'endedAt', r.ended_at
    ) order by r.started_at desc nulls last), '[]'::jsonb)
      into v_out from dpdp.relationship r join dpdp.organisation o on o.id = case when r.from_org = v_org then r.to_org else r.from_org end
      where r.from_org = v_org or r.to_org = v_org;

  elsif v_k = 'groups' then
    select jsonb_build_object(
      'principalGroups', (select coalesce(jsonb_agg(jsonb_build_object('label', pg.label, 'estimatedCount', pg.est_count) order by pg.label), '[]'::jsonb) from dpdp.principal_group pg where pg.org_id = v_org),
      'consentCampaigns', (select coalesce(jsonb_agg(jsonb_build_object('sentAt', cc.sent_at, 'channel', cc.channel::text,
          'sent', (select count(*) from dpdp.consent_token t where t.campaign_id = cc.id),
          'opened', (select count(*) from dpdp.consent_token t where t.campaign_id = cc.id and t.opened_at is not null),
          'answered', (select count(*) from dpdp.consent_token t where t.campaign_id = cc.id and t.acted_at is not null)) order by cc.sent_at desc), '[]'::jsonb) from dpdp.consent_campaign cc where cc.org_id = v_org)
    ) into v_out;

  elsif v_k = 'proof' then
    select coalesce(jsonb_agg(jsonb_build_object('jobId', a.obligation_id, 'files', a.n, 'accepted', a.accepted, 'latestUploadedAt', a.latest) order by a.latest desc), '[]'::jsonb)
      into v_out from (
        select x.obligation_id, count(*) as n, count(*) filter (where x.accepted_by is not null) as accepted, max(x.t_uploaded) as latest
        from dpdp.artefact x where x.org_id = v_org and x.deleted_at is null group by x.obligation_id
      ) a;

  elsif v_k = 'plan' then
    select jsonb_build_object('band', s.band_key, 'state', s.state::text, 'interval', s."interval"::text, 'seatsUsed', s.seats_used, 'trialEndsAt', s.trial_ends_at)
      into v_out from dpdp.subscription s where s.org_id = v_org;
    v_out := coalesce(v_out, '{}'::jsonb);

  else
    raise exception 'Unknown register "%". Use one of: data-map, notices, people, rights, grievances, breach, public-page, processors, groups, proof, plan.', coalesce(p_kind, '') using errcode = '22023';
  end if;

  return jsonb_build_object('kind', v_k, 'data', coalesce(v_out, '[]'::jsonb));
end
$$;

revoke all on function public.dpdp_ai_link_register(text, text) from public, anon, authenticated;
grant execute on function public.dpdp_ai_link_register(text, text) to service_role, app_runtime;
