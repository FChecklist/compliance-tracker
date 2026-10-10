-- WO-DPDP-012 §7 "AI-working optimised: the AI link", built on the WO-011
-- server-less path (browser -> Supabase RPC; one Edge Function for the
-- non-browser reader; Vercel nowhere in the path). This PORTS the design the
-- owner approved on 15 Sep -- previously implemented Next.js-side in
-- src/lib/services/dpdp-ai-link-service.ts + src/app/api/dpdp/{ai-link,
-- ai/[token],ai-work}/* -- it does not redesign it:
--   * Read-only, scoped to one person. dpdp_ai_link_read returns exactly
--     what dpdp_my_page (0604) shows that membership, filtered to the rows
--     the one-page UI itself shows a staff viewer (OnePageView.tsx:41 --
--     `by === me`, or a group job they are a member of). No email appears
--     that the person could not already see on their own page.
--   * Carries no authority. Reading it can only produce a DRAFT row
--     (dpdp_draft_action writes one row to dpdp.ai_draft and nothing else --
--     no event, no obligation change). The person opens the draft in their
--     own browser, signs in, and confirms (dpdp_confirm_ai_draft): the
--     confirming session's own membership must BE the membership the link
--     was made for, and the verb is applied under that person's authority.
--   * Five verbs only: ASSIGN, SET_DUE, NOTE, MARK_NA, DRAFT. close /
--     delete / add or remove people / change who can sign / publish /
--     export do not exist as code paths here: ai_draft.verb carries a CHECK
--     allowlist, dpdp_draft_action refuses anything else before it looks at
--     the job, and dpdp_confirm_ai_draft's CASE has an ELSE that raises.
--   * Never the sign-in link, never contains a sign-in token. The AI token
--     is 32 random bytes whose sha256 alone is stored (the plaintext is
--     returned exactly once, by dpdp_create_ai_link); the confirm token
--     likewise. Neither is a GoTrue session, magic link or JWT, and nothing
--     here can mint one.
--   * History records "drafted by AI, confirmed by <person email>".
--
-- Additive only (WO-011 §6): ai_link gains nullable columns (+ read_count
-- with a default) and its `token` NOT NULL is relaxed so the new path can
-- store a hash only; ai_draft is new; no existing function is replaced;
-- 0604's helpers (dpdp__caller_membership / dpdp__append_event) are reused
-- as-is. 0604's row builder is copied VERBATIM into
-- dpdp__rows_for_membership rather than dpdp_my_page being rewritten to call
-- it, because two parallel migrations (0605, 0606) may also touch
-- dpdp_my_page and a three-way CREATE OR REPLACE on one function body is
-- exactly the last-writer-wins collision the claims registry exists to
-- prevent. src/lib/services/dpdp-ai-link-rpc.test.ts asserts the two return
-- identical rows for the same member -- that is the drift guard until a
-- follow-up makes dpdp_my_page call the helper.
--
-- Conventions, all from 0604: functions live in `public` (the only schema
-- PostgREST exposes on this project), SECURITY DEFINER with search_path =
-- '', owned by postgres (bypassrls) so RLS never applies inside them and
-- EVERY scope below is an explicit WHERE; refusals raise errcode 42501 with
-- a plain-English message; pgcrypto lives in the `extensions` schema on this
-- project (verified live 2026-09-22), hence extensions.gen_random_bytes.
-- Naive timestamps hold UTC digits, as 0604 writes them.

-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------

alter table dpdp.ai_link add column if not exists membership_id text;
alter table dpdp.ai_link add column if not exists token_hash text;
alter table dpdp.ai_link add column if not exists last_read_at timestamp;
alter table dpdp.ai_link add column if not exists read_count integer not null default 0;
-- The pre-0607 Next.js path stores the plaintext token in `token`; this
-- path stores only sha256(token) in `token_hash`. One of the two must be
-- present; a row never has neither.
alter table dpdp.ai_link alter column token drop not null;
do $$ begin
  alter table dpdp.ai_link add constraint ai_link_token_hash_unique unique (token_hash);
exception when duplicate_object or duplicate_table then null; end $$;
do $$ begin
  alter table dpdp.ai_link add constraint ai_link_token_or_hash check (token is not null or token_hash is not null);
exception when duplicate_object then null; end $$;
create index if not exists ai_link_membership_id_idx on dpdp.ai_link (membership_id);

-- One row per draft an AI produced. Confirming it (dpdp_confirm_ai_draft)
-- is the ONLY way anything in it takes effect.
create table if not exists dpdp.ai_draft (
  id text primary key,
  ai_link_id text not null,
  membership_id text not null,
  org_id text not null,
  verb text not null,
  obligation_id text,
  payload jsonb,
  created_at timestamp not null default now(),
  expires_at timestamp not null,
  confirmed_at timestamp,
  confirmed_by text,
  confirm_token_hash text not null,
  constraint ai_draft_verb_allowlist check (verb in ('ASSIGN', 'SET_DUE', 'NOTE', 'MARK_NA', 'DRAFT')),
  constraint ai_draft_confirm_token_hash_unique unique (confirm_token_hash)
);
create index if not exists ai_draft_org_id_idx on dpdp.ai_draft (org_id);
create index if not exists ai_draft_membership_id_idx on dpdp.ai_draft (membership_id);

-- RLS: enabled, no anon/authenticated grant of any kind (the browser only
-- ever reaches these rows through the RPCs below). app_runtime gets the
-- same org-scoped policy every direct-org_id dpdp table has (0415/0424
-- pattern) so the Next.js server and the repo's DB-gated tests can inspect
-- rows under a tenant context; service_role bypasses as on every sibling.
alter table dpdp.ai_draft enable row level security;
do $$ begin
  create policy app_runtime_org_scoped on dpdp.ai_draft
    for all to app_runtime
    using (org_id = dpdp.current_org_id())
    with check (org_id = dpdp.current_org_id());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy service_role_bypass on dpdp.ai_draft for all to service_role using (true);
exception when duplicate_object then null; end $$;

-- ai_link / ai_link_read already carry app_runtime policies from 0424 but,
-- found live while writing this (has_table_privilege = false on all three
-- of SELECT/INSERT/UPDATE), never got the table GRANT that every other
-- dpdp table has -- so the pre-0607 Next.js service's own inserts would be
-- refused today. Granted here, under the policies 0424 already defined.
grant select, insert, update, delete on dpdp.ai_link, dpdp.ai_link_read to app_runtime;
grant select, insert, update, delete on dpdp.ai_draft to app_runtime, service_role;

-- ---------------------------------------------------------------------
-- Internal helpers -- not callable from any browser role (revoked below).
-- ---------------------------------------------------------------------

-- 0604 dpdp_my_page's role detection (its lines 135-157), verbatim, keyed
-- by membership id instead of the caller. owner | go | coord | ca | staff.
create or replace function public.dpdp__viewer_kind(p_membership_id text)
returns text
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_m dpdp.membership;
  v_identity text;
  v_kind text;
  v_ca_sub text;
begin
  select m.* into v_m from dpdp.membership m where m.id = p_membership_id;
  if v_m.id is null then
    return null;
  end if;
  v_identity := v_m.identity_id;

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
  return v_kind;
end
$$;

-- 0604 dpdp_my_page's row builder (its lines 159-191), VERBATIM apart from
-- v_m coming from p_membership_id. Same shape (view-model ObligationRow,
-- camelCase, `due` as YYYY-MM-DD), same template-key order. Returns every
-- row of the org -- the caller applies the viewer's visibility rule.
create or replace function public.dpdp__rows_for_membership(p_membership_id text)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_m dpdp.membership;
  v_rows jsonb;
begin
  select m.* into v_m from dpdp.membership m where m.id = p_membership_id;
  if v_m.id is null then
    return '[]'::jsonb;
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
      0 as sent
    from dpdp.obligation o
    join dpdp.obligation_template t on t.id = o.template_id
    where o.org_id = v_m.org_id
  ) r;

  return v_rows;
end
$$;

-- Resolves a plaintext AI token to its live link row, or raises. ONE message
-- for every failure mode (unknown, malformed, expired, revoked, membership
-- no longer active) so a caller learns nothing about which it was. Does not
-- count as a read -- dpdp_ai_link_read does the counting.
create or replace function public.dpdp__ai_link_for_token(p_token text)
returns dpdp.ai_link
language plpgsql security definer
set search_path = ''
as $$
declare
  v_hash text;
  v_l dpdp.ai_link;
  v_now timestamp := (clock_timestamp() at time zone 'UTC');
begin
  v_hash := encode(sha256(convert_to(left(coalesce(p_token, ''), 256), 'UTF8')), 'hex');
  select l.* into v_l from dpdp.ai_link l where l.token_hash = v_hash;
  if v_l.id is null
     or v_l.membership_id is null
     or v_l.revoked_at is not null
     or v_l.expires_at <= v_now
     or not exists (select 1 from dpdp.membership m where m.id = v_l.membership_id and m.state = 'active') then
    raise exception 'This link has expired or was revoked' using errcode = '42501';
  end if;
  return v_l;
end
$$;

-- ---------------------------------------------------------------------
-- Browser-callable (authenticated): make / revoke a link, preview and
-- confirm a draft. All resolve the caller from the JWT exactly as 0604.
-- ---------------------------------------------------------------------

-- "Copy AI link": returns the plaintext token ONCE. Only sha256(token) is
-- stored. One live link per membership -- making a new one retires the
-- previous one the same second ("rotating the token kills the old one
-- instantly", the approved design's own rule). TTL defaults to 7 days and
-- is capped at 30.
create or replace function public.dpdp_create_ai_link(p_org_id text default null, p_ttl_hours integer default 168)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_m dpdp.membership;
  v_email text;
  v_token text;
  v_hash text;
  v_ttl integer;
  v_now timestamp := (clock_timestamp() at time zone 'UTC');
  v_expires timestamp;
  v_id text;
  v_revoked integer;
begin
  v_m := public.dpdp__caller_membership(p_org_id);
  if v_m.id is null then
    raise exception 'Not a member of this organisation' using errcode = '42501';
  end if;

  v_ttl := least(greatest(coalesce(p_ttl_hours, 168), 1), 720);
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  v_hash := encode(sha256(convert_to(v_token, 'UTF8')), 'hex');
  v_expires := v_now + make_interval(hours => v_ttl);
  v_id := replace(gen_random_uuid()::text, '-', '');

  update dpdp.ai_link
  set revoked_at = v_now
  where membership_id = v_m.id and revoked_at is null and expires_at > v_now;
  get diagnostics v_revoked = row_count;

  insert into dpdp.ai_link (id, org_id, identity_id, membership_id, token, token_hash, created_at, expires_at, read_count)
  values (v_id, v_m.org_id, v_m.identity_id, v_m.id, null, v_hash, v_now, v_expires, 0);

  select i.primary_email into v_email from dpdp.identity i where i.id = v_m.identity_id;
  perform public.dpdp__append_event(
    v_m.org_id, v_m.identity_id, v_email, 'ai_link_created', 'Made an AI link',
    'Read-only, expires ' || to_char(v_expires, 'YYYY-MM-DD HH24:MI') || ' UTC'
  );

  return jsonb_build_object(
    'linkId', v_id,
    'token', v_token,
    'expiresAt', to_char(v_expires, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'revokedPrevious', v_revoked
  );
end
$$;

-- The link's own person, or the org's owner, may revoke it. Idempotent.
create or replace function public.dpdp_revoke_ai_link(p_link_id text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_l dpdp.ai_link;
  v_m dpdp.membership;
  v_email text;
  v_now timestamp := (clock_timestamp() at time zone 'UTC');
begin
  select l.* into v_l from dpdp.ai_link l where l.id = p_link_id;
  if v_l.id is null then
    raise exception 'Link not found' using errcode = 'P0002';
  end if;
  v_m := public.dpdp__caller_membership(v_l.org_id);
  if v_m.id is null
     or (v_m.id is distinct from v_l.membership_id and v_m.identity_id is distinct from v_l.identity_id and v_m.level <> 'owner') then
    raise exception 'Not your link' using errcode = '42501';
  end if;
  if v_l.revoked_at is null then
    update dpdp.ai_link set revoked_at = v_now where id = v_l.id;
    select i.primary_email into v_email from dpdp.identity i where i.id = v_m.identity_id;
    perform public.dpdp__append_event(v_l.org_id, v_m.identity_id, v_email, 'ai_link_revoked', 'Revoked an AI link');
  end if;
  return jsonb_build_object('ok', true);
end
$$;

-- ---------------------------------------------------------------------
-- Service-role only (the Edge Function): read the view, draft an action.
-- The token itself is the credential; there is no JWT on these calls.
-- ---------------------------------------------------------------------

-- Exactly the read-only view that membership is allowed: org name, the
-- viewer's own email (their own data), and the rows dpdp_my_page would
-- give them, filtered by the one-page UI's own staff rule. No sign-in
-- token of any kind, no membership/identity ids of anyone else.
create or replace function public.dpdp_ai_link_read(p_token text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_l dpdp.ai_link;
  v_m dpdp.membership;
  v_org dpdp.organisation;
  v_email text;
  v_kind text;
  v_all jsonb;
  v_rows jsonb;
  v_now timestamp := (clock_timestamp() at time zone 'UTC');
begin
  v_l := public.dpdp__ai_link_for_token(p_token);
  select m.* into v_m from dpdp.membership m where m.id = v_l.membership_id;

  update dpdp.ai_link set read_count = read_count + 1, last_read_at = v_now where id = v_l.id;

  select o.* into v_org from dpdp.organisation o where o.id = v_m.org_id;
  select i.primary_email into v_email from dpdp.identity i where i.id = v_m.identity_id;
  v_kind := public.dpdp__viewer_kind(v_m.id);
  v_all := public.dpdp__rows_for_membership(v_m.id);

  -- OnePageView.tsx:41 -- a staff (or parent) viewer sees only the jobs
  -- that are theirs, or group jobs they are actually in; everyone else
  -- (owner, coordinator, grievance officer, CA) sees the whole list.
  if v_kind in ('staff', 'parent') then
    select coalesce(jsonb_agg(e.value order by e.ord), '[]'::jsonb) into v_rows
    from jsonb_array_elements(v_all) with ordinality as e(value, ord)
    where (e.value ->> 'by') = v_email
       or (coalesce((e.value ->> 'isGroup')::boolean, false) and coalesce((e.value ->> 'viewerIsGroupMember')::boolean, false));
  else
    v_rows := v_all;
  end if;

  return jsonb_build_object(
    'org', jsonb_build_object('id', v_org.id, 'name', v_org.name, 'product', coalesce(v_org.product, 'firm')),
    'viewer', jsonb_build_object('email', v_email, 'kind', v_kind),
    'link', jsonb_build_object(
      'id', v_l.id,
      'expiresAt', to_char(v_l.expires_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'readCount', v_l.read_count + 1
    ),
    'verbs', jsonb_build_array('ASSIGN', 'SET_DUE', 'NOTE', 'MARK_NA', 'DRAFT'),
    'rows', v_rows
  );
end
$$;

-- Writes ONE dpdp.ai_draft row and nothing else -- no event, no obligation
-- change, no membership change. Validates the verb (five, nothing else),
-- that the job is inside the link's own scope, and the verb's payload with
-- the same rules classifyProposedLine() applied Next.js-side (MARK_NA
-- needs a written reason, an unknown target is refused). Returns the draft
-- id and a confirm token (plaintext once; only its sha256 is stored).
-- Drafts expire after 48 hours. Refusals here use errcode 22023 (invalid
-- parameter) so the Edge Function can pass the plain-English message back
-- to the AI as a 400, distinct from the 42501 "link gone" case.
create or replace function public.dpdp_draft_action(p_token text, p_verb text, p_obligation_id text default null, p_payload jsonb default '{}'::jsonb)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_l dpdp.ai_link;
  v_m dpdp.membership;
  v_kind text;
  v_verb text;
  v_payload jsonb;
  v_o dpdp.obligation;
  v_in_scope boolean;
  v_confirm text;
  v_confirm_hash text;
  v_id text;
  v_now timestamp := (clock_timestamp() at time zone 'UTC');
  v_expires timestamp;
begin
  v_l := public.dpdp__ai_link_for_token(p_token);
  select m.* into v_m from dpdp.membership m where m.id = v_l.membership_id;

  -- The verb allowlist, checked before anything else. Nothing outside these
  -- five has a code path anywhere in this migration.
  v_verb := upper(trim(coalesce(p_verb, '')));
  if v_verb not in ('ASSIGN', 'SET_DUE', 'NOTE', 'MARK_NA', 'DRAFT') then
    raise exception '"%" is not something an AI link may draft. Only ASSIGN, SET_DUE, NOTE, MARK_NA and DRAFT are.', coalesce(p_verb, '')
      using errcode = '22023';
  end if;

  v_payload := coalesce(p_payload, '{}'::jsonb);
  if jsonb_typeof(v_payload) <> 'object' then
    raise exception 'payload must be a JSON object' using errcode = '22023';
  end if;
  if length(v_payload::text) > 4000 then
    raise exception 'payload is too long (4000 characters at most)' using errcode = '22023';
  end if;

  -- The job must exist, belong to this link's org, and be one this link's
  -- person can see -- the same rule dpdp_ai_link_read applies. DRAFT is the
  -- one verb that may stand alone (it always makes something new).
  if v_verb <> 'DRAFT' or p_obligation_id is not null then
    if p_obligation_id is null then
      raise exception 'obligationId is required for % -- use a Job id from the table', v_verb using errcode = '22023';
    end if;
    select o.* into v_o from dpdp.obligation o where o.id = p_obligation_id and o.org_id = v_m.org_id;
    if v_o.id is null then
      raise exception 'That job does not exist, or is not one this link can see' using errcode = '22023';
    end if;
    v_kind := public.dpdp__viewer_kind(v_m.id);
    if v_kind in ('staff', 'parent') then
      v_in_scope := (v_o.assigned_staff_group_id is null and v_o.assigned_person_id = v_m.identity_id)
        or (v_o.assigned_staff_group_id is not null and exists (
          select 1 from dpdp.staff_group_member sgm where sgm.group_id = v_o.assigned_staff_group_id and sgm.membership_id = v_m.id
        ));
      if not coalesce(v_in_scope, false) then
        raise exception 'That job does not exist, or is not one this link can see' using errcode = '22023';
      end if;
    end if;
  end if;

  -- Per-verb payload rules (classifyProposedLine's, plus the shapes the
  -- confirm step needs). Nothing is applied here.
  if v_verb = 'ASSIGN' then
    if position('@' in coalesce(v_payload ->> 'email', '')) = 0 then
      raise exception 'ASSIGN needs payload.email -- the email of the person to give this job to' using errcode = '22023';
    end if;
    if v_o.assigned_staff_group_id is not null then
      raise exception 'That job belongs to a group -- it cannot be given to one person from an AI link' using errcode = '22023';
    end if;
  elsif v_verb = 'SET_DUE' then
    if coalesce(v_payload ->> 'dueOn', '') !~ '^\d{4}-\d{2}-\d{2}$' then
      raise exception 'SET_DUE needs payload.dueOn as a date, YYYY-MM-DD' using errcode = '22023';
    end if;
    begin
      perform (v_payload ->> 'dueOn')::date;
    exception when others then
      raise exception 'SET_DUE needs payload.dueOn as a real date, YYYY-MM-DD' using errcode = '22023';
    end;
  elsif v_verb = 'NOTE' then
    if trim(coalesce(v_payload ->> 'text', '')) = '' then
      raise exception 'NOTE needs payload.text' using errcode = '22023';
    end if;
    if length(v_payload ->> 'text') > 1000 then
      raise exception 'NOTE text is too long (1000 characters at most)' using errcode = '22023';
    end if;
  elsif v_verb = 'MARK_NA' then
    if trim(coalesce(v_payload ->> 'reason', '')) = '' then
      raise exception 'Marking something not applicable needs a written reason.' using errcode = '22023';
    end if;
    if length(v_payload ->> 'reason') > 1000 then
      raise exception 'MARK_NA reason is too long (1000 characters at most)' using errcode = '22023';
    end if;
  elsif v_verb = 'DRAFT' then
    if length(coalesce(v_payload ->> 'text', '')) > 1000 or length(coalesce(v_payload ->> 'docKind', '')) > 80 then
      raise exception 'DRAFT payload is too long (text 1000 / docKind 80 characters at most)' using errcode = '22023';
    end if;
  end if;

  v_confirm := encode(extensions.gen_random_bytes(32), 'hex');
  v_confirm_hash := encode(sha256(convert_to(v_confirm, 'UTF8')), 'hex');
  v_id := replace(gen_random_uuid()::text, '-', '');
  v_expires := v_now + interval '48 hours';

  insert into dpdp.ai_draft (id, ai_link_id, membership_id, org_id, verb, obligation_id, payload, created_at, expires_at, confirm_token_hash)
  values (v_id, v_l.id, v_m.id, v_m.org_id, v_verb, v_o.id, v_payload, v_now, v_expires, v_confirm_hash);

  return jsonb_build_object(
    'draftId', v_id,
    'confirmToken', v_confirm,
    'verb', v_verb,
    'obligationId', v_o.id,
    'expiresAt', to_char(v_expires, 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  );
end
$$;

-- ---------------------------------------------------------------------
-- Browser-callable (authenticated): the confirm screen.
-- ---------------------------------------------------------------------

-- What the person sees before pressing Confirm. Same gate as confirm: the
-- signed-in caller must be the draft's own membership and hold the token.
create or replace function public.dpdp_ai_draft_preview(p_draft_id text, p_confirm_token text)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_d dpdp.ai_draft;
  v_m dpdp.membership;
  v_org dpdp.organisation;
  v_name text;
  v_now timestamp := (clock_timestamp() at time zone 'UTC');
begin
  select d.* into v_d from dpdp.ai_draft d where d.id = p_draft_id;
  if v_d.id is null or v_d.confirm_token_hash <> encode(sha256(convert_to(left(coalesce(p_confirm_token, ''), 256), 'UTF8')), 'hex') then
    raise exception 'This draft link is not valid' using errcode = '42501';
  end if;
  v_m := public.dpdp__caller_membership(v_d.org_id);
  if v_m.id is null or v_m.id <> v_d.membership_id then
    raise exception 'This draft was made from someone else''s AI link -- only they can confirm it' using errcode = '42501';
  end if;
  select o2.* into v_org from dpdp.organisation o2 where o2.id = v_d.org_id;
  if v_d.obligation_id is not null then
    select t.name into v_name
    from dpdp.obligation o join dpdp.obligation_template t on t.id = o.template_id
    where o.id = v_d.obligation_id;
  end if;
  return jsonb_build_object(
    'draftId', v_d.id,
    'verb', v_d.verb,
    'obligationId', v_d.obligation_id,
    'job', v_name,
    'payload', v_d.payload,
    'org', jsonb_build_object('id', v_org.id, 'name', v_org.name),
    'createdAt', to_char(v_d.created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'expiresAt', to_char(v_d.expires_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'expired', v_d.expires_at <= v_now,
    'confirmedAt', case when v_d.confirmed_at is null then null else to_char(v_d.confirmed_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') end
  );
end
$$;

-- The one place a draft takes effect. The SIGNED-IN caller must be the
-- draft's membership (their own browser, their own session); the draft
-- must be unexpired, unconfirmed, and the token hash must match. Then the
-- verb is applied under the same rules the existing RPCs/services use:
--   ASSIGN  -> completeOwnerFirstVisit()'s path: find-or-create identity
--              (+ identity_email) and membership (staff, named_in_role),
--              set assigned_person_id. Owner only, as the wizard is.
--   SET_DUE -> due_on update (applyAiProposal). Owner only.
--   NOTE    -> event only (applyAiProposal: "the note text is only ever
--              recorded via the event log line").
--   MARK_NA -> state = not_applicable + na_reason (applyAiProposal).
--              Owner only ("mark it doesn't apply" is the owner's action
--              on the one page).
--   DRAFT   -> event only (per the WO-012 brief; the Next.js version also
--              inserted an unpublished notice_version -- see the PR).
-- Exactly one event, kind ai_draft_confirmed, summary
-- "drafted by AI, confirmed by <person email> -- <what happened>".
create or replace function public.dpdp_confirm_ai_draft(p_draft_id text, p_confirm_token text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_d dpdp.ai_draft;
  v_m dpdp.membership;
  v_email text;
  v_o dpdp.obligation;
  v_name text;
  v_target_email text;
  v_target_identity text;
  v_what text;
  v_detail text;
  v_now timestamp := (clock_timestamp() at time zone 'UTC');
begin
  select d.* into v_d from dpdp.ai_draft d where d.id = p_draft_id;
  if v_d.id is null or v_d.confirm_token_hash <> encode(sha256(convert_to(left(coalesce(p_confirm_token, ''), 256), 'UTF8')), 'hex') then
    raise exception 'This draft link is not valid' using errcode = '42501';
  end if;
  v_m := public.dpdp__caller_membership(v_d.org_id);
  if v_m.id is null or v_m.id <> v_d.membership_id then
    raise exception 'This draft was made from someone else''s AI link -- only they can confirm it' using errcode = '42501';
  end if;
  if v_d.confirmed_at is not null then
    raise exception 'This draft has already been confirmed' using errcode = 'P0001';
  end if;
  if v_d.expires_at <= v_now then
    raise exception 'This draft has expired -- ask the AI for a fresh one' using errcode = 'P0001';
  end if;

  select i.primary_email into v_email from dpdp.identity i where i.id = v_m.identity_id;

  if v_d.obligation_id is not null then
    select o.* into v_o from dpdp.obligation o where o.id = v_d.obligation_id and o.org_id = v_d.org_id;
    if v_o.id is null then
      raise exception 'Job not found' using errcode = 'P0002';
    end if;
    select t.name into v_name from dpdp.obligation_template t where t.id = v_o.template_id;
  end if;
  v_name := coalesce(v_name, 'a job');

  case v_d.verb
    when 'ASSIGN' then
      if v_m.level <> 'owner' then
        raise exception 'Only the owner can give a job to someone' using errcode = '42501';
      end if;
      v_target_email := lower(trim(coalesce(v_d.payload ->> 'email', '')));
      if position('@' in v_target_email) = 0 then
        raise exception 'ASSIGN needs payload.email' using errcode = '22023';
      end if;
      select ie.identity_id into v_target_identity
      from dpdp.identity_email ie
      where lower(ie.email) = v_target_email
      order by ie.is_primary desc
      limit 1;
      if v_target_identity is null then
        v_target_identity := replace(gen_random_uuid()::text, '-', '');
        insert into dpdp.identity (id, primary_email, created_at) values (v_target_identity, v_target_email, v_now);
        insert into dpdp.identity_email (id, identity_id, email, is_primary)
        values (replace(gen_random_uuid()::text, '-', ''), v_target_identity, v_target_email, true);
      end if;
      if not exists (select 1 from dpdp.membership m where m.identity_id = v_target_identity and m.org_id = v_d.org_id) then
        insert into dpdp.membership (id, identity_id, org_id, level, joined_via, created_at)
        values (replace(gen_random_uuid()::text, '-', ''), v_target_identity, v_d.org_id, 'staff', 'named_in_role', v_now);
      end if;
      update dpdp.obligation set assigned_person_id = v_target_identity where id = v_o.id;
      v_what := 'gave "' || v_name || '" to ' || v_target_email;

    when 'SET_DUE' then
      if v_m.level <> 'owner' then
        raise exception 'Only the owner can change when a job is due' using errcode = '42501';
      end if;
      update dpdp.obligation set due_on = (v_d.payload ->> 'dueOn')::date where id = v_o.id;
      v_what := 'set "' || v_name || '" due on ' || (v_d.payload ->> 'dueOn');

    when 'NOTE' then
      v_what := 'added a note to "' || v_name || '"';
      v_detail := left(v_d.payload ->> 'text', 1000);

    when 'MARK_NA' then
      if v_m.level <> 'owner' then
        raise exception 'Only the owner can mark a job as not applicable' using errcode = '42501';
      end if;
      update dpdp.obligation set state = 'not_applicable', na_reason = left(v_d.payload ->> 'reason', 1000) where id = v_o.id;
      v_what := 'marked "' || v_name || '" as not applicable';
      v_detail := left(v_d.payload ->> 'reason', 1000);

    when 'DRAFT' then
      v_what := 'drafted ' || coalesce(nullif(left(v_d.payload ->> 'docKind', 80), ''), 'a document')
        || case when v_d.obligation_id is not null then ' for "' || v_name || '"' else '' end;
      v_detail := left(v_d.payload ->> 'text', 1000);

    else
      raise exception 'Unknown verb' using errcode = '22023';
  end case;

  update dpdp.ai_draft set confirmed_at = v_now, confirmed_by = v_m.identity_id where id = v_d.id;

  perform public.dpdp__append_event(
    v_d.org_id, v_m.identity_id, v_email, 'ai_draft_confirmed',
    'drafted by AI, confirmed by ' || v_email || ' -- ' || v_what,
    v_detail
  );

  return jsonb_build_object('ok', true, 'verb', v_d.verb, 'obligationId', v_d.obligation_id);
end
$$;

-- ---------------------------------------------------------------------
-- Grants. Helpers: nobody. Browser surface: authenticated. Edge Function
-- surface (read / draft): service_role only -- revoked from authenticated
-- too, so a signed-in browser cannot read someone else's link by token.
-- app_runtime (the Next.js server's own role, never a browser role) is
-- granted everything so the repo's DB-gated tests can exercise the real
-- path, exactly as 0604 did.
-- ---------------------------------------------------------------------
revoke all on function public.dpdp__viewer_kind(text) from public, anon, authenticated;
revoke all on function public.dpdp__rows_for_membership(text) from public, anon, authenticated;
revoke all on function public.dpdp__ai_link_for_token(text) from public, anon, authenticated;

revoke all on function public.dpdp_create_ai_link(text, integer) from public, anon;
revoke all on function public.dpdp_revoke_ai_link(text) from public, anon;
revoke all on function public.dpdp_ai_draft_preview(text, text) from public, anon;
revoke all on function public.dpdp_confirm_ai_draft(text, text) from public, anon;
grant execute on function public.dpdp_create_ai_link(text, integer) to authenticated, app_runtime;
grant execute on function public.dpdp_revoke_ai_link(text) to authenticated, app_runtime;
grant execute on function public.dpdp_ai_draft_preview(text, text) to authenticated, app_runtime;
grant execute on function public.dpdp_confirm_ai_draft(text, text) to authenticated, app_runtime;

revoke all on function public.dpdp_ai_link_read(text) from public, anon, authenticated;
revoke all on function public.dpdp_draft_action(text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.dpdp_ai_link_read(text) to service_role, app_runtime;
grant execute on function public.dpdp_draft_action(text, text, text, jsonb) to service_role, app_runtime;
