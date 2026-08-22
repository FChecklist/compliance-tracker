// Wave 115 (PROJEXA foundation) service layer -- Scope of Work / Bill of
// Quantities. Revisions form a chain via parentBoqId; comparing two
// revisions is computed here at read time (diff by itemCode, falling back
// to description) rather than stored, matching this codebase's preference
// for live aggregation over denormalized diff tables.
//
// Wave 127 (task-20260727-190032, scope-of-works revision/variation
// tracking -- real Owner directive): the original "warn if scope already
// executed" check only ever produced a soft warning string in compareBoq()'s
// response -- createBoqRevision() itself never looked at it, so a negative
// variation on already-completed work was applied silently unless a caller
// happened to also call GET .../compare afterwards. findScopeReductionViolations()
// below is now enforced as a hard block inside createBoqRevision() (a real
// 409 ServiceError), with an explicit allowScopeReductionOverride escape
// hatch for the case where the Owner/PM genuinely wants to descope executed
// work. compareBoq() reuses the same pure helper so its warnings and the
// creation-time block can never drift out of sync with each other.
import {
  constructionBoqs, constructionBoqLineItems, constructionWorkProgressEntries, projects,
} from "@/lib/db"
import { withTenantContext, type TenantDb } from "@/lib/db/tenant-scoped"
import { and, eq, inArray, or, type SQL } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
import { isSelfApproval } from "./approval-workflow-service"
export { ServiceError }

export type BoqContext = { orgId: string; userId: string }

export type BoqLineItemInput = {
  activityId?: string
  itemCode?: string
  // Hierarchical BoQ breakdown (Owner directive, PROJEXA_ERP_END_TO_END_
  // REQUIREMENT_ANALYSIS_GAP_FILL_AND_IMPLEMENTATION, 2026-07-27): when set,
  // must reference another item's itemCode within this SAME submission
  // (createBoq/createBoqRevision insert all lineItems together, so parents
  // are always resolvable within one call -- no cross-BoQ parent refs).
  // breakdownPercentage is required whenever parentItemCode is set.
  parentItemCode?: string
  breakdownPercentage?: number
  description: string
  unit: string
  quantity: number
  rate: number
  // Wave 125 (rate analysis / cost buildup): all optional. When supplied,
  // `rate` above is still the authoritative stored/quoted rate -- these
  // are the cost components that justified it, surfaced separately via
  // computedRate() rather than silently overwriting a caller-supplied rate.
  materialCost?: number
  labourCost?: number
  equipmentCost?: number
  overheadPercent?: number
  profitPercent?: number
}

export type BoqInput = {
  projectId: string
  title: string
  lineItems: BoqLineItemInput[]
}

/**
 * Sub-Task Amount = Main QTY * Main RATE * Breakdown % -- the Owner's exact
 * formula. "Main" is the ROOT ancestor of the parentItemCode chain (found by
 * walking parentItemCode links until one has none), not necessarily the
 * immediate parent -- so a 3-level BoQ (Main -> Sub -> Sub-sub) still prices
 * every descendant off the same top-level quantity/rate. Pure, no DB access
 * -- independently unit-testable, matching this repo's convention (see
 * firm-billing-service.ts's resolveBillableRate).
 */
export function computeHierarchicalAmount(item: BoqLineItemInput, byItemCode: Map<string, BoqLineItemInput>): number {
  if (!item.parentItemCode) return item.quantity * item.rate

  const seen = new Set<string>()
  let current = item
  while (current.parentItemCode) {
    if (current.itemCode) {
      if (seen.has(current.itemCode)) throw new ServiceError(`Circular parentItemCode reference detected at "${current.itemCode}"`, 400)
      seen.add(current.itemCode)
    }
    const parent = byItemCode.get(current.parentItemCode)
    if (!parent) throw new ServiceError(`parentItemCode "${current.parentItemCode}" does not match any itemCode in this submission`, 400)
    current = parent
  }

  if (item.breakdownPercentage == null) throw new ServiceError(`breakdownPercentage is required for line item "${item.description}" (has a parentItemCode)`, 400)
  return current.quantity * current.rate * (item.breakdownPercentage / 100)
}

