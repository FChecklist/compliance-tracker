-- FI-AP-006 "Vendor Payment History / Payment Behavior Analysis"
-- (SAP gap analysis -- sap_mapping.sqlite/sap_reports, id='FI-AP-006',
-- module FI-AP, priority MEDIUM, veridian_mapping_status='BUILD_NEW',
-- verified 2026-07-30 directly against this repo and the live Supabase
-- project, not trusted blindly from the gap-analysis file's own
-- citations -- see this repo's own recent history of at least one other
-- sap_reports row with a stale/fabricated citation).
--
-- The row's own veridian_gap_notes says this report "mirrors the
-- equally-absent FI-AR-006" (Customer Payment Behavior / DSO). As of this
-- migration, FI-AR-006 is a separate, still-OPEN sibling PR (#645, not yet
-- merged into main) -- this migration's own report_definitions row and the
-- vendorPaymentBehaviorReport() function it points at (see
-- erp-invoicing-service.ts's own header comment on that function) mirror
-- that PR's calculation SHAPE (days-to-pay / a DSO-style ratio / a fixed
-- reliability classification) adapted customer->vendor and DSO->DPO,
-- rather than depending on its not-yet-merged code directly.
--
-- Real finding, genuinely DIFFERENT from the AR side: the AR side has TWO
-- independent real payment-recording paths (a direct-posting function
-- plus the erp_payment_entries approval workflow). The AP/vendor side
-- only has ONE -- erp_payment_entries with paymentType='pay',
-- invoiceType='purchase_invoice' -- there is no direct-posting equivalent
-- anywhere in this codebase for purchase invoices (see
-- releaseSubcontractorRetention's own pre-existing header comment, which
-- already names this exact gap). No schema change is needed either way --
-- only the query, the pure days-to-pay/DPO/reliability formulas, and this
-- report_definitions registration are new.
--
-- Honest, VERIFIED gap (checked directly via the Supabase MCP against the
-- live project pcrjmlpuqsbocqfwoxod, 2026-07-30, real SELECTs): this org's
-- 1 real 'paid' purchase invoice (demo_pi_2001, supplier SteelCorp India
-- Ltd., a real 30-day term) has ZERO matching rows in erp_payment_entries
-- (which has ZERO rows total, of any invoice_type/status, in the live
-- database) and ZERO erp_journal_entries rows with reference_type IN
-- ('purchase_invoice_payment','payment_entry') anywhere -- that invoice's
-- 'paid' status was set directly by a seed script, bypassing the only
-- real payment-recording path. The report's average-days-to-pay/
-- reliability fields are therefore honestly "n/a"/"unknown" for every
-- supplier today (never fabricated as 0 or silently hidden) -- this is
-- real, correct, BUILD_NEW code whose real-world usefulness depends on
-- orgs actually using the erp_payment_entries approval workflow for
-- vendor payments going forward. See PR description for the same
-- disclosure.
--
-- category='software_analysis' (not 'software_report'): the core
-- deliverable is a calculated ratio/index (DPO), matching the SPI/CPI
-- precedent in report-taxonomy.ts's CATEGORY 2, and the same
-- classification FI-AR-006 used for the identically-shaped DSO metric.

INSERT INTO compliance.report_definitions
  (org_id, name, description, category, classifications, periodicity, periodicity_config,
   execution_type, execution_config, output_formats, status, data_gap_note, created_by)
VALUES
(NULL, 'Vendor Payment History / Payment Behavior Analysis',
 'Per-supplier historical payment-behavior metric across ALL their invoices (paid and unpaid): real average days-to-pay for invoices with a discoverable real payment-completion date (the erp_payment_entries approval workflow, the only real vendor payment-recording path on this side), the industry-standard aggregate DPO (Days Payable Outstanding) formula (outstanding AP / credit purchases in period * period days), and a fixed payment-reliability classification (consistently_early/on_time/late/chronically_late) derived by comparing the two against the supplier''s real agreed payment terms. SAP FBL1N/DPO-analysis equivalent.',
 'software_analysis', '["financial","procurement","construction"]'::jsonb, 'on_demand', NULL,
 'deterministic_formula', '{"kind":"formula","formulaKey":"vendor_payment_behavior_dpo"}'::jsonb, '["table"]'::jsonb,
 'built', NULL, 'system');
