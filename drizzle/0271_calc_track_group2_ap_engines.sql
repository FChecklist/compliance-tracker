-- Calculation-track engine build/extend, Group 2 (AP) -- registers the 10
-- sap_reports rows closed by this group in compliance.computation_engines.
-- See PROGRESS.md Group 2 for the full plan; drizzle/0270 carries this
-- group's schema additions (erp_purchase_orders.project_id,
-- erp_suppliers.early_payment_discount_percent/days,
-- erp_purchase_invoices.retention_percent/amount/net_payable).

INSERT INTO compliance.computation_engines
  (engine_key, name, category, description, status, implementation_ref, input_schema, output_schema, notes)
VALUES
  (
    'purchase_orders_by_project_summary',
    'Purchase Orders by Project / WBS Element',
    'Procurement Engine',
    'Project-filtered purchase order commitment view: per-PO ordered/received/invoiced/outstanding value.',
    'implemented',
    'erp-buying-service.ts:purchaseOrdersByProjectSummary',
    '{"projectId": "string"}',
    '{"projectId": "string", "lines": "ProjectCommitmentLine[]", "totals": "object"}',
    'EXTEND_EXISTING(erp-buying-service.ts:listPurchaseOrders) per sap_reports MM-004; listPurchaseOrders itself also gained a projectId filter.'
  ),
  (
    'vendor_purchasing_history_report',
    'Vendor Purchasing History Report',
    'Procurement Engine',
    'Composes getSupplierScorecard with PO/receipt/invoice value rollups (received/invoiced/open-PO value, average delivery delay) into one per-vendor view.',
    'implemented',
    'erp-buying-service.ts:vendorPurchasingHistoryReport',
    '{"supplierId": "string"}',
    '{"supplierId": "string", "totalPoValue": "number", "totalReceivedValue": "number", "totalInvoicedValue": "number", "openPoValue": "number", "onTimeDeliveryRate": "number|null", "avgDeliveryDelayDays": "number|null"}',
    'EXTEND_EXISTING(erp-buying-service.ts:getSupplierScorecard/listSupplierScorecards + construction-reports-service.ts:vendorCostReport) per sap_reports MM-008.'
  ),
  (
    'project_commitments_report',
    'Project Commitments Report',
    'Project Controlling Engine',
    'Open PO/subcontract commitment value grouped by supplier for a project, with commitment-aging flags (>60 days open).',
    'implemented',
    'erp-buying-service.ts:projectCommitmentsReport',
    '{"projectId": "string", "asOfDate": "string?"}',
    '{"projectId": "string", "asOfDate": "string", "bySupplier": "ProjectCommitmentBySupplier[]", "totalOutstandingCommitment": "number", "agingFlags": "string[]"}',
    'EXTEND_EXISTING(erp-buying-service.ts open-value fields) per sap_reports PS-005.'
  ),
  (
    'vendor_line_item_display',
    'Vendor Line Item Display',
    'Accounts Payable Engine',
    'FBL1N-style unified open+cleared vendor line items: purchase invoices (open items) and approved payment entries (clearing documents), with partial-clearing status per line.',
    'implemented',
    'erp-invoicing-service.ts:listVendorLineItems',
    '{"supplierIds": "string[]?", "fromDate": "string?", "toDate": "string?", "page": "number?", "limit": "number?"}',
    '{"lines": "array", "total": "number", "page": "number", "limit": "number", "totalPages": "number"}',
    'EXTEND_EXISTING(erpJournalEntryLines partyType=supplier) per sap_reports FI-AP-001.'
  ),
  (
    'vendor_balances',
    'Vendor Balances',
    'Accounts Payable Engine',
    'Sum of open erp_purchase_invoices.outstandingAmount grouped by supplier.',
    'implemented',
    'erp-invoicing-service.ts:vendorBalances',
    '{}',
    '{"rows": "array", "totalOutstanding": "number"}',
    'EXTEND_EXISTING(erpSuppliers.creditLimit pattern) per sap_reports FI-AP-002.'
  ),
  (
    'ap_aging_report',
    'Vendor Items -- Aging Report',
    'Accounts Payable Engine',
    'AP aging bucketed by days-past-due (current/1-30/31-60/61-90/90+), mirroring arAgingReport''s bucketing exactly against erpPurchaseInvoices.',
    'implemented',
    'erp-invoicing-service.ts:apAgingReport',
    '{"asOfDate": "string?"}',
    '{"asOfDate": "string", "buckets": "object", "totalOutstanding": "number", "invoices": "array"}',
    'EXTEND_EXISTING(erp-invoicing-service.ts:arAgingReport pattern) per sap_reports FI-AP-003.'
  ),
  (
    'vendor_account_balance_display',
    'Vendor Account Balance Display',
    'Accounts Payable Engine',
    'Single-vendor open/cleared invoice snapshot, including total retention held.',
    'implemented',
    'erp-invoicing-service.ts:vendorAccountBalanceDisplay',
    '{"supplierId": "string"}',
    '{"supplierId": "string", "totalOutstanding": "number", "openInvoices": "array"}',
    'EXTEND_EXISTING(erpSuppliers + erpPurchaseInvoices.outstandingAmount) per sap_reports FI-AP-004.'
  ),
  (
    'payment_proposal_list',
    'Payment Run -- Payment Proposal List',
    'Accounts Payable Engine',
    'F110-style batch payment proposal: due + open invoices as of a cutoff date, early-payment discount applied when within the supplier''s discount window, grouped by supplier + primary bank account.',
    'implemented',
    'erp-invoicing-service.ts:paymentProposalList',
    '{"cutoffDate": "string", "supplierIds": "string[]?"}',
    '{"cutoffDate": "string", "lines": "array", "groups": "array", "totalProposedPayment": "number", "totalDiscountCaptured": "number"}',
    'BUILD_NEW per sap_reports FI-AP-005. erpSuppliers gained earlyPaymentDiscountPercent/Days for this.'
  ),
  (
    'vendor_payment_behavior_report',
    'Vendor Payment History / Payment Behavior Analysis',
    'Accounts Payable Engine',
    'Days Payable Outstanding per vendor: amount-weighted average days from invoice posting to approved-payment posting, vs. defaultPaymentTermsDays.',
    'implemented',
    'erp-invoicing-service.ts:vendorPaymentBehaviorReport',
    '{"fromDate": "string?", "toDate": "string?"}',
    '{"fromDate": "string|null", "toDate": "string|null", "rows": "array"}',
    'BUILD_NEW per sap_reports FI-AP-006.'
  ),
  (
    'subcontractor_retention_summary',
    'Subcontractor Retention Summary',
    'Accounts Payable Engine',
    'Sums retentionAmount currently held on open/partially-paid purchase invoices, by supplier. Read-only summary -- retention release workflow is a documented follow-up, not built here.',
    'implemented',
    'erp-invoicing-service.ts:subcontractorRetentionSummary',
    '{}',
    '{"rows": "array", "totalRetentionHeld": "number"}',
    'BUILD_NEW per sap_reports FI-AP-007. erpPurchaseInvoices gained retentionPercent/retentionAmount/netPayable, computed in createPurchaseInvoice.'
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
