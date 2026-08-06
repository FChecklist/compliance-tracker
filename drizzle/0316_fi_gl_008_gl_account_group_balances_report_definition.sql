-- FI-GL-008 "G/L Account Group Balances Summary" (SAP-equivalent) --
-- sap_mapping.sqlite/sap_reports, id='FI-GL-008', module FI-GL,
-- engine_track=calculation, veridian_mapping_status='EXTEND_EXISTING
-- (erp-accounting-service.ts:listAccounts + trialBalance)'. Seeds a single
-- platform-wide compliance.report_definitions row (org_id = NULL,
-- created_by = 'system'), following the exact executionType=
-- 'external_service' precedent drizzle/0183_sales_report_definitions.sql
-- established.
--
-- Real implementation: erp-financial-report-service.ts's new
-- glAccountGroupBalancesSummary() -- rolls trialBalance's per-account
-- closing balances up through erpAccounts' real parentAccountId/isGroup
-- tree, the same shape of problem as erp-accounting-service.ts's
-- costCenterHierarchyReport. No new schema.

INSERT INTO compliance.report_definitions
  (org_id, name, description, category, classifications, periodicity, periodicity_config, execution_type, execution_config, output_formats, status, data_gap_note, created_by)
VALUES
  (NULL, 'G/L Account Group Balances Summary', 'Trial Balance''s per-account closing balances rolled up through the real chart-of-accounts group hierarchy (parentAccountId/isGroup), as of a date -- each group node shows its own balance and the total including all descendant accounts.', 'software_report', '["financial","org_specific"]'::jsonb, 'on_demand', NULL, 'external_service', '{"kind":"external_service","sourceService":"erp-financial-report-service.ts","sourceFunction":"glAccountGroupBalancesSummary","requiredParams":["asOfDate"]}'::jsonb, '["table"]'::jsonb, 'built', NULL, 'system');
