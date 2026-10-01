-- PRE-APPROVED-LIVE-DDL: Owner (Rajat Agarwal) approved in a live Claude Code session on 2026-10-01: "do step 1 and 2 both, build it in local" (the user-wide AI work link, listing projects, reporting on all, and Create New Project) and "apply the migration after green and tell me"; this migration is that work.
-- Down-migration for drizzle/0668_awl_user_wide_link.sql (PROJEXA user-wide AI work link). Convention: docs/ROLLBACK_RUNBOOK.md section 3.
-- Not auto-applied by any script or CI job; the PM runs it deliberately, after the same always-aborted rehearsal as the forward file.
--
-- WHAT IT RESTORES: the state after 0667. ai_work_link__resolve and ai_work_link__live (0624, 0629), ai_work_link_intent_claim (0629),
--   ai_work_link_list_for (0631), and the 5-argument ai_work_link_records, the 3-argument ai_work_link_record, the 1-argument ai_work_link_context
--   (0625, 0624) and the 5-argument ai_work_link_record_intent (0629) are put back with their old bodies and grants; the six new functions
--   (ai_work_link__fns, __bind, __require_in, __resolve_in, ai_work_link_projects, ai_work_link_mint_user_for) are dropped; the column
--   platform.user_ai_links.scope, its two checks and its index go; user_ai_links_projexa_shape is the one of 0613 again; and
--   platform.ai_work_link_intent.project_id is NOT NULL again.
--
-- ORDER: run it AFTER the down file of 0669 (0669 is the later migration; with create_project at level 2 and no 0668 a project link would carry it).
--
-- WHAT STOPS WORKING, read before running: the user-wide link. The Edge function of that release must be redeployed from the commit before it
--   (a new Edge function against this database answers 500 for the routes that call the six dropped functions).
--
-- WHEN IT REFUSES: when any user link exists (platform.user_ai_links.scope = 'user'), because a link is revoked, never deleted (0622) and the
--   old shape check cannot hold a link with no project. Nothing is changed in that case. Delete them by hand only if you accept losing their intents
--   and call log, in this order: delete from platform.ai_work_link_call, then platform.ai_work_link_intent, then platform.user_ai_links where the
--   link is of scope 'user' (the intents carry no project, so they cannot be kept either). Otherwise safe to run twice.
--
-- DATA LOSS: none by itself; see WHEN IT REFUSES.

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'platform' AND table_name = 'user_ai_links' AND column_name = 'scope') THEN
    IF EXISTS (SELECT 1 FROM platform.user_ai_links WHERE scope = 'user') THEN
      RAISE EXCEPTION '0668 down refuses: user links exist (platform.user_ai_links.scope = user). Read the WHEN IT REFUSES paragraph of this file.';
    END IF;
  END IF;
END
$do$;

-- 1. the old bodies of the re-created functions

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

