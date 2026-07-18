-- AI Architecture / Explainability & Transparency gap-closure (2026-07-18)
-- follow-up: Asset Registry Coverage Check (CI) flagged
-- business_terminology_glossary (added in 0225) as neither registered nor
-- exempted. It's a genuinely named, purpose-bearing asset (term = display
-- name, definition = purpose, org-scoped-or-platform-wide same as
-- report_definitions), so it belongs in the registry, not exempted --
-- same pattern as 0180_report_engine_taxonomy.sql's report_definitions row.

INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('business_terminology_glossary', 'other', 'term', 'definition', 'category', 'org_id', NULL, NULL)
ON CONFLICT (source_table) DO NOTHING;

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.business_terminology_glossary
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();
