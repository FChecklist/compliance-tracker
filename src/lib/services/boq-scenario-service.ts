// R85 Addendum 3 v4 (FINAL, claude_log 379), Phase 10 / spec Part F -- THE
// WHAT-IF / SCENARIO ENGINE (gates 10-01..10-13). Work order: Google Drive
// WORK_ORDER_R85_ADDENDUM_3_v4_R50_FINAL.md, Part F. Per the spec's own Part H
// sizing note this is "the largest single build" in this work order.
//
// ★ WHAT A SCENARIO IS (10-01) ★ -- a NON-DESTRUCTIVE scratch layer: a name,
// an author, a base BOQ (and optionally the baseline version it was built
// against), and a list of per-line adjustments. NOTHING here is a computed
// money figure (X-02) -- every BASE/SCENARIO/DELTA figure this file returns
// is derived at read time by re-running boq-dual-view-service.ts's existing
// computeBoqLineMoneyView/rollUpRootLines (X-27, single producer) over the
// live BOQ lines with a scenario's adjustments applied as an INPUT
// transformation. This file never invents a second money formula.
//
// ★ 10-08, NOTHING IS WRITTEN UNTIL COMMIT ★ -- createScenario/addAdjustment/
// addBulkAdjustment/removeAdjustment/computeScenarioView/compareScenarios/the
// two target-seek solvers below NEVER touch constructionBoqs or
// constructionBoqLineItems. The only functions in this file that write to
// the live BOQ at all are commitScenario() and the private helpers it calls.
// Falsifiability (boq-scenario-service.test.ts): build a scenario with
// several adjustments, then assert the live BOQ's line items are
// byte-for-byte unchanged before commitScenario() is ever called.
//
// ★ 10-12, AI MAY PROPOSE, AI MAY NEVER COMMIT (SECURITY-CRITICAL, PASS
// marker) ★ -- commitScenario()'s FIRST statement, before any database
// access at all, requires `ctx.actorKind === "human"`. There is no default
// branch: `actorKind` is a required (non-optional) field on
// ScenarioCommitContext, so a caller MUST say which it is -- an unset/
// ambiguous caller-type cannot silently fall through to "human" (fail-open
// would defeat the whole gate). See this file's own commitScenario() doc
// comment for the full trace of whether src/lib/pipeline/executor.ts's
// AI-dispatched task-execution layer can reach this function today (it
// cannot -- boq-scenario-service.ts has zero importers under
// src/lib/pipeline or src/lib/task-execution as of this commit).
//
// ★ WHY THIS FILE NEVER CALLS construction-boq-service.ts's createBoqRevision
// FROM INSIDE ITS OWN withTenantContext BLOCK ★ -- CLAUDE.md's R74/R75 state
// documents a real, general gotcha: a function that opens its own
// withTenantContext(...) and is then called from inside another
// already-open withTenantContext block throws in dev/test and silently
// opens a second real transaction in production (pool exhaustion risk).
// createBoqRevision/submitBoq/approveBoq/getBoq each open their own
// withTenantContext. Every call to one of them in this file is therefore a
// standalone, top-level `await` -- never nested inside one of THIS file's
// own withTenantContext callbacks -- matching the established pattern
// src/lib/pipeline/executor.ts's executeCreateBoqRevision() already uses.
// The tradeoff this creates (10-10's "no partial commit" is enforced PER
// STEP, not as one cross-service ACID transaction spanning cost-side write +
// revision creation + scenario status flip) is documented on
// commitScenario() itself, not silently assumed away.
import { constructionBoqs, constructionBoqLineItems, boqScenario, users } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { and, eq } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError }
import { logActivity } from "@/lib/audit"
import {
  getBoq,
  createBoqRevision,
  toLineItemInput,
  type BoqLineItemInput,
  type BoqLineItemRow,
} from "./construction-boq-service"
import {
  computeBoqLineMoneyView,
  rollUpRootLines,
  validateBoqCellEdit,
  NOT_SET,
  type MoneyFigure,
  type BoqLineMoneyInput,
  type BoqLineMoneyView,
  type BoqLineForRollup,
  type BoqRollupTotals,
} from "./boq-dual-view-service"
export { NOT_SET }

// ─────────────────────────────────────────────────────────────────────────
// 10-02: THE FIVE ADJUSTMENT VERBS, ON EITHER SIDE
// ─────────────────────────────────────────────────────────────────────────
//
// "Per line: rate by %, rate to absolute, qty by %, qty to absolute,
// exclude the line ... BOTH SIDES adjustable." Modelled as a discriminated
// union keyed by (lineItemId, side, field) for a plain adjustment -- NOT by
// a single "mode" enum covering all four verbs at once -- because a real
// scenario can legitimately change BOTH the quantity AND the rate on the
// SAME side of the SAME line at once (e.g. "-10% qty, +5% rate" on the
// project side), which a single mode-per-line-per-side design could not
// represent. `exclude` is a separate, line-wide (not side-specific) variant:
// 10-02 says it zeroes quantity, not that it has a "side".
export type AdjustmentSide = "project" | "contract"
export type AdjustmentField = "rate" | "qty"
export type AdjustmentChangeType = "percent" | "absolute"

export type ScenarioLineAdjustment = {
  kind: "adjust"
  lineItemId: string
  side: AdjustmentSide
  field: AdjustmentField
  changeType: AdjustmentChangeType
  /** For `changeType: "percent"`, a signed percentage (e.g. -10 means -10%,
   * applied as base * (1 + value/100)). For `changeType: "absolute"`, the
   * new value itself. */
  value: number
}

/** 10-02: "exclude the line (qty -> 0, kept visible, struck through)."
 * Line-wide, not per-side -- see applyAdjustmentsToLine's own doc comment
 * for exactly which columns this zeroes and why. */
export type ScenarioExcludeAdjustment = {
  kind: "exclude"
  lineItemId: string
}

export type ScenarioAdjustment = ScenarioLineAdjustment | ScenarioExcludeAdjustment

export function isExcludeAdjustment(a: ScenarioAdjustment): a is ScenarioExcludeAdjustment {
  return a.kind === "exclude"
}
export function isLineAdjustment(a: ScenarioAdjustment): a is ScenarioLineAdjustment {
  return a.kind === "adjust"
}

/** Merge key for de-duplication (mergeAdjustment below): a plain adjustment
 * is keyed by the exact (line, side, field) triple it overrides; an exclude
 * is keyed by line alone (it has no side/field). */
