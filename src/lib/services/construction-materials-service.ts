// Point 33 (PROJEXA Materials) service layer -- material master + inbound
// receipts. His words, all of them: "material database. material inbound,
// spec, cost, qty." No outbound/consumption/stock-on-hand -- not requested,
// not built. receipt.unitCost defaults from the master's unitCost but is
// stored per receipt (a delivery can be priced differently), matching
// construction-labour-service.ts's dailyCost-computed-at-write-time posture.
import { constructionMaterials, constructionMaterialReceipts, users } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { and, eq, inArray, isNull, sql } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError }

export type MaterialInput = {
  projectId: string
  name: string
  spec?: string
  unit: string
  unitCost?: number
}

export type MaterialReceiptInput = {
  projectId: string
  materialId: string
  receivedDate: string
  quantity: number
  unitCost?: number
  vendorId?: string
  reference?: string
  notes?: string
  createdById: string
}

export async function listMaterials(ctx: { orgId: string }, projectId: string) {
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.constructionMaterials.findMany({
      where: and(eq(constructionMaterials.orgId, ctx.orgId), eq(constructionMaterials.projectId, projectId)),
    })
  )
}

export async function createMaterial(ctx: { orgId: string }, input: MaterialInput) {
  const name = input.name?.trim()
  if (!name) throw new ServiceError("name is required", 400)
  if (!input.projectId) throw new ServiceError("projectId is required", 400)
  if (!input.unit?.trim()) throw new ServiceError("unit is required", 400)

  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const [row] = await db.insert(constructionMaterials).values({
      orgId: ctx.orgId, projectId: input.projectId, name,
      spec: input.spec || null, unit: input.unit.trim(),
      unitCost: String(input.unitCost ?? 0),
    }).returning()
    return row
  })
}

// Real-screen conversion (2026-08-30): single-material lookup + real update
// for the Material Object Page -- neither existed since Wave 33; a spec/
// unit-cost correction or retiring a material had no path except
// re-creating it. Mirrors construction-labour-service.ts's identical
// getRosterEntry()/updateRosterEntry() fix this same session.
export async function getMaterial(ctx: { orgId: string }, materialId: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const material = await db.query.constructionMaterials.findFirst({ where: and(eq(constructionMaterials.id, materialId), eq(constructionMaterials.orgId, ctx.orgId)) })
    if (!material) throw new ServiceError("Material not found", 404)
    return material
  })
}

export async function updateMaterial(
  ctx: { orgId: string },
  materialId: string,
  patch: Partial<{ name: string; spec: string | null; unit: string; unitCost: number; isActive: boolean }>
) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const existing = await db.query.constructionMaterials.findFirst({ where: and(eq(constructionMaterials.id, materialId), eq(constructionMaterials.orgId, ctx.orgId)) })
    if (!existing) throw new ServiceError("Material not found", 404)
    if (patch.name !== undefined && !patch.name.trim()) throw new ServiceError("name cannot be empty", 400)
    if (patch.unit !== undefined && !patch.unit.trim()) throw new ServiceError("unit cannot be empty", 400)

    const [row] = await db.update(constructionMaterials)
      .set({ ...patch, unitCost: patch.unitCost !== undefined ? String(patch.unitCost) : undefined })
      .where(eq(constructionMaterials.id, materialId)).returning()
    return row
  })
}

// R67 D-36: voided receipts are deliberately still returned. The list renders
// them struck through with their reason, which is the whole point of a soft
// void -- a row that vanished would leave a supervisor unable to tell "this
// delivery was cancelled" from "someone never recorded it". Only the TOTALS
// exclude them (see getMaterialCostReport below).
export async function listMaterialReceipts(ctx: { orgId: string }, projectId: string) {
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.constructionMaterialReceipts.findMany({
      where: and(eq(constructionMaterialReceipts.orgId, ctx.orgId), eq(constructionMaterialReceipts.projectId, projectId)),
      with: { material: true },
      orderBy: (t, { desc }) => desc(t.receivedDate),
    })
  )
}

// R67 D-36: the receipt object page. Same org-scoped single-row shape as
// getMaterial() above; carries the material so the page can link to it
// without a second hop, and resolves the two user ids to NAMES so the page
// never has to print a raw cuid at the user (createdById can also be an API
// key's id, in which case the name resolves to null and the screen renders
// the en-dash -- "we cannot say who" rather than an opaque identifier).
export async function getMaterialReceipt(ctx: { orgId: string }, receiptId: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const receipt = await db.query.constructionMaterialReceipts.findFirst({
      where: and(eq(constructionMaterialReceipts.id, receiptId), eq(constructionMaterialReceipts.orgId, ctx.orgId)),
      with: { material: true },
    })
    if (!receipt) throw new ServiceError("Material receipt not found", 404)

    const ids = [receipt.createdById, receipt.voidedBy].filter((id): id is string => !!id)
    const nameById = new Map<string, string>()
    if (ids.length > 0) {
      const rows = await db.select({ id: users.id, name: users.name })
        .from(users)
        .where(and(eq(users.orgId, ctx.orgId), inArray(users.id, ids)))
      for (const row of rows) nameById.set(row.id, row.name)
    }

    return {
      ...receipt,
      recordedByName: nameById.get(receipt.createdById) ?? null,
      voidedByName: receipt.voidedBy ? nameById.get(receipt.voidedBy) ?? null : null,
    }
  })
}

