-- CO-003 "Cost Center Hierarchy Report" (sap_mapping.sqlite gap analysis,
-- sap_reports, id='CO-003', module CO, priority MEDIUM,
-- veridian_mapping_status='EXTEND_EXISTING'). erp_cost_centers already
-- carries a real parent_cost_center_id/is_group tree (Wave 52) but nothing
-- summed child balances up to each parent node until now. Deliberately
-- shallow-tree-friendly per implementation_notes ("do not over-engineer the
-- hierarchy... a simple flat list... is often more practical") -- the
-- recursion handles any depth correctly, but a ten-person firm's real data
-- will only ever be 2-3 levels.
--
-- Seeds a single platform-wide compliance.report_definitions row (org_id =
-- NULL, created_by = 'system'), same convention as the sibling CO-001/
-- FI-GL-002/FI-GL-008/FI-GL-007 migrations in this wave. No schema/column
-- changes -- erp_cost_centers.parent_cost_center_id already exists.
--
-- execution_type='external_service' -- see erp-accounting-service.ts's new
-- costCenterHierarchyReport() (this same PR) for the real implementation,
-- and src/app/api/erp/reports/cost-center-hierarchy/route.ts for its route.
INSERT INTO compliance.report_definitions
  (org_id, name, description, category, classifications, periodicity, periodicity_config, execution_type, execution_config, output_formats, status, data_gap_note, created_by)
VALUES
  (NULL, 'Cost Center Hierarchy Report', 'Rolls up real overhead spending (submitted journal entries against expense accounts, filtered by cost center) from each leaf cost center up through its real parent_cost_center_id tree to every group node above it, so a controller can see both a cost center''s own spend and its group''s total spend in one view.', 'software_report', '["financial","org_specific"]'::jsonb, 'on_demand', NULL, 'external_service', '{"kind":"external_service","sourceService":"erp-accounting-service.ts","sourceFunction":"costCenterHierarchyReport","requiredParams":["fromDate","toDate"]}'::jsonb, '["table"]'::jsonb, 'built', NULL, 'system');
