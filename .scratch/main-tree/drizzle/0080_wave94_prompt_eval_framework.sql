-- Wave 94 (Comparison CSV 3 gap analysis: AI011 "Prompt/Model Evaluation
-- Framework"). Global/platform-governed, same posture as prompt_templates/
-- prompt_versions (Wave 22) -- eval cases are authored content, not tenant
-- data, so there is no org_id anywhere here. Writes are veridian_admin-gated
-- at the service layer, not RLS-gated by org. Scoring is deterministic
-- keyword containment, never an LLM-judging-an-LLM call.

CREATE TABLE IF NOT EXISTS compliance.prompt_eval_cases (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  prompt_template_id text NOT NULL REFERENCES compliance.prompt_templates(id),
  name text NOT NULL,
  input_variables jsonb NOT NULL DEFAULT '{}',
  user_message text NOT NULL,
  expected_keywords jsonb NOT NULL DEFAULT '[]',
  created_by_id text,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.prompt_eval_runs (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  eval_case_id text NOT NULL REFERENCES compliance.prompt_eval_cases(id),
  prompt_version_id text NOT NULL REFERENCES compliance.prompt_versions(id),
  provider text NOT NULL,
  model text NOT NULL,
  rendered_prompt text NOT NULL,
  output text,
  status text NOT NULL DEFAULT 'completed',
  error_message text,
  passed boolean,
  missing_keywords jsonb NOT NULL DEFAULT '[]',
  latency_ms integer,
  prompt_tokens integer,
  completion_tokens integer,
  estimated_cost_usd numeric,
  run_by_id text NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_prompt_eval_cases_template_id ON compliance.prompt_eval_cases(prompt_template_id);
CREATE INDEX IF NOT EXISTS idx_prompt_eval_runs_eval_case_id ON compliance.prompt_eval_runs(eval_case_id);
CREATE INDEX IF NOT EXISTS idx_prompt_eval_runs_prompt_version_id ON compliance.prompt_eval_runs(prompt_version_id);

ALTER TABLE compliance.prompt_eval_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.prompt_eval_runs ENABLE ROW LEVEL SECURITY;

-- Same "app_runtime can read everything, write is app-layer gated" posture
-- as prompt_templates/prompt_versions -- there is no org dimension to scope
-- RLS on, so read access is unconditional for the authenticated app role
-- and admin-gating happens in prompt-eval-service.ts, not in a USING clause.
DO $$ BEGIN
  CREATE POLICY app_runtime_read_prompt_eval_cases ON compliance.prompt_eval_cases FOR SELECT TO app_runtime USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_prompt_eval_cases ON compliance.prompt_eval_cases FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY app_runtime_read_prompt_eval_runs ON compliance.prompt_eval_runs FOR SELECT TO app_runtime USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_prompt_eval_runs ON compliance.prompt_eval_runs FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT SELECT, INSERT ON compliance.prompt_eval_cases TO app_runtime;
GRANT SELECT, INSERT ON compliance.prompt_eval_runs TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.prompt_eval_cases, compliance.prompt_eval_runs TO service_role;
