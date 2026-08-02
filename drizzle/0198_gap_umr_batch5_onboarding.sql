-- GAP-UMR-TABLE-COVERAGE: a real fifth batch of tables onboarded from the
-- grandfather-exempted list onto the generic auto-registration trigger
-- built in drizzle/0152, following Priority 8's drizzle/0161, Priority 10's
-- drizzle/0171, Priority 11's drizzle/0184, and Priority 17's drizzle/0193
-- pattern exactly. 24 genuinely valuable, real named business-object tables
-- picked from the ~303 still carrying the generic "not yet reviewed"
-- placeholder reason in ai-os/registry/asset-registry-coverage.yaml,
-- spanning Compliance core, HR/Sector-regulator compliance trackers, GRC,
-- Sales Engine, VERI Reward, ESG, Company Secretarial, Worker-Agent
-- Governance, e-Signature, and ERP Sales/Purchase transactional documents.
-- Column names verified against each table's real definition in
-- src/lib/db/schema.ts, never guessed.
--
-- Two tables (erp_sales_invoices, erp_purchase_invoices) were explicitly
-- deferred by drizzle/0193's own header note ("reviewed but left for a
-- future batch to keep this pass's real-review bar high per-table rather
-- than rubber-stamping the whole ERP module at once") -- this is that
-- future batch, and both get the exact same erp_purchase_orders/
-- firm_invoices precedent (asset_type 'other', name_column = the row's own
-- integer invoice_number, verified jsonb ->> extraction works the same way
-- it already does for erp_purchase_orders/firm_invoices).
--
-- Deliberately NOT onboarded from this same investigation (same discipline
-- as prior batches' employee_profiles/client_entities/board_meetings
-- exclusions -- reviewed and rejected with a real, specific reason, not
-- silently skipped -- see ai-os/registry/asset-registry-coverage.yaml's
-- updated exempted entries for the full per-table reasoning):
--   legal_arbitration_cases, client_entities, legal_spend_entries,
--   it_dr_backup_verifications, it_dr_failover_tests -- each has a genuine
--   display-name-worthy column (case_title, legal_name, description) but
--   NO direct org_id column -- only indirectly scoped via a parent-table
--   join chain (matterId->legal_matters.orgId, clientId->clients.orgId,
--   drPlanId->it_dr_plans.orgId). Registering with org_column=NULL would
--   wrongly mark every row platform-tier and leak across tenants -- the
--   exact anti-pattern Priority 4 domain B's approval_workflow_step_*/
--   bcm_business_impact_analyses exclusions were already warned against.
--   ai_assistants -- same indirect-scope issue (userId->users.orgId only).
--   board_evaluations -- has a genuine org_id and cycle display-name
--   column, but respondents/actionItems jsonb carries named-individual
--   performance feedback -- the same confidentiality-sensitive shape
--   already excluded for board_meetings/related_party_transactions/
--   posh_complaints/whistleblower_cases, deliberately not bundled into a
--   routine tranche.
--   interview_feedback, performance_reviews -- contain sensitive
--   per-individual evaluation content (rating/feedback/strengths/
--   improvements about a specific candidate or employee) -- same
--   confidentiality class as board_evaluations above.
--   job_applications, problem_tickets -- pure join/relationship records
--   (candidate x job_opening, problem x ticket), no display-name column.
--   sales_commission_plans, firm_client_service_lines, firm_tax_cases,
--   holiday_list_filings, erp_statutory_rules (already exempted) -- compound
--   identity only (no single display-name column the trigger's one
--   name_column pointer can express), same class as Priority 4 domain B's
--   erp_statutory_rules/module_rule_configs exclusions.
--   sales_referral_links -- label is nullable (not a reliable NOT NULL
--   display name); token is a random string, not human-readable.
--   fm_amc_contracts, forge_project_requests, field_service_dispatches,
--   firm_billable_rates, challans, erp_stock_reconciliations,
--   erp_addresses, erp_supplier_portal_links -- no genuine NOT NULL
--   display-name column exists on any of these.
--   sales_commission_accruals, cap_table_events, veri_reward_streaks,
--   veri_reward_referrals, ticket_satisfaction_surveys -- append-only
--   ledger/event-log/state-tracking rows, not named business assets, same
--   class as automation_rule_runs/erp_journal_entries.
--   erp_supplier_bank_accounts -- account_holder_name could serve as a
--   name, but accountNumberEncrypted is genuine banking-credential data --
--   same sensitivity class as api_keys/sso_configurations, deliberately
--   excluded out of caution.
--   ai_agent_directory -- a denormalized read-cache synced from roster.ts,
--   not itself a source-of-truth business object -- same reasoning as
--   worker_agents/computation_engines (app-managed, not this trigger's
--   ON CONFLICT UPDATE model).
--
-- active_column is left NULL wherever a table's status is a multi-value
-- enum/free-text workflow state rather than a genuine TRUE-means-active
-- boolean flag (matching every prior batch's own established discipline).

-- ─── sales_partners ─────────────────────────────────────────────────────
-- PLATFORM-WIDE by design (no org_id column -- partners work across the
-- whole Sales Engine, not scoped to one tenant org) -- org_column=NULL is
-- correct here, same reasoning as module_registry/product_branches. name
-- is NOT NULL. status is a real Postgres enum (sales_partner_status), not
-- boolean -- active_column NULL.
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('sales_partners', 'other', 'name', NULL, NULL, NULL, 'created_by_id', NULL);

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.sales_partners
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

-- ─── veri_reward_achievement_definitions ────────────────────────────────
-- org_id nullable by design (NULL = platform default visible to every org
-- until overridden, same convention as fm_checklist_templates). display_name
-- is NOT NULL. is_active is a genuine TRUE-means-active boolean.
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('veri_reward_achievement_definitions', 'other', 'display_name', 'description', NULL, 'org_id', NULL, 'is_active');

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.veri_reward_achievement_definitions
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

-- ─── esg_metrics ────────────────────────────────────────────────────────
-- org-scoped ESG metric entry (e.g. "Carbon Emissions", "Board Diversity").
-- label is NOT NULL. No status/active or owner column exists.
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('esg_metrics', 'other', 'label', 'note', NULL, 'org_id', NULL, NULL);

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.esg_metrics
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

-- ─── secretarial_audits ─────────────────────────────────────────────────
-- org-scoped secretarial-audit cycle record, same shape/precedent as the
-- already-registered erp_accounting_periods (period_name). period is NOT
-- NULL. status is free text, not boolean -- active_column NULL.
-- auditor_name is free text, not a user FK -- no owner column exists.
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('secretarial_audits', 'task', 'period', NULL, NULL, 'org_id', NULL, NULL);

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.secretarial_audits
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

-- ─── mca_filings ────────────────────────────────────────────────────────
-- org-scoped MCA statutory-form filing record -- registered as asset_type
-- 'task' (a filing that needs to be prepared/filed, same reasoning as
-- compliance_items below). form_type is NOT NULL. status is free text
-- ('preparing'|'ready_to_file'|'filed'), not boolean -- active_column
-- NULL. No owner column exists.
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('mca_filings', 'task', 'form_type', 'description', NULL, 'org_id', NULL, NULL);

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.mca_filings
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

-- ─── hr_compliance_items ────────────────────────────────────────────────
-- org-scoped HR statutory-compliance requirement, same family as the
-- flagship compliance_items below. item is NOT NULL. status is free text
-- ('filed'|'overdue'|'not_due_yet'), not boolean -- active_column NULL.
-- No owner column exists.
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('hr_compliance_items', 'task', 'item', 'governing_law', NULL, 'org_id', NULL, NULL);

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.hr_compliance_items
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

-- ─── irdai_compliance_items ─────────────────────────────────────────────
-- org-scoped IRDAI sector-regulator compliance requirement. requirement is
-- NOT NULL. status is free text, not boolean -- active_column NULL. No
-- owner column exists.
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('irdai_compliance_items', 'task', 'requirement', 'category', NULL, 'org_id', NULL, NULL);

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.irdai_compliance_items
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

-- ─── rbi_compliance_items ───────────────────────────────────────────────
-- org-scoped RBI sector-regulator compliance requirement. circular is NOT
-- NULL. status is free text, not boolean -- active_column NULL. No owner
-- column exists.
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('rbi_compliance_items', 'task', 'circular', 'category', NULL, 'org_id', NULL, NULL);

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.rbi_compliance_items
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

-- ─── sebi_compliance_items ──────────────────────────────────────────────
-- org-scoped SEBI sector-regulator compliance requirement. requirement is
-- NOT NULL. status is free text, not boolean -- active_column NULL. No
-- owner column exists.
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('sebi_compliance_items', 'task', 'requirement', 'linked_module', NULL, 'org_id', NULL, NULL);

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.sebi_compliance_items
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

-- ─── compliance_items ───────────────────────────────────────────────────
-- The platform's own flagship compliance-tracking object -- org-scoped,
-- title is NOT NULL, assigned_to_id is a genuine (nullable) owner. status
-- is a real Postgres enum (compliance_status: pending/in_progress/
-- completed/overdue/not_applicable/draft), not boolean -- active_column
-- NULL. Registered as asset_type 'task' (a real due-date-driven work item,
-- same reasoning as tickets/leave_requests). The single largest and most
-- overdue table in this whole grandfather-exempted list to onboard.
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('compliance_items', 'task', 'title', 'description', NULL, 'org_id', 'assigned_to_id', NULL);

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.compliance_items
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

-- ─── worker_agent_domain_groups ─────────────────────────────────────────
-- PLATFORM-WIDE by design (no org_id column -- a shared Agent Hierarchy
-- Registry catalog, structurally identical to module_registry). name is
-- NOT NULL. This table was explicitly flagged as a ready-to-register
-- deferred follow-up in its own prior exemption note (PR #252) -- picked up
-- here rather than re-investigated from scratch. No status/active or owner
-- column exists.
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('worker_agent_domain_groups', 'other', 'name', 'description', NULL, NULL, NULL, NULL);

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.worker_agent_domain_groups
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

-- ─── esignature_signers ─────────────────────────────────────────────────
-- org-scoped e-signature request signer register -- names a real person,
-- same no-confidentiality-conflict reasoning already applied to
-- posh_committee/fm_visitors. name is NOT NULL. user_id is nullable (only
-- set for internal VERIDIAN-user signers) -- used as owner_column since
-- it's the only user-FK column. status is a 3-value free-text state, not
-- boolean -- active_column NULL.
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('esignature_signers', 'other', 'name', NULL, NULL, 'org_id', 'user_id', NULL);

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.esignature_signers
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

-- ─── contract_compliance_items ──────────────────────────────────────────
-- org-scoped vendor-contract compliance/renewal tracker. vendor_name is
-- NOT NULL. No status/active or owner column exists. Registered as
-- asset_type 'task' (a renewal-date-driven tracked item, same family as
-- compliance_items).
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('contract_compliance_items', 'task', 'vendor_name', 'clause_description', NULL, 'org_id', NULL, NULL);

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.contract_compliance_items
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

-- ─── posh_annual_reports ────────────────────────────────────────────────
-- org-scoped POSH statutory annual-report filing record, same shape as
-- secretarial_audits/mca_filings above. year is NOT NULL. status is free
-- text, not boolean -- active_column NULL. No owner column exists. Not
-- confidentiality-sensitive the way posh_complaints is -- this table only
-- tracks the filing/administrative status of the annual report itself, no
-- individual complaint content.
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('posh_annual_reports', 'task', 'year', 'filed_with', NULL, 'org_id', NULL, NULL);

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.posh_annual_reports
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

-- ─── instruction_commitments ────────────────────────────────────────────
-- org-scoped chat-drift-tracking commitment ("assignee committed to X by
-- Y"). described_action is NOT NULL. assignee_id is a genuine, NOT NULL
-- owner. status is free text ('pending'|'done_as_asked'|'drifted'|
-- 'resolved'), not boolean -- active_column NULL. Registered as asset_type
-- 'task' (a real, resolvable work commitment).
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('instruction_commitments', 'task', 'described_action', NULL, NULL, 'org_id', 'assignee_id', NULL);

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.instruction_commitments
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

-- ─── erp_sales_orders ───────────────────────────────────────────────────
-- org-scoped ERP sales order -- same shape/precedent as the already-
-- registered erp_purchase_orders. so_number is a NOT NULL integer
-- (jsonb ->> extraction to text works the same way already verified for
-- erp_purchase_orders/firm_invoices). created_by_id is a genuine, nullable
-- owner. status is free text, not boolean -- active_column NULL.
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('erp_sales_orders', 'other', 'so_number', NULL, NULL, 'org_id', 'created_by_id', NULL);

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.erp_sales_orders
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

-- ─── erp_quotations ─────────────────────────────────────────────────────
-- org-scoped ERP sales quotation. quotation_number is a NOT NULL integer.
-- created_by_id is a genuine, nullable owner. status is free text, not
-- boolean -- active_column NULL.
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('erp_quotations', 'other', 'quotation_number', NULL, NULL, 'org_id', 'created_by_id', NULL);

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.erp_quotations
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

-- ─── erp_purchase_invoices ──────────────────────────────────────────────
-- org-scoped ERP purchase (supplier) invoice -- explicitly deferred by
-- drizzle/0193's own header note, picked up here. invoice_number is a NOT
-- NULL integer. created_by_id is a genuine, nullable owner. status is a
-- real Postgres enum (erp_invoice_status), not boolean -- active_column
-- NULL.
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('erp_purchase_invoices', 'other', 'invoice_number', NULL, NULL, 'org_id', 'created_by_id', NULL);

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.erp_purchase_invoices
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

-- ─── erp_sales_invoices ─────────────────────────────────────────────────
-- org-scoped ERP sales (customer) invoice -- explicitly deferred by
-- drizzle/0193's own header note, picked up here. invoice_number is a NOT
-- NULL integer (per-org sequence). created_by_id is a genuine, nullable
-- owner. status is a real Postgres enum (erp_invoice_status), not boolean
-- -- active_column NULL.
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('erp_sales_invoices', 'other', 'invoice_number', NULL, NULL, 'org_id', 'created_by_id', NULL);

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.erp_sales_invoices
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

-- ─── erp_rfqs ───────────────────────────────────────────────────────────
-- org-scoped ERP Request For Quotation. rfq_number is a NOT NULL integer.
-- created_by_id is a genuine, nullable owner. status is a real Postgres
-- enum (erp_rfq_status), not boolean -- active_column NULL.
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('erp_rfqs', 'other', 'rfq_number', NULL, NULL, 'org_id', 'created_by_id', NULL);

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.erp_rfqs
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

-- ─── erp_delivery_notes ─────────────────────────────────────────────────
-- org-scoped ERP delivery note. delivery_number is a NOT NULL integer.
-- created_by_id is a genuine, nullable owner. status is free text, not
-- boolean -- active_column NULL.
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('erp_delivery_notes', 'other', 'delivery_number', NULL, NULL, 'org_id', 'created_by_id', NULL);

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.erp_delivery_notes
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

-- ─── erp_purchase_receipts ──────────────────────────────────────────────
-- org-scoped ERP goods receipt note. receipt_number is a NOT NULL integer.
-- created_by_id is a genuine, nullable owner. status is free text, not
-- boolean -- active_column NULL.
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('erp_purchase_receipts', 'other', 'receipt_number', NULL, NULL, 'org_id', 'created_by_id', NULL);

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.erp_purchase_receipts
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

-- ─── erp_supplier_quotations ────────────────────────────────────────────
-- org-scoped supplier-submitted quotation (against an RFQ or logged
-- directly). quotation_number is a NOT NULL integer. created_by_id is a
-- genuine, nullable owner. status is a real Postgres enum
-- (erp_supplier_quotation_status), not boolean -- active_column NULL.
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('erp_supplier_quotations', 'other', 'quotation_number', NULL, NULL, 'org_id', 'created_by_id', NULL);

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.erp_supplier_quotations
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();

-- ─── erp_cycle_count_plans ──────────────────────────────────────────────
-- org-scoped warehouse stock cycle-count campaign master. name is NOT
-- NULL. created_by_id is a genuine, nullable owner. status is free text
-- ('draft'|'active'|'completed'), not boolean -- active_column NULL.
INSERT INTO compliance.asset_registration_config
  (source_table, asset_type, name_column, purpose_column, module_column, org_column, owner_column, active_column)
VALUES
  ('erp_cycle_count_plans', 'other', 'name', NULL, NULL, 'org_id', 'created_by_id', NULL);

CREATE TRIGGER auto_register_asset_trg
  AFTER INSERT OR UPDATE OR DELETE ON compliance.erp_cycle_count_plans
  FOR EACH ROW EXECUTE FUNCTION compliance.auto_register_asset();
