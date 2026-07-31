-- Calculation-track engine build/extend, Group 3 (AR) -- registers the 9
-- sap_reports rows closed by this group in compliance.computation_engines.
-- See PROGRESS.md Group 3 for the full plan. No schema additions this group
-- (erp_sales_orders.project_id and erp_sales_returns already existed).

INSERT INTO compliance.computation_engines
  (engine_key, name, category, description, status, implementation_ref, input_schema, output_schema, notes)
VALUES
  (
    'customer_line_item_display',
    'Customer Line Item Display',
    'Accounts Receivable Engine',
    'FBL5N-style unified open+cleared customer line items: sales invoices (open items) and approved payment entries (clearing documents), with partial-clearing status per line.',
    'implemented',
    'erp-invoicing-service.ts:listCustomerLineItems',
    '{"customerIds": "string[]?", "fromDate": "string?", "toDate": "string?", "page": "number?", "limit": "number?"}',
    '{"lines": "array", "total": "number", "page": "number", "limit": "number", "totalPages": "number"}',
    'EXTEND_EXISTING(erpJournalEntryLines) per sap_reports FI-AR-001; direct customer-side counterpart of FI-AP-001.'
  ),
  (
    'customer_balances',
    'Customer Balances',
    'Accounts Receivable Engine',
    'Sum of open erp_sales_invoices.outstandingAmount grouped by customer.',
    'implemented',
    'erp-invoicing-service.ts:customerBalances',
    '{}',
    '{"rows": "array", "totalOutstanding": "number"}',
    'EXTEND_EXISTING(erpCustomers + outstandingAmount pattern) per sap_reports FI-AR-002; counterpart of FI-AP-002.'
  ),
  (
    'customer_credit_exposure',
    'Customer Credit Exposure',
    'Accounts Receivable Engine',
    'Open AR + open (not yet billed/cancelled) sales-order value against creditLimit, across every customer -- browsing/decision-support view, distinct from the real-time submitSalesInvoice gate.',
    'implemented',
    'erp-selling-service.ts:customerCreditExposure',
    '{}',
    '{"rows": "array", "topByExposure": "array"}',
    'EXTEND_EXISTING(erp-invoicing-service.ts creditLimit gate) per sap_reports FI-AR-005.'
  ),
  (
    'customer_payment_behavior_report',
    'Customer Payment History / Payment Behavior Analysis',
    'Accounts Receivable Engine',
    'Days Sales Outstanding per customer: amount-weighted average days from invoice posting to approved-payment posting, vs. defaultPaymentTermsDays.',
    'implemented',
    'erp-invoicing-service.ts:customerPaymentBehaviorReport',
    '{"fromDate": "string?", "toDate": "string?"}',
    '{"fromDate": "string|null", "toDate": "string|null", "rows": "array"}',
    'BUILD_NEW per sap_reports FI-AR-006; counterpart of FI-AP-006.'
  ),
  (
    'customer_account_balance_display',
    'Customer Account Balance Display',
    'Accounts Receivable Engine',
    'getCustomerOverview extended with an openInvoices open/cleared split (previously only exposed a net lifetimeOutstanding figure).',
    'implemented',
    'erp-selling-service.ts:getCustomerOverview',
    '{"customerId": "string"}',
    '{"customer": "object", "openInvoices": "array", "summary": "object"}',
    'EXTEND_EXISTING(erp-selling-service.ts:getCustomerOverview) per sap_reports FI-AR-007 -- gap_notes flagged this function for verification; confirmed and extended.'
  ),
  (
    'sales_order_backlog_report',
    'Open Sales Order Backlog Report',
    'Sales & Distribution Engine',
    'Project-level billing backlog: total ordered value vs. total billed value vs. remaining-to-bill, per project.',
    'implemented',
    'erp-selling-service.ts:salesOrderBacklogReport',
    '{}',
    '{"rows": "array", "totalBacklog": "number"}',
    'EXTEND_EXISTING(erpSalesOrders + erpSalesInvoices) per sap_reports SD-004.'
  ),
  (
    'customer_sales_analysis',
    'Customer Sales Analysis',
    'Sales & Distribution Engine',
    'Customer-level (cross-project) revenue rollup with invoice count, average invoice value, distinct project count, lifetime revenue, and prior-period revenue variance.',
    'implemented',
    'erp-selling-service.ts:customerSalesAnalysis',
    '{"fromDate": "string", "toDate": "string"}',
    '{"fromDate": "string", "toDate": "string", "rows": "array"}',
    'EXTEND_EXISTING(erp-invoicing-service.ts:listSalesInvoicesPaged + construction-reports-service.ts:revenueReport) per sap_reports SD-005.'
  ),
  (
    'revenue_by_service_type',
    'Sales by Material / Service Type',
    'Sales & Distribution Engine',
    'Revenue (and estimated margin, from erpItems.standardBuyingRate) grouped by item group -- the real "service type" dimension in this schema.',
    'implemented',
    'erp-invoicing-service.ts:revenueByServiceType',
    '{"fromDate": "string?", "toDate": "string?"}',
    '{"fromDate": "string|null", "toDate": "string|null", "rows": "array", "totalRevenue": "number"}',
    'BUILD_NEW per sap_reports SD-006.'
  ),
  (
    'cancelled_and_rejected_billing_analysis',
    'Cancelled and Rejected Billing Analysis',
    'Sales & Distribution Engine',
    'Combines cancelled sales invoices with rejected sales returns into a per-customer disputed-billing view, with a risk flag at 2+ disputed documents.',
    'implemented',
    'erp-invoicing-service.ts:cancelledAndRejectedBillingAnalysis',
    '{}',
    '{"items": "array", "rows": "array", "riskFlaggedCustomerIds": "string[]"}',
    'EXTEND_EXISTING(erp-invoicing-service.ts:cancelSalesInvoice + erpSalesReturns) per sap_reports SD-008.'
  )
ON CONFLICT (engine_key) DO UPDATE SET
  name = EXCLUDED.name,
  category = EXCLUDED.category,
  description = EXCLUDED.description,
  status = EXCLUDED.status,
  implementation_ref = EXCLUDED.implementation_ref,
  input_schema = EXCLUDED.input_schema,
  output_schema = EXCLUDED.output_schema,
  notes = EXCLUDED.notes,
  updated_at = now();
