-- PROJEXA-BUILD-001 U-46 step 1 (database), migration 4 of 8 (register rows BR-484, BR-489; spec sections 10.1 to 10.5, 10.9 and
-- 10.11, audit A-03, A-05, A-12, PMD-33): the link lifecycle functions of the Universal AI Work Link. Token to link, the call log,
-- the context page, minting, listing, revoking and the warning sentence. Every function lives in schema public (the schema PostgREST
-- exposes, the DPDP precedent of drizzle/0610) and is reached only by the Edge Function through the service-role key.
--
-- THE TWO GRANT RULES (register row BR-484, SHARED_BOUNDARY.md R5)
--   1. No function of this file is executable by anon or PUBLIC, and none by authenticated. Supabase's default privileges in schema
--      public grant EXECUTE on every new function to anon, authenticated and service_role, so every function below is revoked from
--      public, anon, authenticated and app_runtime first, and then granted to service_role alone, except the six internal helpers
--      (cost_visible, hidden_cols, project_people, eligibility, require, user_for_project), which only the functions here call and
--      which nobody but the owner may execute.
--   2. The spec (section 10.11) marks four functions callable by the authenticated role: ai_work_link_create, ai_work_link_list,
--      ai_work_link_revoke and ai_work_link_warning. That conflicts with R5, and ACTIVE-CLAIMS records the default: serve those four
--      through the service-role gateway and grant nothing to authenticated. So here they take the caller's Supabase Auth user id as
--      an explicit first argument (the Edge Function verifies the JWT and passes its sub), instead of reading auth.uid(). A PROJEXA
--      person (signed in on another project) is mapped by the Edge Function to a compliance.users id and uses ai_work_link_create_for.
--
-- WHAT (17 of the functions named in spec section 10.11 are in migrations 4 to 7; this file holds these)
--   pure helpers (no table read; IMMUTABLE)
--     ai_work_link__role_rank(role)                     the ROLE_RANK of src/lib/supabase/role-rank.ts (0 for an unknown role)
--     ai_work_link__can_read_project(access, lead, user, role)
--                                                        the canReadProject rule of src/lib/services/product-service.ts (spec F-9,
--                                                        register row BR-489): a project that is not 'private' is readable by all;
--                                                        a private one only by an admin (rank 5 and above) or its lead
--     ai_work_link__hash_token(token)                   sha256 hex of a well-formed pxa_ token, NULL for anything else
--     ai_work_link__ip_prefix(address)                  the /24 (IPv4) or /48 (IPv6) network only; the literal 'all' passes; NULL when
--                                                        the text is not an address. A full address is never stored.
--     ai_work_link__clean_path(path)                    drops the query string, replaces anything shaped like a token
--     ai_work_link__mask_email(email)                   a***@domain
--   helpers that read a table
--     ai_work_link__cost_visible(org, role)             the cost-visibility gate of cost-visibility-service.ts: client_viewer never,
--                                                        otherwise compliance.cost_visibility_config, and no row means no
--     ai_work_link__hidden_cols(kind, org, role)        the columns of a record kind hidden for that role (migration 5 uses it)
--     ai_work_link__project_people(org, project)        the ids of the people a project's records name
--     ai_work_link__eligibility(user, project)          the minting rule; raises a coded error
--     ai_work_link__require(token)                      resolve, or raise the one refusal sentence
--   the twelve-function family of the spec
--     ai_work_link__resolve(token) -> jsonb             the live link: person, project, live role and rank, the EFFECTIVE level and
--                                                        function list (spec 10.9), money_visible. status 'gone' for anything that
--                                                        does not resolve (one answer for unknown, expired, revoked, person no longer
--                                                        active or moved, project no longer readable: PMD-33, audit A-03)
--     ai_work_link_log_call(token, method, path, ip_prefix, ua_family) -> jsonb
--                                                        one append-only row per call, FAIL CLOSED (an error reaches the caller, which
--                                                        answers 503). 120 calls a minute per link; 30 a minute per address prefix for
--                                                        a token that matches no live link (unknown, revoked or expired: the row then
--                                                        carries no link, spec 10.5); over the limit the call is refused BEFORE any
--                                                        row is written (audit A-12)
--     ai_work_link_log_call_result(call_id, status, bytes) -> jsonb
--     ai_work_link_context(token) -> jsonb              spec 6.1 (business counters only)
--     ai_work_link_create_for(user, project, level, functions, days, hide_personal, label, created_by) -> jsonb
--                                                        mints a link (below)
--     ai_work_link_revoke_service(link, actor) -> jsonb
--   the four of the spec's authenticated group, service_role only here
--     ai_work_link_create(auth_user, project, level, functions, days, hide_personal, label)
--     ai_work_link_list(auth_user, project)
--     ai_work_link_revoke(auth_user, link)
--     ai_work_link_warning(auth_user, project, level)
--
-- MINTING (spec 10.1 to 10.3). Eligibility, all live: the person is active and has an organisation; the project belongs to that
--   organisation; canReadProject holds; the level and the functions are within the person's role rank (level 1 needs rank 2 and
--   above; a function needs its own minimum rank). Expiry is 1, 7 or 30 days. The token is 'pxa_' + 64 hex from 32 random bytes,
--   returned once and stored only as sha256; the plaintext column stays NULL (check user_ai_links_projexa_shape of 0613). The
--   previous active link of the same person and project is revoked in the same transaction.
--
-- ERRORS. Every refusal is a coded exception, so the Edge Function can map it without reading prose:
--   SQLSTATE AW410  This link has expired or was revoked          (the one sentence for every dead link, spec 3.6)
--   SQLSTATE AW403  USER_NOT_ACTIVE, PROJECT_NOT_READABLE, LEVEL_NOT_ALLOWED, FUNCTION_NOT_ALLOWED, NOT_ALLOWED,
--                   FUNCTION_NOT_ON_LINK, WRONG_PROJECT, HIDDEN_FIELD
--   SQLSTATE AW404  PROJECT_NOT_FOUND, NOT_FOUND
--   SQLSTATE AW400  BAD_LEVEL, BAD_DAYS, BAD_KIND, BAD_PARAMS, UNKNOWN_KIND, UNKNOWN_FILTER, BAD_FILTER_VALUE, BAD_CURSOR
--   SQLSTATE AW429  WRITE_CAP_HOUR, WRITE_CAP_DAY
--
-- SECURITY: every SECURITY DEFINER function pins search_path = pg_catalog, pg_temp and schema-qualifies every object it touches
--   (pg_temp last, so a temporary object can never shadow a table or function). The functions never take an organisation or a
--   project from the caller: both come from the link row.
--
-- DATA LOSS: none. Additive: functions only. This file creates no row.
--
-- HOW IT IS APPLIED: through the Supabase MCP by the PM after the claim (ACTIVE-CLAIMS, 2026-09-25) is on main and the
--   always-aborted rehearsal passed, and after migrations 0621 to 0623 are applied (the functions read those tables when they run;
--   PL/pgSQL does not check that at creation). Idempotent: create or replace, and the grants repeat harmlessly.
--
-- ROLLBACK: drizzle/down/0624_build001_awl_link_functions.down.sql