function withAmount(item: BoqLineItemInput, byItemCode: Map<string, BoqLineItemInput>) {
  return { ...item, amount: computeHierarchicalAmount(item, byItemCode) }
}

/** material+labour+equipment costs, then +overhead%, then +profit% -- the standard construction rate-buildup order. Returns null when no cost-component fields are set (a plain BOQ line item with just a quoted rate). */
function computedRate(item: { materialCost: string | null; labourCost: string | null; equipmentCost: string | null; overheadPercent: string | null; profitPercent: string | null }): number | null {
  if (item.materialCost === null && item.labourCost === null && item.equipmentCost === null) return null
  const base = Number(item.materialCost ?? 0) + Number(item.labourCost ?? 0) + Number(item.equipmentCost ?? 0)
  const withOverhead = base * (1 + Number(item.overheadPercent ?? 0) / 100)
  const withProfit = withOverhead * (1 + Number(item.profitPercent ?? 0) / 100)
  return withProfit
}

/**
 * Inserts items in parent-before-child order so parentLineItemId can be set
 * to a real DB id (not just the input's own itemCode) -- items are grouped
 * into "resolvable now" batches: first everything with no parentItemCode,
 * then everything whose parent was resolved in a prior batch, and so on.
 * Detects both an unresolvable parentItemCode and a circular chain the same
 * way computeHierarchicalAmount does, so the error surfaces before any rows
 * are written rather than partway through.
 */
async function insertLineItems(db: TenantDb, orgId: string, boqId: string, items: BoqLineItemInput[]) {
  if (items.length === 0) return
  const byItemCode = new Map(items.filter((i) => i.itemCode).map((i) => [i.itemCode!, i]))

  const idByItemCode = new Map<string, string>()
  let remaining = items
  while (remaining.length > 0) {
    const [ready, notReady] = [
      remaining.filter((i) => !i.parentItemCode || idByItemCode.has(i.parentItemCode)),
      remaining.filter((i) => i.parentItemCode && !idByItemCode.has(i.parentItemCode)),
    ]
    if (ready.length === 0) {
      throw new ServiceError(`Unresolvable parentItemCode reference(s) among: ${notReady.map((i) => i.itemCode || i.description).join(", ")}`, 400)
    }

    const inserted = await db.insert(constructionBoqLineItems).values(
      ready.map((item) => ({
        orgId,
        boqId,
        activityId: item.activityId || null,
        itemCode: item.itemCode || null,
        parentLineItemId: item.parentItemCode ? idByItemCode.get(item.parentItemCode)! : null,
        breakdownPercentage: item.breakdownPercentage !== undefined ? String(item.breakdownPercentage) : null,
        description: item.description,
        unit: item.unit,
        quantity: String(item.quantity),
        rate: String(item.rate),
        amount: String(withAmount(item, byItemCode).amount),
        materialCost: item.materialCost !== undefined ? String(item.materialCost) : null,
        labourCost: item.labourCost !== undefined ? String(item.labourCost) : null,
        equipmentCost: item.equipmentCost !== undefined ? String(item.equipmentCost) : null,
        overheadPercent: item.overheadPercent !== undefined ? String(item.overheadPercent) : null,
        profitPercent: item.profitPercent !== undefined ? String(item.profitPercent) : null,
      }))
    ).returning({ id: constructionBoqLineItems.id, itemCode: constructionBoqLineItems.itemCode })

    for (const row of inserted) if (row.itemCode) idByItemCode.set(row.itemCode, row.id)
    remaining = notReady
  }
}

function withComputedRate(item: typeof constructionBoqLineItems.$inferSelect) {
  return { ...item, computedRate: computedRate(item) }
}

export async function listBoqs(ctx: { orgId: string }, projectId: string) {
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.constructionBoqs.findMany({
      where: and(eq(constructionBoqs.orgId, ctx.orgId), eq(constructionBoqs.projectId, projectId)),
      orderBy: (t, { desc }) => desc(t.version),
    })
  )
}

