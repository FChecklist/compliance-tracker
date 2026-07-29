-- Asset Registry Coverage Check gap closure (PR #618, 2026-07-29): the
-- generic auto_register_asset trigger fits prompt_marketplace_listings
-- directly -- publishToMarketplace() (prompt-marketplace-service.ts)
-- requires a non-empty, admin-authored `title` distinct from the
-- underlying prompt template's own name, a genuine display-name column,
-- unlike its sibling prompt_translations/prompt_localizations (exempted
-- as content blobs, see ai-os/registry/asset-registry-coverage.yaml).
-- name_column=title, purpose_column=description, owner_column=
-- published_by_user_id (the admin who published the listing).
-- published_by_org_id is attribution-only, not a tenant boundary (every
-- org can read a 'listed' entry, same posture as workerAgents.orgId), so
-- it is still the correct org_column for the registry's own attribution
-- purposes. No boolean active column -- status is 'listed'/'unlisted'
-- text, not a boolean, so active_column stays NULL (same reasoning as
-- ai_team_role_overrides in drizzle/0227).
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('prompt_marketplace_listings', 'prompt', 'title', 'description', NULL, 'published_by_org_id', 'published_by_user_id', NULL);

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.prompt_marketplace_listings
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();
