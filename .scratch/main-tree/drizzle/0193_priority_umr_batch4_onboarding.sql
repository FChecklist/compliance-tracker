-- GAP-UMR-TABLE-COVERAGE: a real fourth batch of tables onboarded from the
-- grandfather-exempted list onto the generic auto-registration trigger
-- built in drizzle/0152, following Priority 8's drizzle/0161, Priority 10's
-- drizzle/0171, and Priority 11's drizzle/0184 pattern exactly. 23
-- genuinely valuable, real business-asset tables picked from the 326 still
-- carrying the generic "not yet reviewed" placeholder reason in
-- ai-os/registry/asset-registry-coverage.yaml -- prioritizing real named
-- business objects (masters, registers, plans, schemes, invoices) over
-- join/log/event/child-detail tables, spanning ERP Finance/HR, GST Engine,
-- CA-Firm billing, PMS, Construction, Interior Design, and Facilities so no
-- single domain dominates this pass. Column names verified against each
-- table's real definition in src/lib/db/schema.ts, never guessed.
--
-- Deliberately NOT onboarded from this same investigation (same discipline
-- as Priority 10's employee_profiles / Priority 11's client_entities
-- exclusions -- reviewed and rejected with a real reason, not silently
-- skipped):
--   board_meetings -- classification defaults to 'board_only', the exact
--     same confidentiality-sensitive shape already excluded for
--     related_party_transactions/posh_complaints/whistleblower_cases in
--     Priority 11 -- deliberately not bundled into a routine tranche.
--   holiday_list_filings, it_dr_failover_tests -- no single genuine
--     per-row display-name column (state+year and drPlanId+testDate are
--     compound identities, not a name), same class as Priority 11's
--     secretarial_audits/mca_filings exclusion.
--   erp_sales_invoices, erp_purchase_invoices and all erp_*_items/
--     erp_*_line_items tables -- reviewed but left for a future batch to
--     keep this pass's real-review bar high per-table rather than
--     rubber-stamping the whole ERP module at once; firm_invoices covers
--     the same "named invoice header" precedent this batch already
--     establishes.
--   pms_wiki_pages's sibling child tables (pms_meeting_agenda_items,
--     pms_meeting_outcomes, pms_meeting_participants) -- no org_id column
--     (scoped only via parent meetingId chain), same cross-tenant-leak
--     reasoning as Priority 4 domain B's approval_workflow_step_* exclusions.
--
-- active_column is left NULL wherever a table's status is a multi-value
-- enum/free-text workflow state rather than a genuine TRUE-means-active
-- boolean flag (matching drizzle/0161/0171/0184's own established
-- discipline). Two tables in this batch (erp_accounts, erp_fiscal_years)
-- have a boolean column that is the INVERSE of "active" (is_frozen,
-- is_closed -- true means inactive/frozen, not active) -- force-fitting
-- either as active_column would invert the trigger's `= 'false'` check and
-- silently mark every genuinely active row as inactive, so both are left
-- NULL, extending the enum-vs-boolean discipline to inverse-boolean columns
-- too.

-- ─── erp_accounts ───────────────────────────────────────────────────────
-- Chart-of-Accounts entry, a real named financial master. is_frozen is the
-- INVERSE of active (true=frozen/inactive) -- active_column NULL, not
-- force-fit. No owner column exists.
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('erp_accounts', 'other', 'account_name', NULL, NULL, 'org_id', NULL, NULL);

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.erp_accounts
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

-- ─── erp_cost_centers ───────────────────────────────────────────────────
-- No status/active or owner column exists.
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('erp_cost_centers', 'other', 'name', NULL, NULL, 'org_id', NULL, NULL);

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.erp_cost_centers
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

-- ─── erp_fiscal_years ───────────────────────────────────────────────────
-- is_closed is the INVERSE of active (true=closed/inactive) -- same
-- inverse-boolean trap as erp_accounts.is_frozen -- active_column NULL.
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('erp_fiscal_years', 'other', 'year_name', NULL, NULL, 'org_id', NULL, NULL);

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.erp_fiscal_years
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

