// R65 Part E -- Billing Engine, Phase 1: cost-rollup service. Reads real
// compliance.token_usage_ledger rows (extended by R65 Part D, drizzle/0524)
// and computes the two columns that migration explicitly left for this
// initiative to fill in -- allocated_cost and billable_cost -- plus
// per-dimension rollups (VERIDIAN / PRODUCT / ORG / USER / TASK) over them.
// See memory: veridian_r65_part_e_billing_engine_directive_2026-09-01 and
// veridian_r65_part_e_phase0_architecture_report_2026-09-01.
//
// TWO DELIBERATELY DIFFERENT COLUMNS, NOT ONE CONCEPT TWICE:
//   - allocated_cost: VERIDIAN's own real internal spend (input_cost +
//     output_cost + cache_cost, all already real/populated by Part D where
//     the model is recognized -- see 0524's own header) attributed down to
//     this row's known dimensions. Needs NO rate card -- it's cost
//     accounting, not customer pricing, and can be computed today for
//     every row that has a recognized model.
//   - billable_cost: the customer-facing $ charge for this row's raw usage
//     under directive Formula 2's rate card (§6-10) -- billable tokens
//     (raw x token_multiplier) x the resolved input/output rate. This
//     genuinely requires an owner-approved compliance.billing_rates row to
//     exist for the row's (product, org) pair; when none exists, this stays
//     NULL -- "we cannot bill this because no rate is configured" is the
//     honest answer, never a fabricated number.
//
// WHAT THIS FILE DOES NOT DO (disclosed, not silently skipped):
//   - No commercial-customization pipeline (discounts/credits/min-max/tax,
//     directive §11-25) -- billable_cost here is the GROSS Formula-2 token
//     charge for one call, before any of that. Phase 5, not this file.
//   - No base_user_rate/active-user component -- that's a once-per-billing-
//     period-per-org charge, not a per-call one; it belongs in a future
//     invoice-generation step (Phase 6), not a per-ledger-row cost.
//   - No software-token component -- token_usage_ledger has no raw
//     software-token-count column at all (only prompt_tokens/
//     completion_tokens, both AI-only). Every call into
//     computeFormula2Gross from this file passes rawSoftwareTokens=0.
//   - Never touches token_usage_ledger's raw usage columns
//     (prompt_tokens/completion_tokens/etc.) -- only ever writes
//     allocated_cost/billable_cost, and only when they are currently NULL
//     (see backfillLedgerCosts's own doc comment for the idempotency
//     contract this enforces).
import { db, tokenUsageLedger, billingRates, billingProducts } from "@/lib/db"
import { and, eq, gt, gte, isNull, lt, lte, or, sql } from "drizzle-orm"
import { computeFormula2Gross } from "@/lib/billing/formula-engine"

export type BillingRateRow = typeof billingRates.$inferSelect

// ─── Pure helpers (no DB) ──────────────────────────────────────────────

/**
 * Directive §14's priority order, collapsed to the 2 real levels this
 * schema supports today (org-specific row > standard row -- see
 * drizzle/0525's own header for why the middle 2 levels need
 * billing_contracts, not built yet). Ties within a level are broken by the
 * highest rate_version (directive rule 21: rates are versioned, never
 * overwritten -- the highest version among currently-effective rows is the
 * live one).
 */
export function pickBestRate(candidates: BillingRateRow[], orgId: string | null): BillingRateRow | null {
  if (candidates.length === 0) return null
  const orgSpecific = orgId ? candidates.filter((r) => r.orgId === orgId) : []
  const pool = orgSpecific.length > 0 ? orgSpecific : candidates.filter((r) => r.orgId === null)
  if (pool.length === 0) return null
  return pool.reduce((best, r) => (r.rateVersion > best.rateVersion ? r : best))
}

/**
 * VERIDIAN's own real internal cost for one ledger row, attributed to
 * whatever dimensions the row carries. Returns null (not 0) when neither
 * input_cost nor output_cost is populated -- e.g. an unrecognized model in
 * MODEL_PRICING (see llm-client.ts) -- same "absence means not attempted"
 * contract as the ledger's own cache_cost/cache_savings_usd columns.
 */
