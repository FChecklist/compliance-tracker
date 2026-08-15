-- FI-AA-006 (sap_mapping.sqlite gap analysis, "Asset-to-GL Reconciliation",
-- BUILD_NEW/MEDIUM). Seeds a single platform-wide compliance.report_definitions
-- row (org_id = NULL, created_by = 'system'), following the exact
-- executionType='external_service' precedent drizzle/0183_sales_report_definitions.sql
-- established and this wave's own sibling PRs (FI-AR-004's
-- drizzle/0290_fi_ar_004_dunning_list.sql, FI-AP-005's
-- drizzle/0269_ap_payment_proposal_report_definition.sql, FI-AP-008's
-- drizzle/0272_ap_subcontractor_payment_application_status_report_definition.sql)
-- reuse -- see erp-fixed-assets-service.ts's new assetToGlReconciliation()
-- (this same PR) for the real implementation, and src/app/api/v1/projexa/
-- asset-to-gl-reconciliation/route.ts for its real route.
--
-- No schema/column changes accompany this migration -- erp_asset_categories
-- already had assetAccountId/depreciationExpenseAccountId/
-- accumulatedDepreciationAccountId since Wave B (VERIDIAN Review Framework,
-- 2026-07-17); this PR reuses that existing mapping, it does not add it.
--
-- Real discovery this same PR made and fixed (see erp-fixed-assets-
-- service.ts's own header comment for the full writeup): every journal
-- entry submitFixedAsset/runDepreciationBatch/finalizeAssetDisposal ever
-- created sat permanently in GL status 'draft' -- a repo-wide grep found
-- zero callers of submitJournalEntry/markJournalEntrySubmittedFromApproval
-- anywhere in erp-fixed-assets-service.ts before this PR. Fixed at the root
-- (all three call sites now submit through the same submitJournalEntry
-- every manual entry already uses) rather than worked around in the report
-- itself -- a naive reconciliation against draft-only postings would have
-- shown 100% variance for every org, forever.
--
-- status = 'built': the report genuinely runs today against real
-- erp_asset_categories/erp_fixed_assets/erp_journal_entries/
-- erp_journal_entry_lines data. Honest, disclosed limitation (see
-- assetToGlReconciliation's own header comment): erp_fixed_assets has no
-- dated historical snapshot (purchaseCost/accumulatedDepreciation/
-- currentValue always reflect "as of now"), so a historical asOfDate
-- compares a real historical GL balance against today's live sub-ledger
-- totals -- flagged via the response's own isStaleComparison field, not
-- hidden. A category with no GL accounts configured is reported as
-- status: 'not_mapped' per-row rather than silently excluded.

INSERT INTO compliance.report_definitions
  (org_id, name, description, category, classifications, periodicity, periodicity_config, execution_type, execution_config, output_formats, status, data_gap_note, created_by)
VALUES
  (NULL, 'Asset-to-GL Reconciliation', 'Per asset-category comparison of the fixed-asset sub-ledger''s aggregate gross cost, accumulated depreciation, and net book value against the real posted balance of that category''s mapped GL accounts (Asset Account / Accumulated Depreciation Account) -- a month-end control flagging any variance, or an unmapped category, for investigation.', 'software_report', '["financial","construction"]'::jsonb, 'on_demand', NULL, 'external_service', '{"kind":"external_service","sourceService":"erp-fixed-assets-service.ts","sourceFunction":"assetToGlReconciliation","requiredParams":[]}'::jsonb, '["table"]'::jsonb, 'built', NULL, 'system');
