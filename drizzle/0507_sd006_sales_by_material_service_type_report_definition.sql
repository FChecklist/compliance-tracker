-- SD-006 "Sales by Material / Service Type" (sap_mapping.sqlite gap
-- analysis, sap_reports, id='SD-006', module SD, priority MEDIUM,
-- veridian_mapping_status='BUILD_NEW' -- re-verified 2026-07-30 directly
-- against this repo, not trusted from the gap-analysis file's own
-- citations). Per that row's own implementation_notes, renamed for
-- construction: "Revenue by Service Type" -- the material master
-- (erp_items, grouped via erp_item_groups) maps to a construction firm's
-- service catalog/work type (demolition, joinery, painting, electrical,
-- project-management-fee, ...).
--
-- Real finding: erp_sales_invoice_items.item_id (Wave 60) already exists
-- and is nullable -- the schema already supports grouping revenue by
-- material/service-item type, but no report function anywhere performed
-- this specific aggregation before now. Genuine BUILD_NEW: no new schema,
-- a new query + grouping only.
--
-- execution_type='deterministic_formula' -- wired into report-engine-
-- service.ts's FORMULA_REGISTRY as 'sales_by_material_service_type' (this
-- same PR).
INSERT INTO compliance.report_definitions
  (org_id, name, description, category, classifications, periodicity, periodicity_config,
   execution_type, execution_config, output_formats, status, data_gap_note, created_by)
VALUES
(NULL, 'Sales by Material / Service Type',
 'Groups real billing line items (erp_sales_invoice_items) by material/service item or item group over a date range, summing net revenue and (optionally) computing gross profit/margin using each item''s standard buying rate as a cost proxy. Lines with no item/item-group link (a free-text service description) are bucketed as "Unassigned", never dropped. SAP SD material/service revenue analysis equivalent.',
 'software_report', '["financial","org_specific"]'::jsonb, 'on_demand', NULL,
 'deterministic_formula', '{"kind":"formula","formulaKey":"sales_by_material_service_type"}'::jsonb, '["table"]'::jsonb,
 'built', 'Cost of Goods Sold (when includeCost is requested) is a PROXY (erp_items.standard_buying_rate x quantity), not a real weighted-average cost from the stock ledger -- erp_stock_ledger_entries has no per-invoice-line cost allocation in this schema. Disclosed in the report''s own note field, not hidden.', 'system');
