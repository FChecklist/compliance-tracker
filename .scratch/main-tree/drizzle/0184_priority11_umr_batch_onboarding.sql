-- Priority 11 (GAP-UMR-TABLE-COVERAGE): a real third batch of tables
-- onboarded from the grandfather-exempted list onto the generic
-- auto-registration trigger built in drizzle/0152, following Priority
-- 8's drizzle/0161 and Priority 10's drizzle/0171 pattern exactly. 22
-- genuinely valuable, real business-asset tables picked from the 340
-- still carrying the generic "not yet reviewed" placeholder reason in
-- ai-os/registry/asset-registry-coverage.yaml -- prioritizing real named
-- business objects (masters, registers, matters, plans, templates,
-- requests) over join/log/event/child-detail tables, spanning Company
-- Secretarial, Legal, GRC, IT/DR, HR, PMS, Customer Service/ITSM, CLM,
-- Facilities, Construction, and Interior Design modules so no single
-- domain dominates this pass. Column names verified against each
-- table's real definition in src/lib/db/schema.ts, never guessed.
--
-- Deliberately NOT onboarded from this same investigation (same
-- discipline as Priority 10's employee_profiles exclusion -- reviewed
-- and rejected with a real reason, not silently skipped):
--   client_entities, legal_arbitration_cases -- no direct org_id column
--     (only reachable via a parent FK join; force-mapping org_column
--     would wrongly register them platform-tier and leak across tenants).
--   challans -- has org_id but no genuine display-name column
--     (challanSerialNumber is a nullable bank-reference field, not a title).
--   secretarial_audits, mca_filings -- no single genuine per-row display
--     name (period/formType are shared type-slugs repeated across many
--     rows for the same org, not a unique identity).
--   related_party_transactions, posh_complaints, whistleblower_cases --
--     confidentiality-sensitive content (classification defaults to
--     'board_only'/'confidential', explicitly designed to hold no case
--     detail) -- same sensitivity class already applied to api_keys/
--     sso_configurations, deliberately not bundled into a routine tranche.
--   fde_requests, job_applications, performance_reviews, fm_amc_contracts
--     -- no single genuine display-name column (log-shaped text, or
--     identity is a compound FK pair rather than a name).
--
-- active_column is left NULL wherever a table's status is a multi-value
-- enum/free-text workflow state rather than a genuine TRUE-means-active
-- boolean flag (matching drizzle/0161 and drizzle/0171's own established
-- discipline) -- the trigger's `(row_data ->> cfg.active_column) = 'false'`
-- check only means what it says for a real boolean-shaped column, and
-- force-fitting an enum there would silently misreport status for every
-- non-boolean value.

-- ─── directors_kmp ──────────────────────────────────────────────────────
-- isIndependent is a director-classification flag, not TRUE-means-active --
-- active_column NULL. No owner or purpose column exists.
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('directors_kmp', 'other', 'name', NULL, NULL, 'org_id', NULL, NULL);

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.directors_kmp
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

-- ─── cap_table_entries ──────────────────────────────────────────────────
-- No status/active column and no owner column exist on this table.
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('cap_table_entries', 'other', 'holder_name', NULL, NULL, 'org_id', NULL, NULL);

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.cap_table_entries
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

-- ─── company_charges ────────────────────────────────────────────────────
-- status is free text ('open' default), not boolean -- active_column NULL.
-- No owner column exists.
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('company_charges', 'other', 'charge_holder', 'charge_type', NULL, 'org_id', NULL, NULL);

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.company_charges
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

-- ─── legal_vendors ──────────────────────────────────────────────────────
-- status is free text ('active' default), not a real boolean column --
-- active_column NULL (a literal 'false' never appears). No owner column
-- exists.
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('legal_vendors', 'other', 'name', 'current_matter', NULL, 'org_id', NULL, NULL);

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.legal_vendors
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

-- ─── legal_opinions ─────────────────────────────────────────────────────
-- Registered as asset_type 'document' -- has bodyText/generatedAt, same
-- AI-generated-content shape as the already-registered erp_contracts.
-- advisor is free text, not a user FK, so no owner column exists. No
-- status column exists either.
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('legal_opinions', 'document', 'topic', NULL, NULL, 'org_id', NULL, NULL);

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.legal_opinions
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

-- ─── fraud_cases ────────────────────────────────────────────────────────
-- status is free text ('reported' default), not boolean -- active_column
-- NULL. investigator_id is the real, more-specific owner (distinct from
-- recorded_by_id, the creator).
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('fraud_cases', 'other', 'title', 'description', NULL, 'org_id', 'investigator_id', NULL);

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.fraud_cases
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

-- ─── it_dr_plans ────────────────────────────────────────────────────────
-- status is 3-value free text ('active'|'draft'|'retired'), not boolean --
-- active_column NULL. owner_id is the real owner column.
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('it_dr_plans', 'other', 'system_name', 'system_description', NULL, 'org_id', 'owner_id', NULL);

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.it_dr_plans
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

-- ─── posh_committee ─────────────────────────────────────────────────────
-- Unlike posh_complaints/whistleblower_cases (deliberately exempted above
-- for confidential case content), this table's entire purpose is to name
-- real internal-committee members -- no confidentiality conflict. No
-- status/active or owner column exists.
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('posh_committee', 'other', 'member_name', 'role', NULL, 'org_id', NULL, NULL);

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.posh_committee
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

