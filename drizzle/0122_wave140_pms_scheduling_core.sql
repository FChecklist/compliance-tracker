-- Wave 140: PROJEXA gap analysis -- Gantt/critical-path/baseline/
-- resource-leveling parity with Asana/Monday/MS Project. Pure additive
-- layer over the existing pms_issues + pms_issue_relations graph.

CREATE TABLE IF NOT EXISTS compliance.pms_schedule_baselines (
  id text PRIMARY KEY,
  org_id text NOT NULL,
  project_id text NOT NULL,
  name text NOT NULL,
  captured_by_id text,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.pms_baseline_issue_snapshots (
  id text PRIMARY KEY,
  baseline_id text NOT NULL REFERENCES compliance.pms_schedule_baselines(id) ON DELETE CASCADE,
  issue_id text NOT NULL,
  baseline_start_date date,
  baseline_due_date date,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.pms_resource_allocations (
  id text PRIMARY KEY,
  org_id text NOT NULL,
  project_id text NOT NULL,
  user_id text NOT NULL,
  issue_id text,
  allocated_hours_per_day numeric NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pms_schedule_baselines_org_project ON compliance.pms_schedule_baselines(org_id, project_id);
CREATE INDEX IF NOT EXISTS idx_pms_baseline_issue_snapshots_baseline ON compliance.pms_baseline_issue_snapshots(baseline_id);
CREATE INDEX IF NOT EXISTS idx_pms_baseline_issue_snapshots_issue ON compliance.pms_baseline_issue_snapshots(issue_id);
CREATE INDEX IF NOT EXISTS idx_pms_resource_allocations_org_project ON compliance.pms_resource_allocations(org_id, project_id);
CREATE INDEX IF NOT EXISTS idx_pms_resource_allocations_user ON compliance.pms_resource_allocations(user_id);

ALTER TABLE compliance.pms_schedule_baselines ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.pms_baseline_issue_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.pms_resource_allocations ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.pms_schedule_baselines FOR ALL TO app_runtime
    USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.pms_baseline_issue_snapshots FOR ALL TO app_runtime
    USING (EXISTS (SELECT 1 FROM compliance.pms_schedule_baselines b WHERE b.id = pms_baseline_issue_snapshots.baseline_id AND b.org_id = compliance.current_org_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.pms_resource_allocations FOR ALL TO app_runtime
    USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
