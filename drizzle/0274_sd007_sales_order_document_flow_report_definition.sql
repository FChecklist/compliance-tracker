-- SD-007 (sap_mapping.sqlite gap analysis, SAP VBFA "Display Document Flow"
-- equivalent, BUILD_NEW/HIGH, re-verified directly against the live repo on
-- 2026-07-30 rather than trusting the gap analysis file's own citations).
-- Seeds a single platform-wide compliance.report_definitions row (org_id =
-- NULL, created_by = 'system') for the new sales-order document-flow
-- report, following the exact executionType='external_service' precedent
-- drizzle/0183_sales_report_definitions.sql established for "Lead Register"
-- and drizzle/0269_ap_payment_proposal_report_definition.sql (FI-AP-005,
-- same day) reused since -- see erp-selling-service.ts's new
-- getSalesOrderDocumentFlow() for the real implementation, and
-- src/app/api/v1/projexa/sales-order-document-flow/[id]/route.ts for its
-- real route.
--
-- COLLISION NOTE (see ai-os/boss/ACTIVE-CLAIMS.yaml for the full writeup):
-- PR #629 built a DIFFERENT function also self-labeled "SD-007 'Claim
-- Timeline'", scoped to the brand-new construction_progress_claims workflow
-- table from that same PR. This report instead covers the pre-existing
-- generic ERP Sales & Distribution chain (erp_quotations/erp_sales_orders/
-- erp_sales_invoices/erp_payment_entries/erp_sales_credit_notes/
-- erp_sales_returns, Priority 15/Wave 60-84) -- no schema/file overlap with
-- PR #629's diff.
--
-- status = 'built': the report genuinely runs today against real
-- erp_quotations/erp_sales_orders/erp_sales_invoices/erp_payment_entries/
-- erp_sales_credit_notes/erp_sales_returns data, using only foreign keys
-- that already existed on main before this migration (no new schema).
-- Honest, disclosed gap: this repo has no post-order "change order"
-- document distinct from a pre-order quotation revision, so the chain
-- cannot show one -- noted in the description, not silently fabricated.
INSERT INTO compliance.report_definitions
  (org_id, name, description, category, classifications, periodicity, periodicity_config, execution_type, execution_config, output_formats, status, data_gap_note, created_by)
VALUES
  (NULL, 'Sales Order Document-Flow Overview', 'Given one sales order, traces the full real chain of linked documents: quotation -> sales order -> sales invoice(s) -> payment entries / credit notes / sales returns raised against those invoices, with dates, amounts, and statuses at every step (SAP VBFA/Document Flow equivalent). Single-document drill-down, not a list report -- requires a salesOrderId parameter. Does not include a post-order "change order" document: this schema only models a pre-order quotation revision (createQuotationRevision), no distinct post-order change-order table exists.', 'software_report', '["sales","project","financial"]'::jsonb, 'on_demand', NULL, 'external_service', '{"kind":"external_service","sourceService":"erp-selling-service.ts","sourceFunction":"getSalesOrderDocumentFlow","requiredParams":["salesOrderId"]}'::jsonb, '["table"]'::jsonb, 'built', NULL, 'system');
