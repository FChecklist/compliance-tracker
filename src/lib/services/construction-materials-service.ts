// Point 33 (PROJEXA Materials) service layer -- material master + inbound
// receipts. His words, all of them: "material database. material inbound,
// spec, cost, qty." No outbound/consumption/stock-on-hand -- not requested,
// not built. receipt.unitCost defaults from the master's unitCost but is
// stored per receipt (a delivery can be priced differently), matching
// construction-labour-service.ts's dailyCost-computed-at-write-time posture.
import { constructionMaterials, constructionMaterialIssues, constructionMaterialReceipts, users } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { and, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError }

export type MaterialInput = {
  projectId: string
  name: string
  spec?: string
  unit: string
  unitCost?: number
  reorderLevel?: number | null
}

export type MaterialIssueInput = {
  projectId: string
  materialId: string
  issuedDate: string
  quantity: number
  boqLineItemId?: string | null
  issuedTo?: string | null
  note?: string | null
  createdById: string
}

/** The master row as the list returns it -- the stored columns plus the quantities. */
export type MaterialWithQuantities = typeof constructionMaterials.$inferSelect & {
  receivedToDate: number
  issuedToDate: number
  onHand: number
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

// R67 D-40 (Sumeet's item 8, "material database -- spec, cost, qty"). The
// master had no quantity at all: a storekeeper could see what a bag of cement
// is meant to cost and not how many were on site.
//
// receivedToDate / issuedToDate / onHand are computed here rather than stored,
// so they can never drift from the movements that produced them, and they are
// computed as TWO grouped aggregates inside the SAME transaction as the master
// read -- never one query per material. That distinction is not stylistic:
// tenant-scoped.ts runs on a 5-connection pool, so an N+1 over a 200-line
// master is how this module would take the whole app down.
//
// Voided receipts are excluded by the same isNull(voidedAt) predicate the Cost
// Report uses (D-36), so "Received to date" on the master and the Cost Report's
// own total can never disagree about whether a cancelled delivery counts.
export async function listMaterials(ctx: { orgId: string }, projectId: string): Promise<MaterialWithQuantities[]> {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const materials = await db.query.constructionMaterials.findMany({
      where: and(eq(constructionMaterials.orgId, ctx.orgId), eq(constructionMaterials.projectId, projectId)),
    })
    if (materials.length === 0) return []

    const receivedRows = await db.select({
      materialId: constructionMaterialReceipts.materialId,
      total: sql<string>`coalesce(sum(${constructionMaterialReceipts.quantity}), 0)`,
    })
      .from(constructionMaterialReceipts)
      .where(and(
        eq(constructionMaterialReceipts.orgId, ctx.orgId),
        eq(constructionMaterialReceipts.projectId, projectId),
        isNull(constructionMaterialReceipts.voidedAt)
      ))
      .groupBy(constructionMaterialReceipts.materialId)

    const issuedRows = await db.select({
      materialId: constructionMaterialIssues.materialId,
      total: sql<string>`coalesce(sum(${constructionMaterialIssues.quantity}), 0)`,
    })
      .from(constructionMaterialIssues)
      .where(and(
        eq(constructionMaterialIssues.orgId, ctx.orgId),
        eq(constructionMaterialIssues.projectId, projectId)
      ))
      .groupBy(constructionMaterialIssues.materialId)

    const receivedById = new Map(receivedRows.map((r) => [r.materialId, Number(r.total)]))
    const issuedById = new Map(issuedRows.map((r) => [r.materialId, Number(r.total)]))

    return materials.map((material) => {
      const receivedToDate = receivedById.get(material.id) ?? 0
      const issuedToDate = issuedById.get(material.id) ?? 0
      return {
        ...material,
        receivedToDate,
        issuedToDate,
        // Rounded to the same 3 decimals the UI renders quantities at, so a
        // float subtraction cannot surface 119.99999999999999 on screen.
        onHand: Math.round((receivedToDate - issuedToDate) * 1000) / 1000,
      }
    })
  })
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
      // R67 D-40: null and 0 are different facts here -- see the column's own
      // comment in schema.ts -- so an omitted threshold stores null.
      reorderLevel: input.reorderLevel === undefined || input.reorderLevel === null ? null : String(input.reorderLevel),
    }).returning()
    return row
  })
}

