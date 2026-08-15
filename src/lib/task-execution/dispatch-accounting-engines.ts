// One category of task-execution-engine.ts's computation-engine dispatch
// table, split out by category (VERIDIAN Review Framework "AI Engineering
// Quality / Overall Code Quality" gap-closure -- see dispatch-helpers.ts's
// header). Case bodies are verbatim from the original dispatchEngine()
// switch block for this category -- not rewritten, just relocated.
import { NOT_HANDLED, truthy } from './dispatch-helpers'

export async function dispatchAccountingEngines(engineKey: string, inputs: Record<string, unknown>): Promise<unknown> {
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
      const { verifyBalancesNetToZero } = await import("@/lib/engines/accounting-engine");
      const balances = inputs.balances as { accountId: string; debit: number; credit: number }[];
      if (!Array.isArray(balances)) throw new Error("balances must be an array");
      return verifyBalancesNetToZero(balances);
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
  }

  return NOT_HANDLED
}
