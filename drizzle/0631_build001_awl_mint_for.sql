-- PROJEXA-BUILD-002 WP-08 (register rows AW-401 to AW-404 and AW-406; spec sections 10.1 to 10.3; builds on BR-484 and BR-489 of
-- drizzle/0624): the signed-in app routes of the Universal AI Work Link need SQL that takes a compliance.users id. The four functions of
-- 0624 that the spec puts in the authenticated group (ai_work_link_create, _list, _revoke, _warning) take a Supabase Auth user id and join
-- compliance.users on auth_user_id. The Edge function maps a signed-in person to a compliance.users id with projexa_read_resolve_user, and
-- that lookup also resolves a person by e-mail when the gateway's e-mail fallback is on. Such a person has no auth_user_id match, so the
-- Auth-uuid functions would create a link for them and then list nothing ("I minted a link and it is not in my list"). These variants take
-- the user id the Edge function already resolved.
--
-- WHAT (five functions, all in schema public, reached only by the Edge function through the service-role key)
--   ai_work_link_list_for(p_user_id, p_project_id)
--       the person's own project links (newest first, at most 100), optionally for one project. No token and no hash is ever returned.
--   ai_work_link_warning_for(p_user_id, p_project_id, p_level)
--       the sentence the person reads BEFORE the link exists, with the counts it names, the person's rank, the highest level they may
--       choose, the functions their rank may have, and writes_enabled. THE SENTENCE IS TRUE FOR THE CURRENT STATE: the words "It can
--       also record daily entries in your name" appear only when level 1 is asked for, the person is rank 2 or above AND
--       platform.ai_work_link_settings.writes_enabled is true. While writes are off, a level 1 request gets a sentence that says
--       recording is not switched on yet. (ai_work_link_warning of 0624 is left as it is: nothing calls it any more.)
--   ai_work_link_revoke_for(p_user_id, p_link_id)
--       revokes through ai_work_link_revoke_service(link, actor): the link's own person or an admin of the link's organisation.
--   ai_work_link_mint_for(p_user_id, p_project_id, p_level, p_functions, p_days, p_hide_personal, p_label)
--       ai_work_link_create_for behind two per-person caps. The eligibility rules are create_for's own and run first (person active, project
--       in the person's organisation, canReadProject holds for that person (BR-489), level and functions within the person's rank), so a
--       project the person cannot read is refused before anything is counted or written.
--   ai_work_link_new_project_for(p_user_id, p_product_id, p_days)
--       "New project with my AI": one transaction that creates a shell project and mints a level 0 link for the same person. The insert
--       is the insert of createProject in src/lib/services/construction-dashboard-service.ts (organisation and product of the person,
--       the person as lead), because the Edge function cannot call that Node service. Rank 2 and above only, the same rule as
--       POST /api/v1/projexa/projects (role member). The shell is named "New project (AI setup)" and its link carries the label
--       "AI setup"; the AI renames and fills the project. If the link cannot be minted the project is not created (one transaction).
--
-- THE MINT COUNTER (the per-person rate limit). It is kept in platform.user_ai_links, the table the links are written to, and no new
--   table or column is added: a person may create at most 10 links in any rolling hour and 30 in any rolling day (AW429, MINT_CAP_HOUR and
--   MINT_CAP_DAY), and at most 5 shell projects in a rolling day (AW429, SHELL_CAP_DAY). Revoked and expired links still count, because
--   the row stays. The count runs under a per-person advisory lock, so two parallel mints cannot both pass the last free slot. The Edge
--   function adds a brake of 5 mint calls a minute per person in its own memory (a brake, not a cap; several isolates each keep a count).
--   The call log platform.ai_work_link_call is not used: an app route has no link token, and every row of that log names a link.
--
-- THE TWO GRANT RULES (BR-484, SHARED_BOUNDARY.md R5): every function below is revoked from PUBLIC, anon, authenticated and app_runtime
--   and granted to service_role alone (Supabase's default privileges would otherwise grant EXECUTE to anon and authenticated).
--
-- ERRORS (coded, so the Edge function maps them without reading prose):
--   AW403  USER_NOT_ACTIVE, PROJECT_NOT_READABLE, LEVEL_NOT_ALLOWED, FUNCTION_NOT_ALLOWED, NOT_ALLOWED, ROLE_TOO_LOW
--   AW404  PROJECT_NOT_FOUND, NOT_FOUND, PRODUCT_NOT_FOUND
--   AW400  BAD_LEVEL, BAD_DAYS
--   AW429  MINT_CAP_HOUR, MINT_CAP_DAY, SHELL_CAP_DAY
--
-- SECURITY: SECURITY DEFINER with search_path = pg_catalog, pg_temp and every object schema-qualified. The functions never take an
--   organisation from the caller: it comes from the person's row.
--
-- DATA LOSS: none. Additive: five functions. new_project_for inserts one compliance.projects row when it is called, never at apply time.
--
-- HOW IT IS APPLIED: through the Supabase MCP by the PM after the claim (ACTIVE-CLAIMS, BUILD-002) is on main and the always-aborted
--   rehearsal passed, and after 0621 to 0628 are applied. Idempotent: create or replace, and the grants repeat harmlessly.
--
-- ROLLBACK: drizzle/down/0631_build001_awl_mint_for.down.sql

BEGIN;

SET LOCAL lock_timeout = '5s';

-- 1. list -------------------------------------------------------------------------------------------------------------------------
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

-- 2. warning ----------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ai_work_link_warning_for(p_user_id text, p_project_id text, p_level integer DEFAULT 0)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_level integer := coalesce(p_level, 0);
  v_e jsonb;
  v_org text;
  v_rank integer;
  v_lines integer;
  v_tasks integer;
  v_people integer;
  v_money boolean;
  v_writes boolean;
  v_asks boolean;
  v_can boolean;
  v_functions jsonb;
BEGIN
  IF v_level NOT IN (0, 1) THEN
    RAISE EXCEPTION 'BAD_LEVEL' USING ERRCODE = 'AW400';
  END IF;
  v_e := public.ai_work_link__eligibility(p_user_id, p_project_id);
  v_org := v_e ->> 'org_id';
  v_rank := (v_e ->> 'rank')::integer;
  v_money := v_rank >= 3;
  SELECT coalesce((SELECT s.writes_enabled FROM platform.ai_work_link_settings s WHERE s.id), false) INTO v_writes;
  v_asks := v_level = 1 AND v_rank >= 2;
  v_can := v_asks AND v_writes;

  SELECT count(*) INTO v_lines
  FROM compliance.construction_boq_line_items li
  JOIN compliance.construction_boqs b ON b.id = li.boq_id
  WHERE b.project_id = p_project_id AND b.org_id = v_org AND li.org_id = v_org;
  SELECT count(*) INTO v_tasks FROM compliance.pms_issues i WHERE i.project_id = p_project_id AND i.org_id = v_org;
  SELECT count(DISTINCT p.id) INTO v_people
  FROM (SELECT x AS id FROM public.ai_work_link__project_people(v_org, p_project_id) AS x
        UNION SELECT p_user_id) p
  JOIN compliance.users u ON u.id = p.id AND u.org_id = v_org;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'function_id', f.function_id, 'kind', f.kind, 'level', f.link_level,
           'money_sensitive', f.money_sensitive, 'min_role_rank', f.min_role_rank) ORDER BY f.function_id), '[]'::jsonb)
    INTO v_functions
  FROM platform.ai_work_link_functions f
  WHERE f.product = 'projexa' AND f.link_level IS NOT NULL AND f.min_role_rank <= v_rank;

  RETURN jsonb_build_object(
    'project', jsonb_build_object('id', p_project_id, 'name', v_e ->> 'project_name'),
    'lines', v_lines,
    'tasks', v_tasks,
    'people', v_people,
    'money_visible', v_money,
    'level', v_level,
    'can_record', v_can,
    'writes_enabled', v_writes,
    'rank', v_rank,
    'max_level', CASE WHEN v_rank >= 2 THEN 1 ELSE 0 END,
    'functions', v_functions,
    'sentence',
      'This link lets an AI assistant read project ' || (v_e ->> 'project_name') || ' as you see it: '
      || v_lines || ' BOQ lines, ' || v_tasks || ' tasks and the names of ' || v_people || ' people'
      || CASE WHEN v_money THEN ', and money figures such as rates, amounts and budgets' ELSE '' END || '. '
      || CASE
           WHEN v_can THEN 'It can also record daily entries in your name.'
           WHEN v_asks THEN 'Recording entries directly is not switched on yet, so this link can read and prepare drafts only. It cannot change anything without your click.'
           ELSE 'It cannot change anything without your click.'
         END
      || ' When you paste it into an AI assistant, this information is sent to the company that runs that assistant, and an assistant that follows instructions in the data could send this information elsewhere. Use it only in an assistant that you alone use.');
