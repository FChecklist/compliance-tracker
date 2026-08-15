-- VERIDIAN Review Framework gap-closure: Business Rules Engine / Rule
-- Lifecycle Management (task-20260718-080006), 2026-08-15.
--
-- New, additive-only module -- does not touch any existing table. See
-- schema.ts's "Wave 173" header comment for the full design rationale
-- (condition-tree engine modeled on approvalWorkflowStepDefinitions'
-- conditionField/Operator/Value precedent, append-only version history for
-- rollback, dry-run test log with no auto-execution).

-- ─── Enums ─────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE compliance.business_rule_status AS ENUM ('draft', 'active', 'deprecated', 'archived');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE compliance.business_rule_operator AS ENUM ('eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains', 'not_contains', 'is_empty', 'is_not_empty');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── Tables ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS compliance.business_rules (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL,
  module_key text NOT NULL,
  name text NOT NULL,
  description text,
  status compliance.business_rule_status NOT NULL DEFAULT 'draft',
  current_version integer NOT NULL DEFAULT 1,
  condition_tree jsonb NOT NULL,
  action jsonb NOT NULL,
  created_by_id text,
  updated_by_id text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  activated_at timestamp,
  deprecated_at timestamp,
  archived_at timestamp
);

CREATE TABLE IF NOT EXISTS compliance.business_rule_versions (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL,
  rule_id text NOT NULL,
  version integer NOT NULL,
  name text NOT NULL,
  condition_tree jsonb NOT NULL,
  action jsonb NOT NULL,
  change_note text,
  created_by_id text,
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT business_rule_versions_rule_version_unique UNIQUE (rule_id, version)
);

CREATE TABLE IF NOT EXISTS compliance.business_rule_test_runs (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL,
  rule_id text NOT NULL,
  version integer NOT NULL,
  sample_record jsonb NOT NULL,
  matched boolean NOT NULL,
  action_preview jsonb,
  error_message text,
  created_by_id text,
  created_at timestamp NOT NULL DEFAULT now()
);

-- ─── Indexes ───────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_business_rules_org_id ON compliance.business_rules(org_id);
CREATE INDEX IF NOT EXISTS idx_business_rules_org_module ON compliance.business_rules(org_id, module_key);
CREATE INDEX IF NOT EXISTS idx_business_rules_org_status ON compliance.business_rules(org_id, status);
CREATE INDEX IF NOT EXISTS idx_business_rule_versions_org_id ON compliance.business_rule_versions(org_id);
CREATE INDEX IF NOT EXISTS idx_business_rule_versions_rule_id ON compliance.business_rule_versions(rule_id);
CREATE INDEX IF NOT EXISTS idx_business_rule_test_runs_org_id ON compliance.business_rule_test_runs(org_id);
CREATE INDEX IF NOT EXISTS idx_business_rule_test_runs_rule_id ON compliance.business_rule_test_runs(rule_id);

-- ─── RLS: FORCE ROW LEVEL SECURITY from the start (matches this schema's
-- established org-scoped posture, e.g. 0222's training_* tables). ────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'business_rules', 'business_rule_versions', 'business_rule_test_runs'
  ] LOOP
    EXECUTE format('ALTER TABLE compliance.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE compliance.%I FORCE ROW LEVEL SECURITY', t);
    BEGIN
      EXECUTE format('CREATE POLICY app_runtime_org_scoped ON compliance.%I FOR ALL TO app_runtime USING (org_id = compliance.current_org_id())', t);
    EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN
      EXECUTE format('CREATE POLICY service_role_bypass_%s ON compliance.%I FOR ALL TO service_role USING (true)', t, t);
    EXCEPTION WHEN duplicate_object THEN NULL; END;
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.%I TO app_runtime', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.%I TO service_role', t);
  END LOOP;
END $$;
