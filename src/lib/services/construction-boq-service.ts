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
  // R67 D-24 (drizzle/0528): free-text trade/work category (Joinery, Gypsum,
  // Paint, Civil, Misc, ...). Optional -- a BOQ line without one is legal and
  // reads as "Uncategorized" downstream. Trimmed at the write path below so a
  // spreadsheet's " Joinery " and a form's "Joinery" are the same category.
  category?: string
  // R45 seq 7 / E-127 (canonical child-rate rule -- see
  // deriveLineItemQuantityAndRate's doc comment): authoritative ONLY when
  // parentItemCode is unset. When parentItemCode IS set, whatever is passed
  // here is ignored and overwritten at write time with the root-derived
  // value (QTY_child = QTY_root, RATE_child = RATE_root x breakdown%/100) --
  // caller may submit 0, a stale value, or leave the UI field blank for a
  // child row without affecting the stored result.
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
 * Walks a parentItemCode chain up to its ROOT ancestor (the item with no
 * parentItemCode of its own) -- shared by deriveLineItemQuantityAndRate and
 * (through it) computeHierarchicalAmount below, so the two can never
 * disagree about which row "root" means. Not necessarily the immediate
 * parent -- a 3-level BoQ (Main -> Sub -> Sub-sub) still resolves off the
 * same top-level row.
 */
function resolveRootAncestor(item: BoqLineItemInput, byItemCode: Map<string, BoqLineItemInput>): BoqLineItemInput {
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
  return current
}

/**
 * *** CANONICAL CHILD-RATE RULE -- settled R45 seq 7 / E-127. Do not
 * reintroduce a second convention here. ***
 *
 * A child (sub-task) BoQ line item's OWN quantity/rate are NOT independently
 * entered data -- they are DERIVED from the ROOT ancestor of the
 * parentItemCode chain. This is the real, confirmed customer spec
 * (platform.sumeet_spec row BOQ-10, "Sample Scope with Sub Task.xlsx",
 * CONFIRMED). NOTE: an earlier version of this comment claimed this was
 * verified against "477/477 real child rows -- 100% match, 0 exceptions" --
 * that was FALSE (an adversarial verify pass 2026-08-24 caught it; see
 * construction-reports-service.ts's earnedValueReport() header comment for
 * the real, re-verified numbers and the resulting backfill). The formula
 * below is the correct rule regardless of that false historical-verification
 * claim -- it is the real customer spec and is enforced at write time here:
 *   F1  AMOUNT_root  = QTY_root  x RATE_root                  (independently entered)
 *   F2  RATE_child   = RATE_root x (breakdownPercentage / 100)
 *   F3  QTY_child    = QTY_root                                (identical, always)
 *   F4  AMOUNT_child = QTY_child x RATE_child = AMOUNT_root x (breakdownPercentage/100)
 * A root-level item (no parentItemCode) keeps its own quantity/rate exactly
 * as entered (F1) -- this function is a no-op for it.
 *
 * Before this fix, insertLineItems() stored whatever quantity/rate a caller
 * submitted for a child row VERBATIM and un-enforced -- `amount` was still
 * always computed correctly via root roll-up (computeHierarchicalAmount
 * below), but the child's own stored rate/quantity COLUMNS could silently
 * drift from F2/F3 whenever a caller (a manual API call, or a revision
 * edited through scope/[id]/page.tsx, neither of which required the child's
 * quantity/rate fields to be filled in consistently) supplied something
 * else -- including 0, or nothing at all.
 *
 * That drift is exactly what let a SECOND, contradictory convention grow
 * elsewhere: work-progress-report-pdf.ts's computeRows() reads a line's own
 * `rate` column directly (qty x rate, no reference to breakdownPercentage or
 * the parent) to price progress recorded against that specific line via
 * boq_line_item_id -- correct IF F2 holds, silently wrong (undercounting,
 * often to $0) whenever it doesn't. Deriving -- and overwriting whatever was
 * submitted -- here, at the one real write path (insertLineItems), makes F2/
 * F3 a real invariant instead of an accident of import data, so every
 * current and future reader of this column (not just the one that happened
 * to get audited for R45 seq 7) sees a value that's actually correct.
 */
export function deriveLineItemQuantityAndRate(item: BoqLineItemInput, byItemCode: Map<string, BoqLineItemInput>): { quantity: number; rate: number } {
  if (!item.parentItemCode) return { quantity: item.quantity, rate: item.rate }
  const root = resolveRootAncestor(item, byItemCode)
  if (item.breakdownPercentage == null) throw new ServiceError(`breakdownPercentage is required for line item "${item.description}" (has a parentItemCode)`, 400)
  return { quantity: root.quantity, rate: root.rate * (item.breakdownPercentage / 100) }
}

