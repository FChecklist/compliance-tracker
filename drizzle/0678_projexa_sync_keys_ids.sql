-- PRE-APPROVED-LIVE-DDL: Owner (Rajat Agarwal) directive of 2026-10-02 in a live Claude Code session: "complete this 100%" (the PROJEXA local-first work: laptop as daughter server, two-way laptop<->backend sync, laptop<->laptop sync, minimal Vercel) and "do all these on local + supabase + git". This migration is the SQL half of the signing keys, the deletes reconcile and the view class of that work (WORK_ORDER_PROJEXA-LOCAL-FIRST, Phase P).
-- PROJEXA LOCAL-FIRST SYNC: signing keys, id inventory (deletes) and view class (feat/lf-sync-backend).
--
-- WHAT
--   platform.projexa_sync_key        the ES256 key pair the projexa-sync Edge function signs with. RLS ENABLED and FORCED with NO policy, every grant revoked, so
--                                    nothing reads or writes it except the SECURITY DEFINER functions below. Exactly one ACTIVE row at a time (unique partial index);
--                                    a retired key's PUBLIC half is still served so older signatures stay verifiable.
--   public.projexa_sync_key_active() / projexa_sync_key_put(...) / projexa_sync_key_rotate() / projexa_sync_public_keys()
--                                    the Edge function reads the active key (private half included, service_role only), creates the first one on first use (the
--                                    unique index makes a race harmless: the loser re-reads), and clients get the public halves only.
--   public.projexa_sync__view_class(org, role)
--                                    a short fingerprint of "what this person's role redacts" (money visibility and the hidden columns of every synced kind,
--                                    from the AI work link's own ai_work_link__hidden_cols). Two laptops may hand each other data directly ONLY when this is
--                                    equal, because a signed row cannot be re-redacted by a peer.
--   public.projexa_sync_manifest(...)  REPLACED (additive): the same answer as 0677 plus `view_class`.
--   public.projexa_sync_ids(...)      one page of the ids of one kind of one project the person may read NOW (keyset by id). A laptop compares it with what it
--                                    holds and drops what the server no longer has: this is how DELETES reach a laptop without a trigger on any business table.
--
-- NOTHING IS REIMPLEMENTED AS AUTHORITY. The person, the project binding and the row scope are 0677's (projexa_read_resolve_user, ai_work_link__bind,
-- projexa_sync__src). The id list is the candidate list of projexa_sync_pull without the row fetch: scoped on organisation AND project, nothing outside it.
-- An unknown project, a project of another organisation, a project the person may not read and an unknown kind are ONE answer (AW404).
--
-- ERRORS (coded, same as 0677): AW404 NOT_FOUND; AW400 BAD_CURSOR / BAD_LIMIT. A person who does not resolve gets {"status": <reason>} and no data.
-- GRANTS: SECURITY DEFINER, search_path = pg_catalog, pg_temp, timezone UTC; revoked from public, anon, authenticated, app_runtime; granted to service_role alone.
-- DATA LOSS: none. One new table and new functions; one function replaced with a superset answer. Applying it twice changes nothing.
-- ROLLBACK: drizzle/down/0678_projexa_sync_keys_ids.down.sql (restores the 0677 manifest exactly)

BEGIN;

SET LOCAL lock_timeout = '5s';

-- 1. the signing key table -------------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS platform.projexa_sync_key (
  kid text PRIMARY KEY,
  alg text NOT NULL DEFAULT 'ES256',
  public_jwk jsonb NOT NULL,
  private_jwk jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  retired_at timestamptz,
  CONSTRAINT projexa_sync_key_alg_check CHECK (alg = 'ES256'),
  CONSTRAINT projexa_sync_key_kid_len CHECK (char_length(kid) BETWEEN 8 AND 64)
);
CREATE UNIQUE INDEX IF NOT EXISTS projexa_sync_key_one_active ON platform.projexa_sync_key ((true)) WHERE retired_at IS NULL;
ALTER TABLE platform.projexa_sync_key ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.projexa_sync_key FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE platform.projexa_sync_key FROM PUBLIC, anon, authenticated, app_runtime, service_role;

-- 2. key functions ---------------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.projexa_sync_key_active()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT jsonb_build_object('kid', k.kid, 'alg', k.alg, 'public_jwk', k.public_jwk, 'private_jwk', k.private_jwk)
  FROM platform.projexa_sync_key k WHERE k.retired_at IS NULL
$fn$;

