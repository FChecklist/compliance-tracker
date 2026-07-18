-- Asset Registry Coverage Check gap closure (PR #415 rescue, 2026-07-18):
-- ai_team_role_overrides (drizzle/0226) is a real, admin-editable platform
-- config object -- one row per AI Team role_key that an admin has
-- overridden away from roster.ts's static default model, set/cleared via
-- PATCH /api/ai/team/dispatch and listed via GET
-- /api/ai/team/roster/overrides (src/components/AiTeamRosterSection.tsx).
-- Unlike worker_agents/ai_agent_directory (exempted just below/above in
-- the registry -- app-managed via a service with richer status semantics
-- the generic trigger's ON CONFLICT UPDATE model doesn't fit), this table
-- has no existing custom registration hook and a plain unique role_key ->
-- model mapping, so the generic auto_register_asset trigger fits directly.
-- role_key is the genuine display name (identifies which AI Team role this
-- override is about); reason is the admin's stated purpose for the
-- override; updated_by_user_id is a real, nullable owner. No org_id column
-- -- the AI Team roster is the platform's own internal org chart, never a
-- customer org's data (same platform-wide posture as ai_agent_directory).
-- No boolean active column -- clearRoleOverride() deletes the row outright
-- rather than toggling a flag, so active_column stays NULL (the trigger's
-- own DELETE branch already marks the platform_assets row 'deleted').
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('ai_team_role_overrides', 'policy', 'role_key', 'reason', NULL, NULL, 'updated_by_user_id', NULL);

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.ai_team_role_overrides
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();
