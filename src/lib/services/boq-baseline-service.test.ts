// R85 Addendum 3 v4, Phase 3 -- BASELINES. Gates 3-02/3-03/3-04/3-07/3-08/
// 3-09 (work order WORK_ORDER_R85_ADDENDUM_3_v4_R50_FINAL.md, section E2/
// Phase 3). Real, committed, re-runnable proofs -- matching this codebase's
// bar (R74-RULING-03): each test exercises the real service function, not an
// ad-hoc script, and 3-09 in particular was verified to go RED under a
// planted defect and GREEN again after reverting it (see the PR description
// for the verbatim before/after).
import { afterEach, describe, expect, mock, test } from "bun:test"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import * as realTenantScoped from "@/lib/db/tenant-scoped"
import {
  getEstimatedCostFromBaseline,
  getEvidenceArtefactRefOrUnevidenced,
  isBaselineEvidenced,
  UNEVIDENCED,
  type BoqBaseline,
  type BoqBaselineLineSnapshot,
} from "./boq-baseline-service"

afterEach(async () => {
  mock.restore()
  await mock.module("@/lib/db/tenant-scoped", () => realTenantScoped)
})

// ─── 3-07: evidence is a real, checkable property ──────────────────────────
describe("isBaselineEvidenced / getEvidenceArtefactRefOrUnevidenced -- 3-07", () => {
  test("a real citation is evidenced", () => {
    const baseline = { evidenceArtefactRef: "PO-2026-0447" }
    expect(isBaselineEvidenced(baseline)).toBe(true)
    expect(getEvidenceArtefactRefOrUnevidenced(baseline)).toBe("PO-2026-0447")
  })

  test("empty string, whitespace-only, or a non-string value are all UNEVIDENCED -- never trusted as real evidence", () => {
    for (const bad of ["", "   ", null, undefined] as unknown as string[]) {
      const baseline = { evidenceArtefactRef: bad }
      expect(isBaselineEvidenced(baseline)).toBe(false)
      expect(getEvidenceArtefactRefOrUnevidenced(baseline)).toBe(UNEVIDENCED)
    }
  })

  test("UNEVIDENCED renders as the literal string, matching the NOT_SET convention (C-5) -- never 0, never blank", () => {
    expect(UNEVIDENCED).toBe("UNEVIDENCED")
  })
})

// ─── A5/3-09 (pure half): getEstimatedCostFromBaseline reads ONLY the
// snapshot passed to it, via rollUpRootLines (X-27 single producer) ────────
describe("getEstimatedCostFromBaseline -- A5, single producer via rollUpRootLines", () => {
  test("roots-only project value from a snapshot, sub-tasks excluded (R-32 applies to snapshots too)", () => {
    const lineSnapshot: BoqBaselineLineSnapshot[] = [
      { lineItemId: "root-1", parentLineItemId: null, qtyProject: 100, rateProject: 40, qtyContract: 100, rateContract: 50 },
      { lineItemId: "sub-1", parentLineItemId: "root-1", qtyProject: 100, rateProject: 16, qtyContract: 100, rateContract: 20 },
    ]
    const totals = getEstimatedCostFromBaseline({ lineSnapshot })
    expect(totals.projectValue).toBe(4000) // root-1 only: 100*40, sub-1 excluded
    expect(totals.rootLineCount).toBe(1)
  })
})

// ─── 3-02 (codebase-wide, structural): confirmBaseline is the ONLY place
// that ever inserts into boq_baseline anywhere in this repo's source tree.
// A mock-based check can only prove this WITHIN this file's own read
// functions (see below); this proves it across the whole src/ tree. ───────
describe("3-02: confirmBaseline is the ONLY write path to boq_baseline in this codebase", () => {
  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry === ".next" || entry.startsWith(".")) continue
      const full = join(dir, entry)
      const st = statSync(full)
      if (st.isDirectory()) walk(full, out)
      else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) out.push(full)
    }
    return out
  }

  test('exactly one file under src/ contains "insert(boqBaseline)", and it is this service', () => {
    const srcRoot = join(import.meta.dir, "..", "..") // src/lib/services -> src/lib -> src
    const files = walk(srcRoot)
    const hits = files.filter((f) => readFileSync(f, "utf8").includes("insert(boqBaseline)"))
    const relHits = hits.map((f) => f.replace(/\\/g, "/"))
    expect(relHits.length).toBe(1)
    expect(relHits[0]).toContain("boq-baseline-service.ts")
  })
})

