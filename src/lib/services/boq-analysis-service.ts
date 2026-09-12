// R85 Addendum 3 v4 (FINAL, supersedes v3/v2/Addendum 2 -- claude_log 379),
// owner rulings D87 (366) D88 (372) D89 (373) D90 (374) D91 (375). PHASE 9
// (Part F, gates 9-01..9-07; use case B3 -- ANALYSIS). Work order: Google
// Drive WORK_ORDER_R85_ADDENDUM_3_v4_R50_FINAL.md, section Part F.
//
// B3, verbatim: "did we make the margin we quoted, and where did it go."
// PER PROJECT: contract at first confirmation vs contract now (variation
// impact); baseline estimated cost vs committed (commitment drift);
// baseline estimated cost vs spent (actual performance); expected profit vs
// actual profit (THE ANSWER). ACROSS PROJECTS: the same columns, one row
// per project, sortable by profit and profit %.
//
// ★ X-27 SINGLE PRODUCER -- THIS FILE COMPUTES NOTHING NEW THAT ANOTHER
// PHASE ALREADY OWNS ★. Every money figure below is read from, or handed
// straight to, one of the four already-merged services this phase was
// scoped to call, never re-derived:
//   - boq-dual-view-service.ts: rollUpRootLines/computeBoqLineMoneyView (via
//     getEstimatedCostFromBaseline below), computeContractVariance,
//     computeGrossNetStack, computeProfitAtBothLevels, NOT_SET.
//   - boq-baseline-service.ts: listBaselineVersions, getEstimatedCostFromBaseline.
//   - boq-contract-value-service.ts: getEffectiveContractValueForProject.
//   - boq-cost-actuals-service.ts: computeCostActuals, computeCostVariance,
//     isCommittedOverBaseline.
// This file's only NEW math is the handful of figures no earlier phase
// defined at all -- the approved-variation count (9-04), the expected-vs-
// actual profit comparison (9-01's "THE ANSWER") and its delta, and the
// cost-variance sign label (9-03) -- each written once, here, as the single
// producer for that specific new figure (X-27 is "don't duplicate an
// existing producer", not "never compute anything new").
//
// ─── WHICH "BOQ" A PROJECT'S BASELINE/VARIATION HISTORY IS READ FROM ──────
// A project can hold more than one constructionBoqs row (independent BOQs,
// e2 E-116; or a revision CHAIN, parentBoqId-linked, each revision its own
// row/id -- see schema.ts's own comment on constructionBoqs.parentBoqId).
// boq-baseline-service.ts's confirmBaseline()/listBaselineVersions() key
// baselines off ONE specific boqId, not a whole project. This file resolves
// "the" BOQ for analysis purposes the SAME way boq-contract-value-service.ts
// already resolves it for the live contract value (X-27 again: reuse
// resolveApprovedBoq's notion of "the BOQ that actually governs
// contract_value" rather than inventing a second one) -- the project's
// current APPROVED revision (highest version among approved rows), via
// getEffectiveContractValueForProject's own boqId/boqVersion return fields.
// A project with no approved BOQ at all has nothing to baseline against
// yet -- every baseline-derived figure below is correctly NOT_SET, not an
// error, matching this project's genuinely normal "not confirmed yet" state
// (same posture getEffectiveContractValueForProject itself already takes).
//
// ─── "CONTRACT NOW" IS THE LIVE FIGURE, NOT THE LAST BASELINE SNAPSHOT ────
// boq-baseline-service.ts's own header is explicit that a baseline is a
// point-in-time snapshot and "THE CONTRACT VALUE MAY STILL CHANGE AFTER
// CONFIRMATION" without a new baseline necessarily being taken (3-03: baselining
// is an explicit act, never automatic). Reading "contract now" off the LAST
// baseline snapshot would therefore silently go stale the moment a BOQ line
// or the manual override changes without a fresh confirmation. "Contract
// now" here is therefore getEffectiveContractValueForProject(...).value --
// the SAME live figure every other screen in this codebase already shows as
// "the current contract value" (X-27: one producer for that notion too).
// "Contract at first confirmation" (9-01) IS read from a baseline
// specifically -- version 1, the very first one ever confirmed for this
// project's governing BOQ -- because that figure is BY DEFINITION a
// snapshot: what the contract was worth at the moment it was first locked
// in, not a live number.
//
// ─── ZERO BASELINES EXIST IN PRODUCTION TODAY, AND THAT IS EXPECTED ───────
// `git grep -rn "confirmBaseline("` across src/app finds no caller: Phase 3
// shipped the service but no route ever wires a "confirm baseline" button
// to it. Every baseline-derived field on a real project today will
// therefore genuinely be NOT_SET until that route exists and someone
// confirms a baseline -- correct per X-04, not a bug in this file.
//
// ─── EXPECTED PROFIT vs ACTUAL PROFIT (9-01's "THE ANSWER") ───────────────
// These two figures are DELIBERATELY not computed the same way, because the
// data available for each side is genuinely different, and pretending
// otherwise would fabricate history:
//   EXPECTED PROFIT is the margin already implied by the first-confirmed
//   baseline snapshot itself -- rollUpRootLines' own `variance` field
//   (contractValue - projectValue) on that ONE snapshot, surfaced here via
//   getEstimatedCostFromBaseline(firstBaseline).variance. No VAT/retention
//   decomposition is applied: those rates are NOT captured on a baseline
//   snapshot (they live on `projects`, a live, mutable, unversioned pair of
//   columns -- see boq-dual-view-service.ts's Phase 4 header), so there is
//   no historically-accurate VAT/retention rate to apply retroactively to a
//   confirmation that may be months old. Presenting a fabricated "what the
//   VAT rate probably was back then" figure would be exactly the kind of
//   confidently-wrong number X-04 exists to prevent -- so expected profit
//   is reported at the plain contract-vs-cost level only.
//   ACTUAL PROFIT uses the FULL, both-levels Phase 4 treatment
//   (computeGrossNetStack + computeProfitAtBothLevels, C-8: always both
//   gross and net-receivable, no toggle) against the LIVE contract value and
//   the project's CURRENT vatRatePercent/retentionPercent -- because today,
//   right now, those are real, known figures, and SPENT cost (not
//   committed): "actual profit" is asking what money has really moved, and
//   an unpaid PO commitment is not yet a cost that has actually reduced
//   profit, only one that eventually will (that distinction is the whole
//   point of A5 keeping committed and spent as two separate figures).
// profitVsExpectedDelta then compares like-for-like: actual profit ON GROSS
// vs the expected (gross-only) figure -- "did we make the margin we quoted,
// and by how much did we miss or beat it."
import { and, eq, inArray } from "drizzle-orm"
import { constructionBoqs, projects } from "@/lib/db"
import { withTenantContext, type TenantDb } from "@/lib/db/tenant-scoped"
import {
  NOT_SET,
  type MoneyFigure,
  computeContractVariance,
  computeGrossNetStack,
  computeProfitAtBothLevels,
  type ProfitAtBothLevels,
} from "./boq-dual-view-service"
import { listBaselineVersions, getEstimatedCostFromBaseline, type BoqBaseline } from "./boq-baseline-service"
import { getEffectiveContractValueForProject } from "./boq-contract-value-service"
import { computeCostActuals, computeCostVariance, isCommittedOverBaseline, type CostVarianceResult } from "./boq-cost-actuals-service"

