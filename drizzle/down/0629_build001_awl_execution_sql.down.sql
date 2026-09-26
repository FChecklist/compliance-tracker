-- Down-migration for drizzle/0629_build001_awl_execution_sql.sql (PROJEXA-BUILD-002 WP-09a). Convention: docs/ROLLBACK_RUNBOOK.md
-- section 3. Not auto-applied by any script or CI job; the PM runs it deliberately, after the same always-aborted rehearsal as the
-- forward file.
--
-- WHAT IT RESTORES: the schema as it was before 0629. The six new functions (ai_work_link__live, ai_work_link__intent_state,
-- ai_work_link__sweep_intents, ai_work_link_intent_claim, ai_work_link_intent_finish, ai_work_link_draft_state) are dropped, the six
-- functions the forward file re-created (ai_work_link_record_intent, ai_work_link_intent_status, ai_work_link_history,
-- ai_work_link_draft_confirm from 0626, ai_work_link_warning from 0624, ai_work_link_call_retention from 0627) are put back to those files'
-- definitions, and the column platform.ai_work_link_intent.claimed_at is dropped. The bodies below are copied unchanged from the files
-- named; their grants were never changed by 0629, and the grants of the dropped functions go with them.
--
-- ORDER: run it after the down file of 0630 (reverse number order) and before the down file of 0628. Nothing may be executing: the
-- restored intent_status has no notion of a stale executing row, so an executing intent would read executing for good.
--
-- DATA LOSS: the claimed_at values of intents claimed since the forward file was applied. Intents deleted by the retention purge since then
-- are not restored. No intent row is otherwise touched.
--
-- WHEN IT REFUSES: never; every step is IF EXISTS or create-or-replace (the table may be gone already when the down file of 0622 ran first). Safe to run twice.

BEGIN;

SET LOCAL lock_timeout = '5s';

DROP FUNCTION IF EXISTS public.ai_work_link_draft_state(text, text, text);
DROP FUNCTION IF EXISTS public.ai_work_link_intent_finish(text, text, text, jsonb, jsonb);
DROP FUNCTION IF EXISTS public.ai_work_link_intent_claim(text);

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

  -- an unexecuted intent past its expiry must not keep holding its key
  UPDATE platform.ai_work_link_intent
  SET status = 'expired'
  WHERE link_id = v_link AND idempotency_key = v_key
    AND status IN ('recorded', 'awaiting_confirmation') AND expires_at <= v_now;

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