CREATE OR REPLACE FUNCTION public.projexa_sync_key_put(p_kid text, p_public jsonb, p_private jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF p_kid IS NULL OR p_kid !~ '^[A-Za-z0-9_-]{8,64}$' OR p_public IS NULL OR p_private IS NULL
     OR p_public ->> 'kty' IS DISTINCT FROM 'EC' OR p_public ->> 'crv' IS DISTINCT FROM 'P-256'
     OR p_private ->> 'd' IS NULL OR p_public ? 'd' THEN
    RAISE EXCEPTION 'BAD_KEY' USING ERRCODE = 'AW400';
  END IF;
  -- only when there is no active key; a race is settled by the unique index, and the loser simply reads the winner
  INSERT INTO platform.projexa_sync_key (kid, public_jwk, private_jwk) VALUES (p_kid, p_public, p_private)
  ON CONFLICT DO NOTHING;
  RETURN public.projexa_sync_key_active();
END
$fn$;

CREATE OR REPLACE FUNCTION public.projexa_sync_key_rotate()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_n integer;
BEGIN
  UPDATE platform.projexa_sync_key SET retired_at = clock_timestamp() WHERE retired_at IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END
$fn$;

-- the public halves clients may verify against: the active key and any key retired within the last 30 days (older signatures stay checkable)
CREATE OR REPLACE FUNCTION public.projexa_sync_public_keys()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT coalesce(jsonb_agg(jsonb_build_object('kid', k.kid, 'alg', k.alg, 'jwk', k.public_jwk, 'active', k.retired_at IS NULL) ORDER BY k.created_at DESC), '[]'::jsonb)
  FROM platform.projexa_sync_key k WHERE k.retired_at IS NULL OR k.retired_at > clock_timestamp() - interval '30 days'
$fn$;

-- 3. the ONE list of synced kinds, in the order a manifest lists them (0683 extends it; every function below and in 0679/0681 reads this one) ----------------
CREATE OR REPLACE FUNCTION public.projexa_sync__kinds()
RETURNS text[]
LANGUAGE sql IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $fn$ SELECT ARRAY['project', 'tasks', 'boqs', 'boq_lines', 'activities', 'progress', 'rfis', 'submittals', 'punch_list', 'change_orders', 'milestones', 'materials', 'documents']::text[] $fn$;

-- 3b. view class ----------------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.projexa_sync__view_class(p_org text, p_role text)
RETURNS text
LANGUAGE sql STABLE
SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT substr(md5(
    (public.ai_work_link__role_rank(p_role) >= 3)::text || '|' ||
    coalesce((SELECT string_agg(k.kind || ':' || coalesce((SELECT string_agg(c, ',' ORDER BY c) FROM unnest(public.ai_work_link__hidden_cols(k.kind, p_org, p_role)) AS c), ''), ';' ORDER BY k.kind)
              FROM unnest(public.projexa_sync__kinds()) AS k(kind)), '')
  ), 1, 16)
$fn$;

-- 4. the manifest, additive: 0677's answer plus view_class ----------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.projexa_sync_manifest(p_sub text, p_email text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET timezone = 'UTC'
AS $fn$
DECLARE
  v_user text;
  v_org text;
  v_reason text;
  v_ctx jsonb;
  v_projects jsonb;
  v_kinds jsonb;
BEGIN
  SELECT r.user_id, r.org_id, r.reason INTO v_user, v_org, v_reason FROM public.projexa_read_resolve_user(p_sub, p_email) r;
  IF v_org IS NULL THEN
    RETURN jsonb_build_object('status', coalesce(v_reason, 'not_linked'));
  END IF;
  v_ctx := public.projexa_sync__ctx(v_user, v_org);
  IF v_ctx IS NULL THEN
    RETURN jsonb_build_object('status', 'not_linked');
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object('id', pr.id, 'name', pr.name, 'status', pr.status::text)
                            ORDER BY pr.is_active DESC, pr.created_at DESC, pr.id), '[]'::jsonb)
    INTO v_projects
  FROM compliance.projects pr
  WHERE pr.org_id = v_org AND public.ai_work_link__can_read_project(pr.access_level::text, pr.lead_user_id, v_user, v_ctx ->> 'live_role');

  SELECT jsonb_agg(jsonb_build_object('kind', k.kind, 'project_scoped', true, 'cursor_field', public.projexa_sync__cursor_field((SELECT s.rel FROM public.projexa_sync__src(k.kind) s)), 'deletes_supported', true) ORDER BY k.n)
    INTO v_kinds
  FROM unnest(public.projexa_sync__kinds()) WITH ORDINALITY AS k(kind, n);

  RETURN jsonb_build_object(
    'status', 'ok',
    'user', jsonb_build_object('id', v_user, 'name', v_ctx ->> 'user_name', 'role', v_ctx ->> 'live_role', 'org_id', v_org),
    'projects', v_projects,
    'kinds', v_kinds,
    'view_class', public.projexa_sync__view_class(v_org, v_ctx ->> 'live_role'));