function adjustmentKey(a: ScenarioAdjustment): string {
  return isExcludeAdjustment(a) ? `${a.lineItemId}:exclude` : `${a.lineItemId}:${a.side}:${a.field}`
}

/**
 * 10-02's "latest edit wins" merge, pure and DB-free so it is directly unit
 * testable. Two rules, both deliberate:
 *   1. Excluding a line REMOVES every other adjustment already recorded for
 *      it (both sides) -- a struck-through, zeroed line has nothing else
 *      meaningful left to say about rate or quantity.
 *   2. Recording a real numeric adjustment for a line REMOVES any exclude
 *      already on it (as well as any prior adjustment for that exact same
 *      (side, field)) -- entering a real number is an explicit signal the
 *      line is back in scope, not still excluded.
 * Order-independent in the sense that matters: calling this repeatedly with
 * the adjustments a bulk operation resolves to (addBulkAdjustment below)
 * produces the same final list regardless of the order they're folded in,
 * because each call only ever removes entries that key-collide with the ONE
 * adjustment being added.
 */
export function mergeAdjustment(existing: ScenarioAdjustment[], incoming: ScenarioAdjustment): ScenarioAdjustment[] {
  const filtered = isExcludeAdjustment(incoming)
    ? existing.filter((a) => a.lineItemId !== incoming.lineItemId)
    : existing.filter((a) => !(a.lineItemId === incoming.lineItemId && (isExcludeAdjustment(a) || adjustmentKey(a) === adjustmentKey(incoming))))
  return [...filtered, incoming]
}

/** Clears every adjustment (both sides, and any exclude) recorded for one
 * line -- "revert this line to the base BOQ" is the only removal granularity
 * exposed (matches removeAdjustment's route contract below); a caller
 * wanting to change just one field re-adds a new adjustment instead, which
 * mergeAdjustment above already replaces in place. */
export function removeAdjustmentsForLine(existing: ScenarioAdjustment[], lineItemId: string): ScenarioAdjustment[] {
  return existing.filter((a) => a.lineItemId !== lineItemId)
}

// ─────────────────────────────────────────────────────────────────────────
// 10-03: BULK -- a selection, a trade/section, or the whole BOQ
// ─────────────────────────────────────────────────────────────────────────

export type BulkSelector =
  | { kind: "lineItemIds"; lineItemIds: string[] }
  /** "a trade or section" maps to this table's existing `category` column --
   * the same mapping boq-rate-history-service.ts's own `trade` filter
   * already documents and uses (see that file's header for why `category`,
   * not a separate `trade` column, is the closest existing concept). */
  | { kind: "category"; category: string }
  | { kind: "all" }

/** Pure resolver -- DB-free, unit testable with a plain line-item fixture.
 * The DB-touching half (addBulkAdjustment below) supplies the real
 * `lines` array. */
export function resolveBulkSelector(
  lines: Array<{ id: string; category: string | null }>,
  selector: BulkSelector
): string[] {
  switch (selector.kind) {
    case "lineItemIds":
      return selector.lineItemIds
    case "category": {
      const target = selector.category.trim().toLowerCase()
      return lines.filter((l) => (l.category ?? "").trim().toLowerCase() === target).map((l) => l.id)
    }
    case "all":
      return lines.map((l) => l.id)
  }
}

// ─────────────────────────────────────────────────────────────────────────
// APPLYING ADJUSTMENTS -- the one place a scenario's stored instructions
// turn into a hypothetical set of {qtyProject, rateProject, qtyContract,
// rateContract} inputs. This is NOT a money figure (X-27 concerns
// project_value/contract_value/variance/etc, all of which still come from
// boq-dual-view-service.ts unchanged) -- it is the INPUT TRANSFORMATION a
// scenario represents, analogous to how a live BOQ edit changes those same
// four raw columns before the same downstream math runs.
// ─────────────────────────────────────────────────────────────────────────

export type BoqLineForScenario = { id: string; parentLineItemId: string | null } & BoqLineMoneyInput

/** Deliberately narrower than BoqLineMoneyInput (no `undefined`) --
 * applyAdjustmentsToLine below always resolves to a definite number or a
 * definite null, never "field omitted", so every caller downstream can
 * write `=== null` without also having to think about `undefined`. */
export type ScenarioLineInputs = { qtyProject: number | null; rateProject: number | null; qtyContract: number | null; rateContract: number | null }

