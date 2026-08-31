-- UMR (Universal Metadata Registry) coverage: construction_progress_claims
-- (new table, drizzle/0269_construction_progress_claims_workflow.sql) must
-- make an explicit registered/exempted choice per
-- scripts/check-asset-registry-coverage.mjs. Registered as
-- asset_type='workflow' -- this table IS the state machine (milestone
-- claim moving through drafted/submitted/client_approved/invoiced), not a
-- master data object, matching the 'workflow' category the check script's
-- own boilerplate lists. name_column=milestone_description since there is
-- no dedicated display-name column; active_column=NULL since status is a
-- 6-value enum, not a genuine boolean.
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('construction_progress_claims', 'workflow', 'milestone_description', NULL, NULL, 'org_id', 'created_by_id', NULL);

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.construction_progress_claims
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();
