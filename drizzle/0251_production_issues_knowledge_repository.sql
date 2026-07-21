-- Audit198 gap closure, 2026-07-21 (DOCUMENTATION category -- ARTICLE-076
-- "Every production issue shall be documented in a knowledge repository",
-- verdict NOT_YET_BUILT confirmed correct before this migration: the
-- existing compliance.incidents table is a GRC/compliance business
-- incident register (Security/Data Breach, Operational, Safety, Financial
-- -- CAPA-owner regulatory workflow), with no description/root-cause/
-- resolution field. It does not serve software/engineering production
-- issues and is a genuinely different concern, not duplicated here.
--
-- Platform-scoped (platform schema, no org_id/RLS), same reasoning as
-- platform.instruction_execution_cache (drizzle/0242): this is VERIDIAN's
-- own engineering history, not tenant business data.

DO $$ BEGIN
  CREATE TYPE platform.production_issue_severity AS ENUM ('low', 'medium', 'high', 'critical');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE platform.production_issue_status AS ENUM ('open', 'investigating', 'resolved', 'wont_fix');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS platform.production_issues (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  title text NOT NULL,
  component text,
  severity platform.production_issue_severity NOT NULL DEFAULT 'medium',
  status platform.production_issue_status NOT NULL DEFAULT 'open',
  description text NOT NULL,
  root_cause text,
  resolution text,
  prevention_action text,
  related_pr text,
  tags jsonb NOT NULL DEFAULT '[]',
  reported_by text,
  discovered_at timestamp NOT NULL DEFAULT now(),
  resolved_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS production_issues_status_idx ON platform.production_issues (status);
CREATE INDEX IF NOT EXISTS production_issues_severity_idx ON platform.production_issues (severity);