// Real-screen conversion (2026-08-30): single-material lookup + real update
// for the Material Object Page -- neither existed since Wave 33; a spec/
// unit-cost correction or retiring a material had no path except
// re-creating it. Mirrors construction-labour-service.ts's identical
// getRosterEntry()/updateRosterEntry() fix this same session.
// R67 D-40: the object page leads on On hand, so the single-material read
// carries the same three quantities the master list does, computed the same way
// (see listMaterials' own comment) and in one transaction.
export async function getMaterial(ctx: { orgId: string }, materialId: string): Promise<MaterialWithQuantities> {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const material = await db.query.constructionMaterials.findFirst({ where: and(eq(constructionMaterials.id, materialId), eq(constructionMaterials.orgId, ctx.orgId)) })
    if (!material) throw new ServiceError("Material not found", 404)

    const [receivedRow] = await db.select({
      total: sql<string>`coalesce(sum(${constructionMaterialReceipts.quantity}), 0)`,
    })
      .from(constructionMaterialReceipts)
      .where(and(
        eq(constructionMaterialReceipts.orgId, ctx.orgId),
        eq(constructionMaterialReceipts.materialId, materialId),
        isNull(constructionMaterialReceipts.voidedAt)
      ))

    const [issuedRow] = await db.select({
      total: sql<string>`coalesce(sum(${constructionMaterialIssues.quantity}), 0)`,
    })
      .from(constructionMaterialIssues)
      .where(and(
        eq(constructionMaterialIssues.orgId, ctx.orgId),
        eq(constructionMaterialIssues.materialId, materialId)
      ))

    const receivedToDate = Number(receivedRow?.total ?? 0)
    const issuedToDate = Number(issuedRow?.total ?? 0)
    return {
      ...material,
      receivedToDate,
      issuedToDate,
      onHand: Math.round((receivedToDate - issuedToDate) * 1000) / 1000,
    }
  })
}

export async function updateMaterial(
  ctx: { orgId: string },
  materialId: string,
  patch: Partial<{ name: string; spec: string | null; unit: string; unitCost: number; reorderLevel: number | null; isActive: boolean }>
) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const existing = await db.query.constructionMaterials.findFirst({ where: and(eq(constructionMaterials.id, materialId), eq(constructionMaterials.orgId, ctx.orgId)) })
    if (!existing) throw new ServiceError("Material not found", 404)
    if (patch.name !== undefined && !patch.name.trim()) throw new ServiceError("name cannot be empty", 400)
    if (patch.unit !== undefined && !patch.unit.trim()) throw new ServiceError("unit cannot be empty", 400)

    const [row] = await db.update(constructionMaterials)
      .set({
        ...patch,
        unitCost: patch.unitCost !== undefined ? String(patch.unitCost) : undefined,
        // R67 D-40: an explicit null CLEARS the threshold; an absent key leaves
        // it alone. Passing `undefined` through String() would have written the
        // literal "undefined".
        reorderLevel: patch.reorderLevel === undefined
          ? undefined
          : patch.reorderLevel === null ? null : String(patch.reorderLevel),
      })
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
/**
 * R67 D-57 (audit R-186): `from`/`to` narrow the report to a received-date
 * window, INCLUSIVE on both bounds (received_date is a date column, not a
 * timestamp, so a `to` of today includes today's deliveries).
 *
 * The filter is applied in the same grouped aggregate, not by summing the
 * whole ledger and subtracting: a Cost Report over a month must not get slower
 * as a project's history grows, and the browser must never receive receipts it
 * is only going to discard. Omitting both keeps the previous all-time
 * behaviour exactly, so every existing caller is unaffected.
 */