// ─── DB-backed suite: confirmBaseline / getBaselineVersion / listBaselineVersions / compareBaselines ──
type FakeLineRow = {
  id: string
  parentLineItemId: string | null
  qtyProject: string | null
  rateProject: string | null
  qtyContract: string | null
  rateContract: string | null
}

function mountFakeDb(lineRows: FakeLineRow[], boqRow: { id: string; orgId: string } | null = { id: "boq-1", orgId: "org-1" }) {
  const baselineRows: Array<Record<string, unknown>> = []
  let nextId = 1
  const insertMock = mock((_table: unknown) => ({
    values: (values: Record<string, unknown>) => ({
      returning: async () => {
        const row = { id: `baseline-${nextId++}`, confirmedAt: new Date(), createdAt: new Date(), ...values }
        baselineRows.push(row)
        return [{ ...row }]
      },
    }),
  }))
  const fakeDb = {
    query: {
      constructionBoqs: { findFirst: mock(async () => boqRow) },
      constructionBoqLineItems: { findMany: mock(async () => lineRows) },
      boqBaseline: { findMany: mock(async () => baselineRows.map((r) => ({ ...r }))) },
    },
    insert: insertMock,
  }
  return { fakeDb, lineRows, baselineRows, insertMock }
}

async function mountAndImport(lineRows: FakeLineRow[], boqRow?: { id: string; orgId: string } | null) {
  const mounted = mountFakeDb(lineRows, boqRow)
  await mock.module("@/lib/db/tenant-scoped", () => ({
    ...realTenantScoped,
    withTenantContext: mock(async (_ctx: { orgId: string; userId?: string }, fn: (db: unknown) => Promise<unknown>) => fn(mounted.fakeDb)),
  }))
  const svc = await import("./boq-baseline-service")
  return { ...mounted, svc }
}

const ctx = { orgId: "org-1", userId: "user-1" }

describe("confirmBaseline -- 3-04 requires a non-empty evidenceArtefactRef", () => {
  test.each([
    ["missing (undefined)", undefined as unknown as string],
    ["empty string", ""],
    ["whitespace only", "   "],
  ])("%s is refused with a 400 ServiceError and nothing is inserted", async (_label, bad) => {
    const { svc, insertMock } = await mountAndImport([{ id: "line-1", parentLineItemId: null, qtyProject: "100", rateProject: "40", qtyContract: "100", rateContract: "50" }])
    let thrown: unknown
    try {
      await svc.confirmBaseline(ctx, "boq-1", bad)
    } catch (err) {
      thrown = err
    }
    expect(thrown).toBeInstanceOf(svc.ServiceError)
    expect((thrown as { status: number }).status).toBe(400)
    expect((thrown as Error).message).toContain("requires a non-empty evidenceArtefactRef")
    expect(insertMock).not.toHaveBeenCalled()
  })

  test("a real citation is accepted and trimmed", async () => {
    const { svc, baselineRows } = await mountAndImport([{ id: "line-1", parentLineItemId: null, qtyProject: "100", rateProject: "40", qtyContract: "100", rateContract: "50" }])
    const baseline = await svc.confirmBaseline(ctx, "boq-1", "  PO-2026-0447  ")
    expect(baseline.evidenceArtefactRef).toBe("PO-2026-0447")
    expect(baselineRows.length).toBe(1)
  })
})

