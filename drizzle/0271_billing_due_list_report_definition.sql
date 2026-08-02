-- SD-002 "Billing Due List" (SAP VF04 equivalent) -- gap analysis
-- sap_mapping.sqlite/sap_reports, id='SD-002', module SD, priority HIGH,
-- veridian_mapping_status='BUILD_NEW' (re-verified 2026-07-30 directly
-- against this repo, not trusted blindly from the gap-analysis file's own
-- citations -- a separate spot-check the same day found at least one other
-- row, FI-AP-007, with a stale/fabricated citation).
--
-- Real finding: erp_contract_billing_schedules (Wave 71,
-- erp-contract-service.ts) already models exactly what VF04 needs --
-- billingFrequency (including 'milestone'), nextBillingDate, amount, and a
-- nullable lastInvoiceId pointer -- but nothing in the codebase ever
-- QUERIED "which schedules are due and not yet invoiced" (addBillingSchedule
-- only ever creates a row; erp-contract-service.ts had no due-list read and
-- no invoice-generation write at all before this migration's companion
-- code change). This is a genuine BUILD_NEW: the schema anchor already
-- existed and is REUSED as-is, but the due-list query, the formula
-- registration, and the "generate the invoice" action are all new.
--
-- 1) billing_schedule_id on erp_sales_invoices: a small, nullable pointer
--    column, same additive convention as that table's existing
--    sales_order_id/project_id pointers (Priority 15/Wave 120) -- lets an
--    invoice generated from a billing schedule be traced back to it, which
--    generateInvoiceFromBillingSchedule() (erp-contract-service.ts, same
--    PR) sets.
-- 2) The report_definitions row itself: execution_type=
--    'deterministic_formula', formulaKey='billing_due_list' -- see
--    report-engine-service.ts's computeBillingDueList()/FORMULA_REGISTRY
--    entry (same PR). classifications include 'financial' so
--    deriveReportDomainFromClassifications() gates this behind the ERP
--    domain, matching erp-contract-service.ts's own requireErpEnabled()
--    gate on the underlying data.
--
-- Honest gap left open (see PR description): the gap analysis's
-- implementation_notes describe a fuller "milestone achieved -> claim
-- drafted -> submitted -> client-approved -> invoiced" workflow. No schema
-- exists for the intermediate claim/approval stages (erp_contract_billing_
-- schedules has no status enum for that) -- this report surfaces the two
-- states the real schema supports today: due-and-not-yet-invoiced (below)
-- and invoiced (lastInvoiceId set, excluded from the worklist).

ALTER TABLE "compliance"."erp_sales_invoices"
  ADD COLUMN IF NOT EXISTS "billing_schedule_id" text;

INSERT INTO compliance.report_definitions
  (org_id, name, description, category, classifications, periodicity, periodicity_config, execution_type, execution_config, output_formats, status, data_gap_note, created_by)
VALUES
(NULL, 'Billing Due List',
 'Construction/PROJEXA equivalent of SAP VF04 -- contract billing schedules (milestone or recurring) that are active, past or at their next billing date, and not yet invoiced. An actionable worklist: each row carries the Schedule ID and Contract ID needed to call POST /api/erp/contracts/{contractId}/billing-schedules/{scheduleId}/generate-invoice and raise the real sales invoice directly from here.',
 'software_report', '["financial","sales","construction"]'::jsonb, 'daily', NULL,
 'deterministic_formula', '{"kind":"formula","formulaKey":"billing_due_list"}'::jsonb, '["table"]'::jsonb,
 'built', NULL, 'system');
