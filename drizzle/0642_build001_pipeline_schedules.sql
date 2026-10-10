-- PROJEXA-BUILD-001 U-40 (register rows BR-515, BR-516, BR-517; PMD-05, PMD-33, PMD-39): the database side of the scheduler
-- bridge -- a schedule that runs one registry function as its owner, and the pg_cron job that wakes the bridge every five
-- minutes. Schema and one inactive cron row only; no data row is written, changed or deleted by this file.
--
-- WHAT
--   compliance.pipeline_schedules, one row per AI-run schedule (no table existed for one: report_schedules, fm_ppm_schedules
--   and the billing schedules do not run a registry function):
--     id              text, primary key (a cuid written by the app, or gen_random_uuid()::text)
--     org_id          text NOT NULL: the organisation the schedule belongs to. Every read and write of a run is scoped to it.
--     owner_user_id   text NOT NULL, references compliance.users(id) ON DELETE CASCADE: the person the schedule acts as. The
--                     bridge reads this person's role from compliance.users at run time; it never acts as an API key.
--     function_id     text NOT NULL: a registry function id (src/lib/pipeline/function-registry.ts).
--     params          jsonb NOT NULL DEFAULT '{}': the function's parameters; must be a JSON object.
--     cadence         text NOT NULL: a plain five-field cron expression (minute hour day-of-month month day-of-week, UTC). The
--                     CHECK only counts the fields; src/lib/pipeline/cron-next.ts is what reads them.
--     next_run_at     timestamptz NOT NULL: the schedule is due when this is at or before now. The bridge moves it on when it
--                     claims the schedule, so a run that fails does not run again at the next five-minute tick.
--     last_run_at     timestamptz: when the bridge last claimed it.
--     last_result     jsonb: what the last run did (a summary and a code, never the function's result body).
--     is_active       boolean NOT NULL DEFAULT true: the bridge turns it off for a schedule whose owner is no longer an active
--                     user of the organisation (PMD-33) or whose cadence cannot be read.
--     created_at, updated_at  timestamptz NOT NULL DEFAULT now()
--   Indexes: idx_pipeline_schedules_due on (next_run_at) WHERE is_active, for the due read and the due count;
--   idx_pipeline_schedules_org_id; idx_pipeline_schedules_owner_user_id (the foreign key's cascade).
--   CHECKs: function_id is not blank, params is a JSON object, cadence has five fields.
--
--   public.projexa_scheduler_bridge_check_bearer(p_bearer text) returns boolean
--     compares sha256(p_bearer) with sha256 of the Vault secret 'projexa_scheduler_bridge_secret'; false on a short bearer or a
--     missing secret. Same model as public.projexa_timer_check_bearer (drizzle/0615), reading its own secret.
--   public.projexa_scheduler_bridge_due_count() returns integer
--     how many active schedules are due now. The Edge Function asks this first and calls the app only when it is above 0, so
--     an idle five-minute tick makes no request to the deployed app (288 a day otherwise).
--   cron job 'projexa-scheduler-bridge' at */5 * * * * (UTC): net.http_post to the URL in Vault 'projexa_scheduler_bridge_url'
--     with the bearer in Vault 'projexa_scheduler_bridge_secret' and body {"job":"scheduler_bridge"}. Created only when the cron
--     schema exists and no job of that name exists yet, and created INACTIVE (cron.alter_job active := false): the PM turns it
--     on at go-live, because the last hop is the deployed app and Vercel is locked until then (PMD-39). A second run of this file
--     leaves an activated job as it is. The command calls the Edge Function only, never an /api/internal route (BR-516).
--
-- ROW-LEVEL SECURITY: enabled, in the pattern of compliance.report_schedules (drizzle/0177): app_runtime_org_scoped (FOR ALL,
--   org_id = compliance.current_org_id()) and service_role_bypass_pipeline_schedules. The grants are the same: SELECT, INSERT,
--   UPDATE, DELETE to app_runtime and service_role, nothing to anon, authenticated or public. The bridge lists due schedules
--   across organisations through the plain db client (the table owner, which bypasses RLS, as every cross-organisation cron
--   route does) and runs each schedule's work inside withTenantContext for that schedule's organisation.
--
-- GRANTS ON THE FUNCTIONS: both are SECURITY DEFINER with search_path = '', revoked from public, anon and authenticated and
--   granted to service_role alone (guard query G-5 in ai-os/SHARED_BOUNDARY.md returns 0). Nothing is granted to app_runtime.
--
-- NOT IN THIS FILE: the two Vault secrets (projexa_scheduler_bridge_url, projexa_scheduler_bridge_secret) and the Edge
--   Function secrets SCHEDULER_BRIDGE_APP_URL and SCHEDULER_BRIDGE_INTERNAL_SECRET. Their values are set by the owner or the PM
--   and are never written to a file, a log or a document. Until they exist the job stays inactive and does nothing.
--
-- DATA LOSS: none. Additive: one table, two functions and one inactive cron row.
--
-- HOW IT IS APPLIED: through the Supabase MCP (apply_migration) by the PM, after the claim (ai-os/boss/ACTIVE-CLAIMS.yaml)
--   is on main and after the always-aborted rehearsal of ai-os/projexa-build-001/ROLLBACK_REHEARSALS.md (do-block generated with
--   --schemas compliance,public; its error text must begin PASS_ROLLED_BACK). Idempotent: CREATE TABLE IF NOT EXISTS, CREATE
--   INDEX IF NOT EXISTS, a policy that already exists is kept, CREATE OR REPLACE for the functions, and the cron job is created
--   only when it does not exist.
--
-- ROLLBACK: drizzle/down/0642_build001_pipeline_schedules.down.sql

BEGIN;

SET LOCAL lock_timeout = '5s';

-- 1. the table ----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS compliance.pipeline_schedules (
  id text NOT NULL DEFAULT (gen_random_uuid())::text,
  org_id text NOT NULL,
  owner_user_id text NOT NULL,
  function_id text NOT NULL,
  params jsonb NOT NULL DEFAULT '{}'::jsonb,
  cadence text NOT NULL,
  next_run_at timestamptz NOT NULL,
  last_run_at timestamptz,
  last_result jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pipeline_schedules_pkey PRIMARY KEY (id),
  CONSTRAINT pipeline_schedules_owner_user_id_fkey FOREIGN KEY (owner_user_id)
    REFERENCES compliance.users(id) ON DELETE CASCADE,
  CONSTRAINT pipeline_schedules_function_id_check CHECK (btrim(function_id) <> ''),
  CONSTRAINT pipeline_schedules_params_check CHECK (jsonb_typeof(params) = 'object'),
  CONSTRAINT pipeline_schedules_cadence_check CHECK (btrim(cadence) ~ '^\S+(\s+\S+){4}$')
);

CREATE INDEX IF NOT EXISTS idx_pipeline_schedules_due
  ON compliance.pipeline_schedules (next_run_at) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_pipeline_schedules_org_id
  ON compliance.pipeline_schedules (org_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_schedules_owner_user_id
  ON compliance.pipeline_schedules (owner_user_id);

ALTER TABLE compliance.pipeline_schedules ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.pipeline_schedules FOR ALL TO app_runtime
    USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY service_role_bypass_pipeline_schedules ON compliance.pipeline_schedules FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

REVOKE ALL ON compliance.pipeline_schedules FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.pipeline_schedules TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.pipeline_schedules TO service_role;

-- 2. bearer check ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.projexa_scheduler_bridge_check_bearer(p_bearer text)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_secret text;
BEGIN
  IF p_bearer IS NULL OR length(p_bearer) < 24 THEN
    RETURN false;
  END IF;
  SELECT s.decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets s
  WHERE s.name = 'projexa_scheduler_bridge_secret'
  ORDER BY s.created_at DESC
  LIMIT 1;
  IF v_secret IS NULL OR length(v_secret) < 24 THEN
    RETURN false;
  END IF;
  RETURN encode(sha256(convert_to(p_bearer, 'UTF8')), 'hex') = encode(sha256(convert_to(v_secret, 'UTF8')), 'hex');
END
$fn$;

REVOKE ALL ON FUNCTION public.projexa_scheduler_bridge_check_bearer(text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.projexa_scheduler_bridge_check_bearer(text) TO service_role;

-- 3. how many schedules are due now ------------------------------------------------------
CREATE OR REPLACE FUNCTION public.projexa_scheduler_bridge_due_count()
RETURNS integer
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*)::integer INTO v_count
  FROM compliance.pipeline_schedules s
  WHERE s.is_active AND s.next_run_at <= now();
  RETURN v_count;
END
$fn$;

REVOKE ALL ON FUNCTION public.projexa_scheduler_bridge_due_count() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.projexa_scheduler_bridge_due_count() TO service_role;

-- 4. the cron job, created inactive (only where pg_cron is installed) -----------------------
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'projexa-scheduler-bridge') THEN
      PERFORM cron.schedule(
        'projexa-scheduler-bridge',
        '*/5 * * * *',
        $cron$
          -- PROJEXA-BUILD-001 U-40: created inactive. The PM turns it on at go-live (the last hop is the deployed app; Vercel is locked, PMD-39).
          select net.http_post(
            url := (select decrypted_secret from vault.decrypted_secrets where name = 'projexa_scheduler_bridge_url'),
            headers := jsonb_build_object(
              'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'projexa_scheduler_bridge_secret'),
              'Content-Type', 'application/json'
            ),
            body := '{"job":"scheduler_bridge"}'::jsonb,
            timeout_milliseconds := 120000
          )
        $cron$
      );
      PERFORM cron.alter_job(
        job_id := (SELECT jobid FROM cron.job WHERE jobname = 'projexa-scheduler-bridge'),
        active := false
      );
    END IF;
  END IF;
END
$do$;

COMMIT;