export async function getBoq(ctx: { orgId: string }, boqId: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const boq = await db.query.constructionBoqs.findFirst({ where: and(eq(constructionBoqs.id, boqId), eq(constructionBoqs.orgId, ctx.orgId)) })
    if (!boq) throw new ServiceError("BOQ not found", 404)
    const lineItems = await db.query.constructionBoqLineItems.findMany({ where: eq(constructionBoqLineItems.boqId, boqId) })
    return { ...boq, lineItems: lineItems.map(withComputedRate) }
  })
}

export async function createBoq(ctx: BoqContext, input: BoqInput) {
  const title = input.title?.trim()
  if (!title) throw new ServiceError("title is required", 400)
  if (!input.projectId) throw new ServiceError("projectId is required", 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const project = await db.query.projects.findFirst({ where: and(eq(projects.id, input.projectId), eq(projects.orgId, ctx.orgId)) })
    if (!project) throw new ServiceError("Project not found", 404)

    const [boq] = await db.insert(constructionBoqs).values({
      orgId: ctx.orgId, projectId: input.projectId, version: 1, title, createdById: ctx.userId,
    }).returning()

    await insertLineItems(db, ctx.orgId, boq.id, input.lineItems || [])
    return getBoqRow(db, boq.id)
  })
}

async function getBoqRow(db: TenantDb, boqId: string) {
  const boq = await db.query.constructionBoqs.findFirst({ where: eq(constructionBoqs.id, boqId) })
  const lineItems = await db.query.constructionBoqLineItems.findMany({ where: eq(constructionBoqLineItems.boqId, boqId) })
  return { ...boq, lineItems: lineItems.map(withComputedRate) }
}

export async function createBoqRevision(
  ctx: BoqContext,
  parentBoqId: string,
  input: { title?: string; lineItems: BoqLineItemInput[]; allowScopeReductionOverride?: boolean }
) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const parent = await db.query.constructionBoqs.findFirst({ where: and(eq(constructionBoqs.id, parentBoqId), eq(constructionBoqs.orgId, ctx.orgId)) })
    if (!parent) throw new ServiceError("Parent BOQ not found", 404)

    const previousItems = await db.query.constructionBoqLineItems.findMany({ where: eq(constructionBoqLineItems.boqId, parent.id) })

    const [boq] = await db.insert(constructionBoqs).values({
      orgId: ctx.orgId, projectId: parent.projectId, version: parent.version + 1,
      parentBoqId: parent.id, title: input.title?.trim() || parent.title, createdById: ctx.userId,
    }).returning()

    await insertLineItems(db, ctx.orgId, boq.id, input.lineItems || [])

    // Owner directive: a negative variation (removing/reducing a line item)
    // must be blocked -- not just warned about -- when that item's linked
    // activity has recorded completed progress. Runs inside this same
    // transaction, so a block here rolls back the whole revision (including
    // the row just inserted above), not just the violating line items.
    const currentItems = await db.query.constructionBoqLineItems.findMany({ where: eq(constructionBoqLineItems.boqId, boq.id) })
    const { removed, changed } = diffLineItems(previousItems, currentItems)
    const progressByLineItem = await loadLatestProgressByLineItem(db, ctx.orgId, [...removed, ...changed.map((c) => c.current)])
    const violations = findScopeReductionViolations({ removed, changed }, progressByLineItem)
    if (violations.length > 0 && !input.allowScopeReductionOverride) {
      throw new ServiceError(
        `Scope reduction blocked -- this revision would remove or reduce work already completed on site: ${violations.join("; ")}. ` +
          `Pass allowScopeReductionOverride: true to proceed anyway.`,
        409
      )
    }

    await db.update(constructionBoqs).set({ status: "superseded", updatedAt: new Date() }).where(eq(constructionBoqs.id, parent.id))

    return getBoqRow(db, boq.id)
  })
}

export type BoqLineItemRow = typeof constructionBoqLineItems.$inferSelect

export type ChangedLineItem = {
  key: string
  previous: BoqLineItemRow
  current: BoqLineItemRow
  quantityChange: number
  rateChange: number
  breakdownPercentageChange: number
  netVariation: number
  isSubItem: boolean
}

export type BoqComparison = {
  added: BoqLineItemRow[]
  removed: BoqLineItemRow[]
  changed: ChangedLineItem[]
  warnings: string[]
  totalVariation: number
}

