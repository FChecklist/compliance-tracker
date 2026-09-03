// Point 33 (PROJEXA Materials) service layer -- material master + inbound
// receipts. His words, all of them: "material database. material inbound,
// spec, cost, qty." No outbound/consumption/stock-on-hand -- not requested,
// not built. receipt.unitCost defaults from the master's unitCost but is
// stored per receipt (a delivery can be priced differently), matching
// construction-labour-service.ts's dailyCost-computed-at-write-time posture.
import { constructionMaterials, constructionMaterialIssues, constructionMaterialReceipts, erpSuppliers, users } from "@/lib/db"
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
// R67 E-05 (R-103). The Cost Report tab was "a summary card wearing the word
// report": no date range, no grand total, no vendor, no export, and it counted
// receipts that had been VOIDED. This is the real report behind it.
//
// WHAT CHANGED, and why each part is here rather than in the browser:
//   * from / to -- a report with no period is not a report. Filtered in SQL so
//     the totals row and the rows above it can never describe different sets.
//   * groupBy -- "which material cost most" and "which vendor cost most" are
//     the two questions a QS actually asks of this ledger.
//   * vendor names -- receipts carry only a vendor_id; every screen that
//     showed it showed a cuid. Joined once here, not per row.
//   * voided receipts EXCLUDED (WS-I item I-02 added voided_at for exactly
//     this: a voided goods receipt stays queryable for its audit trail and
//     must never be counted again as cost). Every consumer that totals cost
//     must filter voided_at IS NULL -- that column's own schema comment.
//   * totals -- returned WITH the rows, from the same grouped read, so the
//     grand total ties by construction rather than by the browser re-adding
//     the numbers and hoping.
//
// MERGED WITH R67 D-57 (audit R-186), which asked this same function for a
// from/to window and landed on main first. Its contract is kept exactly and is
// the one described above: both bounds are INCLUSIVE (received_date is a date
// column, not a timestamp, so a `to` of today includes today's deliveries);
// the window is applied inside the grouped aggregate rather than by summing
// the whole ledger and subtracting, so the report does not get slower as a
// project's history grows and the browser never receives receipts it is only
// going to discard; and omitting BOTH bounds keeps the previous all-time
// behaviour, so every existing caller is unaffected. D-57's `{ from, to }`
// third argument is a structural subset of MaterialCostReportOptions below,
// so callers written against it keep working unchanged. D-36's rule that
// voided receipts are excluded at the one place the totals are produced
// composes with the window in the same predicate: a windowed report still
// cannot count a voided delivery.
export type MaterialCostReportGroupBy = "material" | "vendor"

export type MaterialCostReportOptions = {
  /** YYYY-MM-DD, inclusive. Omitted = no lower bound. */
  from?: string
  /** YYYY-MM-DD, inclusive. Omitted = no upper bound. */
  to?: string
  groupBy?: MaterialCostReportGroupBy
}

/** One (material, vendor) pair as the grouped SQL read returns it. */
export type MaterialReceiptGroup = {
  materialId: string
  vendorId: string | null
  quantity: number
  cost: number
}

export type MaterialCostReportRow = {
  /** materialId when grouping by material, vendorId (or "unassigned") when grouping by vendor. */
  key: string
  materialId: string | null
  name: string
  spec: string | null
  vendorId: string | null
  vendorName: string | null
  unit: string | null
  totalQuantityReceived: number
  totalCost: number
  averageUnitCost: number
  /** The material master's own unit cost. null when the row spans more than one material. */
  masterUnitCost: number | null
  /** averageUnitCost - masterUnitCost. null when there is nothing single to compare against. */
  variance: number | null
}

export type MaterialCostReport = {
  rows: MaterialCostReportRow[]
  totals: { quantity: number; cost: number }
  /** Echoed back so the screen's parameter bar and its numbers can never disagree. */
  params: { projectId: string; from: string | null; to: string | null; groupBy: MaterialCostReportGroupBy }
}

/** More than one distinct material/vendor/unit rolled into one row. Stated in words, never blank. */
export const MIXED_MATERIALS_LABEL = "Multiple materials"
export const MIXED_VENDORS_LABEL = "Multiple vendors"
export const NO_VENDOR_KEY = "unassigned"
export const NO_VENDOR_LABEL = "No vendor recorded"

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * Pure roll-up: grouped (material, vendor) receipt totals -> the report's rows
 * and its grand total. DB-free so the arithmetic that a QS checks by hand is
 * testable without a database, the same convention computeEarnedValue and
 * aggregateDesignerTimesheetCosts follow in construction-reports-service.ts.
 *
 * The identity this guarantees, and which the screen asserts before it will
 * enable Export: sum(rows.totalCost) === totals.cost, in BOTH groupings, because
 * both are folded from the same input array.
 */
