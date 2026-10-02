-- PRE-APPROVED-LIVE-DDL: Owner (Rajat Agarwal) directive of 2026-10-03 in a live Claude Code session: "if the download is happening, and due to any reason it stops, we should know at our end; we should constantly monitor that 100% download is done; this is the most important part of the operation ... we cannot lose customer". This migration keeps the monitor's alert honest (it replaces one function; no row is changed).
-- PROJEXA PREPARE MONITOR, PART 3: the automated end-to-end test accounts (*.e2e-test.projexa-ai.com) are not laptops of people. Their production
-- runs open a browser, leave after seconds, and showed up as 16 STALLED laptops within an hour of the monitor going live, which would keep the
-- alert permanently red and hide a real one. They are left out of projexa_prepare_health(); their rows are still recorded.
-- ROLLBACK: drizzle/down/0690_projexa_prepare_e2e_excluded.down.sql
BEGIN;

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
      -- the automated test accounts of the production end-to-end runs open a browser, leave after seconds and are never real laptops
      AND NOT EXISTS (SELECT 1 FROM compliance.users u WHERE u.id = st.user_id AND u.email ILIKE '%.e2e-test.projexa-ai.com')
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

COMMIT;
