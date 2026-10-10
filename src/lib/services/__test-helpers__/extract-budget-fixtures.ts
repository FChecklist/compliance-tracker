// PROJEXA-BUILD-001 U-36b (BR-526): an in-memory usage ledger for the extraction spend cap, and a ready-made budget for tests that
// only need the handler to run. The in-memory ledger keeps its rows in a list the way token_usage_ledger does (insert a row, sum the
// cost of a feature, update the own row), yields to the event loop between steps so concurrent calls really interleave, and can be
// told to fail at one step. No database, no network.
import {
  BUDGET_FEATURE_KEY,
  type BudgetDeps,
  type BudgetLedger,
  type LedgerReservation,
  type LedgerSettlement,
} from "../../../../supabase/functions/projexa-document-extract/budget"

export type LedgerRow = LedgerReservation & { id: string; success: boolean | null; failureReason: string | null; usageSource: string }

export type MemoryBudgetLedger = BudgetLedger & {
  rows: LedgerRow[]
  /** Which ledger step throws: "read", "insert" or "finalize" (or null for none). */
  failOn: "read" | "insert" | "finalize" | null
  /** Sum of the cost of every row of the feature. */
  total(feature?: string): number
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

export function memoryBudgetLedger(seed: Array<Partial<LedgerRow> & { estimatedCostUsd: number }> = []): MemoryBudgetLedger {
  let n = 0
  const rows: LedgerRow[] = seed.map((s) => ({
    id: `seed-${++n}`,
    orgId: "org-seed",
    userId: "user-seed",
    requestId: `req-seed-${n}`,
    feature: BUDGET_FEATURE_KEY,
    provider: "groq",
    model: "openai/gpt-oss-120b",
    promptTokens: 0,
    completionTokens: 0,
    success: true,
    failureReason: null,
    usageSource: "provider",
    ...s,
  }))
  const ledger: MemoryBudgetLedger = {
    rows,
    failOn: null,
    total: (feature = BUDGET_FEATURE_KEY) => rows.filter((r) => r.feature === feature).reduce((sum, r) => sum + r.estimatedCostUsd, 0),
    async readRecordedTotalUsd(feature) {
      await tick()
      if (ledger.failOn === "read") throw new Error("ledger read failed")
      return ledger.total(feature)
    },
    async insertReservation(row) {
      await tick()
      if (ledger.failOn === "insert") throw new Error("ledger insert failed")
      const id = `row-${++n}`
      rows.push({ ...row, id, success: null, failureReason: null, usageSource: "reserved" })
      return id
    },
    async finalizeReservation(id, s: LedgerSettlement) {
      await tick()
      if (ledger.failOn === "finalize") throw new Error("ledger update failed")
      const row = rows.find((r) => r.id === id)
      if (!row) throw new Error("no such row")
      Object.assign(row, {
        promptTokens: s.promptTokens,
        completionTokens: s.completionTokens,
        estimatedCostUsd: s.estimatedCostUsd,
        success: s.success,
        failureReason: s.failureReason,
        usageSource: s.usageSource,
      })
    },
  }
  return ledger
}

export const TEST_ORG = "org-test-1"
export const TEST_USER = "user-test-1"

/** A budget with a very high cap (tests that are not about the cap) and fixed attribution, on an in-memory ledger. */
export function testBudget(extra: Partial<BudgetDeps> = {}): BudgetDeps & { ledger: MemoryBudgetLedger } {
  const ledger = memoryBudgetLedger()
  let n = 0
  return {
    ledger,
    provider: "groq",
    model: "openai/gpt-oss-120b",
    capUsd: 1000,
    resolveAttribution: () => ({ orgId: TEST_ORG, userId: TEST_USER, requestId: `req-${++n}` }),
    ...extra,
  } as BudgetDeps & { ledger: MemoryBudgetLedger }
}
