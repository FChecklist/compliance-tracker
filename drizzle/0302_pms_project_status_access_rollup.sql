-- Task #47 (PM feature-parity gap analysis): close the real projects-table
-- gaps -- status, Private/Public access, a deterministic rollup percentage,
-- and admin-defined custom tabs. Confirmed by reading schema.ts directly
-- (not assumed) that the `projects` table (Wave 25's 7 additive PM columns,
-- 0021/0022) has none of these 4 today -- issuePrefix/issueSequence/
-- leadUserId/startDate/targetDate/healthStatus/parentProjectId only.
--
-- Hand-written, NOT drizzle-kit's raw `generate` output -- drizzle/meta/ is
-- missing every per-migration snapshot between 0001 and 0264 (see 0267's own
-- header), so `drizzle-kit generate` cannot diff schema.ts against an
-- accurate baseline. Mirrors 0268_pms_time_entry_approval_flow.sql's own
-- enum + ADD COLUMN IF NOT EXISTS style.
--
-- accessLevel defaults to 'public' so every pre-existing project's read
-- behavior is unchanged until an admin explicitly flips it -- see
-- product-service.ts's canReadProject() for the real enforcement.
-- rollupPercentage defaults to 0 and is written by pms-issue-service.ts's
-- recalculateProjectRollup() on issue create/update, never computed ad hoc
-- at read time (see that file's header for why this differs from
-- construction-dashboard-service.ts's query-time-only progressPercent).

DO $$ BEGIN
  CREATE TYPE compliance.pms_project_status AS ENUM ('planning', 'active', 'paused', 'completed', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE compliance.pms_project_access AS ENUM ('private', 'public');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE compliance.projects ADD COLUMN IF NOT EXISTS status compliance.pms_project_status NOT NULL DEFAULT 'active';
ALTER TABLE compliance.projects ADD COLUMN IF NOT EXISTS access_level compliance.pms_project_access NOT NULL DEFAULT 'public';
ALTER TABLE compliance.projects ADD COLUMN IF NOT EXISTS rollup_percentage integer NOT NULL DEFAULT 0;
ALTER TABLE compliance.projects ADD COLUMN IF NOT EXISTS custom_tabs jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS projects_access_level_idx ON compliance.projects (org_id, access_level);