/**
 * Sub-Task Amount = Main QTY * Main RATE * Breakdown % -- the Owner's exact
 * formula (F4 above). A thin wrapper over deriveLineItemQuantityAndRate so
 * `amount` and the child's own stored quantity/rate columns can never be
 * computed from two different resolutions of "root". Pure, no DB access --
 * independently unit-testable, matching this repo's convention (see
 * firm-billing-service.ts's resolveBillableRate).
 */
export function computeHierarchicalAmount(item: BoqLineItemInput, byItemCode: Map<string, BoqLineItemInput>): number {
  const { quantity, rate } = deriveLineItemQuantityAndRate(item, byItemCode)
  return quantity * rate
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
/**
 * R53 / R46M13_TC10_01 -- THE FALSE-POSITIVE SUCCESS GUARD.
 *
 * THE DEFECT: creating a weighted-sub-task BOQ (a parent plus breakdown-
 * percentage children) through the real "New BOQ" dialog showed a green
 * "BOQ created" toast and a cleanly closing dialog -- exactly like a real
 * success -- while the children were not stored. The projexa half of that
 * (a caller that did not check res.ok) is fixed in that repo. THIS is the
 * backend half, and the backend half is the one that matters: the service
 * could return 201 with children silently dropped, so a caller that DID
 * check the status still had nothing to check.
 *
 * BoqLineItemInput is a TypeScript type. Types are erased at runtime, so
 * before this function the request body was never validated at all. Three
 * consequences, all of which produced a 201:
 *
 *   1. A client that spells a key snake_case ("parent_item_code" instead of
 *      "parentItemCode") reads as undefined. Every row then falls into the
 *      first batch as a ROOT: parent_line_item_id null, breakdown_percentage
 *      null, and because deriveLineItemQuantityAndRate returns early when
 *      parentItemCode is unset, child rows store their submitted 0/0 and an
 *      amount of "0". The hierarchy is gone and the response says 201.
 *   2. Duplicate itemCodes silently re-parent -- both the byItemCode map and
 *      idByItemCode keep the LAST writer, so children attach to the wrong
 *      parent with no error.
 *   3. A row missing description/unit hits a raw Postgres 23502 that the
 *      route turns into a generic 500 naming no field.
 *
 * EVERY CHECK HERE NAMES THE FIELD AND THE ROW. "A BOQ without a title is
 * rejected with a message naming the title field" is requirement R-04's
 * standard; there is no reason line items get a lower one.
 */
const SNAKE_CASE_TRAPS: ReadonlyArray<[string, string]> = [
  ["item_code", "itemCode"],
  ["parent_item_code", "parentItemCode"],
  ["breakdown_percentage", "breakdownPercentage"],
  ["activity_id", "activityId"],
  ["material_cost", "materialCost"],
  ["labour_cost", "labourCost"],
  ["equipment_cost", "equipmentCost"],
  ["overhead_percent", "overheadPercent"],
  ["profit_percent", "profitPercent"],
];

/**
 * R53 / R46M13_TC10_01, second pass. The line-item guard below protects the
 * FIELDS of a line item; this protects the KEY that carries them.
 *
 * R-03 rules that "a BOQ may be created with a title and no line items", so
 * an absent or empty lineItems is LEGAL and must stay legal. What is not
 * legal is a caller that sent items under a name this service does not read:
 * that body produces a header-only BOQ and a 201, which is the same
 * false-positive success one level up. Rejecting only the recognised
 * misspellings keeps R-03 intact while closing the hole.
 */
const LINE_ITEMS_KEY_TRAPS = ["line_items", "lineitems", "items", "lines", "boqLineItems", "boq_line_items"] as const;

export function validateBoqBodyShape(input: unknown): void {
  if (!input || typeof input !== "object") return;
  const raw = input as Record<string, unknown>;
  if (raw.lineItems !== undefined) return; // the caller used the right key
  for (const trap of LINE_ITEMS_KEY_TRAPS) {
    if (raw[trap] !== undefined) {
      throw new ServiceError(`"${trap}" is not a recognised field -- use "lineItems"`, 400);
    }
  }
}

export function validateLineItemInputs(items: BoqLineItemInput[]): void {
  const seenItemCodes = new Set<string>();

  items.forEach((item, index) => {
    const where = `line item ${index + 1}${item.itemCode ? ` (${item.itemCode})` : ""}`;
    const raw = item as unknown as Record<string, unknown>;

    // A misspelled key is REJECTED, never ignored. Ignoring it is what
    // silently flattened the hierarchy while reporting success.
    for (const [wrong, right] of SNAKE_CASE_TRAPS) {
      if (raw[wrong] !== undefined) {
        throw new ServiceError(`${where}: "${wrong}" is not a recognised field -- use "${right}"`, 400);
      }
    }

    if (typeof item.description !== "string" || item.description.trim() === "") {
      throw new ServiceError(`${where}: description is required`, 400);
    }
    if (typeof item.unit !== "string" || item.unit.trim() === "") {
      throw new ServiceError(`${where}: unit is required`, 400);
    }

    if (item.itemCode) {
      if (seenItemCodes.has(item.itemCode)) {
        // Silently keeping the last one is how children end up under the
        // wrong parent with a 201 and no complaint.
        throw new ServiceError(`${where}: duplicate itemCode "${item.itemCode}" -- item codes must be unique within one BOQ`, 400);
      }
      seenItemCodes.add(item.itemCode);
    }

    // A child's quantity/rate are derived from its root, so they are only
    // checked on roots -- checking them on children would reject exactly the
    // blank fields R-13 says a child is allowed to leave blank.
    if (!item.parentItemCode) {
      for (const key of ["quantity", "rate"] as const) {
        const v = item[key];
        if (v !== undefined && (typeof v !== "number" || !Number.isFinite(v) || v < 0)) {
          throw new ServiceError(`${where}: ${key} must be a non-negative number, got ${JSON.stringify(v)}`, 400);
        }
      }
    }

    if (item.parentItemCode && item.breakdownPercentage === undefined) {
      throw new ServiceError(`${where}: breakdownPercentage is required when parentItemCode is set`, 400);
    }
  });
}

/**
 * R53 / R46M13_TC10_01 -- the assertion that makes "BOQ created" mean it.
 *
 * Runs INSIDE the same transaction as the inserts, so a mismatch rolls the
 * whole BOQ back rather than leaving a half-written one behind. A caller
 * can now trust a 201 absolutely: either every line item the caller sent is
 * stored, or there is no BOQ and an error says how many went missing.
 */
async function assertLineItemsPersisted(db: TenantDb, boqId: string, expected: number): Promise<void> {
  const stored = await db.query.constructionBoqLineItems.findMany({
    where: eq(constructionBoqLineItems.boqId, boqId),
    columns: { id: true },
  });
  if (stored.length !== expected) {
    throw new ServiceError(
      `BOQ was not created: ${expected} line item(s) submitted but ${stored.length} stored. Nothing was saved.`,
      500
    );
  }
}

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
      ready.map((item) => {
        // F2/F3 (see deriveLineItemQuantityAndRate's own doc comment): a
        // child's quantity/rate are DERIVED from its root ancestor, not
        // whatever this item's own input happened to carry -- amount then
        // falls straight out of those two (F4), no separate root-walk.
        const { quantity, rate } = deriveLineItemQuantityAndRate(item, byItemCode)
        return {
          orgId,
          boqId,
          activityId: item.activityId || null,
          itemCode: item.itemCode || null,
          parentLineItemId: item.parentItemCode ? idByItemCode.get(item.parentItemCode)! : null,
          breakdownPercentage: item.breakdownPercentage !== undefined ? String(item.breakdownPercentage) : null,
          description: item.description,
          unit: item.unit,
          category: normalizeCategory(item.category),
          quantity: String(quantity),
          rate: String(rate),
          amount: String(quantity * rate),
          materialCost: item.materialCost !== undefined ? String(item.materialCost) : null,
          labourCost: item.labourCost !== undefined ? String(item.labourCost) : null,
          equipmentCost: item.equipmentCost !== undefined ? String(item.equipmentCost) : null,
          overheadPercent: item.overheadPercent !== undefined ? String(item.overheadPercent) : null,
          profitPercent: item.profitPercent !== undefined ? String(item.profitPercent) : null,
        }
      })
    ).returning({ id: constructionBoqLineItems.id, itemCode: constructionBoqLineItems.itemCode })

    for (const row of inserted) if (row.itemCode) idByItemCode.set(row.itemCode, row.id)
    remaining = notReady
  }
}