export type AnalysisContext = { orgId: string }

/**
 * 9-03: "cost variance shown with its sign AND its meaning" -- a plain
 * number's sign is easy to misread backwards (is a positive committed-vs-
 * baseline variance good or bad?), so this is the single place that turns
 * computeCostVariance's `baselineEstimatedCost - actual` sign into an
 * unambiguous label. NOT_SET on either side -> "unknown", never a guess.
 */
export type CostVarianceSign = "under_baseline" | "over_baseline" | "on_baseline" | "unknown"

export function describeCostVarianceSign(result: Pick<CostVarianceResult, "variance">): CostVarianceSign {
  if (result.variance === NOT_SET) return "unknown"
  if (result.variance > 0) return "under_baseline" // actual < baseline: spent/committed less than estimated
  if (result.variance < 0) return "over_baseline" // actual > baseline: spent/committed more than estimated
  return "on_baseline"
}

// NOT_SET-safe subtraction, the same trivial idiom every other Phase in
// this spec already writes locally rather than importing (see
// boq-baseline-service.ts's own subtractMoneyFigures, boq-cost-actuals-
// service.ts's computeCostVariance) -- this is not a figure any earlier
// phase produces, so defining it here IS this file being the single
// producer for it, not a violation of X-27.
function subtractMoneyFigures(minuend: MoneyFigure, subtrahend: MoneyFigure): MoneyFigure {
  if (minuend === NOT_SET || subtrahend === NOT_SET) return NOT_SET
  return minuend - subtrahend
}