function lineItemKey(item: BoqLineItemRow) {
  return item.itemCode || item.description
}

/**
 * Sum of every real amount change between two revisions: added items' full
 * amount, minus removed items' full amount, plus/minus each changed item's
 * netVariation. Matches this codebase's "compute at read time, don't store
 * a denormalized total" convention (see the file-header comment) -- this is
 * the running total variation value the Owner asked for, derived rather
 * than persisted.
 */
export function computeTotalVariation(diff: { added: BoqLineItemRow[]; removed: BoqLineItemRow[]; changed: ChangedLineItem[] }): number {
  const addedTotal = diff.added.reduce((sum, i) => sum + Number(i.amount), 0)
  const removedTotal = diff.removed.reduce((sum, i) => sum + Number(i.amount), 0)
  const changedTotal = diff.changed.reduce((sum, c) => sum + c.netVariation, 0)
  return addedTotal - removedTotal + changedTotal
}

/**
 * Pure helper (no DB access, independently unit-testable) behind both the
 * soft warnings compareBoq() returns and the hard block createBoqRevision()
 * enforces -- kept as one function so the two can never disagree about what
 * counts as a violation. A violation is: a removed line item, or a changed
 * line item with a negative netVariation, that the resolver found ANY
 * recorded completed progress for (percentComplete > 0). R12 point 7
 * (Option B): progressByLineItem is keyed by the line item's OWN id, not
 * activityId -- produced by resolveProgressByLineItem()/
 * loadLatestProgressByLineItem() below, which already resolved
 * boq_line_item_id vs. activity_id per item. This function no longer knows
 * or cares which link resolved it; it just holds each item's MOST RECENT
 * percentComplete.
 */
export function findScopeReductionViolations(
  diff: { removed: BoqLineItemRow[]; changed: ChangedLineItem[] },
  progressByLineItem: Map<string, number>
): string[] {
  const violations: string[] = []

  for (const item of diff.removed) {
    const pct = progressByLineItem.get(item.id)
    if (pct && pct > 0) {
      violations.push(`"${item.description}" is ${pct}% complete on site and would be removed entirely`)
    }
  }

  for (const change of diff.changed) {
    if (change.netVariation >= 0) continue
    const pct = progressByLineItem.get(change.current.id)
    if (pct && pct > 0) {
      violations.push(`"${change.current.description}" is ${pct}% complete on site -- this revision reduces its scope by ${Math.abs(change.netVariation)}`)
    }
  }

  return violations
}

/**
 * Pure merge step of the R12 point 7 (Option B) resolver -- factored out
 * from loadLatestProgressByLineItem() below purely so it's independently
 * unit-testable without a live DB (same "don't touch withTenantContext/a
 * live DB from a .test.ts file" convention as computeHierarchicalAmount/
 * diffLineItems in this same file). `byLineItemId`/`byActivityId` are
 * already-fetched "most recent percentComplete per key" maps; this
 * function only decides, per item, which key wins. boq_line_item_id
 * (direct link) ALWAYS wins over activity_id (fallback) when both would
 * resolve to a value for the same item -- "IF boq_line_item_id is set THEN
 * it wins" is the point's own explicit rule, not just "prefer whichever
 * came first."
 */
export function resolveProgressByLineItem(
  items: BoqLineItemRow[],
  byLineItemId: Map<string, number>,
  byActivityId: Map<string, number>
): Map<string, number> {
  const progressByLineItem = new Map<string, number>()
  for (const item of items) {
    if (byLineItemId.has(item.id)) { progressByLineItem.set(item.id, byLineItemId.get(item.id)!); continue }
    if (item.activityId && byActivityId.has(item.activityId)) progressByLineItem.set(item.id, byActivityId.get(item.activityId)!)
  }
  return progressByLineItem
}

