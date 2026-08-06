-- FI-AP-003 "Vendor Items -- Aging Report" (PHASE-2-CROSSREF:
-- sap_mapping.sqlite gap analysis, sap_reports, id='FI-AP-003', module FI,
-- priority HIGH, veridian_mapping_status='EXTEND_EXISTING(erp-invoicing-
-- service.ts:arAgingReport pattern)'). The classic AP aging report --
-- every open purchase invoice bucketed by days past due (current/1-30/
-- 31-60/61-90/90+), the AP mirror of the existing arAgingReport. No new
-- schema -- pure aggregation over erp_purchase_invoices' own
-- outstanding_amount/due_date.
--
-- execution_type='external_service' -- see erp-invoicing-service.ts's new
-- apAgingReport() (this same PR) and
-- src/app/api/erp/reports/ap-aging/route.ts for the real implementation.
INSERT INTO compliance.report_definitions
  (org_id, name, description, category, classifications, periodicity, periodicity_config, execution_type, execution_config, output_formats, status, data_gap_note, created_by)
VALUES
  (NULL, 'Vendor Items -- Aging Report', 'Every open (submitted/partially_paid/overdue) purchase invoice bucketed by days past due against its due_date (current/1-30/31-60/61-90/90+), with per-vendor and grand totals. Essential for cash flow planning and avoiding late payments to subcontractors. SAP FBL1N aging-variant equivalent.', 'software_report', '["financial","org_specific"]'::jsonb, 'on_demand', NULL, 'external_service', '{"kind":"external_service","sourceService":"erp-invoicing-service.ts","sourceFunction":"apAgingReport","requiredParams":[]}'::jsonb, '["table"]'::jsonb, 'built', NULL, 'system');