function toFiniteOrNull(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null
  const n = typeof v === "number" ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

/** NOT_SET-safe (X-04): an ABSOLUTE change simply replaces the base value
 * (even an unset one -- that is the whole point of "qty to absolute"/"rate
 * to absolute": it can set a value where none existed). A PERCENT change
 * needs a real base to scale; applying "-10%" to an unset base stays unset
 * rather than becoming a false 0 or a NaN. */
function applyFieldAdjustment(base: number | string | null | undefined, adj: ScenarioLineAdjustment | undefined): number | null {
  if (!adj) return toFiniteOrNull(base)
  if (adj.changeType === "absolute") return adj.value
  const baseNum = toFiniteOrNull(base)
  if (baseNum === null) return null
  return baseNum * (1 + adj.value / 100)
}

/**
 * 10-02/10-06: given a live line and every adjustment recorded against it
 * (both sides, or an exclude), returns the hypothetical
 * {qtyProject,rateProject,qtyContract,rateContract} a "SCENARIO" view feeds
 * straight into computeBoqLineMoneyView -- the SAME function every other
 * screen in this codebase already calls (X-27). No bespoke override for the
 * exclude case: qty is forced to 0 on BOTH sides (10-02 "qty -> 0"; rate is
 * left untouched so a struck-through row still shows what the rate would
 * have been), and the result is fed through the ordinary formula exactly
 * like any other input -- if rateProject/rateContract was never entered for
 * an excluded line, the resulting projectValue/contractValue is honestly
 * NOT_SET (not silently coerced to a "certain" 0), for the same reason a
 * live BOQ line with qty=0/rate=NOT_SET is NOT_SET today (Phase 1-4,
 * unchanged) -- this file intentionally does not introduce a second,
 * inconsistent NOT_SET rule just for scenarios.
 */
export function applyAdjustmentsToLine(
  base: BoqLineForScenario,
  adjustmentsForThisLine: ScenarioAdjustment[]
): ScenarioLineInputs {
  const mine = adjustmentsForThisLine.filter((a) => a.lineItemId === base.id)
  const exclude = mine.find(isExcludeAdjustment)
  if (exclude) {
    return { qtyProject: 0, rateProject: toFiniteOrNull(base.rateProject), qtyContract: 0, rateContract: toFiniteOrNull(base.rateContract) }
  }

  const find = (side: AdjustmentSide, field: AdjustmentField) =>
    mine.find((a): a is ScenarioLineAdjustment => isLineAdjustment(a) && a.side === side && a.field === field)

  return {
    rateProject: applyFieldAdjustment(base.rateProject, find("project", "rate")),
    qtyProject: applyFieldAdjustment(base.qtyProject, find("project", "qty")),
    rateContract: applyFieldAdjustment(base.rateContract, find("contract", "rate")),
    qtyContract: applyFieldAdjustment(base.qtyContract, find("contract", "qty")),
  }
}

/**
 * 10-06: "A line going NEGATIVE under a scenario is flagged the moment it
 * happens." A scenario's whole purpose is cost/rate/qty experimentation, so
 * this is deliberately permissive at the WRITE path (addAdjustment never
 * blocks a change for producing a negative result -- see this file's header
 * on why 10-06 exists to flag, not prevent) and this function is the single
 * FLAG producer: true when any of project value, contract value, or
 * variance (contract - project, i.e. this line's own profit) is a real
 * negative number under the scenario. NOT_SET never counts as negative
 * (X-04 -- "unknown" is not "bad").
 */
export function isScenarioLineNegative(view: BoqLineMoneyView): boolean {
  return [view.projectValue, view.contractValue, view.variance].some((v) => v !== NOT_SET && v < 0)
}

// ─────────────────────────────────────────────────────────────────────────
// 10-04: TARGET-SEEK -- SOLVE AND SHOW, NEVER APPLY.
// Pure, DB-free algebra over the CURRENT rolled-up totals. Neither function
// touches a scenario or the BOQ -- callers (the route layer) fetch the
// current totals via rollUpRootLines(getBoq(...).lineItems) and hand them in;
// nothing here writes anything, ever.
// ─────────────────────────────────────────────────────────────────────────

export type TargetSeekRateResult =
  | {
      feasible: true
      /** Uniform % change to apply to EVERY line's rate_project to reach the
       * target -- e.g. -12.5 means "cut every project-side rate by 12.5%". */
      rateChangePercent: number
      projectedProjectValue: MoneyFigure
      projectedContractValue: MoneyFigure
      projectedProfitPercent: MoneyFigure
    }
  | { feasible: false; reason: string }

/**
 * "What rate change across all lines reaches 25% profit?" Holds the
 * CONTRACT side fixed and solves for the uniform % change to the PROJECT
 * (cost) side that would make (contract - project) / contract equal the
 * target percentage. A uniform % rate change scales total project value by
 * the exact same factor (project_value = qty * rate, qty unchanged, summed
 * linearly across lines) -- this is exact algebra, not an approximation:
 *   target/100 = (C - P*(1+x)) / C  =>  x = C*(1 - target/100)/P - 1
 */
export function solveRateChangeForTargetProfitPercent(
  totals: { projectValue: MoneyFigure; contractValue: MoneyFigure },
  targetProfitPercent: number
): TargetSeekRateResult {
  if (!Number.isFinite(targetProfitPercent)) return { feasible: false, reason: "targetProfitPercent must be a finite number." }
  if (totals.contractValue === NOT_SET || totals.contractValue === 0) {
    return { feasible: false, reason: "Contract value is NOT_SET or zero -- cannot solve a target profit percentage against it." }
  }
  if (totals.projectValue === NOT_SET) {
    return { feasible: false, reason: "Project (cost) value is NOT_SET -- cannot solve a rate change with no cost baseline to scale." }
  }
  if (totals.projectValue === 0) {
    return { feasible: false, reason: "Current project (cost) value is zero -- a uniform percentage rate change cannot scale a zero base to any target." }
  }
  const contractValue = totals.contractValue
  const projectValue = totals.projectValue
  const desiredProjectValue = contractValue * (1 - targetProfitPercent / 100)
  const rateChangePercent = (desiredProjectValue / projectValue - 1) * 100
  const projectedProfitPercent = (contractValue - desiredProjectValue) / contractValue * 100
  return {
    feasible: true,
    rateChangePercent,
    projectedProjectValue: desiredProjectValue,
    projectedContractValue: contractValue,
    projectedProfitPercent,
  }
}

export type TargetSeekQtyResult =
  | {
      feasible: true
      /** Uniform % reduction to apply to EVERY line's qty_contract. */
      qtyReductionPercent: number
      projectedContractValue: MoneyFigure
    }
  | { feasible: false; reason: string }

/**
 * "What qty reduction reaches a contract value of 800,000?" A uniform %
 * quantity reduction on the contract side scales total contract value by
 * the same factor (contract_value = qty * rate, rate unchanged, summed
 * linearly): target = C*(1-y)  =>  y = 1 - target/C.
 */
export function solveQtyReductionForTargetContractValue(
  totals: { contractValue: MoneyFigure },
  targetContractValue: number
): TargetSeekQtyResult {
  if (!Number.isFinite(targetContractValue)) return { feasible: false, reason: "targetContractValue must be a finite number." }
  if (totals.contractValue === NOT_SET || totals.contractValue === 0) {
    return { feasible: false, reason: "Current contract value is NOT_SET or zero -- cannot solve a uniform quantity reduction against it." }
  }
  const contractValue = totals.contractValue
  const qtyReductionPercent = (1 - targetContractValue / contractValue) * 100
  return { feasible: true, qtyReductionPercent, projectedContractValue: targetContractValue }
}

// ─────────────────────────────────────────────────────────────────────────
// DB-TOUCHING LAYER
// ─────────────────────────────────────────────────────────────────────────

export type ScenarioContext = { orgId: string }
export type ScenarioWriteContext = { orgId: string; userId: string }

export type CreateScenarioInput = { boqId: string; name: string; baseBaselineVersion?: number | null }

/** 10-01: "A first-class record: name, author, created_at, base baseline
 * version, adjustment list." Starts with an empty adjustment list -- a
 * scenario always exists before it has any adjustments (10-02 additions
 * happen afterward, one addAdjustment/addBulkAdjustment call at a time). */
export async function createScenario(ctx: ScenarioWriteContext, input: CreateScenarioInput) {
  const name = input.name?.trim()
  if (!name) throw new ServiceError("name is required", 400)
  if (!input.boqId) throw new ServiceError("boqId is required", 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const boq = await db.query.constructionBoqs.findFirst({
      where: and(eq(constructionBoqs.id, input.boqId), eq(constructionBoqs.orgId, ctx.orgId)),
    })
    if (!boq) throw new ServiceError("BOQ not found", 404)

    const [row] = await db
      .insert(boqScenario)
      .values({
        orgId: ctx.orgId,
        boqId: input.boqId,
        projectId: boq.projectId,
        baseBaselineVersion: input.baseBaselineVersion ?? null,
        name,
        authorId: ctx.userId,
        adjustments: [],
      })
      .returning()
    return row
  })
}