BEGIN;

SET LOCAL lock_timeout = '5s';

-- 1. pure helpers -----------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ai_work_link__role_rank(p_role text)
RETURNS integer
LANGUAGE sql IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT CASE p_role
    WHEN 'viewer' THEN 1
    WHEN 'client_viewer' THEN 1
    WHEN 'external_auditor' THEN 1
    WHEN 'stage_0' THEN 1
    WHEN 'member' THEN 2
    WHEN 'team_member' THEN 2
    WHEN 'senior_professional' THEN 3
    WHEN 'manager' THEN 3
    WHEN 'branch_manager' THEN 4
    WHEN 'admin' THEN 5
    WHEN 'veridian_admin' THEN 6
    ELSE 0
  END
$fn$;

CREATE OR REPLACE FUNCTION public.ai_work_link__can_read_project(p_access_level text, p_lead_user_id text, p_user_id text, p_role text)
RETURNS boolean
LANGUAGE sql IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT CASE
    WHEN p_access_level IS DISTINCT FROM 'private' THEN true
    WHEN p_user_id IS NULL THEN false
    WHEN public.ai_work_link__role_rank(p_role) >= 5 THEN true
    ELSE coalesce(p_lead_user_id = p_user_id, false)
  END
$fn$;

CREATE OR REPLACE FUNCTION public.ai_work_link__hash_token(p_token text)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT CASE WHEN p_token ~ '^pxa_[0-9a-f]{64}$'
              THEN encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
         END
$fn$;

CREATE OR REPLACE FUNCTION public.ai_work_link__ip_prefix(p_ip text)
RETURNS text
LANGUAGE plpgsql IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_ip inet;
BEGIN
  IF p_ip IS NULL OR btrim(p_ip) = '' THEN
    RETURN NULL;
  END IF;
  IF btrim(p_ip) = 'all' THEN
    RETURN 'all';
  END IF;
  v_ip := btrim(p_ip)::inet;
  RETURN network(set_masklen(v_ip, CASE family(v_ip) WHEN 4 THEN 24 ELSE 48 END))::text;
EXCEPTION WHEN others THEN
  RETURN NULL;
END
$fn$;

CREATE OR REPLACE FUNCTION public.ai_work_link__clean_path(p_path text)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT left(regexp_replace(split_part(coalesce(p_path, ''), '?', 1), 'pxa_[0-9A-Za-z]{16,}', 'pxa_[redacted]', 'g'), 512)
$fn$;

CREATE OR REPLACE FUNCTION public.ai_work_link__mask_email(p_email text)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT CASE
    WHEN p_email IS NULL THEN NULL
    WHEN position('@' IN p_email) < 2 THEN '***'
    ELSE left(p_email, 1) || '***' || substr(p_email, position('@' IN p_email))
  END
$fn$;

