-- Token Usage Ledger (Finance). Unified internal(AI Team)+product(per-org/
-- per-user) token/cost tracking. Writes go through a secret-gated API
-- route (POST /api/ai/team/log-usage) or the app's own service-role DB
-- client -- never a broadly-exposed anon key -- because this is financial
-- accounting data Finance needs to trust, not disposable telemetry.

CREATE TABLE IF NOT EXISTS compliance.token_usage_ledger (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  scope text NOT NULL,
  org_id text,
  user_id text,
  role_key text,
  layer_key text,
  task_summary text,
  provider text NOT NULL,
  model text NOT NULL,
  prompt_tokens integer NOT NULL DEFAULT 0,
  completion_tokens integer NOT NULL DEFAULT 0,
  estimated_cost_usd numeric,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_token_usage_ledger_scope ON compliance.token_usage_ledger(scope);
CREATE INDEX IF NOT EXISTS idx_token_usage_ledger_org_id ON compliance.token_usage_ledger(org_id);
CREATE INDEX IF NOT EXISTS idx_token_usage_ledger_role_key ON compliance.token_usage_ledger(role_key);
CREATE INDEX IF NOT EXISTS idx_token_usage_ledger_created_at ON compliance.token_usage_ledger(created_at);

-- RLS: service_role only (this table is read/written exclusively by
-- server-side code -- the log-usage API route and Finance report route --
-- never directly by app_runtime tenant-scoped queries, since a single row
-- can represent platform-internal spend with no org_id at all, which
-- app_runtime's org-scoped policy convention isn't shaped for).
ALTER TABLE compliance.token_usage_ledger ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_token_usage_ledger ON compliance.token_usage_ledger FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.token_usage_ledger TO service_role;