/**
 * R12 point 7 (Option B): most-recent percentComplete per BOQ line item, for
 * every item in `items` -- keyed by lineItem.id, not activityId, because
 * progress belongs to a BOQ line, not to an activity (activity is a
 * project-management concept; this table is shared by every VERIDIAN
 * product). Resolves boq_line_item_id FIRST (the direct link); falls back
 * to activity_id ONLY when no boq_line_item_id-linked entry exists for that
 * item, so every pre-R12 (legacy, activity-only) progress entry keeps being
 * found unchanged. ONE resolver -- both the 409 scope-reduction guard below
 * and compareBoq()'s warnings call this same function (arch rule AR-01), so
 * a third link type later is a one-place change here, not a sweep of every
 * caller. The DB-touching half of the scope-reduction guard, kept separate
 * from the pure merge/violation logic above.
 */
export async function loadLatestProgressByLineItem(db: TenantDb, orgId: string, items: BoqLineItemRow[]): Promise<Map<string, number>> {
  const lineItemIds = items.map((i) => i.id)
  const activityIds = [...new Set(items.map((i) => i.activityId).filter((id): id is string => !!id))]

  const conditions: SQL[] = []
  if (lineItemIds.length > 0) conditions.push(inArray(constructionWorkProgressEntries.boqLineItemId, lineItemIds))
  if (activityIds.length > 0) conditions.push(inArray(constructionWorkProgressEntries.activityId, activityIds))
  if (conditions.length === 0) return new Map()

  const rows = await db.query.constructionWorkProgressEntries.findMany({
    where: and(eq(constructionWorkProgressEntries.orgId, orgId), or(...conditions)),
    orderBy: (t, { desc }) => desc(t.entryDate),
  })

  // Most-recent entry per direct link (boq_line_item_id) and per fallback
  // link (activity_id) -- kept as two separate maps because a single row
  // can satisfy either lookup and "most recent" is per-key, not per-row.
  const byLineItemId = new Map<string, number>()
  const byActivityId = new Map<string, number>()
  for (const row of rows) {
    if (row.boqLineItemId && !byLineItemId.has(row.boqLineItemId)) byLineItemId.set(row.boqLineItemId, Number(row.percentComplete))
    if (row.activityId && !byActivityId.has(row.activityId)) byActivityId.set(row.activityId, Number(row.percentComplete))
  }

  return resolveProgressByLineItem(items, byLineItemId, byActivityId)
}

/**
 * Pure diff between two revisions' line items, no DB access -- independently
 * unit-testable (matching this repo's convention, e.g. esignature-service.ts's
 * extracted transition helpers). Hierarchy-aware: `changed` also flags a
 * breakdownPercentage-only edit (qty/rate unchanged but a sub-task's slice of
 * the main item moved), and `isSubItem` lets a caller distinguish a main-item
 * change from a sub-task change without a second lookup.
 */
export function diffLineItems(previousItems: BoqLineItemRow[], currentItems: BoqLineItemRow[]): { added: BoqLineItemRow[]; removed: BoqLineItemRow[]; changed: ChangedLineItem[] } {
  const previousByKey = new Map(previousItems.map((i) => [lineItemKey(i), i]))
  const currentByKey = new Map(currentItems.map((i) => [lineItemKey(i), i]))

  const added = currentItems.filter((i) => !previousByKey.has(lineItemKey(i)))
  const removed = previousItems.filter((i) => !currentByKey.has(lineItemKey(i)))
  const changed: ChangedLineItem[] = []

  for (const [key, curr] of currentByKey) {
    const prev = previousByKey.get(key)
    if (!prev) continue
    const quantityChange = Number(curr.quantity) - Number(prev.quantity)
    const rateChange = Number(curr.rate) - Number(prev.rate)
    const breakdownPercentageChange = Number(curr.breakdownPercentage ?? 0) - Number(prev.breakdownPercentage ?? 0)
    if (quantityChange !== 0 || rateChange !== 0 || breakdownPercentageChange !== 0) {
      const netVariation = Number(curr.amount) - Number(prev.amount)
      changed.push({ key, previous: prev, current: curr, quantityChange, rateChange, breakdownPercentageChange, netVariation, isSubItem: curr.parentLineItemId !== null })
    }
  }

  return { added, removed, changed }
}

