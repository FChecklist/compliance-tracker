-- Wave 45 (VAIOS Layer 1-4 OpenRouter wiring, PLATFORM_STRATEGY.md §26).
-- Layer 3 (client) model config -- mirrors customer_model_config (Layer 2).
CREATE TABLE IF NOT EXISTS compliance.client_model_config (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  client_id text NOT NULL REFERENCES compliance.clients(id),
  orchestra_layer_id text REFERENCES compliance.orchestra_layers(id),
  provider compliance.ai_provider NOT NULL,
  encrypted_api_key text,
  model_name text,
  is_active boolean NOT NULL DEFAULT true,
  last_used_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

ALTER TABLE compliance.client_model_config ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY app_runtime_client_model_config ON compliance.client_model_config FOR ALL TO app_runtime
    USING (client_id IN (SELECT id FROM compliance.clients WHERE org_id = compliance.current_org_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_client_model_config ON compliance.client_model_config FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.client_model_config TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.client_model_config TO service_role;

CREATE INDEX IF NOT EXISTS idx_client_model_config_client_id ON compliance.client_model_config(client_id);
CREATE INDEX IF NOT EXISTS idx_client_model_config_layer_id ON compliance.client_model_config(orchestra_layer_id);

-- Layer 1 (platform) default: GROQ_API_KEY is confirmed missing from Vercel
-- (2026-07-04 security sweep), meaning every one of these 6 layers' platform-
-- default path was silently broken in production. OpenRouter's key is
-- confirmed present and working -- switching the default fixes a real,
-- pre-existing production bug, not just adding a new option.
UPDATE compliance.orchestra_layers
SET default_model_config = '{"provider":"openrouter","model":"meta-llama/llama-3.3-70b-instruct"}'::jsonb;