/**
 * R44 seq3: the inverse of insertLineItems' row shape -- turns an already-
 * persisted line item back into the BoqLineItemInput shape createBoqRevision
 * accepts, so "copy the parent BOQ's line items forward" can reuse the exact
 * same insert path a caller-supplied revision uses (no separate "clone" SQL
 * path to keep in sync). `itemCodeById` resolves parentLineItemId (a row id)
 * back to the parent's itemCode, since insertLineItems' hierarchy resolution
 * works off itemCode, not row id.
 */
export function toLineItemInput(item: BoqLineItemRow, itemCodeById: Map<string, string>): BoqLineItemInput {
  return {
    activityId: item.activityId ?? undefined,
    itemCode: item.itemCode ?? undefined,
    // R67 D-24: carried forward, or a revision would silently un-categorise
    // every line it copies -- the same class of silent loss R44 seq3 fixed for
    // the line items themselves.
    category: item.category ?? undefined,
    parentItemCode: item.parentLineItemId ? itemCodeById.get(item.parentLineItemId) : undefined,
    breakdownPercentage: item.breakdownPercentage !== null ? Number(item.breakdownPercentage) : undefined,
    description: item.description,
    unit: item.unit,
    quantity: Number(item.quantity),
    rate: Number(item.rate),
    materialCost: item.materialCost !== null ? Number(item.materialCost) : undefined,
    labourCost: item.labourCost !== null ? Number(item.labourCost) : undefined,
    equipmentCost: item.equipmentCost !== null ? Number(item.equipmentCost) : undefined,
    overheadPercent: item.overheadPercent !== null ? Number(item.overheadPercent) : undefined,
    profitPercent: item.profitPercent !== null ? Number(item.profitPercent) : undefined,
  }
}

