-- Calculation-track engine build/extend, Group 1 (GL/CO) -- registers the
-- 5 sap_reports rows closed by this group in compliance.computation_engines
-- (CO-001, CO-003, FI-GL-002, FI-GL-007, FI-GL-008 -- see
-- ai-os/tasks/task-20260730-040810-build-extend-calculation-track-engines/
-- workspace/PROGRESS.md for the full 36-row/8-group plan this belongs to).
-- Idempotent so re-running this file after a later engine_version bump is
-- safe -- ON CONFLICT (engine_key) DO UPDATE, not DO NOTHING.

INSERT INTO compliance.computation_engines
  (engine_key, name, category, description, status, implementation_ref, input_schema, output_schema, notes)
VALUES
  (
    'cost_center_line_item_display',
    'Cost Center Line Item Display',
    'Costing Engine',
    'SAP KSB1 equivalent: journal-entry lines filtered/joined by cost center, for drill-down from a cost center summary to the underlying postings.',
    'implemented',
    'erp-accounting-service.ts:listJournalEntryLinesByCostCenter',
    '{"costCenterIds": "string[]?", "fromDate": "string?", "toDate": "string?", "page": "number?", "limit": "number?"}',
    '{"lines": "array", "total": "number", "page": "number", "limit": "number", "totalPages": "number"}',
    'EXTEND_EXISTING(erp-accounting-service.ts:listJournalEntries) per sap_reports CO-001.'
  ),
  (
    'cost_center_hierarchy_report',
    'Cost Center Hierarchy Report',
    'Costing Engine',
    'Recursive parent/child roll-up of expense-account spend over erp_cost_centers'' existing tree, one node per cost center with own + total (self + descendants) amounts.',
    'implemented',
    'erp-accounting-service.ts:costCenterHierarchyReport',
    '{"fromDate": "string", "toDate": "string"}',
    '{"fromDate": "string", "toDate": "string", "roots": "CostCenterHierarchyNode[]"}',
    'EXTEND_EXISTING(erp-accounting-service.ts:listCostCenters) per sap_reports CO-003.'
  ),
  (
    'gl_account_balances_display',
    'G/L Account Balances Display',
    'Financial Reporting Engine',
    'SAP FS10N equivalent: opening balance / period debit / period credit / closing balance per account, for a caller-supplied account-id filter.',
    'implemented',
    'erp-financial-report-service.ts:glAccountBalanceDisplay',
    '{"accountIds": "string[]", "fromDate": "string", "toDate": "string", "scope": "CompanyScope?"}',
    '{"fromDate": "string", "toDate": "string", "accounts": "array"}',
    'EXTEND_EXISTING(erp-financial-report-service.ts:trialBalance) per sap_reports FI-GL-002.'
  ),
  (
    'subledger_reconciliation_to_gl',
    'Subledger Reconciliation to General Ledger',
    'Financial Reporting Engine',
    'Compares open AR/AP subledger totals (erp_sales_invoices/erp_purchase_invoices outstandingAmount) against the GL''s own receivable/payable account balances as of a date, flagging any variance as a month-end health-check signal.',
    'implemented',
    'erp-financial-report-service.ts:subledgerReconciliationToGl',
    '{"asOfDate": "string", "scope": "CompanyScope?"}',
    '{"asOfDate": "string", "reconciliations": "array"}',
    'BUILD_NEW per sap_reports FI-GL-007.'
  ),
  (
    'gl_account_group_balances_summary',
    'G/L Account Group Balances Summary',
    'Financial Reporting Engine',
    'Recursive parent/child roll-up of trialBalance closing balances over erp_accounts'' existing group-account tree.',
    'implemented',
    'erp-financial-report-service.ts:glAccountGroupBalancesSummary',
    '{"asOfDate": "string", "scope": "CompanyScope?"}',
    '{"asOfDate": "string", "groups": "GlAccountGroupNode[]"}',
    'EXTEND_EXISTING(erp-accounting-service.ts:listAccounts + trialBalance) per sap_reports FI-GL-008.'
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
