-- FI-AR-005 "Customer Credit Exposure" (PHASE-2-CROSSREF: sap_mapping.sqlite
-- gap analysis, sap_reports, id='FI-AR-005', module FI, priority MEDIUM,
-- veridian_mapping_status='EXTEND_EXISTING(erp-invoicing-service.ts
-- creditLimit gate)'). submitSalesInvoice (Wave 84) already gates a single
-- new invoice against a customer's credit_limit -- this is the reporting
-- counterpart showing TOTAL exposure (open AR + open, not-yet-fully-
-- invoiced sales order value) against that same limit for every customer
-- at once. No new schema -- open order value is derived from
-- erp_sales_orders.grand_total minus the grand_total of every non-cancelled
-- erp_sales_invoices row carrying that order's id in sales_order_id
-- (Wave 60).
--
-- execution_type='external_service' -- see erp-invoicing-service.ts's new
-- customerCreditExposure() (this same PR) and
-- src/app/api/erp/reports/customer-credit-exposure/route.ts for the real
-- implementation.
INSERT INTO compliance.report_definitions
  (org_id, name, description, category, classifications, periodicity, periodicity_config, execution_type, execution_config, output_formats, status, data_gap_note, created_by)
VALUES
  (NULL, 'Customer Credit Exposure', 'Total credit risk per customer: open AR balance plus open (not-yet-fully-invoiced) sales order value, compared against the customer''s credit limit with a remaining-headroom and utilization-percentage status (ok/warning/over_limit). Used to decide whether to release a new order for fulfillment.', 'software_report', '["financial","org_specific"]'::jsonb, 'on_demand', NULL, 'external_service', '{"kind":"external_service","sourceService":"erp-invoicing-service.ts","sourceFunction":"customerCreditExposure","requiredParams":[]}'::jsonb, '["table"]'::jsonb, 'built', NULL, 'system');