/** Point 154 (R12): Rajat ruled 22 Aug the 25% figure is a COST CEILING, not
 * a margin -- budget = amount * budgetPercentage / 100 (NOT the margin
 * reading, amount * (1 - budgetPercentage/100), which is excluded). Computed
 * at read time, same convention as computedRate() above -- not stored
 * redundantly against the amount/budgetPercentage columns. */
function computedBudget(item: { amount: string; budgetPercentage: string }): number {
  return Number(item.amount) * (Number(item.budgetPercentage) / 100)
}

function withComputedRate(item: typeof constructionBoqLineItems.$inferSelect) {
  return { ...item, computedRate: computedRate(item), computedBudget: computedBudget(item) }
}

/**
 * R67 D-24. One place that decides what a stored category string looks like:
 * trimmed, and an empty/blank value stored as NULL rather than "". Without
 * this, " Joinery " and "Joinery" become two categories in every report that
 * groups by this column, and a form that submits an untouched field writes an
 * empty string that reads as a category named nothing.
 */
export function normalizeCategory(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim()
  return trimmed === "" ? null : trimmed
}

/**
 * R67 D-24. The picklist the BOQ create/revise grids offer: a fixed seed of
 * the trades Sumeet's own sheets use, plus every category this org has already
 * written, case-insensitively de-duplicated with the ORG's own spelling
 * winning over the seed's (their "CIVIL" is their house style, not a typo of
 * ours). Pure and DB-free so the ordering/de-duplication rule is testable
 * without a live database, matching this file's own convention
 * (computeHierarchicalAmount, diffLineItems, findScopeReductionViolations).
 */
export const BOQ_CATEGORY_SEED = ["Joinery", "Gypsum", "Paint", "Civil", "Misc"] as const

export function mergeBoqCategories(existing: ReadonlyArray<string | null | undefined>): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const push = (raw: string | null | undefined) => {
    const value = normalizeCategory(raw)
    if (!value) return
    const key = value.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    out.push(value)
  }
  // The org's own spelling is added FIRST so it, not the seed's, is the one
  // that survives de-duplication.
  for (const value of [...existing].sort((a, b) => (a ?? "").localeCompare(b ?? ""))) push(value)
  for (const value of BOQ_CATEGORY_SEED) push(value)
  return out
}

/** Distinct categories already used on this project's BOQ lines, merged with the seed list. */
export async function listBoqCategories(ctx: { orgId: string }, projectId: string): Promise<string[]> {
  const existing = await withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const boqs = await db.query.constructionBoqs.findMany({
      where: and(eq(constructionBoqs.orgId, ctx.orgId), eq(constructionBoqs.projectId, projectId)),
      columns: { id: true },
    })
    if (boqs.length === 0) return [] as (string | null)[]
    const rows = await db.query.constructionBoqLineItems.findMany({
      where: inArray(constructionBoqLineItems.boqId, boqs.map((b) => b.id)),
      columns: { category: true },
    })
    return rows.map((r) => r.category)
  })
  return mergeBoqCategories(existing)
}

