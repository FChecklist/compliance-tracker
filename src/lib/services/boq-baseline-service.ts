// R85 Addendum 3 v4, Phase 3 -- BASELINES (E2 "the versioned baseline, not a
// freeze"). Owner rulings D87 (claude_log 366), D88 (372), D89 (373), D90
// (374), D91 (375). Work order: Google Drive
// WORK_ORDER_R85_ADDENDUM_3_v4_R50_FINAL.md, section E2/Phase 3, gates
// 3-01..3-09. Builds on top of boq-dual-view-service.ts and NEVER duplicates
// its math (X-27 single-producer rule) -- every money figure this file
// returns comes from computeBoqLineMoneyView/rollUpRootLines/
// computeCostCoverage run over a FROZEN snapshot, never recomputed here.
//
// THE CORE RULE (D91 Q5, E2, owner's own words: "the end user will say the
// contract value is live and will confirm, it can change the contract
// value"): confirming a baseline is an explicit user act (3-02 -- never
// automatic from a PO, a status change or an invoice) that snapshots every
// line's four dual-view columns. THE CONTRACT VALUE MAY STILL CHANGE AFTER
// CONFIRMATION -- prior versions are NEVER overwritten or deleted (3-03);
// each confirmation creates the NEXT sequential version for that BOQ.
// rate_project as it stood at each confirmation IS the estimated cost for
// every later comparison (A5) -- getEstimatedCostFromBaseline() below reads
// ONLY the frozen snapshot already carried on the baseline row, never the
// live constructionBoqLineItems rows, which is what makes it immune to any
// edit made to rate_project after that baseline was confirmed (3-09, the
// single most important test in this phase, per the work order itself).
//
// SUPERSEDED DESIGNS THIS FILE DELIBERATELY DOES NOT BUILD (A9, X-07): a
// hard freeze at confirmation. This is a VERSIONED BASELINE -- a variation
// is simply the next baseline version, never a locked/immutable contract
// value.
import { boqBaseline, constructionBoqs, constructionBoqLineItems } from "@/lib/db"
import { withTenantContext, type TenantDb } from "@/lib/db/tenant-scoped"
import { eq } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError }
import {
  computeBoqLineMoneyView,
  rollUpRootLines,
  NOT_SET,
  type MoneyFigure,
  type BoqLineForRollup,
  type BoqLineMoneyView,
  type BoqRollupTotals,
} from "./boq-dual-view-service"

export type BaselineContext = { orgId: string; userId: string }
export type BaselineReadContext = { orgId: string }

/**
 * One BOQ line's four dual-view columns, frozen at confirmation time.
 * Deliberately shaped as `{ lineItemId } & BoqLineForRollup` -- an EXACT
 * superset of boq-dual-view-service.ts's BoqLineForRollup (parentLineItemId
 * + the four qty/rate columns) -- so rollUpRootLines()/computeCostCoverage()
 * run directly against a baseline's lineSnapshot array with no adapter. The
 * single-producer rule (X-27) applies to a frozen snapshot exactly as it
 * does to live lines.
 */
export type BoqBaselineLineSnapshot = { lineItemId: string } & BoqLineForRollup

export type BoqBaseline = {
  id: string
  boqId: string
  version: number
  confirmedById: string
  confirmedAt: Date
  evidenceArtefactRef: string
  lineSnapshot: BoqBaselineLineSnapshot[]
  createdAt: Date
}

// ─── 3-07: evidence is a real, checkable property, not an assumption ──────
//
// confirmBaseline()'s own guard (3-04) should make an unevidenced row
// unreachable in practice, but the work order explicitly asks for a
// defensive check/type independent of that guard -- so a caller reading a
// baseline row from any future code path (a raw query, a data-repair script,
// a future bulk-import) can still tell evidenced from unevidenced instead of
// silently trusting evidenceArtefactRef the way X-09 forbids.
export const UNEVIDENCED = "UNEVIDENCED" as const

export function isBaselineEvidenced(baseline: Pick<BoqBaseline, "evidenceArtefactRef">): boolean {
  return typeof baseline.evidenceArtefactRef === "string" && baseline.evidenceArtefactRef.trim().length > 0
}

/** Renders exactly like NOT_SET (C-5): the literal sentinel string, never a
 * value the caller can mistake for real evidence, never blank. */
export function getEvidenceArtefactRefOrUnevidenced(
  baseline: Pick<BoqBaseline, "evidenceArtefactRef">
): string | typeof UNEVIDENCED {
  return isBaselineEvidenced(baseline) ? baseline.evidenceArtefactRef : UNEVIDENCED
}

function toBaseline(row: {
  id: string
  boqId: string
  version: number
  confirmedById: string
  confirmedAt: Date
  evidenceArtefactRef: string
  lineSnapshot: unknown
  createdAt: Date
}): BoqBaseline {
  return {
    id: row.id,
    boqId: row.boqId,
    version: row.version,
    confirmedById: row.confirmedById,
    confirmedAt: row.confirmedAt,
    evidenceArtefactRef: row.evidenceArtefactRef,
    lineSnapshot: (row.lineSnapshot ?? []) as BoqBaselineLineSnapshot[],
    createdAt: row.createdAt,
  }
}

