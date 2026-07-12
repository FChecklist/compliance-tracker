-- Priority 4 domain B (09-priority4-umr-universal-tracker.yaml, agent 5):
-- onboards a Workflow/Automation/Decision/Approval/Policy/Framework-domain
-- tranche of tables onto the generic auto-registration trigger mechanism
-- built in drizzle/0152_priority4_umr_auto_registration.sql. This migration
-- ONLY adds compliance.asset_registration_config rows + CREATE TRIGGER
-- statements referencing compliance.auto_register_asset() -- it does not
-- redefine that function.
--
-- Every table below was verified to have a genuine org_id column (real
-- org-scoping key) before being onboarded -- see this dispatch's PR
-- description for the full list of candidates that were investigated and
-- deliberately NOT onboarded here (no org_id and not genuinely platform-
-- wide, no single display-name column, or child tables scoped only via a
-- parent FK), which are documented with specific reasons in
-- ai-os/registry/asset-registry-coverage.yaml's `exempted` list instead.

-- ─── automation_rules ──────────────────────────────────────────────────────
-- name/description/org_id(NOT NULL)/created_by_id/is_active all present and
-- exactly as the schema_contract expects -- the canonical "automation" rule.
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('automation_rules', 'automation', 'name', 'description', NULL, 'org_id', 'created_by_id', 'is_active');

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.automation_rules
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

-- ─── policies ──────────────────────────────────────────────────────────────
-- title/org_id(NOT NULL)/created_by_id present. status is a rich enum
-- (draft|published|...), NOT a simple boolean, so active_column is
-- deliberately left NULL -- every policies row will register as 'active'
-- regardless of its real lifecycle status. Accepted simplification per the
-- dispatch brief: forcing a boolean reading off a multi-state enum would be
-- wrong more often than leaving it off, and the registry's job here is
-- discoverability/traceability, not being the source of truth for policy
-- lifecycle state (policies.status remains that).
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('policies', 'policy', 'title', NULL, NULL, 'org_id', 'created_by_id', NULL);

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.policies
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

-- ─── approval_workflow_definitions ─────────────────────────────────────────
-- name/org_id(NOT NULL)/is_active/created_by_id present -- the canonical
-- "workflow" definition (maker-checker workflow templates for ERP entities).
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('approval_workflow_definitions', 'workflow', 'name', NULL, NULL, 'org_id', 'created_by_id', 'is_active');

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.approval_workflow_definitions
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

-- ─── bcm_plans ─────────────────────────────────────────────────────────────
-- plan_name/org_id(NOT NULL) present. No owner/created_by column on this
-- table (only status/last_tested_date) -- owner_column left NULL rather
-- than guessed. asset_type='document': a BCM plan is a formal continuity
-- document, not itself a multi-step workflow definition (its status field
-- is tested/not_tested, not a lifecycle enum requiring active_column
-- either).
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('bcm_plans', 'document', 'plan_name', NULL, NULL, 'org_id', NULL, NULL);

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.bcm_plans
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

-- ─── framework_controls ────────────────────────────────────────────────────
-- title/org_id(NOT NULL) present. status is a 4-state text enum
-- (not_started|in_progress|implemented|verified), not a boolean, so
-- active_column is left NULL for the same reason as policies above. No
-- owner column on this table. asset_type='rule': each row is one specific
-- control requirement to satisfy against a framework, i.e. a compliance
-- rule -- distinct from compliance_frameworks itself, which is the
-- umbrella catalog entry (registered below as 'policy').
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('framework_controls', 'rule', 'title', NULL, NULL, 'org_id', NULL, NULL);

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.framework_controls
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

-- ─── compliance_frameworks ─────────────────────────────────────────────────
-- name/relevance_note/org_id(NOT NULL) present. No owner or active column.
-- asset_type='policy': the umbrella governance-framework catalog entry
-- (ISO27001/SOC2/DPDP/etc.) that framework_controls (registered above as
-- 'rule') hangs off of.
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('compliance_frameworks', 'policy', 'name', 'relevance_note', NULL, 'org_id', NULL, NULL);

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.compliance_frameworks
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

-- ─── metric_alert_rules ─────────────────────────────────────────────────────
-- name/org_id(NOT NULL)/is_active/created_by_id(NOT NULL) present -- a
-- genuine scheduled-threshold "rule".
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('metric_alert_rules', 'rule', 'name', NULL, NULL, 'org_id', 'created_by_id', 'is_active');

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.metric_alert_rules
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

-- ─── delegation_of_authority ────────────────────────────────────────────────
-- activity/threshold_description/org_id(NOT NULL) present. No owner or
-- active column. asset_type='rule': each row defines which role must
-- approve which activity above what threshold -- an approval rule.
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('delegation_of_authority', 'rule', 'activity', 'threshold_description', NULL, 'org_id', NULL, NULL);

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.delegation_of_authority
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

-- ─── erp_pricing_rules ──────────────────────────────────────────────────────
-- name/org_id(NOT NULL)/is_active/created_by_id present. ERP-domain but
-- explicitly rule-shaped (a discount/pricing rule with priority/validity
-- window) with a clear name column -- included per the dispatch brief's
-- latitude to add well-fitting rule/workflow/policy-shaped candidates
-- beyond the seed list.
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('erp_pricing_rules', 'rule', 'name', NULL, NULL, 'org_id', 'created_by_id', 'is_active');

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.erp_pricing_rules
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

-- ─── leave_policy_entries ───────────────────────────────────────────────────
-- leave_type/governing_law/org_id(NOT NULL) present. No owner or active
-- column. asset_type='policy': a per-leave-type HR policy entry.
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('leave_policy_entries', 'policy', 'leave_type', 'governing_law', NULL, 'org_id', NULL, NULL);

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.leave_policy_entries
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

-- ─── approval_requests ──────────────────────────────────────────────────────
-- The generic cross-module maker-checker table (policy publish, RPT
-- approval, ...). request_type/description/org_id(NOT NULL)/requested_by_id
-- present. status is pending|approved|rejected -- not a simple active
-- boolean, so active_column is left NULL (same reasoning as policies).
-- asset_type='decision': each row IS a discrete approve/reject decision
-- event, the clearest fit in the enum for this table's real shape.
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('approval_requests', 'decision', 'request_type', 'description', NULL, 'org_id', 'requested_by_id', NULL);

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.approval_requests
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();
