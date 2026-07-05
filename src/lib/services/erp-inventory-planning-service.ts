// Wave 87 (Comparison CSV 2 gap analysis: REP001-004 "Replenishment" +
// CC001-006 "Inventory Control/Cycle Count/ABC"). Reorder suggestions and
// ABC classification are read-time computations against the existing FIFO
// stock ledger (erp-inventory-service.ts) -- never a duplicated balance or
// a fabricated forecast. Cycle count adjustments post through the same
// FIFO engine (recordStockReceipt/recordStockIssue) that every other
// inventory movement in this codebase already uses.
import {
  erpReorderLevels, erpAbcClassifications, erpCycleCountPlans, erpCycleCountLines,
  erpItems, erpStockLedgerEntries, users,
} from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { and, eq, sql } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError }
import { getItemValuation, recordStockReceipt, recordStockIssue } from "./erp-inventory-service"

export type ErpContext = { orgId: string; userId: string; dbUser: typeof users.$inferSelect }

// ============================================================
// Reorder levels + suggestions
// ============================================================

export async function setReorderLevel(
  ctx: { orgId: string },
  itemId: string,
  warehouseId: string | undefined,
  input: { reorderPoint: number; reorderQty: number; safetyStock?: number; minLevel?: number; maxLevel?: number }
) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const item = await db.query.erpItems.findFirst({ where: and(eq(erpItems.id, itemId), eq(erpItems.orgId, ctx.orgId)) })
    if (!item) throw new ServiceError("Item not found", 404)

    const existing = await db.query.erpReorderLevels.findFirst({
      where: warehouseId
        ? and(eq(erpReorderLevels.orgId, ctx.orgId), eq(erpReorderLevels.itemId, itemId), eq(erpReorderLevels.warehouseId, warehouseId))
        : and(eq(erpReorderLevels.orgId, ctx.orgId), eq(erpReorderLevels.itemId, itemId), sql`${erpReorderLevels.warehouseId} IS NULL`),
    })

    const values = {
      reorderPoint: input.reorderPoint.toString(), reorderQty: input.reorderQty.toString(),
      safetyStock: input.safetyStock?.toString(), minLevel: input.minLevel?.toString(), maxLevel: input.maxLevel?.toString(),
      updatedAt: new Date(),
    }

    if (existing) {
      const [updated] = await db.update(erpReorderLevels).set(values).where(eq(erpReorderLevels.id, existing.id)).returning()
      return updated
    }
    const [created] = await db.insert(erpReorderLevels).values({ orgId: ctx.orgId, itemId, warehouseId, ...values }).returning()
    return created
  })
}

export async function listReorderLevels(ctx: { orgId: string }) {
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.erpReorderLevels.findMany({ where: eq(erpReorderLevels.orgId, ctx.orgId), with: { item: true, warehouse: true } })
  )
}

export type ReorderSuggestion = {
  reorderLevelId: string; itemId: string; itemName: string; warehouseId: string | null
  currentQty: number; reorderPoint: number; suggestedQty: number
}

/** Read-time comparison against the real FIFO stock balance -- never a fabricated forecast. Only items at or below their reorder point are returned. */
export async function getReorderSuggestions(ctx: { orgId: string }): Promise<ReorderSuggestion[]> {
  const levels = await listReorderLevels(ctx)
  const suggestions: ReorderSuggestion[] = []
  for (const level of levels) {
    if (!level.warehouseId) continue // an org-wide default with no specific warehouse has no single balance to check against
    const { qty } = await getItemValuation(ctx, level.itemId, level.warehouseId)
    if (qty <= Number(level.reorderPoint)) {
      suggestions.push({
        reorderLevelId: level.id, itemId: level.itemId, itemName: level.item?.itemName ?? level.itemId, warehouseId: level.warehouseId,
        currentQty: qty, reorderPoint: Number(level.reorderPoint), suggestedQty: Number(level.reorderQty),
      })
    }
  }
  return suggestions
}

// ============================================================
// ABC classification -- real Pareto analysis over stock-ledger
// consumption value (a cached/recomputed snapshot, not live-per-request).
// ============================================================

export async function computeAbcClassification(ctx: { orgId: string }) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    // Consumption value = sum of |qty| * valuation_rate for every issue
    // (negative quantity_change) this item has ever had -- the item's real
    // historical usage value, not a fabricated forecast.
    const rows = await db.select({
      itemId: erpStockLedgerEntries.itemId,
      consumptionValue: sql<string>`sum(abs(${erpStockLedgerEntries.quantityChange}) * ${erpStockLedgerEntries.valuationRate})`,
    })
      .from(erpStockLedgerEntries)
      .where(and(eq(erpStockLedgerEntries.orgId, ctx.orgId), sql`${erpStockLedgerEntries.quantityChange} < 0`))
      .groupBy(erpStockLedgerEntries.itemId)

    const ranked = rows.map((r) => ({ itemId: r.itemId, value: Number(r.consumptionValue) })).sort((a, b) => b.value - a.value)
    const total = ranked.reduce((sum, r) => sum + r.value, 0)

    let cumulative = 0
    const classified: { itemId: string; classification: string; value: number }[] = []
    for (const r of ranked) {
      cumulative += r.value
      const cumulativeShare = total > 0 ? cumulative / total : 0
      const classification = cumulativeShare <= 0.8 ? "A" : cumulativeShare <= 0.95 ? "B" : "C"
      classified.push({ itemId: r.itemId, classification, value: r.value })
    }

    // Replace the previous snapshot entirely -- this is a recomputed
    // classification run, not an incremental update.
    await db.delete(erpAbcClassifications).where(eq(erpAbcClassifications.orgId, ctx.orgId))
    if (classified.length > 0) {
      await db.insert(erpAbcClassifications).values(
        classified.map((c) => ({ orgId: ctx.orgId, itemId: c.itemId, classification: c.classification, consumptionValue: c.value.toString() }))
      )
    }
    return classified
  })
}

