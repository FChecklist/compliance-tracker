// VERIDIAN Review Framework gap-closure, AI Engineering Quality / Code
// Structure & Modularity (Medium, "Code Modularity"): second slice of the
// dispatchEngine() extraction -- see crm-engine-dispatch.ts's header for
// the full rationale. Pure code motion, no logic changes.
//
// Accounting Computation Engine (tree4-unified/50-completion-plan area 8,
// Wave 167) -- 11 of 20 registered engines. The other 9
// (double_entry_engine, journal_posting_engine, ledger_posting_engine,
// trial_balance_engine, profit_loss_engine, balance_sheet_engine,
// cash_flow_engine, financial_year_closing_engine, chart_of_accounts_engine)
// are already implemented in erp-accounting-service.ts/erp-financial-
// report-service.ts as real, DB-backed ERP product functions (per
// accounting-engine.ts's own header comment) -- deliberately NOT
// re-dispatched here as a second surface; see task-execution-engine.ts's
// git history for the original session's log on why.

export const ACCOUNTING_ENGINE_KEYS = new Set([
  "opening_balance_engine",
  "closing_balance_engine",
  "balance_verification_engine",
  "consolidation_engine",
  "fund_flow_engine",
  "statement_changes_equity_engine",
  "notes_to_accounts_generator",
  "voucher_validation_engine",
  "duplicate_entry_detection_engine",
  "suspense_account_detection_engine",
  "ledger_reconciliation_engine",
]);

function truthy(v: unknown): boolean {
  const s = String(v ?? "").trim().toLowerCase();
  return s === "yes" || s === "true" || s === "1";
}

export async function dispatchAccountingEngine(engineKey: string, inputs: Record<string, unknown>): Promise<unknown> {
  switch (engineKey) {
    case "opening_balance_engine": {
      const { computeOpeningBalance } = await import("@/lib/engines/accounting-engine");
      return { openingBalance: computeOpeningBalance(Number(inputs.priorClosingBalance)) };
    }
    case "closing_balance_engine": {
      const { computeClosingBalance } = await import("@/lib/engines/accounting-engine");
      return { closingBalance: computeClosingBalance(Number(inputs.openingBalance), Number(inputs.totalDebits), Number(inputs.totalCredits), truthy(inputs.isDebitNormal)) };
    }
    case "balance_verification_engine": {
      // AI Architecture / Explainability & Transparency gap-closure: the
      // *Explained() variant -- see accounting-engine.ts's
      // header comment. Safe here specifically because this dispatch's
      // return value is only ever JSON.stringify'd into a task chat message
      // (executeEngineDispatch, in task-execution-engine.ts) and sanity-
      // checked by assertValidDispatchOutput (tolerates any nested shape,
      // only rejects NaN/Infinity numbers) -- adding fields doesn't break
      // either.
      const { verifyBalancesNetToZeroExplained } = await import("@/lib/engines/accounting-engine");
      const balances = inputs.balances as { accountId: string; debit: number; credit: number }[];
      if (!Array.isArray(balances)) throw new Error("balances must be an array");
      return verifyBalancesNetToZeroExplained(balances);
    }
    case "consolidation_engine": {
      const { consolidateBalances } = await import("@/lib/engines/accounting-engine");
      const entityBalances = inputs.entityBalances as { entityId: string; accountId: string; amount: number }[];
      const intercompanyAccountIds = inputs.intercompanyAccountIds as string[];
      if (!Array.isArray(entityBalances) || !Array.isArray(intercompanyAccountIds)) throw new Error("entityBalances and intercompanyAccountIds must both be arrays");
      return consolidateBalances(entityBalances, intercompanyAccountIds);
    }
    case "fund_flow_engine": {
      const { computeFundFlow } = await import("@/lib/engines/accounting-engine");
      return computeFundFlow(Number(inputs.openingWorkingCapital), Number(inputs.closingWorkingCapital));
    }
    case "statement_changes_equity_engine": {
      const { statementOfChangesInEquity } = await import("@/lib/engines/accounting-engine");
      return statementOfChangesInEquity({
        openingBalance: Number(inputs.openingBalance), profitForPeriod: Number(inputs.profitForPeriod),
        dividendsPaid: inputs.dividendsPaid ? Number(inputs.dividendsPaid) : undefined,
        capitalIntroduced: inputs.capitalIntroduced ? Number(inputs.capitalIntroduced) : undefined,
        otherComprehensiveIncome: inputs.otherComprehensiveIncome ? Number(inputs.otherComprehensiveIncome) : undefined,
      });
    }
    case "notes_to_accounts_generator": {
      const { generateNotesToAccounts } = await import("@/lib/engines/accounting-engine");
      const lineItems = inputs.lineItems as { accountId: string; noteCategory: string; amount: number }[];
      if (!Array.isArray(lineItems)) throw new Error("lineItems must be an array");
      return generateNotesToAccounts(lineItems);
    }
    case "voucher_validation_engine": {
      const { validateVoucher } = await import("@/lib/engines/accounting-engine");
      const lines = inputs.lines as { accountId: string }[];
      if (!Array.isArray(lines)) throw new Error("lines must be an array");
      return validateVoucher({ debitTotal: Number(inputs.debitTotal), creditTotal: Number(inputs.creditTotal), lines });
    }
    case "duplicate_entry_detection_engine": {
      const { detectDuplicateEntries } = await import("@/lib/engines/accounting-engine");
      const entries = inputs.entries as { id: string; date: string; amount: number; accountId: string; reference?: string }[];
      if (!Array.isArray(entries)) throw new Error("entries must be an array");
      return { duplicateGroups: detectDuplicateEntries(entries) };
    }
    case "suspense_account_detection_engine": {
      const { detectSuspenseAccountBalance } = await import("@/lib/engines/accounting-engine");
      return detectSuspenseAccountBalance(Number(inputs.suspenseAccountBalance));
    }
    case "ledger_reconciliation_engine": {
      const { reconcileLedgers } = await import("@/lib/engines/accounting-engine");
      const ledgerA = inputs.ledgerA as { reference: string; amount: number }[];
      const ledgerB = inputs.ledgerB as { reference: string; amount: number }[];
      if (!Array.isArray(ledgerA) || !Array.isArray(ledgerB)) throw new Error("ledgerA and ledgerB must both be arrays");
      return reconcileLedgers(ledgerA, ledgerB);
    }
    default:
      throw new Error(`No accounting engine dispatcher implemented for ${engineKey}`);
  }
}
