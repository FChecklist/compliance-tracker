// VERIDIAN Review Framework gap-closure (AI Cost Governance & FinOps,
// 2026-08-07): "Cost attribution reconciles against actual OpenRouter/
// provider invoices" + "Cost-per-report and cost-per-AI-action are
// measurable, not estimated" -- both findings share the same root cause
// (token_usage_ledger.estimated_cost_usd comes from a static per-token
// pricing table, llm-client.ts's estimateCostUsd, never checked against
// real billing) and the same recommended fix: manual monthly
// reconciliation first (low effort), automate later only if drift proves
// significant/recurring. This is that manual mechanism -- not an
// automated provider-invoice-API integration.
import { db, aiCostReconciliation, tokenUsageLedger } from "@/lib/db"
import { and, eq, gte, lt, desc, sql } from "drizzle-orm"
import { daysInMonthUtc } from "@/lib/spend-forecast"

const PERIOD_MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/

export class CostReconciliationError extends Error {}

/** 'YYYY-MM' -> [first-of-month UTC, first-of-next-month UTC). Throws on malformed input rather than silently misreading the period. */
export function periodMonthBounds(periodMonth: string): { start: Date; end: Date } {
  if (!PERIOD_MONTH_RE.test(periodMonth)) {
    throw new CostReconciliationError(`periodMonth must be 'YYYY-MM', got: ${periodMonth}`)
  }
  const [year, month] = periodMonth.split("-").map(Number)
  const start = new Date(Date.UTC(year, month - 1, 1))
  const days = daysInMonthUtc(start)
  const end = new Date(Date.UTC(year, month - 1, 1 + days))
  return { start, end }
}

/** Sum of token_usage_ledger.estimated_cost_usd for a calendar month, optionally scoped to one provider -- the "estimated" side of the reconciliation, always computed live (no snapshot to go stale). */
export async function getEstimatedLedgerUsd(periodMonth: string, provider?: string): Promise<number> {
  const { start, end } = periodMonthBounds(periodMonth)
  const conditions = [gte(tokenUsageLedger.createdAt, start), lt(tokenUsageLedger.createdAt, end)]
  if (provider) conditions.push(eq(tokenUsageLedger.provider, provider))
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${tokenUsageLedger.estimatedCostUsd}), 0)::float` })
    .from(tokenUsageLedger)
    .where(and(...conditions))
  return row?.total ?? 0
}

export type RecordActualInvoiceInput = {
  periodMonth: string
  provider: string
  actualInvoiceUsd: number
  notes?: string | null
  recordedByUserId?: string | null
}

/** Finance hand-enters the real total from the provider's own billing dashboard for a closed month. */
export async function recordActualInvoice(input: RecordActualInvoiceInput) {
  periodMonthBounds(input.periodMonth) // validates shape, throws before any write on malformed input
  if (!(input.actualInvoiceUsd >= 0)) {
    throw new CostReconciliationError("actualInvoiceUsd must be a non-negative number")
  }
  const [row] = await db
    .insert(aiCostReconciliation)
    .values({
      periodMonth: input.periodMonth,
      provider: input.provider,
      actualInvoiceUsd: String(input.actualInvoiceUsd),
      notes: input.notes ?? null,
      recordedByUserId: input.recordedByUserId ?? null,
    })
    .returning()
  return row
}

export type ReconciliationRow = {
  id: string
  periodMonth: string
  provider: string
  actualInvoiceUsd: number
  estimatedLedgerUsd: number
  driftUsd: number
  driftPct: number | null // null when actual invoice is $0 (division by zero -- not a meaningful percentage)
  notes: string | null
  recordedByUserId: string | null
  createdAt: string
}

/** Every hand-entered invoice, each paired with the live-computed estimated ledger total for that same period+provider so Finance sees drift directly, not two numbers to cross-reference by hand. */
export async function listReconciliations(): Promise<ReconciliationRow[]> {
  const entries = await db
    .select()
    .from(aiCostReconciliation)
    .orderBy(desc(aiCostReconciliation.periodMonth))

  return Promise.all(
    entries.map(async (entry) => {
      const actualInvoiceUsd = Number(entry.actualInvoiceUsd)
      const estimatedLedgerUsd = await getEstimatedLedgerUsd(entry.periodMonth, entry.provider)
      const driftUsd = estimatedLedgerUsd - actualInvoiceUsd
      return {
        id: entry.id,
        periodMonth: entry.periodMonth,
        provider: entry.provider,
        actualInvoiceUsd,
        estimatedLedgerUsd,
        driftUsd,
        driftPct: actualInvoiceUsd > 0 ? (driftUsd / actualInvoiceUsd) * 100 : null,
        notes: entry.notes,
        recordedByUserId: entry.recordedByUserId,
        createdAt: entry.createdAt.toISOString(),
      }
    })
  )
}
