-- VERIDIAN Review Framework gap closure (2026-07-18): Calculation Engine /
-- Calculation Governance -- Version Control + Auditability.
--
-- 1) computation_engines gains engine_version + effective_from/effective_to
--    so a statutory-formula change (e.g. a new GST slab) no longer silently
--    overwrites the row with no record of the prior formula version. This
--    table still holds only the CURRENT version per engine_key -- history
--    lives per-invocation in calculation_invocations below (see
--    src/lib/engines/engine-invocation.ts's header for the full rationale).
-- 2) calculation_invocations is a new audit-log table written by the new
--    invokeEngine() wrapper -- guarantees an audit row regardless of call
--    path (Chain Selector dispatch today; any future direct service-code
--    call that adopts the wrapper), closing the "guaranteed for the 26
--    wired engines but not the rest" gap at the invocation layer itself
--    rather than call-site-by-call-site.

ALTER TABLE compliance.computation_engines
  ADD COLUMN IF NOT EXISTS engine_version text NOT NULL DEFAULT '1.0.0',
  ADD COLUMN IF NOT EXISTS effective_from timestamp NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS effective_to timestamp;

CREATE TABLE IF NOT EXISTS compliance.calculation_invocations (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  engine_key text NOT NULL,
  engine_version text NOT NULL,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  user_id text,
  task_id text,
  status text NOT NULL,
  input jsonb NOT NULL DEFAULT '{}',
  output jsonb,
  error_message text,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_calculation_invocations_org_id ON compliance.calculation_invocations(org_id);
CREATE INDEX IF NOT EXISTS idx_calculation_invocations_engine_key ON compliance.calculation_invocations(engine_key);
CREATE INDEX IF NOT EXISTS idx_calculation_invocations_task_id ON compliance.calculation_invocations(task_id);
CREATE INDEX IF NOT EXISTS idx_calculation_invocations_created_at ON compliance.calculation_invocations(created_at);

-- RLS: org-scoped log table, same posture as the rest of this schema's
-- org-scoped tables (Wave A's FORCE ROW LEVEL SECURITY standard).
ALTER TABLE compliance.calculation_invocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.calculation_invocations FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.calculation_invocations FOR ALL TO app_runtime
    USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_calculation_invocations ON compliance.calculation_invocations FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.calculation_invocations TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.calculation_invocations TO service_role;
