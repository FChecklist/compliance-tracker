-- PROJEXA-BUILD-002 WP-09a (register rows AW-501, AW-503, AW-507, AW-508; spec sections 9.2, 9.3, 9.5, 9.6, 10.9; write-path gap report items
-- G2, G4, G11, G13, G18): the SQL that lets a write of the Universal AI Work Link be RECORDED, CONFIRMED, CLAIMED and FINISHED. It is built
-- and switched OFF: platform.ai_work_link_settings.writes_enabled stays false, this file never sets it, and nothing here runs a business
-- function. The executor of the next brief (the ai-work-link-exec Edge Function, then the local execution host) calls claim and finish.
--
-- WHAT
--   NEW  public.ai_work_link__live(p_link_id) -> jsonb
--     the live re-resolve of a link BY ID: active, unexpired, its person still an active user of the organisation, its project still
--     readable, then the same effective level, effective function list and money flag as ai_work_link__resolve (spec 10.9). The
--     executor never holds a link token, so it cannot call resolve. A copy of resolve's rules, kept equal by a parity test.
--   NEW  public.ai_work_link__intent_state(p_status, p_expires_at, p_claimed_at) -> text
--     the status a reader sees: an unexecuted intent past its expiry reads expired (a confirmed draft included), and an executing intent
--     that has run more than 10 minutes reads failed. Pure reading; no row is changed by it.
--   NEW  public.ai_work_link__sweep_intents(p_link_id) -> void
--     writes what intent_state reads, for one link: expired for an unexecuted intent past its expiry, and failed with code
--     EXECUTION_UNCERTAIN for an executing intent older than 10 minutes. Called by record_intent and claim only (a POST path), never by a
--     GET: no GET route writes an intent row (spec 9.2).
--   NEW  public.ai_work_link_intent_claim(p_intent_id) -> jsonb
--     the ONLY function that moves an intent to executing (or refuses it). Locks the row; while writes_enabled is false it answers
--     {status: not_enabled} and changes nothing; accepts a recorded action or a confirmed draft; refuses an expired one; re-resolves the
--     link live (ai_work_link__live) and recomputes the effective level and list: a link that is gone is refused LINK_GONE, a function that
--     left the effective list (or a direct action whose level dropped) is refused ROLE_CHANGED, both recorded on the intent as status
--     refused; otherwise sets executing and returns {status: ok, intent, ctx} for the executor to run with. Never retries an executing row.
--   NEW  public.ai_work_link_intent_finish(p_intent_id, p_status, p_submission_id, p_result, p_failure) -> jsonb
--     the ONLY function that moves an executing intent to done, failed or refused. The result is kept as {id, route} only and the failure
--     as {code, missing} only (a closed code, never a message: the stored text cannot carry a connection string or a token). A second call
--     on an intent that is no longer executing changes nothing and returns the stored outcome with updated = false.
--   NEW  public.ai_work_link_draft_state(p_draft_id, p_actor_user_id, p_confirm_token) -> jsonb
--     the draft as its own person may see it before confirming, and after (a confirmed draft whose execution failed can be re-driven):
--     owner and confirm token are checked, then {status: ok, draft: {id, function_id, params, state, ...}}. Works while writes are off.
--   RE-CREATED  public.ai_work_link_draft_confirm(p_draft_id, p_confirm_token, p_actor_user_id)
--     the same rules as 0626 in a new ORDER: draft, owner, token, state and expiry are checked BEFORE the writes switch, so another
--     person's session answers not_owner (403) and a wrong code not_found while writes are off (BR-497's 403 half, G11); only a valid,
--     owned, pending draft reaches the switch and then waits ({status: not_enabled}, nothing consumed).
--   RE-CREATED  public.ai_work_link_record_intent(...)   0626 plus one call to sweep_intents before the idempotency read, so a stale
--     executing intent or an unexecuted intent past its expiry frees its key on the next POST instead of holding it forever.
--   RE-CREATED  public.ai_work_link_intent_status(...), public.ai_work_link_history(...)   0626 with the status read through
--     intent_state, so a stale row reads right without a GET writing anything.
--   RE-CREATED  public.ai_work_link_warning(...)   0624 with the sentence no longer promising "record daily entries" while
--     writes_enabled is false (G13): can_record needs the switch too, and a level 1 request while it is off gets the same three-way sentence as
--     ai_work_link_warning_for of 0631 (which nothing here changes or removes), so the two functions cannot contradict each other.
--   RE-CREATED  public.ai_work_link_call_retention(p_keep_days)   0627 plus a purge of intents older than p_keep_days (90): an intent holds
--     the parameters of a change (a rate, a daily rate), and it was kept forever (G18). Returns one more key, intents_deleted. The call
--     log's whole-partition drop, its cron job and its grants are unchanged.
--   ONE COLUMN  platform.ai_work_link_intent.claimed_at timestamptz NULL: when the executor claimed the intent, the age of an executing row.
--
-- GRANTS: every function is SECURITY DEFINER, search_path = pg_catalog, pg_temp, revoked from public, anon, authenticated and app_runtime.
--   claim, finish and draft_state are granted to service_role alone (the Edge Function's key). The helpers live, intent_state and
--   sweep_intents are owner-only (also revoked from service_role): only the functions above call them. The intent table stays revoked
--   from every role (0622); nothing is granted on it here.
--
-- DATA LOSS: none from the forward file, which adds one nullable column and replaces functions. From the first scheduled retention run
--   after the apply, intents older than 90 days are deleted by design (the submission a done intent produced keeps its own row, with
--   via and ai_link_id from migration 0630).
--
-- HOW IT IS APPLIED: through the Supabase MCP by the PM after the always-aborted rehearsal passed and migrations 0621 to 0628 are
--   applied. NOT applied by the engineer who wrote it. Idempotent: create or replace, add column if not exists.
--
-- ROLLBACK: drizzle/down/0629_build001_awl_execution_sql.down.sql

BEGIN;

SET LOCAL lock_timeout = '5s';

ALTER TABLE platform.ai_work_link_intent ADD COLUMN IF NOT EXISTS claimed_at timestamptz;

-- 1. the live link by id (spec 10.9) -------------------------------------------------------------------------------------------------
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

-- 2. the status a reader sees, and the write that makes it true --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ai_work_link__intent_state(p_status text, p_expires_at timestamptz, p_claimed_at timestamptz)
RETURNS text
LANGUAGE sql STABLE
SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT CASE
    WHEN p_status IN ('recorded', 'awaiting_confirmation', 'confirmed') AND p_expires_at <= clock_timestamp() THEN 'expired'
    WHEN p_status = 'executing' AND p_claimed_at IS NOT NULL AND p_claimed_at <= clock_timestamp() - interval '10 minutes' THEN 'failed'
    ELSE p_status
  END
$fn$;

CREATE OR REPLACE FUNCTION public.ai_work_link__sweep_intents(p_link_id text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_now timestamptz := clock_timestamp();
BEGIN
  UPDATE platform.ai_work_link_intent
  SET status = 'expired'
  WHERE link_id = p_link_id AND status IN ('recorded', 'awaiting_confirmation', 'confirmed') AND expires_at <= v_now;
  -- the business write and this row are not one transaction: a crash between them leaves an executing row. It is never retried; the
  -- record it may have written carries the intent id in its note, and the person is told to check it (EXECUTION_UNCERTAIN).
  UPDATE platform.ai_work_link_intent
  SET status = 'failed', failure = jsonb_build_object('code', 'EXECUTION_UNCERTAIN', 'missing', '[]'::jsonb)
  WHERE link_id = p_link_id AND status = 'executing' AND claimed_at IS NOT NULL AND claimed_at <= v_now - interval '10 minutes';
END
$fn$;

-- 3. claim: the only way an intent starts executing ---------------------------------------------------------------------------------------
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

-- 4. finish: the only way an executing intent reaches done, failed or refused -----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ai_work_link_intent_finish(
  p_intent_id text, p_status text, p_submission_id text DEFAULT NULL, p_result jsonb DEFAULT NULL, p_failure jsonb DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_result jsonb := NULL;
  v_failure jsonb := NULL;
  v_code text;
  v_missing jsonb;
  v_row record;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF p_status IS NULL OR p_status NOT IN ('done', 'failed', 'refused') THEN
    RAISE EXCEPTION 'BAD_STATUS' USING ERRCODE = 'AW400';
  END IF;
  IF p_submission_id IS NOT NULL AND char_length(p_submission_id) > 128 THEN
    RAISE EXCEPTION 'BAD_PARAMS' USING ERRCODE = 'AW400';
  END IF;

  IF p_status = 'done' THEN
    -- only what the person may be shown about the record: its id and the route that opens it
    IF p_result IS NOT NULL THEN
      IF jsonb_typeof(p_result) <> 'object' OR octet_length(p_result::text) > 2048 THEN
        RAISE EXCEPTION 'BAD_PARAMS' USING ERRCODE = 'AW400';
      END IF;
      v_result := jsonb_strip_nulls(jsonb_build_object(
        'id', left(nullif(p_result ->> 'id', ''), 200), 'route', left(nullif(p_result ->> 'route', ''), 200)));
    END IF;
  ELSE
    -- a closed code and the names of what is missing, never a message
    IF p_failure IS NULL OR jsonb_typeof(p_failure) <> 'object' THEN
      RAISE EXCEPTION 'BAD_PARAMS' USING ERRCODE = 'AW400';
    END IF;
    v_code := p_failure ->> 'code';
    IF v_code IS NULL OR v_code !~ '^[A-Z][A-Z0-9_]{0,63}$' THEN
      v_code := 'UNKNOWN';
    END IF;
    v_missing := CASE WHEN jsonb_typeof(p_failure -> 'missing') = 'array' THEN p_failure -> 'missing' ELSE '[]'::jsonb END;
    v_failure := jsonb_build_object(
      'code', v_code,
      'missing', coalesce((
        SELECT jsonb_agg(left(m.v, 64))
        FROM (SELECT x AS v FROM jsonb_array_elements_text(v_missing) AS x LIMIT 20) m), '[]'::jsonb));
  END IF;

  UPDATE platform.ai_work_link_intent
  SET status = p_status, submission_id = p_submission_id, result = v_result, failure = v_failure, executed_at = v_now
  WHERE id = p_intent_id AND status = 'executing'
  RETURNING id, status, submission_id, result, failure INTO v_row;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'intent_id', v_row.id, 'status', v_row.status, 'submission_id', v_row.submission_id, 'result', v_row.result, 'failure', v_row.failure,
      'updated', true);
  END IF;

  SELECT i.id, i.status, i.submission_id, i.result, i.failure INTO v_row FROM platform.ai_work_link_intent i WHERE i.id = p_intent_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'refused', 'reason', 'not_found');
  END IF;
  RETURN jsonb_build_object(
    'intent_id', v_row.id, 'status', v_row.status, 'submission_id', v_row.submission_id, 'result', v_row.result, 'failure', v_row.failure,
    'updated', false);
END
$fn$;

-- 5. the draft as its own person sees it -----------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ai_work_link_draft_state(p_draft_id text, p_actor_user_id text, p_confirm_token text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_i record;
  v_state text;
  v_writes boolean;
BEGIN
  SELECT i.id, i.user_id, i.function_id, i.params, i.status, i.claimed_at, i.expires_at, i.created_at, i.confirmed_at, i.submission_id,
         i.result, i.failure, i.confirm_token_hash INTO v_i
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
  v_state := public.ai_work_link__intent_state(v_i.status, v_i.expires_at, v_i.claimed_at);
  SELECT coalesce((SELECT s.writes_enabled FROM platform.ai_work_link_settings s WHERE s.id), false) INTO v_writes;
  RETURN jsonb_build_object(
    'status', 'ok',
    'draft', jsonb_build_object(
      'id', v_i.id, 'function_id', v_i.function_id, 'params', v_i.params, 'state', v_state,
      'created_at', to_char(v_i.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'expires_at', to_char(v_i.expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'confirmed_at', CASE WHEN v_i.confirmed_at IS NULL THEN NULL ELSE to_char(v_i.confirmed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') END,
      'submission_id', v_i.submission_id, 'result', v_i.result,
      'failure', CASE WHEN v_i.status = 'executing' AND v_state = 'failed'
                      THEN jsonb_build_object('code', 'EXECUTION_UNCERTAIN', 'missing', '[]'::jsonb) ELSE v_i.failure END,
      'writes_enabled', v_writes));
END
$fn$;

-- 6. draft_confirm: owner, token and state BEFORE the switch (G11) ------------------------------------------------------------------------
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

  -- only now the switch: a valid, owned, pending draft waits while writes are off, and nothing is consumed
  SELECT coalesce((SELECT s.writes_enabled FROM platform.ai_work_link_settings s WHERE s.id), false) INTO v_writes;
  IF NOT v_writes THEN
    RETURN jsonb_build_object('status', 'not_enabled');
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

-- 7. record_intent: 0626 plus the sweep ---------------------------------------------------------------------------------------------------------
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

-- 8. intent_status and history: 0626 with the status read through intent_state --------------------------------------------------------------
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
           'status', public.ai_work_link__intent_state(i.status, i.expires_at, i.claimed_at),
           'created_at', to_char(i.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
           'expires_at', to_char(i.expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
           'confirmed_at', CASE WHEN i.confirmed_at IS NULL THEN NULL ELSE to_char(i.confirmed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') END,
           'executed_at', CASE WHEN i.executed_at IS NULL THEN NULL ELSE to_char(i.executed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') END,
           'submission_id', i.submission_id, 'result', i.result,
           'failure', CASE WHEN i.status = 'executing' AND public.ai_work_link__intent_state(i.status, i.expires_at, i.claimed_at) = 'failed'
                           THEN jsonb_build_object('code', 'EXECUTION_UNCERTAIN', 'missing', '[]'::jsonb) ELSE i.failure END)
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
             'status', public.ai_work_link__intent_state(i.status, i.expires_at, i.claimed_at),
             'created_at', to_char(i.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
             'submission_id', i.submission_id,
             'failure', CASE WHEN i.status = 'executing' AND public.ai_work_link__intent_state(i.status, i.expires_at, i.claimed_at) = 'failed'
                             THEN jsonb_build_object('code', 'EXECUTION_UNCERTAIN', 'missing', '[]'::jsonb) ELSE i.failure END) AS j
    FROM platform.ai_work_link_intent i
    WHERE i.link_id = v_ctx ->> 'link_id'
    ORDER BY i.created_at DESC, i.id DESC
    LIMIT least(greatest(coalesce(p_limit, 50), 1), 200)
  ) x;
  RETURN jsonb_build_object('items', v_items);
END
$fn$;

-- 9. the warning sentence: no promise of recording while the switch is off (G13) --------------------------------------------------------------
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
  v_writes boolean := coalesce((SELECT s.writes_enabled FROM platform.ai_work_link_settings s WHERE s.id), false);
  v_write boolean := coalesce(p_level, 0) = 1 AND v_rank >= 2 AND v_writes;
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
      || CASE
           WHEN v_write THEN 'It can also record daily entries in your name.'
           WHEN coalesce(p_level, 0) = 1 AND v_rank >= 2 THEN 'Recording entries directly is not switched on yet, so this link can read and prepare drafts only. It cannot change anything without your click.'
           ELSE 'It cannot change anything without your click.'
         END
      || ' When you paste it into an AI assistant, this information is sent to the company that runs that assistant, and an assistant that follows instructions in the data could send this information elsewhere. Use it only in an assistant that you alone use.');
END
$fn$;

-- 10. retention: 0627 plus the intent purge (G18) ---------------------------------------------------------------------------------------------
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
  v_intents integer;
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

  -- an intent holds the parameters of a change (a rate, a daily rate): kept p_keep_days, then deleted
  DELETE FROM platform.ai_work_link_intent WHERE created_at < now() - make_interval(days => p_keep_days);
  GET DIAGNOSTICS v_intents = ROW_COUNT;

  RETURN jsonb_build_object('created', to_jsonb(v_created), 'dropped', to_jsonb(v_dropped), 'keep_days', p_keep_days, 'intents_deleted', v_intents);
END
$fn$;

-- 11. grants ----------------------------------------------------------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.ai_work_link__live(text) FROM PUBLIC, anon, authenticated, app_runtime, service_role;
REVOKE ALL ON FUNCTION public.ai_work_link__intent_state(text, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated, app_runtime, service_role;
REVOKE ALL ON FUNCTION public.ai_work_link__sweep_intents(text) FROM PUBLIC, anon, authenticated, app_runtime, service_role;
REVOKE ALL ON FUNCTION public.ai_work_link_intent_claim(text) FROM PUBLIC, anon, authenticated, app_runtime;
GRANT EXECUTE ON FUNCTION public.ai_work_link_intent_claim(text) TO service_role;
REVOKE ALL ON FUNCTION public.ai_work_link_intent_finish(text, text, text, jsonb, jsonb) FROM PUBLIC, anon, authenticated, app_runtime;
GRANT EXECUTE ON FUNCTION public.ai_work_link_intent_finish(text, text, text, jsonb, jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.ai_work_link_draft_state(text, text, text) FROM PUBLIC, anon, authenticated, app_runtime;
GRANT EXECUTE ON FUNCTION public.ai_work_link_draft_state(text, text, text) TO service_role;
REVOKE ALL ON FUNCTION public.ai_work_link_draft_confirm(text, text, text) FROM PUBLIC, anon, authenticated, app_runtime;
GRANT EXECUTE ON FUNCTION public.ai_work_link_draft_confirm(text, text, text) TO service_role;
REVOKE ALL ON FUNCTION public.ai_work_link_record_intent(text, text, text, jsonb, text) FROM PUBLIC, anon, authenticated, app_runtime;
GRANT EXECUTE ON FUNCTION public.ai_work_link_record_intent(text, text, text, jsonb, text) TO service_role;
REVOKE ALL ON FUNCTION public.ai_work_link_intent_status(text, text) FROM PUBLIC, anon, authenticated, app_runtime;
GRANT EXECUTE ON FUNCTION public.ai_work_link_intent_status(text, text) TO service_role;
REVOKE ALL ON FUNCTION public.ai_work_link_history(text, integer) FROM PUBLIC, anon, authenticated, app_runtime;
GRANT EXECUTE ON FUNCTION public.ai_work_link_history(text, integer) TO service_role;
REVOKE ALL ON FUNCTION public.ai_work_link_warning(uuid, text, integer) FROM PUBLIC, anon, authenticated, app_runtime;
GRANT EXECUTE ON FUNCTION public.ai_work_link_warning(uuid, text, integer) TO service_role;
REVOKE ALL ON FUNCTION public.ai_work_link_call_retention(integer) FROM PUBLIC, anon, authenticated, app_runtime, service_role;

COMMIT;
