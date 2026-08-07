-- UMR (Universal Metadata Registry) coverage: abac_policies (new table,
-- drizzle/0225_abac_policy_layer.sql) must make an explicit registered/
-- exempted choice per scripts/check-asset-registry-coverage.mjs. Registered
-- as asset_type='policy' -- same family as the pre-existing `policies`
-- table (drizzle/0154's own registration). name_column=description since
-- this table has no dedicated display-name column; auto_register_asset()
-- already falls back to 'abac_policies:<id>' when description is null/blank
-- (see that function's own header), so an unlabelled policy still registers
-- usefully rather than failing.
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('abac_policies', 'policy', 'description', NULL, NULL, 'org_id', 'created_by_id', 'is_active');

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.abac_policies
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();
