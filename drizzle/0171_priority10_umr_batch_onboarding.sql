-- Priority 10 (GAP-UMR-TABLE-COVERAGE): a real second batch of tables
-- onboarded from the grandfather-exempted list onto the generic
-- auto-registration trigger built in drizzle/0152, following Priority 8's
-- drizzle/0161 pattern exactly. 19 genuinely valuable, real business-asset
-- tables picked from the 326 still carrying the generic "not yet reviewed"
-- placeholder reason in ai-os/registry/asset-registry-coverage.yaml --
-- prioritizing real named business objects (masters, registers, matters,
-- engagements) over join/log/event tables, spanning ERP, Legal, HR
-- recruiting, PMS, Construction, Facilities, and CA-firm modules so no
-- single domain dominates this pass. Column names verified against each
-- table's real definition in src/lib/db/schema.ts, never guessed.
--
-- Deliberately NOT onboarded from this same investigation: employee_profiles
-- (no genuine display-name column -- employeeCode/jobTitle are not a
-- person's name, that lives on the linked `users` row; forcing jobTitle as
-- name_column would produce misleading, non-unique registry entries like
-- many unrelated "Senior Engineer" rows) -- see this migration's
-- asset-registry-coverage.yaml companion update for the explicit reason.
--
-- active_column is left NULL wherever a table's status is a multi-value
-- enum/free-text workflow state rather than a genuine TRUE-means-active
-- boolean flag (matching drizzle/0161's own established discipline) -- the
-- trigger's `(row_data ->> cfg.active_column) = 'false'` check only means
-- what it says for a real boolean-shaped column, and force-fitting an enum
-- there would silently misreport status for every non-boolean value.

-- ─── branches ───────────────────────────────────────────────────────────
-- isActive is a genuine TRUE-means-active flag.
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('branches', 'other', 'name', NULL, NULL, 'org_id', NULL, 'is_active');

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.branches
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

-- ─── litigation_matters ─────────────────────────────────────────────────
-- stage is a real Postgres enum (litigation_stage), not boolean -- active_column NULL.
-- No genuine owner column exists on this table.
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('litigation_matters', 'other', 'matter', NULL, NULL, 'org_id', NULL, NULL);

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.litigation_matters
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

-- ─── ip_portfolio ───────────────────────────────────────────────────────
-- status is free text ('application_filed' etc.), not boolean -- active_column NULL.
-- classDescription is the closest purpose-shaped column.
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('ip_portfolio', 'other', 'mark', 'class_description', NULL, 'org_id', NULL, NULL);

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.ip_portfolio
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

-- ─── legal_matters ──────────────────────────────────────────────────────
-- status is 'open'|'closed' free text, not boolean -- active_column NULL
-- (a literal 'false' never appears, so force-mapping it would always read
-- as active). owner_column = responsible_user_id (the actual person
-- handling the matter, distinct from created_by_id).
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('legal_matters', 'other', 'title', 'description', NULL, 'org_id', 'responsible_user_id', NULL);

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.legal_matters
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

-- ─── audit_engagements ──────────────────────────────────────────────────
-- status is free text ('planned' etc.), not boolean -- active_column NULL.
-- No purpose-shaped column exists.
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('audit_engagements', 'other', 'name', NULL, NULL, 'org_id', NULL, NULL);

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.audit_engagements
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

-- ─── vendor_risk_profiles ───────────────────────────────────────────────
-- riskTier is a 3-value free-text tier, not boolean -- active_column NULL.
-- No purpose-shaped column exists.
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('vendor_risk_profiles', 'other', 'name', NULL, NULL, 'org_id', NULL, NULL);

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.vendor_risk_profiles
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

-- ─── pms_issues ─────────────────────────────────────────────────────────
-- Registered as asset_type 'task' -- a real work item, same reasoning
-- Priority 8 applied to leave_requests. isArchived exists but has inverse
-- polarity (TRUE means archived, not active) vs. the trigger's assumed
-- TRUE-means-active semantics -- active_column left NULL rather than
-- force-fit an inverted flag. assigneeId is the denormalized "who owns
-- resolving this" cache the service layer keeps in sync.
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('pms_issues', 'task', 'title', 'description', NULL, 'org_id', 'assignee_id', NULL);

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.pms_issues
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

-- ─── pms_milestones ─────────────────────────────────────────────────────
-- status is a real Postgres enum (pms_milestone_status), not boolean --
-- active_column NULL. No owner column exists.
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('pms_milestones', 'other', 'name', 'description', NULL, 'org_id', NULL, NULL);

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.pms_milestones
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

-- ─── erp_fixed_assets ───────────────────────────────────────────────────
-- status is a real Postgres enum (erp_asset_status), not boolean --
-- active_column NULL. custodianUserId is the real "who is responsible for
-- this physical asset" owner.
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('erp_fixed_assets', 'other', 'asset_name', NULL, NULL, 'org_id', 'custodian_user_id', NULL);

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.erp_fixed_assets
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

-- ─── erp_suppliers ──────────────────────────────────────────────────────
-- isActive is a genuine TRUE-means-active flag. No owner column exists.
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('erp_suppliers', 'other', 'supplier_name', NULL, NULL, 'org_id', NULL, 'is_active');

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.erp_suppliers
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

-- ─── erp_warehouses ─────────────────────────────────────────────────────
-- No boolean active flag (isGroup means "is a tree-group node", not
-- active/inactive) and no owner column exists.
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('erp_warehouses', 'other', 'warehouse_name', NULL, NULL, 'org_id', NULL, NULL);

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.erp_warehouses
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

-- ─── erp_items ──────────────────────────────────────────────────────────
-- isActive is a genuine TRUE-means-active flag. No owner column exists.
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('erp_items', 'other', 'item_name', NULL, NULL, 'org_id', NULL, 'is_active');

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.erp_items
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

-- ─── erp_companies ──────────────────────────────────────────────────────
-- isActive is a genuine TRUE-means-active flag. No owner column exists.
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('erp_companies', 'other', 'company_name', NULL, NULL, 'org_id', NULL, 'is_active');

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.erp_companies
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

-- ─── job_openings ───────────────────────────────────────────────────────
-- status is a real Postgres enum (job_opening_status), not boolean --
-- active_column NULL. postedById is the real owner.
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('job_openings', 'other', 'title', 'job_description', NULL, 'org_id', 'posted_by_id', NULL);

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.job_openings
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

-- ─── candidates ─────────────────────────────────────────────────────────
-- No status/active column and no owner column exist on this table.
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('candidates', 'other', 'name', NULL, NULL, 'org_id', NULL, NULL);

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.candidates
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

-- ─── erp_contracts ──────────────────────────────────────────────────────
-- Registered as asset_type 'document' -- a contract is fundamentally a
-- (often AI-generated, see bodyText) document, distinct from the plain
-- business-record 'other' used for masters above. status is a real
-- Postgres enum (erp_contract_status), not boolean -- active_column NULL.
-- ownerId is the real account-manager owner (distinct from createdById).
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('erp_contracts', 'document', 'title', NULL, NULL, 'org_id', 'owner_id', NULL);

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.erp_contracts
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

-- ─── fm_assets ──────────────────────────────────────────────────────────
-- status is 4-value free text ('active'|'inactive'|'decommissioned'|
-- 'under_repair'), not boolean -- active_column NULL (a literal 'false'
-- never appears, so force-mapping would always read as active regardless
-- of the real value). notes is the closest purpose-shaped column.
-- createdById is the real owner (no dedicated custodian column here,
-- unlike erp_fixed_assets).
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('fm_assets', 'other', 'asset_name', 'notes', NULL, 'org_id', 'created_by_id', NULL);

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.fm_assets
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

-- ─── firm_engagements ───────────────────────────────────────────────────
-- status is 4-value free text ('active'|'on_hold'|'completed'|
-- 'terminated'), not boolean -- active_column NULL. leadPartnerUserId is
-- the real owner.
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('firm_engagements', 'other', 'title', 'scope_of_work', NULL, 'org_id', 'lead_partner_user_id', NULL);

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.firm_engagements
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

-- ─── construction_rfis ──────────────────────────────────────────────────
-- Registered as asset_type 'task' -- an RFI is a request needing an
-- answer/action, same reasoning as pms_issues above. status is a real
-- Postgres enum (construction_rfi_status), not boolean -- active_column
-- NULL. assignedToId (who currently owns answering it) used over
-- raisedById (the creator), matching erp_purchase_orders' owner_column
-- precedent.
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('construction_rfis', 'task', 'subject', 'question', NULL, 'org_id', 'assigned_to_id', NULL);

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.construction_rfis
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();