-- 2. helpers that read a table ------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ai_work_link__cost_visible(p_org_id text, p_role text)
RETURNS boolean
LANGUAGE plpgsql STABLE
SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_ok boolean;
BEGIN
  IF p_role IS NULL OR p_role = 'client_viewer' THEN
    RETURN false;
  END IF;
  SELECT c.can_see_cost INTO v_ok
  FROM compliance.cost_visibility_config c
  WHERE c.org_id = p_org_id AND c.role::text = p_role;
  RETURN coalesce(v_ok, false);
END
$fn$;

-- Columns of a record kind that are hidden for this role. Below rank 3 every money column of the kind. From rank 3, only the
-- project-side cost fields (the PROJECT_SIDE_COST_FIELDS of cost-visibility-service.ts that a kind exposes), and only when the
-- organisation's cost-visibility configuration does not grant the role: the one gate, so a link never shows what the app hides.
CREATE OR REPLACE FUNCTION public.ai_work_link__hidden_cols(p_kind text, p_org_id text, p_role text)
RETURNS text[]
LANGUAGE plpgsql STABLE
SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_money text[];
BEGIN
  SELECT k.money_columns INTO v_money FROM platform.ai_work_link_record_kinds k WHERE k.kind = p_kind;
  IF v_money IS NULL THEN
    RETURN '{}'::text[];
  END IF;
  IF public.ai_work_link__role_rank(p_role) < 3 THEN
    RETURN v_money;
  END IF;
  IF public.ai_work_link__cost_visible(p_org_id, p_role) THEN
    RETURN '{}'::text[];
  END IF;
  RETURN ARRAY(SELECT c FROM unnest(v_money) AS c WHERE c = ANY (ARRAY['rate_project', 'qty_project', 'project_value']));
END
$fn$;

-- The ids of every person a project's records name: the lead, the team, assignees and authors, and whoever recorded progress,
-- a BOQ or time. The same set the 'people' record kind lists and the warning sentence counts.
CREATE OR REPLACE FUNCTION public.ai_work_link__project_people(p_org_id text, p_project_id text)
RETURNS SETOF text
LANGUAGE plpgsql STABLE
SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  RETURN QUERY
  SELECT pr.lead_user_id FROM compliance.projects pr
   WHERE pr.id = p_project_id AND pr.org_id = p_org_id AND pr.lead_user_id IS NOT NULL
  UNION
  SELECT m.user_id FROM compliance.project_team_members m
   WHERE m.project_id = p_project_id AND m.org_id = p_org_id
  UNION
  SELECT i.assignee_id FROM compliance.pms_issues i
   WHERE i.project_id = p_project_id AND i.org_id = p_org_id AND i.assignee_id IS NOT NULL
  UNION
  SELECT i.created_by_id FROM compliance.pms_issues i
   WHERE i.project_id = p_project_id AND i.org_id = p_org_id AND i.created_by_id IS NOT NULL
  UNION
  SELECT e.recorded_by_id FROM compliance.construction_work_progress_entries e
   WHERE e.project_id = p_project_id AND e.org_id = p_org_id
  UNION
  SELECT b.created_by_id FROM compliance.construction_boqs b
   WHERE b.project_id = p_project_id AND b.org_id = p_org_id
  UNION
  SELECT t.user_id FROM compliance.pms_time_entries t
   JOIN compliance.pms_issues i ON i.id = t.issue_id
   WHERE i.project_id = p_project_id AND i.org_id = p_org_id AND t.org_id = p_org_id;
END
$fn$;

