-- PRE-APPROVED-LIVE-DDL: Owner (Rajat Agarwal) directive of 2026-10-03 in a live Claude Code session: "if the download is happening, and due to any reason it stops, we should know at our end; we should constantly monitor that 100% download is done; this is the most important part of the operation ... we cannot lose customer". This migration closes a gap in 0688 found by its real-browser test (new column and replaced functions only; no existing row is changed).
-- PROJEXA PREPARE MONITOR, PART 2: a laptop that is ALIVE but NOT ADVANCING.
--
-- THE GAP (found by e2e/lf-lifecycle-monitor.spec.ts on 2026-10-03). 0688 marks a laptop STALLED when it goes silent. But a laptop whose copy
-- service is down keeps its screen open, keeps heartbeating "projects, 70%, running" for the whole 3 minute budget, and so looked healthy to us
-- while making no progress at all. Silence is one signal; "heartbeat without progress" is the other.
--
-- WHAT
--   platform.projexa_prepare_state.progress_at   when the stage or the percentage last moved forward (or the attempt changed). A heartbeat does
--                                                not move it.
--   public.projexa_prepare_report()              same signature; now also keeps progress_at.
--   public.projexa_prepare_health(stall, never, stuck)   gains a third parameter (default 5 minutes) and a fourth health word: STUCK = still
--                                                reporting (so not stalled) but no progress for `stuck` minutes, with the stage and reason it is stuck in.
--
-- GRANTS: same as 0688 (service_role only). DATA LOSS: none. ROLLBACK: drizzle/down/0689_projexa_prepare_stuck.down.sql

BEGIN;

ALTER TABLE platform.projexa_prepare_state ADD COLUMN IF NOT EXISTS progress_at timestamptz NOT NULL DEFAULT clock_timestamp();

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
    percent = CASE WHEN EXCLUDED.attempts > s.attempts OR s.completed_at IS NOT NULL AND EXCLUDED.status <> 'done' THEN EXCLUDED.percent
                   ELSE greatest(s.percent, EXCLUDED.percent) END,
    status = EXCLUDED.status,
    attempts = greatest(s.attempts, EXCLUDED.attempts),
    error_class = EXCLUDED.error_class,
    error_detail = EXCLUDED.error_detail,
    last_seen_at = clock_timestamp(),
    -- progress = the stage or the percentage moved forward, a new attempt began, or it finished; a heartbeat repeating the same state is not progress
    progress_at = CASE WHEN EXCLUDED.stage IS DISTINCT FROM s.stage OR EXCLUDED.percent > s.percent OR EXCLUDED.attempts > s.attempts
                            OR (EXCLUDED.status = 'done' AND s.completed_at IS NULL)
                       THEN clock_timestamp() ELSE s.progress_at END,
    completed_at = CASE WHEN EXCLUDED.status = 'done' AND EXCLUDED.percent = 100 THEN coalesce(s.completed_at, clock_timestamp())
                        WHEN EXCLUDED.status = 'done' THEN s.completed_at
                        ELSE NULL END,
    started_at = CASE WHEN s.completed_at IS NOT NULL AND EXCLUDED.status <> 'done' THEN clock_timestamp() ELSE s.started_at END;
  RETURN jsonb_build_object('status', 'ok');
END
$fn$;

DROP FUNCTION IF EXISTS public.projexa_prepare_health(integer, integer);
CREATE OR REPLACE FUNCTION public.projexa_prepare_health(p_stall_minutes integer DEFAULT 3, p_never_minutes integer DEFAULT 15, p_stuck_minutes integer DEFAULT 5)
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
             WHEN st.status IN ('running', 'retrying') AND st.progress_at < clock_timestamp() - make_interval(mins => greatest(1, p_stuck_minutes)) THEN 'stuck'
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
    'stuck', (SELECT count(*) FROM s WHERE health = 'stuck'),
    'failing', (SELECT count(*) FROM s WHERE health = 'failing'),
    'never_finished', (SELECT count(*) FROM s WHERE health = 'never_finished'),
    'problems', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'health', p.health, 'user_id', p.user_id, 'org_id', p.org_id, 'device_id', p.device_id, 'release', p.release_version,
        'stage', p.stage, 'percent', p.percent, 'status', p.status, 'attempts', p.attempts, 'error_class', p.error_class,
        'error_detail', p.error_detail, 'started_at', p.started_at, 'last_seen_at', p.last_seen_at, 'progress_at', p.progress_at,
        'silent_minutes', round(extract(epoch FROM (clock_timestamp() - p.last_seen_at)) / 60),
        'no_progress_minutes', round(extract(epoch FROM (clock_timestamp() - p.progress_at)) / 60)
      ) ORDER BY p.last_seen_at) FROM s p WHERE p.health IN ('stalled', 'stuck', 'failing', 'never_finished')), '[]'::jsonb)
  );
$fn$;

REVOKE ALL ON FUNCTION public.projexa_prepare_health(integer, integer, integer) FROM PUBLIC, anon, authenticated;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.projexa_prepare_health(integer, integer, integer) FROM app_runtime';
  END IF;
END $$;
GRANT EXECUTE ON FUNCTION public.projexa_prepare_health(integer, integer, integer) TO service_role;

COMMIT;
