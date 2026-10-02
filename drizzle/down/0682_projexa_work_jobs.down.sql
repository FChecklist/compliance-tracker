-- PRE-APPROVED-LIVE-DDL: Owner (Rajat Agarwal) directive of 2026-10-01/02 in a live Claude Code session (work offload to an online laptop; "complete this 100%"); this is the rollback of the work-offload queue migration of that work.
-- Down-migration for drizzle/0682_projexa_work_jobs.sql. Run deliberately by the PM, not by any script.
-- DATA LOSS: the job queue and its history (who asked for what, who ran it, the results). No business table is touched. Open jobs are simply lost; laptops run their own work locally.
BEGIN;

SET LOCAL lock_timeout = '5s';

DROP FUNCTION IF EXISTS public.projexa_job_get(text, text, text);
DROP FUNCTION IF EXISTS public.projexa_job_result(text, text, text, text, boolean, jsonb, text);
DROP FUNCTION IF EXISTS public.projexa_job_heartbeat(text, text, text, text);
DROP FUNCTION IF EXISTS public.projexa_job_claim(text, text, text, text[], integer);
DROP FUNCTION IF EXISTS public.projexa_job_enqueue(text, text, text, text, jsonb, text);
DROP TABLE IF EXISTS platform.projexa_work_job;

COMMIT;