export async function getScenario(ctx: ScenarioContext, scenarioId: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const row = await db.query.boqScenario.findFirst({
      where: and(eq(boqScenario.id, scenarioId), eq(boqScenario.orgId, ctx.orgId)),
    })
    if (!row) throw new ServiceError("Scenario not found", 404)
    return row
  })
}

/** 10-07: "Save, name and hold several scenarios." Lists every scenario
 * (draft or committed) held against one BOQ. */
export async function listScenarios(ctx: ScenarioContext, boqId: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    return db.query.boqScenario.findMany({
      where: and(eq(boqScenario.boqId, boqId), eq(boqScenario.orgId, ctx.orgId)),
    })
  })
}

function assertMutable(scenario: { status: string; name: string }) {
  if (scenario.status === "committed") {
    throw new ServiceError(
      `Scenario "${scenario.name}" has already been committed and can no longer be edited (10-11: a committed scenario IS the audit trail -- it is never silently changed after the fact).`,
      409
    )
  }
}

function validateAdjustPayload(field: AdjustmentField, changeType: AdjustmentChangeType, value: number) {
  if (!Number.isFinite(value)) throw new ServiceError("value must be a finite number", 400)
  // 10-06 deliberately does NOT block a percent change from producing a
  // negative result (that is the whole feature -- flag it, don't prevent
  // it). An ABSOLUTE value reuses boq-dual-view-service.ts's own cell-edit
  // validation (X-27 -- the same rule a live BOQ edit already enforces: a
  // negative absolute quantity is refused outright, a negative absolute
  // rate is legal (a credit line) and is not blocked here either).
  if (changeType === "absolute") {
    const result = validateBoqCellEdit(field, String(value))
    if (!result.valid && result.refused) throw new ServiceError(result.reason, 400)
  }
}

export type AddAdjustmentInput =
  | { kind: "exclude"; lineItemId: string }
  | { kind: "adjust"; lineItemId: string; side: AdjustmentSide; field: AdjustmentField; changeType: AdjustmentChangeType; value: number }

/** 10-02: one line, one adjustment verb, either side. 10-08: writes ONLY to
 * boq_scenario's own `adjustments` column -- never touches the live BOQ. */
export async function addAdjustment(ctx: ScenarioWriteContext, scenarioId: string, input: AddAdjustmentInput) {
  if (!input.lineItemId) throw new ServiceError("lineItemId is required", 400)
  if (input.kind === "adjust") validateAdjustPayload(input.field, input.changeType, input.value)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const scenario = await db.query.boqScenario.findFirst({
      where: and(eq(boqScenario.id, scenarioId), eq(boqScenario.orgId, ctx.orgId)),
    })
    if (!scenario) throw new ServiceError("Scenario not found", 404)
    assertMutable(scenario)

    const line = await db.query.constructionBoqLineItems.findFirst({
      where: and(eq(constructionBoqLineItems.id, input.lineItemId), eq(constructionBoqLineItems.boqId, scenario.boqId)),
    })
    if (!line) throw new ServiceError(`Line item ${input.lineItemId} does not belong to this scenario's BOQ`, 400)

    const adjustment: ScenarioAdjustment =
      input.kind === "exclude"
        ? { kind: "exclude", lineItemId: input.lineItemId }
        : { kind: "adjust", lineItemId: input.lineItemId, side: input.side, field: input.field, changeType: input.changeType, value: input.value }

    const nextAdjustments = mergeAdjustment((scenario.adjustments ?? []) as ScenarioAdjustment[], adjustment)
    const [updated] = await db
      .update(boqScenario)
      .set({ adjustments: nextAdjustments, updatedAt: new Date() })
      .where(eq(boqScenario.id, scenarioId))
      .returning()
    return updated
  })
}

export type AddBulkAdjustmentInput = { selector: BulkSelector } & (
  | { kind: "exclude" }
  | { kind: "adjust"; side: AdjustmentSide; field: AdjustmentField; changeType: AdjustmentChangeType; value: number }
)

/** 10-03: "Bulk: a selection, a trade or section, the whole BOQ." Resolves
 * the selector against the scenario's LIVE BOQ lines, then applies the SAME
 * single adjustment to every resolved line via mergeAdjustment (10-08:
 * still only ever writes boq_scenario.adjustments, never the BOQ itself). */
export async function addBulkAdjustment(ctx: ScenarioWriteContext, scenarioId: string, input: AddBulkAdjustmentInput) {
  if (input.kind === "adjust") validateAdjustPayload(input.field, input.changeType, input.value)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const scenario = await db.query.boqScenario.findFirst({
      where: and(eq(boqScenario.id, scenarioId), eq(boqScenario.orgId, ctx.orgId)),
    })
    if (!scenario) throw new ServiceError("Scenario not found", 404)
    assertMutable(scenario)

    const lines = await db.query.constructionBoqLineItems.findMany({ where: eq(constructionBoqLineItems.boqId, scenario.boqId) })
    const lineItemIds = resolveBulkSelector(lines, input.selector)
    if (lineItemIds.length === 0) throw new ServiceError("Bulk selector matched zero line items", 400)

    let nextAdjustments = (scenario.adjustments ?? []) as ScenarioAdjustment[]
    for (const lineItemId of lineItemIds) {
      const adjustment: ScenarioAdjustment =
        input.kind === "exclude"
          ? { kind: "exclude", lineItemId }
          : { kind: "adjust", lineItemId, side: input.side, field: input.field, changeType: input.changeType, value: input.value }
      nextAdjustments = mergeAdjustment(nextAdjustments, adjustment)
    }

    const [updated] = await db
      .update(boqScenario)
      .set({ adjustments: nextAdjustments, updatedAt: new Date() })
      .where(eq(boqScenario.id, scenarioId))
      .returning()
    return { ...updated, affectedLineItemIds: lineItemIds }
  })
}