export function computeAllocatedCost(row: { inputCost: string | null; outputCost: string | null; cacheCost: string | null }): number | null {
  if (row.inputCost === null && row.outputCost === null && row.cacheCost === null) return null
  return Number(row.inputCost ?? 0) + Number(row.outputCost ?? 0) + Number(row.cacheCost ?? 0)
}

/**
 * The token portion of Formula 2 (directive §6-10) for a single AI call.
 * Deliberately reuses computeFormula2Gross with activeUsers=0/
 * baseUserRate=0/rawSoftwareTokens=0 rather than duplicating the multiplier
 * math -- see this file's header for why the base-user-rate and
 * software-token components don't apply per-call.
 */
export function computeCallBillableCost(
  usage: { promptTokens: number; completionTokens: number },
  rate: Pick<BillingRateRow, "inputTokenRate" | "outputTokenRate" | "tokenMultiplier">
): { billableInputTokens: number; billableOutputTokens: number; billableCost: number } {
  const result = computeFormula2Gross({
    activeUsers: 0,
    baseUserRate: 0,
    rawInputTokens: usage.promptTokens,
    rawOutputTokens: usage.completionTokens,
    inputTokenRate: Number(rate.inputTokenRate ?? 0),
    outputTokenRate: Number(rate.outputTokenRate ?? 0),
    tokenMultiplier: Number(rate.tokenMultiplier),
  })
  return {
    billableInputTokens: result.billableInputTokens,
    billableOutputTokens: result.billableOutputTokens,
    billableCost: result.inputCharge + result.outputCharge,
  }
}

// ─── DB-touching functions ─────────────────────────────────────────────

/**
 * Resolves the currently-effective billing_rates row for (productKey,
 * orgId, formula) as of `asOf`, per directive §14's (collapsed, see
 * pickBestRate) priority order. Returns null when no owner-approved rate
 * exists -- callers must treat that as "cannot bill this," never fall back
 * to an invented number.
 */
export async function resolveActiveBillingRate(params: {
  productKey: string
  orgId: string | null
  formula: "formula_1" | "formula_2"
  asOf: Date
}): Promise<BillingRateRow | null> {
  const product = await db.query.billingProducts.findFirst({ where: eq(billingProducts.productKey, params.productKey) })
  if (!product) return null

  const rows = await db
    .select()
    .from(billingRates)
    .where(
      and(
        eq(billingRates.productId, product.id),
        eq(billingRates.formula, params.formula),
        or(eq(billingRates.status, "approved"), eq(billingRates.status, "active")),
        lte(billingRates.effectiveFrom, params.asOf),
        or(isNull(billingRates.effectiveTo), gt(billingRates.effectiveTo, params.asOf)),
        or(isNull(billingRates.orgId), eq(billingRates.orgId, params.orgId ?? "__no_org__"))
      )
    )

  return pickBestRate(rows, params.orgId)
}

export type BackfillSummary = {
  scanned: number
  allocatedComputed: number
  allocatedSkippedNoCostData: number
  billableComputed: number
  billableSkippedNoRate: number
}

/**
 * One-time-per-row backfill: fills allocated_cost/billable_cost on ledger
 * rows where they are currently NULL. Idempotent and safe to re-run --
 * every write is scoped to `allocatedCost IS NULL` / `billableCost IS
 * NULL` at query time, so a row this function has already priced is never
 * touched again by a later run (directive rule 29: never silently
 * overwrite historical billing data). There is deliberately no
 * force-recompute parameter in this PR -- correcting an already-computed
 * row requires a real adjustment record in a later phase (directive §19),
 * not a silent overwrite here.
 *
 * defaultProductKey: falls back to 'veridian_ai_os' when a row's
 * veridian_product_id is null -- true for 100% of real rows today (zero
 * writers of that column exist yet, per drizzle/0524's own header) and
 * accurate today since this repo's ledger only carries this one product's
 * usage. Will need veridian_product_id actually populated at write time
 * before a second product's usage could be billed separately -- disclosed
 * gap, not fixed here.
 */
