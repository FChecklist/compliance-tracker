-- VERIDIAN Computational Engine Library (VCEL). Platform-owned catalog
-- (no org_id -- these are engine DEFINITIONS, not tenant data), same
-- posture as prompt_templates/orchestra_layers/product_branches. See
-- schema.ts's computationEngines comment for the full rationale.

CREATE TABLE IF NOT EXISTS compliance.computation_engines (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  engine_key text NOT NULL UNIQUE,
  name text NOT NULL,
  category text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'not_started',
  implementation_ref text,
  open_source_ref text,
  input_schema jsonb NOT NULL DEFAULT '{}',
  output_schema jsonb NOT NULL DEFAULT '{}',
  notes text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_computation_engines_category ON compliance.computation_engines(category);
CREATE INDEX IF NOT EXISTS idx_computation_engines_status ON compliance.computation_engines(status);

-- RLS: platform-governed catalog, global-read (same posture as
-- prompt_templates -- every org/role should be able to discover what
-- engines exist), writes are service_role/postgres-only.
ALTER TABLE compliance.computation_engines ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY public_read_computation_engines ON compliance.computation_engines FOR SELECT TO anon, authenticated, app_runtime, service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_computation_engines ON compliance.computation_engines FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT ON compliance.computation_engines TO anon, authenticated, app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.computation_engines TO service_role;
