-- PROJEXA-BUILD-001 U-46 step 1 (database), migration 7 of 8 (register rows BR-485, BR-484; spec section 10.10, audit A-12): call-log
-- retention of the Universal AI Work Link, inside Postgres. No Vercel function, no pg_net call: the work is pure SQL.
--
-- WHAT
--   public.ai_work_link_call_retention(p_keep_days integer DEFAULT 90) -> jsonb
--     1. makes sure the partitions of the current month and the next two months of platform.ai_work_link_call exist (migration 3's
--        helper), so the log never depends on this job having run on time; the spec asks for next month's partition ahead of time, and
--        one more month is the margin;
--     2. detaches and drops every partition whose upper bound is more than p_keep_days (90) days in the past.
--     Returns {created[], dropped[], keep_days}. Dropping a partition deletes no row one by one, so the append-only guard trigger's
--     no-DELETE rule stays absolute and needs no exemption (spec 10.10).
--   cron.job 'ai-work-link-call-retention', schedule '10 4 * * *' (04:10 UTC daily, outside DPDP's 00:30 Monday and 03:30 daily
--     minutes), command: select public.ai_work_link_call_retention(). Created only where the cron schema exists (verdian-ai has
--     pg_cron 1.6.4; PGlite has none). It is created by the role that applies this file, postgres, and pg_cron runs a job as the role
--     that owns it, so the function runs as postgres (register row BR-485).
--
-- GRANTS: the function is executable by postgres only: revoked from public, anon, authenticated, app_runtime and service_role. It is
--   not callable through PostgREST by anyone (register row BR-484 counts it among the functions no anon or authenticated may run).
--
-- BOUND: a leaked link at the 120-per-minute cap writes at most 172,800 rows a day and at most 90 days of rows are kept. A caller
--   with an unknown token is refused before a row is written (migration 4).
--
-- DATA LOSS: none from this file. The FIRST scheduled run (04:10 UTC after the apply) drops nothing, because the log is new and holds
--   no partition older than 90 days. From then on it drops rows by design: the log keeps 90 days.
--
-- HOW IT IS APPLIED: through the Supabase MCP by the PM after the claim (ACTIVE-CLAIMS, 2026-09-25: the cron job is listed in
--   ai-os/SHARED_BOUNDARY.md section 5 as planned) is on main and the always-aborted rehearsal passed, and after migration 0623.
--   The rehearsal's schema hash does not cover the cron schema, so the PGlite test with a stand-in cron schema proves the job
--   registration. Idempotent: create or replace; cron.schedule updates a job of the same name.
--
-- ROLLBACK: drizzle/down/0627_build001_awl_retention.down.sql

BEGIN;

SET LOCAL lock_timeout = '5s';

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

REVOKE ALL ON FUNCTION public.ai_work_link_call_retention(integer) FROM PUBLIC, anon, authenticated, app_runtime, service_role;

DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    PERFORM cron.schedule(
      'ai-work-link-call-retention',
      '10 4 * * *',
      $cron$select public.ai_work_link_call_retention()$cron$
    );
  END IF;
END
$do$;

COMMIT;