export type ProjectAnalysisRow = {
  projectId: string
  projectName: string
  /** The specific BOQ revision this row's baseline/variation history is read
   * from -- null when the project has no approved BOQ at all yet. */
  boqId: string | null
  boqVersion: number | null
  /** Whether ANY baseline has ever been confirmed for this BOQ -- lets a
   * caller distinguish "every baseline figure below is NOT_SET because
   * nothing has been confirmed yet" from a genuine zero (X-04). */
  hasBaseline: boolean

  // ── 9-01/9-04: contract at first confirmation vs contract now ─────────
  contractAtFirstConfirmation: MoneyFigure
  contractValueNow: MoneyFigure
  /** "computed" (the rolled-up BOQ total) or "override" (a manual Phase 4
   * override is in force) -- passed straight through from
   * getEffectiveContractValueForProject, never re-derived (X-27). */
  contractValueSource: "computed" | "override"
  /** contractValueNow - contractAtFirstConfirmation. The "variation impact" figure. */
  contractVariance: MoneyFigure
  /** 9-04: count of this BOQ's own approved revisions that are themselves a
   * variation (parentBoqId set) -- the original approved BOQ (no parent) is
   * the contract itself, not a variation on top of it. */
  approvedVariationCount: number

  // ── 9-01: baseline estimated cost vs committed vs spent ────────────────
  baselineEstimatedCost: MoneyFigure
  committed: MoneyFigure
  spent: MoneyFigure
  /** baseline estimated cost vs committed -- "commitment drift". */
  commitmentDrift: CostVarianceResult
  commitmentDriftSign: CostVarianceSign
  /** baseline estimated cost vs spent -- "actual performance". */
  costPerformance: CostVarianceResult
  costPerformanceSign: CostVarianceSign
  isCommittedOverBaseline: boolean

  // ── 9-01: expected profit vs actual profit -- THE ANSWER ───────────────
  /** Plain contract-vs-cost margin implied by the FIRST confirmed baseline
   * snapshot -- see this file's header for why no VAT/retention split is
   * applied here. */
  expectedProfitGross: MoneyFigure
  /** Full Phase 4 both-levels profit against the LIVE contract value and
   * SPENT cost (C-8: gross and net-receivable both always shown). */
  actualProfit: ProfitAtBothLevels
  /** actualProfit.profitOnGross - expectedProfitGross: did we make (positive)
   * or fall short of (negative) the margin we originally quoted. */
  profitVsExpectedDelta: MoneyFigure
}

async function fetchProjectBoqsWithDb(db: TenantDb, orgId: string, projectId: string) {
  return db.query.constructionBoqs.findMany({
    where: and(eq(constructionBoqs.orgId, orgId), eq(constructionBoqs.projectId, projectId)),
  })
}

/**
 * ONE project's full analysis row. Deliberately orchestrates several
 * INDEPENDENT top-level service calls rather than one shared transaction --
 * getEffectiveContractValueForProject/computeCostActuals/listBaselineVersions
 * each already open their own withTenantContext (declared out of this
 * phase's scope: boq-contract-value-service.ts, boq-cost-actuals-service.ts
 * and boq-baseline-service.ts are all "read-only, call their exports", none
 * of the three exposes a *WithDb sibling this file could thread a shared
 * handle through). Calling them SEQUENTIALLY/independently rather than
 * nesting a new withTenantContext of this file's own around them is exactly
 * the avoidance this codebase's own nested-withTenantContext gotcha (see
 * CLAUDE.md's R74/R75 notes) requires -- nesting would throw
 * assertNotNested() in dev/test and silently double a pooled connection in
 * production.
 */
export async function getProjectAnalysis(ctx: AnalysisContext, projectId: string): Promise<ProjectAnalysisRow> {
  const [effective, actuals, projectRow, boqs] = await Promise.all([
    getEffectiveContractValueForProject({ orgId: ctx.orgId }, projectId),
    computeCostActuals({ orgId: ctx.orgId }, projectId),
    withTenantContext({ orgId: ctx.orgId }, (db) =>
      db.query.projects.findFirst({ where: and(eq(projects.id, projectId), eq(projects.orgId, ctx.orgId)) })
    ),
    withTenantContext({ orgId: ctx.orgId }, (db) => fetchProjectBoqsWithDb(db, ctx.orgId, projectId)),
  ])

  const approvedVariationCount = boqs.filter((b) => b.status === "approved" && b.parentBoqId !== null).length

  // Baselines are read as a SEPARATE, later top-level call (not part of the
  // Promise.all above) because it depends on `effective.boqId`, which that
  // same batch produces -- see this function's own header on why none of
  // these calls nest inside one another.
  let baselines: BoqBaseline[] = []
  if (effective.boqId) {
    baselines = await listBaselineVersions({ orgId: ctx.orgId }, effective.boqId)
  }

  const firstBaseline = baselines.find((b) => b.version === 1) ?? null
  const latestBaseline = baselines.length > 0 ? baselines[baselines.length - 1]! : null

  const firstTotals = firstBaseline ? getEstimatedCostFromBaseline(firstBaseline) : null
  const latestTotals = latestBaseline ? getEstimatedCostFromBaseline(latestBaseline) : null

  const contractAtFirstConfirmation: MoneyFigure = firstTotals ? firstTotals.contractValue : NOT_SET
  const baselineEstimatedCost: MoneyFigure = latestTotals ? latestTotals.projectValue : NOT_SET
  const expectedProfitGross: MoneyFigure = firstTotals ? firstTotals.variance : NOT_SET

  const contractValueNow = effective.value
  const contractVariance = computeContractVariance(contractAtFirstConfirmation, contractValueNow)

  const commitmentDrift = computeCostVariance(baselineEstimatedCost, actuals.committed, "committed")
  const costPerformance = computeCostVariance(baselineEstimatedCost, actuals.spent, "spent")

  const vatRatePercent = projectRow?.vatRatePercent ?? null
  const retentionPercent = projectRow?.retentionPercent ?? null
  const stackNow = computeGrossNetStack(contractValueNow, vatRatePercent, retentionPercent)
  const actualProfit = computeProfitAtBothLevels(stackNow, actuals.spent)

  return {
    projectId,
    projectName: projectRow?.name ?? "",
    boqId: effective.boqId,
    boqVersion: effective.boqVersion,
    hasBaseline: baselines.length > 0,

    contractAtFirstConfirmation,
    contractValueNow,
    contractValueSource: effective.source,
    contractVariance,
    approvedVariationCount,

    baselineEstimatedCost,
    committed: actuals.committed,
    spent: actuals.spent,
    commitmentDrift,
    commitmentDriftSign: describeCostVarianceSign(commitmentDrift),
    costPerformance,
    costPerformanceSign: describeCostVarianceSign(costPerformance),
    isCommittedOverBaseline: isCommittedOverBaseline(baselineEstimatedCost, actuals.committed),

    expectedProfitGross,
    actualProfit,
    profitVsExpectedDelta: subtractMoneyFigures(actualProfit.profitOnGross, expectedProfitGross),
  }
}

