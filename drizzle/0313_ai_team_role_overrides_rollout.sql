-- VERIDIAN Review Framework gap-closure (2026-08-15, AI Model Lifecycle &
-- Benchmarking finding, Critical: "No A/B or shadow-testing capability
-- exists" -- recommended approach: "Add a rollout-percentage column to
-- the roster config"). Extends the SAME admin-editable override row
-- roster-overrides.ts's resolveEffectiveModel() already reads (see
-- drizzle/0246-adjacent ai_team_role_overrides table, added by the
-- Multi-AI Provider Support gap-closure, 2026-07-18) rather than inventing
-- a second, parallel "roster config" surface -- a real A/B rollout needs
-- the same live-toggle-without-a-deploy property that table already gives
-- the plain model override.
--
-- candidate_model: an OpenRouter slug to test alongside the row's own
-- `model` (the primary/baseline). NULL means "no active rollout" -- the
-- default, and the only state before this migration.
-- rollout_percentage: 0-100, the share of real dispatches that should
-- route to candidate_model instead of the primary. NULL/0 means no
-- traffic goes to the candidate even if one is set (lets an admin stage a
-- candidate at 0% before turning it on, rather than only being able to
-- add both fields atomically).
--
-- Both nullable, both additive -- every existing row (and every row a
-- future setRoleOverride() call creates without touching rollout) is
-- entirely unaffected; resolveEffectiveModel() (the plain-override path)
-- doesn't read these columns at all, only the new resolveDispatchModel()
-- does.
ALTER TABLE platform.ai_team_role_overrides ADD COLUMN IF NOT EXISTS candidate_model text;
ALTER TABLE platform.ai_team_role_overrides ADD COLUMN IF NOT EXISTS rollout_percentage integer;

-- Fails closed at the DB layer too, not just in application code
-- (setRoleRollout()'s own validation) -- a stray direct INSERT/UPDATE
-- can't silently persist an out-of-range percentage. Idempotent DO block
-- (Postgres has no ADD CONSTRAINT IF NOT EXISTS) -- same precedent as
-- drizzle/0262_prompt_registry_version_lifecycle.sql's lifecycle_state check.
DO $$ BEGIN
  ALTER TABLE platform.ai_team_role_overrides
    ADD CONSTRAINT ai_team_role_overrides_rollout_percentage_range
    CHECK (rollout_percentage IS NULL OR (rollout_percentage >= 0 AND rollout_percentage <= 100));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