-- The minting rule (spec 10.1): raises a coded error unless the person may have a link on the project.
CREATE OR REPLACE FUNCTION public.ai_work_link__eligibility(p_user_id text, p_project_id text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_u record;
  v_p record;
BEGIN
  SELECT u.id, u.name, u.role::text AS role, u.is_active, u.org_id INTO v_u
  FROM compliance.users u WHERE u.id = p_user_id;
  IF NOT FOUND OR NOT v_u.is_active OR v_u.org_id IS NULL THEN
    RAISE EXCEPTION 'USER_NOT_ACTIVE' USING ERRCODE = 'AW403';
  END IF;
  SELECT pr.id, pr.name, pr.org_id, pr.access_level::text AS access_level, pr.lead_user_id INTO v_p
  FROM compliance.projects pr WHERE pr.id = p_project_id;
  IF NOT FOUND OR v_p.org_id IS DISTINCT FROM v_u.org_id THEN
    RAISE EXCEPTION 'PROJECT_NOT_FOUND' USING ERRCODE = 'AW404';
  END IF;
  IF NOT public.ai_work_link__can_read_project(v_p.access_level, v_p.lead_user_id, v_u.id, v_u.role) THEN
    RAISE EXCEPTION 'PROJECT_NOT_READABLE' USING ERRCODE = 'AW403';
  END IF;
  RETURN jsonb_build_object(
    'user_id', v_u.id, 'user_name', v_u.name, 'org_id', v_u.org_id, 'role', v_u.role,
    'rank', public.ai_work_link__role_rank(v_u.role),
    'project_id', v_p.id, 'project_name', v_p.name);
END
$fn$;

-- 3. token to link ---------------------------------------------------------------------------------------------------------------------
-- The live link. Everything that decides what the link may do is read now, from the person's row: nothing about the role is stored on
-- the link (spec 10.2). 'gone' is the answer for every reason a link cannot act, so a caller learns nothing about which one.
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
  v_rank integer;
  v_writes boolean;
  v_level integer;
  v_fns text[];
  v_gone constant jsonb := jsonb_build_object('status', 'gone');
BEGIN
  IF v_hash IS NULL THEN
    RETURN v_gone;
  END IF;
  SELECT l.id, l.org_id, l.user_id, l.project_id, l.status, l.expires_at, l.authority_level, l.allowed_functions, l.hide_personal, l.label
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

  -- the project still exists in the organisation and is still readable by this person (spec 10.3)
  SELECT pr.id, pr.name, pr.org_id, pr.access_level::text AS access_level, pr.lead_user_id INTO v_p
  FROM compliance.projects pr WHERE pr.id = v_l.project_id;
  IF NOT FOUND OR v_p.org_id IS DISTINCT FROM v_l.org_id
     OR NOT public.ai_work_link__can_read_project(v_p.access_level, v_p.lead_user_id, v_u.id, v_u.role) THEN
    RETURN v_gone;
  END IF;

  v_rank := public.ai_work_link__role_rank(v_u.role);
  SELECT coalesce((SELECT s.writes_enabled FROM platform.ai_work_link_settings s WHERE s.id), false) INTO v_writes;

  -- spec 10.9: level 0 while no executor exists, and for any person below rank 2; otherwise the ceiling chosen at mint
  v_level := CASE WHEN NOT v_writes OR v_rank < 2 THEN 0 ELSE v_l.authority_level END;

  v_fns := ARRAY(
    SELECT f.function_id
    FROM platform.ai_work_link_functions f
    WHERE f.product = 'projexa'
      AND f.link_level IS NOT NULL
      AND f.function_id = ANY (v_l.allowed_functions)
      AND f.min_role_rank <= v_rank
    ORDER BY f.function_id);

  RETURN jsonb_build_object(
    'status', 'ok',
    'link_id', v_l.id,
    'org_id', v_l.org_id,
    'user_id', v_u.id,
    'user_name', v_u.name,
    'project_id', v_p.id,
    'project_name', v_p.name,
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

-- The link, or the one refusal sentence for every dead link.
CREATE OR REPLACE FUNCTION public.ai_work_link__require(p_token text)
RETURNS jsonb
LANGUAGE plpgsql STABLE
SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_ctx jsonb := public.ai_work_link__resolve(p_token);
BEGIN
  IF v_ctx ->> 'status' IS DISTINCT FROM 'ok' THEN
    RAISE EXCEPTION 'This link has expired or was revoked' USING ERRCODE = 'AW410';
  END IF;
  RETURN v_ctx;
END
$fn$;

-- 4. the call log (spec 10.5) ----------------------------------------------------------------------------------------------------------
-- FAIL CLOSED: nothing here swallows an error. If the row cannot be written (no partition for the month, a full disk, a lock timeout),
-- the exception reaches the Edge Function, which answers 503 and serves nothing. Over a limit the call is refused BEFORE a row is
-- written, so probing cannot grow the log: a leaked link writes at most 120 rows a minute, an unknown token 30 per address prefix.
CREATE OR REPLACE FUNCTION public.ai_work_link_log_call(
  p_token text, p_method text, p_path text, p_ip_prefix text DEFAULT NULL, p_ua_family text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_hash text := public.ai_work_link__hash_token(p_token);
  v_l record;
  v_found boolean := false;
  v_live boolean := false;
  v_prefix text := public.ai_work_link__ip_prefix(p_ip_prefix);
  v_now timestamptz := clock_timestamp();
  v_recent integer := 0;
  v_id text;
BEGIN
  IF p_token IS NOT NULL AND v_hash IS NULL THEN
    -- a malformed token creates no row (the Edge Function refuses it before it gets here)
    RETURN jsonb_build_object('status', 'malformed');
  END IF;

  IF v_hash IS NOT NULL THEN
    SELECT l.id, l.org_id, l.status, l.expires_at INTO v_l
    FROM platform.user_ai_links l
    WHERE l.token_hash = v_hash AND l.product = 'projexa';
    v_found := FOUND;
  END IF;

  -- Spec 10.5: an unknown OR expired token is counted per address prefix, from rows with link_id IS NULL. So a link that is revoked
  -- or past its expiry is treated like an unknown token from here on: it is limited by address, its row carries no link, and it
  -- cannot be used to grow the log faster than an unknown token can.
  IF v_found THEN
    v_live := v_l.status = 'active' AND v_l.expires_at IS NOT NULL AND v_l.expires_at > v_now;
  END IF;

  IF v_live THEN
    SELECT count(*) INTO v_recent
    FROM platform.ai_work_link_call c
    WHERE c.link_id = v_l.id AND c.called_at > v_now - interval '60 seconds';
    IF v_recent >= 120 THEN
      RETURN jsonb_build_object('status', 'throttled', 'scope', 'link', 'calls_last_minute', v_recent, 'limit_per_minute', 120);
    END IF;
  ELSE
    -- two plain predicates instead of IS NOT DISTINCT FROM, so the partial index (ip_prefix, called_at) WHERE link_id IS NULL is used
    IF v_prefix IS NULL THEN
      SELECT count(*) INTO v_recent
      FROM platform.ai_work_link_call c
      WHERE c.link_id IS NULL AND c.ip_prefix IS NULL AND c.called_at > v_now - interval '60 seconds';
    ELSE
      SELECT count(*) INTO v_recent
      FROM platform.ai_work_link_call c
      WHERE c.link_id IS NULL AND c.ip_prefix = v_prefix AND c.called_at > v_now - interval '60 seconds';
    END IF;
    IF v_recent >= 30 THEN
      RETURN jsonb_build_object('status', 'throttled', 'scope', 'address', 'calls_last_minute', v_recent, 'limit_per_minute', 30);
    END IF;
  END IF;

  INSERT INTO platform.ai_work_link_call (link_id, org_id, method, path, ip_prefix, ua_family, called_at)
  VALUES (
    CASE WHEN v_live THEN v_l.id END,
    CASE WHEN v_live THEN v_l.org_id END,
    left(coalesce(p_method, ''), 10),
    public.ai_work_link__clean_path(p_path),
    v_prefix,
    nullif(left(coalesce(p_ua_family, ''), 40), ''),
    v_now)
  RETURNING id INTO v_id;

  IF v_live THEN
    UPDATE platform.user_ai_links SET call_count = call_count + 1, last_used_at = v_now WHERE id = v_l.id;
  END IF;

  RETURN jsonb_build_object(
    'status', CASE WHEN v_live THEN 'ok' WHEN v_found THEN 'gone' ELSE 'unknown' END,
    'call_id', v_id,
    'link_id', CASE WHEN v_live THEN v_l.id END,
    'calls_last_minute', v_recent + 1,
    'limit_per_minute', CASE WHEN v_live THEN 120 ELSE 30 END);
END
$fn$;

CREATE OR REPLACE FUNCTION public.ai_work_link_log_call_result(p_call_id text, p_status integer, p_bytes integer DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_n integer;
BEGIN
  -- the partition is chosen by called_at: a request lasts minutes at most, so an hour bound keeps the update to one partition
  UPDATE platform.ai_work_link_call
  SET status = p_status, bytes = p_bytes, finished_at = clock_timestamp()
  WHERE id = p_call_id AND status IS NULL AND called_at > clock_timestamp() - interval '1 hour';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('ok', v_n = 1);
END
$fn$;

-- 5. the context page (spec 6.1) -----------------------------------------------------------------------------------------------------
-- counters holds BUSINESS counters only: this link's intents, and the submissions of the person on the project. The rate moves on
-- every call (every call writes a log row) and is audit, not business state.
CREATE OR REPLACE FUNCTION public.ai_work_link_context(p_token text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_ctx jsonb := public.ai_work_link__require(p_token);
  v_org text := v_ctx ->> 'org_id';
  v_role text := v_ctx ->> 'live_role';
  v_writes boolean := (v_ctx ->> 'writes_enabled')::boolean;
  v_fns text[] := ARRAY(SELECT jsonb_array_elements_text(v_ctx -> 'effective_functions'));
  v_functions jsonb;
  v_money jsonb;
  v_intents integer;
  v_subs integer;
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
  SELECT count(*) INTO v_subs FROM compliance.submissions s
   WHERE s.user_id = v_ctx ->> 'user_id' AND s.project_id = v_ctx ->> 'project_id' AND s.org_id = v_org;
  SELECT count(*) INTO v_calls FROM platform.ai_work_link_call c
   WHERE c.link_id = v_ctx ->> 'link_id' AND c.called_at > clock_timestamp() - interval '60 seconds';

  RETURN jsonb_build_object(
    'product', 'projexa',
    'project', jsonb_build_object('id', v_ctx -> 'project_id', 'name', v_ctx -> 'project_name'),
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

-- 6. minting, listing, revoking, the warning (spec 10.1, 10.3) ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ai_work_link_create_for(
  p_user_id text, p_project_id text, p_level integer DEFAULT 0, p_functions text[] DEFAULT NULL,
  p_days integer DEFAULT 7, p_hide_personal boolean DEFAULT true, p_label text DEFAULT NULL,
  p_created_by_user_id text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_e jsonb;
  v_rank integer;
  v_fns text[];
  v_token text;
  v_hash text;
  v_id text := replace(gen_random_uuid()::text, '-', '');
  v_now timestamptz := clock_timestamp();
  v_expires timestamptz;
  v_label text := nullif(left(btrim(coalesce(p_label, '')), 80), '');
BEGIN
  IF p_level IS NULL OR p_level NOT IN (0, 1) THEN
    RAISE EXCEPTION 'BAD_LEVEL' USING ERRCODE = 'AW400';
  END IF;
  IF p_days IS NULL OR p_days NOT IN (1, 7, 30) THEN
    RAISE EXCEPTION 'BAD_DAYS' USING ERRCODE = 'AW400';
  END IF;

  v_e := public.ai_work_link__eligibility(p_user_id, p_project_id);
  v_rank := (v_e ->> 'rank')::integer;
  IF p_level = 1 AND v_rank < 2 THEN
    RAISE EXCEPTION 'LEVEL_NOT_ALLOWED' USING ERRCODE = 'AW403';
  END IF;

  IF cardinality(p_functions) > 50 THEN
    RAISE EXCEPTION 'FUNCTION_NOT_ALLOWED' USING ERRCODE = 'AW403';
  END IF;
  IF p_functions IS NULL THEN
    v_fns := ARRAY(
      SELECT f.function_id FROM platform.ai_work_link_functions f
      WHERE f.product = 'projexa' AND f.link_level IS NOT NULL AND f.min_role_rank <= v_rank
      ORDER BY f.function_id);
  ELSE
    v_fns := ARRAY(SELECT DISTINCT x FROM unnest(p_functions) AS x ORDER BY x);
    IF EXISTS (
      SELECT 1 FROM unnest(v_fns) AS x
      WHERE NOT EXISTS (
        SELECT 1 FROM platform.ai_work_link_functions f
        WHERE f.function_id = x AND f.product = 'projexa' AND f.link_level IS NOT NULL AND f.min_role_rank <= v_rank)
    ) THEN
      RAISE EXCEPTION 'FUNCTION_NOT_ALLOWED' USING ERRCODE = 'AW403';
    END IF;
  END IF;

  -- one live link per person and project: serialise, revoke the previous one, then insert (D-03)
  PERFORM pg_advisory_xact_lock(hashtextextended('ai_work_link:' || p_user_id || ':' || p_project_id, 0));
  UPDATE platform.user_ai_links
  SET status = 'revoked', revoked_at = v_now
  WHERE user_id = p_user_id AND project_id = p_project_id AND product = 'projexa' AND status = 'active';

  v_token := 'pxa_' || encode(extensions.gen_random_bytes(32), 'hex');
  v_hash := encode(sha256(convert_to(v_token, 'UTF8')), 'hex');
  v_expires := v_now + make_interval(days => p_days);

  INSERT INTO platform.user_ai_links (
    id, org_id, user_id, token, status, created_at, product, project_id, token_hash, authority_level,
    allowed_functions, hide_personal, label, expires_at, created_by_user_id, call_count, write_count)
  VALUES (
    v_id, v_e ->> 'org_id', p_user_id, NULL, 'active', v_now, 'projexa', p_project_id, v_hash, p_level,
    v_fns, coalesce(p_hide_personal, true), v_label, v_expires, coalesce(p_created_by_user_id, p_user_id), 0, 0);

  RETURN jsonb_build_object(
    'link_id', v_id,
    'token', v_token,
    'level', p_level,
    'allowed_functions', to_jsonb(v_fns),
    'hide_personal', coalesce(p_hide_personal, true),
    'label', v_label,
    'expires_at', to_char(v_expires AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'project', jsonb_build_object('id', p_project_id, 'name', v_e ->> 'project_name'),
    'user_id', p_user_id);
END
$fn$;

-- The compliance user of a Supabase Auth user inside the project's organisation.
CREATE OR REPLACE FUNCTION public.ai_work_link__user_for_project(p_auth_user_id uuid, p_project_id text)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_user text;
BEGIN
  SELECT u.id INTO v_user
  FROM compliance.users u
  JOIN compliance.projects pr ON pr.org_id = u.org_id
  WHERE pr.id = p_project_id AND u.auth_user_id = p_auth_user_id AND u.is_active
  ORDER BY u.created_at, u.id
  LIMIT 1;
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'PROJECT_NOT_FOUND' USING ERRCODE = 'AW404';
  END IF;
  RETURN v_user;
END
$fn$;

CREATE OR REPLACE FUNCTION public.ai_work_link_create(
  p_auth_user_id uuid, p_project_id text, p_level integer DEFAULT 0, p_functions text[] DEFAULT NULL,
  p_days integer DEFAULT 7, p_hide_personal boolean DEFAULT true, p_label text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  RETURN public.ai_work_link_create_for(
    public.ai_work_link__user_for_project(p_auth_user_id, p_project_id),
    p_project_id, p_level, p_functions, p_days, p_hide_personal, p_label, NULL);
END
$fn$;

CREATE OR REPLACE FUNCTION public.ai_work_link_list(p_auth_user_id uuid, p_project_id text DEFAULT NULL)
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
    JOIN compliance.users u ON u.id = l.user_id
    LEFT JOIN compliance.projects pr ON pr.id = l.project_id
    WHERE u.auth_user_id = p_auth_user_id
      AND l.product = 'projexa'
      AND (p_project_id IS NULL OR l.project_id = p_project_id)
    ORDER BY l.created_at DESC
    LIMIT 100
  ) x;
  RETURN v_out;
END
$fn$;

-- Revoke by the link's person or by an admin of the link's organisation (spec 10.3). Takes effect on the next call, because every call
-- resolves the link again and nothing is cached.
CREATE OR REPLACE FUNCTION public.ai_work_link_revoke_service(p_link_id text, p_actor_user_id text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_l record;
  v_a record;
  v_revoked text;
BEGIN
  SELECT l.id, l.org_id, l.user_id INTO v_l
  FROM platform.user_ai_links l WHERE l.id = p_link_id AND l.product = 'projexa';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'AW404';
  END IF;
  SELECT u.org_id, u.role::text AS role, u.is_active INTO v_a
  FROM compliance.users u WHERE u.id = p_actor_user_id;
  IF NOT FOUND OR NOT v_a.is_active
     OR NOT (v_l.user_id = p_actor_user_id
             OR (v_a.org_id IS NOT DISTINCT FROM v_l.org_id AND public.ai_work_link__role_rank(v_a.role) >= 5)) THEN
    RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE = 'AW403';
  END IF;
  UPDATE platform.user_ai_links
  SET status = 'revoked', revoked_at = clock_timestamp()
  WHERE id = p_link_id AND status = 'active'
  RETURNING id INTO v_revoked;
  RETURN jsonb_build_object('link_id', p_link_id, 'revoked', v_revoked IS NOT NULL, 'already', v_revoked IS NULL);
END
$fn$;

CREATE OR REPLACE FUNCTION public.ai_work_link_revoke(p_auth_user_id uuid, p_link_id text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_actor text;
BEGIN
  SELECT u.id INTO v_actor
  FROM platform.user_ai_links l
  JOIN compliance.users u ON u.org_id = l.org_id
  WHERE l.id = p_link_id AND l.product = 'projexa' AND u.auth_user_id = p_auth_user_id AND u.is_active
  ORDER BY (u.id = l.user_id) DESC, u.created_at, u.id
  LIMIT 1;
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE = 'AW403';
  END IF;
  RETURN public.ai_work_link_revoke_service(p_link_id, v_actor);
END
$fn$;

-- The sentence the person sees BEFORE the link exists (spec 10.1, audit A-04 and A-17), with the counts it names.
CREATE OR REPLACE FUNCTION public.ai_work_link_warning(p_auth_user_id uuid, p_project_id text, p_level integer DEFAULT 0)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_user text := public.ai_work_link__user_for_project(p_auth_user_id, p_project_id);
  v_e jsonb := public.ai_work_link__eligibility(v_user, p_project_id);
  v_org text := v_e ->> 'org_id';
  v_rank integer := (v_e ->> 'rank')::integer;
  v_lines integer;
  v_tasks integer;
  v_people integer;
  v_money boolean := v_rank >= 3;
  v_write boolean := coalesce(p_level, 0) = 1 AND v_rank >= 2;
BEGIN
  SELECT count(*) INTO v_lines
  FROM compliance.construction_boq_line_items li
  JOIN compliance.construction_boqs b ON b.id = li.boq_id
  WHERE b.project_id = p_project_id AND b.org_id = v_org AND li.org_id = v_org;
  SELECT count(*) INTO v_tasks FROM compliance.pms_issues i WHERE i.project_id = p_project_id AND i.org_id = v_org;
  SELECT count(DISTINCT p.id) INTO v_people
  FROM (SELECT x AS id FROM public.ai_work_link__project_people(v_org, p_project_id) AS x
        UNION SELECT v_user) p
  JOIN compliance.users u ON u.id = p.id AND u.org_id = v_org;

  RETURN jsonb_build_object(
    'project', jsonb_build_object('id', p_project_id, 'name', v_e ->> 'project_name'),
    'lines', v_lines,
    'tasks', v_tasks,
    'people', v_people,
    'money_visible', v_money,
    'can_record', v_write,
    'sentence',
      'This link lets an AI assistant read project ' || (v_e ->> 'project_name') || ' as you see it: '
      || v_lines || ' BOQ lines, ' || v_tasks || ' tasks and the names of ' || v_people || ' people'
      || CASE WHEN v_money THEN ', and money figures such as rates, amounts and budgets' ELSE '' END || '. '
      || CASE WHEN v_write THEN 'It can also record daily entries in your name.' ELSE 'It cannot change anything without your click.' END
      || ' When you paste it into an AI assistant, this information is sent to the company that runs that assistant, and an assistant that follows instructions in the data could send this information elsewhere. Use it only in an assistant that you alone use.');
END
$fn$;

-- 7. grants ------------------------------------------------------------------------------------------------------------------------------
-- service_role runs the pure helpers and the functions of the spec's list. The six helpers that read a table or take a trusted argument
-- (cost_visible, hidden_cols, project_people, eligibility, require, user_for_project) are called only by the SECURITY DEFINER functions
-- above, which run as their owner, so nobody else needs to execute them: they are owner-only, the smallest surface.
REVOKE ALL ON FUNCTION public.ai_work_link__role_rank(text) FROM PUBLIC, anon, authenticated, app_runtime;
GRANT EXECUTE ON FUNCTION public.ai_work_link__role_rank(text) TO service_role;
REVOKE ALL ON FUNCTION public.ai_work_link__can_read_project(text, text, text, text) FROM PUBLIC, anon, authenticated, app_runtime;
GRANT EXECUTE ON FUNCTION public.ai_work_link__can_read_project(text, text, text, text) TO service_role;
REVOKE ALL ON FUNCTION public.ai_work_link__hash_token(text) FROM PUBLIC, anon, authenticated, app_runtime;
GRANT EXECUTE ON FUNCTION public.ai_work_link__hash_token(text) TO service_role;
REVOKE ALL ON FUNCTION public.ai_work_link__ip_prefix(text) FROM PUBLIC, anon, authenticated, app_runtime;
GRANT EXECUTE ON FUNCTION public.ai_work_link__ip_prefix(text) TO service_role;
REVOKE ALL ON FUNCTION public.ai_work_link__clean_path(text) FROM PUBLIC, anon, authenticated, app_runtime;
GRANT EXECUTE ON FUNCTION public.ai_work_link__clean_path(text) TO service_role;
REVOKE ALL ON FUNCTION public.ai_work_link__mask_email(text) FROM PUBLIC, anon, authenticated, app_runtime;
GRANT EXECUTE ON FUNCTION public.ai_work_link__mask_email(text) TO service_role;
REVOKE ALL ON FUNCTION public.ai_work_link__cost_visible(text, text) FROM PUBLIC, anon, authenticated, app_runtime, service_role;
REVOKE ALL ON FUNCTION public.ai_work_link__hidden_cols(text, text, text) FROM PUBLIC, anon, authenticated, app_runtime, service_role;
REVOKE ALL ON FUNCTION public.ai_work_link__project_people(text, text) FROM PUBLIC, anon, authenticated, app_runtime, service_role;
REVOKE ALL ON FUNCTION public.ai_work_link__eligibility(text, text) FROM PUBLIC, anon, authenticated, app_runtime, service_role;
REVOKE ALL ON FUNCTION public.ai_work_link__resolve(text) FROM PUBLIC, anon, authenticated, app_runtime;
GRANT EXECUTE ON FUNCTION public.ai_work_link__resolve(text) TO service_role;
REVOKE ALL ON FUNCTION public.ai_work_link__require(text) FROM PUBLIC, anon, authenticated, app_runtime, service_role;
REVOKE ALL ON FUNCTION public.ai_work_link__user_for_project(uuid, text) FROM PUBLIC, anon, authenticated, app_runtime, service_role;
REVOKE ALL ON FUNCTION public.ai_work_link_log_call(text, text, text, text, text) FROM PUBLIC, anon, authenticated, app_runtime;
GRANT EXECUTE ON FUNCTION public.ai_work_link_log_call(text, text, text, text, text) TO service_role;
REVOKE ALL ON FUNCTION public.ai_work_link_log_call_result(text, integer, integer) FROM PUBLIC, anon, authenticated, app_runtime;
GRANT EXECUTE ON FUNCTION public.ai_work_link_log_call_result(text, integer, integer) TO service_role;
REVOKE ALL ON FUNCTION public.ai_work_link_context(text) FROM PUBLIC, anon, authenticated, app_runtime;
GRANT EXECUTE ON FUNCTION public.ai_work_link_context(text) TO service_role;
REVOKE ALL ON FUNCTION public.ai_work_link_create_for(text, text, integer, text[], integer, boolean, text, text) FROM PUBLIC, anon, authenticated, app_runtime;
GRANT EXECUTE ON FUNCTION public.ai_work_link_create_for(text, text, integer, text[], integer, boolean, text, text) TO service_role;
REVOKE ALL ON FUNCTION public.ai_work_link_create(uuid, text, integer, text[], integer, boolean, text) FROM PUBLIC, anon, authenticated, app_runtime;
GRANT EXECUTE ON FUNCTION public.ai_work_link_create(uuid, text, integer, text[], integer, boolean, text) TO service_role;
REVOKE ALL ON FUNCTION public.ai_work_link_list(uuid, text) FROM PUBLIC, anon, authenticated, app_runtime;
GRANT EXECUTE ON FUNCTION public.ai_work_link_list(uuid, text) TO service_role;
REVOKE ALL ON FUNCTION public.ai_work_link_revoke_service(text, text) FROM PUBLIC, anon, authenticated, app_runtime;
GRANT EXECUTE ON FUNCTION public.ai_work_link_revoke_service(text, text) TO service_role;
REVOKE ALL ON FUNCTION public.ai_work_link_revoke(uuid, text) FROM PUBLIC, anon, authenticated, app_runtime;
GRANT EXECUTE ON FUNCTION public.ai_work_link_revoke(uuid, text) TO service_role;
REVOKE ALL ON FUNCTION public.ai_work_link_warning(uuid, text, integer) FROM PUBLIC, anon, authenticated, app_runtime;
GRANT EXECUTE ON FUNCTION public.ai_work_link_warning(uuid, text, integer) TO service_role;

COMMIT;
