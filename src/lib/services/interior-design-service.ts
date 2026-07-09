// Wave 142 (PROJEXA gap analysis): mood boards, FF&E specification,
// procurement markup. Confirmed via research: no OSS library exists for
// either -- first-party build. Margin is computed at read time from
// unitCost/unitPrice, not stored redundantly (matches this codebase's
// query-time-rollup convention, e.g. kpi-hub-service.ts).
import {
  interiorMoodBoards, interiorMoodBoardItems, interiorFfeItems,
} from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { and, eq, inArray } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError }

// ---------------- Mood Boards ----------------

export type MoodBoardInput = { projectId: string; title: string; roomOrArea?: string; description?: string }

export async function createMoodBoard(ctx: { orgId: string; userId: string }, input: MoodBoardInput) {
  if (!input.title?.trim()) throw new ServiceError("title is required", 400)
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const [row] = await db.insert(interiorMoodBoards).values({
      orgId: ctx.orgId, projectId: input.projectId, title: input.title.trim(),
      roomOrArea: input.roomOrArea ?? null, description: input.description ?? null, createdById: ctx.userId,
    }).returning()
    return row
  })
}

export async function listMoodBoards(ctx: { orgId: string }, projectId: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const boards = await db.query.interiorMoodBoards.findMany({
      where: and(eq(interiorMoodBoards.orgId, ctx.orgId), eq(interiorMoodBoards.projectId, projectId)),
      orderBy: (t, { desc }) => desc(t.createdAt),
    })
    if (boards.length === 0) return []
    const items = await db.query.interiorMoodBoardItems.findMany({
      where: inArray(interiorMoodBoardItems.moodBoardId, boards.map((b) => b.id)),
      orderBy: (t, { asc }) => asc(t.sortOrder),
    })
    return boards.map((b) => ({ ...b, items: items.filter((i) => i.moodBoardId === b.id) }))
  })
}

export async function addMoodBoardItem(ctx: { orgId: string }, moodBoardId: string, input: { documentId?: string; label?: string; notes?: string }) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const board = await db.query.interiorMoodBoards.findFirst({ where: and(eq(interiorMoodBoards.id, moodBoardId), eq(interiorMoodBoards.orgId, ctx.orgId)) })
    if (!board) throw new ServiceError("Mood board not found", 404)

    const existing = await db.query.interiorMoodBoardItems.findMany({ where: eq(interiorMoodBoardItems.moodBoardId, moodBoardId) })
    const [row] = await db.insert(interiorMoodBoardItems).values({
      moodBoardId, documentId: input.documentId ?? null, label: input.label ?? null, notes: input.notes ?? null,
      sortOrder: existing.length,
    }).returning()
    return row
  })
}

export async function removeMoodBoardItem(ctx: { orgId: string }, moodBoardId: string, itemId: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const board = await db.query.interiorMoodBoards.findFirst({ where: and(eq(interiorMoodBoards.id, moodBoardId), eq(interiorMoodBoards.orgId, ctx.orgId)) })
    if (!board) throw new ServiceError("Mood board not found", 404)
    await db.delete(interiorMoodBoardItems).where(and(eq(interiorMoodBoardItems.id, itemId), eq(interiorMoodBoardItems.moodBoardId, moodBoardId)))
    return { ok: true }
  })
}

export async function updateMoodBoardStatus(ctx: { orgId: string }, moodBoardId: string, status: string) {
  const VALID = ["draft", "shared", "approved"]
  if (!VALID.includes(status)) throw new ServiceError(`status must be one of: ${VALID.join(", ")}`, 400)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const [row] = await db.update(interiorMoodBoards).set({ status: status as typeof interiorMoodBoards.$inferInsert.status })
      .where(and(eq(interiorMoodBoards.id, moodBoardId), eq(interiorMoodBoards.orgId, ctx.orgId))).returning()
    if (!row) throw new ServiceError("Mood board not found", 404)
    return row
  })
}

// ---------------- FF&E (Furniture, Fixtures & Equipment) ----------------