export async function listBoqs(ctx: { orgId: string }, projectId: string) {
  return withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.constructionBoqs.findMany({
      where: and(eq(constructionBoqs.orgId, ctx.orgId), eq(constructionBoqs.projectId, projectId)),
      // Point 177/E-116 fix: version DESC alone has no stable tiebreaker when a
      // project has two or more INDEPENDENT (non-revision-chain) BOQs at the
      // same version -- Postgres then returns them in an arbitrary physical
      // order, so callers like work-progress/report/route.ts's
      // `boqs.find(b => b.status !== "superseded")` silently picked whichever
      // one the engine happened to return first, not the actual most-recent
      // one. createdAt DESC as a secondary key makes the order deterministic
      // and matches the intuitive meaning of "latest" when versions tie.
      orderBy: (t, { desc }) => [desc(t.version), desc(t.createdAt)],
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

// R39/R-C09 (Point 154 follow-on): sets a line item's budget/vendor overlay
// AFTER the BOQ already exists -- budgetPercentage/vendorId/vendorAmount
// were already real, live columns (Point 154, 22 Aug) with a default of 25
// and a computedBudget() read-time helper, but no write path existed to
// change them post-creation. Reuses those SAME columns -- does NOT add a
// duplicate budget_pct/vendor_amount pair (that would be the exact D-3/B-3
// drift this run is elsewhere fixing). budgetPercentage recomputes
// computedBudget on every read automatically (it's derived, never stored),
// so "override to 40% -> recomputes" needs no extra logic here at all.
export async function updateLineItemBudget(
  ctx: { orgId: string },
  lineItemId: string,
  input: {
    budgetPercentage?: number
    vendorId?: string | null
    vendorAmount?: number | null
    // R67 D-26 (drizzle/0529): the other two thirds of Sumeet's budget model.
    // Same convention as vendorAmount -- an explicit null CLEARS the cell back
    // to "not costed", which is a different answer from 0.
    materialAmount?: number | null
    manpowerAmount?: number | null
  }
) {
  if (input.budgetPercentage !== undefined && (input.budgetPercentage < 0 || input.budgetPercentage > 100)) {
    throw new ServiceError("budgetPercentage must be between 0 and 100", 400)
  }
  for (const field of ["vendorAmount", "materialAmount", "manpowerAmount"] as const) {
    const value = input[field]
    if (value !== undefined && value !== null && (!Number.isFinite(value) || value < 0)) {
      throw new ServiceError(`${field} must be a non-negative number`, 400)
    }
  }
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const existing = await db.query.constructionBoqLineItems.findFirst({ where: eq(constructionBoqLineItems.id, lineItemId) })
    if (!existing) throw new ServiceError("Line item not found", 404)
    const boq = await db.query.constructionBoqs.findFirst({ where: and(eq(constructionBoqs.id, existing.boqId), eq(constructionBoqs.orgId, ctx.orgId)) })
    if (!boq) throw new ServiceError("Line item not found", 404)

    const [updated] = await db.update(constructionBoqLineItems).set({
      ...(input.budgetPercentage !== undefined ? { budgetPercentage: String(input.budgetPercentage) } : {}),
      ...(input.vendorId !== undefined ? { vendorId: input.vendorId } : {}),
      ...(input.vendorAmount !== undefined ? { vendorAmount: input.vendorAmount === null ? null : String(input.vendorAmount) } : {}),
      ...(input.materialAmount !== undefined ? { materialAmount: input.materialAmount === null ? null : String(input.materialAmount) } : {}),
      ...(input.manpowerAmount !== undefined ? { manpowerAmount: input.manpowerAmount === null ? null : String(input.manpowerAmount) } : {}),
    }).where(eq(constructionBoqLineItems.id, lineItemId)).returning()
    return withComputedRate(updated)
  })
}

export async function createBoq(ctx: BoqContext, input: BoqInput) {
  const title = input.title?.trim()
  if (!title) throw new ServiceError("title is required", 400)
  if (!input.projectId) throw new ServiceError("projectId is required", 400)
  // Before the transaction: a malformed body should never open one.
  validateBoqBodyShape(input)
  validateLineItemInputs(input.lineItems || [])

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const project = await db.query.projects.findFirst({ where: and(eq(projects.id, input.projectId), eq(projects.orgId, ctx.orgId)) })
    if (!project) throw new ServiceError("Project not found", 404)

    const [boq] = await db.insert(constructionBoqs).values({
      orgId: ctx.orgId, projectId: input.projectId, version: 1, title, createdById: ctx.userId,
    }).returning()

    const lineItems = input.lineItems || []
    await insertLineItems(db, ctx.orgId, boq.id, lineItems)
    await assertLineItemsPersisted(db, boq.id, lineItems.length)
    return getBoqRow(db, boq.id)
  })
}

