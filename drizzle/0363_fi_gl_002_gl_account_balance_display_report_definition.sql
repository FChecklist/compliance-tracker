-- FI-GL-002 "G/L Account Balances Display" (SAP FS10N equivalent) --
-- sap_mapping.sqlite/sap_reports, id='FI-GL-002', module FI-GL,
-- engine_track=calculation, veridian_mapping_status='EXTEND_EXISTING
-- (erp-financial-report-service.ts:trialBalance)'. Seeds a single
-- platform-wide compliance.report_definitions row (org_id = NULL,
-- created_by = 'system'), following the exact executionType=
-- 'external_service' precedent drizzle/0183_sales_report_definitions.sql
-- established.
--
-- Real implementation: erp-financial-report-service.ts's new
-- glAccountBalanceDisplay() -- a direct filter of trialBalance's existing
-- output plus the opening/period-debit/period-credit breakdown FS10N shows
-- per account, which trialBalance's single asOfDate snapshot doesn't
-- expose. No new schema.

INSERT INTO compliance.report_definitions
  (org_id, name, description, category, classifications, periodicity, periodicity_config, execution_type, execution_config, output_formats, status, data_gap_note, created_by)
VALUES
  (NULL, 'G/L Account Balances Display', 'Per selected GL account: opening balance, period debit/credit movement, and closing balance over a date range -- the same underlying figures Trial Balance already computes, filtered to specific accounts with the period breakdown FS10N shows.', 'software_report', '["financial","org_specific"]'::jsonb, 'on_demand', NULL, 'external_service', '{"kind":"external_service","sourceService":"erp-financial-report-service.ts","sourceFunction":"glAccountBalanceDisplay","requiredParams":["accountIds","fromDate","toDate"]}'::jsonb, '["table"]'::jsonb, 'built', NULL, 'system');