CREATE OR REPLACE FUNCTION public.ai_work_link__live(p_link_id text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_l record;
  v_u record;
  v_p record;
  v_rank integer;
  v_writes boolean;
  v_level integer;
  v_fns text[];
  v_gone constant jsonb := jsonb_build_object('status', 'gone');
BEGIN
  IF p_link_id IS NULL THEN
    RETURN v_gone;
  END IF;
  SELECT l.id, l.org_id, l.user_id, l.project_id, l.status, l.expires_at, l.authority_level, l.allowed_functions, l.hide_personal, l.label
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

  SELECT pr.id, pr.name, pr.org_id, pr.access_level::text AS access_level, pr.lead_user_id INTO v_p
  FROM compliance.projects pr WHERE pr.id = v_l.project_id;
  IF NOT FOUND OR v_p.org_id IS DISTINCT FROM v_l.org_id
     OR NOT public.ai_work_link__can_read_project(v_p.access_level, v_p.lead_user_id, v_u.id, v_u.role) THEN
    RETURN v_gone;
  END IF;

  v_rank := public.ai_work_link__role_rank(v_u.role);
  SELECT coalesce((SELECT s.writes_enabled FROM platform.ai_work_link_settings s WHERE s.id), false) INTO v_writes;
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

-- 2. the functions that gained a trailing parameter: drop the new signature, create the old one
DROP FUNCTION IF EXISTS public.ai_work_link_records(text, text, text, integer, jsonb, text);
DROP FUNCTION IF EXISTS public.ai_work_link_record(text, text, text, text);
DROP FUNCTION IF EXISTS public.ai_work_link_context(text, text);
DROP FUNCTION IF EXISTS public.ai_work_link_record_intent(text, text, text, jsonb, text, text);

CREATE OR REPLACE FUNCTION public.ai_work_link_records(
  p_token text, p_kind text, p_after text DEFAULT NULL, p_limit integer DEFAULT 50, p_filters jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  RETURN public.ai_work_link__records_core(public.ai_work_link__require(p_token), p_kind, p_after, p_limit, p_filters, NULL);
END
$fn$;

CREATE OR REPLACE FUNCTION public.ai_work_link_record(p_token text, p_kind text, p_id text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_page jsonb := public.ai_work_link__records_core(public.ai_work_link__require(p_token), p_kind, NULL, 1, '{}'::jsonb, p_id);
BEGIN
  RETURN v_page -> 'items' -> 0;
END
$fn$;

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

CREATE OR REPLACE FUNCTION public.ai_work_link_record_intent(
  p_token text, p_kind text, p_function_id text, p_params jsonb, p_idempotency_key text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_ctx jsonb := public.ai_work_link__require(p_token);
  v_link text := v_ctx ->> 'link_id';
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
  v_inserted text;
BEGIN
  IF p_kind IS NULL OR p_kind NOT IN ('action', 'draft') THEN
    RAISE EXCEPTION 'BAD_KIND' USING ERRCODE = 'AW400';
  END IF;
  IF p_params IS NULL OR jsonb_typeof(p_params) <> 'object' OR octet_length(p_params::text) > 8192 THEN
    RAISE EXCEPTION 'BAD_PARAMS' USING ERRCODE = 'AW400';
  END IF;
  IF p_function_id IS NULL
     OR NOT (p_function_id = ANY (ARRAY(SELECT jsonb_array_elements_text(v_ctx -> 'effective_functions')))) THEN
    RAISE EXCEPTION 'FUNCTION_NOT_ON_LINK' USING ERRCODE = 'AW403';
  END IF;
  SELECT f.function_id, f.kind, f.link_level INTO v_fn
  FROM platform.ai_work_link_functions f WHERE f.function_id = p_function_id;
  IF v_fn.kind IS DISTINCT FROM 'write' THEN
    RAISE EXCEPTION 'NOT_A_WRITE' USING ERRCODE = 'AW400';
  END IF;
  IF p_params ? 'projectId' AND (p_params ->> 'projectId') IS DISTINCT FROM (v_ctx ->> 'project_id') THEN
    RAISE EXCEPTION 'WRONG_PROJECT' USING ERRCODE = 'AW403';
  END IF;
  IF p_kind = 'action' AND NOT ((v_ctx ->> 'effective_level')::integer >= 1 AND v_fn.link_level = 1) THEN
    RAISE EXCEPTION 'LEVEL_NOT_ALLOWED' USING ERRCODE = 'AW403';
  END IF;

  v_key := nullif(btrim(coalesce(p_idempotency_key, '')), '');
  IF v_key IS NULL THEN
    v_key := encode(sha256(convert_to(jsonb_build_object(
      'function', p_function_id, 'params', p_params, 'utc_date', to_char(v_now AT TIME ZONE 'UTC', 'YYYY-MM-DD'))::text, 'UTF8')), 'hex');
  ELSIF char_length(v_key) > 128 THEN
    RAISE EXCEPTION 'BAD_PARAMS' USING ERRCODE = 'AW400';
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
    v_id, v_link, v_ctx ->> 'org_id', v_ctx ->> 'project_id', v_ctx ->> 'user_id', p_function_id, p_params, p_kind, v_key,
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

-- 3. the functions of 0668 alone
DROP FUNCTION IF EXISTS public.ai_work_link_mint_user_for(text, integer, text);
DROP FUNCTION IF EXISTS public.ai_work_link_projects(text, integer);
DROP FUNCTION IF EXISTS public.ai_work_link__resolve_in(text, text);
DROP FUNCTION IF EXISTS public.ai_work_link__require_in(text, text, boolean);
DROP FUNCTION IF EXISTS public.ai_work_link__bind(jsonb, text);
DROP FUNCTION IF EXISTS public.ai_work_link__fns(text, boolean, text[], integer);

-- 4. grants of the restored functions, as 0624, 0625, 0629 and 0631 gave them
REVOKE ALL ON FUNCTION public.ai_work_link__resolve(text) FROM PUBLIC, anon, authenticated, app_runtime;
GRANT EXECUTE ON FUNCTION public.ai_work_link__resolve(text) TO service_role;
REVOKE ALL ON FUNCTION public.ai_work_link__live(text) FROM PUBLIC, anon, authenticated, app_runtime, service_role;
REVOKE ALL ON FUNCTION public.ai_work_link_intent_claim(text) FROM PUBLIC, anon, authenticated, app_runtime;
GRANT EXECUTE ON FUNCTION public.ai_work_link_intent_claim(text) TO service_role;
REVOKE ALL ON FUNCTION public.ai_work_link_list_for(text, text) FROM PUBLIC, anon, authenticated, app_runtime;
GRANT EXECUTE ON FUNCTION public.ai_work_link_list_for(text, text) TO service_role;
REVOKE ALL ON FUNCTION public.ai_work_link_records(text, text, text, integer, jsonb) FROM PUBLIC, anon, authenticated, app_runtime;
GRANT EXECUTE ON FUNCTION public.ai_work_link_records(text, text, text, integer, jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.ai_work_link_record(text, text, text) FROM PUBLIC, anon, authenticated, app_runtime;
GRANT EXECUTE ON FUNCTION public.ai_work_link_record(text, text, text) TO service_role;
REVOKE ALL ON FUNCTION public.ai_work_link_context(text) FROM PUBLIC, anon, authenticated, app_runtime;
GRANT EXECUTE ON FUNCTION public.ai_work_link_context(text) TO service_role;
REVOKE ALL ON FUNCTION public.ai_work_link_record_intent(text, text, text, jsonb, text) FROM PUBLIC, anon, authenticated, app_runtime;
GRANT EXECUTE ON FUNCTION public.ai_work_link_record_intent(text, text, text, jsonb, text) TO service_role;

-- 5. the tables
DROP INDEX IF EXISTS platform.user_ai_links_one_live_user_scope;
ALTER TABLE platform.user_ai_links DROP CONSTRAINT IF EXISTS user_ai_links_user_scope_shape;
ALTER TABLE platform.user_ai_links DROP CONSTRAINT IF EXISTS user_ai_links_projexa_shape;
ALTER TABLE platform.user_ai_links ADD CONSTRAINT user_ai_links_projexa_shape
  CHECK (product = 'veridian'
         OR (project_id IS NOT NULL
             AND token_hash IS NOT NULL
             AND token IS NULL
             AND expires_at IS NOT NULL));
ALTER TABLE platform.user_ai_links DROP CONSTRAINT IF EXISTS user_ai_links_scope_check;
ALTER TABLE platform.user_ai_links DROP COLUMN IF EXISTS scope;
ALTER TABLE platform.ai_work_link_intent ALTER COLUMN project_id SET NOT NULL;

COMMIT;
