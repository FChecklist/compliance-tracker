-- FI-GL-007 "Subledger-to-GL Reconciliation" -- gap analysis
-- sap_mapping.sqlite/sap_reports, id='FI-GL-007', module FI-GL,
-- engine_track=calculation, veridian_mapping_status='BUILD_NEW'.
--
-- This is the GENERAL AR+AP version of this SAP concept -- FI-AA-006
-- (Asset-to-GL Reconciliation) is the fixed-asset-specific sibling, already
-- merged separately.
--
-- Real finding: erp-invoicing-service.ts's submitSalesInvoice/
-- submitPurchaseInvoice already post a REAL, balanced journal entry to the
-- org's accountType='receivable'/'payable' control account (found via
-- findControlAccount()) every time an invoice is submitted -- so this
-- reconciliation is genuinely meaningful, not a no-op: the subledger
-- (erp_sales_invoices/erp_purchase_invoices outstandingAmount) and the GL
-- (erp-financial-report-service.ts's trialBalance()) are two
-- independently-maintained numbers that should always agree.
--
-- execution_type='deterministic_formula', formulaKey=
-- 'subledger_to_gl_reconciliation' -- see report-engine-service.ts's
-- computeSubledgerToGlReconciliation()/FORMULA_REGISTRY entry and
-- erp-financial-report-service.ts's subledgerToGlReconciliation() (this same
-- PR) for the real computation. classifications = ["financial",
-- "org_specific"] (the same pair the sibling erp-trial-balance/
-- erp-balance-sheet catalog entries use, report-catalog-service.ts).
--
-- Honest gap left open: inventory/stock (accountType='stock') is NOT
-- included as a third row -- confirmed by reading erp-inventory-service.ts
-- directly, stock receipts/issues never post a journal entry to the GL at
-- all today, so there is no GL stock balance yet to reconcile the stock
-- ledger against.

INSERT INTO compliance.report_definitions
  (org_id, name, description, category, classifications, periodicity, periodicity_config, execution_type, execution_config, output_formats, status, data_gap_note, created_by)
VALUES
(NULL, 'Subledger-to-GL Reconciliation',
 'Month-end close control: compares each real subledger''s own total outstanding balance (Accounts Receivable via erp_sales_invoices, Accounts Payable via erp_purchase_invoices) against its corresponding GL control-account balance (from the Trial Balance). A non-zero variance flags a real problem -- a manual posting bypassing the invoice/payment flow, or a data bug -- before the books are considered reliable. Fixed-asset reconciliation is a separate report (FI-AA-006); inventory/stock is not included because stock movements do not yet post to the GL in this codebase.',
 'software_report', '["financial","org_specific"]'::jsonb, 'on_demand', NULL,
 'deterministic_formula', '{"kind":"formula","formulaKey":"subledger_to_gl_reconciliation"}'::jsonb, '["table"]'::jsonb,
 'built', NULL, 'system');