/** Reverts one line to the base BOQ (clears any adjustment or exclude
 * recorded for it). 10-08: adjustments-column-only write. */
export async function removeAdjustment(ctx: ScenarioWriteContext, scenarioId: string, lineItemId: string) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const scenario = await db.query.boqScenario.findFirst({
      where: and(eq(boqScenario.id, scenarioId), eq(boqScenario.orgId, ctx.orgId)),
    })
    if (!scenario) throw new ServiceError("Scenario not found", 404)
    assertMutable(scenario)

    const nextAdjustments = removeAdjustmentsForLine((scenario.adjustments ?? []) as ScenarioAdjustment[], lineItemId)
    const [updated] = await db
      .update(boqScenario)
      .set({ adjustments: nextAdjustments, updatedAt: new Date() })
      .where(eq(boqScenario.id, scenarioId))
      .returning()
    return updated
  })
}

// ─────────────────────────────────────────────────────────────────────────
// 10-05/10-06: BASE | SCENARIO | DELTA, per line and in total, plus the
// negative-line flag. Read-only -- computeScenarioView never writes
// anything (10-08).
// ─────────────────────────────────────────────────────────────────────────

export type ScenarioLineView = {
  lineItemId: string
  parentLineItemId: string | null
  excluded: boolean
  base: BoqLineMoneyView
  scenario: BoqLineMoneyView
  delta: { projectValue: MoneyFigure; contractValue: MoneyFigure; variance: MoneyFigure }
  negative: boolean
}

export type ScenarioTotalsDelta = { projectValue: MoneyFigure; contractValue: MoneyFigure; variance: MoneyFigure }

export type ScenarioView = {
  scenarioId: string
  boqId: string
  lines: ScenarioLineView[]
  totals: { base: BoqRollupTotals; scenario: BoqRollupTotals; delta: ScenarioTotalsDelta }
  negativeLineItemIds: string[]
}

/** NOT_SET-safe delta (X-04): either side unknown makes the delta unknown
 * too, never a false 0 standing in for "can't tell". */
function deltaFigure(base: MoneyFigure, scenario: MoneyFigure): MoneyFigure {
  if (base === NOT_SET || scenario === NOT_SET) return NOT_SET
  return scenario - base
}

/**
 * 10-05/10-06/10-20 (X-20's "a real per-cell diff, not a placeholder"): the
 * full BASE | SCENARIO | DELTA view for one scenario, per line AND in
 * total, plus which lines went negative. Reads the scenario's LIVE base BOQ
 * via getBoq() (construction-boq-service.ts's own single read path, X-27) --
 * a standalone top-level call, not nested inside this function's own
 * withTenantContext (getScenario already closed its own transaction by the
 * time this runs).
 */
export async function computeScenarioView(ctx: ScenarioContext, scenarioId: string): Promise<ScenarioView> {
  const scenario = await getScenario(ctx, scenarioId)
  const boq = await getBoq({ orgId: ctx.orgId }, scenario.boqId)
  const adjustments = (scenario.adjustments ?? []) as ScenarioAdjustment[]

  const adjustmentsByLine = new Map<string, ScenarioAdjustment[]>()
  for (const a of adjustments) {
    const list = adjustmentsByLine.get(a.lineItemId) ?? []
    list.push(a)
    adjustmentsByLine.set(a.lineItemId, list)
  }

  const lines: ScenarioLineView[] = boq.lineItems.map((item) => {
    const forThisLine = adjustmentsByLine.get(item.id) ?? []
    const base = computeBoqLineMoneyView(item)
    const scenarioInput = applyAdjustmentsToLine(item, forThisLine)
    const scenarioView = computeBoqLineMoneyView(scenarioInput)
    return {
      lineItemId: item.id,
      parentLineItemId: item.parentLineItemId,
      excluded: forThisLine.some(isExcludeAdjustment),
      base,
      scenario: scenarioView,
      delta: {
        projectValue: deltaFigure(base.projectValue, scenarioView.projectValue),
        contractValue: deltaFigure(base.contractValue, scenarioView.contractValue),
        variance: deltaFigure(base.variance, scenarioView.variance),
      },
      negative: isScenarioLineNegative(scenarioView),
    }
  })

  const baseRollupInput: BoqLineForRollup[] = boq.lineItems.map((i) => ({
    parentLineItemId: i.parentLineItemId,
    qtyProject: i.qtyProject,
    rateProject: i.rateProject,
    qtyContract: i.qtyContract,
    rateContract: i.rateContract,
  }))
  const scenarioRollupInput: BoqLineForRollup[] = boq.lineItems.map((item) => ({
    parentLineItemId: item.parentLineItemId,
    ...applyAdjustmentsToLine(item, adjustmentsByLine.get(item.id) ?? []),
  }))

  const baseTotals = rollUpRootLines(baseRollupInput)
  const scenarioTotals = rollUpRootLines(scenarioRollupInput)

  return {
    scenarioId,
    boqId: scenario.boqId,
    lines,
    totals: {
      base: baseTotals,
      scenario: scenarioTotals,
      delta: {
        projectValue: deltaFigure(baseTotals.projectValue, scenarioTotals.projectValue),
        contractValue: deltaFigure(baseTotals.contractValue, scenarioTotals.contractValue),
        variance: deltaFigure(baseTotals.variance, scenarioTotals.variance),
      },
    },
    negativeLineItemIds: lines.filter((l) => l.negative).map((l) => l.lineItemId),
  }
}

export type ScenarioComparisonEntry = {
  scenarioId: string
  name: string
  authorId: string
  status: "draft" | "committed"
  totals: ScenarioView["totals"]
}

/** 10-07: "Compare side by side, one column each." Sequential, not
 * Promise.all -- each computeScenarioView/getScenario call opens its own
 * withTenantContext, and this codebase's own documented pool-contention
 * gotcha (CLAUDE.md R74/R75) is specifically about fanning several of those
 * out concurrently. */
