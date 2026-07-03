-- Wave 24 (PageAgent integration -- bring-your-own-AI client-side GUI
-- agent, deployed as default across every VERIDIAN screen). See
-- PLATFORM_STRATEGY.md's PageAgent section for the full design and the
-- three decisions this schema implements: always-proxied LLM calls
-- (never browser-to-provider directly), both org-level AND per-user BYO
-- resolution (most-specific-scope-wins), and a hard server-side
-- read-only restriction on /posh and /whistleblower (enforced in the
-- proxy route, not this schema).

-- Seed a 6th orchestra_layers row -- confirmed via pg_constraint that
-- layer_key already has a real UNIQUE constraint, so ON CONFLICT is safe.
-- default_model_config mirrors the exact platform-default shape every
-- other layer uses (provider/model matching orchestra-model-resolver.ts's
-- hardcoded fallback).
INSERT INTO compliance.orchestra_layers (layer_key, name, description, layer_order, default_model_config)
VALUES (
  'page_agent_oa',
  'Page Agent OA',
  'Client-side DOM-control agent (page-agent) that navigates and interacts with the VERIDIAN app on the user''s behalf, via natural language',
  6,
  '{"provider":"groq","model":"llama-3.3-70b-versatile"}'::jsonb
)
ON CONFLICT (layer_key) DO NOTHING;

-- Personal (per-user) BYO model config -- resolved BEFORE the org-level
-- customer_model_config in resolvePageAgentModelConfig()'s most-specific-
-- scope-wins chain. provider is free text (not ai_provider enum) since
-- 'ollama'/'custom' endpoints are a real, expected BYO case this table
-- must support that the existing enum doesn't cover.
CREATE TABLE IF NOT EXISTS compliance.personal_model_config (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id text NOT NULL REFERENCES compliance.users(id),
  provider text NOT NULL,
  base_url text,
  model_name text NOT NULL,
  encrypted_api_key text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  UNIQUE(user_id)
);

ALTER TABLE compliance.personal_model_config ENABLE ROW LEVEL SECURITY;

-- Same scope_type='user' pattern as module_rule_configs (Wave 21) --
-- a user may only ever read/write their own row.
DO $$ BEGIN
  CREATE POLICY app_runtime_own_row ON compliance.personal_model_config FOR ALL TO app_runtime
    USING (user_id = compliance.current_user_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_personal_model_config ON compliance.personal_model_config FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.personal_model_config TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.personal_model_config TO service_role;

CREATE INDEX IF NOT EXISTS idx_personal_model_config_user_id ON compliance.personal_model_config(user_id);

-- Org-level on/off switch for PageAgent -- default true (deployed as
-- default per the user's explicit instruction). Distinct from whether a
-- model is actually configured for the page_agent_oa layer.
ALTER TABLE compliance.organisations ADD COLUMN IF NOT EXISTS page_agent_enabled boolean NOT NULL DEFAULT true;