/**
 * Compares `boqId` against another revision -- `options.against`, when given
 * any BOQ id in the same project (Rev0 vs Rev3, not just adjacent
 * revisions -- the "compare various versions" requirement), or `boqId`'s own
 * immediate parent otherwise (the original adjacent-revision behavior,
 * unchanged for every existing caller). Diff key is itemCode when present,
 * else description. `warnings` reuses the same findScopeReductionViolations
 * helper createBoqRevision() enforces as a hard block, so a comparison's
 * warnings and what actually gets blocked at creation time never drift apart.
 */
export async function compareBoq(ctx: { orgId: string }, boqId: string, options: { against?: string } = {}): Promise<BoqComparison> {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const current = await db.query.constructionBoqs.findFirst({ where: and(eq(constructionBoqs.id, boqId), eq(constructionBoqs.orgId, ctx.orgId)) })
    if (!current) throw new ServiceError("BOQ not found", 404)

    const againstBoqId = options.against ?? current.parentBoqId
    if (!againstBoqId) throw new ServiceError("This BOQ has no previous revision to compare against", 400)

    const against = await db.query.constructionBoqs.findFirst({ where: and(eq(constructionBoqs.id, againstBoqId), eq(constructionBoqs.orgId, ctx.orgId)) })
    if (!against) throw new ServiceError("BOQ to compare against was not found", 404)
    if (against.projectId !== current.projectId) throw new ServiceError("Cannot compare BOQ revisions from different projects", 400)

    const currentItems = await db.query.constructionBoqLineItems.findMany({ where: eq(constructionBoqLineItems.boqId, current.id) })
    const previousItems = await db.query.constructionBoqLineItems.findMany({ where: eq(constructionBoqLineItems.boqId, against.id) })

    const { added, removed, changed } = diffLineItems(previousItems, currentItems)
    const progressByLineItem = await loadLatestProgressByLineItem(db, ctx.orgId, [...removed, ...changed.map((c) => c.current)])
    const warnings = findScopeReductionViolations({ removed, changed }, progressByLineItem)
    const totalVariation = computeTotalVariation({ added, removed, changed })

    return { added, removed, changed, warnings, totalVariation }
  })
}

export async function submitBoq(ctx: { orgId: string }, boqId: string) {
  const row = await withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const boq = await db.query.constructionBoqs.findFirst({ where: and(eq(constructionBoqs.id, boqId), eq(constructionBoqs.orgId, ctx.orgId)) })
    if (!boq) throw new ServiceError("BOQ not found", 404)
    if (boq.status !== "draft") throw new ServiceError("Only a draft BOQ can be submitted", 400)
    const [updated] = await db.update(constructionBoqs).set({ status: "submitted", updatedAt: new Date() }).where(eq(constructionBoqs.id, boqId)).returning()
    return updated
  })

  // Wave 126: fire-and-forget automation trigger -- a revision touching
  // already-executed scope should be discoverable by an automation rule,
  // not just the soft warning compareBoq() already returns in its response.
  if (row.parentBoqId) {
    void compareBoq({ orgId: ctx.orgId }, row.id).then((comparison) => {
      if (comparison.warnings.length > 0) {
        void import("./automation-rule-service").then(({ evaluateAndRunRules }) =>
          evaluateAndRunRules({ orgId: ctx.orgId }, "construction_boq.variation_on_completed_scope", {
            boqId: row.id, projectId: row.projectId, warningCount: comparison.warnings.length,
          })
        )
      }
    })
  }
  return row
}

export async function approveBoq(ctx: { orgId: string; userId: string }, boqId: string) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const boq = await db.query.constructionBoqs.findFirst({ where: and(eq(constructionBoqs.id, boqId), eq(constructionBoqs.orgId, ctx.orgId)) })
    if (!boq) throw new ServiceError("BOQ not found", 404)
    if (boq.status !== "submitted") throw new ServiceError("Only a submitted BOQ can be approved", 400)
    if (isSelfApproval(boq.createdById, ctx.userId)) {
      throw new ServiceError("You cannot approve a BOQ you created yourself -- an independent approver is required", 403)
    }
    const [row] = await db.update(constructionBoqs)
      .set({ status: "approved", approvedById: ctx.userId, approvedAt: new Date(), updatedAt: new Date() })
      .where(eq(constructionBoqs.id, boqId)).returning()
    return row
  })
}
