// AI Cost Reconciliation (Finance). VERIDIAN Review Framework remediation,
// "AI Cost Governance & FinOps": (1) cost attribution reconciles against
// actual provider invoices, (2) cost-per-report/cost-per-AI-action are
// measurable, not estimated. Recommended approach for both (same row):
// manual monthly reconciliation first, automate later only if drift proves
// significant/recurring. This is that manual record -- see schema.ts's
// aiCostReconciliations comment for the full rationale. Same raw `db`
// client / platform-governed posture as token-usage-service.ts.
import { db, aiCostReconciliations, tokenUsageLedger } from "@/lib/db"
import { sql, and, eq, gte, lt, desc } from "drizzle-orm"

export type RecordReconciliationInput = {
  periodMonth: string // 'YYYY-MM-01'
  provider: string
  actualInvoiceUsd: number
  notes?: string | null
  recordedByUserId: string
}

export type ReconciliationRow = {
  id: string
  periodMonth: string
  provider: string
  actualInvoiceUsd: number
  estimatedLedgerUsd: number
  varianceUsd: number
  variancePct: number | null
  notes: string | null
  recordedByUserId: string
  createdAt: string
}

/** Pure. Exported for unit testing (see cost-reconciliation-service.test.ts) -- matches this codebase's pure/DB-touching split convention (cost-anomaly-service.ts's classifyAnomaly). */
export function parsePeriodMonth(periodMonth: string): { start: Date; end: Date } {
  const match = /^(\d{4})-(\d{2})-01$/.exec(periodMonth)
  if (!match) throw new Error(`periodMonth must be 'YYYY-MM-01', got '${periodMonth}'`)
  const year = Number(match[1])
  const month = Number(match[2]) // 1-indexed
  const start = new Date(Date.UTC(year, month - 1, 1))
  const end = new Date(Date.UTC(year, month, 1))
  return { start, end }
}

/** Pure. actual/estimated in USD; variancePct is null (never fabricated as 0/Infinity) when actualInvoiceUsd is 0. */
export function computeVariance(actualInvoiceUsd: number, estimatedLedgerUsd: number): { varianceUsd: number; variancePct: number | null } {
  const varianceUsd = actualInvoiceUsd - estimatedLedgerUsd
  const variancePct = actualInvoiceUsd !== 0 ? (varianceUsd / actualInvoiceUsd) * 100 : null
  return { varianceUsd, variancePct }
}

/** Pure. Mean of absolute values; null on an empty input (never fabricated as 0). */
export function averageAbsPct(variancePcts: (number | null)[]): number | null {
  const values = variancePcts.filter((v): v is number => v !== null).map(Math.abs)
  return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : null
}

/** Pure-ish DB wrapper: what the ledger's own estimate says a provider's spend was for a given calendar month -- the "estimated" side of the reconciliation. */
export async function estimateLedgerTotalForMonth(provider: string, periodMonth: string): Promise<number> {
  const { start, end } = parsePeriodMonth(periodMonth)
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${tokenUsageLedger.estimatedCostUsd}), 0)::float` })
    .from(tokenUsageLedger)
    .where(and(
      eq(tokenUsageLedger.provider, provider),
      gte(tokenUsageLedger.createdAt, start),
      lt(tokenUsageLedger.createdAt, end),
    ))
  return row?.total ?? 0
}

/** Finance enters the real invoice total for a (provider, month) once the bill arrives. Snapshots the ledger's estimate at record time so the comparison stays stable even as new usage keeps posting. */
export async function recordReconciliation(input: RecordReconciliationInput): Promise<ReconciliationRow> {
  const estimatedLedgerUsd = await estimateLedgerTotalForMonth(input.provider, input.periodMonth)
  const { varianceUsd, variancePct } = computeVariance(input.actualInvoiceUsd, estimatedLedgerUsd)

  const [row] = await db
    .insert(aiCostReconciliations)
    .values({
      periodMonth: input.periodMonth,
      provider: input.provider,
      actualInvoiceUsd: String(input.actualInvoiceUsd),
      estimatedLedgerUsd: String(estimatedLedgerUsd),
      varianceUsd: String(varianceUsd),
      variancePct: variancePct !== null ? String(variancePct) : null,
      notes: input.notes ?? null,
      recordedByUserId: input.recordedByUserId,
    })
    .onConflictDoUpdate({
      target: [aiCostReconciliations.periodMonth, aiCostReconciliations.provider],
      set: {
        actualInvoiceUsd: String(input.actualInvoiceUsd),
        estimatedLedgerUsd: String(estimatedLedgerUsd),
        varianceUsd: String(varianceUsd),
        variancePct: variancePct !== null ? String(variancePct) : null,
        notes: input.notes ?? null,
        recordedByUserId: input.recordedByUserId,
      },
    })
    .returning()

  return {
    ...row,
    actualInvoiceUsd: Number(row.actualInvoiceUsd),
    estimatedLedgerUsd: Number(row.estimatedLedgerUsd),
    varianceUsd: Number(row.varianceUsd),
    variancePct: row.variancePct !== null ? Number(row.variancePct) : null,
    createdAt: row.createdAt.toISOString(),
  }
}

export type ReconciliationDriftSummary = {
  recordCount: number
  // Average of |variancePct| across every recorded reconciliation with a
  // defined variancePct -- the honest "how far off are our token-count
  // estimates from real invoices, on average" figure. Null when no
  // reconciliation has been recorded yet (never fabricated as 0).
  avgAbsVariancePct: number | null
}

export async function getReconciliationDriftSummary(): Promise<ReconciliationDriftSummary> {
  const rows = await db.select({ variancePct: aiCostReconciliations.variancePct }).from(aiCostReconciliations)
  return {
    recordCount: rows.length,
    avgAbsVariancePct: averageAbsPct(rows.map((r) => (r.variancePct !== null ? Number(r.variancePct) : null))),
  }
}

export async function listReconciliations(limit = 24): Promise<ReconciliationRow[]> {
  const rows = await db
    .select()
    .from(aiCostReconciliations)
    .orderBy(desc(aiCostReconciliations.periodMonth), desc(aiCostReconciliations.provider))
    .limit(limit)

  return rows.map((row) => ({
    ...row,
    actualInvoiceUsd: Number(row.actualInvoiceUsd),
    estimatedLedgerUsd: Number(row.estimatedLedgerUsd),
    varianceUsd: Number(row.varianceUsd),
    variancePct: row.variancePct !== null ? Number(row.variancePct) : null,
    createdAt: row.createdAt.toISOString(),
  }))
}
