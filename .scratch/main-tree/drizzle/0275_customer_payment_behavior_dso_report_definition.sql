-- FI-AR-006 "Customer Payment Behavior / Days Sales Outstanding (DSO)"
-- (SAP gap analysis -- sap_mapping.sqlite/sap_reports, id='FI-AR-006',
-- module FI, priority HIGH, veridian_mapping_status='BUILD_NEW' --
-- re-verified 2026-07-30 directly against this repo and the live
-- Supabase project, not trusted blindly from the gap-analysis file's own
-- citations -- a same-day spot-check found at least one other row,
-- FI-AP-007, with a stale/fabricated citation).
--
-- Real finding: this schema (erp_journal_entries / erp_payment_entries,
-- both pre-existing since Wave 60/B) has everything needed to derive a
-- real payment-completion date for a fully-paid sales invoice, but no
-- prior code ever read it for this purpose -- arAgingReport (existing)
-- only ever looks at currently-outstanding invoices, never a 'paid' one,
-- and FI-AR-004's dunning list is an active overdue-workflow tool, not a
-- historical metric. This is a genuine BUILD_NEW: no schema change is
-- needed (both real payment-recording paths -- recordSalesInvoicePayment's
-- direct posting and the erp_payment_entries approval workflow -- already
-- carry a real posting_date), only the query, the pure days-to-pay/DSO/
-- reliability formulas, and this report_definitions registration are new.
-- See erp-invoicing-service.ts#customerPaymentBehaviorReport for the full
-- implementation and its own header comment.
--
-- Honest, VERIFIED gap (checked directly via the Supabase MCP against the
-- live project pcrjmlpuqsbocqfwoxod, 2026-07-30, real SELECTs): this org's
-- 5 real 'paid' + 6 'partially_paid' invoices have ZERO matching rows in
-- erp_payment_entries and ZERO erp_journal_entries rows with
-- reference_type IN ('sales_invoice_payment','payment_entry') anywhere in
-- the live database -- every paid/partially_paid status was set directly
-- by a seed script, bypassing both real payment-recording paths. The
-- report's average-days-to-pay/reliability fields are therefore honestly
-- "n/a"/"unknown" for every customer today (never fabricated as 0 or
-- silently hidden) -- this is real, correct, BUILD_NEW code whose
-- real-world usefulness depends on orgs actually using one of the two real
-- payment-recording paths going forward. See PR description for the same
-- disclosure.
--
-- category='software_analysis' (not 'software_report'): the core
-- deliverable is a calculated ratio/index (DSO), matching the SPI/CPI
-- precedent in report-taxonomy.ts's CATEGORY 2, not a plain listing like
-- SD-002's Billing Due List.

INSERT INTO compliance.report_definitions
  (org_id, name, description, category, classifications, periodicity, periodicity_config,
   execution_type, execution_config, output_formats, status, data_gap_note, created_by)
VALUES
(NULL, 'Customer Payment Behavior / DSO',
 'Per-customer historical payment-behavior metric across ALL their invoices (paid and unpaid): real average days-to-pay for invoices with a discoverable real payment-completion date (both real payment-recording paths unioned), the industry-standard aggregate DSO formula (outstanding AR / credit sales in period * period days), and a fixed payment-reliability classification (consistently_early/on_time/late/chronically_late) derived by comparing the two against the customer''s real agreed credit terms. Distinct from AR Aging (point-in-time snapshot of what''s currently owed) and the Dunning List (active overdue workflow) -- this is the only one of the three that reads PAID invoices'' real payment history. SAP FBL5N/DSO-analysis equivalent.',
 'software_analysis', '["financial","org_specific"]'::jsonb, 'on_demand', NULL,
 'deterministic_formula', '{"kind":"formula","formulaKey":"customer_payment_behavior_dso"}'::jsonb, '["table"]'::jsonb,
 'built', NULL, 'system');
