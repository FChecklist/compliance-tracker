-- PRE-APPROVED-LIVE-DDL: Owner (Rajat Agarwal) approved in a live Claude Code session on 2026-10-01: "do step 1 and 2 both, build it in local" (the user-wide AI work link, listing projects, reporting on all, and Create New Project) and "apply the migration after green and tell me"; this migration is that work.
-- PROJEXA USER-WIDE AI WORK LINK (owner requirement, 2026-10-01): a link that belongs to a PERSON, not to one project. When the person pastes it
-- into any AI, that AI lists the person's projects (a numbered list), can report on all of them, can work inside the one the person picks
-- and can make a new project. Everything else of the project link stays: read and draft at level 0, a person's own click confirms every
-- change, the manual format, the rate limits, money nulled by role, one organisation only. The project link (scope 'project') is unchanged.
--
-- WHAT (all in schema public unless stated; every function is reached only by the Edge function through the service-role key)
--   platform.user_ai_links.scope text NOT NULL DEFAULT 'project'  CHECK IN ('project', 'user')
--       'user' means project_id IS NULL and authority_level 0 (the table says so in a CHECK, so no code path can mint a user link with
--       level 1 or a project). user_ai_links_projexa_shape is replaced: a projexa row still has a hash, no plaintext token and an expiry, and
--       a project_id unless its scope is 'user'. One live user link per person (a partial unique index).
--   platform.ai_work_link_intent.project_id  NOT NULL dropped: a create_project draft belongs to no project. Every other intent still has one.
--   ai_work_link__fns(scope, bound, allowed, rank)   the effective function list (owner-only). create_project is a function of a user link
--       that has NOT picked a project, and of nothing else; every other function needs a project: a user link that has picked one, or a
--       project link. So a project link can never use create_project (it stays refused as FUNCTION_NOT_ON_LINK) and a user link outside a
--       project can use nothing but create_project.
--   RE-CREATED ai_work_link__resolve, ai_work_link__live        0624 / 0629 with the scope: a user link has no project to check, answers
--       project_id null and scope 'user'. Both stay equal (the parity test). A project link answers exactly as before, plus 'scope'.
--   ai_work_link__bind(ctx, project_id)        a user link's context bound to one project, or NULL (owner-only). It re-checks the project NOW:
--       in the link's organisation and readable by the person (ai_work_link__can_read_project). A project of another organisation, a private
--       project the person may not read and a project that does not exist all return NULL, so no caller can tell them apart.
--   ai_work_link__require_in(token, project_id, need_project)   require() plus the project binding (owner-only). Raises AW404 PROJECT_NOT_FOUND
--       for any project that does not bind (the same answer as a missing record), and for a project link asked for another project.
--   ai_work_link__resolve_in(token, project_id)   what the Edge function calls to learn the bound context (service_role).
--   ai_work_link_projects(token, limit)        the numbered list and the portfolio: ONLY the projects the person may read in the link's
--       organisation, capped at 100, with a light rollup (tasks, overdue, BOQ lines, progress, dates) and the project value nulled where
--       ai_work_link__hidden_cols hides it. A project link refuses it (AW403 USER_LINK_REQUIRED).
--   RE-CREATED (one trailing parameter p_project_id DEFAULT NULL; the old callers are unchanged) ai_work_link_records, ai_work_link_record,
--       ai_work_link_context, ai_work_link_record_intent. record_intent allows a null project for create_project only, keeps the project
--       in the idempotency key (a retry key is per project), and caps create_project at 5 a person a day (AW429 PROJECT_CAP_DAY).
--   RE-CREATED ai_work_link_intent_claim        0629 plus the bind for a user link's intent, so a project that stopped being readable between the
--       draft and the click refuses the intent (LINK_GONE) instead of writing into it.
--   RE-CREATED ai_work_link_list_for            0631 plus scope, so the person's own list tells the two kinds apart.
--   ai_work_link_mint_user_for(user, days, label)   mints the user link: level 0 for ever, every function the person's rank may have, the same
--       10 an hour and 30 a day caps as a project mint (same lock), and it revokes the person's previous live user link.
--
-- WHAT IT DOES NOT DO. It does not switch writes on, it does not seed the registry (0669 does: create_project becomes a level 2 function), and
-- it creates no project by itself: the project is made by the pipeline's create_project executor when the person confirms a draft.
--
-- ERRORS (coded): AW403 USER_LINK_REQUIRED, USER_NOT_ACTIVE, FUNCTION_NOT_ON_LINK, WRONG_PROJECT; AW404 PROJECT_NOT_FOUND; AW400 PROJECT_REQUIRED,
-- BAD_DAYS; AW429 PROJECT_CAP_DAY, MINT_CAP_HOUR, MINT_CAP_DAY.
--
-- GRANTS: SECURITY DEFINER, search_path = pg_catalog, pg_temp, revoked from public, anon, authenticated and app_runtime; the public functions
-- are granted to service_role alone, the helpers are owner-only (also revoked from service_role).
--
-- DATA LOSS: none. One column with a default, one NOT NULL relaxed, one check replaced by two that every existing row satisfies, one index, and
-- functions. Applying it twice changes nothing.
--
-- HOW IT IS APPLIED: through the Supabase MCP by the PM, after the always-aborted rehearsal passed and 0621 to 0667 are applied; then 0669.
-- NOT applied by the engineer who wrote it. Idempotent.
--
-- ROLLBACK: drizzle/down/0668_awl_user_wide_link.down.sql

BEGIN;

SET LOCAL lock_timeout = '5s';

-- 1. the table -----------------------------------------------------------------------------------------------------------------------------
ALTER TABLE platform.user_ai_links ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'project';

ALTER TABLE platform.user_ai_links DROP CONSTRAINT IF EXISTS user_ai_links_scope_check;
ALTER TABLE platform.user_ai_links ADD CONSTRAINT user_ai_links_scope_check CHECK (scope IN ('project', 'user'));