export async function compareScenarios(ctx: ScenarioContext, scenarioIds: string[]): Promise<ScenarioComparisonEntry[]> {
  if (!scenarioIds || scenarioIds.length === 0) throw new ServiceError("At least one scenarioId is required", 400)
  const results: ScenarioComparisonEntry[] = []
  for (const scenarioId of scenarioIds) {
    const [view, scenario] = [await computeScenarioView(ctx, scenarioId), await getScenario(ctx, scenarioId)]
    results.push({ scenarioId, name: scenario.name, authorId: scenario.authorId, status: scenario.status as "draft" | "committed", totals: view.totals })
  }
  return results
}

/** Route-level target-seek wiring (10-04): fetches the CURRENT (base) totals
 * and hands them to the pure solver -- never writes, never touches a
 * scenario. */
export async function previewTargetSeekRateForProfit(ctx: ScenarioContext, boqId: string, targetProfitPercent: number): Promise<TargetSeekRateResult> {
  const boq = await getBoq({ orgId: ctx.orgId }, boqId)
  const totals = rollUpRootLines(boq.lineItems)
  return solveRateChangeForTargetProfitPercent(totals, targetProfitPercent)
}

export async function previewTargetSeekQtyForContractValue(ctx: ScenarioContext, boqId: string, targetContractValue: number): Promise<TargetSeekQtyResult> {
  const boq = await getBoq({ orgId: ctx.orgId }, boqId)
  const totals = rollUpRootLines(boq.lineItems)
  return solveQtyReductionForTargetContractValue(totals, targetContractValue)
}

// ─────────────────────────────────────────────────────────────────────────
// 10-09/10-10/10-11/10-12: THE COMMIT PATH
// ─────────────────────────────────────────────────────────────────────────

/**
 * 10-12: `actorKind` is NON-OPTIONAL and has no default -- a caller MUST say
 * which it is. There is no existing "is this caller an AI agent" flag
 * anywhere in this codebase (checked: no AI_AGENT/actorType/isAiActor
 * constant exists under src/lib as of this commit) and no existing marker
 * on the AI/pipeline dispatch path (src/lib/pipeline/executor.ts's
 * ExecutableTask) that distinguishes "this call originated from the AI
 * chat/task layer" from an ordinary authenticated HTTP request -- because
 * that WHOLE MODULE is exclusively the AI/chat-driven path already (every
 * function in its EXECUTORS map, e.g. executeCreateBoqRevision, is reached
 * only via src/lib/pipeline/run-submission.ts's "chat submission -> mint a
 * pipeline_tasks row -> executeTask()" chain -- a human's direct action
 * never runs through executor.ts at all, it hits the ordinary REST route
 * handlers under src/app/api/**). Given that, this file's HTTP routes
 * (src/app/api/v1/projexa/boq-scenarios/**) hard-code `actorKind: "human"`
 * literally in the route handler, never derived from anything in the
 * request -- the only way `"ai_agent"` can ever reach this function is a
 * FUTURE session deliberately wiring a new executor in executor.ts that
 * imports commitScenario and passes `actorKind: "ai_agent"` (which this
 * guard then correctly refuses). TRACED, per this phase's own brief:
 * `git grep -n "boq-scenario-service" src/lib/pipeline src/lib/task-execution`
 * returns zero hits as of this commit -- the pipeline/task-execution layer
 * cannot reach commitScenario at all today, by construction, not merely by
 * policy. This is a real, useful finding (not a gap): the guard exists as
 * defense-in-depth for a future wiring mistake, not because a live path
 * exists today.
 */
export type ScenarioCommitContext = {
  orgId: string
  userId: string
  dbUser: typeof users.$inferSelect
  actorKind: "human" | "ai_agent"
}

export type ScenarioCommitOptions = {
  /** D88: both required together for the CONTRACT side to proceed at all
   * (10-09's second bullet). Neither is required for the cost side (A8:
   * "project side ... freely editable ... NO evidence required") or for an
   * exclude's revision creation (X-24's own bullet is unconditional -- an
   * exclude routes through the revision guards regardless of evidence). */
  evidenceArtefactRef?: string
  reason?: string
  /** Threaded straight through to createBoqRevision's own scope-reduction
   * guard (never re-implemented here, X-27) when an exclude or an evidenced
   * contract change would otherwise be blocked because progress is already
   * recorded against the affected line. */
  allowScopeReductionOverride?: boolean
}

export type ScenarioCostSideResult = { committed: boolean; lineItemIds: string[] }
export type ScenarioContractSideResult =
  | { committed: false; refused: false } // nothing to commit on the contract side
  | { committed: false; refused: true; reason: string; refusedLineItemIds: string[] }
  | { committed: true; revisionBoqId: string; lineItemIds: string[] }

export type ScenarioCommitResult = {
  scenarioId: string
  costSide: ScenarioCostSideResult
  contractSide: ScenarioContractSideResult
}

function hasEvidence(options: ScenarioCommitOptions): boolean {
  return !!(options.evidenceArtefactRef && options.evidenceArtefactRef.trim()) && !!(options.reason && options.reason.trim())
}

/** Same identity key construction-boq-service.ts's own diffLineItems uses
 * (`item.itemCode || item.description`) -- replicated here (not imported;
 * it is a private, unexported helper in that file) purely as an IDENTITY
 * KEY to match a freshly-created revision's line items back to their
 * source line, never as a money computation (X-27 is unaffected -- no
 * figure is derived here, only a lookup key). */
function lineIdentityKey(item: { itemCode: string | null; description: string }): string {
  return item.itemCode || item.description
}

