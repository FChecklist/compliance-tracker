-- PRE-APPROVED-LIVE-DDL: Owner (Rajat Agarwal) approved in a live Claude Code session on 2026-10-01: "yes build the in-app AI bridge too and also complete all work, merge, go green" and "apply the migration after green and tell me"; the bridge's two tables and five SECURITY DEFINER/GRANT functions are that work.
-- PROJEXA test-mode "AI bridge" (owner directive 2026-10-01): while PROJEXA is being tested before go-live, the in-app model calls
-- are answered by Claude Code running on the owner's own laptop instead of a paid model API. A Vercel function cannot reach a laptop, so
-- the bridge is a QUEUE in the database: the function enqueues a request and waits briefly; a worker on the laptop (scripts/ai-bridge-worker.mjs)
-- claims it, runs it through headless Claude Code and writes the answer back. Switched on only by AI_BRIDGE=queue in the app's environment;
-- with it unset nothing in the app touches these objects. The long-term plan is the user's OWN external AI through the AI work link
-- (WORK_ORDER_PROJEXA-LOCAL-FIRST); this bridge is the pre-go-live test stand-in and is safe to drop afterwards.
--
-- WHAT (two tables in schema platform, five functions in schema public)
--   platform.ai_bridge_request   one row per model call: purpose, model, system/user text, options, status, response.
--   platform.ai_bridge_worker    one row per worker: last_seen_at, so the app can fail FAST (no waiting) when no laptop is online.
--   public.ai_bridge_enqueue(...)      app -> returns {worker_online, id}. Writes no row and returns worker_online=false when no worker is online.
--   public.ai_bridge_get(p_id)         app -> status + response of one request.
--   public.ai_bridge_claim(p_worker)   worker -> claims the oldest queued request (FOR UPDATE SKIP LOCKED) and records the heartbeat.
--   public.ai_bridge_complete(p_id, p_response, p_error)   worker -> finishes it.
--   public.ai_bridge_purge()           expires queued/claimed rows older than 2 minutes, deletes rows older than 1 day.
--
-- SECURITY: tables have RLS enabled and NO policy (nothing reads them directly, never exposed through PostgREST). Functions are SECURITY
--   DEFINER with search_path = pg_catalog, pg_temp and every object schema-qualified. enqueue/get are granted to app_runtime and service_role
--   (the app); claim/complete/purge to service_role only (the worker). All revoked from PUBLIC, anon, authenticated. Prompt text may contain a
--   customer's project data, which is why rows are purged after a day.
-- DATA LOSS: none; additive (two tables, five functions).
-- ROLLBACK: drizzle/down/0670_ai_bridge_claude_code.down.sql
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS platform.ai_bridge_request (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  purpose      text,
  model        text,
  system_text  text NOT NULL DEFAULT '',
  user_text    text NOT NULL,
  options      jsonb NOT NULL DEFAULT '{}'::jsonb,
  status       text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','claimed','done','error','expired')),
  claimed_by   text,
  claimed_at   timestamptz,
  finished_at  timestamptz,
  response     jsonb,
  error        text
);
CREATE INDEX IF NOT EXISTS ai_bridge_request_queue_idx ON platform.ai_bridge_request (created_at) WHERE status = 'queued';
ALTER TABLE platform.ai_bridge_request ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS platform.ai_bridge_worker (
  worker_id    text PRIMARY KEY,
  last_seen_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE platform.ai_bridge_worker ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.ai_bridge_enqueue(p_purpose text, p_model text, p_system text, p_user text, p_options jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $f$
DECLARE v_id uuid;
BEGIN
  IF p_user IS NULL OR length(p_user) = 0 THEN RAISE EXCEPTION 'AIB400 EMPTY_PROMPT'; END IF;
  IF length(coalesce(p_system,'')) + length(p_user) > 200000 THEN RAISE EXCEPTION 'AIB400 PROMPT_TOO_LARGE'; END IF;
  IF NOT EXISTS (SELECT 1 FROM platform.ai_bridge_worker WHERE last_seen_at > now() - interval '45 seconds') THEN
    RETURN jsonb_build_object('worker_online', false);
  END IF;
  INSERT INTO platform.ai_bridge_request (purpose, model, system_text, user_text, options)
  VALUES (left(p_purpose, 200), left(p_model, 200), coalesce(p_system,''), p_user, coalesce(p_options,'{}'::jsonb))
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('worker_online', true, 'id', v_id);
END $f$;

CREATE OR REPLACE FUNCTION public.ai_bridge_get(p_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER STABLE SET search_path = pg_catalog, pg_temp AS $f$
  SELECT coalesce((SELECT jsonb_build_object('status', r.status, 'response', r.response, 'error', r.error)
                   FROM platform.ai_bridge_request r WHERE r.id = p_id), jsonb_build_object('status', 'missing'));
$f$;

CREATE OR REPLACE FUNCTION public.ai_bridge_claim(p_worker text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $f$
DECLARE r platform.ai_bridge_request;
BEGIN
  INSERT INTO platform.ai_bridge_worker (worker_id, last_seen_at) VALUES (left(p_worker,100), now())
  ON CONFLICT (worker_id) DO UPDATE SET last_seen_at = now();
  SELECT * INTO r FROM platform.ai_bridge_request WHERE status = 'queued' AND created_at > now() - interval '2 minutes'
  ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN RETURN NULL; END IF;
  UPDATE platform.ai_bridge_request SET status = 'claimed', claimed_by = left(p_worker,100), claimed_at = now() WHERE id = r.id;
  RETURN jsonb_build_object('id', r.id, 'purpose', r.purpose, 'model', r.model, 'system', r.system_text, 'user', r.user_text, 'options', r.options);
END $f$;

CREATE OR REPLACE FUNCTION public.ai_bridge_complete(p_id uuid, p_response jsonb, p_error text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $f$
BEGIN
  UPDATE platform.ai_bridge_request
     SET status = CASE WHEN p_error IS NULL THEN 'done' ELSE 'error' END,
         response = p_response, error = left(p_error, 2000), finished_at = now()
   WHERE id = p_id AND status = 'claimed';
  RETURN FOUND;
END $f$;

CREATE OR REPLACE FUNCTION public.ai_bridge_purge()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $f$
DECLARE n integer;
BEGIN
  UPDATE platform.ai_bridge_request SET status = 'expired', finished_at = now()
   WHERE status IN ('queued','claimed') AND created_at < now() - interval '2 minutes';
  DELETE FROM platform.ai_bridge_request WHERE created_at < now() - interval '1 day';
  GET DIAGNOSTICS n = ROW_COUNT;
  DELETE FROM platform.ai_bridge_worker WHERE last_seen_at < now() - interval '1 day';
  RETURN n;
END $f$;

REVOKE ALL ON FUNCTION public.ai_bridge_enqueue(text,text,text,text,jsonb), public.ai_bridge_get(uuid),
  public.ai_bridge_claim(text), public.ai_bridge_complete(uuid,jsonb,text), public.ai_bridge_purge() FROM PUBLIC, anon, authenticated, app_runtime;
GRANT EXECUTE ON FUNCTION public.ai_bridge_enqueue(text,text,text,text,jsonb), public.ai_bridge_get(uuid) TO app_runtime, service_role;
GRANT EXECUTE ON FUNCTION public.ai_bridge_claim(text), public.ai_bridge_complete(uuid,jsonb,text), public.ai_bridge_purge() TO service_role;
COMMIT;
