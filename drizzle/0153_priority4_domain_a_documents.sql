-- Priority 4 domain A (09-priority4-umr-universal-tracker.yaml, agent 4):
-- Documents/Reports/Tasks onboarding onto the generic auto-registration
-- trigger built in drizzle/0152. Every row below is one config insert +
-- one CREATE TRIGGER statement, no application code, per that migration's
-- documented pattern. Column names were verified against each table's
-- real definition in src/lib/db/schema.ts (never guessed) -- see this
-- dispatch's PR description for the per-table reasoning, including which
-- candidates were reviewed and deliberately exempted instead (notably
-- `notifications`, which is scoped by user_id with no org_id column at
-- all -- registering it with org_column left NULL would have made it
-- silently present as a platform-tier asset, visible to every org, which
-- is a real cross-tenant leak this exact pattern already caused once
-- elsewhere in this session; see ai-os/registry/asset-registry-coverage.yaml
-- for the full exemption reasoning).

-- ─── documents ─────────────────────────────────────────────────────────
-- No natural "purpose" column (extractedData/metadata are jsonb, not a
-- display-purpose string) -- purpose_column intentionally NULL.
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('documents', 'document', 'name', NULL, NULL, 'org_id', 'uploaded_by_id', NULL);

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.documents
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

-- ─── tasks ──────────────────────────────────────────────────────────────
-- owner_column = user_id (the assignee tasks.status is tracked against),
-- not assigned_by_id (the assigner) -- the assignee is who the task
-- "belongs to" in the asset-ownership sense. status is free text with
-- 5 values, not boolean, so active_column is left NULL rather than
-- force-fit it.
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('tasks', 'task', 'title', 'description', NULL, 'org_id', 'user_id', NULL);

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.tasks
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

-- ─── saved_reports ──────────────────────────────────────────────────────
-- Reference mapping, already verified live in a rolled-back transaction
-- test against saved_reports before this pattern was reused for the rest
-- of this migration.
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('saved_reports', 'report', 'name', 'description', NULL, 'org_id', 'owned_by_id', NULL);

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.saved_reports
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

-- ─── incidents ──────────────────────────────────────────────────────────
-- No 'incident' asset_type exists in the enum; 'other' is the honest
-- choice rather than force-fitting 'document' or 'task'. No description/
-- purpose-shaped column exists on this table (category/severity/
-- classification/stage are all short classifiers, not free text) --
-- purpose_column NULL. owner_column = reported_by_id (NOT NULL, always
-- populated) rather than capa_owner_id (nullable, only set once a
-- corrective action is assigned).
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('incidents', 'other', 'title', NULL, NULL, 'org_id', 'reported_by_id', NULL);

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.incidents
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

-- ─── risks ──────────────────────────────────────────────────────────────
-- Same 'other' reasoning as incidents -- no 'risk' enum value, and no
-- description/purpose column exists on this table either.
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('risks', 'other', 'title', NULL, NULL, 'org_id', 'owner_id', NULL);

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.risks
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

-- ─── knowledge_base_pages ───────────────────────────────────────────────
-- active_column intentionally NULL, NOT 'is_archived': the trigger
-- function treats active_column as a TRUE-means-active flag ("if present
-- and value = 'false', register as archived"), but knowledge_base_pages'
-- own is_archived column has the OPPOSITE polarity (true means archived).
-- Wiring is_archived straight into active_column would silently invert
-- every page's registry status (archived pages would show 'active' and
-- vice versa). Confirmed by re-reading auto_register_asset()'s branch
-- (drizzle/0152, line ~80) before writing this row, not assumed.
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('knowledge_base_pages', 'document', 'title', 'content', NULL, 'org_id', 'updated_by_id', NULL);

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.knowledge_base_pages
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

-- ─── notices ────────────────────────────────────────────────────────────
-- notice_number is nullable (no NOT NULL display-name column exists on
-- this table) -- the trigger's own fallback ("notices:<id>" when the
-- name column is null/blank) handles that safely, so this is not a
-- blocking gap, just a known cosmetic edge case for older/manually
-- entered notices with no number yet.
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('notices', 'document', 'notice_number', 'description', NULL, 'org_id', 'assigned_to_id', NULL);

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.notices
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

-- ─── projects ───────────────────────────────────────────────────────────
-- Only table in this migration where active_column is safely wired:
-- projects.is_active is a genuine TRUE-means-active flag (matches the
-- trigger's assumed polarity exactly, unlike knowledge_base_pages.
-- is_archived above). owner_column = lead_user_id (nullable -- a project
-- doesn't require a PM lead to exist).
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('projects', 'project', 'name', 'description', NULL, 'org_id', 'lead_user_id', 'is_active');

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.projects
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

-- ─── board_action_items ─────────────────────────────────────────────────
-- Task-shaped child of board_meetings (item/owner_id/due_date/status),
-- registered on its own merits as asset_type 'task'. board_meetings
-- itself is deliberately left exempted this pass -- see coverage.yaml.
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('board_action_items', 'task', 'item', NULL, NULL, 'org_id', 'owner_id', NULL);

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.board_action_items
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

-- ─── audit_findings ─────────────────────────────────────────────────────
-- CAPA-tracked finding, functionally a remediation task (capa_status/
-- retest_result/due_date/owner_id) -- registered as asset_type 'task'
-- rather than 'other' since it genuinely fits that shape.
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('audit_findings', 'task', 'title', NULL, NULL, 'org_id', 'owner_id', NULL);

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.audit_findings
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();