ALTER TABLE platform.user_ai_links DROP CONSTRAINT IF EXISTS user_ai_links_projexa_shape;
ALTER TABLE platform.user_ai_links ADD CONSTRAINT user_ai_links_projexa_shape
  CHECK (product = 'veridian'
         OR (token_hash IS NOT NULL
             AND token IS NULL
             AND expires_at IS NOT NULL
             AND (project_id IS NOT NULL OR scope = 'user')));

-- a user link has no project and can never be level 1 (the one place the level is written is the mint, and this holds even if a mint is wrong)
ALTER TABLE platform.user_ai_links DROP CONSTRAINT IF EXISTS user_ai_links_user_scope_shape;
ALTER TABLE platform.user_ai_links ADD CONSTRAINT user_ai_links_user_scope_shape
  CHECK (scope = 'project' OR (product = 'projexa' AND project_id IS NULL AND authority_level = 0));

CREATE UNIQUE INDEX IF NOT EXISTS user_ai_links_one_live_user_scope
  ON platform.user_ai_links (user_id)
  WHERE status = 'active' AND product = 'projexa' AND scope = 'user';

ALTER TABLE platform.ai_work_link_intent ALTER COLUMN project_id DROP NOT NULL;

-- 2. the effective function list ------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ai_work_link__fns(p_scope text, p_bound boolean, p_allowed text[], p_rank integer)
RETURNS text[]
LANGUAGE sql STABLE
SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT ARRAY(
    SELECT f.function_id
    FROM platform.ai_work_link_functions f
    WHERE f.product = 'projexa'
      AND f.link_level IS NOT NULL
      AND f.function_id = ANY (p_allowed)
      AND f.min_role_rank <= p_rank
      AND CASE
            WHEN p_scope = 'user' AND NOT coalesce(p_bound, false) THEN f.function_id = 'create_project'
            ELSE f.function_id <> 'create_project'
          END
    ORDER BY f.function_id)
$fn$;

