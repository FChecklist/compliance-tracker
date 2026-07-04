-- Wave 50 (VERI ERP gap-fill, Tier 1): Accounting Periods + shared Approval
-- Workflow Engine, per ERP_BENCHMARK_COMPARISON.md Section 10 priority
-- ranking (#3 and #1 respectively). Periods close the "nothing stops
-- posting into a closed year" gap the financial-report service layer
-- needs to be safe; the workflow engine generalizes the two existing
-- non-reusable approval implementations (approvalRequests single-step,
-- pmsWorkflowTransitions PMS-only) into one entity-agnostic engine.

DO $$ BEGIN
  CREATE TYPE compliance.erp_period_status AS ENUM ('open', 'closed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE compliance.approval_workflow_instance_status AS ENUM ('pending', 'approved', 'rejected', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE compliance.approval_workflow_step_status AS ENUM ('pending', 'approved', 'rejected', 'skipped');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE compliance.approval_workflow_condition_operator AS ENUM ('gt', 'gte', 'lt', 'lte', 'eq');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- Accounting Periods
-- ============================================================
CREATE TABLE IF NOT EXISTS compliance.erp_accounting_periods (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  fiscal_year_id text NOT NULL REFERENCES compliance.erp_fiscal_years(id),
  period_name text NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  status compliance.erp_period_status NOT NULL DEFAULT 'open',
  closed_by_id text REFERENCES compliance.users(id),
  closed_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  UNIQUE(fiscal_year_id, start_date)
);

-- ============================================================
-- Approval Workflow Engine
-- ============================================================
CREATE TABLE IF NOT EXISTS compliance.approval_workflow_definitions (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  entity_type text NOT NULL,
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_by_id text REFERENCES compliance.users(id),
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.approval_workflow_step_definitions (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  workflow_definition_id text NOT NULL REFERENCES compliance.approval_workflow_definitions(id) ON DELETE CASCADE,
  step_order integer NOT NULL,
  name text NOT NULL,
  approver_role text NOT NULL,
  required_approvals integer NOT NULL DEFAULT 1,
  condition_field text,
  condition_operator compliance.approval_workflow_condition_operator,
  condition_value numeric
);

CREATE TABLE IF NOT EXISTS compliance.approval_workflow_instances (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  workflow_definition_id text NOT NULL REFERENCES compliance.approval_workflow_definitions(id),
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  status compliance.approval_workflow_instance_status NOT NULL DEFAULT 'pending',
  created_by_id text REFERENCES compliance.users(id),
  created_at timestamp NOT NULL DEFAULT now(),
  completed_at timestamp
);

CREATE TABLE IF NOT EXISTS compliance.approval_workflow_step_instances (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  workflow_instance_id text NOT NULL REFERENCES compliance.approval_workflow_instances(id) ON DELETE CASCADE,
  step_definition_id text NOT NULL REFERENCES compliance.approval_workflow_step_definitions(id),
  step_order integer NOT NULL,
  approver_role text NOT NULL,
  required_approvals integer NOT NULL DEFAULT 1,
  approvals_received integer NOT NULL DEFAULT 0,
  status compliance.approval_workflow_step_status NOT NULL DEFAULT 'pending',
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.approval_workflow_step_approvals (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  step_instance_id text NOT NULL REFERENCES compliance.approval_workflow_step_instances(id) ON DELETE CASCADE,
  approved_by_id text NOT NULL REFERENCES compliance.users(id),
  decision text NOT NULL,
  comment text,
  created_at timestamp NOT NULL DEFAULT now()
);

-- ============================================================
-- RLS
-- ============================================================
DO $$
DECLARE
  t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'erp_accounting_periods',
    'approval_workflow_definitions', 'approval_workflow_step_definitions',
    'approval_workflow_instances', 'approval_workflow_step_instances', 'approval_workflow_step_approvals'
  ])
  LOOP
    EXECUTE format('ALTER TABLE compliance.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.erp_accounting_periods FOR ALL TO app_runtime USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.approval_workflow_definitions FOR ALL TO app_runtime USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.approval_workflow_step_definitions FOR ALL TO app_runtime
    USING (EXISTS (SELECT 1 FROM compliance.approval_workflow_definitions d WHERE d.id = approval_workflow_step_definitions.workflow_definition_id AND d.org_id = compliance.current_org_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.approval_workflow_instances FOR ALL TO app_runtime USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.approval_workflow_step_instances FOR ALL TO app_runtime
    USING (EXISTS (SELECT 1 FROM compliance.approval_workflow_instances i WHERE i.id = approval_workflow_step_instances.workflow_instance_id AND i.org_id = compliance.current_org_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.approval_workflow_step_approvals FOR ALL TO app_runtime
    USING (EXISTS (
      SELECT 1 FROM compliance.approval_workflow_step_instances si
      JOIN compliance.approval_workflow_instances i ON i.id = si.workflow_instance_id
      WHERE si.id = approval_workflow_step_approvals.step_instance_id AND i.org_id = compliance.current_org_id()
    ));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
DECLARE
  t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'erp_accounting_periods',
    'approval_workflow_definitions', 'approval_workflow_step_definitions',
    'approval_workflow_instances', 'approval_workflow_step_instances', 'approval_workflow_step_approvals'
  ])
  LOOP
    EXECUTE format('CREATE POLICY service_role_bypass_%I ON compliance.%I FOR ALL TO service_role USING (true)', t, t);
  END LOOP;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  compliance.erp_accounting_periods,
  compliance.approval_workflow_definitions, compliance.approval_workflow_step_definitions,
  compliance.approval_workflow_instances, compliance.approval_workflow_step_instances, compliance.approval_workflow_step_approvals
  TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  compliance.erp_accounting_periods,
  compliance.approval_workflow_definitions, compliance.approval_workflow_step_definitions,
  compliance.approval_workflow_instances, compliance.approval_workflow_step_instances, compliance.approval_workflow_step_approvals
  TO service_role;

-- ============================================================
-- Covering indexes
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_erp_accounting_periods_org_id ON compliance.erp_accounting_periods(org_id);
CREATE INDEX IF NOT EXISTS idx_erp_accounting_periods_fiscal_year_id ON compliance.erp_accounting_periods(fiscal_year_id);
CREATE INDEX IF NOT EXISTS idx_erp_accounting_periods_closed_by_id ON compliance.erp_accounting_periods(closed_by_id);
CREATE INDEX IF NOT EXISTS idx_erp_accounting_periods_dates ON compliance.erp_accounting_periods(org_id, start_date, end_date);

CREATE INDEX IF NOT EXISTS idx_awf_definitions_org_id ON compliance.approval_workflow_definitions(org_id);
CREATE INDEX IF NOT EXISTS idx_awf_definitions_created_by_id ON compliance.approval_workflow_definitions(created_by_id);
CREATE INDEX IF NOT EXISTS idx_awf_definitions_entity_type ON compliance.approval_workflow_definitions(org_id, entity_type, is_active);
CREATE INDEX IF NOT EXISTS idx_awf_step_definitions_workflow_definition_id ON compliance.approval_workflow_step_definitions(workflow_definition_id);
CREATE INDEX IF NOT EXISTS idx_awf_instances_org_id ON compliance.approval_workflow_instances(org_id);
CREATE INDEX IF NOT EXISTS idx_awf_instances_workflow_definition_id ON compliance.approval_workflow_instances(workflow_definition_id);
CREATE INDEX IF NOT EXISTS idx_awf_instances_created_by_id ON compliance.approval_workflow_instances(created_by_id);
CREATE INDEX IF NOT EXISTS idx_awf_instances_entity ON compliance.approval_workflow_instances(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_awf_step_instances_workflow_instance_id ON compliance.approval_workflow_step_instances(workflow_instance_id);
CREATE INDEX IF NOT EXISTS idx_awf_step_instances_step_definition_id ON compliance.approval_workflow_step_instances(step_definition_id);
CREATE INDEX IF NOT EXISTS idx_awf_step_approvals_step_instance_id ON compliance.approval_workflow_step_approvals(step_instance_id);
CREATE INDEX IF NOT EXISTS idx_awf_step_approvals_approved_by_id ON compliance.approval_workflow_step_approvals(approved_by_id);

-- ============================================================
-- Module Registry seed
-- ============================================================
INSERT INTO compliance.module_registry (module_key, display_name, table_name, domain, category, is_core, description) VALUES
  ('erp_accounting_periods', 'Accounting Periods', 'erp_accounting_periods', 'erp', 'Accounting', false, 'Monthly period open/close locking for safe posting'),
  ('approval_workflows', 'Approval Workflows', 'approval_workflow_definitions', 'platform', 'Governance', false, 'Shared, entity-agnostic multi-step approval engine')
ON CONFLICT (module_key) DO NOTHING;

INSERT INTO compliance.product_branch_modules (product_branch_id, module_key, is_enabled)
SELECT pb.id, mr.module_key, true
FROM compliance.product_branches pb, compliance.module_registry mr
WHERE pb.branch_key = 'erp' AND mr.module_key = 'erp_accounting_periods'
ON CONFLICT (product_branch_id, module_key) DO NOTHING;