// R67 D-36. A mis-keyed quantity used to be permanent -- there was no update
// and no delete path for a receipt at all. This is the correction path, and
// it is deliberately a SOFT void: the row survives with who voided it, when,
// and why, and drops out of every total. A hard delete would silently rewrite
// history in the one ledger the Cost Report is computed from.
export async function voidMaterialReceipt(
  ctx: { orgId: string },
  receiptId: string,
  input: { voidReason: string; voidedBy: string }
) {
  const reason = input.voidReason?.trim()
  if (!reason) throw new ServiceError("A reason is required to void a receipt", 400)
  if (!input.voidedBy) throw new ServiceError("voidedBy is required", 400)

  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const existing = await db.query.constructionMaterialReceipts.findFirst({
      where: and(eq(constructionMaterialReceipts.id, receiptId), eq(constructionMaterialReceipts.orgId, ctx.orgId)),
    })
    if (!existing) throw new ServiceError("Material receipt not found", 404)
    if (existing.voidedAt) throw new ServiceError("This receipt is already voided", 409)

    const [row] = await db.update(constructionMaterialReceipts)
      .set({ voidedAt: new Date(), voidReason: reason, voidedBy: input.voidedBy })
      .where(eq(constructionMaterialReceipts.id, receiptId))
      .returning()
    return row
  })
}

// Real-screen conversion (2026-08-30): backs the "Cost Report" tab that
// /site-materials has shown since R52 but that has never worked -- the
// proxy it calls (PROJEXA's api/construction-materials/cost-report/route.ts)
// has always pointed at VERIDIAN's /construction/materials/cost-report,
// and nothing on this side ever implemented that path. Real aggregation
// over the real receipts ledger, matching construction-valuation-service.ts's
// own groupBy/sum precedent (previousBilledAmountsByLineItem) rather than
// inventing a parallel summary table. quantity/unitCost are both numeric
// columns stored as strings (see createMaterialReceipt above) -- summed in
// SQL, not fetched row-by-row and reduced in JS, so this scales the same way
// that precedent does.
export async function getMaterialCostReport(ctx: { orgId: string }, projectId: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const totals = await db.select({
      materialId: constructionMaterialReceipts.materialId,
      totalQuantityReceived: sql<string>`coalesce(sum(${constructionMaterialReceipts.quantity}), 0)`,
      totalCost: sql<string>`coalesce(sum(${constructionMaterialReceipts.quantity} * ${constructionMaterialReceipts.unitCost}), 0)`,
    })
      .from(constructionMaterialReceipts)
      // R67 D-36: voided receipts are excluded from every total, in SQL, at
      // the one place the totals are produced -- so the Cost Report, the
      // master's "Received to date" and anything else reading this aggregate
      // can never disagree about whether a voided delivery counts.
      .where(and(
        eq(constructionMaterialReceipts.orgId, ctx.orgId),
        eq(constructionMaterialReceipts.projectId, projectId),
        isNull(constructionMaterialReceipts.voidedAt)
      ))
      .groupBy(constructionMaterialReceipts.materialId)

    if (totals.length === 0) return []

    const materials = await db.query.constructionMaterials.findMany({
      where: and(eq(constructionMaterials.orgId, ctx.orgId), eq(constructionMaterials.projectId, projectId)),
    })
    const materialById = new Map(materials.map((m) => [m.id, m]))

    return totals.map((t) => {
      const material = materialById.get(t.materialId)
      const totalQuantityReceived = Number(t.totalQuantityReceived)
      const totalCost = Math.round(Number(t.totalCost) * 100) / 100
      return {
        materialId: t.materialId,
        name: material?.name ?? t.materialId,
        spec: material?.spec ?? null,
        unit: material?.unit ?? "",
        totalQuantityReceived,
        totalCost,
        averageUnitCost: totalQuantityReceived > 0 ? Math.round((totalCost / totalQuantityReceived) * 100) / 100 : 0,
      }
    })
  })
}

export async function createMaterialReceipt(ctx: { orgId: string }, input: MaterialReceiptInput) {
  if (!input.materialId) throw new ServiceError("materialId is required", 400)
  if (!input.projectId) throw new ServiceError("projectId is required", 400)
  if (!input.receivedDate) throw new ServiceError("receivedDate is required", 400)
  if (input.quantity === undefined || input.quantity === null) throw new ServiceError("quantity is required", 400)

  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const material = await db.query.constructionMaterials.findFirst({
      where: and(eq(constructionMaterials.id, input.materialId), eq(constructionMaterials.orgId, ctx.orgId)),
    })
    if (!material) throw new ServiceError("Material not found", 404)

    const [row] = await db.insert(constructionMaterialReceipts).values({
      orgId: ctx.orgId, projectId: input.projectId, materialId: input.materialId,
      receivedDate: input.receivedDate,
      quantity: String(input.quantity),
      unitCost: input.unitCost !== undefined ? String(input.unitCost) : material.unitCost,
      vendorId: input.vendorId || null,
      reference: input.reference?.trim() || null,
      notes: input.notes || null,
      createdById: input.createdById,
    }).returning()
    return row
  })
}