export function aggregateMaterialCostReport(
  groups: MaterialReceiptGroup[],
  materialById: Map<string, { name: string; spec: string | null; unit: string; unitCost: string | number | null }>,
  vendorNameById: Map<string, string>,
  params: MaterialCostReport["params"]
): MaterialCostReport {
  const byKey = new Map<string, { quantity: number; cost: number; materialIds: Set<string>; vendorIds: Set<string | null> }>()
  for (const g of groups) {
    const key = params.groupBy === "vendor" ? (g.vendorId ?? NO_VENDOR_KEY) : g.materialId
    const bucket = byKey.get(key) ?? { quantity: 0, cost: 0, materialIds: new Set<string>(), vendorIds: new Set<string | null>() }
    bucket.quantity += g.quantity
    bucket.cost += g.cost
    bucket.materialIds.add(g.materialId)
    bucket.vendorIds.add(g.vendorId)
    byKey.set(key, bucket)
  }

  const rows: MaterialCostReportRow[] = [...byKey.entries()].map(([key, bucket]) => {
    const materialIds = [...bucket.materialIds]
    const soleMaterialId = materialIds.length === 1 ? materialIds[0] : null
    const soleMaterial = soleMaterialId ? materialById.get(soleMaterialId) : undefined
    const vendorIds = [...bucket.vendorIds]
    const soleVendorId = vendorIds.length === 1 ? vendorIds[0] : null

    const totalCost = round2(bucket.cost)
    const quantity = round2(bucket.quantity)
    const averageUnitCost = quantity > 0 ? round2(totalCost / quantity) : 0
    const masterUnitCost = soleMaterial && soleMaterial.unitCost !== null && soleMaterial.unitCost !== ""
      ? round2(Number(soleMaterial.unitCost))
      : null

    return {
      key,
      materialId: soleMaterialId,
      name: soleMaterial ? soleMaterial.name : soleMaterialId ?? MIXED_MATERIALS_LABEL,
      spec: soleMaterial?.spec ?? null,
      vendorId: soleVendorId,
      vendorName: soleVendorId === null
        ? (vendorIds.length > 1 ? MIXED_VENDORS_LABEL : NO_VENDOR_LABEL)
        : (vendorNameById.get(soleVendorId) ?? soleVendorId),
      // A quantity summed across two different units is meaningless, so the
      // unit is only stated when there IS one.
      unit: soleMaterial?.unit ?? null,
      totalQuantityReceived: quantity,
      totalCost,
      averageUnitCost,
      masterUnitCost,
      variance: masterUnitCost !== null ? round2(averageUnitCost - masterUnitCost) : null,
    }
  })

  // Costliest first -- the question this report answers is "where did the
  // money go", and that is the row a reader wants at the top.
  rows.sort((a, b) => b.totalCost - a.totalCost)

  return {
    rows,
    totals: {
      quantity: round2(groups.reduce((s, g) => s + g.quantity, 0)),
      cost: round2(groups.reduce((s, g) => s + g.cost, 0)),
    },
    params,
  }
}

export async function getMaterialCostReport(
  ctx: { orgId: string },
  projectId: string,
  options: MaterialCostReportOptions = {}
): Promise<MaterialCostReport> {
  const groupBy: MaterialCostReportGroupBy = options.groupBy === "vendor" ? "vendor" : "material"
  const from = options.from?.trim() || null
  const to = options.to?.trim() || null
  const params = { projectId, from, to, groupBy }

  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const conditions = [
      eq(constructionMaterialReceipts.orgId, ctx.orgId),
      eq(constructionMaterialReceipts.projectId, projectId),
      // WS-I I-02's own rule: a voided receipt stays queryable for its audit
      // trail and is never counted as cost again.
      isNull(constructionMaterialReceipts.voidedAt),
    ]
    if (from) conditions.push(gte(constructionMaterialReceipts.receivedDate, from))
    if (to) conditions.push(lte(constructionMaterialReceipts.receivedDate, to))

    // One grouped read, by (material, vendor) -- the finest grain BOTH
    // groupings fold from, so switching Group by never re-queries and the two
    // views can never disagree. Summed in SQL, same posture as before.
    const grouped = await db.select({
      materialId: constructionMaterialReceipts.materialId,
      vendorId: constructionMaterialReceipts.vendorId,
      quantity: sql<string>`coalesce(sum(${constructionMaterialReceipts.quantity}), 0)`,
      cost: sql<string>`coalesce(sum(${constructionMaterialReceipts.quantity} * coalesce(${constructionMaterialReceipts.unitCost}, 0)), 0)`,
    })
      .from(constructionMaterialReceipts)
      .where(and(...conditions))
      .groupBy(constructionMaterialReceipts.materialId, constructionMaterialReceipts.vendorId)

    if (grouped.length === 0) return { rows: [], totals: { quantity: 0, cost: 0 }, params }

    const materials = await db.query.constructionMaterials.findMany({
      where: and(eq(constructionMaterials.orgId, ctx.orgId), eq(constructionMaterials.projectId, projectId)),
      columns: { id: true, name: true, spec: true, unit: true, unitCost: true },
    })
    const materialById = new Map(materials.map((m) => [m.id, { name: m.name, spec: m.spec, unit: m.unit, unitCost: m.unitCost }]))

    // Vendors are erp_suppliers (the /api/v1/projexa/vendors route's own
    // aliasing) -- looked up once for every vendor on the report, never per
    // row, and only when at least one receipt actually names one.
    const vendorIds = [...new Set(grouped.map((g) => g.vendorId).filter((v): v is string => Boolean(v)))]
    const vendors = vendorIds.length > 0
      ? await db.query.erpSuppliers.findMany({
          where: and(eq(erpSuppliers.orgId, ctx.orgId), inArray(erpSuppliers.id, vendorIds)),
          columns: { id: true, supplierName: true },
        })
      : []
    const vendorNameById = new Map(vendors.map((v) => [v.id, v.supplierName]))

    return aggregateMaterialCostReport(
      grouped.map((g) => ({ materialId: g.materialId, vendorId: g.vendorId, quantity: Number(g.quantity), cost: Number(g.cost) })),
      materialById,
      vendorNameById,
      params
    )
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