/** Every project id (+ name) this org has raised at least one BOQ against --
 * the population for the 9-02 cross-project view. A project with no BOQ at
 * all has nothing this screen can say about it, so it is correctly excluded
 * rather than shown as a row of NOT_SET. */
async function listOrgProjectsWithBoq(ctx: AnalysisContext): Promise<{ id: string; name: string }[]> {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const boqProjectRows = await db
      .selectDistinct({ projectId: constructionBoqs.projectId })
      .from(constructionBoqs)
      .where(eq(constructionBoqs.orgId, ctx.orgId))
    const ids = boqProjectRows.map((r) => r.projectId)
    if (ids.length === 0) return []
    const projectRows = await db.query.projects.findMany({
      where: and(eq(projects.orgId, ctx.orgId), inArray(projects.id, ids)),
    })
    return projectRows.map((p) => ({ id: p.id, name: p.name }))
  })
}

/**
 * 9-02: one row per project, same columns as getProjectAnalysis. Processed
 * SEQUENTIALLY, not Promise.all -- each row already fans out to 3-4
 * independent top-level withTenantContext calls of its own (see
 * getProjectAnalysis's header); running N of those concurrently would put
 * up to ~4N connections against this codebase's 5-connection pool at once,
 * exactly the real, documented pool-contention risk CLAUDE.md's R52/R75
 * notes describe for a Promise.all fan-out of transaction-opening calls.
 * Sequential trades some latency for never contending the pool -- correct
 * for a report endpoint with no interactive per-keystroke latency budget.
 */
export async function listOrgAnalysis(ctx: AnalysisContext): Promise<ProjectAnalysisRow[]> {
  const stubs = await listOrgProjectsWithBoq(ctx)
  const rows: ProjectAnalysisRow[] = []
  for (const stub of stubs) {
    rows.push(await getProjectAnalysis(ctx, stub.id))
  }
  return rows
}

// ─────────────────────────────────────────────────────────────────────────
// 9-02: "sortable by profit and profit %". NOT_SET always sorts LAST
// regardless of direction, matching boq-dual-view-service.ts's own
// compareBoqLinesBySortKey convention (2-07: burying a known-bad performer
// under a pile of unknowns would defeat the point of the sort).
// ─────────────────────────────────────────────────────────────────────────
export type AnalysisSortKey = "profitOnGross" | "profitOnGrossPercent" | "profitOnNetReceivable" | "profitOnNetReceivablePercent"

export function compareAnalysisRowsBySortKey(key: AnalysisSortKey, direction: "asc" | "desc" = "desc") {
  return (a: ProjectAnalysisRow, b: ProjectAnalysisRow): number => {
    const va = a.actualProfit[key]
    const vb = b.actualProfit[key]
    if (va === NOT_SET && vb === NOT_SET) return 0
    if (va === NOT_SET) return 1
    if (vb === NOT_SET) return -1
    return direction === "asc" ? va - vb : vb - va
  }
}

export function sortAnalysisRows(rows: ProjectAnalysisRow[], key: AnalysisSortKey, direction: "asc" | "desc" = "desc"): ProjectAnalysisRow[] {
  return [...rows].sort(compareAnalysisRowsBySortKey(key, direction))
}
