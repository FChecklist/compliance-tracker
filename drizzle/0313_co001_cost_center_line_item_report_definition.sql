-- CO-001 "Cost Center Line Item Display" (SAP KSB1 equivalent) --
-- sap_mapping.sqlite/sap_reports, id='CO-001', module CO, engine_track=
-- calculation, veridian_mapping_status='EXTEND_EXISTING(erp-accounting-
-- service.ts:listJournalEntries)'. Seeds a single platform-wide
-- compliance.report_definitions row (org_id = NULL, created_by = 'system'),
-- following the exact executionType='external_service' precedent
-- drizzle/0183_sales_report_definitions.sql established.
--
-- Real implementation: erp-accounting-service.ts's new
-- listJournalEntryLinesByCostCenter() -- see that function's own header
-- comment. No new schema -- erp_journal_entry_lines already carries
-- costCenterId (Wave 52); this is pure aggregation over existing columns.

INSERT INTO compliance.report_definitions
  (org_id, name, description, category, classifications, periodicity, periodicity_config, execution_type, execution_config, output_formats, status, data_gap_note, created_by)
VALUES
  (NULL, 'Cost Center Line Item Display', 'Every posted journal-entry line that carries a cost center, showing both the GL account and the cost center on one row -- the drill-down a controller reaches for after spotting a variance on a cost-center summary, without switching to a second GL-only line-item report.', 'software_report', '["financial","org_specific"]'::jsonb, 'on_demand', NULL, 'external_service', '{"kind":"external_service","sourceService":"erp-accounting-service.ts","sourceFunction":"listJournalEntryLinesByCostCenter","requiredParams":[]}'::jsonb, '["table"]'::jsonb, 'built', NULL, 'system');
