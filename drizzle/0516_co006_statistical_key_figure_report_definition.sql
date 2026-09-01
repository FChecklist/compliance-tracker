-- CO-006 (sap_mapping.sqlite gap analysis, "Statistical Key Figure Report",
-- module CO, BUILD_NEW/LOW). Seeds a single platform-wide
-- compliance.report_definitions row (org_id = NULL, created_by = 'system'),
-- following the exact executionType='external_service' precedent
-- drizzle/0183_sales_report_definitions.sql established and this wave's
-- own sibling PRs (FI-AA-006's 0273, SD-007's 0274) reuse -- see
-- erp-costing-service.ts's new statisticalKeyFigureReport() (this same PR)
-- for the real implementation, and src/app/api/v1/projexa/statistical-key-
-- figure-report/route.ts for its real route.
--
-- status = 'built': the report genuinely runs today against real
-- erp_statistical_key_figure_types/erp_statistical_key_figure_postings/
-- erp_cost_centers/erp_accounting_periods data (0275, this same PR).
-- Honest, disclosed limitation: postings must be entered via
-- postStatisticalKeyFigureValue (this PR's own lightweight create
-- function) before the report shows anything for a given org -- there is
-- no automatic backfill from any other existing table, because no
-- existing table already tracks headcount/square-footage/machine-hours
-- per cost center.

INSERT INTO compliance.report_definitions
  (org_id, name, description, category, classifications, periodicity, periodicity_config, execution_type, execution_config, output_formats, status, data_gap_note, created_by)
VALUES
  (NULL, 'Statistical Key Figure Report', 'Displays statistical key figures (non-financial metrics such as headcount, square meters, or machine hours) posted to cost centers, plan vs actual, with variance -- a verification tool for confirming allocation-basis data before running an overhead allocation cycle.', 'software_report', '["financial"]'::jsonb, 'on_demand', NULL, 'external_service', '{"kind":"external_service","sourceService":"erp-costing-service.ts","sourceFunction":"statisticalKeyFigureReport","requiredParams":["accountingPeriodIds"]}'::jsonb, '["table"]'::jsonb, 'built', NULL, 'system');
