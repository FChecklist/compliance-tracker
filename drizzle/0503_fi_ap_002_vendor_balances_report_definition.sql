-- FI-AP-002 "Vendor Balances" (PHASE-2-CROSSREF: sap_mapping.sqlite gap
-- analysis, sap_reports, id='FI-AP-002', module FI, priority HIGH,
-- veridian_mapping_status='EXTEND_EXISTING(erpSuppliers.creditLimit
-- pattern)'). Summary-level total outstanding balance per vendor -- the
-- launch point before drilling into FI-AP-001's line-item detail for a
-- specific vendor. Pure aggregation over erp_purchase_invoices' own
-- outstanding_amount, grouped by supplier_id, plus each supplier's
-- credit_limit (Wave 84) for at-a-glance reference. No new schema.
--
-- execution_type='external_service' -- see erp-invoicing-service.ts's new
-- vendorBalances() (this same PR) and
-- src/app/api/erp/reports/vendor-balances/route.ts for the real
-- implementation.
INSERT INTO compliance.report_definitions
  (org_id, name, description, category, classifications, periodicity, periodicity_config, execution_type, execution_config, output_formats, status, data_gap_note, created_by)
VALUES
  (NULL, 'Vendor Balances', 'Summary-level total outstanding payable per vendor -- sum of outstanding_amount across every open (submitted/partially_paid/overdue) purchase invoice, grouped by supplier, alongside each supplier''s credit limit if set. Used to see at a glance who the firm owes the most to overall.', 'software_report', '["financial","org_specific"]'::jsonb, 'on_demand', NULL, 'external_service', '{"kind":"external_service","sourceService":"erp-invoicing-service.ts","sourceFunction":"vendorBalances","requiredParams":[]}'::jsonb, '["table"]'::jsonb, 'built', NULL, 'system');
