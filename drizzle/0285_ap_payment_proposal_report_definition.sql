-- FI-AP-005 (sap_mapping.sqlite gap analysis, SAP F110 "Payment Proposal
-- List" equivalent, BUILD_NEW/HIGH, Owner directive 2026-07-30). Seeds a
-- single platform-wide compliance.report_definitions row (org_id = NULL,
-- created_by = 'system') for the new AP payment-proposal report, following
-- the exact executionType='external_service' precedent drizzle/
-- 0183_sales_report_definitions.sql already established for "Lead Register"
-- (a row whose real execution is a genuine service function, not the
-- generic deterministic_aggregation engine) -- see erp-invoicing-service.ts's
-- new paymentProposalList() (this same PR) for the real implementation, and
-- src/app/api/v1/projexa/payment-proposal-list/route.ts for its real route.
--
-- status = 'built': the report genuinely runs today against real
-- erp_purchase_invoices/erp_suppliers/erp_supplier_bank_accounts data, with
-- one honest, disclosed limitation (see paymentProposalList's own header
-- comment): SAP F110's early-payment cash-discount figure has no backing
-- field anywhere in this schema (erp_suppliers.defaultPaymentTermsDays is a
-- plain net-due-in-N-days term, not a discount schedule), so no discount
-- column is fabricated -- this is noted in description, not silently
-- dropped.
INSERT INTO compliance.report_definitions
  (org_id, name, description, category, classifications, periodicity, periodicity_config, execution_type, execution_config, output_formats, status, data_gap_note, created_by)
VALUES
  (NULL, 'Payment Proposal List', 'Vendor bills due or overdue for payment as of a given date, grouped by vendor with amount and bank details -- the review worklist before an actual payment run (SAP F110 equivalent). Does not include an early-payment discount figure: no discount-percent/discount-days field exists on erp_suppliers or erp_purchase_invoices, only a plain net-due-in-N-days term.', 'software_report', '["finance","procurement"]'::jsonb, 'on_demand', NULL, 'external_service', '{"kind":"external_service","sourceService":"erp-invoicing-service.ts","sourceFunction":"paymentProposalList","requiredParams":[]}'::jsonb, '["table"]'::jsonb, 'built', NULL, 'system');
