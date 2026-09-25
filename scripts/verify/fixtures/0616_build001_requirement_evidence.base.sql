-- Base snapshot for the PGlite rollback replay (BR-207). Generated 2026-09-25T11:47:48Z by:
--   node scripts/verify/gen-base-snapshot.mjs --tables platform.sumeet_requirements
-- Schema only, read from the live catalog (pcrjmlpuqsbocqfwoxod). Regenerate with the same command; do not edit by hand
-- except to add an object the generator leaves out (see the generator's header).
SET check_function_bodies = off;
CREATE SCHEMA IF NOT EXISTS platform;
CREATE TABLE platform.sumeet_requirements (
  id text NOT NULL,
  sort_order integer NOT NULL,
  area text,
  requirement text,
  source text,
  status text,
  built text,
  verified_in_db text,
  tested_in_live_ui text,
  route text,
  file_path text,
  evidence text,
  github_pr text,
  vercel text,
  next_action text,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_by text DEFAULT 'claude-chat'::text,
  closure_state text,
  closure_test_path text,
  closure_test_run_at timestamp with time zone,
  closure_commit_sha text,
  closure_repo text,
  closure_ci_run_id text
);
ALTER TABLE platform.sumeet_requirements ADD CONSTRAINT sumeet_requirements_pkey PRIMARY KEY (id);
ALTER TABLE platform.sumeet_requirements ADD CONSTRAINT sumeet_requirements_closure_repo_check CHECK (((closure_repo IS NULL) OR (closure_repo = ANY (ARRAY['compliance-tracker'::text, 'projexa'::text]))));
ALTER TABLE platform.sumeet_requirements ADD CONSTRAINT sumeet_requirements_closure_state_check CHECK ((closure_state = ANY (ARRAY['CLOSED'::text, 'OPEN'::text, 'BLOCKED'::text, 'NOT_TESTABLE'::text])));
ALTER TABLE platform.sumeet_requirements ENABLE ROW LEVEL SECURITY;
CREATE POLICY service_role_bypass_sumeet_requirements ON platform.sumeet_requirements AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT DELETE ON TABLE platform.sumeet_requirements TO app_runtime;
GRANT INSERT ON TABLE platform.sumeet_requirements TO app_runtime;
GRANT SELECT ON TABLE platform.sumeet_requirements TO app_runtime;
GRANT UPDATE ON TABLE platform.sumeet_requirements TO app_runtime;
GRANT DELETE ON TABLE platform.sumeet_requirements TO service_role;
GRANT INSERT ON TABLE platform.sumeet_requirements TO service_role;
GRANT SELECT ON TABLE platform.sumeet_requirements TO service_role;
GRANT UPDATE ON TABLE platform.sumeet_requirements TO service_role;
RESET check_function_bodies;
