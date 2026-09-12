-- R85 Addendum 3 v4, Phase 10 -- THE WHAT-IF / SCENARIO ENGINE (spec Part F,
-- gates 10-01..10-13). Work order: Google Drive
-- WORK_ORDER_R85_ADDENDUM_3_v4_R50_FINAL.md, Part F. Additive: one new table
-- + one new enum, no changes to any existing table.
--
-- NOT yet applied live against pcrjmlpuqsbocqfwoxod as of this commit --
-- unlike drizzle/0593/0594/0595's own headers, which record a live
-- Supabase-MCP apply, this worktree had no DATABASE_URL/Supabase credentials
-- configured, so this migration could only be hand-authored and reviewed,
-- never actually run against the live database. Whoever merges this PR (or
-- runs the next live-migration pass) must apply it via the Supabase MCP
-- (or `bun run db:migrate`) before boq-scenario-service.ts's routes can
-- serve real traffic -- every unit test in boq-scenario-service.test.ts
-- mocks the DB layer (this codebase's established pattern for a table that
-- does not exist in a developer's own environment either, see
-- boq-baseline-service.test.ts's identical approach) and therefore does not
-- itself prove this table exists live.
--
-- 10-01: "A scenario is a NON-DESTRUCTIVE scratch layer. A first-class
-- record: name, author, created_at, base baseline version, adjustment
-- list." ONE ROW PER SCENARIO (adjustments is a JSONB array), matching this
-- phase's own boq_baseline precedent (drizzle/0594) rather than a
-- normalized child table -- the work order's own 10-01 only requires "an
-- adjustment list", not per-adjustment rows.
--
-- 10-08 ("NOTHING IS WRITTEN UNTIL COMMIT"): this table's own rows are the
-- ONLY thing boq-scenario-service.ts writes before commitScenario() runs --
-- it never touches construction_boqs or construction_boq_line_items until
-- that explicit act. See boq-scenario-service.ts's own header for exactly
-- what commitScenario() writes.
--
-- No explicit app_runtime/service_role GRANT needed for SELECT/INSERT/
-- UPDATE: drizzle/0010's ALTER DEFAULT PRIVILEGES IN SCHEMA compliance
-- already covers every future table in this schema (see drizzle/0512/0594's
-- identical note). UPDATE is deliberately NOT revoked here (unlike
-- boq_baseline) -- a DRAFT scenario's adjustments legitimately change right
-- up until commit; boq-scenario-service.ts itself is what refuses further
-- mutation of an already-committed scenario (status = 'committed'), the
-- same "service-layer, not DB-layer, immutability" shape already used
-- elsewhere in this codebase for entities where mutability genuinely
-- depends on a status column (e.g. construction_boqs itself).

DO $$ BEGIN
  CREATE TYPE compliance.boq_scenario_status AS ENUM ('draft', 'committed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS compliance.boq_scenario (
  id text PRIMARY KEY,
  org_id text NOT NULL,
  boq_id text NOT NULL REFERENCES compliance.construction_boqs(id),
  project_id text NOT NULL,
  base_baseline_version integer,
  name text NOT NULL,
  author_id text NOT NULL,
  status compliance.boq_scenario_status NOT NULL DEFAULT 'draft',
  adjustments jsonb NOT NULL DEFAULT '[]',
  committed_at timestamptz,
  committed_by_id text,
  committed_revision_boq_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_boq_scenario_org_id ON compliance.boq_scenario(org_id);
CREATE INDEX IF NOT EXISTS idx_boq_scenario_boq_id ON compliance.boq_scenario(boq_id);
CREATE INDEX IF NOT EXISTS idx_boq_scenario_project_id ON compliance.boq_scenario(project_id);

ALTER TABLE compliance.boq_scenario ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.boq_scenario
    FOR ALL TO app_runtime
    USING (org_id = compliance.current_org_id())
    WITH CHECK (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY service_role_bypass_boq_scenario ON compliance.boq_scenario
    FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
