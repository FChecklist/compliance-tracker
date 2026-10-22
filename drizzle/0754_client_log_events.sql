-- PRE-APPROVED-LIVE-DDL: Owner request in chat on 2026-10-20 ("automatic error and action log" for PROJEXA: every error in real use captured with a
--   complete report, every project and action monitored from start to end, the user's own device does the capturing, our server only stores rows).
-- WHAT: two new tables.
--   compliance.client_log_events        append-only: one row per error or user action sent up by the browser (breadcrumbs, device context, request id ...).
--   compliance.client_error_issues      one grouped row per organisation + fingerprint: how often, where, first/last seen, and (written back later by the
--                                       owner's AI session) what was fixed, in which files, in which commit. A fixed issue that happens again becomes 'reopened'.
-- ADDITIVE ONLY: CREATE TABLE / INDEX IF NOT EXISTS, RLS and policies. No existing table or row is touched. DATA LOSS: none.
-- IDEMPOTENT: IF NOT EXISTS / duplicate_object guards. Same RLS shape as drizzle/0746 (app_runtime tenant isolation + service_role bypass).
-- HOW IT IS APPLIED: by the PM through the Supabase MCP after the pull request is green.
-- ROLLBACK: drizzle/down/0754_client_log_events.down.sql
BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS compliance.client_log_events (
  id text PRIMARY KEY,
  org_id text NOT NULL,
  user_id text,
  project_id text,
  session_id text,
  kind text NOT NULL CHECK (kind IN ('error', 'unhandled_rejection', 'render_error', 'api_failure', 'action')),
  severity text NOT NULL DEFAULT 'error' CHECK (severity IN ('error', 'warning', 'info')),
  fingerprint text,
  message text,
  stack text,
  route text,
  api_path text,
  http_method text,
  http_status integer,
  request_id text,
  duration_ms integer,
  action_name text,
  outcome text CHECK (outcome IS NULL OR outcome IN ('ok', 'failed')),
  breadcrumbs jsonb,
  context jsonb,
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS client_log_events_org_time_idx ON compliance.client_log_events (org_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS client_log_events_org_project_time_idx ON compliance.client_log_events (org_id, project_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS client_log_events_org_fingerprint_idx ON compliance.client_log_events (org_id, fingerprint);

CREATE TABLE IF NOT EXISTS compliance.client_error_issues (
  id text PRIMARY KEY,
  org_id text NOT NULL,
  fingerprint text NOT NULL,
  title text,
  first_seen_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  occurrences integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'fixed', 'reopened', 'ignored')),
  severity text NOT NULL DEFAULT 'error',
  sample_event_id text,
  project_ids text[] NOT NULL DEFAULT '{}',
  routes text[] NOT NULL DEFAULT '{}',
  fix_summary text,
  fix_files jsonb,
  fix_commit text,
  fixed_at timestamptz,
  fixed_by text,
  reopened_count integer NOT NULL DEFAULT 0,
  CONSTRAINT client_error_issues_org_fingerprint_unique UNIQUE (org_id, fingerprint)
);
CREATE INDEX IF NOT EXISTS client_error_issues_org_status_idx ON compliance.client_error_issues (org_id, status, last_seen_at DESC);

ALTER TABLE compliance.client_log_events ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN CREATE POLICY app_runtime_tenant_isolation ON compliance.client_log_events FOR ALL TO app_runtime USING (org_id = compliance.current_org_id()); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY service_role_bypass_client_log_events ON compliance.client_log_events FOR ALL TO service_role USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE compliance.client_error_issues ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN CREATE POLICY app_runtime_tenant_isolation ON compliance.client_error_issues FOR ALL TO app_runtime USING (org_id = compliance.current_org_id()); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY service_role_bypass_client_error_issues ON compliance.client_error_issues FOR ALL TO service_role USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;


COMMIT;