export type FfeItemInput = {
  projectId: string; itemName: string; roomOrArea?: string; category?: string; description?: string
  vendorId?: string; sku?: string; quantity?: number; unitCost?: number; unitPrice?: number
  leadTimeDays?: number; documentId?: string
}

export async function createFfeItem(ctx: { orgId: string; userId: string }, input: FfeItemInput) {
  if (!input.itemName?.trim()) throw new ServiceError("itemName is required", 400)
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const [row] = await db.insert(interiorFfeItems).values({
      orgId: ctx.orgId, projectId: input.projectId, itemName: input.itemName.trim(),
      roomOrArea: input.roomOrArea ?? null,
      category: (input.category as typeof interiorFfeItems.$inferInsert.category) ?? "furniture",
      description: input.description ?? null, vendorId: input.vendorId ?? null, sku: input.sku ?? null,
      quantity: input.quantity ?? 1, unitCost: String(input.unitCost ?? 0), unitPrice: String(input.unitPrice ?? 0),
      leadTimeDays: input.leadTimeDays ?? null, documentId: input.documentId ?? null, createdById: ctx.userId,
    }).returning()
    return row
  })
}

export async function listFfeItems(ctx: { orgId: string }, projectId: string, filters: { roomOrArea?: string; status?: string } = {}) {
  return withTenantContext({ orgId: ctx.orgId }, (db) => {
    const conditions = [eq(interiorFfeItems.orgId, ctx.orgId), eq(interiorFfeItems.projectId, projectId)]
    if (filters.roomOrArea) conditions.push(eq(interiorFfeItems.roomOrArea, filters.roomOrArea))
    if (filters.status) conditions.push(eq(interiorFfeItems.status, filters.status as typeof interiorFfeItems.$inferSelect.status))
    return db.query.interiorFfeItems.findMany({ where: and(...conditions), orderBy: (t, { desc }) => desc(t.createdAt) })
  })
}

export async function updateFfeItemStatus(ctx: { orgId: string }, itemId: string, status: string) {
  const VALID = ["specified", "ordered", "received", "installed"]
  if (!VALID.includes(status)) throw new ServiceError(`status must be one of: ${VALID.join(", ")}`, 400)
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const [row] = await db.update(interiorFfeItems).set({ status: status as typeof interiorFfeItems.$inferInsert.status })
      .where(and(eq(interiorFfeItems.id, itemId), eq(interiorFfeItems.orgId, ctx.orgId))).returning()
    if (!row) throw new ServiceError("FF&E item not found", 404)
    return row
  })
}

export type MarginSummary = {
  totalCost: number; totalPrice: number; totalMargin: number; marginPercent: number
  byCategory: { category: string; cost: number; price: number; margin: number }[]
}

// Procurement markup/margin report -- the "Studio Designer/Programa"-style
// trade-cost-vs-client-price rollup. Computed at read time from the real
// FF&E line items, not a duplicated ledger.
export async function getMarginSummary(ctx: { orgId: string }, projectId: string): Promise<MarginSummary> {
  const items = await withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.interiorFfeItems.findMany({ where: and(eq(interiorFfeItems.orgId, ctx.orgId), eq(interiorFfeItems.projectId, projectId)) })
  )

  const byCategory = new Map<string, { cost: number; price: number }>()
  let totalCost = 0
  let totalPrice = 0
  for (const item of items) {
    const cost = Number(item.unitCost) * item.quantity
    const price = Number(item.unitPrice) * item.quantity
    totalCost += cost
    totalPrice += price
    const bucket = byCategory.get(item.category) ?? { cost: 0, price: 0 }
    bucket.cost += cost
    bucket.price += price
    byCategory.set(item.category, bucket)
  }

  return {
    totalCost, totalPrice, totalMargin: totalPrice - totalCost,
    marginPercent: totalPrice > 0 ? ((totalPrice - totalCost) / totalPrice) * 100 : 0,
    byCategory: Array.from(byCategory.entries()).map(([category, v]) => ({ category, cost: v.cost, price: v.price, margin: v.price - v.cost })),
  }
}
