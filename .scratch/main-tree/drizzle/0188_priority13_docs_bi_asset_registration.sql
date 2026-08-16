-- Priority 13 (asset-registry-coverage CI gate): register the 3 new tables
-- this wave added (document_correspondents, document_matching_rules,
-- custom_charts) onto the generic auto_register_asset trigger, following
-- drizzle/0171's pattern exactly. Column names verified against their real
-- definitions in src/lib/db/schema.ts, never guessed.

-- ─── document_correspondents ────────────────────────────────────────────
-- A real, user-managed correspondent register ("Acme Bank", "GST
-- Department"), same shape as departments/committees (drizzle/0155) --
-- org-scoped named entity, no purpose/owner/active column exists.
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('document_correspondents', 'other', 'name', NULL, NULL, 'org_id', NULL, NULL);

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.document_correspondents
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

-- ─── document_matching_rules ────────────────────────────────────────────
-- Org-scoped, named, real isActive boolean -- a textbook asset_type='rule'
-- registration. No purpose/module/owner column exists.
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('document_matching_rules', 'rule', 'name', NULL, NULL, 'org_id', NULL, 'is_active');

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.document_matching_rules
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

-- ─── custom_charts ───────────────────────────────────────────────────────
-- Same shape and asset_type as the already-registered saved_reports
-- (drizzle/0153): "user-configurable saved queries ... rendered as
-- table/bar/pie/line charts" -- custom_charts is the Priority 13 ad-hoc-BI
-- equivalent. createdById is a genuine single-user owner column; no
-- purpose/module column exists; no boolean active column (charts aren't
-- soft-deleted).
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('custom_charts', 'report', 'name', NULL, NULL, 'org_id', 'created_by_id', NULL);

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.custom_charts
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();
