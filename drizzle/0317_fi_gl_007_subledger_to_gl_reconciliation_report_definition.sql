-- FI-GL-007 "Subledger-to-GL Reconciliation" (sap_mapping.sqlite gap
-- analysis, sap_reports, id='FI-GL-007', module FI-GL, priority MEDIUM,
-- veridian_mapping_status='BUILD_NEW' -- re-verified directly against this
-- repo, not trusted from the gap-analysis file's own citations, per the
-- same-day FI-AP-007 stale-citation finding noted in sibling migrations
-- this wave).
--
-- Real finding: submitSalesInvoice/submitPurchaseInvoice already post a
-- real, balanced journal entry to the org's receivable/payable control
-- account every time an invoice is submitted, so the subledger (each
-- invoice's own outstandingAmount) and the GL (trialBalance's own
-- control-account balance) are two independently-maintained numbers that
-- should always agree -- a non-zero variance is a real, actionable signal.
-- See erp-financial-report-service.ts#subledgerToGlReconciliation's own
-- header comment for the full design and honest scope (AR/AP only --
-- fixed assets are FI-AA-006's separate scope, inventory/stock is
-- confirmed to post no GL entry at all in this codebase today, so it is
-- honestly excluded rather than compared against a number that doesn't
-- exist).
--
-- execution_type='deterministic_formula' -- wired into report-engine-
-- service.ts's FORMULA_REGISTRY as 'subledger_to_gl_reconciliation' (this
-- same PR), not a bespoke external_service route, matching the
-- customer_payment_behavior_dso/vendor_payment_behavior_dpo precedent.
INSERT INTO compliance.report_definitions
  (org_id, name, description, category, classifications, periodicity, periodicity_config,
   execution_type, execution_config, output_formats, status, data_gap_note, created_by)
VALUES
(NULL, 'Subledger-to-GL Reconciliation',
 'Compares each of Accounts Receivable and Accounts Payable''s subledger total (sum of real, non-cancelled invoices'' outstandingAmount, converted at each invoice''s own snapshotted exchange rate) against the GL''s own control-account balance (trialBalance''s receivable/payable row(s)) as of a date, flagging any variance beyond a 0.01 rounding tolerance as a real control-account discrepancy needing investigation. SAP FI-GL reconciliation equivalent.',
 'software_report', '["financial","org_specific"]'::jsonb, 'on_demand', NULL,
 'deterministic_formula', '{"kind":"formula","formulaKey":"subledger_to_gl_reconciliation"}'::jsonb, '["table"]'::jsonb,
 'built', 'Fixed-asset reconciliation is a separate report (FI-AA-006), not included here. Inventory/stock is not included -- confirmed by reading erp-inventory-service.ts directly that stock movements post no journal entry to the GL in this codebase today, so there is no GL stock balance yet to reconcile the stock ledger against.', 'system');
