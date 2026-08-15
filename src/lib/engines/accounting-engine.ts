// VCEL Accounting Computation Engine -- remaining engines not covered by the
// real erp-accounting-service.ts/erp-financial-report-service.ts functions
// (double-entry/journal/ledger posting/trial balance/P&L/balance sheet/cash
// flow/financial-year-close/chart-of-accounts are already implemented there).
import Decimal from "decimal.js"
import type { EngineResult, EngineResultStep } from "./types"

export type LedgerAccountBalance = { accountId: string; debit: number; credit: number }

// Opening Balance Engine
export function computeOpeningBalance(priorClosingBalance: number): number { return priorClosingBalance }

// Closing Balance Engine
export function computeClosingBalance(openingBalance: number, totalDebits: number, totalCredits: number, isDebitNormal: boolean): number {
  const net = new Decimal(totalDebits).minus(totalCredits)
  return isDebitNormal ? new Decimal(openingBalance).plus(net).toNumber() : new Decimal(openingBalance).minus(net).toNumber()
}

// Balance Verification Engine -- trial balance must net to zero
export function verifyBalancesNetToZero(balances: LedgerAccountBalance[]): { balanced: boolean; totalDebit: number; totalCredit: number; difference: number } {
  const totalDebit = balances.reduce((sum, b) => sum.plus(b.debit), new Decimal(0))
  const totalCredit = balances.reduce((sum, b) => sum.plus(b.credit), new Decimal(0))
  const difference = totalDebit.minus(totalCredit)
  return { balanced: difference.abs().lt(0.01), totalDebit: totalDebit.toNumber(), totalCredit: totalCredit.toNumber(), difference: difference.toNumber() }
}

// AI Architecture / Explainability & Transparency gap-closure (2026-07-18):
// additive EngineResult-shaped variant, alongside (not replacing)
// verifyBalancesNetToZero() above -- see engines/types.ts's header for why
// this is additive rather than a signature change. Wired into
// task-execution-engine.ts's balance_verification_engine case, the only
// real caller (confirmed via grep). Closes "Explains Calculations
// Step-by-Step" for this engine: `steps` lists each account's own
// debit/credit contribution, not just the final total.
export function verifyBalancesNetToZeroExplained(balances: LedgerAccountBalance[]): EngineResult<{ balanced: boolean; totalDebit: number; totalCredit: number; difference: number }> {
  const result = verifyBalancesNetToZero(balances)
  const steps: EngineResultStep[] = balances.map((b) => ({ label: `Account ${b.accountId}`, value: `Dr ${b.debit} / Cr ${b.credit}` }))
  steps.push({ label: "Total Debit", value: result.totalDebit })
  steps.push({ label: "Total Credit", value: result.totalCredit })
  steps.push({ label: "Difference (Debit - Credit)", value: result.difference })
  return {
    value: result,
    explanation: result.balanced
      ? `The ${balances.length} account balance(s) net to zero (within the 0.01 rounding tolerance) -- total debits and total credits match, so this trial balance is in balance.`
      : `The ${balances.length} account balance(s) do NOT net to zero -- total debits (${result.totalDebit}) and total credits (${result.totalCredit}) differ by ${result.difference}. This trial balance is out of balance.`,
    assumptions: ["A difference within 0.01 (absolute) is treated as balanced, to absorb floating-point/rounding noise, not a real imbalance."],
    steps,
  }
}

// Consolidation Engine -- simple additive consolidation with intercompany elimination
export function consolidateBalances(entityBalances: { entityId: string; accountId: string; amount: number }[], intercompanyAccountIds: string[]): { accountId: string; amount: number }[] {
  const byAccount = new Map<string, Decimal>()
  for (const b of entityBalances) {
    if (intercompanyAccountIds.includes(b.accountId)) continue // eliminate intercompany balances
    byAccount.set(b.accountId, (byAccount.get(b.accountId) ?? new Decimal(0)).plus(b.amount))
  }
  return Array.from(byAccount.entries()).map(([accountId, amount]) => ({ accountId, amount: amount.toNumber() }))
}

