-- PRE-APPROVED-LIVE-DDL: Owner instruction in chat on 2026-10-11 ("integration of user / user organization AI is very very important for PROJEXA";
--   "Connect to AI - user for themselves; Auto connected to AI - if some other user have given access to its connection; or connected to organization ai";
--   "do on local, than deploy on supabase").
-- WHAT: adds the two tables behind "Connect your AI" for a PERSON (the organisation's own connection already lives in compliance.customer_model_config):
--   compliance.user_ai_connections         one row per person per organisation: that person's own AI vendor, model and key (encrypted by the app, same
--                                          src/lib/ai-config-crypto.ts the organisation key uses). Never readable by another person through the app:
--                                          the key column is selected only to answer that person's own request.
--   compliance.user_ai_connection_shares   "I let this teammate use my connection": one row per (connection, teammate). Deleting the connection deletes its shares.
-- WHO USES WHICH (src/lib/ai/org-own-ai.ts resolveAiFor): the person's own connection first, then one a teammate shared with them, then the organisation's.
-- ADDITIVE ONLY: two new tables, indexes, RLS. No existing table or row is touched. DATA LOSS: none.
-- IDEMPOTENT: IF NOT EXISTS / duplicate_object guards.
-- HOW IT IS APPLIED: by the PM through the Supabase MCP after the pull request is green (owner instruction above).
-- ROLLBACK: drizzle/down/0746_user_ai_connections.down.sql

BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS compliance.user_ai_connections (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL,
  owner_user_id text NOT NULL,
  provider text NOT NULL CHECK (provider IN ('openai', 'anthropic', 'google', 'groq', 'openrouter')),
  model_name text NOT NULL,
  encrypted_api_key text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT user_ai_connections_org_owner_unique UNIQUE (org_id, owner_user_id)
);

CREATE TABLE IF NOT EXISTS compliance.user_ai_connection_shares (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL,
  connection_id text NOT NULL REFERENCES compliance.user_ai_connections(id) ON DELETE CASCADE,
  shared_with_user_id text NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT user_ai_connection_shares_unique UNIQUE (connection_id, shared_with_user_id)
);
CREATE INDEX IF NOT EXISTS user_ai_connection_shares_with_idx ON compliance.user_ai_connection_shares (org_id, shared_with_user_id);

-- RLS, the same shape as construction_material_orders (drizzle/0742).
ALTER TABLE compliance.user_ai_connections ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN CREATE POLICY app_runtime_tenant_isolation ON compliance.user_ai_connections FOR ALL TO app_runtime USING (org_id = compliance.current_org_id()); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY service_role_bypass_user_ai_connections ON compliance.user_ai_connections FOR ALL TO service_role USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE compliance.user_ai_connection_shares ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN CREATE POLICY app_runtime_tenant_isolation ON compliance.user_ai_connection_shares FOR ALL TO app_runtime USING (org_id = compliance.current_org_id()); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY service_role_bypass_user_ai_connection_shares ON compliance.user_ai_connection_shares FOR ALL TO service_role USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMIT;
