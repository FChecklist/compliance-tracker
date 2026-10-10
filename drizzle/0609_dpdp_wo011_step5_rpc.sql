-- WO-DPDP-011 Step 5: "everything in §4 -- finish what WO-010 left, on the
-- new architecture only". The remaining WO-010 flows, ported from the
-- Next.js services onto the Step 2 RPC path (drizzle/0604) and the Step 4
-- token path (drizzle/0606):
--   * dpdp_answer_group          answerGroupObligation() -- the three answers
--                                and the roll-up (dpdp-obligation-service.ts)
--   * dpdp_my_clients            listCaClientOrgs() -- the CA firm view
--                                (dpdp-organisation-service.ts)
--   * dpdp_create_client_org     createDpdpOrganisation() +
--                                instantiateObligationsForOrg() for a CA
--                                caller -- "+ Add a client" / "Set it up for
--                                them"
--   * dpdp_org_setup /           the owner-review-when-the-CA-set-it-up first
--     dpdp_owner_confirm_setup   visit (organisation.set_up_by_membership_id /
--                                owner_confirmed_at, WO-010 §2 columns that
--                                no service ever wrote until now)
--   * dpdp_parent_consent_preview / dpdp_parent_consent
--                                resolveConsentToken() / recordConsent()
--                                (dpdp-principal-service.ts) -- the parent
--                                consent page; Yes and No are both answers.
-- Same rules as 0604/0605/0606, restated so this file stands on its own:
--   * public schema only; dpdp.* stays unreachable from a browser.
--   * SECURITY DEFINER, search_path = '', caller resolved from the JWT via
--     public.dpdp__caller_identity_id() / public.dpdp__caller_membership()
--     -- never from an argument. The two parent-consent functions are the
--     exception, on purpose: the opaque consent token IS the credential,
--     exactly as dpdp_apply_email_action / dpdp_unsubscribe (0606) and as
--     /api/dpdp/p/[token] worked; they are anon-callable and return
--     { ok:false, reason } rather than raising, like 0606's.
--   * Every write appends exactly one dpdp.event per logical action via
--     public.dpdp__append_event, in the same transaction, with the kinds
--     and summaries the TypeScript services write.
--   * Refusals raise the TS's own plain-English messages with 42501
--     ("Not a member of this organisation", "You aren't a member of the
--     group this job is assigned to", "Only the owner can do this"), P0002
--     ("Job not found") or P0001 (the TS's 409s).
--   * Additive only (WO-011 §6): new functions, no table changes, nothing
--     from 0604-0608 is re-issued.
--
-- What is deliberately NOT here: a dpdp_ca_partner_first_visit function.
-- The Next.js tree has no CA-partner first-visit code at all (WO-010's own
-- progress note lists it as "STILL TO BUILD"), and the three steps the
-- static app now shows (your clients -> add one -> got it) need nothing
-- beyond dpdp_my_clients, dpdp_create_client_org and the existing
-- dpdp_acknowledge_welcome (membership.first_visit_seen_at). Inventing a
-- table for it would be a schema change with no reader.

-- ---------------------------------------------------------------------
-- Internal helper -- not callable from the browser (revoked below).
-- ---------------------------------------------------------------------

-- instantiateObligationsForOrg() for one org, faithfully: every template
-- of the CURRENT library version whose product is the org's (or null --
-- library-agnostic, none today), skipping templates the org already has
-- an obligation for under that version (idempotent), due_on = today +
-- default_days, then depends_on_key resolved to THIS org's own obligation
-- ids. The event is the TS's own: actor_label 'system', kind
-- obligation_assigned, "<n> jobs opened from library <version>". Returns
-- the number of obligations created.
create or replace function public.dpdp__instantiate_obligations(p_org_id text, p_actor_identity_id text)
returns int
language plpgsql security definer
set search_path = ''
as $$
declare
  v_version_id text;
  v_version text;
  v_product text;
  v_created int;
begin
  select v.id, v.version into v_version_id, v_version from dpdp.library_version v where v.is_current = true limit 1;
  if v_version_id is null then
    raise exception 'No dpdp.library_version marked is_current -- run ensureDraftObligationLibrarySeeded() or seed one';
  end if;
  select o.product into v_product from dpdp.organisation o where o.id = p_org_id;

  insert into dpdp.obligation (id, org_id, template_id, library_version_used, due_on)
  select replace(gen_random_uuid()::text, '-', ''), p_org_id, t.id, v_version_id, current_date + t.default_days
  from dpdp.obligation_template t
  where t.library_version_id = v_version_id
    and (t.product is null or t.product = v_product)
    and not exists (
      select 1 from dpdp.obligation o where o.org_id = p_org_id and o.library_version_used = v_version_id and o.template_id = t.id
    );
  get diagnostics v_created = row_count;
  if v_created = 0 then
    return 0;
  end if;

  update dpdp.obligation o
  set depends_on_obligation_id = d.id
  from dpdp.obligation_template t
  join dpdp.obligation_template dt on dt.library_version_id = t.library_version_id and dt.key = t.depends_on_key
  join dpdp.obligation d on d.template_id = dt.id and d.org_id = p_org_id
  where o.template_id = t.id and o.org_id = p_org_id and o.depends_on_obligation_id is null and t.depends_on_key is not null;

  perform public.dpdp__append_event(p_org_id, p_actor_identity_id, 'system', 'obligation_assigned', v_created || ' jobs opened from library ' || v_version);
  return v_created;
end
$$;

-- ---------------------------------------------------------------------
-- Browser-callable surface (authenticated role).
-- ---------------------------------------------------------------------

-- answerGroupObligation() as an RPC. The caller must be a member of the
-- job's org (a job in an org they cannot see is "Job not found", as
-- 0605's owner RPCs do) AND of the staff group the job is assigned to.
-- Upserts dpdp.obligation_group_answer on its (obligation_id,
-- membership_id) unique constraint so changing an answer never double-
-- counts; progress_done = how many have ANSWERED (any of the three); the
-- job closes once everyone has answered -- the same rule 0606's
-- apply_email_action applies, copied, so the email button and the page
-- button agree. One event, the TS's own kind and summary.
create or replace function public.dpdp_answer_group(p_obligation_id text, p_answer text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_identity text;
  v_label text;
  v_o dpdp.obligation;
  v_m dpdp.membership;
  v_dep_state text;
  v_name text;
  v_now timestamp := (clock_timestamp() at time zone 'UTC');
  v_answered int;
  v_all boolean;
begin
  v_identity := public.dpdp__caller_identity_id();
  select o.* into v_o from dpdp.obligation o where o.id = p_obligation_id;
  if v_identity is null or v_o.id is null then
    raise exception 'Job not found' using errcode = 'P0002';
  end if;
  v_m := public.dpdp__caller_membership(v_o.org_id);
  if v_m.id is null then
    raise exception 'Job not found' using errcode = 'P0002';
  end if;
  if p_answer is null or p_answer not in ('done', 'never_had_any', 'cannot') then
    raise exception 'That is not an answer this job can record.' using errcode = '22023';
  end if;
  if v_o.assigned_staff_group_id is null then
    raise exception 'This job isn''t assigned to a group' using errcode = 'P0001';
  end if;
  if v_o.depends_on_obligation_id is not null then
    select d.state into v_dep_state from dpdp.obligation d where d.id = v_o.depends_on_obligation_id;
    if v_dep_state is not null and v_dep_state <> 'closed' then
      raise exception 'Waiting — the step before this one isn''t done yet' using errcode = 'P0001';
    end if;
  end if;
  if not exists (
    select 1 from dpdp.staff_group_member sgm where sgm.group_id = v_o.assigned_staff_group_id and sgm.membership_id = v_m.id
  ) then
    raise exception 'You aren''t a member of the group this job is assigned to' using errcode = '42501';
  end if;

  insert into dpdp.obligation_group_answer (id, obligation_id, membership_id, answer, answered_at)
  values (replace(gen_random_uuid()::text, '-', ''), v_o.id, v_m.id, p_answer::dpdp.group_answer, v_now)
  on conflict (obligation_id, membership_id) do update set answer = excluded.answer, answered_at = excluded.answered_at;

  select count(*)::int into v_answered from dpdp.obligation_group_answer ga where ga.obligation_id = v_o.id;
  v_all := v_answered >= v_o.progress_total;
  update dpdp.obligation
  set progress_done = v_answered,
      state = case when v_all then 'closed' else state end,
      closed_at = case when v_all then v_now else closed_at end,
      closed_by = case when v_all then v_identity else closed_by end
  where id = v_o.id;

  select i.primary_email into v_label from dpdp.identity i where i.id = v_identity;
  select t.name into v_name from dpdp.obligation_template t where t.id = v_o.template_id;
  perform public.dpdp__append_event(v_o.org_id, v_identity, v_label,
    case when p_answer = 'cannot' then 'task_answer_refused' else 'task_answered' end,
    v_label || ' answered "' || case p_answer when 'done' then 'Done' when 'never_had_any' then 'Doesn''t apply to me' else 'I can''t' end
      || '" for "' || coalesce(v_name, 'a job') || '" (' || v_answered || ' of ' || v_o.progress_total || ')');
  return jsonb_build_object('ok', true, 'answered', v_answered, 'total', v_o.progress_total, 'closed', v_all);
end
$$;

-- listCaClientOrgs() as an RPC: every org where the caller holds an ACTIVE
-- membership AND is named on a live CAPARTNER- or CAMGR-tagged job (the
-- TS's own rule for "is this person a CA here" -- there is no CA level in
-- dpdp.membership; caSub is partner if any CAPARTNER job names them, else
-- manager). Oldest client relationship first (membership.created_at), the
-- order the TS had to add. done/total count live (non-n/a) jobs, closed or
-- submitted = done.
--
-- whereItIs: WO-010's "Where it is" column is where the client's FILE
-- stands (the WO-010 progress note calls it "stage computation"), not a
-- data-map location, so it is derived from the jobs -- this migration's
-- own labels, since no Next.js code ever computed it:
--   "Waiting for the owner to confirm"  set up by a CA, owner not yet confirmed
--   "Not started"                       nothing done yet
--   "Signed off"                        every live job done
--   "Ready to sign"                     only CAPARTNER jobs still open
--   "With the CA manager"               only CAMGR/CAPARTNER jobs still open
--   "In progress"                       anything else
-- dataLocations is the count of dpdp.data_location rows under the org's
-- data categories (the brief's reading of the column), so both meanings
-- are available to the UI without a second call.
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
           when bool_or(t.role_tag = 'CAMGR' and ob.assigned_person_id = v_identity and ob.state <> 'not_applicable') then 'manager' end as ca_sub,
      (count(*) filter (where ob.state in ('closed', 'submitted')))::int as done,
      (count(*) filter (where ob.state <> 'not_applicable'))::int as total,
      (count(*) filter (where ob.state not in ('closed', 'submitted', 'not_applicable') and t.role_tag = 'CAMGR'))::int as open_mgr,
      (count(*) filter (where ob.state not in ('closed', 'submitted', 'not_applicable') and coalesce(t.role_tag, '') not in ('CAMGR', 'CAPARTNER')))::int as open_other,
      (select count(*)::int from dpdp.data_location dl join dpdp.data_category dc on dc.id = dl.category_id where dc.org_id = m.org_id) as data_locations
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

-- "+ Add a client" / "Set it up for them": createDpdpOrganisation() +
-- instantiateObligationsForOrg() for a CA caller. The TS never had a CA-
-- level rule (any signed-in identity may create an org via the signup
-- route), so the rule here is the brief's fallback: any authenticated
-- caller who already holds an ACTIVE membership somewhere may create a
-- client org. The caller becomes the client's CA partner: a staff
-- membership (joined_via 'created' -- they made the org) that is recorded
-- as organisation.set_up_by_membership_id, and every CAPARTNER-tagged job
-- assigned to them -- which is exactly what makes dpdp_my_clients list the
-- org and dpdp_my_page report caSub 'partner'. Optionally the client's
-- owner, by email: identity (+identity_email) find-or-create and an ACTIVE
-- owner membership (joined_via 'invited'; the TS's PENDING-until-first-
-- sign-in state would lock them out of dpdp__caller_membership, which
-- only sees active rows) with can_sign granted by the separate UPDATE the
-- TS also performs (the no-sign-at-join trigger forbids it on INSERT).
-- The owner then lands on the "looks right -- confirm" review screen
-- (dpdp_org_setup / dpdp_owner_confirm_setup below). Slug: the TS's
-- slugify() + "-n" until unique. Events, in order: organisation_created,
-- obligation_assigned (from the helper), membership_named_in_role for the
-- CA, membership_named_in_role for the owner if given.
create or replace function public.dpdp_create_client_org(p_name text, p_product text, p_owner_email text default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_identity text;
  v_label text;
  v_name text := trim(coalesce(p_name, ''));
  v_owner text := lower(trim(coalesce(p_owner_email, '')));
  v_base text;
  v_slug text;
  v_n int := 1;
  v_org_id text;
  v_ca_membership_id text;
  v_owner_identity text;
  v_owner_membership_id text;
  v_jobs int;
begin
  v_identity := public.dpdp__caller_identity_id();
  if v_identity is null or not exists (select 1 from dpdp.membership m where m.identity_id = v_identity and m.state = 'active') then
    raise exception 'Not a member of this organisation' using errcode = '42501';
  end if;
  if v_name = '' then
    raise exception 'An organisation name is required' using errcode = '22023';
  end if;
  if p_product is null or p_product not in ('firm', 'institution') then
    raise exception 'product must be ''firm'' or ''institution''' using errcode = '22023';
  end if;
  select i.primary_email into v_label from dpdp.identity i where i.id = v_identity;

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

  v_ca_membership_id := replace(gen_random_uuid()::text, '-', '');
  insert into dpdp.membership (id, identity_id, org_id, level, joined_via)
  values (v_ca_membership_id, v_identity, v_org_id, 'staff', 'created');
  update dpdp.organisation set set_up_by_membership_id = v_ca_membership_id where id = v_org_id;

  perform public.dpdp__append_event(v_org_id, v_identity, v_label, 'organisation_created', 'Organisation "' || v_name || '" created');
  v_jobs := public.dpdp__instantiate_obligations(v_org_id, v_identity);

  update dpdp.obligation o
  set assigned_person_id = v_identity
  from dpdp.obligation_template t
  where t.id = o.template_id and o.org_id = v_org_id and t.role_tag = 'CAPARTNER';
  perform public.dpdp__append_event(v_org_id, v_identity, v_label, 'membership_named_in_role', 'Named ' || v_label || ' as CA partner');

  if v_owner <> '' then
    v_owner_identity := public.dpdp__find_or_create_identity(v_owner);
    v_owner_membership_id := replace(gen_random_uuid()::text, '-', '');
    insert into dpdp.membership (id, identity_id, org_id, level, joined_via)
    values (v_owner_membership_id, v_owner_identity, v_org_id, 'owner', 'invited');
    update dpdp.membership set can_sign = true where id = v_owner_membership_id;
    perform public.dpdp__append_event(v_org_id, v_identity, v_label, 'membership_named_in_role', 'Named ' || v_owner || ' as owner');
  end if;

  return jsonb_build_object('ok', true, 'orgId', v_org_id, 'slug', v_slug, 'jobs', v_jobs, 'ownerMembershipId', v_owner_membership_id);
end
$$;

-- The owner-review-when-the-CA-set-it-up first visit needs one fact the
-- page does not carry: who set this org up, and whether the owner has
-- confirmed. Member-only read of organisation.set_up_by_membership_id /
-- owner_confirmed_at. setUpBy is null when the owner set the org up
-- themselves (never needed confirming).
create or replace function public.dpdp_org_setup(p_org_id text default null)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_m dpdp.membership;
  v_org dpdp.organisation;
  v_by_email text;
begin
  v_m := public.dpdp__caller_membership(p_org_id);
  if v_m.id is null then
    raise exception 'Not a member of this organisation' using errcode = '42501';
  end if;
  select o.* into v_org from dpdp.organisation o where o.id = v_m.org_id;
  if v_org.set_up_by_membership_id is not null then
    select i.primary_email into v_by_email
    from dpdp.membership sm join dpdp.identity i on i.id = sm.identity_id
    where sm.id = v_org.set_up_by_membership_id;
  end if;
  return jsonb_build_object(
    'orgId', v_org.id,
    'setUpBy', case when v_org.set_up_by_membership_id is null then null
               else jsonb_build_object('membershipId', v_org.set_up_by_membership_id, 'email', v_by_email) end,
    'ownerConfirmedAt', v_org.owner_confirmed_at
  );
end
$$;

-- "Looks right -- confirm": the client owner's own act on first visit when
-- a CA set the org up (WO-010 §2's owner_confirmed_at). Owner-only. Stamps
-- owner_confirmed_at AND the owner's first_visit_seen_at (this IS their
-- first visit; the wizard must not follow). Idempotent after the first
-- confirmation; refused when there is nothing to confirm.
create or replace function public.dpdp_owner_confirm_setup(p_org_id text default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_m dpdp.membership;
  v_org dpdp.organisation;
  v_email text;
  v_now timestamp := (clock_timestamp() at time zone 'UTC');
begin
  v_m := public.dpdp__caller_membership(p_org_id);
  if v_m.id is null then
    raise exception 'Not a member of this organisation' using errcode = '42501';
  end if;
  if v_m.level <> 'owner' then
    raise exception 'Only the owner can do this' using errcode = '42501';
  end if;
  select o.* into v_org from dpdp.organisation o where o.id = v_m.org_id;
  if v_org.set_up_by_membership_id is null then
    raise exception 'Nothing to confirm — this organisation was set up by its owner' using errcode = 'P0001';
  end if;
  if v_org.owner_confirmed_at is not null then
    return jsonb_build_object('ok', true, 'alreadyConfirmed', true);
  end if;
  update dpdp.organisation set owner_confirmed_at = v_now where id = v_org.id;
  update dpdp.membership set first_visit_seen_at = coalesce(first_visit_seen_at, v_now) where id = v_m.id;
  select i.primary_email into v_email from dpdp.identity i where i.id = v_m.identity_id;
  perform public.dpdp__append_event(v_org.id, v_m.identity_id, v_email, 'organisation_owner_confirmed', v_email || ' confirmed the list their CA set up');
  return jsonb_build_object('ok', true, 'alreadyConfirmed', false);
end
$$;

-- ---------------------------------------------------------------------
-- The parent consent page (anon key + the consent token as credential).
-- ---------------------------------------------------------------------

-- resolveConsentToken() as an RPC: what the page shows before any answer.
-- Not stable on purpose: the TS stamps opened_at on first open and so does
-- this (that stamp is informational; it records nothing about the person
-- and changes no answer). An unknown or expired token is a plain reason,
-- never an error, and a scanner prefetching the link records nothing but
-- that stamp. alreadyAnswered lets the page show "Saved, thank you"
-- straight away on a link that has already been used.
create or replace function public.dpdp_parent_consent_preview(p_token text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_t dpdp.consent_token;
  v_c dpdp.consent_campaign;
  v_n dpdp.notice_version;
  v_org text;
begin
  select t.* into v_t from dpdp.consent_token t where t.token = coalesce(p_token, '');
  if v_t.id is null or v_t.expires_at < (clock_timestamp() at time zone 'UTC') then
    return jsonb_build_object('ok', false, 'reason', 'This link is not valid or has expired');
  end if;
  select c.* into v_c from dpdp.consent_campaign c where c.id = v_t.campaign_id;
  if v_c.id is null then
    return jsonb_build_object('ok', false, 'reason', 'This link is not valid or has expired');
  end if;
  select n.* into v_n from dpdp.notice_version n where n.id = v_c.notice_version_id;
  select o.name into v_org from dpdp.organisation o where o.id = v_c.org_id;
  if v_t.opened_at is null then
    update dpdp.consent_token set opened_at = (clock_timestamp() at time zone 'UTC') where id = v_t.id;
  end if;
  return jsonb_build_object(
    'ok', true,
    'orgName', v_org,
    'notice', case when v_n.id is null then null else jsonb_build_object('docKind', v_n.doc_kind, 'version', v_n.version, 'languages', to_jsonb(v_n.languages)) end,
    'openedAt', v_t.opened_at,
    'actedAt', v_t.acted_at,
    'alreadyAnswered', (v_t.acted_at is not null)
  );
end
$$;

-- recordConsent() as an RPC, one answer: 'yes' or 'no'. "No is a valid
-- answer": it is recorded exactly as a yes is -- a consent_record row with
-- granted=false and withdrawn_at set (the TS's own shape for a refused
-- purpose), never a missing row. Single use: a token that has already
-- acted is refused and nothing changes. purpose_key 'consent' -- the one
-- question the parent page asks; language 'en'. One event, the TS's own
-- ('consent_recorded', "Recorded 1 answer(s)", actor "A person on a link",
-- no identity -- a Data Principal never has one).
create or replace function public.dpdp_parent_consent(p_token text, p_answer text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_t dpdp.consent_token;
  v_c dpdp.consent_campaign;
  v_now timestamp := (clock_timestamp() at time zone 'UTC');
  v_granted boolean;
begin
  if p_answer is null or p_answer not in ('yes', 'no') then
    return jsonb_build_object('ok', false, 'reason', 'That is not an answer this link can record.');
  end if;
  select t.* into v_t from dpdp.consent_token t where t.token = coalesce(p_token, '');
  if v_t.id is null or v_t.expires_at < v_now then
    return jsonb_build_object('ok', false, 'reason', 'This link is not valid or has expired');
  end if;
  select c.* into v_c from dpdp.consent_campaign c where c.id = v_t.campaign_id;
  if v_c.id is null then
    return jsonb_build_object('ok', false, 'reason', 'This link is not valid or has expired');
  end if;
  if v_t.acted_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'This link has already been used. Nothing has changed.');
  end if;
  v_granted := (p_answer = 'yes');
  insert into dpdp.consent_record (id, token_id, purpose_key, granted, notice_version_id, language, recorded_at, withdrawn_at)
  values (replace(gen_random_uuid()::text, '-', ''), v_t.id, 'consent', v_granted, v_c.notice_version_id, 'en', v_now, case when v_granted then null else v_now end);
  update dpdp.consent_token set acted_at = v_now, opened_at = coalesce(opened_at, v_now) where id = v_t.id;
  perform public.dpdp__append_event(v_c.org_id, null, 'A person on a link', 'consent_recorded', 'Recorded 1 answer(s)');
  return jsonb_build_object('ok', true, 'answer', p_answer);
end
$$;

-- ---------------------------------------------------------------------
-- Grants: identical policy to 0604/0605 for the signed-in functions
-- (authenticated + app_runtime, the latter so the repo's DB-gated tests
-- exercise the real RPC path with set_config('request.jwt.claims', ...)
-- standing in for the JWT -- with no claims set every one refuses); 0606's
-- policy for the two token functions (anon too: the token is the
-- credential). The helper is callable by nobody directly.
-- ---------------------------------------------------------------------
revoke all on function public.dpdp__instantiate_obligations(text, text) from public, anon, authenticated;

revoke all on function public.dpdp_answer_group(text, text) from public, anon;
revoke all on function public.dpdp_my_clients() from public, anon;
revoke all on function public.dpdp_create_client_org(text, text, text) from public, anon;
revoke all on function public.dpdp_org_setup(text) from public, anon;
revoke all on function public.dpdp_owner_confirm_setup(text) from public, anon;
grant execute on function public.dpdp_answer_group(text, text) to authenticated, app_runtime;
grant execute on function public.dpdp_my_clients() to authenticated, app_runtime;
grant execute on function public.dpdp_create_client_org(text, text, text) to authenticated, app_runtime;
grant execute on function public.dpdp_org_setup(text) to authenticated, app_runtime;
grant execute on function public.dpdp_owner_confirm_setup(text) to authenticated, app_runtime;

revoke all on function public.dpdp_parent_consent_preview(text) from public;
revoke all on function public.dpdp_parent_consent(text, text) from public;
grant execute on function public.dpdp_parent_consent_preview(text) to anon, authenticated, service_role, app_runtime;
grant execute on function public.dpdp_parent_consent(text, text) to anon, authenticated, service_role, app_runtime;
