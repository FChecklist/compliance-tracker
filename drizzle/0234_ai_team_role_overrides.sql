-- VERIDIAN Review Framework remediation (Multi-AI Provider Support gap,
-- 2026-07-18): "internal AI Team roster is static, not admin-editable."
-- Additive override layer on top of src/lib/ai-team/roster.ts's AI_TEAM_ROSTER
-- -- one row per role_key, naming the model an admin wants that role to use
-- INSTEAD of roster.ts's own static default. roster-overrides.ts's
-- resolveEffectiveModel() checks this table first, falling back to the
-- static default when no row exists. See schema.ts's own comment on this
-- table for the full "why an override layer, not a roster rewrite"
-- reasoning.
--
-- Platform-level table (no org_id -- the AI Team roster is the platform's
-- own internal org chart, never a customer org's data), same RLS posture as
-- prompt_templates (Wave 22): app_runtime can read/write (role-gated
-- veridian_admin-only in the service layer, same pattern as every other
-- admin-only write in this codebase), service_role has full bypass.
CREATE TABLE IF NOT EXISTS compliance.ai_team_role_overrides (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  role_key text NOT NULL UNIQUE,
  model text NOT NULL,
  reason text,
  updated_by_user_id text REFERENCES compliance.users(id),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

ALTER TABLE compliance.ai_team_role_overrides ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY app_runtime_ai_team_role_overrides ON compliance.ai_team_role_overrides FOR ALL TO app_runtime USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_ai_team_role_overrides ON compliance.ai_team_role_overrides FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- Read-only for anon/authenticated: scripts/ai-workforce-agent.mjs (the
-- repo-write dispatch surface that actually spends OpenRouter tokens on
-- behalf of a role) runs standalone in GitHub Actions CI, outside the
-- Next.js app entirely, and authenticates to PostgREST via
-- AI_TEAM_SUPABASE_ANON_KEY (the `anon` Postgres role) -- the same
-- constraint documented in that script's own fetchSystemPrompt() for
-- prompt_templates. Without SELECT for anon here, that script's tier
-- check and actual model call would silently disagree with an admin's
-- override (RLS would filter the row to zero results, resolveEffectiveModel
-- falls back to the static default) -- not a security hole (the row itself
-- carries no secret, just a role_key -> model_id mapping), but a real
-- functional gap for the one dispatch surface that can't reach app_runtime.
-- No write grant for anon/authenticated -- only the app_runtime-gated
-- (veridian_admin-checked in the service layer) API route may mutate this
-- table.
DO $$ BEGIN
  CREATE POLICY public_read_ai_team_role_overrides ON compliance.ai_team_role_overrides FOR SELECT TO anon, authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT ON compliance.ai_team_role_overrides TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.ai_team_role_overrides TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.ai_team_role_overrides TO service_role;