CREATE OR REPLACE FUNCTION public.ai_work_link_intent_status(p_token text, p_intent_id text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_ctx jsonb := public.ai_work_link__require(p_token);
  v_out jsonb;
BEGIN
  SELECT jsonb_build_object(
           'intent_id', i.id, 'kind', i.kind, 'function_id', i.function_id,
           'status', CASE WHEN i.status IN ('recorded', 'awaiting_confirmation') AND i.expires_at <= clock_timestamp()
                          THEN 'expired' ELSE i.status END,
           'created_at', to_char(i.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
           'expires_at', to_char(i.expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
           'confirmed_at', CASE WHEN i.confirmed_at IS NULL THEN NULL ELSE to_char(i.confirmed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') END,
           'executed_at', CASE WHEN i.executed_at IS NULL THEN NULL ELSE to_char(i.executed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') END,
           'submission_id', i.submission_id, 'result', i.result, 'failure', i.failure)
    INTO v_out
  FROM platform.ai_work_link_intent i
  WHERE i.id = p_intent_id AND i.link_id = v_ctx ->> 'link_id';
  RETURN v_out;
END
$fn$;

CREATE OR REPLACE FUNCTION public.ai_work_link_history(p_token text, p_limit integer DEFAULT 50)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_ctx jsonb := public.ai_work_link__require(p_token);
  v_items jsonb;
BEGIN
  SELECT coalesce(jsonb_agg(x.j ORDER BY x.created_at DESC, x.id DESC), '[]'::jsonb) INTO v_items
  FROM (
    SELECT i.created_at, i.id,
           jsonb_build_object(
             'intent_id', i.id, 'kind', i.kind, 'function_id', i.function_id,
             'status', CASE WHEN i.status IN ('recorded', 'awaiting_confirmation') AND i.expires_at <= clock_timestamp()
                            THEN 'expired' ELSE i.status END,
             'created_at', to_char(i.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
             'submission_id', i.submission_id, 'failure', i.failure) AS j
    FROM platform.ai_work_link_intent i
    WHERE i.link_id = v_ctx ->> 'link_id'
    ORDER BY i.created_at DESC, i.id DESC
    LIMIT least(greatest(coalesce(p_limit, 50), 1), 200)
  ) x;
  RETURN jsonb_build_object('items', v_items);
END
$fn$;

CREATE OR REPLACE FUNCTION public.ai_work_link_draft_confirm(p_draft_id text, p_confirm_token text, p_actor_user_id text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_writes boolean;
  v_i record;
  v_now timestamptz := clock_timestamp();
  v_c record;
BEGIN
  SELECT coalesce((SELECT s.writes_enabled FROM platform.ai_work_link_settings s WHERE s.id), false) INTO v_writes;
  IF NOT v_writes THEN
    RETURN jsonb_build_object('status', 'not_enabled');
  END IF;

  SELECT i.id, i.user_id, i.status, i.expires_at, i.confirm_token_hash INTO v_i
  FROM platform.ai_work_link_intent i WHERE i.id = p_draft_id AND i.kind = 'draft';
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'refused', 'reason', 'not_found');
  END IF;
  IF v_i.user_id IS DISTINCT FROM p_actor_user_id THEN
    RETURN jsonb_build_object('status', 'refused', 'reason', 'not_owner');
  END IF;
  IF v_i.confirm_token_hash IS DISTINCT FROM encode(sha256(convert_to(coalesce(p_confirm_token, ''), 'UTF8')), 'hex') THEN
    RETURN jsonb_build_object('status', 'refused', 'reason', 'not_found');
  END IF;
  IF v_i.status <> 'awaiting_confirmation' THEN
    RETURN jsonb_build_object('status', 'refused', 'reason', 'not_pending');
  END IF;
  IF v_i.expires_at <= v_now THEN
    UPDATE platform.ai_work_link_intent SET status = 'expired' WHERE id = p_draft_id AND status = 'awaiting_confirmation';
    RETURN jsonb_build_object('status', 'refused', 'reason', 'expired');
  END IF;

  UPDATE platform.ai_work_link_intent
  SET status = 'confirmed', confirmed_at = v_now, confirmed_by = p_actor_user_id
  WHERE id = p_draft_id AND status = 'awaiting_confirmation'
  RETURNING id, link_id, org_id, project_id, user_id, function_id, params INTO v_c;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'refused', 'reason', 'not_pending');
  END IF;
  RETURN jsonb_build_object(
    'status', 'confirmed',
    'intent', jsonb_build_object(
      'id', v_c.id, 'link_id', v_c.link_id, 'org_id', v_c.org_id, 'project_id', v_c.project_id, 'user_id', v_c.user_id,
      'function_id', v_c.function_id, 'params', v_c.params));
END
$fn$;

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

CREATE OR REPLACE FUNCTION public.ai_work_link_call_retention(p_keep_days integer DEFAULT 90)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_month date;
  v_name text;
  v_created text[] := '{}';
  v_dropped text[] := '{}';
  r record;
  v_upper timestamptz;
BEGIN
  IF p_keep_days IS NULL OR p_keep_days < 1 THEN
    RAISE EXCEPTION 'ai_work_link_call_retention: p_keep_days must be at least 1';
  END IF;

  FOR i IN 0..2 LOOP
    v_month := (date_trunc('month', now() AT TIME ZONE 'UTC') + make_interval(months => i))::date;
    v_name := 'ai_work_link_call_' || to_char(v_month, 'YYYY_MM');
    IF to_regclass(format('platform.%I', v_name)) IS NULL THEN
      PERFORM public.ai_work_link__create_call_partition(v_month);
      v_created := v_created || v_name;
    END IF;
  END LOOP;

  FOR r IN
    SELECT c.relname::text AS relname, pg_get_expr(c.relpartbound, c.oid) AS bound
    FROM pg_inherits h
    JOIN pg_class c ON c.oid = h.inhrelid
    WHERE h.inhparent = 'platform.ai_work_link_call'::regclass
    ORDER BY c.relname
  LOOP
    v_upper := ((regexp_match(r.bound, 'TO \(''([^'']+)''\)'))[1])::timestamptz;
    IF v_upper IS NOT NULL AND v_upper < now() - make_interval(days => p_keep_days) THEN
      EXECUTE format('ALTER TABLE platform.ai_work_link_call DETACH PARTITION platform.%I', r.relname);
      EXECUTE format('DROP TABLE platform.%I', r.relname);
      v_dropped := v_dropped || r.relname;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('created', to_jsonb(v_created), 'dropped', to_jsonb(v_dropped), 'keep_days', p_keep_days);
END
$fn$;

DROP FUNCTION IF EXISTS public.ai_work_link__sweep_intents(text);
DROP FUNCTION IF EXISTS public.ai_work_link__intent_state(text, timestamptz, timestamptz);
DROP FUNCTION IF EXISTS public.ai_work_link__live(text);

ALTER TABLE IF EXISTS platform.ai_work_link_intent DROP COLUMN IF EXISTS claimed_at;

COMMIT;