-- ─── pms_sprints ────────────────────────────────────────────────────────
-- status is a real Postgres enum (pms_sprint_status), not boolean --
-- active_column NULL. No owner column exists. Same shape/precedent as the
-- already-registered pms_milestones.
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('pms_sprints', 'other', 'name', 'goal', NULL, 'org_id', NULL, NULL);

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.pms_sprints
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

-- ─── pms_wiki_pages ─────────────────────────────────────────────────────
-- Registered as asset_type 'document' -- a general-purpose wiki page, same
-- shape as the already-registered knowledge_base_pages. updated_by_id is
-- the real owner. No status/active column exists.
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('pms_wiki_pages', 'document', 'title', NULL, NULL, 'org_id', 'updated_by_id', NULL);

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.pms_wiki_pages
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

-- ─── tickets ────────────────────────────────────────────────────────────
-- Registered as asset_type 'task' -- a support ticket needing resolution,
-- same reasoning already applied to leave_requests/pms_issues. status is
-- free text ('open' default), not boolean -- active_column NULL.
-- assignee_id is the real owner.
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('tickets', 'task', 'subject', NULL, NULL, 'org_id', 'assignee_id', NULL);

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.tickets
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

-- ─── problem_records ────────────────────────────────────────────────────
-- ITIL problem/root-cause-analysis register. status is free text ('open'
-- default), not boolean -- active_column NULL. created_by_id is the only
-- owner-shaped column available.
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('problem_records', 'other', 'title', 'root_cause', NULL, 'org_id', 'created_by_id', NULL);

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.problem_records
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

-- ─── clm_contract_templates ─────────────────────────────────────────────
-- Registered as asset_type 'document' -- a contract template, same
-- reasoning already applied to erp_contracts. is_active is a genuine
-- TRUE-means-active flag.
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('clm_contract_templates', 'document', 'name', 'description', NULL, 'org_id', 'created_by_id', 'is_active');

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.clm_contract_templates
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

-- ─── clm_clauses ────────────────────────────────────────────────────────
-- Registered as asset_type 'document' -- has bodyText, a contract-clause
-- library entry, same document-shaped precedent as erp_contracts/
-- legal_opinions. is_standard means "requires legal review", not active/
-- inactive -- active_column NULL, not force-fit.
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('clm_clauses', 'document', 'title', 'category', NULL, 'org_id', 'created_by_id', NULL);

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.clm_clauses
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

-- ─── fm_checklist_templates ─────────────────────────────────────────────
-- is_active is a genuine TRUE-means-active flag. created_by_id is nullable
-- (platform-seeded rows have no human author) -- the owner_column pointer
-- still works, the trigger simply reads NULL for those rows. org_id is
-- also nullable by design (NULL = platform-seeded library row, non-null =
-- an org's own fork) -- a real direct column, not an indirect join.
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('fm_checklist_templates', 'other', 'name', 'description', NULL, 'org_id', 'created_by_id', 'is_active');

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.fm_checklist_templates
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

-- ─── fm_visitors ────────────────────────────────────────────────────────
-- Front-desk visitor master register (distinct from the per-visit
-- fm_visitor_logs). No status/active or owner column exists.
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('fm_visitors', 'other', 'full_name', 'company_or_org', NULL, 'org_id', NULL, NULL);

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.fm_visitors
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

-- ─── esignature_requests ────────────────────────────────────────────────
-- Registered as asset_type 'document' -- an e-signature request wrapper
-- around a document/contract. status is 5-value free text ('pending'
-- default), not boolean -- active_column NULL. created_by_id is nullable
-- but the only owner-shaped column available.
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('esignature_requests', 'document', 'title', NULL, NULL, 'org_id', 'created_by_id', NULL);

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.esignature_requests
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

-- ─── performance_review_cycles ──────────────────────────────────────────
-- status is a real Postgres enum (performance_review_cycle_status), not
-- boolean -- active_column NULL. created_by_id is the real owner.
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('performance_review_cycles', 'other', 'name', NULL, NULL, 'org_id', 'created_by_id', NULL);

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.performance_review_cycles
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

-- ─── construction_boqs ──────────────────────────────────────────────────
-- Bill of Quantities register, a versioned master object. status is a real
-- Postgres enum (construction_boq_status), not boolean -- active_column
-- NULL. created_by_id used over approved_by_id (nullable, only set later).
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('construction_boqs', 'other', 'title', NULL, NULL, 'org_id', 'created_by_id', NULL);

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.construction_boqs
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

-- ─── construction_kpi_definitions ───────────────────────────────────────
-- KPI metric definition register. period is a real Postgres enum
-- (construction_kpi_period), not boolean -- active_column NULL. owner_id
-- is the real, specific owner column.
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('construction_kpi_definitions', 'other', 'metric_name', NULL, NULL, 'org_id', 'owner_id', NULL);

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.construction_kpi_definitions
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

-- ─── interior_mood_boards ───────────────────────────────────────────────
-- status is a real Postgres enum (interior_mood_board_status), not
-- boolean -- active_column NULL. created_by_id is the real owner.
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('interior_mood_boards', 'other', 'title', 'description', NULL, 'org_id', 'created_by_id', NULL);

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.interior_mood_boards
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

-- ─── interior_floor_plans ───────────────────────────────────────────────
-- status is 2-value free text ('draft'|'final'), not boolean --
-- active_column NULL (a literal 'false' never appears). created_by_id is
-- the real owner. Distinct master object from its child
-- interior_floor_plan_rooms.
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('interior_floor_plans', 'other', 'name', NULL, NULL, 'org_id', 'created_by_id', NULL);

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.interior_floor_plans
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();
