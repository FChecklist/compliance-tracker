-- PRE-APPROVED-LIVE-DDL: Owner instruction in chat, 2026-10-04 -- rollback of 0693
-- (AI full rights for work links), same authorization as the up migration.
-- Down-migration for drizzle/0693_awl_full_rights.sql (PROJEXA AI full rights). Convention: docs/ROLLBACK_RUNBOOK.md section 3.
-- Not auto-applied by any script or CI job; the PM runs it deliberately.
--
-- WHAT IT RESTORES: the state after 0685 and before 0693.
--   1. Every user-scope link is set back to level 0 (the old CHECK would otherwise refuse the constraint) and the CHECK is put back to "level 0 only".
--   2. ai_work_link_mint_user_for goes back to the 3-argument function of 0668 (level 0 for ever).
--   3. ai_work_link__direct_ok goes back to the 0685 predicate (a level-2 function is a direct action only with the person's switch on).
-- WHAT STOPS WORKING: a user-scope link can no longer be level 1; every delete, removal and archive is a draft the person confirms again unless the
-- person's switch is on. Drafts and actions already recorded stay.

BEGIN;

SET LOCAL lock_timeout = '5s';

UPDATE platform.user_ai_links SET authority_level = 0 WHERE scope = 'user' AND authority_level <> 0;

ALTER TABLE platform.user_ai_links DROP CONSTRAINT IF EXISTS user_ai_links_user_scope_shape;
ALTER TABLE platform.user_ai_links ADD CONSTRAINT user_ai_links_user_scope_shape
  CHECK (scope = 'project' OR (product = 'projexa' AND project_id IS NULL AND authority_level = 0));

DROP FUNCTION IF EXISTS public.ai_work_link_mint_user_for(text, integer, text, integer);

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

CREATE OR REPLACE FUNCTION public.ai_work_link__direct_ok(p_ctx jsonb, p_link_level integer)
RETURNS boolean
LANGUAGE plpgsql IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  RETURN coalesce((p_ctx ->> 'effective_level')::integer, 0) >= 1
     AND (p_link_level = 1 OR (p_link_level = 2 AND coalesce((p_ctx ->> 'act_without_asking')::boolean, false)));
END
$fn$;

REVOKE ALL ON FUNCTION public.ai_work_link_mint_user_for(text, integer, text) FROM PUBLIC, anon, authenticated, app_runtime;
GRANT EXECUTE ON FUNCTION public.ai_work_link_mint_user_for(text, integer, text) TO service_role;
REVOKE ALL ON FUNCTION public.ai_work_link__direct_ok(jsonb, integer) FROM PUBLIC, anon, authenticated, app_runtime, service_role;

COMMIT;
