-- FI-AR-002 "Customer Balances" (PHASE-2-CROSSREF: sap_mapping.sqlite gap
-- analysis, sap_reports, id='FI-AR-002', module FI, priority HIGH,
-- veridian_mapping_status='EXTEND_EXISTING(erpCustomers + outstandingAmount
-- pattern)'). Summary-level total outstanding balance per customer -- the
-- receivable-side mirror of the FI-AP-002 migration (0321) in this same
-- wave. No new schema.
--
-- execution_type='external_service' -- see erp-invoicing-service.ts's new
-- customerBalances() (this same PR) and
-- src/app/api/erp/reports/customer-balances/route.ts for the real
-- implementation.
INSERT INTO compliance.report_definitions
  (org_id, name, description, category, classifications, periodicity, periodicity_config, execution_type, execution_config, output_formats, status, data_gap_note, created_by)
VALUES
  (NULL, 'Customer Balances', 'Summary-level total outstanding receivable per customer -- sum of outstanding_amount across every open (submitted/partially_paid/overdue) sales invoice, grouped by customer, alongside each customer''s credit limit if set. Used to see at a glance who owes the most overall.', 'software_report', '["financial","org_specific"]'::jsonb, 'on_demand', NULL, 'external_service', '{"kind":"external_service","sourceService":"erp-invoicing-service.ts","sourceFunction":"customerBalances","requiredParams":[]}'::jsonb, '["table"]'::jsonb, 'built', NULL, 'system');