export async function listAbcClassifications(ctx: { orgId: string }) {
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.erpAbcClassifications.findMany({
      where: eq(erpAbcClassifications.orgId, ctx.orgId),
      orderBy: (t, { desc }) => desc(t.consumptionValue),
      with: { item: true },
    })
  )
}

// ============================================================
// Cycle count
// ============================================================

export async function createCycleCountPlan(ctx: ErpContext, input: { warehouseId: string; name: string; scheduledDate?: string; itemIds: string[] }) {
  if (!input.itemIds?.length) throw new ServiceError("At least one item is required", 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const [plan] = await db.insert(erpCycleCountPlans).values({
      orgId: ctx.orgId, warehouseId: input.warehouseId, name: input.name, scheduledDate: input.scheduledDate, createdById: ctx.userId,
    }).returning()

    const lines: { planId: string; itemId: string; systemQty: string }[] = []
    for (const itemId of input.itemIds) {
      const { qty } = await getItemValuation({ orgId: ctx.orgId }, itemId, input.warehouseId)
      lines.push({ planId: plan.id, itemId, systemQty: qty.toString() })
    }
    await db.insert(erpCycleCountLines).values(lines)

    return plan
  })
}

export async function listCycleCountPlans(ctx: { orgId: string }) {
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.erpCycleCountPlans.findMany({
      where: eq(erpCycleCountPlans.orgId, ctx.orgId),
      orderBy: (t, { desc }) => desc(t.createdAt),
      with: { lines: { with: { item: true } }, warehouse: true },
    })
  )
}

export async function getCycleCountPlan(ctx: { orgId: string }, planId: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const plan = await db.query.erpCycleCountPlans.findFirst({
      where: and(eq(erpCycleCountPlans.id, planId), eq(erpCycleCountPlans.orgId, ctx.orgId)),
      with: { lines: { with: { item: true } }, warehouse: true },
    })
    if (!plan) throw new ServiceError("Cycle count plan not found", 404)
    return plan
  })
}

export async function recordCycleCount(ctx: { orgId: string; userId: string }, lineId: string, countedQty: number) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const line = await db.query.erpCycleCountLines.findFirst({ where: eq(erpCycleCountLines.id, lineId) })
    if (!line) throw new ServiceError("Cycle count line not found", 404)
    const [updated] = await db.update(erpCycleCountLines).set({
      countedQty: countedQty.toString(), status: "counted", countedById: ctx.userId, countedAt: new Date(),
    }).where(eq(erpCycleCountLines.id, lineId)).returning()
    return updated
  })
}

/** Posts the counted-vs-system variance through the same FIFO engine every other inventory movement uses -- never a bespoke adjustment table. */
export async function postCycleCountAdjustment(ctx: ErpContext, lineId: string) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const line = await db.query.erpCycleCountLines.findFirst({ where: eq(erpCycleCountLines.id, lineId) })
    if (!line) throw new ServiceError("Cycle count line not found", 404)
    if (line.status !== "counted") throw new ServiceError("This line has not been counted yet", 409)
    if (line.countedQty == null) throw new ServiceError("No counted quantity recorded", 400)

    const plan = await db.query.erpCycleCountPlans.findFirst({ where: eq(erpCycleCountPlans.id, line.planId) })
    if (!plan) throw new ServiceError("Cycle count plan not found", 404)

    const variance = Number(line.countedQty) - Number(line.systemQty)
    const postingDate = new Date().toISOString().slice(0, 10)
    if (variance !== 0) {
      const { averageCost } = await getItemValuation({ orgId: ctx.orgId }, line.itemId, plan.warehouseId)
      if (variance > 0) {
        await recordStockReceipt(ctx, {
          itemId: line.itemId, warehouseId: plan.warehouseId, quantity: variance, rate: averageCost,
          postingDate, voucherType: "cycle_count_adjustment", voucherId: line.id,
        })
      } else {
        await recordStockIssue(ctx, {
          itemId: line.itemId, warehouseId: plan.warehouseId, quantity: Math.abs(variance),
          postingDate, voucherType: "cycle_count_adjustment", voucherId: line.id,
        })
      }
    }

    const [updated] = await db.update(erpCycleCountLines).set({ status: "adjusted" }).where(eq(erpCycleCountLines.id, lineId)).returning()
    return updated
  })
}
