-- UMR (Universal Metadata Registry) coverage: erp_statistical_key_figure_types
-- (new table, drizzle/0276_co006_statistical_key_figures.sql) must make an
-- explicit registered/exempted choice per
-- scripts/check-asset-registry-coverage.mjs. Registered as asset_type='other'
-- -- same choice this codebase's own other org-scoped master-data tables
-- made (erp_cost_centers/erp_fiscal_years/erp_tax_templates/
-- erp_asset_categories, all drizzle/0193_priority_umr_batch4_onboarding.sql).
-- name_column=name (a genuine display-name column); active_column=is_active
-- since, unlike most of those sibling masters, this table DOES carry a real
-- boolean active flag; owner_column=NULL (no created_by_id/owner column
-- exists, same as the sibling masters).
--
-- erp_statistical_key_figure_postings (the transactional posting table in
-- the same migration) is deliberately NOT registered here -- see this PR's
-- own exemption entry in ai-os/registry/asset-registry-coverage.yaml for
-- the reasoning (an append-only transaction log row, not a named asset,
-- same class as erp_journal_entry_lines).
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('erp_statistical_key_figure_types', 'other', 'name', NULL, NULL, 'org_id', NULL, 'is_active');

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.erp_statistical_key_figure_types
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();
