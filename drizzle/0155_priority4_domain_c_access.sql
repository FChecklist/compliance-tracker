-- Priority 4 domain C (09-priority4-umr-universal-tracker.yaml, agent 6):
-- Access/Identity/Platform-surface tables onboarded onto the generic
-- auto-registration trigger built in migration 0152
-- (compliance.auto_register_asset() / compliance.asset_registration_config).
--
-- This migration does NOT touch the trigger function itself -- it only adds
-- one config row + one CREATE TRIGGER statement per table, exactly the
-- pattern documented in 0152's own header comment and in
-- 09-priority4-umr-universal-tracker.yaml's schema_contract.
--
-- 10 tables registered this pass. Column choices verified directly against
-- src/lib/db/schema.ts (grep'd for the exact `text('column_name')` string
-- before use, not guessed) -- see this dispatch's PR description for the
-- full reasoning per table, including the tables considered and explicitly
-- exempted instead (api_keys, sso_configurations, connector_accounts,
-- access_review_certifications, installed_products, organisations).
--
-- org_column=NULL is used ONLY for module_registry / product_branches /
-- subscription_plans -- all three genuinely lack an org_id column BY DESIGN
-- (platform-wide catalogs every org reads the same rows from), confirmed by
-- reading each table's own schema.ts comments, not because the column was
-- merely absent. This is the correct case for org_column=NULL, distinct
-- from the cross-tenant leak pattern already fixed once this session
-- (2fb4880, a user_id-scoped table wrongly treated as platform-wide).

INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  -- departments: org-scoped org-chart unit. headId is the department's
  -- responsible person (unique per department), the closest real analogue
  -- to an "owner" this table has. No isActive-style column exists.
  ('departments', 'other', 'name', 'description', NULL, 'org_id', 'head_id', NULL),

  -- committees: org-scoped governance body. charter is its stated purpose;
  -- chairId is the committee's responsible person. No isActive column.
  ('committees', 'other', 'name', 'charter', NULL, 'org_id', 'chair_id', NULL),

  -- compliance_frameworks: org-scoped catalog of adopted frameworks
  -- (ISO27001/SOC2/DPDP/etc.) -- 'policy' is the closest real fit in the
  -- asset_type enum for a compliance standard/framework. relevanceNote is
  -- its purpose (set for opt-in frameworks). No isActive column.
  ('compliance_frameworks', 'policy', 'name', 'relevance_note', NULL, 'org_id', NULL, NULL),

  -- framework_controls: org-scoped individual controls under a framework --
  -- 'rule' fits a specific compliance control better than 'policy' (the
  -- framework itself, registered above, is the policy; each control is one
  -- rule under it). status is a 4-value text lifecycle
  -- ('not_started'|'in_progress'|'implemented'|'verified'), not a boolean,
  -- so it cannot be used as active_column (the trigger only understands a
  -- boolean 'false' check). No purpose/description column exists.
  ('framework_controls', 'rule', 'title', NULL, NULL, 'org_id', NULL, NULL),

  -- module_registry: PLATFORM-WIDE by design (no org_id column at all --
  -- this is the single catalog of every module the whole platform offers,
  -- identical for every org, confirmed by the table's own header comment).
  -- domain mirrors this file's own section headers and is the closest
  -- module-grouping column, matching the established module_column
  -- convention (worker_agents.domain / computation_engines.category both
  -- already map to `module` in the Priority 3 backfill).
  ('module_registry', 'other', 'display_name', 'description', 'domain', NULL, NULL, 'is_active'),

  -- product_branches: PLATFORM-WIDE by design (no org_id column -- "a
  -- platform branch belongs to no single org", per the table's own header
  -- comment; currently 1 seeded row, 'grc'). domain is the module-grouping
  -- column, same convention as module_registry above.
  ('product_branches', 'other', 'display_name', 'description', 'domain', NULL, NULL, 'is_active'),

  -- products: org-scoped (Wave 19) -- an ORG's OWN internal PMS products,
  -- deliberately a separate table from the platform-wide product_branches
  -- above (see that table's own header comment contrasting the two).
  ('products', 'other', 'name', 'description', NULL, 'org_id', NULL, 'is_active'),

  -- webhooks: org-scoped outbound integration config. The trigger only
  -- ever copies name/purpose/module/owner/org/status -- never `secret` or
  -- `url` -- so registering this table does not leak the webhook signing
  -- secret into the searchable registry. 'api' is the closest asset_type
  -- fit for an outbound API integration surface. No purpose/description
  -- column exists.
  ('webhooks', 'api', 'name', NULL, NULL, 'org_id', NULL, 'is_active'),

  -- subscription_plans: PLATFORM-WIDE by design (no org_id column -- every
  -- org picks from the same shared pricing-plan catalog). No
  -- purpose/description column exists.
  ('subscription_plans', 'other', 'name', NULL, NULL, NULL, NULL, 'is_active'),

  -- access_review_cycles: org-scoped periodic access-review process --
  -- 'task' fits a time-boxed reviewable unit of work with a dueDate/status
  -- lifecycle. createdById is the review's owner. No boolean active
  -- column (status is a 2-value text field: 'open'|'completed', not a
  -- boolean, so it is not wired as active_column).
  ('access_review_cycles', 'task', 'name', NULL, NULL, 'org_id', 'created_by_id', NULL)
;

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.departments
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.committees
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.compliance_frameworks
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.framework_controls
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.module_registry
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.product_branches
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.products
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.webhooks
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.subscription_plans
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.access_review_cycles
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();
