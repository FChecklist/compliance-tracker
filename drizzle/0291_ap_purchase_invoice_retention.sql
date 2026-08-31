-- FI-AP-007 (sap_mapping.sqlite gap analysis, "Subcontractor Retention
-- Summary", BUILD_NEW/HIGH, Owner directive 2026-07-30).
--
-- IMPORTANT, independently re-verified against this branch's own base
-- 2026-07-30: this row's gap_notes cited a function (applyRetention), a
-- file (construction-valuation-service.ts), and a field
-- (constructionInterimBills.retentionAmount) that were flagged earlier the
-- same day as fabricated/non-existent. Re-checked directly -- all three now
-- genuinely exist (merged separately, PROJEXA_ERP_END_TO_END_REQUIREMENT_
-- ANALYSIS_GAP_FILL_AND_IMPLEMENTATION), but only for AR/client-billing
-- retention (constructionInterimBills), a different table/service/party
-- than this report's real subject (subcontractor/AP billing,
-- erp_purchase_invoices). That table had ZERO retention tracking before
-- this migration -- confirmed by grep across schema.ts/services/*.ts/
-- engines/*.ts. Genuine BUILD_NEW gap on the AP side; the gap_notes'
-- citations just happen to coincidentally name real code for the wrong
-- (AR) side. Recommend correcting sap_mapping.sqlite's gap_notes for this
-- row to point at this migration + erp-invoicing-service.ts's
-- subcontractorRetentionSummary/releaseSubcontractorRetention instead --
-- not done as part of this migration (out of its scope, flagged in the PR
-- description instead).
--
-- retention_percent / retention_amount / retention_released_amount:
-- additive, NOT NULL DEFAULT 0 -- every pre-existing/non-retention invoice
-- is correctly labelled "no retention" (accurate, since this mechanism
-- didn't exist before), matching this table's existing numeric-column
-- convention (subtotal, tax_amount, tds_amount, etc. are all NOT NULL with
-- a default, not nullable). retention_amount is computed and snapshotted
-- at invoice-creation time (see erp-invoicing-service.ts's
-- createPurchaseInvoice + computeRetentionAmount), same snapshot-at-
-- transaction-time discipline as this table's own tds_amount.
-- retention_released_amount is a running total, updated only by
-- releaseSubcontractorRetention. IF NOT EXISTS keeps this safe to re-run,
-- matching this repo's additive-column convention (e.g. 0224's
-- erp_exchange_rates.source).
ALTER TABLE compliance.erp_purchase_invoices
  ADD COLUMN IF NOT EXISTS retention_percent numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS retention_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS retention_released_amount numeric NOT NULL DEFAULT 0;

-- Seeds a single platform-wide compliance.report_definitions row (org_id =
-- NULL, created_by = 'system'), following the exact
-- executionType='external_service' precedent drizzle/
-- 0183_sales_report_definitions.sql already established for "Lead
-- Register" and drizzle/0269_ap_payment_proposal_report_definition.sql
-- (FI-AP-005, same PR wave, same file/domain) -- see erp-invoicing-
-- service.ts's new subcontractorRetentionSummary() for the real
-- implementation, and src/app/api/v1/projexa/subcontractor-retention-
-- summary/route.ts for its real route.
--
-- status = 'built': the report genuinely runs today against real
-- erp_purchase_invoices/erp_suppliers data. Honest, disclosed limitation
-- (see subcontractorRetentionSummary's own header comment): groups by
-- subcontractor (supplier), not by "contract" -- erp_contracts (Wave 71)
-- is Sales/customer-side only, there is no real subcontractor-contract
-- table in this schema to group by instead.
INSERT INTO compliance.report_definitions
  (org_id, name, description, category, classifications, periodicity, periodicity_config, execution_type, execution_config, output_formats, status, data_gap_note, created_by)
VALUES
  (NULL, 'Subcontractor Retention Summary', 'Per-subcontractor summary of retention withheld from bills to date, how much has been released, and how much remains held -- the review worklist before releasing retention at practical completion or after the defects-liability period. Groups by subcontractor (supplier), not by contract: this schema has no subcontractor-contract table to group by instead (erp_contracts is Sales/customer-side only).', 'software_report', '["finance","procurement","construction"]'::jsonb, 'on_demand', NULL, 'external_service', '{"kind":"external_service","sourceService":"erp-invoicing-service.ts","sourceFunction":"subcontractorRetentionSummary","requiredParams":[]}'::jsonb, '["table"]'::jsonb, 'built', NULL, 'system');