/**
 * 3-02/3-03/3-04: confirmBaseline is the ONLY code path in this codebase
 * that creates a boq_baseline row -- an explicit call a route makes off a
 * real user action (a button), never a side effect of a PO, a status
 * change, an invoice, or any other write. `git grep -n "insert(boqBaseline)"`
 * must return exactly this one call site.
 */
export async function confirmBaseline(
  ctx: BaselineContext,
  boqId: string,
  evidenceArtefactRef: string
): Promise<BoqBaseline> {
  // 3-04: REQUIRES a non-empty evidence artefact citation (D88: PO,
  // proforma, agreed proposal, term sheet, proposal sent, agreement, email,
  // or explicit written confirmation). Deliberately does NOT attempt to
  // classify which of those it is -- only that a real citation was given,
  // matching the task's own instruction.
  if (typeof evidenceArtefactRef !== "string" || evidenceArtefactRef.trim().length === 0) {
    throw new ServiceError(
      "confirmBaseline requires a non-empty evidenceArtefactRef -- a PO, proforma, agreed proposal, term sheet, proposal sent, agreement, email, or explicit written confirmation (D88).",
      400
    )
  }

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const boq = await db.query.constructionBoqs.findFirst({ where: eq(constructionBoqs.id, boqId) })
    if (!boq) throw new ServiceError(`BOQ ${boqId} not found`, 404)

    const lines = await db.query.constructionBoqLineItems.findMany({
      where: eq(constructionBoqLineItems.boqId, boqId),
    })

    const lineSnapshot: BoqBaselineLineSnapshot[] = lines.map((line) => ({
      lineItemId: line.id,
      parentLineItemId: line.parentLineItemId,
      qtyProject: line.qtyProject,
      rateProject: line.rateProject,
      qtyContract: line.qtyContract,
      rateContract: line.rateContract,
    }))

    // 3-03: the NEXT sequential version for this BOQ. A pure read-then-
    // insert -- prior versions are never touched, never updated, never
    // deleted (also enforced at the DB layer, drizzle/0594 REVOKEs
    // UPDATE/DELETE on this table from app_runtime and service_role).
    // Reads every existing version for this BOQ (typically a handful, never
    // a large table) and takes the max in JS, rather than an ORDER BY
    // DESC LIMIT 1 query -- deliberately, so the one query shape
    // (findMany by boqId) is shared with listBaselineVersionsWithDb/
    // getBaselineVersionWithDb below instead of a second, subtly different
    // query against the same table.
    const existingVersions = await listBaselineVersionsWithDb(db, boqId)
    const nextVersion = existingVersions.reduce((max, b) => Math.max(max, b.version), 0) + 1

    const [inserted] = await db
      .insert(boqBaseline)
      .values({
        orgId: ctx.orgId,
        boqId,
        version: nextVersion,
        confirmedById: ctx.userId,
        evidenceArtefactRef: evidenceArtefactRef.trim(),
        lineSnapshot,
      })
      .returning()

    return toBaseline(inserted)
  })
}

// Shared read: every confirmed baseline row for one BOQ, ascending by
// version. Both getBaselineVersionWithDb and confirmBaseline's next-version
// computation build on this ONE query shape rather than each rolling their
// own filtered/ordered variant against the same table.
//
// Exported (R85 Addendum 3 v4 Phase 7, D89, additive -- no existing caller or
// behaviour changes): boq-excel-roundtrip-service.ts's post-confirmation
// contract-edit evidence gate needs to know whether a BOQ has ANY confirmed
// baseline from inside its own already-open withTenantContext transaction
// (its diff/apply functions already hold a db handle) -- calling the
// top-level listBaselineVersions() there would open a SECOND, nested
// transaction, exactly the real R74/R75 assertNotNested() gotcha this
// codebase's own CLAUDE.md documents. Same *WithDb reuse pattern as
// isBranchEnabledForOrgWithDb/computeUserChainUsageScoresWithDb.
export async function listBaselineVersionsWithDb(db: TenantDb, boqId: string): Promise<BoqBaseline[]> {
  const rows = await db.query.boqBaseline.findMany({ where: eq(boqBaseline.boqId, boqId) })
  return rows.map(toBaseline).sort((a, b) => a.version - b.version)
}

async function getBaselineVersionWithDb(db: TenantDb, boqId: string, version: number): Promise<BoqBaseline> {
  const rows = await listBaselineVersionsWithDb(db, boqId)
  const row = rows.find((r) => r.version === version)
  if (!row) throw new ServiceError(`Baseline version ${version} not found for BOQ ${boqId}`, 404)
  return row
}

/** Re-fetches ONE confirmed baseline by its version number. This is the
 * function 3-09's test uses to prove a live edit after confirmation never
 * moves what an already-taken baseline reports. */