END
$fn$;

-- 5. id inventory (deletes) ------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.projexa_sync_ids(
  p_sub text, p_email text, p_project_id text, p_kind text, p_after_id text DEFAULT NULL, p_limit integer DEFAULT 5000)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET timezone = 'UTC'
AS $fn$
DECLARE
  v_user text;
  v_org text;
  v_reason text;
  v_ctx jsonb;
  v_bound jsonb;
  v_src record;
  v_ids jsonb;
  v_n integer;
  v_has_more boolean := false;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 5000 THEN
    RAISE EXCEPTION 'BAD_LIMIT' USING ERRCODE = 'AW400';
  END IF;
  IF p_after_id IS NOT NULL AND p_after_id !~ '^[A-Za-z0-9._:-]{1,64}$' THEN
    RAISE EXCEPTION 'BAD_CURSOR' USING ERRCODE = 'AW400';
  END IF;

  SELECT r.user_id, r.org_id, r.reason INTO v_user, v_org, v_reason FROM public.projexa_read_resolve_user(p_sub, p_email) r;
  IF v_org IS NULL THEN
    RETURN jsonb_build_object('status', coalesce(v_reason, 'not_linked'));
  END IF;
  v_ctx := public.projexa_sync__ctx(v_user, v_org);
  IF v_ctx IS NULL THEN
    RETURN jsonb_build_object('status', 'not_linked');
  END IF;

  v_bound := public.ai_work_link__bind(v_ctx, p_project_id);
  IF v_bound IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'AW404';
  END IF;
  SELECT s.from_sql, s.scope_sql INTO v_src FROM public.projexa_sync__src(p_kind) s;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'AW404';
  END IF;

  EXECUTE format(
    'SELECT coalesce(jsonb_agg(c.id ORDER BY c.id), ''[]''::jsonb) FROM (SELECT t.id::text AS id FROM %1$s WHERE %2$s%3$s ORDER BY t.id::text LIMIT %4$s) c',
    v_src.from_sql, v_src.scope_sql, CASE WHEN p_after_id IS NULL THEN '' ELSE ' AND t.id::text > $3' END, p_limit + 1)
    INTO v_ids USING p_project_id, v_org, p_after_id;

  v_n := jsonb_array_length(v_ids);
  IF v_n > p_limit THEN
    v_has_more := true;
    v_ids := v_ids - p_limit;
    v_n := p_limit;
  END IF;

  RETURN jsonb_build_object('status', 'ok', 'ids', v_ids, 'has_more', v_has_more, 'next_id', CASE WHEN v_n > 0 THEN v_ids ->> (v_n - 1) END);
END
$fn$;

-- 6. grants ----------------------------------------------------------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.projexa_sync__kinds() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.projexa_sync__view_class(text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.projexa_sync_key_active() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.projexa_sync_key_put(text, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.projexa_sync_key_rotate() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.projexa_sync_public_keys() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.projexa_sync_manifest(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.projexa_sync_ids(text, text, text, text, text, integer) FROM PUBLIC, anon, authenticated;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.projexa_sync__kinds() FROM app_runtime';
    EXECUTE 'REVOKE ALL ON FUNCTION public.projexa_sync__view_class(text, text) FROM app_runtime';
    EXECUTE 'REVOKE ALL ON FUNCTION public.projexa_sync_key_active() FROM app_runtime';
    EXECUTE 'REVOKE ALL ON FUNCTION public.projexa_sync_key_put(text, jsonb, jsonb) FROM app_runtime';
    EXECUTE 'REVOKE ALL ON FUNCTION public.projexa_sync_key_rotate() FROM app_runtime';
    EXECUTE 'REVOKE ALL ON FUNCTION public.projexa_sync_public_keys() FROM app_runtime';
    EXECUTE 'REVOKE ALL ON FUNCTION public.projexa_sync_manifest(text, text) FROM app_runtime';
    EXECUTE 'REVOKE ALL ON FUNCTION public.projexa_sync_ids(text, text, text, text, text, integer) FROM app_runtime';
  END IF;
END $$;
GRANT EXECUTE ON FUNCTION public.projexa_sync_key_active() TO service_role;
GRANT EXECUTE ON FUNCTION public.projexa_sync_key_put(text, jsonb, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.projexa_sync_key_rotate() TO service_role;
GRANT EXECUTE ON FUNCTION public.projexa_sync_public_keys() TO service_role;
GRANT EXECUTE ON FUNCTION public.projexa_sync_manifest(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.projexa_sync_ids(text, text, text, text, text, integer) TO service_role;

COMMIT;