async function getBoqRow(db: TenantDb, boqId: string) {
  const boq = await db.query.constructionBoqs.findFirst({ where: eq(constructionBoqs.id, boqId) })
  // R53 / R46M13_TC10_01: `{ ...undefined }` is legal JavaScript, so without
  // this guard a read that found nothing returned a 201 whose body carried
  // no id and an empty lineItems array -- indistinguishable, to a caller,
  // from a BOQ that was created and simply had no lines. getBoq() has always
  // thrown 404 in this situation; this path silently did not.
  if (!boq) throw new ServiceError("BOQ not found after write -- nothing was saved", 500)
  const lineItems = await db.query.constructionBoqLineItems.findMany({ where: eq(constructionBoqLineItems.boqId, boqId) })
  return { ...boq, lineItems: lineItems.map(withComputedRate) }
}

export async function createBoqRevision(
  ctx: BoqContext,
  parentBoqId: string,
  input: { title?: string; lineItems?: BoqLineItemInput[]; allowScopeReductionOverride?: boolean }
) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const parent = await db.query.constructionBoqs.findFirst({ where: and(eq(constructionBoqs.id, parentBoqId), eq(constructionBoqs.orgId, ctx.orgId)) })
    if (!parent) throw new ServiceError("Parent BOQ not found", 404)

    // E-128 (real bug, found while investigating duplicate (project_id,
    // version) rows): nothing previously stopped this function from being
    // called twice for the same parent -- a double-submit or a retried
    // request would each read the SAME parent.version and both insert
    // version = parent.version + 1, giving one parent two sibling children
    // that collide on version (verified live: parent n1aowsmdxp0xim4zb394zxb2
    // had exactly this happen, 13 seconds apart). A revision chain's version
    // numbers only mean anything if each parent supersedes into at most one
    // child, so that -- not project-wide version uniqueness, which would
    // wrongly reject the legitimate "two independent, non-chained BOQs both
    // start at version 1" case documented on schema.ts's parentBoqId column
    // -- is the real invariant. The DB now also enforces this at the layer
    // that actually matters (parentBoqId UNIQUE) so a race loses to a clean
    // constraint violation even if this check and the constraint-add race
    // each other; this check exists so the common (non-racing) case gets a
    // real 409 instead of a raw postgres unique-violation bubbling up.
    const existingChild = await db.query.constructionBoqs.findFirst({ where: eq(constructionBoqs.parentBoqId, parent.id) })
    if (existingChild) {
      throw new ServiceError(`This BOQ has already been revised (revision ${existingChild.version}, id ${existingChild.id}) -- create a new revision from that one instead.`, 409)
    }

    const previousItems = await db.query.constructionBoqLineItems.findMany({ where: eq(constructionBoqLineItems.boqId, parent.id) })

    const [boq] = await db.insert(constructionBoqs).values({
      orgId: ctx.orgId, projectId: parent.projectId, version: parent.version + 1,
      parentBoqId: parent.id, title: input.title?.trim() || parent.title, createdById: ctx.userId,
    }).returning()

    // R44 seq3 fix (real defect, found while building the COMPARE archetype):
    // this used to default a missing `lineItems` to `[]`, so "create a
    // revision" silently created an EMPTY one unless the caller happened to
    // re-submit all previous items itself -- the opposite of "create WITH
    // REFERENCE" (M31: "the single biggest typing saver in an ERP"). Only an
    // *explicit* `input.lineItems` (including an explicit `[]`, a genuine
    // "start this revision empty" caller intent) overrides the copy-forward
    // default; `undefined` now means "copy every parent line item forward
    // unchanged," matching the create-with-reference contract the TIMELINE/
    // COMPARE archetypes' test oracle requires.
    const itemCodeById = new Map(previousItems.filter((i) => i.itemCode).map((i) => [i.id, i.itemCode!]))
    const lineItems = input.lineItems ?? previousItems.map((row) => toLineItemInput(row, itemCodeById))

    validateLineItemInputs(lineItems)
    await insertLineItems(db, ctx.orgId, boq.id, lineItems)
    await assertLineItemsPersisted(db, boq.id, lineItems.length)

    // Owner directive: a negative variation (removing/reducing a line item)
    // must be blocked -- not just warned about -- when that item's linked
    // activity has recorded completed progress. Runs inside this same
    // transaction, so a block here rolls back the whole revision (including
    // the row just inserted above), not just the violating line items.
    const currentItems = await db.query.constructionBoqLineItems.findMany({ where: eq(constructionBoqLineItems.boqId, boq.id) })
    const { removed, changed } = diffLineItems(previousItems, currentItems)
    // R36 fix (real bug, found while verifying R-23): a revision always
    // inserts BRAND NEW line item rows, so `changed[i].current.id` never
    // matches any existing progress entry's boq_line_item_id -- those were
    // recorded against the PREVIOUS row. Load progress keyed by the
    // PREVIOUS id (where it actually lives), then re-key each changed
    // item's result onto its CURRENT id, since findScopeReductionViolations
    // looks progress up by change.current.id. Removed items are unaffected
    // (their "id" IS the previous/only id, already correct).
    const progressByPreviousId = await loadLatestProgressDetailByLineItem(db, ctx.orgId, [...removed, ...changed.map((c) => c.previous)])
    const progressDetailByLineItem = new Map(progressByPreviousId)
    for (const c of changed) {
      const progress = progressByPreviousId.get(c.previous.id)
      if (progress !== undefined) progressDetailByLineItem.set(c.current.id, progress)
    }
    const progressByLineItem = new Map([...progressDetailByLineItem].map(([id, p]) => [id, p.percentComplete]))
    const violations = findScopeReductionViolations({ removed, changed }, progressByLineItem)
    if (violations.length > 0 && !input.allowScopeReductionOverride) {
      // R67 D-27: the same block, now carrying the violating lines as
      // STRUCTURED rows as well as inside the sentence, so the revise screen
      // can render "R60SK-A - 12 m2 recorded on 28 Aug 2026" in a table above
      // the override instead of printing a paragraph.
      throw new ScopeReductionError(
        `Scope reduction blocked -- this revision would remove or reduce work already completed on site: ${violations.join("; ")}. ` +
          `Pass allowScopeReductionOverride: true to proceed anyway.`,
        buildScopeReductionConflicts({ removed, changed }, progressDetailByLineItem)
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
  return resolveByLineItem(items, byLineItemId, byActivityId)
}

/**
 * R67 D-27: the same resolution rule, carrying the WHOLE most-recent progress
 * entry rather than only its percentage -- because "R60SK-A - 12 m2 recorded on
 * 28 Aug 2026" needs the quantity and the date as well. Generic so the two
 * cannot drift: resolveProgressByLineItem above is this function at T = number.
 */
export type LineItemProgress = { percentComplete: number; quantityDone: number; entryDate: string }

function resolveByLineItem<T>(items: BoqLineItemRow[], byLineItemId: Map<string, T>, byActivityId: Map<string, T>): Map<string, T> {
  const resolved = new Map<string, T>()
  for (const item of items) {
    if (byLineItemId.has(item.id)) { resolved.set(item.id, byLineItemId.get(item.id)!); continue }
    if (item.activityId && byActivityId.has(item.activityId)) resolved.set(item.id, byActivityId.get(item.activityId)!)
  }
  return resolved
}

export function resolveProgressDetailByLineItem(
  items: BoqLineItemRow[],
  byLineItemId: Map<string, LineItemProgress>,
  byActivityId: Map<string, LineItemProgress>
): Map<string, LineItemProgress> {
  return resolveByLineItem(items, byLineItemId, byActivityId)
}

/**
 * R67 D-27 (R-068). The 409 this service already threw named the violating
 * lines only inside a prose sentence -- '"Blockwork" is 40% complete on site
 * and would be removed entirely' -- which a UI can print but cannot render as a
 * table, sort, count, or link to the line. This turns the SAME violations into
 * structured rows carrying what a site engineer needs to judge the override:
 * the item code, the quantity actually recorded, its unit, and when it was last
 * recorded.
 *
 * Pure and DB-free, sharing findScopeReductionViolations' own rule for what
 * counts as a violation (a removed line, or a changed line whose netVariation
 * is negative, that has ANY recorded progress) so the block and the table can
 * never disagree about which lines they are talking about.
 */
export type ScopeReductionConflict = {
  itemCode: string | null
  description: string
  recordedQty: number
  unit: string
  lastRecordedAt: string
}

export function buildScopeReductionConflicts(
  diff: { removed: BoqLineItemRow[]; changed: ChangedLineItem[] },
  progressByLineItem: Map<string, LineItemProgress>
): ScopeReductionConflict[] {
  const conflicts: ScopeReductionConflict[] = []
  const push = (item: BoqLineItemRow, progress: LineItemProgress | undefined) => {
    if (!progress || !(progress.percentComplete > 0)) return
    conflicts.push({
      itemCode: item.itemCode,
      description: item.description,
      recordedQty: progress.quantityDone,
      unit: item.unit,
      lastRecordedAt: progress.entryDate,
    })
  }

  for (const item of diff.removed) push(item, progressByLineItem.get(item.id))
  for (const change of diff.changed) {
    if (change.netVariation >= 0) continue
    push(change.current, progressByLineItem.get(change.current.id))
  }
  return conflicts
}

/**
 * R67 D-27: the 409 createBoqRevision raises when a revision would reduce or
 * remove scope already completed on site. A ServiceError, so every existing
 * `catch (error instanceof ServiceError)` in the route layer keeps working
 * unchanged and still answers 409 with this message; a route that WANTS the
 * structured rows checks for this subclass and adds `conflicts` to the body.
 */
export class ScopeReductionError extends ServiceError {
  constructor(message: string, public readonly conflicts: ScopeReductionConflict[]) {
    super(message, 409)
  }
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
  const detail = await loadLatestProgressDetailByLineItem(db, orgId, items)
  return new Map([...detail].map(([id, p]) => [id, p.percentComplete]))
}

/**
 * R67 D-27: the DB half of the conflict table -- the same read
 * loadLatestProgressByLineItem has always done, keeping the WHOLE most-recent
 * entry (percentage, quantity done, date) instead of discarding all but the
 * percentage. loadLatestProgressByLineItem above is now a projection of this,
 * so there is still exactly ONE query and one resolution rule (arch rule AR-01).
 */
export async function loadLatestProgressDetailByLineItem(db: TenantDb, orgId: string, items: BoqLineItemRow[]): Promise<Map<string, LineItemProgress>> {
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
  const byLineItemId = new Map<string, LineItemProgress>()
  const byActivityId = new Map<string, LineItemProgress>()
  const toProgress = (row: typeof rows[number]): LineItemProgress => ({
    percentComplete: Number(row.percentComplete),
    quantityDone: Number(row.quantityDone),
    entryDate: String(row.entryDate),
  })
  for (const row of rows) {
    if (row.boqLineItemId && !byLineItemId.has(row.boqLineItemId)) byLineItemId.set(row.boqLineItemId, toProgress(row))
    if (row.activityId && !byActivityId.has(row.activityId)) byActivityId.set(row.activityId, toProgress(row))
  }

  return resolveProgressDetailByLineItem(items, byLineItemId, byActivityId)
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
    // R36 fix: same bug as createBoqRevision (progress lives on the
    // PREVIOUS line item's id, not the CURRENT/new one) -- see the comment
    // there. Kept in sync deliberately so compareBoq()'s warnings and
    // createBoqRevision()'s hard block can never disagree about what counts
    // as a violation (this file's own docstring on findScopeReductionViolations).
    const progressByPreviousId = await loadLatestProgressByLineItem(db, ctx.orgId, [...removed, ...changed.map((c) => c.previous)])
    const progressByLineItem = new Map(progressByPreviousId)
    for (const c of changed) {
      const pct = progressByPreviousId.get(c.previous.id)
      if (pct !== undefined) progressByLineItem.set(c.current.id, pct)
    }
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

// R46/E-126b: no DELETE existed for a BOQ at all -- the demo-gate smoke
// suite (e2e/demo-gate-smoke.spec.ts) creates real, timestamped BOQs on
// every CI run with nowhere to clean them up, so the count of ""R-B1
// smoke ..."" rows on the shared demo project grew unbounded (165 -> 170 ->
// 204 over three sessions) until an afterEach in that spec could call a
// real endpoint. Scoped the same way every other mutator in this file is
// (ctx.orgId via withTenantContext -- a caller can only ever delete a BOQ
// inside their OWN org, so this is not demo/test-specific, just a normal
// missing CRUD operation). Restricted to status "draft" only: once a BOQ
// has been submitted/approved it represents real, potentially executed
// scope and must go through submitBoq/approveBoq's own state machine (a
// revision or explicit descope), never a silent delete -- this also means
// the smoke suite's own BOQs (always left in "draft", never submitted)
// are always eligible for its own afterEach to remove.
export async function deleteBoq(ctx: { orgId: string }, boqId: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const boq = await db.query.constructionBoqs.findFirst({ where: and(eq(constructionBoqs.id, boqId), eq(constructionBoqs.orgId, ctx.orgId)) })
    if (!boq) throw new ServiceError("BOQ not found", 404)
    if (boq.status !== "draft") throw new ServiceError("Only a draft BOQ can be deleted -- submit/approve implies real scope that must be revised, not silently removed", 400)

    const lineItemRows = await db.query.constructionBoqLineItems.findMany({ where: eq(constructionBoqLineItems.boqId, boqId) })
    const lineItemIds = lineItemRows.map((li) => li.id)
    if (lineItemIds.length > 0) {
      await db.delete(constructionWorkProgressEntries).where(inArray(constructionWorkProgressEntries.boqLineItemId, lineItemIds))
      await db.delete(constructionBoqLineItems).where(eq(constructionBoqLineItems.boqId, boqId))
    }
    await db.delete(constructionBoqs).where(eq(constructionBoqs.id, boqId))
    return { deleted: true, id: boqId, lineItemsDeleted: lineItemIds.length }
  })
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