describe("confirmBaseline -- 3-02/3-03: explicit call, sequential versions, prior versions untouched", () => {
  test("two confirmations produce version 1 then version 2; version 1's snapshot is unchanged after version 2 is created", async () => {
    const { svc, lineRows } = await mountAndImport([
      { id: "line-1", parentLineItemId: null, qtyProject: "100", rateProject: "40", qtyContract: "100", rateContract: "50" },
    ])

    const v1 = await svc.confirmBaseline(ctx, "boq-1", "PO-1")
    expect(v1.version).toBe(1)
    const v1SnapshotAtConfirm = JSON.parse(JSON.stringify(v1.lineSnapshot))

    // A real live edit between the two confirmations (a QS revises the cost
    // estimate) -- version 2 must pick this up; version 1 must not.
    lineRows[0].rateProject = "45"
    lineRows[0].qtyContract = "120"

    const v2 = await svc.confirmBaseline(ctx, "boq-1", "PO-2 (variation)")
    expect(v2.version).toBe(2)
    expect(v2.lineSnapshot[0].rateProject).toBe("45") // v2 correctly captured the NEW live value
    expect(v2.lineSnapshot[0].qtyContract).toBe("120")

    // 3-03's actual assertion: re-fetch version 1 and confirm it is BYTE-FOR-BYTE
    // what it was at the moment it was confirmed, unaffected by v2's creation.
    const v1Refetched = await svc.getBaselineVersion(ctx, "boq-1", 1)
    expect(v1Refetched.lineSnapshot).toEqual(v1SnapshotAtConfirm)
    expect(v1Refetched.lineSnapshot[0].rateProject).toBe("40")
    expect(v1Refetched.lineSnapshot[0].qtyContract).toBe("100")
  })

  test("3-02 (service-internal half): none of the read-only functions ever call db.insert", async () => {
    const { svc, insertMock } = await mountAndImport([
      { id: "line-1", parentLineItemId: null, qtyProject: "100", rateProject: "40", qtyContract: "100", rateContract: "50" },
    ])
    await svc.confirmBaseline(ctx, "boq-1", "PO-1")
    const callsAfterConfirm = insertMock.mock.calls.length
    expect(callsAfterConfirm).toBe(1)

    await svc.listBaselineVersions({ orgId: "org-1" }, "boq-1")
    await svc.getBaselineVersion({ orgId: "org-1" }, "boq-1", 1)
    await svc.compareBaselines({ orgId: "org-1" }, "boq-1", 1, 1)
    expect(insertMock.mock.calls.length).toBe(callsAfterConfirm) // no new inserts
  })

  test("confirmBaseline throws 404 for a BOQ that does not exist in this org", async () => {
    const { svc } = await mountAndImport([], null)
    let thrown: unknown
    try {
      await svc.confirmBaseline(ctx, "boq-missing", "PO-1")
    } catch (err) {
      thrown = err
    }
    expect(thrown).toBeInstanceOf(svc.ServiceError)
    expect((thrown as { status: number }).status).toBe(404)
  })
})

describe("compareBaselines -- 3-08, three baselines, deltas between any two", () => {
  test("versions 1-vs-2, 2-vs-3 and 1-vs-3 all render correct per-line and total deltas", async () => {
    const { svc, lineRows } = await mountAndImport([
      { id: "line-1", parentLineItemId: null, qtyProject: "100", rateProject: "40", qtyContract: "100", rateContract: "50" },
    ])

    // v1: project 100*40=4000, contract 100*50=5000, variance 1000
    const v1 = await svc.confirmBaseline(ctx, "boq-1", "Proforma v1")
    expect(v1.version).toBe(1)

    // Cost estimate revised upward before v2: project 100*45=4500, contract unchanged 5000
    lineRows[0].rateProject = "45"
    const v2 = await svc.confirmBaseline(ctx, "boq-1", "Revised cost estimate")
    expect(v2.version).toBe(2)

    // Contract variation approved before v3: contract 120*55=6600, project side unchanged (4500)
    lineRows[0].qtyContract = "120"
    lineRows[0].rateContract = "55"
    const v3 = await svc.confirmBaseline(ctx, "boq-1", "Approved variation order VO-01")
    expect(v3.version).toBe(3)

    const cmp12 = await svc.compareBaselines({ orgId: "org-1" }, "boq-1", 1, 2)
    expect(cmp12.totals.a.projectValue).toBe(4000)
    expect(cmp12.totals.b.projectValue).toBe(4500)
    expect(cmp12.totals.projectValueDelta).toBe(500)
    expect(cmp12.totals.a.contractValue).toBe(5000)
    expect(cmp12.totals.b.contractValue).toBe(5000)
    expect(cmp12.totals.contractValueDelta).toBe(0)
    expect(cmp12.lines).toHaveLength(1)
    expect(cmp12.lines[0].projectValueDelta).toBe(500)
    expect(cmp12.lines[0].contractValueDelta).toBe(0)
    expect(cmp12.lines[0].varianceDelta).toBe(-500) // variance moved 1000 -> 500

    const cmp23 = await svc.compareBaselines({ orgId: "org-1" }, "boq-1", 2, 3)
    expect(cmp23.totals.a.projectValue).toBe(4500)
    expect(cmp23.totals.b.projectValue).toBe(4500)
    expect(cmp23.totals.projectValueDelta).toBe(0)
    expect(cmp23.totals.a.contractValue).toBe(5000)
    expect(cmp23.totals.b.contractValue).toBe(6600)
    expect(cmp23.totals.contractValueDelta).toBe(1600)
    expect(cmp23.lines[0].varianceDelta).toBe(1600) // variance moved 500 -> 2100

    const cmp13 = await svc.compareBaselines({ orgId: "org-1" }, "boq-1", 1, 3)
    expect(cmp13.totals.a.projectValue).toBe(4000)
    expect(cmp13.totals.b.projectValue).toBe(4500)
    expect(cmp13.totals.projectValueDelta).toBe(500)
    expect(cmp13.totals.a.contractValue).toBe(5000)
    expect(cmp13.totals.b.contractValue).toBe(6600)
    expect(cmp13.totals.contractValueDelta).toBe(1600)

    // Transitivity sanity check: the two one-step deltas sum to the two-step delta.
    expect(cmp12.totals.projectValueDelta + cmp23.totals.projectValueDelta).toBe(cmp13.totals.projectValueDelta)
    expect(cmp12.totals.contractValueDelta + cmp23.totals.contractValueDelta).toBe(cmp13.totals.contractValueDelta)
  })
})

