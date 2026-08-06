-- FI-AR-001 "Customer Line Item Display" (PHASE-2-CROSSREF: sap_mapping.sqlite
-- gap analysis, sap_reports, id='FI-AR-001', module FI, priority HIGH,
-- veridian_mapping_status='EXTEND_EXISTING(erpJournalEntryLines
-- partyType=customer)'). SAP FBL5N equivalent -- the customer-side sibling
-- of the FI-AP-001 migration (0319) in this same wave.
--
-- Seeds a single platform-wide compliance.report_definitions row (org_id =
-- NULL, created_by = 'system'). No schema/column changes.
--
-- execution_type='external_service' -- see erp-accounting-service.ts's new
-- listCustomerLineItems() (this same PR) and
-- src/app/api/erp/reports/customer-line-items/route.ts for the real
-- implementation.
INSERT INTO compliance.report_definitions
  (org_id, name, description, category, classifications, periodicity, periodicity_config, execution_type, execution_config, output_formats, status, data_gap_note, created_by)
VALUES
  (NULL, 'Customer Line Item Display', 'Every real erp_journal_entry_lines row posted against a customer (party_type=customer), joined to its journal entry and GL account, filterable by customer(s) and date range -- the drill-down AR clerks use to investigate what a customer owes and why. SAP FBL5N equivalent.', 'software_report', '["financial","org_specific"]'::jsonb, 'on_demand', NULL, 'external_service', '{"kind":"external_service","sourceService":"erp-accounting-service.ts","sourceFunction":"listCustomerLineItems","requiredParams":[]}'::jsonb, '["table"]'::jsonb, 'built', NULL, 'system');
