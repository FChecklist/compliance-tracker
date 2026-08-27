-- R42 seq15 follow-up: a real bug found via live production verification.
-- analyse.ts's cross-org discovery query ran through lib/db/index.ts's "db"
-- client, documented elsewhere as "the raw (RLS-bypassing) db client
-- deliberately" -- but a live diagnostic (runtime logs, current_user)
-- proved DATABASE_URL in this environment actually authenticates as
-- app_runtime, which does NOT bypass RLS. Every cross-org query through it
-- silently returned zero rows (indistinguishable from "no gap_log activity"
-- without checking runtime logs) -- verified live: 3 real gap_log rows
-- existed, orgsProcessed was still 0.
--
-- Fix: a SECURITY DEFINER function (owned by postgres, which DOES bypass
-- RLS per pg_roles.rolbypassrls, verified live) narrowly scoped to exactly
-- the one cross-org read this job needs -- not a blanket RLS bypass grant
-- to app_runtime, which would defeat tenant isolation for every other query
-- that role runs.
CREATE OR REPLACE FUNCTION compliance.gap_log_orgs_with_recent_activity()
RETURNS TABLE(org_id text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = compliance, pg_temp
AS $$
  SELECT DISTINCT gap_log.org_id FROM compliance.gap_log WHERE created_at >= now() - interval '24 hours';
$$;

GRANT EXECUTE ON FUNCTION compliance.gap_log_orgs_with_recent_activity() TO app_runtime;