export async function getMaterialCostReport(
  ctx: { orgId: string },
  projectId: string,
  filters: { from?: string; to?: string } = {}
) {
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
      // R67 D-57: the From/To window composes with that exclusion in the same
      // predicate, so a windowed report still cannot count a voided delivery.
      .where(and(
        eq(constructionMaterialReceipts.orgId, ctx.orgId),
        eq(constructionMaterialReceipts.projectId, projectId),
        isNull(constructionMaterialReceipts.voidedAt),
        ...(filters.from ? [gte(constructionMaterialReceipts.receivedDate, filters.from)] : []),
        ...(filters.to ? [lte(constructionMaterialReceipts.receivedDate, filters.to)] : [])
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

// R67 D-40: the OUT side of the ledger.
export async function listMaterialIssues(ctx: { orgId: string }, projectId: string) {
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.constructionMaterialIssues.findMany({
      where: and(eq(constructionMaterialIssues.orgId, ctx.orgId), eq(constructionMaterialIssues.projectId, projectId)),
      with: { material: true },
      orderBy: (t, { desc }) => desc(t.issuedDate),
    })
  )
}

// R67 D-40. ONE RULE, ONE SPELLING. The refusal below is shown to the same
// storekeeper as PROJEXA's own field-level warning (src/lib/unit-label.ts),
// and the two used to disagree: the form said "Only 120 bags on hand" and the
// server -- which is the one that actually refuses, and whose sentence the
// form prints verbatim when it loses the race -- said "Only 120 bag on hand".
// Same rule, two spellings, on one screen. The rule is ported here rather than
// the client dropping its "s", because the authority is what a user must be
// able to read back to a colleague.
//
// The rule itself is deliberately conservative: unit is free text set per
// material, so this cannot be a lookup of every unit that will ever exist. Unit
// SYMBOLS are plural-invariant ("120 kg", never "120 kgs"; "5 cum", never
// "5 cums"), countable nouns -- bag, drum, roll, sheet -- take an "s", and
// anything uncertain is returned UNCHANGED. A missing "s" reads as terse; an
// invented one reads as a system that does not know what it is measuring.
// Kept byte-identical to pluraliseUnit() in projexa's src/lib/unit-label.ts.
const INVARIANT_UNITS = new Set([
  // mass
  "kg", "g", "mg", "t", "mt", "ton", "tonne", "lb", "lbs",
  // length
  "m", "cm", "mm", "km", "ft", "in", "rmt", "rft", "lm",
  // area / volume
  "m2", "m3", "sqm", "sqft", "cum", "cft", "cbm",
  // capacity / count-ish abbreviations
  "l", "ml", "ltr", "nos", "no", "pcs", "qty", "set", "each", "ea", "unit",
])

/** `pluraliseUnit("bag", 120) === "bags"`; `("kg", 120) === "kg"`; `("bag", 1) === "bag"`. */
export function pluraliseUnit(unit: string | null | undefined, quantity: number): string {
  const value = (unit ?? "").trim()
  if (!value) return ""
  if (quantity === 1) return value
  const lower = value.toLowerCase()
  if (INVARIANT_UNITS.has(lower)) return value
  if (lower.endsWith("s")) return value
  return `${value}s`
}

/** The one sentence for "you are trying to issue more than is on site". */
export function onHandLimitMessage(onHand: number, unit: string | null | undefined): string {
  return `Only ${onHand} ${pluraliseUnit(unit, onHand)} on hand`.replace(/\s+/g, " ").trim()
}

// R67 D-40. The on-hand cap is enforced HERE, not only in the form: the form's
// cap is a courtesy to the storekeeper, this is the rule. Two people issuing
// the last 50 bags from two phones would otherwise both pass a client check and
// drive the ledger negative, and a negative on-hand is not a number anyone can
// act on.
//
// Both sums run inside the SAME transaction as the insert, so the balance this
// decision is made on is the balance at the moment of writing.
export async function createMaterialIssue(ctx: { orgId: string }, input: MaterialIssueInput) {
  if (!input.materialId) throw new ServiceError("materialId is required", 400)
  if (!input.projectId) throw new ServiceError("projectId is required", 400)
  if (!input.issuedDate) throw new ServiceError("issuedDate is required", 400)
  if (input.quantity === undefined || input.quantity === null) throw new ServiceError("quantity is required", 400)
  const quantity = Number(input.quantity)
  if (!Number.isFinite(quantity) || quantity <= 0) throw new ServiceError("quantity must be greater than 0", 400)

  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const material = await db.query.constructionMaterials.findFirst({
      where: and(eq(constructionMaterials.id, input.materialId), eq(constructionMaterials.orgId, ctx.orgId)),
    })
    if (!material) throw new ServiceError("Material not found", 404)

    const [receivedRow] = await db.select({
      total: sql<string>`coalesce(sum(${constructionMaterialReceipts.quantity}), 0)`,
    })
      .from(constructionMaterialReceipts)
      .where(and(
        eq(constructionMaterialReceipts.orgId, ctx.orgId),
        eq(constructionMaterialReceipts.materialId, input.materialId),
        isNull(constructionMaterialReceipts.voidedAt)
      ))

    const [issuedRow] = await db.select({
      total: sql<string>`coalesce(sum(${constructionMaterialIssues.quantity}), 0)`,
    })
      .from(constructionMaterialIssues)
      .where(and(
        eq(constructionMaterialIssues.orgId, ctx.orgId),
        eq(constructionMaterialIssues.materialId, input.materialId)
      ))

    const onHand = Math.round((Number(receivedRow?.total ?? 0) - Number(issuedRow?.total ?? 0)) * 1000) / 1000
    if (quantity > onHand) {
      // The message names the real figure and the real unit, because "invalid
      // quantity" tells a storekeeper nothing they can act on -- and it is
      // spelled exactly the way the form spells it, so the user never sees the
      // same refusal two ways depending on who caught it.
      throw new ServiceError(onHandLimitMessage(onHand, material.unit), 400)
    }

    const [row] = await db.insert(constructionMaterialIssues).values({
      orgId: ctx.orgId,
      projectId: input.projectId,
      materialId: input.materialId,
      issuedDate: input.issuedDate,
      quantity: String(quantity),
      boqLineItemId: input.boqLineItemId?.trim() || null,
      issuedTo: input.issuedTo?.trim() || null,
      note: input.note?.trim() || null,
      createdById: input.createdById,
    }).returning()
    return row
  })
}
