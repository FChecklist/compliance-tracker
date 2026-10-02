-- PRE-APPROVED-LIVE-DDL: Owner (Rajat Agarwal) directive of 2026-10-03 in a live Claude Code session: "if the download is happening, and due to any reason it stops, we should know at our end; we should constantly monitor that 100% download is done; this is the most important part of the operation ... we cannot lose customer". This migration is that monitor (new tables and functions only, no existing row touched).
-- PROJEXA PREPARE MONITOR: what every laptop's "Preparing your PROJEXA workspace" run is doing, as seen from OUR side.
--
-- WHY. PROJEXA does not work on a laptop until its files are installed and its projects are copied. A run that stops half way (a flaky
-- network, a closed lid, a refused project, a service outage, a browser that cannot keep the files) used to be invisible to us: the
-- laptop knew, we did not. Now every laptop reports each stage, each percentage step, every failure with a reason class, and a heartbeat
-- while it works; this file is where that lands, plus the one question the owner asks: WHICH LAPTOPS ARE NOT AT 100% AND WHY.
--
-- WHAT
--   platform.projexa_prepare_state    one row per (person, device): the latest stage / percent / status / attempts / error class, when it
--                                     started, when we last heard from it, when it reached 100%.
--   platform.projexa_prepare_event    append-only history of reports (bounded: 400 per person per day), so a stall can be read back.
--   public.projexa_prepare_report()   records one report for the PERSON who is signed in (same person resolution as the install record).
--   public.projexa_prepare_health()   the answer: counts, and the list of laptops that are STALLED (no word for N minutes while not done),
--                                     FAILING (retried and still failing), or NEVER FINISHED (started long ago, not done), with the reason.
--
-- STATUS WORDS: running | retrying | done | failed. A laptop that is `running` or `retrying` and silent for longer than the stall window
-- is STALLED: the heartbeat means silence is itself the signal (a closed tab, a dead network, a crashed browser).
-- ERROR CLASSES (the client sends one of these, never free text as the key): service_unreachable | signed_out | not_linked | worker_failed |
-- no_service_worker | storage_blocked | download_failed | timeout | project_unreadable | rate_limited | update_required | other.
--
-- GRANTS: SECURITY DEFINER, search_path = pg_catalog, pg_temp, timezone UTC; revoked from public, anon, authenticated, app_runtime;
-- granted to service_role only (the projexa-sync Edge Function and the owner's checks).
-- DATA LOSS: none. New tables and functions only; applying it twice changes nothing.
-- ROLLBACK: drizzle/down/0688_projexa_prepare_monitor.down.sql

BEGIN;

CREATE TABLE IF NOT EXISTS platform.projexa_prepare_state (
  user_id text NOT NULL,
  device_id text NOT NULL,
  org_id text NOT NULL,
  release_version text,
  stage text NOT NULL,
  percent integer NOT NULL,
  status text NOT NULL,
  attempts integer NOT NULL DEFAULT 1,
  error_class text,
  error_detail text,
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_seen_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  PRIMARY KEY (user_id, device_id),
  CONSTRAINT projexa_prepare_state_device_check CHECK (device_id ~ '^[A-Za-z0-9_-]{8,64}$'),
  CONSTRAINT projexa_prepare_state_status_check CHECK (status IN ('running', 'retrying', 'done', 'failed')),
  CONSTRAINT projexa_prepare_state_percent_check CHECK (percent BETWEEN 0 AND 100),
  CONSTRAINT projexa_prepare_state_stage_check CHECK (stage IN ('start', 'worker', 'app', 'database', 'projects', 'done')),
  CONSTRAINT projexa_prepare_state_error_len CHECK (error_detail IS NULL OR char_length(error_detail) <= 300)
);
CREATE INDEX IF NOT EXISTS projexa_prepare_state_seen_idx ON platform.projexa_prepare_state (last_seen_at DESC);
CREATE INDEX IF NOT EXISTS projexa_prepare_state_open_idx ON platform.projexa_prepare_state (status, last_seen_at) WHERE completed_at IS NULL;

CREATE TABLE IF NOT EXISTS platform.projexa_prepare_event (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id text NOT NULL,
  device_id text NOT NULL,
  org_id text NOT NULL,
  release_version text,
  stage text NOT NULL,
  percent integer NOT NULL,
  status text NOT NULL,
  attempt integer NOT NULL DEFAULT 1,
  error_class text,
  error_detail text,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS projexa_prepare_event_user_idx ON platform.projexa_prepare_event (user_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS projexa_prepare_event_device_idx ON platform.projexa_prepare_event (device_id, recorded_at DESC);

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['projexa_prepare_state', 'projexa_prepare_event'] LOOP
    EXECUTE format('ALTER TABLE platform.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON TABLE platform.%I FROM PUBLIC, anon, authenticated, app_runtime, service_role', t);
  END LOOP;
END $$;

-- 2. the report -----------------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.projexa_prepare_report(
  p_sub text, p_email text, p_device_id text, p_release_version text, p_stage text, p_percent integer, p_status text,
  p_attempt integer DEFAULT 1, p_error_class text DEFAULT NULL, p_error_detail text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET timezone = 'UTC'
AS $fn$
DECLARE
  v_user text;
  v_org text;
  v_reason text;
  v_class text;
BEGIN
  IF p_device_id IS NULL OR p_device_id !~ '^[A-Za-z0-9_-]{8,64}$'
     OR p_stage IS NULL OR p_stage NOT IN ('start', 'worker', 'app', 'database', 'projects', 'done')
     OR p_status IS NULL OR p_status NOT IN ('running', 'retrying', 'done', 'failed')
     OR p_percent IS NULL OR p_percent < 0 OR p_percent > 100
     OR p_attempt IS NULL OR p_attempt < 1 OR p_attempt > 100000
     OR (p_release_version IS NOT NULL AND p_release_version !~ '^([0-9]{4}\.[0-9]{2}\.[0-9]{2}-[0-9]{3}|[0-9a-f]{7,40}|dev)$')
     OR (p_error_detail IS NOT NULL AND char_length(p_error_detail) > 300) THEN
    RAISE EXCEPTION 'BAD_PREPARE' USING ERRCODE = 'AW400';
  END IF;
  v_class := CASE WHEN p_error_class IN ('service_unreachable', 'signed_out', 'not_linked', 'worker_failed', 'no_service_worker', 'storage_blocked',
                                        'download_failed', 'timeout', 'project_unreadable', 'rate_limited', 'update_required')
                  THEN p_error_class WHEN p_error_class IS NULL THEN NULL ELSE 'other' END;

  SELECT r.user_id, r.org_id, r.reason INTO v_user, v_org, v_reason FROM public.projexa_read_resolve_user(p_sub, p_email) r;
  IF v_org IS NULL THEN
    RETURN jsonb_build_object('status', coalesce(v_reason, 'not_linked'));
  END IF;

  -- a bounded history: a looping client cannot grow it without limit (the state row below is still updated)
  IF (SELECT count(*) FROM platform.projexa_prepare_event e WHERE e.user_id = v_user AND e.recorded_at > clock_timestamp() - interval '1 day') < 400 THEN
    INSERT INTO platform.projexa_prepare_event (user_id, device_id, org_id, release_version, stage, percent, status, attempt, error_class, error_detail)
    VALUES (v_user, p_device_id, v_org, p_release_version, p_stage, p_percent, p_status, p_attempt, v_class, left(p_error_detail, 300));
  END IF;

  INSERT INTO platform.projexa_prepare_state AS s (user_id, device_id, org_id, release_version, stage, percent, status, attempts, error_class, error_detail, completed_at)
  VALUES (v_user, p_device_id, v_org, p_release_version, p_stage, p_percent, p_status, p_attempt, v_class, left(p_error_detail, 300),
          CASE WHEN p_status = 'done' AND p_percent = 100 THEN clock_timestamp() END)
  ON CONFLICT (user_id, device_id) DO UPDATE SET
    org_id = EXCLUDED.org_id,
    release_version = coalesce(EXCLUDED.release_version, s.release_version),
    stage = EXCLUDED.stage,
    -- the percentage never goes backwards within one attempt; a new attempt (a higher number) may start again from 0
    percent = CASE WHEN EXCLUDED.attempts > s.attempts OR s.completed_at IS NOT NULL AND EXCLUDED.status <> 'done' THEN EXCLUDED.percent
                   ELSE greatest(s.percent, EXCLUDED.percent) END,
    status = EXCLUDED.status,
    attempts = greatest(s.attempts, EXCLUDED.attempts),
    error_class = EXCLUDED.error_class,
    error_detail = EXCLUDED.error_detail,
    last_seen_at = clock_timestamp(),
    completed_at = CASE WHEN EXCLUDED.status = 'done' AND EXCLUDED.percent = 100 THEN coalesce(s.completed_at, clock_timestamp())
                        WHEN EXCLUDED.status = 'done' THEN s.completed_at
                        ELSE NULL END,
    started_at = CASE WHEN s.completed_at IS NOT NULL AND EXCLUDED.status <> 'done' THEN clock_timestamp() ELSE s.started_at END;
  RETURN jsonb_build_object('status', 'ok');
END
$fn$;

-- 3. the answer -----------------------------------------------------------------------------------------------------------------------------
-- p_stall_minutes: silence while not done that counts as STALLED (default 3: the client reports at least every 20 seconds while it works).
-- p_never_minutes: started this long ago and still not done = NEVER FINISHED (default 15; the screen's own budget is 3 minutes).
CREATE OR REPLACE FUNCTION public.projexa_prepare_health(p_stall_minutes integer DEFAULT 3, p_never_minutes integer DEFAULT 15)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET timezone = 'UTC'
AS $fn$
  WITH s AS (
    SELECT st.*,
           CASE
             WHEN st.completed_at IS NOT NULL THEN 'done'
             WHEN st.status IN ('running', 'retrying') AND st.last_seen_at < clock_timestamp() - make_interval(mins => greatest(1, p_stall_minutes)) THEN 'stalled'
             WHEN st.status = 'failed' OR (st.status = 'retrying' AND st.attempts >= 3) THEN 'failing'
             WHEN st.started_at < clock_timestamp() - make_interval(mins => greatest(1, p_never_minutes)) THEN 'never_finished'
             ELSE 'in_progress'
           END AS health
    FROM platform.projexa_prepare_state st
    WHERE st.last_seen_at > clock_timestamp() - interval '30 days'
  )
  SELECT jsonb_build_object(
    'checked_at', clock_timestamp(),
    'laptops', (SELECT count(*) FROM s),
    'done', (SELECT count(*) FROM s WHERE health = 'done'),
    'in_progress', (SELECT count(*) FROM s WHERE health = 'in_progress'),
    'stalled', (SELECT count(*) FROM s WHERE health = 'stalled'),
    'failing', (SELECT count(*) FROM s WHERE health = 'failing'),
    'never_finished', (SELECT count(*) FROM s WHERE health = 'never_finished'),
    'problems', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'health', p.health, 'user_id', p.user_id, 'org_id', p.org_id, 'device_id', p.device_id, 'release', p.release_version,
        'stage', p.stage, 'percent', p.percent, 'status', p.status, 'attempts', p.attempts, 'error_class', p.error_class,
        'error_detail', p.error_detail, 'started_at', p.started_at, 'last_seen_at', p.last_seen_at,
        'silent_minutes', round(extract(epoch FROM (clock_timestamp() - p.last_seen_at)) / 60)
      ) ORDER BY p.last_seen_at) FROM s p WHERE p.health IN ('stalled', 'failing', 'never_finished')), '[]'::jsonb)
  );
$fn$;

-- 4. grants ---------------------------------------------------------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.projexa_prepare_report(text, text, text, text, text, integer, text, integer, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.projexa_prepare_health(integer, integer) FROM PUBLIC, anon, authenticated;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.projexa_prepare_report(text, text, text, text, text, integer, text, integer, text, text) FROM app_runtime';
    EXECUTE 'REVOKE ALL ON FUNCTION public.projexa_prepare_health(integer, integer) FROM app_runtime';
  END IF;
END $$;
GRANT EXECUTE ON FUNCTION public.projexa_prepare_report(text, text, text, text, text, integer, text, integer, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.projexa_prepare_health(integer, integer) TO service_role;

COMMIT;