END
$fn$;

-- 3. revoke -----------------------------------------------------------------------------------------------------------------------
-- ai_work_link_revoke_service(link, actor) already takes a compliance.users id. This is the same call with the person first, the order
-- of the other four functions here.
CREATE OR REPLACE FUNCTION public.ai_work_link_revoke_for(p_user_id text, p_link_id text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  RETURN public.ai_work_link_revoke_service(p_link_id, p_user_id);
END
$fn$;

-- 4. mint, behind the per-person caps -------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ai_work_link_mint_for(
  p_user_id text, p_project_id text, p_level integer DEFAULT 0, p_functions text[] DEFAULT NULL,
  p_days integer DEFAULT 7, p_hide_personal boolean DEFAULT true, p_label text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_hour integer;
  v_day integer;
BEGIN
  -- refuses first: not an active person, a project of another organisation, a private project the person may not read (BR-489)
  PERFORM public.ai_work_link__eligibility(p_user_id, p_project_id);
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
  RETURN public.ai_work_link_create_for(p_user_id, p_project_id, p_level, p_functions, p_days, p_hide_personal, p_label, p_user_id);
END
$fn$;

-- 5. a shell project and its link, in one transaction ---------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ai_work_link_new_project_for(p_user_id text, p_product_id text DEFAULT NULL, p_days integer DEFAULT 7)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_u record;
  v_product text;
  v_project text;
  v_shells integer;
  v_link jsonb;
BEGIN
  SELECT u.id, u.org_id, u.role::text AS role, u.is_active INTO v_u
  FROM compliance.users u WHERE u.id = p_user_id;
  IF NOT FOUND OR NOT v_u.is_active OR v_u.org_id IS NULL THEN
    RAISE EXCEPTION 'USER_NOT_ACTIVE' USING ERRCODE = 'AW403';
  END IF;
  -- the rule of POST /api/v1/projexa/projects: role member (rank 2) and above
  IF public.ai_work_link__role_rank(v_u.role) < 2 THEN
    RAISE EXCEPTION 'ROLE_TOO_LOW' USING ERRCODE = 'AW403';
  END IF;
  IF p_days IS NULL OR p_days NOT IN (1, 7, 30) THEN
    RAISE EXCEPTION 'BAD_DAYS' USING ERRCODE = 'AW400';
  END IF;

  -- createProject: the product must belong to the person's organisation. With no product named, the organisation's oldest active one.
  IF p_product_id IS NOT NULL THEN
    SELECT pr.id INTO v_product FROM compliance.products pr WHERE pr.id = p_product_id AND pr.org_id = v_u.org_id;
  ELSE
    SELECT pr.id INTO v_product FROM compliance.products pr
    WHERE pr.org_id = v_u.org_id AND pr.is_active
    ORDER BY pr.created_at, pr.id LIMIT 1;
  END IF;
  IF v_product IS NULL THEN
    RAISE EXCEPTION 'PRODUCT_NOT_FOUND' USING ERRCODE = 'AW404';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('ai_work_link_mint:' || p_user_id, 0));
  SELECT count(*) INTO v_shells
  FROM platform.user_ai_links l
  WHERE l.user_id = p_user_id AND l.product = 'projexa' AND l.label = 'AI setup' AND l.created_at > clock_timestamp() - interval '1 day';
  IF v_shells >= 5 THEN
    RAISE EXCEPTION 'SHELL_CAP_DAY' USING ERRCODE = 'AW429';
  END IF;

  INSERT INTO compliance.projects (org_id, product_id, name, description, lead_user_id)
  VALUES (v_u.org_id, v_product, 'New project (AI setup)',
          'Created with "New project with my AI". The AI assistant renames it and fills it in.', p_user_id)
  RETURNING id INTO v_project;

  v_link := public.ai_work_link_mint_for(p_user_id, v_project, 0, NULL, p_days, true, 'AI setup');

  RETURN jsonb_build_object(
    'project', jsonb_build_object('id', v_project, 'name', 'New project (AI setup)', 'product_id', v_product),
    'link', v_link);
END
$fn$;

-- 6. grants -----------------------------------------------------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.ai_work_link_list_for(text, text) FROM PUBLIC, anon, authenticated, app_runtime;
GRANT EXECUTE ON FUNCTION public.ai_work_link_list_for(text, text) TO service_role;
REVOKE ALL ON FUNCTION public.ai_work_link_warning_for(text, text, integer) FROM PUBLIC, anon, authenticated, app_runtime;
GRANT EXECUTE ON FUNCTION public.ai_work_link_warning_for(text, text, integer) TO service_role;
REVOKE ALL ON FUNCTION public.ai_work_link_revoke_for(text, text) FROM PUBLIC, anon, authenticated, app_runtime;
GRANT EXECUTE ON FUNCTION public.ai_work_link_revoke_for(text, text) TO service_role;
REVOKE ALL ON FUNCTION public.ai_work_link_mint_for(text, text, integer, text[], integer, boolean, text) FROM PUBLIC, anon, authenticated, app_runtime;
GRANT EXECUTE ON FUNCTION public.ai_work_link_mint_for(text, text, integer, text[], integer, boolean, text) TO service_role;
REVOKE ALL ON FUNCTION public.ai_work_link_new_project_for(text, text, integer) FROM PUBLIC, anon, authenticated, app_runtime;
GRANT EXECUTE ON FUNCTION public.ai_work_link_new_project_for(text, text, integer) TO service_role;

COMMIT;
