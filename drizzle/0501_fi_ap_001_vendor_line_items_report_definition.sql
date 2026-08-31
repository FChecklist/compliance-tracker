-- FI-AP-001 "Vendor Line Item Display" (PHASE-2-CROSSREF: sap_mapping.sqlite
-- gap analysis, sap_reports, id='FI-AP-001', module FI, priority HIGH,
-- veridian_mapping_status='EXTEND_EXISTING(erpJournalEntryLines
-- partyType=supplier)'). Same shape as the CO-001 migration (0313) in this
-- same wave -- SAP FBL1N equivalent, showing every real
-- erp_journal_entry_lines row where party_type='supplier', joined to its
-- journal entry, GL account, and (resolved in application code, since
-- party_id is a polymorphic column with no DB-level FK) the supplier name.
--
-- Seeds a single platform-wide compliance.report_definitions row (org_id =
-- NULL, created_by = 'system'). No schema/column changes --
-- erp_journal_entry_lines.party_type/party_id already exist.
--
-- execution_type='external_service' -- see erp-accounting-service.ts's new
-- listVendorLineItems() (this same PR) and
-- src/app/api/erp/reports/vendor-line-items/route.ts for the real
-- implementation.
INSERT INTO compliance.report_definitions
  (org_id, name, description, category, classifications, periodicity, periodicity_config, execution_type, execution_config, output_formats, status, data_gap_note, created_by)
VALUES
  (NULL, 'Vendor Line Item Display', 'Every real erp_journal_entry_lines row posted against a vendor (party_type=supplier), joined to its journal entry and GL account, filterable by vendor(s) and date range -- the drill-down AP clerks use to investigate a subcontractor invoice or trace a vendor account''s activity. SAP FBL1N equivalent.', 'software_report', '["financial","org_specific"]'::jsonb, 'on_demand', NULL, 'external_service', '{"kind":"external_service","sourceService":"erp-accounting-service.ts","sourceFunction":"listVendorLineItems","requiredParams":[]}'::jsonb, '["table"]'::jsonb, 'built', NULL, 'system');