-- ─── erp_accounting_periods ─────────────────────────────────────────────
-- status is a real Postgres enum (erp_period_status: open/closed), not
-- boolean -- active_column NULL. closed_by_id is a completion-time actor
-- (nullable, only set once the period closes), not a genuine owner --
-- same reasoning Priority 11 applied preferring created-time owners over
-- completion-time actors -- so owner_column NULL (no created_by_id exists
-- on this table).
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('erp_accounting_periods', 'other', 'period_name', NULL, NULL, 'org_id', NULL, NULL);

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.erp_accounting_periods
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

-- ─── erp_budgets ────────────────────────────────────────────────────────
-- status is a real Postgres enum (erp_budget_status: draft/submitted), not
-- boolean -- active_column NULL. created_by_id is nullable but the only
-- owner-shaped column available, same as esignature_requests precedent.
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('erp_budgets', 'other', 'name', NULL, NULL, 'org_id', 'created_by_id', NULL);

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.erp_budgets
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

-- ─── erp_tax_templates ──────────────────────────────────────────────────
-- No status/active or owner column exists.
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('erp_tax_templates', 'other', 'name', NULL, NULL, 'org_id', NULL, NULL);

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.erp_tax_templates
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

-- ─── erp_item_groups ────────────────────────────────────────────────────
-- No status/active or owner column exists.
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('erp_item_groups', 'other', 'group_name', NULL, NULL, 'org_id', NULL, NULL);

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.erp_item_groups
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

-- ─── erp_asset_categories ───────────────────────────────────────────────
-- No status/active or owner column exists.
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('erp_asset_categories', 'other', 'category_name', NULL, NULL, 'org_id', NULL, NULL);

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.erp_asset_categories
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

-- ─── erp_salary_components ──────────────────────────────────────────────
-- is_statutory is a classification flag (PF/ESI/PT vs regular pay
-- component), not TRUE-means-active -- active_column NULL. No owner column
-- exists.
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('erp_salary_components', 'other', 'name', NULL, NULL, 'org_id', NULL, NULL);

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.erp_salary_components
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

-- ─── erp_subscription_plans ─────────────────────────────────────────────
-- is_active is a genuine TRUE-means-active flag. No owner column exists
-- (customerId lives on the erp_subscriptions row, not the plan itself).
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('erp_subscription_plans', 'other', 'name', NULL, NULL, 'org_id', NULL, 'is_active');

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.erp_subscription_plans
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

-- ─── gst_gstin_master ───────────────────────────────────────────────────
-- PLATFORM-WIDE by design (no org_id column -- a shared cache of public
-- GSTIN lookups, keyed by the GSTIN itself, reused across every org that
-- looks up the same counterparty) -- org_column=NULL is correct here, same
-- reasoning as module_registry/product_branches/subscription_plans.
-- legal_name/trade_name are both nullable (unknown until a successful
-- lookup), so the genuine always-present per-row identity is the gstin
-- column itself (NOT NULL, unique) -- used as name_column rather than a
-- nullable field, same principle that ruled out challans.challan_serial_
-- number in Priority 11. lookup_status is 3-value free text, not boolean --
-- active_column NULL. No owner column exists.
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('gst_gstin_master', 'other', 'gstin', NULL, NULL, NULL, NULL, NULL);

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.gst_gstin_master
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

-- ─── gst_hsn_master ─────────────────────────────────────────────────────
-- PLATFORM-WIDE by design (no org_id column -- a shared HSN/SAC -> GST-rate
-- reference table every org reads the same rows from) -- org_column=NULL
-- is correct here, same reasoning as gst_gstin_master above. hsn_sac_code
-- is NOT NULL and unique, the genuine per-row identity -- used as
-- name_column. is_service is a goods-vs-service classification flag, not
-- TRUE-means-active -- active_column NULL. No owner column exists.
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('gst_hsn_master', 'other', 'hsn_sac_code', NULL, NULL, NULL, NULL, NULL);

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.gst_hsn_master
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

-- ─── gst_source_profiles ────────────────────────────────────────────────
-- org-scoped import-source column-mapping profile -- name has a real
-- default ('Default') but is user-renamable per profile. No status/active
-- or owner column exists.
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('gst_source_profiles', 'other', 'name', NULL, NULL, 'org_id', NULL, NULL);

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.gst_source_profiles
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

