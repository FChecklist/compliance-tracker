-- PRE-APPROVED-LIVE-DDL: Owner (Rajat Agarwal) decision of 2026-10-04, final: "the external AI that a user pastes their PROJEXA work link into must be able to do ANYTHING the user can do in PROJEXA - edit, add, delete, any function, any data, old/new/existing projects - limited ONLY by the user's ROLE, the PROJECTS that user can access and the user's ORGANISATION. The only thing it must not do is write code. No extra human-approval steps on top of the user's own role." This migration is that work (audit37/full-rights).
-- PROJEXA AI FULL RIGHTS: (A) a user-wide link is minted at the highest level the person's role allows, and (B) no confirmation gate on a direct action.
--
-- WHAT
--   A. platform.user_ai_links.user_scope_shape (0668) said a user-scope link is level 0 for ever. It now says level 0 or 1 (still no project, still projexa).
--      public.ai_work_link_mint_user_for(user, days, label) is replaced by (user, days, label, level DEFAULT NULL): with no level it mints at the MAXIMUM
--      the person's role allows, which is the rule ai_work_link_create_for (0624) already applies to a project link: level 1 (direct add / edit / delete)
--      needs rank 2 (member) or above, a viewer (rank 1) gets level 0 (read). An explicit level above that maximum is refused AW403 LEVEL_NOT_ALLOWED
--      (an explicit lower level is allowed: a person may ask for a read-only link); a level that is not 0 or 1 is AW400 BAD_LEVEL. The old 3-argument
--      function is dropped so a call with three arguments resolves to the new one. The same caps (10 an hour, 30 a day), the same lock, the same
--      "one live user link per person" and the same function list (every function the person's rank may have) as 0668.
--   B. public.ai_work_link__direct_ok(ctx, link_level) (0685) said a level-2 function (every delete, removal and archive) is a draft the person confirms
--      unless the person has switched "let my AI act without asking" on. It now says: a direct action needs effective level 1 and a function that is on
--      the link at level 1 or 2. The person's switch is NOT read any more (the table, the setter and the ctx key act_without_asking all stay, for
--      compatibility, and it no longer blocks anything). record_intent and intent_claim already call this one predicate, so both change with it.
--
-- WHAT STAYS EXACTLY AS IT WAS (the only limits): the person's ROLE (the effective function list is the person's rank, read now, at record time and again
-- at claim time: ROLE_CHANGED), the PROJECTS the person can read (ai_work_link__bind: another organisation's project, a private project the person may not
-- read and a project that does not exist are one and the same AW404), the ORGANISATION (a link acts in the organisation of its person only), the link's
-- own ceiling (a level-0 link is read and draft only), the kill switch writes_enabled, the write caps, and the audit trail (every intent is recorded
-- with the person and the link, and the app shows it as "<person> via AI assistant").
--
-- EXISTING LINKS. A user-scope link minted before this file stays at level 0 (its row is not changed): the person makes a new link, which stops the old one.
--
-- ERRORS (coded, as 0668): AW400 BAD_DAYS, BAD_LEVEL; AW403 USER_NOT_ACTIVE, LEVEL_NOT_ALLOWED; AW429 MINT_CAP_HOUR, MINT_CAP_DAY.
-- GRANTS: SECURITY DEFINER, search_path = pg_catalog, pg_temp, revoked from public, anon, authenticated and app_runtime; the mint is granted to service_role
-- alone, direct_ok is owner-only, as before.
-- DATA LOSS: none. One CHECK replaced by a wider one that every existing row satisfies, one function replaced, one predicate replaced. Applying it twice
-- changes nothing. Self-contained: it does not need 0685 to be applied first (direct_ok is created if it is absent; nothing calls it before 0685).
--
-- HOW IT IS APPLIED: by the owner / PM through the Supabase MCP after merge. NOT applied by the engineer who wrote it.
-- ROLLBACK: drizzle/down/0693_awl_full_rights.down.sql

BEGIN;

SET LOCAL lock_timeout = '5s';

-- A. the table: a user-scope link may be level 0 or 1 ------------------------------------------------------------------------------------------
ALTER TABLE platform.user_ai_links DROP CONSTRAINT IF EXISTS user_ai_links_user_scope_shape;
ALTER TABLE platform.user_ai_links ADD CONSTRAINT user_ai_links_user_scope_shape
  CHECK (scope = 'project' OR (product = 'projexa' AND project_id IS NULL AND authority_level IN (0, 1)));

-- A. the mint ------------------------------------------------------------------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.ai_work_link_mint_user_for(text, integer, text);

CREATE OR REPLACE FUNCTION public.ai_work_link_mint_user_for(
  p_user_id text, p_days integer DEFAULT 7, p_label text DEFAULT NULL, p_level integer DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_u record;
  v_rank integer;
  v_max integer;
  v_level integer;
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
  IF p_level IS NOT NULL AND p_level NOT IN (0, 1) THEN
    RAISE EXCEPTION 'BAD_LEVEL' USING ERRCODE = 'AW400';
  END IF;
  SELECT u.id, u.org_id, u.role::text AS role, u.is_active INTO v_u FROM compliance.users u WHERE u.id = p_user_id;
  IF NOT FOUND OR NOT v_u.is_active OR v_u.org_id IS NULL THEN
    RAISE EXCEPTION 'USER_NOT_ACTIVE' USING ERRCODE = 'AW403';
  END IF;
  v_rank := public.ai_work_link__role_rank(v_u.role);

  -- the highest level the person's role allows: the rule of ai_work_link_create_for (a project link at level 1 needs rank 2, member, or above)
  v_max := CASE WHEN v_rank >= 2 THEN 1 ELSE 0 END;
  v_level := coalesce(p_level, v_max);
  IF v_level > v_max THEN
    RAISE EXCEPTION 'LEVEL_NOT_ALLOWED' USING ERRCODE = 'AW403';
  END IF;

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
    v_id, v_u.org_id, p_user_id, NULL, 'active', v_now, 'projexa', NULL, v_hash, v_level,
    v_fns, true, v_label, v_expires, p_user_id, 0, 0, 'user');

  RETURN jsonb_build_object(
    'link_id', v_id,
    'token', v_token,
    'scope', 'user',
    'level', v_level,
    'allowed_functions', to_jsonb(v_fns),
    'hide_personal', true,
    'label', v_label,
    'expires_at', to_char(v_expires AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'project', NULL,
    'user_id', p_user_id);
END
$fn$;

-- B. no confirmation gate on a direct action -----------------------------------------------------------------------------------------------------
-- Effective level 1 (the link's own ceiling, the person's rank, the kill switch: all in ai_work_link__resolve / __live) and a function that is on the
-- link at level 1 or 2. The person's "let my AI act without asking" switch is no longer read here.
CREATE OR REPLACE FUNCTION public.ai_work_link__direct_ok(p_ctx jsonb, p_link_level integer)
RETURNS boolean
LANGUAGE plpgsql IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  RETURN coalesce((p_ctx ->> 'effective_level')::integer, 0) >= 1
     AND coalesce(p_link_level, 0) IN (1, 2);
END
$fn$;

-- grants -------------------------------------------------------------------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.ai_work_link_mint_user_for(text, integer, text, integer) FROM PUBLIC, anon, authenticated, app_runtime;
GRANT EXECUTE ON FUNCTION public.ai_work_link_mint_user_for(text, integer, text, integer) TO service_role;
REVOKE ALL ON FUNCTION public.ai_work_link__direct_ok(jsonb, integer) FROM PUBLIC, anon, authenticated, app_runtime, service_role;

COMMIT;