export async function backfillLedgerCosts(params: { limit?: number; defaultProductKey?: string } = {}): Promise<BackfillSummary> {
  const limit = params.limit ?? 500
  const defaultProductKey = params.defaultProductKey ?? "veridian_ai_os"

  const summary: BackfillSummary = {
    scanned: 0,
    allocatedComputed: 0,
    allocatedSkippedNoCostData: 0,
    billableComputed: 0,
    billableSkippedNoRate: 0,
  }

  const rows = await db
    .select()
    .from(tokenUsageLedger)
    .where(or(isNull(tokenUsageLedger.allocatedCost), isNull(tokenUsageLedger.billableCost)))
    .orderBy(tokenUsageLedger.createdAt)
    .limit(limit)

  summary.scanned = rows.length

  for (const row of rows) {
    if (row.allocatedCost === null) {
      const allocated = computeAllocatedCost(row)
      if (allocated !== null) {
        await db.update(tokenUsageLedger).set({ allocatedCost: String(allocated) }).where(and(eq(tokenUsageLedger.id, row.id), isNull(tokenUsageLedger.allocatedCost)))
        summary.allocatedComputed++
      } else {
        summary.allocatedSkippedNoCostData++
      }
    }

    if (row.billableCost === null && row.scope === "product_orchestra") {
      const rate = await resolveActiveBillingRate({
        productKey: row.veridianProductId ?? defaultProductKey,
        orgId: row.orgId,
        formula: "formula_2",
        asOf: row.createdAt,
      })
      if (rate) {
        const { billableCost } = computeCallBillableCost(row, rate)
        await db.update(tokenUsageLedger).set({ billableCost: String(billableCost) }).where(and(eq(tokenUsageLedger.id, row.id), isNull(tokenUsageLedger.billableCost)))
        summary.billableComputed++
      } else {
        summary.billableSkippedNoRate++
      }
    }
  }

  return summary
}

export type RollupDimension = "veridianId" | "veridianProductId" | "orgId" | "userId" | "taskId"

export type RollupRow = {
  groupKey: string | null
  requests: number
  promptTokens: number
  completionTokens: number
  allocatedCostUsd: number
  billableCostUsd: number
}

const DIMENSION_COLUMNS = {
  veridianId: tokenUsageLedger.veridianId,
  veridianProductId: tokenUsageLedger.veridianProductId,
  orgId: tokenUsageLedger.orgId,
  userId: tokenUsageLedger.userId,
  taskId: tokenUsageLedger.taskId,
} as const

/**
 * Real per-VERIDIAN/PRODUCT/ORG/USER/TASK rollup over already-computed
 * allocated_cost/billable_cost (directive's attribution chain, §27).
 * Deliberately does NOT filter out a null groupKey -- most rows today have
 * no veridian_id/veridian_product_id/task_id populated (zero writers exist
 * yet, per 0524's header), and hiding that behind a WHERE-not-null would
 * misrepresent how much of the ledger is actually attributed today. A null
 * groupKey row in the output means exactly that: "this many
 * requests/dollars are not yet attributed to this dimension."
 */
export async function rollupCostByDimension(params: {
  dimension: RollupDimension
  periodStart: Date
  periodEnd: Date
}): Promise<RollupRow[]> {
  const column = DIMENSION_COLUMNS[params.dimension]
  return db
    .select({
      groupKey: column,
      requests: sql<number>`count(*)::int`,
      promptTokens: sql<number>`coalesce(sum(${tokenUsageLedger.promptTokens}), 0)::int`,
      completionTokens: sql<number>`coalesce(sum(${tokenUsageLedger.completionTokens}), 0)::int`,
      allocatedCostUsd: sql<number>`coalesce(sum(${tokenUsageLedger.allocatedCost}), 0)::float`,
      billableCostUsd: sql<number>`coalesce(sum(${tokenUsageLedger.billableCost}), 0)::float`,
    })
    .from(tokenUsageLedger)
    .where(and(gte(tokenUsageLedger.createdAt, params.periodStart), lt(tokenUsageLedger.createdAt, params.periodEnd)))
    .groupBy(column)
    .orderBy(sql`5 desc`)
}