describe("3-09 -- THE VERSIONED BASELINE IS NOT A FREEZE, but a taken snapshot never moves", () => {
  test("editing the LIVE rate_project after confirmation does not change what the already-confirmed baseline reports", async () => {
    const { svc, lineRows } = await mountAndImport([
      { id: "line-1", parentLineItemId: null, qtyProject: "100", rateProject: "40", qtyContract: "100", rateContract: "50" },
    ])

    const v1 = await svc.confirmBaseline(ctx, "boq-1", "PO-2026-0447")
    expect(v1.lineSnapshot[0].rateProject).toBe("40")
    const estimatedAtConfirm = getEstimatedCostFromBaseline(v1 as BoqBaseline)
    expect(estimatedAtConfirm.projectValue).toBe(4000) // 100 * 40

    // THE LIVE EDIT: someone changes the line's cost estimate AFTER v1 was
    // confirmed -- this is legal (E2: project-side edits never require
    // evidence, never create a version) but must NEVER retroactively change
    // what v1 already reported.
    lineRows[0].rateProject = "999"

    // Re-fetch v1 fresh from storage -- not the in-memory `v1` variable --
    // so this proves the DB round-trip preserves the frozen snapshot, not
    // just that the original in-process object happened not to mutate.
    const v1Refetched = await svc.getBaselineVersion({ orgId: "org-1" }, "boq-1", 1)
    expect(v1Refetched.lineSnapshot[0].rateProject).toBe("40") // UNCHANGED, not "999"
    const estimatedAfterLiveEdit = getEstimatedCostFromBaseline(v1Refetched)
    expect(estimatedAfterLiveEdit.projectValue).toBe(4000) // still 100*40, not 100*999

    // "Not a freeze" (E2/X-07): the NEXT confirmation correctly picks up the
    // new live value as its own, separate version -- versioned, not frozen.
    const v2 = await svc.confirmBaseline(ctx, "boq-1", "Revised cost estimate, PO-2026-0512")
    expect(v2.version).toBe(2)
    expect(v2.lineSnapshot[0].rateProject).toBe("999")
    expect(getEstimatedCostFromBaseline(v2).projectValue).toBe(99900) // 100*999

    // And v1, once more, is still untouched by v2 existing.
    const v1AfterV2 = await svc.getBaselineVersion({ orgId: "org-1" }, "boq-1", 1)
    expect(v1AfterV2.lineSnapshot[0].rateProject).toBe("40")
  })
})
