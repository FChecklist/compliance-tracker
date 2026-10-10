-- PROJEXA-BUILD-001 U-46 step 1 (database), migration 6 of 8 (register rows BR-484, BR-486; spec sections 9.2, 9.3 and 9.6, audit A-03,
-- A-10, A-13): the intent functions of the Universal AI Work Link. They record what an AI proposes through a link and confirm a draft.
-- They run no business function: the executor of the later phase (spike S-1) reads an intent and runs it, and until writes_enabled is
-- true (migration 1) no link has an effective level above 0, so a direct action is refused and a draft only waits.
--
-- WHAT
--   public.ai_work_link_record_intent(p_token, p_kind, p_function_id, p_params, p_idempotency_key) -> jsonb
--     records one intent for the link's person and project. p_kind is 'action' (a direct write: needs the EFFECTIVE level 1 and a
--     function of link level 1) or 'draft' (nothing changes until the person confirms; any write function of the effective list).
--     Refuses: a function that is not on the effective list now (FUNCTION_NOT_ON_LINK, so a demotion takes effect at once, audit A-03),
--     a read function (NOT_A_WRITE), params that are not a JSON object of at most 8 KB (BAD_PARAMS), a projectId other than the
--     link's (WRONG_PROJECT), an action below the effective level (LEVEL_NOT_ALLOWED), and more than 30 intents in an hour or 200 in a
--     day on the link (WRITE_CAP_HOUR, WRITE_CAP_DAY).
--     Idempotency (spec 9.3): the caller's key, else sha256 of the canonical JSON {function, params, utc_date}. The same live or done
--     key on the link returns the stored outcome with replayed = true and writes nothing; a failed, refused or expired intent has
--     freed its key (the partial unique index of migration 2, audit A-10), and an unexecuted intent past its expiry is marked expired
--     here first, so a stale one can never hold a key. A draft's confirm token is 32 random bytes, returned once and stored only as
--     sha256; a replay never returns it again.
--     Expiry: a draft 48 hours (spec 9.3); an action 1 hour, because an action is meant to run at once and a stale one must not be
--     runnable later (a design choice, the spec sets no number).
--   public.ai_work_link_intent_status(p_token, p_intent_id) -> jsonb
--     one intent of THIS link (another link's id gives NULL), with a status that reads expired once an unexecuted intent has passed
--     its expiry.
--   public.ai_work_link_history(p_token, p_limit) -> jsonb
--     {items[]}: the link's own intents, newest first, 1 to 200 (default 50).
--   public.ai_work_link_draft_confirm(p_draft_id, p_confirm_token, p_actor_user_id) -> jsonb
--     the confirmation of a draft (spec 9.2 W-B, 9.5). The Edge Function has already verified the person's session and passes the
--     compliance user id it resolved; this function checks that this is the draft's own person, that the token matches, that the draft
--     is still awaiting_confirmation and unexpired, and then moves it to confirmed in ONE UPDATE ... WHERE status =
--     'awaiting_confirmation': single use. While writes_enabled is false it answers {status: not_enabled} and changes nothing (the
--     draft waits, spec 9.5). Refusals are {status: refused, reason: not_found | not_owner | not_pending | expired}.
--
-- WHAT IT DOES NOT DO: run the function, write a submission, or touch any business table. The rows written are the intent, and the
--   link's write_count.
--
-- GRANTS: SECURITY DEFINER, search_path = pg_catalog, pg_temp, revoked from public, anon, authenticated and app_runtime, granted to
--   service_role alone (register row BR-484, SHARED_BOUNDARY.md R5).
--
-- DATA LOSS: none. Additive: functions only.
--
-- HOW IT IS APPLIED: through the Supabase MCP by the PM after the claim (ACTIVE-CLAIMS, 2026-09-25) is on main, the always-aborted
--   rehearsal passed, and migrations 0621 to 0625 are applied. Idempotent: create or replace.
--
-- ROLLBACK: drizzle/down/0626_build001_awl_intent_functions.down.sql

BEGIN;

SET LOCAL lock_timeout = '5s';

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

REVOKE ALL ON FUNCTION public.ai_work_link_record_intent(text, text, text, jsonb, text) FROM PUBLIC, anon, authenticated, app_runtime;
GRANT EXECUTE ON FUNCTION public.ai_work_link_record_intent(text, text, text, jsonb, text) TO service_role;
REVOKE ALL ON FUNCTION public.ai_work_link_intent_status(text, text) FROM PUBLIC, anon, authenticated, app_runtime;
GRANT EXECUTE ON FUNCTION public.ai_work_link_intent_status(text, text) TO service_role;
REVOKE ALL ON FUNCTION public.ai_work_link_history(text, integer) FROM PUBLIC, anon, authenticated, app_runtime;
GRANT EXECUTE ON FUNCTION public.ai_work_link_history(text, integer) TO service_role;
REVOKE ALL ON FUNCTION public.ai_work_link_draft_confirm(text, text, text) FROM PUBLIC, anon, authenticated, app_runtime;
GRANT EXECUTE ON FUNCTION public.ai_work_link_draft_confirm(text, text, text) TO service_role;

COMMIT;
