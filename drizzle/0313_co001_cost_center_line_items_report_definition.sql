-- CO-001 "Cost Center Line Item Display" (sap_mapping.sqlite gap analysis,
-- sap_reports, id='CO-001', module CO, priority HIGH,
-- veridian_mapping_status='EXTEND_EXISTING(erp-accounting-service.ts:
-- listJournalEntries)'). listJournalEntries already lists journal entries
-- but has no cost-center dimension at all -- this is the SAP KSB1
-- drill-down a controller reaches for after spotting a variance on a cost
-- center summary: one line item showing both the GL account and the cost
-- center together, not a second, separate GL-only line-item view.
--
-- Seeds a single platform-wide compliance.report_definitions row (org_id =
-- NULL, created_by = 'system'), same convention as the sibling FI-GL-002/
-- FI-GL-008/FI-GL-007 migrations in this wave. No schema/column changes --
-- erp_journal_entry_lines.cost_center_id already exists (Wave 52).
--
-- execution_type='external_service' (this is an existing hand-written
-- service function extended in place, not a new formula-registry
-- aggregation) -- see erp-accounting-service.ts's new
-- listJournalEntryLinesByCostCenter() (this same PR) for the real
-- implementation, and src/app/api/erp/reports/cost-center-line-items/
-- route.ts for its real route.
INSERT INTO compliance.report_definitions
  (org_id, name, description, category, classifications, periodicity, periodicity_config, execution_type, execution_config, output_formats, status, data_gap_note, created_by)
VALUES
  (NULL, 'Cost Center Line Item Display', 'Paged listing of every real erp_journal_entry_lines row that carries a cost center (erp_journal_entry_lines.cost_center_id), joined to its journal entry and GL account -- the drill-down view a controller uses to see both "which account" and "which department" on one line, filterable by cost center(s) and date range. SAP KSB1 equivalent.', 'software_report', '["financial","org_specific"]'::jsonb, 'on_demand', NULL, 'external_service', '{"kind":"external_service","sourceService":"erp-accounting-service.ts","sourceFunction":"listJournalEntryLinesByCostCenter","requiredParams":[]}'::jsonb, '["table"]'::jsonb, 'built', NULL, 'system');