/**
 * 10-09/10-10/10-11/10-12: commit a scenario.
 *
 * ORDER OF OPERATIONS, each its own top-level withTenantContext call (never
 * nested -- see this file's header):
 *   0. actorKind !== "human" -> refused immediately, ZERO database access
 *      (10-12/10-10 "refusals reported BEFORE the transaction").
 *   1. Load the scenario + classify its adjustments (read-only).
 *   2. COST SIDE (10-09 bullet 1 / A8): every line with a project-side
 *      adjustment, OR an exclude (excluding a line is ALSO a real cost-side
 *      fact -- we stop planning to spend on it), gets qtyProject/rateProject
 *      written DIRECTLY onto the scenario's live BOQ -- no evidence
 *      required, matching every other project-side edit in this codebase --
 *      captured via logActivity with source=SCENARIO_COMMIT and this
 *      scenario's id (10-09's literal requirement).
 *   3. CONTRACT SIDE (10-09 bullet 2/3): a contract-side rate/qty adjustment
 *      needs evidenceArtefactRef+reason or it is REFUSED and REPORTED (never
 *      silently dropped) -- the cost side above still commits regardless.
 *      An exclude's CONTRACT impact (qty_contract -> 0, i.e. the actual
 *      scope reduction) is UNCONDITIONAL on evidence (X-24: "excluding a
 *      line is a REVISION. Route through the revision guards.") but is
 *      still gated by createBoqRevision's own scope-reduction guard, which
 *      can itself refuse (ScopeReductionError, propagated unchanged) unless
 *      `allowScopeReductionOverride` is passed. When either an exclude or an
 *      evidenced contract adjustment exists, ONE new BOQ revision is created
 *      via createBoqRevision (X-24, never a bespoke write path), then this
 *      function backfills the new revision's own qtyProject/rateProject/
 *      qtyContract/rateContract (createBoqRevision's insertLineItems does
 *      not know about these four Phase-1 columns at all -- confirmed by
 *      reading it before writing this function -- so they would otherwise
 *      be silently NULL on every newly-created revision, a real, separate,
 *      pre-existing gap in that shared function this phase's declared scope
 *      does not include fixing).
 *   4. Mark the scenario `status: "committed"`.
 *
 * HONEST LIMITATION (10-10's "no partial commit" vs. this multi-step shape):
 * these four steps are NOT one cross-service ACID transaction -- each is
 * independently atomic, matching how createBoqRevision/submitBoq/approveBoq
 * already relate to each other in this codebase (submitBoq and approveBoq
 * are separate top-level calls too, never one transaction). "No partial
 * commit" is enforced at the level this file controls: which lines are
 * ELIGIBLE for each side is decided BEFORE any write (step 1), the refusal
 * a caller sees is computed before any write, and each side's own write is
 * itself all-or-nothing. A process crash between steps 2 and 3 is a real,
 * un-eliminated risk this design shares with the rest of this codebase's
 * multi-step BOQ workflows -- documented rather than silently assumed away.
 */