-- ─── firm_invoices ──────────────────────────────────────────────────────
-- CA-firm client invoice header. invoice_number is the genuine per-row
-- identity (real business document number, not a nullable reference field
-- like challans.challan_serial_number). status is a real Postgres enum
-- (firm_invoice_status: draft/...), not boolean -- active_column NULL.
-- created_by_id is nullable but the only owner-shaped column available.
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('firm_invoices', 'other', 'invoice_number', NULL, NULL, 'org_id', 'created_by_id', NULL);

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.firm_invoices
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

-- ─── pms_saved_views ────────────────────────────────────────────────────
-- Same shape/precedent as the already-registered saved_reports. owned_by_id
-- is a genuine, NOT NULL owner. access (private/team/org) is a visibility
-- scope, not TRUE-means-active -- active_column NULL.
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('pms_saved_views', 'other', 'name', NULL, NULL, 'org_id', 'owned_by_id', NULL);

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.pms_saved_views
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

-- ─── pms_estimate_schemes ───────────────────────────────────────────────
-- No status/active or owner column exists.
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('pms_estimate_schemes', 'other', 'name', NULL, NULL, 'org_id', NULL, NULL);

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.pms_estimate_schemes
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

-- ─── pms_meetings ───────────────────────────────────────────────────────
-- Same shape/precedent as the already-registered veri_meetings, minus the
-- confidentiality concern that ruled out board_meetings above -- this is a
-- plain internal project meeting, no classification column. No status/
-- active or owner column exists.
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('pms_meetings', 'other', 'title', NULL, NULL, 'org_id', NULL, NULL);

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.pms_meetings
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

-- ─── construction_categories ────────────────────────────────────────────
-- WBS/BOQ category master, self-referencing parent for sub-categories --
-- same shape as the already-registered erp_item_groups/erp_asset_categories.
-- No status/active or owner column exists.
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('construction_categories', 'other', 'name', NULL, NULL, 'org_id', NULL, NULL);

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.construction_categories
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

-- ─── construction_activities ────────────────────────────────────────────
-- WBS activity master (planned quantity per activity) -- distinct from its
-- daily-log child construction_work_progress_entries. No status/active or
-- owner column exists.
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('construction_activities', 'other', 'name', NULL, NULL, 'org_id', NULL, NULL);

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.construction_activities
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

-- ─── construction_submittals ────────────────────────────────────────────
-- Registered as asset_type 'task' -- a shop-drawing/spec submittal needing
-- review resolution, same reasoning already applied to tickets/
-- leave_requests. submitted_by_id is a genuine, NOT NULL owner. status is a
-- real Postgres enum (construction_submittal_status), not boolean --
-- active_column NULL.
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('construction_submittals', 'task', 'title', 'spec_section', NULL, 'org_id', 'submitted_by_id', NULL);

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.construction_submittals
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

-- ─── construction_change_orders ─────────────────────────────────────────
-- Registered as asset_type 'task' -- a change order needing approval
-- resolution, same reasoning as construction_submittals above.
-- requested_by_id is a genuine, NOT NULL owner. status is a real Postgres
-- enum (construction_change_order_status), not boolean -- active_column
-- NULL.
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('construction_change_orders', 'task', 'title', 'reason', NULL, 'org_id', 'requested_by_id', NULL);

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.construction_change_orders
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

-- ─── fm_asset_categories ────────────────────────────────────────────────
-- PLATFORM-WIDE by design (no org_id column -- category_key is globally
-- unique, a shared FM asset-category catalog every org's fm_assets rows
-- point into) -- org_column=NULL is correct here, same reasoning as
-- fm_checklist_templates's platform-seeded rows in Priority 11. is_active
-- is a genuine TRUE-means-active flag. No owner column exists.
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('fm_asset_categories', 'other', 'display_name', NULL, NULL, NULL, NULL, 'is_active');

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.fm_asset_categories
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

-- ─── interior_materials ─────────────────────────────────────────────────
-- Material/finish swatch master (color, roughness/metalness render props) --
-- distinct master object from the floor-plan/mood-board tables already
-- registered in Priority 11. No status/active or owner column exists.
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('interior_materials', 'other', 'name', NULL, NULL, 'org_id', NULL, NULL);

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.interior_materials
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();