export async function getBaselineVersion(ctx: BaselineReadContext, boqId: string, version: number): Promise<BoqBaseline> {
  return withTenantContext({ orgId: ctx.orgId }, (db) => getBaselineVersionWithDb(db, boqId, version))
}

export async function listBaselineVersions(ctx: BaselineReadContext, boqId: string): Promise<BoqBaseline[]> {
  return withTenantContext({ orgId: ctx.orgId }, (db) => listBaselineVersionsWithDb(db, boqId))
}

/**
 * A5/3-09: "THE BASELINE SNAPSHOT captures rate_project AS IT STOOD at each
 * confirmation. That frozen snapshot is the ESTIMATED cost for comparison."
 * Reads ONLY the snapshot already carried on `baseline` -- never queries
 * constructionBoqLineItems -- which is precisely what makes this figure
 * immune to any edit made to the live rate_project after confirmation.
 * Uses rollUpRootLines() (X-27: single producer, root-lines-only per R-32),
 * never a second copy of the roll-up math.
 */
export function getEstimatedCostFromBaseline(baseline: Pick<BoqBaseline, "lineSnapshot">): BoqRollupTotals {
  return rollUpRootLines(baseline.lineSnapshot)
}

export type BoqBaselineLineDelta = {
  lineItemId: string
  a: BoqLineMoneyView
  b: BoqLineMoneyView
  projectValueDelta: MoneyFigure
  contractValueDelta: MoneyFigure
  varianceDelta: MoneyFigure
}

export type BoqBaselineCompareResult = {
  versionA: number
  versionB: number
  lines: BoqBaselineLineDelta[]
  totals: {
    a: BoqRollupTotals
    b: BoqRollupTotals
    projectValueDelta: MoneyFigure
    contractValueDelta: MoneyFigure
  }
}

// NULL propagation for a delta (X-04): if either side is NOT_SET, the delta
// is NOT_SET too -- never a false 0 standing in for "one side is unknown".
function subtractMoneyFigures(a: MoneyFigure, b: MoneyFigure): MoneyFigure {
  if (a === NOT_SET || b === NOT_SET) return NOT_SET
  return b - a
}

// A line present in only one of the two compared snapshots (added/removed
// between confirmations) is treated as all-absent on the missing side, so
// computeBoqLineMoneyView resolves it to NOT_SET on that side rather than a
// false 0 or a lookup crash (X-04).
const EMPTY_LINE_INPUT: BoqLineForRollup = {
  parentLineItemId: null,
  qtyProject: null,
  rateProject: null,
  qtyContract: null,
  rateContract: null,
}

/**
 * 3-08: line-by-line delta (via computeBoqLineMoneyView, X-27) plus totals
 * (via rollUpRootLines, same rule) between any two confirmed baseline
 * versions for a BOQ. Deltas are always "versionB minus versionA" -- the
 * change moving FROM A TO B.
 *
 * Both baseline rows are fetched inside ONE withTenantContext transaction
 * (getBaselineVersionWithDb, not two separate top-level calls) -- matching
 * this codebase's established *WithDb pattern for avoiding the
 * Promise.all-of-several-withTenantContext-calls pool-contention gotcha
 * (see CLAUDE.md's R74/R75 nested-withTenantContext notes).
 */
export async function compareBaselines(
  ctx: BaselineReadContext,
  boqId: string,
  versionA: number,
  versionB: number
): Promise<BoqBaselineCompareResult> {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const baselineA = await getBaselineVersionWithDb(db, boqId, versionA)
    const baselineB = await getBaselineVersionWithDb(db, boqId, versionB)

    const byIdA = new Map(baselineA.lineSnapshot.map((l) => [l.lineItemId, l] as const))
    const byIdB = new Map(baselineB.lineSnapshot.map((l) => [l.lineItemId, l] as const))
    const allLineItemIds = new Set([...byIdA.keys(), ...byIdB.keys()])

    const lines: BoqBaselineLineDelta[] = [...allLineItemIds].map((lineItemId) => {
      const inputA = byIdA.get(lineItemId) ?? EMPTY_LINE_INPUT
      const inputB = byIdB.get(lineItemId) ?? EMPTY_LINE_INPUT
      const a = computeBoqLineMoneyView(inputA)
      const b = computeBoqLineMoneyView(inputB)
      return {
        lineItemId,
        a,
        b,
        projectValueDelta: subtractMoneyFigures(a.projectValue, b.projectValue),
        contractValueDelta: subtractMoneyFigures(a.contractValue, b.contractValue),
        varianceDelta: subtractMoneyFigures(a.variance, b.variance),
      }
    })

    const totalsA = rollUpRootLines(baselineA.lineSnapshot)
    const totalsB = rollUpRootLines(baselineB.lineSnapshot)

    return {
      versionA,
      versionB,
      lines,
      totals: {
        a: totalsA,
        b: totalsB,
        projectValueDelta: subtractMoneyFigures(totalsA.projectValue, totalsB.projectValue),
        contractValueDelta: subtractMoneyFigures(totalsA.contractValue, totalsB.contractValue),
      },
    }
  })
}
