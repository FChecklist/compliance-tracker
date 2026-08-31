// Extracted from erp/reports/page.tsx's Trial Balance tab (fix for
// GAP-ERP-REPORTS-CLIENT-CRASH-ON-403, OCID-020): a module-not-enabled org
// gets a 403 whose parsed body is a truthy `{ error: "..." }` object with no
// `accounts` field -- a plain `report && report.accounts.length > 0` guard
// throws `TypeError: Cannot read properties of undefined (reading 'length')`
// on that shape. This predicate must not assume a truthy report has `.accounts`.
export function hasTrialBalanceFooterRows<T extends { accounts?: unknown[] | null }>(
  report: T | null | undefined,
): report is T & { accounts: NonNullable<T["accounts"]> } {
  return Boolean(report && report.accounts && report.accounts.length > 0)
}
