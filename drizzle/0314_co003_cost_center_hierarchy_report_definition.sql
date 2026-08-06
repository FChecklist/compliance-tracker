-- CO-003 "Cost Center Hierarchy Report" (SAP-equivalent) --
-- sap_mapping.sqlite/sap_reports, id='CO-003', module CO, engine_track=
-- calculation, veridian_mapping_status='EXTEND_EXISTING(erp-accounting-
-- service.ts:listCostCenters)'. Seeds a single platform-wide
-- compliance.report_definitions row (org_id = NULL, created_by = 'system'),
-- following the exact executionType='external_service' precedent
-- drizzle/0183_sales_report_definitions.sql established.
--
-- Real implementation: erp-accounting-service.ts's new
-- costCenterHierarchyReport() -- see that function's own header comment.
-- No new schema -- erp_cost_centers already carries the real
-- parent_cost_center_id/is_group tree (Wave 52); this rolls submitted
-- expense-account postings up through it.

INSERT INTO compliance.report_definitions
  (org_id, name, description, category, classifications, periodicity, periodicity_config, execution_type, execution_config, output_formats, status, data_gap_note, created_by)
VALUES
  (NULL, 'Cost Center Hierarchy Report', 'Overhead spending (expense-account postings tagged with a cost center) rolled up through the real cost-center parent/child tree, showing each node''s own spend and its total including all descendants.', 'software_report', '["financial","org_specific"]'::jsonb, 'on_demand', NULL, 'external_service', '{"kind":"external_service","sourceService":"erp-accounting-service.ts","sourceFunction":"costCenterHierarchyReport","requiredParams":["fromDate","toDate"]}'::jsonb, '["table"]'::jsonb, 'built', NULL, 'system');
