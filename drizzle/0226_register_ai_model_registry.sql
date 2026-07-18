-- AIROUTER-01 follow-up: asset-registry-coverage check (ai-os/registry/
-- asset-registry-coverage.yaml + its own CI gate) requires every new table
-- to make an explicit registered-or-exempted choice. Judgment call made
-- here, not guessed at by a heuristic (this repo's own established
-- discipline, see GAP-UMR-TABLE-COVERAGE precedent):
--
--   - ai_model_registry: REGISTERED. `model` (e.g. "z-ai/glm-5.2") is a
--     genuine, human-recognizable display name -- same class as
--     module_registry/subscription_plans (platform-wide catalogs, no
--     org_id column, registered). `notes` is a real free-text descriptive
--     column, used as purpose_column. `status` is a 3-value enum
--     (active/disabled/deprecated), not a true boolean -- active_column
--     left NULL, matching training_paths's own precedent for the same
--     reason ("status is a real Postgres enum ... not boolean").
--
--   - ai_routing_policies / ai_routing_audit_log: EXEMPTED, not registered
--     here -- see ai-os/registry/asset-registry-coverage.yaml's `exempted`
--     list additions in this same PR for the specific reasons (no genuine
--     display-name column on either; audit_log is the same class as the
--     already-exempted activity_log).

INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('ai_model_registry', 'other', 'model', 'notes', NULL, NULL, NULL, NULL);

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.ai_model_registry
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();