export async function commitScenario(
  ctx: ScenarioCommitContext,
  scenarioId: string,
  options: ScenarioCommitOptions = {}
): Promise<ScenarioCommitResult> {
  // Step 0 -- 10-12/10-10. Literally the first statement: no import above
  // this point touches the database, and nothing below this check runs
  // until it passes.
  if (ctx.actorKind !== "human") {
    throw new ServiceError(
      "A scenario commit is a FINANCIAL action -- an AI agent may PROPOSE a scenario's adjustments but may NEVER commit one (10-12). Refused before any database access.",
      403,
      { kind: "business", retryable: false }
    )
  }

  // Step 1 -- read-only classification.
  const scenario = await getScenario({ orgId: ctx.orgId }, scenarioId)
  assertMutable(scenario)
  const adjustments = (scenario.adjustments ?? []) as ScenarioAdjustment[]

  const excludeLineIds = new Set(adjustments.filter(isExcludeAdjustment).map((a) => a.lineItemId))
  const projectAdjustmentsByLine = new Map<string, ScenarioLineAdjustment[]>()
  const contractAdjustmentsByLine = new Map<string, ScenarioLineAdjustment[]>()
  for (const a of adjustments) {
    if (!isLineAdjustment(a) || excludeLineIds.has(a.lineItemId)) continue
    const map = a.side === "project" ? projectAdjustmentsByLine : contractAdjustmentsByLine
    const list = map.get(a.lineItemId) ?? []
    list.push(a)
    map.set(a.lineItemId, list)
  }

  const costSideLineIds = new Set<string>([...projectAdjustmentsByLine.keys(), ...excludeLineIds])
  const contractOnlyAdjustLineIds = [...contractAdjustmentsByLine.keys()]
  const evidenced = hasEvidence(options)
  const contractRefused = contractOnlyAdjustLineIds.length > 0 && !evidenced
  const needsRevision = excludeLineIds.size > 0 || (contractOnlyAdjustLineIds.length > 0 && evidenced)

  const liveLines = await withTenantContext({ orgId: ctx.orgId }, (db) =>
    db.query.constructionBoqLineItems.findMany({ where: eq(constructionBoqLineItems.boqId, scenario.boqId) })
  )
  const liveLineById = new Map(liveLines.map((l) => [l.id, l]))

  // Step 2 -- COST SIDE. Standalone transaction; never opens createBoqRevision
  // from inside it.
  const committedCostLineIds: string[] = []
  if (costSideLineIds.size > 0) {
    await withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
      for (const lineItemId of costSideLineIds) {
        const line = liveLineById.get(lineItemId)
        if (!line) continue // defensive -- addAdjustment already validated the line belongs to this BOQ at write time
        const relevantAdjustments: ScenarioAdjustment[] = excludeLineIds.has(lineItemId)
          ? [{ kind: "exclude", lineItemId }]
          : (projectAdjustmentsByLine.get(lineItemId) ?? [])
        const applied = applyAdjustmentsToLine(line, relevantAdjustments)
        const qtyProject = applied.qtyProject === null ? null : String(applied.qtyProject)
        const rateProject = applied.rateProject === null ? null : String(applied.rateProject)
        await db.update(constructionBoqLineItems).set({ qtyProject, rateProject }).where(eq(constructionBoqLineItems.id, lineItemId))
        await logActivity({
          tx: db,
          orgId: ctx.orgId,
          dbUser: ctx.dbUser,
          action: "boq_scenario.cost_side_committed",
          entityType: "construction_boq_line_item",
          entityId: lineItemId,
          details: JSON.stringify({ source: "SCENARIO_COMMIT", scenarioId, qtyProject, rateProject }),
        })
        committedCostLineIds.push(lineItemId)
      }
    })
  }

  // Step 3 -- CONTRACT SIDE.
  let contractSide: ScenarioContractSideResult
  let committedRevisionBoqId: string | null = null
  if (!needsRevision) {
    contractSide = contractRefused
      ? {
          committed: false,
          refused: true,
          reason:
            "Contract-side adjustments require a cited evidence artefact and reason (D88) -- none was supplied. " +
            "The scenario's cost side (if any) was committed above; the contract side is refused and reported here, not silently dropped (10-09/10-10).",
          refusedLineItemIds: contractOnlyAdjustLineIds,
        }
      : { committed: false, refused: false }
  } else {
    // Re-fetch the (now cost-side-updated, if applicable) live BOQ via
    // construction-boq-service.ts's own read path -- standalone top-level
    // call, own transaction.
    const preRevisionBoq = await getBoq({ orgId: ctx.orgId }, scenario.boqId)
    const preRevisionById = new Map(preRevisionBoq.lineItems.map((l) => [l.id, l]))
    const itemCodeById = new Map(preRevisionBoq.lineItems.filter((i) => i.itemCode).map((i) => [i.id, i.itemCode!]))

    const revisionLineItems: BoqLineItemInput[] = preRevisionBoq.lineItems.map((row: BoqLineItemRow) => {
      const input = toLineItemInput(row, itemCodeById)
      if (excludeLineIds.has(row.id)) {
        // X-24: an exclude IS a revision, on the SAME legacy quantity/rate
        // columns createBoqRevision's own scope-reduction guard actually
        // inspects (diffLineItems/findScopeReductionViolations operate on
        // `quantity`/`rate`/`amount`, not the Phase-1 dual-view columns) --
        // without this, "route through the revision guards" would be a
        // no-op, since a pure copy-forward changes nothing those guards can
        // see.
        //
        // KNOWN, DOCUMENTED LIMITATION: when `row` is a SUB-ITEM
        // (parentLineItemId set), construction-boq-service.ts's own
        // deriveLineItemQuantityAndRate canonical rule unconditionally
        // overwrites a child's quantity with QTY_root regardless of what is
        // submitted here -- so this `quantity: 0` is silently ignored for a
        // sub-item exclude and the legacy scope-reduction guard will not see
        // it as a reduction. The step-3b dual-view backfill below still
        // correctly zeroes qtyProject/qtyContract for a sub-item exclude
        // (it writes those columns directly, independent of
        // deriveLineItemQuantityAndRate) -- only the LEGACY quantity/amount
        // and therefore the scope-reduction guard's visibility is affected.
        // Excluding a ROOT line works fully correctly through this path.
        // Not fixed here (construction-boq-service.ts is out of this
        // phase's declared, read-only file scope) -- flagged honestly.
        return { ...input, quantity: 0 }
      }
      const contractAdj = contractAdjustmentsByLine.get(row.id)
      if (evidenced && contractAdj) {
        const applied = applyAdjustmentsToLine(row, contractAdj)
        // Keep the legacy quantity/rate/amount columns consistent with the
        // new authoritative contract-side figures (X-27's "one story" --
        // otherwise this revision would carry two disagreeing contract
        // numbers, exactly the R67 D-62-class bug this whole work order
        // exists to prevent).
        return {
          ...input,
          quantity: applied.qtyContract === null ? input.quantity : Number(applied.qtyContract),
          rate: applied.rateContract === null ? input.rate : Number(applied.rateContract),
        }
      }
      return input
    })

    // Standalone top-level call -- NOT nested inside any withTenantContext
    // this file opened (see header). Can throw ScopeReductionError
    // (a ServiceError subclass) unchanged if progress is already recorded
    // and allowScopeReductionOverride was not passed -- propagated as-is,
    // the same refusal shape the existing revise-BOQ UI already handles.
    const revisionRow = await createBoqRevision(
      { orgId: ctx.orgId, userId: ctx.userId },
      scenario.boqId,
      { lineItems: revisionLineItems, allowScopeReductionOverride: options.allowScopeReductionOverride }
    )
    committedRevisionBoqId = revisionRow.id

    // Step 3b -- backfill the Phase-1 dual-view columns createBoqRevision
    // itself cannot set (confirmed by reading construction-boq-service.ts's
    // BoqLineItemInput/insertLineItems before writing this function: neither
    // carries qtyProject/rateProject/qtyContract/rateContract at all).
    // Matches each NEW line back to its source via the same itemCode-or-
    // description identity key diffLineItems already uses.
    const sourceByKey = new Map(preRevisionBoq.lineItems.map((l) => [lineIdentityKey(l), l]))
    await withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
      for (const newLine of revisionRow.lineItems) {
        const source = sourceByKey.get(lineIdentityKey(newLine))
        if (!source) continue // defensive -- every input line came from preRevisionBoq.lineItems above
        const excluded = excludeLineIds.has(source.id)
        const contractAdj = evidenced ? contractAdjustmentsByLine.get(source.id) : undefined
        const qtyProject = source.qtyProject // already fresh from step 2 if it changed
        const rateProject = source.rateProject
        let qtyContract: string | null = source.qtyContract
        let rateContract: string | null = source.rateContract
        if (excluded) {
          qtyContract = "0"
        } else if (contractAdj) {
          const applied = applyAdjustmentsToLine(source, contractAdj)
          qtyContract = applied.qtyContract === null ? null : String(applied.qtyContract)
          rateContract = applied.rateContract === null ? null : String(applied.rateContract)
        }
        await db
          .update(constructionBoqLineItems)
          .set({ qtyProject, rateProject, qtyContract, rateContract })
          .where(eq(constructionBoqLineItems.id, newLine.id))
      }
    })

    contractSide = contractRefused
      ? {
          // An exclude proceeded (via the revision just created above), but
          // there were ALSO unevidenced plain contract adjustments alongside
          // it -- those are still refused and reported, never silently
          // bundled into the revision that just went through for a
          // different reason.
          committed: false,
          refused: true,
          reason:
            "Contract-side adjustments require a cited evidence artefact and reason (D88) -- none was supplied. " +
            `A revision (${committedRevisionBoqId}) was created for this scenario's excluded line(s); the unevidenced contract adjustments are refused and reported here, not silently dropped.`,
          refusedLineItemIds: contractOnlyAdjustLineIds,
        }
      : { committed: true, revisionBoqId: committedRevisionBoqId, lineItemIds: [...excludeLineIds, ...(evidenced ? contractOnlyAdjustLineIds : [])] }
  }

  // Step 4 -- mark the scenario committed. 10-11: the scenario record itself
  // is the audit trail from here on; it is never mutated again
  // (assertMutable above refuses every write path once status is
  // "committed").
  await withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, (db) =>
    db
      .update(boqScenario)
      .set({ status: "committed", committedAt: new Date(), committedById: ctx.userId, committedRevisionBoqId, updatedAt: new Date() })
      .where(eq(boqScenario.id, scenarioId))
  )

  return {
    scenarioId,
    costSide: { committed: committedCostLineIds.length > 0, lineItemIds: committedCostLineIds },
    contractSide,
  }
}
