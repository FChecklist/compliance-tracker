-- PRE-APPROVED-LIVE-DDL: Owner DPDP compliance fix programme brief, 2026-10-05, Wave 1 (AI work link hides other people's e-mail addresses by default; Grievance Officer shown by role only)
--
-- DPDP compliance programme, Wave 1 (AI link). Three changes, all idempotent:
--  1. Other people's e-mail addresses are hidden by default. dpdp.ai_link.hide_emails now defaults to TRUE, every existing link is switched to TRUE,
--     and the two functions that make links (dpdp_ai_link_create, used by the AI Link page; dpdp_timer_mint_email_ai_link, used by the Monday e-mail)
--     now default to TRUE as well. The person can still untick the box when making a link on the AI Link page; the e-mailed link is always hidden.
--     Bodies are the 0610 and 0695 definitions with only the default changed.
--  2. dpdp_ai_link_register (0694): the Grievance Officer in the public-page register is given by role only ({role, appointmentMode, publishedSince});
--     the officer's name and e-mail address are no longer returned to an AI at all.
--  3. Nothing else changes: signatures, grants and search_path are the same, so `create or replace` keeps the existing privileges.
-- Rollback: drizzle/down/0696_dpdp_ai_link_hide_emails_default.down.sql (restores the default only; the hidden-by-default data change is not undone).

alter table dpdp.ai_link alter column hide_emails set default true;
update dpdp.ai_link set hide_emails = true where hide_emails is not true;

create or replace function public.dpdp_ai_link_create(
  p_level integer default 0, p_hide_emails boolean default true, p_days integer default 7, p_label text default null, p_org_id text default null
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_m dpdp.membership;
  v_email text;
  v_token text;
  v_hash text;
  v_now timestamp := (clock_timestamp() at time zone 'UTC');
  v_expires timestamp;
  v_id text;
  v_level integer := coalesce(p_level, 0);
  v_days integer := coalesce(p_days, 7);
  v_label text := nullif(left(trim(coalesce(p_label, '')), 80), '');
  v_warning jsonb;
begin
  v_m := public.dpdp__caller_membership(p_org_id);
  if v_m.id is null then
    raise exception 'Not a member of this organisation' using errcode = '42501';
  end if;
  if v_level not in (0, 1) then
    raise exception 'level must be 0 (read, analyse, report) or 1 (small edits, directly). Anything with legal weight is always a draft.' using errcode = '22023';
  end if;
  if v_days not in (1, 7, 30) then
    raise exception 'The link can last 1, 7 or 30 days' using errcode = '22023';
  end if;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  v_hash := encode(sha256(convert_to(v_token, 'UTF8')), 'hex');
  v_expires := v_now + make_interval(days => v_days);
  v_id := replace(gen_random_uuid()::text, '-', '');

  insert into dpdp.ai_link (
    id, org_id, identity_id, membership_id, token, token_hash, created_at, expires_at, read_count,
    authority_level, hide_emails, created_by_membership_id, label, call_count
  ) values (
    v_id, v_m.org_id, v_m.identity_id, v_m.id, null, v_hash, v_now, v_expires, 0,
    v_level, coalesce(p_hide_emails, true), v_m.id, v_label, 0
  );

  select i.primary_email into v_email from dpdp.identity i where i.id = v_m.identity_id;
  perform public.dpdp__append_event(
    v_m.org_id, v_m.identity_id, v_email, 'ai_link_created', 'Made an AI work link',
    'Level ' || v_level || case when v_level = 1 then ' (small edits, directly)' else ' (read, analyse, report)' end
      || case when coalesce(p_hide_emails, true) then ', other people''s emails hidden' else '' end
      || ', expires ' || to_char(v_expires, 'YYYY-MM-DD HH24:MI') || ' UTC'
      || case when v_label is not null then ', "' || v_label || '"' else '' end
  );

  v_warning := public.dpdp__ai_link_warning_for(v_m.id);
  return jsonb_build_object(
    'linkId', v_id,
    'token', v_token,
    'level', v_level,
    'hideEmails', coalesce(p_hide_emails, true),
    'label', v_label,
    'expiresAt', to_char(v_expires, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'jobs', v_warning -> 'jobs',
    'people', v_warning -> 'people'
  );
end
$$;

create or replace function public.dpdp_timer_mint_email_ai_link(
  p_membership_id text,
  p_level integer default 1,
  p_days integer default 2
)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_m dpdp.membership;
  v_token text;
  v_hash text;
  v_now timestamp := (clock_timestamp() at time zone 'UTC');
  v_expires timestamp;
  v_id text;
  v_level integer := coalesce(p_level, 1);
  v_days integer := coalesce(p_days, 2);
  v_warning jsonb;
begin
  select m.* into v_m from dpdp.membership m where m.id = p_membership_id and m.state = 'active';
  if v_m.id is null then
    raise exception 'No active membership %', p_membership_id using errcode = 'P0002';
  end if;
  if v_level not in (0, 1) then
    raise exception 'level must be 0 (read, analyse, report) or 1 (small edits, directly). Anything with legal weight is always a draft.' using errcode = '22023';
  end if;
  if v_days not in (1, 2, 7, 30) then
    raise exception 'An e-mailed link can last 1 day (a one-off mail), 2 days (the weekly mail), 7 or 30' using errcode = '22023';
  end if;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  v_hash := encode(sha256(convert_to(v_token, 'UTF8')), 'hex');
  v_expires := v_now + make_interval(days => v_days);
  v_id := replace(gen_random_uuid()::text, '-', '');

  insert into dpdp.ai_link (
    id, org_id, identity_id, membership_id, token, token_hash, created_at, expires_at, read_count,
    authority_level, hide_emails, created_by_membership_id, label, call_count
  ) values (
    v_id, v_m.org_id, v_m.identity_id, v_m.id, null, v_hash, v_now, v_expires, 0,
    v_level, true, v_m.id, 'Monday email', 0
  );

  v_warning := public.dpdp__ai_link_warning_for(v_m.id);
  return jsonb_build_object(
    'linkId', v_id,
    'token', v_token,
    'level', v_level,
    'expiresAt', to_char(v_expires, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'jobs', v_warning -> 'jobs',
    'people', v_warning -> 'people'
  );
end
$$;

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
      'grievanceOfficer', (select jsonb_build_object('role', 'Grievance Officer', 'appointmentMode', go.appointment_mode::text, 'publishedSince', go.published_since) from dpdp.grievance_officer go where go.org_id = v_org and go.superseded_at is null order by go.published_since desc nulls last limit 1)
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