// Fund Flow Engine -- change in working capital sources/applications
export function computeFundFlow(openingWorkingCapital: number, closingWorkingCapital: number): { netFundFlow: number; direction: "increase" | "decrease" } {
  const diff = new Decimal(closingWorkingCapital).minus(openingWorkingCapital)
  return { netFundFlow: diff.abs().toNumber(), direction: diff.gte(0) ? "increase" : "decrease" }
}

// Statement of Changes in Equity Engine
export type EquityMovement = { openingBalance: number; profitForPeriod: number; dividendsPaid?: number; capitalIntroduced?: number; otherComprehensiveIncome?: number }
export function statementOfChangesInEquity(m: EquityMovement): { closingBalance: number; breakdown: EquityMovement & { closingBalance: number } } {
  const closing = new Decimal(m.openingBalance)
    .plus(m.profitForPeriod).minus(m.dividendsPaid ?? 0).plus(m.capitalIntroduced ?? 0).plus(m.otherComprehensiveIncome ?? 0)
  return { closingBalance: closing.toNumber(), breakdown: { ...m, closingBalance: closing.toNumber() } }
}

// Notes to Accounts Generator -- groups line items by note category
export function generateNotesToAccounts(lineItems: { accountId: string; noteCategory: string; amount: number }[]): Record<string, { items: typeof lineItems; total: number }> {
  const notes: Record<string, { items: typeof lineItems; total: number }> = {}
  for (const item of lineItems) {
    if (!notes[item.noteCategory]) notes[item.noteCategory] = { items: [], total: 0 }
    notes[item.noteCategory].items.push(item)
    notes[item.noteCategory].total = new Decimal(notes[item.noteCategory].total).plus(item.amount).toNumber()
  }
  return notes
}

// Voucher Validation Engine
export function validateVoucher(voucher: { debitTotal: number; creditTotal: number; lines: { accountId: string }[] }): { valid: boolean; errors: string[] } {
  const errors: string[] = []
  if (voucher.lines.length < 2) errors.push("A voucher requires at least 2 lines")
  if (new Decimal(voucher.debitTotal).minus(voucher.creditTotal).abs().gte(0.01)) errors.push("Debit and credit totals must match")
  return { valid: errors.length === 0, errors }
}

// Duplicate Entry Detection Engine -- exact-match heuristic (date + amount + account + reference)
export function detectDuplicateEntries(entries: { id: string; date: string; amount: number; accountId: string; reference?: string }[]): string[][] {
  const groups = new Map<string, string[]>()
  for (const e of entries) {
    const key = `${e.date}|${e.amount}|${e.accountId}|${e.reference ?? ""}`
    groups.set(key, [...(groups.get(key) ?? []), e.id])
  }
  return Array.from(groups.values()).filter((ids) => ids.length > 1)
}

// Suspense Account Detection Engine -- flags any non-zero balance in a designated suspense account
export function detectSuspenseAccountBalance(suspenseAccountBalance: number): { flagged: boolean; balance: number } {
  return { flagged: Math.abs(suspenseAccountBalance) >= 0.01, balance: suspenseAccountBalance }
}

// Ledger Reconciliation Engine -- matches two ledgers by reference+amount, returns unmatched on both sides
export function reconcileLedgers<T extends { reference: string; amount: number }>(ledgerA: T[], ledgerB: T[]): { matched: [T, T][]; unmatchedA: T[]; unmatchedB: T[] } {
  const matched: [T, T][] = []
  const usedB = new Set<number>()
  const unmatchedA: T[] = []
  for (const a of ledgerA) {
    const idx = ledgerB.findIndex((b, i) => !usedB.has(i) && b.reference === a.reference && new Decimal(b.amount).minus(a.amount).abs().lt(0.01))
    if (idx === -1) { unmatchedA.push(a); continue }
    usedB.add(idx)
    matched.push([a, ledgerB[idx]])
  }
  const unmatchedB = ledgerB.filter((_, i) => !usedB.has(i))
  return { matched, unmatchedA, unmatchedB }
}
