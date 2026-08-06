-- FI-GL-008 (EXTEND_EXISTING, sap_mapping.sqlite gap analysis, sap_reports,
-- module FI-GL). erp_accounts already carries the same real
-- parent_account_id/is_group hierarchy pattern as erp_cost_centers --
-- trialBalance gives per-account closing balances, but nothing rolls those
-- up to each group node until now. Recursive roll-up mirrors CO-003's
-- costCenterHierarchyReport (same shape of problem, different tree).
--
-- Seeds a single platform-wide compliance.report_definitions row (org_id =
-- NULL, created_by = 'system'), same convention as the sibling CO-001/
-- CO-003/FI-GL-002/FI-GL-007 migrations in this wave. No schema/column
-- changes -- erp_accounts.parent_account_id already exists.
--
-- execution_type='external_service' -- see erp-financial-report-service.ts's
-- new glAccountGroupBalancesSummary() (this same PR) for the real
-- implementation, and src/app/api/erp/reports/gl-account-group-balances/
-- route.ts for its route.
INSERT INTO compliance.report_definitions
  (org_id, name, description, category, classifications, periodicity, periodicity_config, execution_type, execution_config, output_formats, status, data_gap_note, created_by)
VALUES
  (NULL, 'G/L Account Group Balances Summary', 'Rolls up each account''s closing balance (from trialBalance) up through its real parent_account_id tree, so a controller can see both an individual account''s balance and its group total (e.g. all "Bank Accounts" or all "Trade Payables") in one view.', 'software_report', '["financial","org_specific"]'::jsonb, 'on_demand', NULL, 'external_service', '{"kind":"external_service","sourceService":"erp-financial-report-service.ts","sourceFunction":"glAccountGroupBalancesSummary","requiredParams":["asOfDate"]}'::jsonb, '["table"]'::jsonb, 'built', NULL, 'system');
