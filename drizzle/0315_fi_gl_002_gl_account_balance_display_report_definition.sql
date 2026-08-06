-- FI-GL-002 "G/L Account Balance Display" (SAP FS10N equivalent,
-- sap_mapping.sqlite gap analysis, sap_reports, id='FI-GL-002', module
-- FI-GL, priority HIGH, veridian_mapping_status='EXTEND_EXISTING'). Per
-- gap_notes this is meant to stay "a direct filter of [trialBalance's]
-- existing output, not new logic" -- the one genuine addition is the
-- opening-balance/period-debit/period-credit breakdown FS10N shows per
-- account, which trialBalance's single asOfDate snapshot doesn't expose.
--
-- Seeds a single platform-wide compliance.report_definitions row (org_id =
-- NULL, created_by = 'system'), same convention as the sibling CO-001/
-- CO-003/FI-GL-008/FI-GL-007 migrations in this wave. No schema/column
-- changes.
--
-- execution_type='external_service' -- see erp-financial-report-service.ts's
-- new glAccountBalanceDisplay() (this same PR) for the real implementation,
-- and src/app/api/erp/reports/gl-account-balance/route.ts for its route.
INSERT INTO compliance.report_definitions
  (org_id, name, description, category, classifications, periodicity, periodicity_config, execution_type, execution_config, output_formats, status, data_gap_note, created_by)
VALUES
  (NULL, 'G/L Account Balance Display', 'Opening balance, period debit total, period credit total, and closing balance for one or more selected G/L accounts over a date range -- the drill-down view a controller uses to trace how an account''s balance moved within a period. SAP FS10N equivalent.', 'software_report', '["financial","org_specific"]'::jsonb, 'on_demand', NULL, 'external_service', '{"kind":"external_service","sourceService":"erp-financial-report-service.ts","sourceFunction":"glAccountBalanceDisplay","requiredParams":["accountIds","fromDate","toDate"]}'::jsonb, '["table"]'::jsonb, 'built', NULL, 'system');
