-- PROJEXA-BUILD-001 U-46 step 1 (database), migration 3 of 8 (register rows BR-485, BR-487; spec sections 10.5 and 10.10, audit A-12):
-- the call log of the Universal AI Work Link. One append-only row per HTTP call, range-partitioned by calendar month so that
-- retention (migration 7) drops whole partitions and never deletes a row.
--
-- WHAT
--   platform.ai_work_link_call            PARTITION BY RANGE (called_at). PRIMARY KEY (id, called_at): the key carries the partition key.
--                                         link_id is NULL for a call with an unknown token (that is what the unknown-token throttle
--                                         counts). ip_prefix holds only the /24 or /48 prefix, never a full address.
--   public.ai_work_link_call_guard()    the trigger function, and the trigger of the same name on the table (register row BR-485):
--                                         no DELETE, ever; an UPDATE may only fill status, bytes and finished_at of a row whose status
--                                         is still NULL, once. Every other column is frozen. Because the trigger is a row trigger on
--                                         the partitioned table, Postgres copies it to every partition, including those made later.
--   public.ai_work_link__create_call_partition(p_month date)
--                                         creates the partition platform.ai_work_link_call_YYYY_MM for that calendar month (UTC bounds)
--                                         when it is missing, with RLS on and forced and every grant revoked (a new table in schema
--                                         platform would otherwise receive read and write for app_runtime and service_role). Returns
--                                         the partition name. Owner only: nobody else may execute it.
--   this file also creates the partitions of the current month and the next two months, so the log never depends on a job having
--   run. The retention job of migration 7 keeps creating them ahead.
--
-- THE LOG FAILS CLOSED: the function that writes a row (migration 4, ai_work_link_log_call) lets any error reach the caller, and the
--   Edge Function then refuses the request with 503 (spec section 10.5). A month without a partition is such an error, which is why
--   the partitions above are made ahead of time.
--
-- GRANTS: RLS on and forced with no policy, and revoked from everyone including app_runtime and service_role. The log is reached only
--   through the SECURITY DEFINER functions of migration 4. Nobody but the table's owner can update, delete, truncate or drop a
--   partition: the only code that drops one is the retention function, running as postgres. Nothing is granted to anon,
--   authenticated or PUBLIC.
--
-- TIMESTAMPS: timestamptz only (register row BR-487).
--
-- DATA LOSS: none. Additive: one partitioned table with three partitions, one trigger function, one trigger, one owner-only helper.
--
-- HOW IT IS APPLIED: through the Supabase MCP by the PM after the claim (ACTIVE-CLAIMS, 2026-09-25) is on main and the
--   always-aborted rehearsal passed. The schema hash of the rehearsal does not cover triggers (ROLLBACK_REHEARSALS.md, Limits), so
--   the PGlite test of this file is the proof of the guard. Idempotent: create if not exists, create or replace, and the guard
--   trigger is dropped and created again.
--
-- ROLLBACK: drizzle/down/0623_build001_awl_call_log.down.sql

BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS platform.ai_work_link_call (
  id text NOT NULL DEFAULT replace(gen_random_uuid()::text, '-', ''),
  link_id text,
  org_id text,
  method text NOT NULL,
  path text NOT NULL,
  ip_prefix text,
  ua_family text,
  status integer,
  bytes integer,
  called_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  CONSTRAINT ai_work_link_call_pkey PRIMARY KEY (id, called_at),
  CONSTRAINT ai_work_link_call_link_fk FOREIGN KEY (link_id) REFERENCES platform.user_ai_links (id)
) PARTITION BY RANGE (called_at);

-- the per-link rate window and the history read
CREATE INDEX IF NOT EXISTS ai_work_link_call_link_called_idx
  ON platform.ai_work_link_call (link_id, called_at DESC);

-- the unknown-token throttle counts rows with link_id IS NULL per address prefix
CREATE INDEX IF NOT EXISTS ai_work_link_call_ip_called_idx
  ON platform.ai_work_link_call (ip_prefix, called_at DESC)
  WHERE link_id IS NULL;

-- 1. the append-only guard -----------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ai_work_link_call_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'platform.ai_work_link_call is append-only' USING ERRCODE = '42501';
  END IF;
  IF OLD.status IS NOT NULL
     OR NEW.status IS NULL
     OR NEW.id IS DISTINCT FROM OLD.id
     OR NEW.link_id IS DISTINCT FROM OLD.link_id
     OR NEW.org_id IS DISTINCT FROM OLD.org_id
     OR NEW.method IS DISTINCT FROM OLD.method
     OR NEW.path IS DISTINCT FROM OLD.path
     OR NEW.ip_prefix IS DISTINCT FROM OLD.ip_prefix
     OR NEW.ua_family IS DISTINCT FROM OLD.ua_family
     OR NEW.called_at IS DISTINCT FROM OLD.called_at THEN
    RAISE EXCEPTION 'platform.ai_work_link_call is append-only: only a pending row''s status, bytes and finished_at may be set, once'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$fn$;

REVOKE ALL ON FUNCTION public.ai_work_link_call_guard() FROM PUBLIC, anon, authenticated, app_runtime, service_role;

DROP TRIGGER IF EXISTS ai_work_link_call_guard ON platform.ai_work_link_call;
CREATE TRIGGER ai_work_link_call_guard
  BEFORE UPDATE OR DELETE ON platform.ai_work_link_call
  FOR EACH ROW EXECUTE FUNCTION public.ai_work_link_call_guard();

-- 2. partitions ------------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ai_work_link__create_call_partition(p_month date)
RETURNS text
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_from timestamptz := (date_trunc('month', p_month::timestamp)) AT TIME ZONE 'UTC';
  v_to timestamptz := (date_trunc('month', p_month::timestamp) + interval '1 month') AT TIME ZONE 'UTC';
  v_name text := 'ai_work_link_call_' || to_char(p_month, 'YYYY_MM');
BEGIN
  IF p_month IS NULL THEN
    RAISE EXCEPTION 'ai_work_link__create_call_partition: p_month is required';
  END IF;
  IF to_regclass(format('platform.%I', v_name)) IS NULL THEN
    EXECUTE format('CREATE TABLE platform.%I PARTITION OF platform.ai_work_link_call FOR VALUES FROM (%L) TO (%L)', v_name, v_from, v_to);
    EXECUTE format('ALTER TABLE platform.%I ENABLE ROW LEVEL SECURITY', v_name);
    EXECUTE format('ALTER TABLE platform.%I FORCE ROW LEVEL SECURITY', v_name);
    EXECUTE format('REVOKE ALL ON TABLE platform.%I FROM PUBLIC, anon, authenticated, app_runtime, service_role', v_name);
  END IF;
  RETURN v_name;
END
$fn$;

REVOKE ALL ON FUNCTION public.ai_work_link__create_call_partition(date) FROM PUBLIC, anon, authenticated, app_runtime, service_role;

-- the current month and the next two, in UTC
SELECT public.ai_work_link__create_call_partition(m::date)
FROM generate_series(
  date_trunc('month', now() AT TIME ZONE 'UTC'),
  date_trunc('month', now() AT TIME ZONE 'UTC') + interval '2 months',
  interval '1 month'
) AS m;

-- 3. access: nobody but the owner and the SECURITY DEFINER functions ---------------------------------------------------------------------
ALTER TABLE platform.ai_work_link_call ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.ai_work_link_call FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE platform.ai_work_link_call FROM PUBLIC, anon, authenticated, app_runtime, service_role;

COMMIT;