-- 3. token to link, and link id to link (kept equal) -----------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ai_work_link__resolve(p_token text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_hash text := public.ai_work_link__hash_token(p_token);
  v_l record;
  v_u record;
  v_p record;
  v_pid text;
  v_pname text;
  v_rank integer;
  v_writes boolean;
  v_level integer;
  v_fns text[];
  v_gone constant jsonb := jsonb_build_object('status', 'gone');
BEGIN
  IF v_hash IS NULL THEN
    RETURN v_gone;
  END IF;
  SELECT l.id, l.org_id, l.user_id, l.project_id, l.scope, l.status, l.expires_at, l.authority_level, l.allowed_functions, l.hide_personal, l.label
    INTO v_l
  FROM platform.user_ai_links l
  WHERE l.token_hash = v_hash AND l.product = 'projexa';
  IF NOT FOUND OR v_l.status <> 'active' OR v_l.expires_at IS NULL OR v_l.expires_at <= now() THEN
    RETURN v_gone;
  END IF;

  -- PMD-33: a link acts as exactly one person, so it stops when that person is no longer an active user of the organisation
  SELECT u.id, u.name, u.role::text AS role, u.is_active, u.org_id INTO v_u
  FROM compliance.users u WHERE u.id = v_l.user_id;
  IF NOT FOUND OR NOT v_u.is_active OR v_u.org_id IS DISTINCT FROM v_l.org_id THEN
    RETURN v_gone;
  END IF;

  IF v_l.scope = 'user' THEN
    -- a user link has no project of its own: each project it works in is bound and checked by ai_work_link__bind on that call
    v_pid := NULL;
    v_pname := NULL;
  ELSE
    -- the project still exists in the organisation and is still readable by this person (spec 10.3)
    SELECT pr.id, pr.name, pr.org_id, pr.access_level::text AS access_level, pr.lead_user_id INTO v_p
    FROM compliance.projects pr WHERE pr.id = v_l.project_id;
    IF NOT FOUND OR v_p.org_id IS DISTINCT FROM v_l.org_id
       OR NOT public.ai_work_link__can_read_project(v_p.access_level, v_p.lead_user_id, v_u.id, v_u.role) THEN
      RETURN v_gone;
    END IF;
    v_pid := v_p.id;
    v_pname := v_p.name;
  END IF;

  v_rank := public.ai_work_link__role_rank(v_u.role);
  SELECT coalesce((SELECT s.writes_enabled FROM platform.ai_work_link_settings s WHERE s.id), false) INTO v_writes;

  -- spec 10.9: level 0 while no executor exists, and for any person below rank 2; otherwise the ceiling chosen at mint
  v_level := CASE WHEN NOT v_writes OR v_rank < 2 THEN 0 ELSE v_l.authority_level END;

  v_fns := public.ai_work_link__fns(v_l.scope, false, v_l.allowed_functions, v_rank);

  RETURN jsonb_build_object(
    'status', 'ok',
    'link_id', v_l.id,
    'scope', v_l.scope,
    'org_id', v_l.org_id,
    'user_id', v_u.id,
    'user_name', v_u.name,
    'project_id', v_pid,
    'project_name', v_pname,
    'live_role', v_u.role,
    'live_rank', v_rank,
    'authority_level', v_l.authority_level,
    'allowed_functions', to_jsonb(v_l.allowed_functions),
    'effective_level', v_level,
    'effective_functions', to_jsonb(v_fns),
    'money_visible', v_rank >= 3,
    'hide_personal', v_l.hide_personal,
    'label', v_l.label,
    'expires_at', to_char(v_l.expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'writes_enabled', v_writes);
END
$fn$;

CREATE OR REPLACE FUNCTION public.ai_work_link__live(p_link_id text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_l record;
  v_u record;
  v_p record;
  v_pid text;
  v_pname text;
  v_rank integer;
  v_writes boolean;
  v_level integer;
  v_fns text[];
  v_gone constant jsonb := jsonb_build_object('status', 'gone');
BEGIN
  IF p_link_id IS NULL THEN
    RETURN v_gone;
  END IF;
  SELECT l.id, l.org_id, l.user_id, l.project_id, l.scope, l.status, l.expires_at, l.authority_level, l.allowed_functions, l.hide_personal, l.label
    INTO v_l
  FROM platform.user_ai_links l
  WHERE l.id = p_link_id AND l.product = 'projexa';
  IF NOT FOUND OR v_l.status <> 'active' OR v_l.expires_at IS NULL OR v_l.expires_at <= now() THEN
    RETURN v_gone;
  END IF;

  SELECT u.id, u.name, u.role::text AS role, u.is_active, u.org_id INTO v_u
  FROM compliance.users u WHERE u.id = v_l.user_id;
  IF NOT FOUND OR NOT v_u.is_active OR v_u.org_id IS DISTINCT FROM v_l.org_id THEN
    RETURN v_gone;
  END IF;

  IF v_l.scope = 'user' THEN
    v_pid := NULL;
    v_pname := NULL;
  ELSE
    SELECT pr.id, pr.name, pr.org_id, pr.access_level::text AS access_level, pr.lead_user_id INTO v_p
    FROM compliance.projects pr WHERE pr.id = v_l.project_id;
    IF NOT FOUND OR v_p.org_id IS DISTINCT FROM v_l.org_id
       OR NOT public.ai_work_link__can_read_project(v_p.access_level, v_p.lead_user_id, v_u.id, v_u.role) THEN
      RETURN v_gone;
    END IF;
    v_pid := v_p.id;
    v_pname := v_p.name;
  END IF;

  v_rank := public.ai_work_link__role_rank(v_u.role);
  SELECT coalesce((SELECT s.writes_enabled FROM platform.ai_work_link_settings s WHERE s.id), false) INTO v_writes;
  v_level := CASE WHEN NOT v_writes OR v_rank < 2 THEN 0 ELSE v_l.authority_level END;

  v_fns := public.ai_work_link__fns(v_l.scope, false, v_l.allowed_functions, v_rank);

  RETURN jsonb_build_object(
    'status', 'ok',
    'link_id', v_l.id,
    'scope', v_l.scope,
    'org_id', v_l.org_id,
    'user_id', v_u.id,
    'user_name', v_u.name,
    'project_id', v_pid,
    'project_name', v_pname,
    'live_role', v_u.role,
    'live_rank', v_rank,
    'authority_level', v_l.authority_level,
    'allowed_functions', to_jsonb(v_l.allowed_functions),
    'effective_level', v_level,
    'effective_functions', to_jsonb(v_fns),
    'money_visible', v_rank >= 3,
    'hide_personal', v_l.hide_personal,
    'label', v_l.label,
    'expires_at', to_char(v_l.expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'writes_enabled', v_writes);
END
$fn$;

-- 4. binding a user link to one project -------------------------------------------------------------------------------------------------------
-- The project is read NOW, never taken from the caller: it must be in the link's organisation and readable by the person (the same rule as
-- the project link's own check). NULL for anything else, so a project of another organisation, a private project and a project that does not
-- exist are one and the same answer.
CREATE OR REPLACE FUNCTION public.ai_work_link__bind(p_ctx jsonb, p_project_id text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_p record;
BEGIN
  IF p_ctx IS NULL OR p_ctx ->> 'status' IS DISTINCT FROM 'ok' OR p_ctx ->> 'scope' IS DISTINCT FROM 'user' OR p_project_id IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT pr.id, pr.name, pr.org_id, pr.access_level::text AS access_level, pr.lead_user_id INTO v_p
  FROM compliance.projects pr WHERE pr.id = p_project_id;
  IF NOT FOUND OR v_p.org_id IS DISTINCT FROM (p_ctx ->> 'org_id')
     OR NOT public.ai_work_link__can_read_project(v_p.access_level, v_p.lead_user_id, p_ctx ->> 'user_id', p_ctx ->> 'live_role') THEN
    RETURN NULL;
  END IF;
  RETURN p_ctx || jsonb_build_object(
    'project_id', v_p.id,
    'project_name', v_p.name,
    'effective_functions', to_jsonb(public.ai_work_link__fns(
      'user', true, ARRAY(SELECT jsonb_array_elements_text(p_ctx -> 'allowed_functions')), (p_ctx ->> 'live_rank')::integer)));
END
$fn$;

-- The link, bound to a project when it is a user link. A user link outside a project is allowed only when p_need_project is false.
CREATE OR REPLACE FUNCTION public.ai_work_link__require_in(p_token text, p_project_id text, p_need_project boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql STABLE
SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_ctx jsonb := public.ai_work_link__require(p_token);
  v_bound jsonb;
BEGIN
  IF v_ctx ->> 'scope' = 'user' THEN
    IF p_project_id IS NULL THEN
      IF p_need_project THEN
        RAISE EXCEPTION 'PROJECT_REQUIRED' USING ERRCODE = 'AW400';
      END IF;
      RETURN v_ctx;
    END IF;
    v_bound := public.ai_work_link__bind(v_ctx, p_project_id);
    IF v_bound IS NULL THEN
      RAISE EXCEPTION 'PROJECT_NOT_FOUND' USING ERRCODE = 'AW404';
    END IF;
    RETURN v_bound;
  END IF;
  -- a project link is for its own project: naming another one is the same answer as a project that does not exist
  IF p_project_id IS NOT NULL AND p_project_id IS DISTINCT FROM (v_ctx ->> 'project_id') THEN
    RAISE EXCEPTION 'PROJECT_NOT_FOUND' USING ERRCODE = 'AW404';
  END IF;
  RETURN v_ctx;
END
$fn$;

-- What the Edge function calls to learn the context of one project: 'gone' for a dead link, AW404 for a project that does not bind.
CREATE OR REPLACE FUNCTION public.ai_work_link__resolve_in(p_token text, p_project_id text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_ctx jsonb := public.ai_work_link__resolve(p_token);
  v_bound jsonb;
BEGIN
  IF v_ctx ->> 'status' IS DISTINCT FROM 'ok' THEN
    RETURN v_ctx;
  END IF;
  IF v_ctx ->> 'scope' = 'user' THEN
    v_bound := public.ai_work_link__bind(v_ctx, p_project_id);
    IF v_bound IS NULL THEN
      RAISE EXCEPTION 'PROJECT_NOT_FOUND' USING ERRCODE = 'AW404';
    END IF;
    RETURN v_bound;
  END IF;
  IF p_project_id IS DISTINCT FROM (v_ctx ->> 'project_id') THEN
    RAISE EXCEPTION 'PROJECT_NOT_FOUND' USING ERRCODE = 'AW404';
  END IF;
  RETURN v_ctx;
END
$fn$;

-- 5. the numbered list and the portfolio ------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ai_work_link_projects(p_token text, p_limit integer DEFAULT 100)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_ctx jsonb := public.ai_work_link__require(p_token);
  v_org text := v_ctx ->> 'org_id';
  v_user text := v_ctx ->> 'user_id';
  v_role text := v_ctx ->> 'live_role';
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 100);
  v_hidden text[];
  v_total integer;
  v_items jsonb;
BEGIN
  IF v_ctx ->> 'scope' IS DISTINCT FROM 'user' THEN
    RAISE EXCEPTION 'USER_LINK_REQUIRED' USING ERRCODE = 'AW403';
  END IF;
  v_hidden := public.ai_work_link__hidden_cols('project', v_org, v_role);

  SELECT count(*) INTO v_total
  FROM compliance.projects pr
  WHERE pr.org_id = v_org AND public.ai_work_link__can_read_project(pr.access_level::text, pr.lead_user_id, v_user, v_role);

  SELECT coalesce(jsonb_agg(x.j ORDER BY x.ord), '[]'::jsonb) INTO v_items
  FROM (
    SELECT row_number() OVER (ORDER BY pr.is_active DESC, pr.created_at DESC, pr.id) AS ord,
           jsonb_build_object(
             'id', pr.id,
             'name', pr.name,
             'status', pr.status::text,
             'is_active', pr.is_active,
             'lead', pr.lead_user_id IS NOT DISTINCT FROM v_user,
             'health_status', pr.health_status,
             'progress_percent', pr.rollup_percentage,
             'start_date', pr.start_date,
             'target_date', pr.target_date,
             'project_value', CASE WHEN 'project_value' = ANY (v_hidden) THEN NULL ELSE pr.project_value END,
             'tasks_total', (SELECT count(*) FROM compliance.pms_issues i WHERE i.project_id = pr.id AND i.org_id = v_org AND NOT i.is_archived),
             'tasks_open', (SELECT count(*) FROM compliance.pms_issues i WHERE i.project_id = pr.id AND i.org_id = v_org AND NOT i.is_archived AND i.completion_percentage < 100),
             'tasks_overdue', (SELECT count(*) FROM compliance.pms_issues i
                               WHERE i.project_id = pr.id AND i.org_id = v_org AND NOT i.is_archived AND i.completion_percentage < 100
                                 AND i.due_date IS NOT NULL AND i.due_date < (now() AT TIME ZONE 'UTC')::date),
             'boq_lines', (SELECT count(*) FROM compliance.construction_boq_line_items li JOIN compliance.construction_boqs b ON b.id = li.boq_id
                           WHERE b.project_id = pr.id AND b.org_id = v_org AND li.org_id = v_org)) AS j
    FROM compliance.projects pr
    WHERE pr.org_id = v_org AND public.ai_work_link__can_read_project(pr.access_level::text, pr.lead_user_id, v_user, v_role)
    ORDER BY pr.is_active DESC, pr.created_at DESC, pr.id
    LIMIT v_limit
  ) x;

  RETURN jsonb_build_object(
    'projects', v_items,
    'total', v_total,
    'shown', jsonb_array_length(v_items),
    'truncated', v_total > jsonb_array_length(v_items),
    'money_hidden', 'project_value' = ANY (v_hidden));
END
$fn$;

-- 6. reads and changes inside one project: one trailing parameter ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.ai_work_link_records(text, text, text, integer, jsonb);
CREATE OR REPLACE FUNCTION public.ai_work_link_records(
  p_token text, p_kind text, p_after text DEFAULT NULL, p_limit integer DEFAULT 50, p_filters jsonb DEFAULT '{}'::jsonb,
  p_project_id text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  RETURN public.ai_work_link__records_core(public.ai_work_link__require_in(p_token, p_project_id, true), p_kind, p_after, p_limit, p_filters, NULL);
END
$fn$;

DROP FUNCTION IF EXISTS public.ai_work_link_record(text, text, text);
CREATE OR REPLACE FUNCTION public.ai_work_link_record(p_token text, p_kind text, p_id text, p_project_id text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_page jsonb := public.ai_work_link__records_core(public.ai_work_link__require_in(p_token, p_project_id, true), p_kind, NULL, 1, '{}'::jsonb, p_id);
BEGIN
  RETURN v_page -> 'items' -> 0;
END
$fn$;

DROP FUNCTION IF EXISTS public.ai_work_link_context(text);
CREATE OR REPLACE FUNCTION public.ai_work_link_context(p_token text, p_project_id text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_ctx jsonb := public.ai_work_link__require_in(p_token, p_project_id, false);
  v_org text := v_ctx ->> 'org_id';
  v_role text := v_ctx ->> 'live_role';
  v_project text := v_ctx ->> 'project_id';
  v_writes boolean := (v_ctx ->> 'writes_enabled')::boolean;
  v_fns text[] := ARRAY(SELECT jsonb_array_elements_text(v_ctx -> 'effective_functions'));
  v_functions jsonb;
  v_money jsonb;
  v_intents integer;
  v_subs integer := 0;
  v_calls integer;
BEGIN
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', f.function_id, 'kind', f.kind, 'level', f.link_level, 'available', v_writes,
           'money_sensitive', f.money_sensitive, 'min_role_rank', f.min_role_rank, 'text_params', to_jsonb(f.text_params))
         ORDER BY f.function_id), '[]'::jsonb)
    INTO v_functions
  FROM platform.ai_work_link_functions f
  WHERE f.function_id = ANY (v_fns);

  SELECT coalesce(jsonb_object_agg(k.kind, to_jsonb(public.ai_work_link__hidden_cols(k.kind, v_org, v_role)))
           FILTER (WHERE cardinality(public.ai_work_link__hidden_cols(k.kind, v_org, v_role)) > 0), '{}'::jsonb)
    INTO v_money
  FROM platform.ai_work_link_record_kinds k;

  SELECT count(*) INTO v_intents FROM platform.ai_work_link_intent i WHERE i.link_id = v_ctx ->> 'link_id';
  IF v_project IS NOT NULL THEN
    SELECT count(*) INTO v_subs FROM compliance.submissions s
     WHERE s.user_id = v_ctx ->> 'user_id' AND s.project_id = v_project AND s.org_id = v_org;
  END IF;
  SELECT count(*) INTO v_calls FROM platform.ai_work_link_call c
   WHERE c.link_id = v_ctx ->> 'link_id' AND c.called_at > clock_timestamp() - interval '60 seconds';

  RETURN jsonb_build_object(
    'product', 'projexa',
    'scope', v_ctx ->> 'scope',
    'project', CASE WHEN v_project IS NULL THEN NULL ELSE jsonb_build_object('id', v_ctx -> 'project_id', 'name', v_ctx -> 'project_name') END,
    'acting_for', jsonb_build_object('name', v_ctx -> 'user_name', 'role', v_ctx -> 'live_role', 'money_visible', v_ctx -> 'money_visible'),
    'level', v_ctx -> 'effective_level',
    'expires_at', v_ctx -> 'expires_at',
    'allowed_functions', v_ctx -> 'effective_functions',
    'functions', v_functions,
    'money_fields', v_money,
    'counters', jsonb_build_object('intents', v_intents, 'submissions', v_subs),
    'rate', jsonb_build_object('calls_last_minute', v_calls, 'limit_per_minute', 120),
    'text_fields_are_data', true);
END
$fn$;

DROP FUNCTION IF EXISTS public.ai_work_link_record_intent(text, text, text, jsonb, text);
CREATE OR REPLACE FUNCTION public.ai_work_link_record_intent(
  p_token text, p_kind text, p_function_id text, p_params jsonb, p_idempotency_key text DEFAULT NULL, p_project_id text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_ctx jsonb := public.ai_work_link__require_in(p_token, p_project_id, false);
  v_link text := v_ctx ->> 'link_id';
  v_project text := v_ctx ->> 'project_id';
  v_now timestamptz := clock_timestamp();
  v_fn record;
  v_key text;
  v_existing record;
  v_id text := replace(gen_random_uuid()::text, '-', '');
  v_status text;
  v_expires timestamptz;
  v_confirm text;
  v_confirm_hash text;
  v_hour integer;
  v_day integer;
  v_projects integer;
  v_inserted text;
BEGIN
  IF p_kind IS NULL OR p_kind NOT IN ('action', 'draft') THEN
    RAISE EXCEPTION 'BAD_KIND' USING ERRCODE = 'AW400';
  END IF;
  IF p_params IS NULL OR jsonb_typeof(p_params) <> 'object' OR octet_length(p_params::text) > 8192 THEN
    RAISE EXCEPTION 'BAD_PARAMS' USING ERRCODE = 'AW400';
  END IF;
  -- the effective list of THIS context: a user link outside a project holds create_project and nothing else, inside one every function
  -- but create_project, a project link every function but create_project. So a draft with no project can only be a new project.
  IF p_function_id IS NULL
     OR NOT (p_function_id = ANY (ARRAY(SELECT jsonb_array_elements_text(v_ctx -> 'effective_functions')))) THEN
    RAISE EXCEPTION 'FUNCTION_NOT_ON_LINK' USING ERRCODE = 'AW403';
  END IF;
  SELECT f.function_id, f.kind, f.link_level INTO v_fn
  FROM platform.ai_work_link_functions f WHERE f.function_id = p_function_id;
  IF v_fn.kind IS DISTINCT FROM 'write' THEN
    RAISE EXCEPTION 'NOT_A_WRITE' USING ERRCODE = 'AW400';
  END IF;
  IF v_project IS NULL AND p_function_id <> 'create_project' THEN
    RAISE EXCEPTION 'PROJECT_REQUIRED' USING ERRCODE = 'AW400';
  END IF;
  -- with no project in the context this is true for any projectId: a new project is not made inside another one
  IF p_params ? 'projectId' AND (p_params ->> 'projectId') IS DISTINCT FROM v_project THEN
    RAISE EXCEPTION 'WRONG_PROJECT' USING ERRCODE = 'AW403';
  END IF;
  IF p_kind = 'action' AND NOT ((v_ctx ->> 'effective_level')::integer >= 1 AND v_fn.link_level = 1) THEN
    RAISE EXCEPTION 'LEVEL_NOT_ALLOWED' USING ERRCODE = 'AW403';
  END IF;

  v_key := nullif(btrim(coalesce(p_idempotency_key, '')), '');
  IF v_key IS NULL THEN
    v_key := encode(sha256(convert_to(jsonb_build_object(
      'function', p_function_id, 'params', p_params, 'utc_date', to_char(v_now AT TIME ZONE 'UTC', 'YYYY-MM-DD'),
      'project', CASE WHEN v_ctx ->> 'scope' = 'user' THEN v_project END)::text, 'UTF8')), 'hex');
  ELSIF char_length(v_key) > 128 THEN
    RAISE EXCEPTION 'BAD_PARAMS' USING ERRCODE = 'AW400';
  ELSIF v_ctx ->> 'scope' = 'user' THEN
    -- a retry key of a user link is per project: the same key in two projects is two changes, never a replay of the first
    v_key := encode(sha256(convert_to(coalesce(v_project, '') || ':' || v_key, 'UTF8')), 'hex');
  END IF;

  -- an unexecuted intent past its expiry, and an executing one that ran out of time, must not keep holding a key
  PERFORM public.ai_work_link__sweep_intents(v_link);

  SELECT i.id, i.status, i.kind, i.expires_at, i.submission_id, i.result, i.failure INTO v_existing
  FROM platform.ai_work_link_intent i
  WHERE i.link_id = v_link AND i.idempotency_key = v_key
    AND i.status IN ('recorded', 'executing', 'done', 'awaiting_confirmation', 'confirmed');
  IF FOUND THEN
    RETURN jsonb_build_object(
      'intent_id', v_existing.id, 'status', v_existing.status, 'kind', v_existing.kind, 'function_id', p_function_id,
      'replayed', true, 'confirm_token', NULL,
      'expires_at', to_char(v_existing.expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'submission_id', v_existing.submission_id, 'result', v_existing.result, 'failure', v_existing.failure);
  END IF;

  SELECT count(*) FILTER (WHERE i.created_at > v_now - interval '1 hour'), count(*) INTO v_hour, v_day
  FROM platform.ai_work_link_intent i WHERE i.link_id = v_link AND i.created_at > v_now - interval '1 day';
  IF v_hour >= 30 THEN
    RAISE EXCEPTION 'WRITE_CAP_HOUR' USING ERRCODE = 'AW429';
  END IF;
  IF v_day >= 200 THEN
    RAISE EXCEPTION 'WRITE_CAP_DAY' USING ERRCODE = 'AW429';
  END IF;
  -- a new project is rarer than a daily entry: 5 a person a day, over every link the person has (the 5 shell projects a day of 0631)
  IF p_function_id = 'create_project' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('ai_work_link_new_project:' || (v_ctx ->> 'user_id'), 0));
    SELECT count(*) INTO v_projects
    FROM platform.ai_work_link_intent i
    WHERE i.user_id = v_ctx ->> 'user_id' AND i.function_id = 'create_project' AND i.created_at > v_now - interval '1 day';
    IF v_projects >= 5 THEN
      RAISE EXCEPTION 'PROJECT_CAP_DAY' USING ERRCODE = 'AW429';
    END IF;
  END IF;

  IF p_kind = 'draft' THEN
    v_status := 'awaiting_confirmation';
    v_expires := v_now + interval '48 hours';
    v_confirm := encode(extensions.gen_random_bytes(32), 'hex');
    v_confirm_hash := encode(sha256(convert_to(v_confirm, 'UTF8')), 'hex');
  ELSE
    v_status := 'recorded';
    v_expires := v_now + interval '1 hour';
  END IF;

  INSERT INTO platform.ai_work_link_intent (
    id, link_id, org_id, project_id, user_id, function_id, params, kind, idempotency_key, status,
    confirm_token_hash, expires_at, created_at)
  VALUES (
    v_id, v_link, v_ctx ->> 'org_id', v_project, v_ctx ->> 'user_id', p_function_id, p_params, p_kind, v_key,
    v_status, v_confirm_hash, v_expires, v_now)
  ON CONFLICT (link_id, idempotency_key) WHERE status IN ('recorded', 'executing', 'done', 'awaiting_confirmation', 'confirmed')
  DO NOTHING
  RETURNING id INTO v_inserted;

  IF v_inserted IS NULL THEN
    -- a concurrent request recorded the same key between the read above and the insert: report that one
    SELECT i.id, i.status, i.kind, i.expires_at, i.submission_id, i.result, i.failure INTO v_existing
    FROM platform.ai_work_link_intent i
    WHERE i.link_id = v_link AND i.idempotency_key = v_key
      AND i.status IN ('recorded', 'executing', 'done', 'awaiting_confirmation', 'confirmed');
    RETURN jsonb_build_object(
      'intent_id', v_existing.id, 'status', v_existing.status, 'kind', v_existing.kind, 'function_id', p_function_id,
      'replayed', true, 'confirm_token', NULL,
      'expires_at', to_char(v_existing.expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'submission_id', v_existing.submission_id, 'result', v_existing.result, 'failure', v_existing.failure);
  END IF;

  UPDATE platform.user_ai_links SET write_count = write_count + 1 WHERE id = v_link;

  RETURN jsonb_build_object(
    'intent_id', v_id, 'status', v_status, 'kind', p_kind, 'function_id', p_function_id, 'replayed', false,
    'confirm_token', v_confirm,
    'expires_at', to_char(v_expires AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'submission_id', NULL, 'result', NULL, 'failure', NULL);
END
$fn$;

-- 7. claim: a user link's intent is bound to its project again, now ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ai_work_link_intent_claim(p_intent_id text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_link text;
  v_i record;
  v_ctx jsonb;
  v_writes boolean;
  v_now timestamptz := clock_timestamp();
  v_fn_level smallint;
  v_why text;
BEGIN
  SELECT i.link_id INTO v_link FROM platform.ai_work_link_intent i WHERE i.id = p_intent_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'refused', 'reason', 'not_found');
  END IF;

  -- the switch first: with writes off nothing about the intent changes (spec 9.5: it waits)
  SELECT coalesce((SELECT s.writes_enabled FROM platform.ai_work_link_settings s WHERE s.id), false) INTO v_writes;
  IF NOT v_writes THEN
    RETURN jsonb_build_object('status', 'not_enabled');
  END IF;

  PERFORM public.ai_work_link__sweep_intents(v_link);

  SELECT i.id, i.link_id, i.org_id, i.project_id, i.user_id, i.function_id, i.params, i.kind, i.status, i.confirmed_by INTO v_i
  FROM platform.ai_work_link_intent i WHERE i.id = p_intent_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'refused', 'reason', 'not_found');
  END IF;

  IF v_i.status = 'executing' THEN
    RETURN jsonb_build_object('status', 'refused', 'reason', 'already_executing');
  END IF;
  IF v_i.status = 'expired' THEN
    RETURN jsonb_build_object('status', 'refused', 'reason', 'expired');
  END IF;
  IF NOT ((v_i.kind = 'action' AND v_i.status = 'recorded') OR (v_i.kind = 'draft' AND v_i.status = 'confirmed')) THEN
    RETURN jsonb_build_object('status', 'refused', 'reason', 'not_claimable', 'current', v_i.status);
  END IF;
  -- a draft runs only after its own person confirmed it
  IF v_i.kind = 'draft' AND v_i.confirmed_by IS DISTINCT FROM v_i.user_id THEN
    RETURN jsonb_build_object('status', 'refused', 'reason', 'not_confirmed_by_owner');
  END IF;

  v_ctx := public.ai_work_link__live(v_i.link_id);
  -- a user link's intent names its project: the link must still be able to read it (organisation and readability, checked now)
  IF v_ctx ->> 'status' = 'ok' AND v_ctx ->> 'scope' = 'user' AND v_i.project_id IS NOT NULL THEN
    v_ctx := coalesce(public.ai_work_link__bind(v_ctx, v_i.project_id), jsonb_build_object('status', 'gone'));
  END IF;
  v_why := NULL;
  IF v_ctx ->> 'status' IS DISTINCT FROM 'ok' OR v_ctx ->> 'user_id' IS DISTINCT FROM v_i.user_id OR v_ctx ->> 'project_id' IS DISTINCT FROM v_i.project_id THEN
    v_why := 'LINK_GONE';
  ELSE
    SELECT f.link_level INTO v_fn_level FROM platform.ai_work_link_functions f WHERE f.function_id = v_i.function_id;
    IF NOT (v_i.function_id = ANY (ARRAY(SELECT jsonb_array_elements_text(v_ctx -> 'effective_functions'))))
       OR (v_i.kind = 'action' AND NOT ((v_ctx ->> 'effective_level')::integer >= 1 AND coalesce(v_fn_level, 0) = 1)) THEN
      v_why := 'ROLE_CHANGED';
    END IF;
  END IF;
  IF v_why IS NOT NULL THEN
    UPDATE platform.ai_work_link_intent
    SET status = 'refused', failure = jsonb_build_object('code', v_why, 'missing', '[]'::jsonb)
    WHERE id = v_i.id;
    RETURN jsonb_build_object('status', 'refused', 'reason', v_why);
  END IF;

  UPDATE platform.ai_work_link_intent SET status = 'executing', claimed_at = v_now WHERE id = v_i.id;
  RETURN jsonb_build_object(
    'status', 'ok',
    'intent', jsonb_build_object('id', v_i.id, 'kind', v_i.kind, 'function_id', v_i.function_id, 'params', v_i.params),
    'ctx', jsonb_build_object(
      'link_id', v_i.link_id, 'org_id', v_ctx ->> 'org_id', 'user_id', v_ctx ->> 'user_id', 'project_id', v_ctx ->> 'project_id',
      'live_role', v_ctx ->> 'live_role', 'live_rank', (v_ctx ->> 'live_rank')::integer,
      'effective_level', (v_ctx ->> 'effective_level')::integer, 'money_visible', (v_ctx ->> 'money_visible')::boolean));
END
$fn$;

-- 8. minting and listing --------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ai_work_link_mint_user_for(p_user_id text, p_days integer DEFAULT 7, p_label text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_u record;
  v_rank integer;
  v_fns text[];
  v_now timestamptz := clock_timestamp();
  v_hour integer;
  v_day integer;
  v_token text;
  v_hash text;
  v_id text := replace(gen_random_uuid()::text, '-', '');
  v_expires timestamptz;
  v_label text := coalesce(nullif(left(btrim(coalesce(p_label, '')), 80), ''), 'All my projects');
BEGIN
  IF p_days IS NULL OR p_days NOT IN (1, 7, 30) THEN
    RAISE EXCEPTION 'BAD_DAYS' USING ERRCODE = 'AW400';
  END IF;
  SELECT u.id, u.org_id, u.role::text AS role, u.is_active INTO v_u FROM compliance.users u WHERE u.id = p_user_id;
  IF NOT FOUND OR NOT v_u.is_active OR v_u.org_id IS NULL THEN
    RAISE EXCEPTION 'USER_NOT_ACTIVE' USING ERRCODE = 'AW403';
  END IF;
  v_rank := public.ai_work_link__role_rank(v_u.role);

  -- the same lock and the same caps as ai_work_link_mint_for: a person's links, of either scope, are counted together
  PERFORM pg_advisory_xact_lock(hashtextextended('ai_work_link_mint:' || p_user_id, 0));
  SELECT count(*) FILTER (WHERE l.created_at > v_now - interval '1 hour'), count(*) INTO v_hour, v_day
  FROM platform.user_ai_links l
  WHERE l.user_id = p_user_id AND l.product = 'projexa' AND l.created_at > v_now - interval '1 day';
  IF v_hour >= 10 THEN
    RAISE EXCEPTION 'MINT_CAP_HOUR' USING ERRCODE = 'AW429';
  END IF;
  IF v_day >= 30 THEN
    RAISE EXCEPTION 'MINT_CAP_DAY' USING ERRCODE = 'AW429';
  END IF;

  v_fns := ARRAY(
    SELECT f.function_id FROM platform.ai_work_link_functions f
    WHERE f.product = 'projexa' AND f.link_level IS NOT NULL AND f.min_role_rank <= v_rank
    ORDER BY f.function_id);

  -- one live user link per person: the previous one stops now
  UPDATE platform.user_ai_links
  SET status = 'revoked', revoked_at = v_now
  WHERE user_id = p_user_id AND product = 'projexa' AND scope = 'user' AND status = 'active';

  v_token := 'pxa_' || encode(extensions.gen_random_bytes(32), 'hex');
  v_hash := encode(sha256(convert_to(v_token, 'UTF8')), 'hex');
  v_expires := v_now + make_interval(days => p_days);

  INSERT INTO platform.user_ai_links (
    id, org_id, user_id, token, status, created_at, product, project_id, token_hash, authority_level,
    allowed_functions, hide_personal, label, expires_at, created_by_user_id, call_count, write_count, scope)
  VALUES (
    v_id, v_u.org_id, p_user_id, NULL, 'active', v_now, 'projexa', NULL, v_hash, 0,
    v_fns, true, v_label, v_expires, p_user_id, 0, 0, 'user');

  RETURN jsonb_build_object(
    'link_id', v_id,
    'token', v_token,
    'scope', 'user',
    'level', 0,
    'allowed_functions', to_jsonb(v_fns),
    'hide_personal', true,
    'label', v_label,
    'expires_at', to_char(v_expires AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'project', NULL,
    'user_id', p_user_id);
END
$fn$;

CREATE OR REPLACE FUNCTION public.ai_work_link_list_for(p_user_id text, p_project_id text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_out jsonb;
BEGIN
  SELECT coalesce(jsonb_agg(x.j ORDER BY x.created_at DESC), '[]'::jsonb) INTO v_out
  FROM (
    SELECT l.created_at,
           jsonb_build_object(
             'id', l.id,
             'scope', l.scope,
             'project_id', l.project_id,
             'project_name', pr.name,
             'label', l.label,
             'level', l.authority_level,
             'allowed_functions', to_jsonb(l.allowed_functions),
             'hide_personal', l.hide_personal,
             'created_at', to_char(l.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
             'expires_at', to_char(l.expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
             'revoked_at', CASE WHEN l.revoked_at IS NULL THEN NULL ELSE to_char(l.revoked_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') END,
             'last_used_at', CASE WHEN l.last_used_at IS NULL THEN NULL ELSE to_char(l.last_used_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') END,
             'call_count', l.call_count,
             'write_count', l.write_count,
             'active', (l.status = 'active' AND l.expires_at > now())) AS j
    FROM platform.user_ai_links l
    JOIN compliance.users u ON u.id = l.user_id AND u.is_active
    LEFT JOIN compliance.projects pr ON pr.id = l.project_id
    WHERE l.user_id = p_user_id
      AND l.product = 'projexa'
      AND (p_project_id IS NULL OR l.project_id = p_project_id)
    ORDER BY l.created_at DESC
    LIMIT 100
  ) x;
  RETURN v_out;
END
$fn$;

-- 9. grants -------------------------------------------------------------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.ai_work_link__fns(text, boolean, text[], integer) FROM PUBLIC, anon, authenticated, app_runtime, service_role;
REVOKE ALL ON FUNCTION public.ai_work_link__resolve(text) FROM PUBLIC, anon, authenticated, app_runtime;
GRANT EXECUTE ON FUNCTION public.ai_work_link__resolve(text) TO service_role;
REVOKE ALL ON FUNCTION public.ai_work_link__live(text) FROM PUBLIC, anon, authenticated, app_runtime, service_role;
REVOKE ALL ON FUNCTION public.ai_work_link__bind(jsonb, text) FROM PUBLIC, anon, authenticated, app_runtime, service_role;
REVOKE ALL ON FUNCTION public.ai_work_link__require_in(text, text, boolean) FROM PUBLIC, anon, authenticated, app_runtime, service_role;
REVOKE ALL ON FUNCTION public.ai_work_link__resolve_in(text, text) FROM PUBLIC, anon, authenticated, app_runtime;
GRANT EXECUTE ON FUNCTION public.ai_work_link__resolve_in(text, text) TO service_role;
REVOKE ALL ON FUNCTION public.ai_work_link_projects(text, integer) FROM PUBLIC, anon, authenticated, app_runtime;
GRANT EXECUTE ON FUNCTION public.ai_work_link_projects(text, integer) TO service_role;
REVOKE ALL ON FUNCTION public.ai_work_link_records(text, text, text, integer, jsonb, text) FROM PUBLIC, anon, authenticated, app_runtime;
GRANT EXECUTE ON FUNCTION public.ai_work_link_records(text, text, text, integer, jsonb, text) TO service_role;
REVOKE ALL ON FUNCTION public.ai_work_link_record(text, text, text, text) FROM PUBLIC, anon, authenticated, app_runtime;
GRANT EXECUTE ON FUNCTION public.ai_work_link_record(text, text, text, text) TO service_role;
REVOKE ALL ON FUNCTION public.ai_work_link_context(text, text) FROM PUBLIC, anon, authenticated, app_runtime;
GRANT EXECUTE ON FUNCTION public.ai_work_link_context(text, text) TO service_role;
REVOKE ALL ON FUNCTION public.ai_work_link_record_intent(text, text, text, jsonb, text, text) FROM PUBLIC, anon, authenticated, app_runtime;
GRANT EXECUTE ON FUNCTION public.ai_work_link_record_intent(text, text, text, jsonb, text, text) TO service_role;
REVOKE ALL ON FUNCTION public.ai_work_link_intent_claim(text) FROM PUBLIC, anon, authenticated, app_runtime;
GRANT EXECUTE ON FUNCTION public.ai_work_link_intent_claim(text) TO service_role;
REVOKE ALL ON FUNCTION public.ai_work_link_mint_user_for(text, integer, text) FROM PUBLIC, anon, authenticated, app_runtime;
GRANT EXECUTE ON FUNCTION public.ai_work_link_mint_user_for(text, integer, text) TO service_role;
REVOKE ALL ON FUNCTION public.ai_work_link_list_for(text, text) FROM PUBLIC, anon, authenticated, app_runtime;
GRANT EXECUTE ON FUNCTION public.ai_work_link_list_for(text, text) TO service_role;

COMMIT;
