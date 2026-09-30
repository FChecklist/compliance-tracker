// Real-code tests for construction-exceptions-service.ts's 24 deterministic
// detectors (some shared across 2-3 of Sumeet's 28 numbered items -- see
// that file's own header for which). Every detector takes a `db` handle
// directly (no withTenantContext of its own), so these tests build a plain
// fake db object and call the exported function straight -- no module
// mocking needed except for getProjectExceptions itself, the one function
// that opens a real withTenantContext.
//
// The fake db ignores every `where` it is given, so the fake-db tests below
// prove each detector's JS-side logic only. The "real Postgres" describe at
// the END of this file closes that gap (U22_REQUIREMENT_CHECKS.md finding 1):
// it runs the real aggregator, every drizzle WHERE clause included, against
// PGlite built from the live schema snapshot.
/// <reference types="bun-types" />
import { describe, expect, test, mock, afterEach, beforeAll, afterAll } from "bun:test"
import { readFileSync } from "node:fs"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import * as schema from "@/lib/db/schema"
import * as svc from "./construction-exceptions-service"

const ORG = "org-1"
const PROJECT = "proj-1"

/** A minimal fake db: only .query.<table>.findMany/findFirst, keyed by data this test supplies. Unlisted tables return empty. */
function fakeDb(data: Partial<Record<string, unknown[]>>) {
  const tableNames = [
    "constructionSiteDiaries", "constructionWorkProgressEntries", "constructionChangeOrders",
    "constructionBoqs", "constructionBoqLineItems", "constructionMaterialIssues",
    "constructionLabourRoster", "constructionPunchListItems", "constructionInterimBills",
    "constructionInterimBillLineItems", "constructionVendorDisputes", "constructionCustomerComplaints",
    "erpPurchaseOrderItems", "erpPurchaseInvoices", "erpPurchaseInvoiceItems", "documents", "projects",
  ] as const

  function matches(row: Record<string, unknown>, where: unknown): boolean {
    // The service builds `where` with drizzle's and/eq/etc, which we cannot
    // introspect here -- so this fake instead filters in the JS callback
    // wrapper below (findManyFiltered) rather than trying to interpret a
    // drizzle where-expression object. Plain findMany here returns everything
    // for the table; per-test filtering happens via the `filter` fn passed to
    // findManyOf/findFirstOf.
    return true
  }

  const query: Record<string, { findMany: (...args: unknown[]) => Promise<unknown[]>; findFirst: (...args: unknown[]) => Promise<unknown> }> = {}
  for (const t of tableNames) {
    const rows = (data[t] ?? []) as Record<string, unknown>[]
    query[t] = {
      findMany: async () => rows,
      findFirst: async () => rows[0] ?? null,
    }
  }
  return { query } as unknown as Parameters<typeof svc.findDiaryWithoutProgressEntry>[0]
}

/**
 * Wraps a fakeDb to count every findMany/findFirst call per table, so a test
 * can assert a detector's total DB round-trip count stays CONSTANT as the
 * number of rows grows -- the real regression class fixed 2026-09-21 (see
 * ai-os/boss/ACTIVE-CLAIMS.yaml): 6 detectors used to run 1-3 extra queries
 * PER ROW, which is what actually caused getProjectExceptions() to time out
 * at 60s on the real demo project's data volume, not a cold-start artifact.
 * fakeDb's findMany/findFirst ignore `where` and return the whole configured
 * table regardless of the filter passed -- fine here, since these tests only
 * assert call COUNT, and the detectors' own in-memory cross-referencing
 * (using each returned row's own foreign-key field) already re-derives
 * correctness even though the fake never actually applies an IN-filter.
 */
function countCalls(db: ReturnType<typeof fakeDb>) {
  const counts: Record<string, number> = {}
  const wrapped = { query: {} as Record<string, { findMany: (...a: unknown[]) => Promise<unknown[]>; findFirst: (...a: unknown[]) => Promise<unknown> }> }
  for (const table of Object.keys((db as unknown as { query: Record<string, unknown> }).query)) {
    const real = (db as unknown as { query: Record<string, { findMany: (...a: unknown[]) => Promise<unknown[]>; findFirst: (...a: unknown[]) => Promise<unknown> }> }).query[table]
    wrapped.query[table] = {
      findMany: (...a: unknown[]) => { counts[`${table}.findMany`] = (counts[`${table}.findMany`] ?? 0) + 1; return real.findMany(...a) },
      findFirst: (...a: unknown[]) => { counts[`${table}.findFirst`] = (counts[`${table}.findFirst`] ?? 0) + 1; return real.findFirst(...a) },
    }
  }
  const total = () => Object.values(counts).reduce((a, b) => a + b, 0)
  return { db: wrapped as unknown as ReturnType<typeof fakeDb>, counts, total }
}

// The service's own WHERE clauses do real filtering server-side (drizzle
// SQL); this fake can't evaluate drizzle expressions, so each test supplies
// pre-filtered rows that match what the real WHERE would have returned for
// that scenario -- i.e. these tests prove the JS-side logic (grouping,
// comparison, cross-referencing) each detector adds ON TOP of its DB read,
// which is where the real risk of a bug lives (the WHERE clauses themselves
// are plain drizzle eq()/and() calls, not something worth re-testing here).

describe("findDiaryWithoutProgressEntry (#1 / #8)", () => {
  test("a diary with real work text and no matching progress entry is flagged", async () => {
    const db = fakeDb({
      constructionSiteDiaries: [{ id: "d1", diaryDate: "2026-09-01", workDone: "Poured slab" }],
      constructionWorkProgressEntries: [],
    })
    const result = await svc.findDiaryWithoutProgressEntry(db as never, ORG, PROJECT)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe("d1")
  })

  test("a diary date that also has a progress entry is not flagged", async () => {
    const db = fakeDb({
      constructionSiteDiaries: [{ id: "d1", diaryDate: "2026-09-01", workDone: "Poured slab" }],
      constructionWorkProgressEntries: [{ entryDate: "2026-09-01" }],
    })
    expect(await svc.findDiaryWithoutProgressEntry(db as never, ORG, PROJECT)).toHaveLength(0)
  })

  test("a diary with blank workDone is not flagged (nothing to have captured)", async () => {
    const db = fakeDb({
      constructionSiteDiaries: [{ id: "d1", diaryDate: "2026-09-01", workDone: "   " }],
      constructionWorkProgressEntries: [],
    })
    expect(await svc.findDiaryWithoutProgressEntry(db as never, ORG, PROJECT)).toHaveLength(0)
  })
})

describe("findApprovedChangeOrdersNeverBilled (#2)", () => {
  test("approved CO linked to a BOQ revision with zero bills is flagged", async () => {
    const db = fakeDb({
      constructionChangeOrders: [{ id: "co1", number: 1, boqRevisionId: "boq2", costImpact: "5000" }],
      constructionBoqLineItems: [{ id: "line1", boqId: "boq2" }],
      constructionInterimBillLineItems: [],
    })
    const result = await svc.findApprovedChangeOrdersNeverBilled(db as never, ORG, PROJECT)
    expect(result).toHaveLength(1)
  })

  test("approved CO whose BOQ revision line items are already billed is not flagged", async () => {
    const db = fakeDb({
      constructionChangeOrders: [{ id: "co1", number: 1, boqRevisionId: "boq2", costImpact: "5000" }],
      constructionBoqLineItems: [{ id: "line1", boqId: "boq2" }],
      constructionInterimBillLineItems: [{ boqLineItemId: "line1" }],
    })
    expect(await svc.findApprovedChangeOrdersNeverBilled(db as never, ORG, PROJECT)).toHaveLength(0)
  })
})

describe("findUnconfirmedDrawingProgress (#3) / findOldDrawingProgress (#4)", () => {
  test("a progress entry naming a drawing with no confirmation is flagged", async () => {
    const db = fakeDb({ constructionWorkProgressEntries: [{ id: "e1", entryDate: "2026-09-01", drawingDocumentId: "doc1", drawingConfirmedAt: null }] })
    expect(await svc.findUnconfirmedDrawingProgress(db as never, ORG, PROJECT)).toHaveLength(1)
  })

  test("a confirmed drawing reference is not flagged", async () => {
    // The real WHERE excludes any row with drawingConfirmedAt set -- this
    // fake has no where-clause evaluator, so the pre-filtered input for
    // "nothing unconfirmed exists" is simply an empty result set.
    const db = fakeDb({ constructionWorkProgressEntries: [] })
    expect(await svc.findUnconfirmedDrawingProgress(db as never, ORG, PROJECT)).toHaveLength(0)
  })

  test("a superseded drawing (isLatestVersion=false) is flagged as old", async () => {
    const db = fakeDb({
      constructionWorkProgressEntries: [{ id: "e1", entryDate: "2026-09-01", drawingDocumentId: "doc1" }],
      documents: [{ id: "doc1", isLatestVersion: false, name: "Plan A" }],
    })
    expect(await svc.findOldDrawingProgress(db as never, ORG, PROJECT)).toHaveLength(1)
  })

  test("the current drawing version is not flagged as old", async () => {
    const db = fakeDb({
      constructionWorkProgressEntries: [{ id: "e1", entryDate: "2026-09-01", drawingDocumentId: "doc1" }],
      documents: [{ id: "doc1", isLatestVersion: true, name: "Plan A" }],
    })
    expect(await svc.findOldDrawingProgress(db as never, ORG, PROJECT)).toHaveLength(0)
  })
})

describe("findStuckApprovals (#5)", () => {
  test("a change order pending_approval past the threshold is flagged", async () => {
    const old = new Date(Date.now() - (svc.STUCK_APPROVAL_DAYS + 1) * 86_400_000)
    const db = fakeDb({ constructionChangeOrders: [{ id: "co1", number: 1, createdAt: old }] })
    expect(await svc.findStuckApprovals(db as never, ORG, PROJECT)).toHaveLength(1)
  })

  test("a recently-created pending change order is not flagged yet", async () => {
    const db = fakeDb({ constructionChangeOrders: [] }) // real WHERE excludes it; simulated by returning nothing
    expect(await svc.findStuckApprovals(db as never, ORG, PROJECT)).toHaveLength(0)
  })
})

describe("findSelfApprovedChangeOrders (#6)", () => {
  test("approver === requester is flagged", async () => {
    const db = fakeDb({ constructionChangeOrders: [{ id: "co1", number: 1, requestedById: "u1", approvedById: "u1" }] })
    expect(await svc.findSelfApprovedChangeOrders(db as never, ORG, PROJECT)).toHaveLength(1)
  })

  test("a different approver is not flagged", async () => {
    const db = fakeDb({ constructionChangeOrders: [{ id: "co1", number: 1, requestedById: "u1", approvedById: "u2" }] })
    expect(await svc.findSelfApprovedChangeOrders(db as never, ORG, PROJECT)).toHaveLength(0)
  })
})

describe("findWorkWithoutApprovedBoq (#7)", () => {
  test("progress against a non-approved BOQ line is flagged", async () => {
    const db = fakeDb({
      constructionWorkProgressEntries: [{ id: "e1", entryDate: "2026-09-01", boqLineItemId: "line1" }],
      constructionBoqLineItems: [{ id: "line1", boqId: "boq1" }],
      constructionBoqs: [{ id: "boq1", status: "draft" }],
    })
    expect(await svc.findWorkWithoutApprovedBoq(db as never, ORG, PROJECT)).toHaveLength(1)
  })

  test("progress against an approved BOQ line is not flagged", async () => {
    const db = fakeDb({
      constructionWorkProgressEntries: [{ id: "e1", entryDate: "2026-09-01", boqLineItemId: "line1" }],
      constructionBoqLineItems: [{ id: "line1", boqId: "boq1" }],
      constructionBoqs: [{ id: "boq1", status: "approved" }],
    })
    expect(await svc.findWorkWithoutApprovedBoq(db as never, ORG, PROJECT)).toHaveLength(0)
  })

  test("findWorkWithoutApprovedBoq: work under a BOQ that WAS approved and later superseded is not flagged (2026-09-30 fix)", async () => {
    const db = fakeDb({
      constructionWorkProgressEntries: [{ id: "e1", entryDate: "2026-09-10", boqLineItemId: "line1" }],
      constructionBoqLineItems: [{ id: "line1", boqId: "boq1" }],
      constructionBoqs: [{ id: "boq1", status: "superseded", approvedAt: new Date("2026-09-01T10:00:00Z") }],
    })
    expect(await svc.findWorkWithoutApprovedBoq(db as never, ORG, PROJECT)).toHaveLength(0)
  })

  test("findWorkWithoutApprovedBoq: a superseded BOQ that was never approved IS flagged", async () => {
    const db = fakeDb({
      constructionWorkProgressEntries: [{ id: "e1", entryDate: "2026-09-10", boqLineItemId: "line1" }],
      constructionBoqLineItems: [{ id: "line1", boqId: "boq1" }],
      constructionBoqs: [{ id: "boq1", status: "superseded", approvedAt: null }],
    })
    expect((await svc.findWorkWithoutApprovedBoq(db as never, ORG, PROJECT)).map((r) => r.id)).toEqual(["e1"])
  })

  test("findWorkWithoutApprovedBoq: work dated BEFORE the BOQ's approval date IS flagged, same-day is not", async () => {
    const db = fakeDb({
      constructionWorkProgressEntries: [
        { id: "before", entryDate: "2026-09-04", boqLineItemId: "line1" },
        { id: "sameday", entryDate: "2026-09-05", boqLineItemId: "line1" },
        { id: "after", entryDate: "2026-09-06", boqLineItemId: "line1" },
      ],
      constructionBoqLineItems: [{ id: "line1", boqId: "boq1" }],
      constructionBoqs: [{ id: "boq1", status: "approved", approvedAt: new Date("2026-09-05T10:00:00Z") }],
    })
    expect((await svc.findWorkWithoutApprovedBoq(db as never, ORG, PROJECT)).map((r) => r.id)).toEqual(["before"])
  })
})

describe("findProgressNeverBilled (#9)", () => {
  test("a BOQ line with logged progress and no bill is flagged", async () => {
    const db = fakeDb({
      constructionWorkProgressEntries: [{ boqLineItemId: "line1", percentComplete: "40" }],
      constructionInterimBillLineItems: [],
    })
    expect(await svc.findProgressNeverBilled(db as never, ORG, PROJECT)).toHaveLength(1)
  })

  test("a billed BOQ line is not flagged", async () => {
    const db = fakeDb({
      constructionWorkProgressEntries: [{ boqLineItemId: "line1", percentComplete: "40" }],
      constructionInterimBillLineItems: [{ boqLineItemId: "line1" }],
    })
    expect(await svc.findProgressNeverBilled(db as never, ORG, PROJECT)).toHaveLength(0)
  })
})

describe("findOpenVendorDisputes (#10) / findOpenCustomerComplaints (#11 / #12)", () => {
  test("an open vendor dispute is flagged", async () => {
    const db = fakeDb({ constructionVendorDisputes: [{ id: "vd1", description: "Quantity disagreement", amountDisputed: "1000" }] })
    expect(await svc.findOpenVendorDisputes(db as never, ORG, PROJECT)).toHaveLength(1)
  })

  test("an open complaint is flagged for #12 (no category filter)", async () => {
    const db = fakeDb({ constructionCustomerComplaints: [{ id: "cc1", description: "Late delivery", severity: "medium", category: "general" }] })
    expect(await svc.findOpenCustomerComplaints(db as never, ORG, PROJECT)).toHaveLength(1)
  })

  test("category filter narrows to work_dispute for #11", async () => {
    const db = fakeDb({ constructionCustomerComplaints: [{ id: "cc1", description: "Disputed finish", severity: "high", category: "work_dispute" }] })
    expect(await svc.findOpenCustomerComplaints(db as never, ORG, PROJECT, "work_dispute")).toHaveLength(1)
  })
})

describe("findNewBoqRevisions (#13 / #14)", () => {
  test("a BOQ with a parentBoqId is a revision and is listed", async () => {
    const db = fakeDb({ constructionBoqs: [{ id: "boq2", version: 2, title: "Villa 21", createdAt: new Date(), parentBoqId: "boq1" }] })
    expect(await svc.findNewBoqRevisions(db as never, ORG, PROJECT)).toHaveLength(1)
  })
})

describe("findBoqWithoutCustomerApproval (#15 / #16)", () => {
  test("internally approved, no customer approval, is flagged", async () => {
    const db = fakeDb({ constructionBoqs: [{ id: "boq1", version: 1, title: "Villa 21", customerApprovedAt: null }] })
    expect(await svc.findBoqWithoutCustomerApproval(db as never, ORG, PROJECT)).toHaveLength(1)
  })

  test("a customer-approved BOQ is not flagged", async () => {
    const db = fakeDb({ constructionBoqs: [] }) // real WHERE excludes rows with customerApprovedAt set
    expect(await svc.findBoqWithoutCustomerApproval(db as never, ORG, PROJECT)).toHaveLength(0)
  })
})

describe("findApprovalsWithoutBoqComparison (#17)", () => {
  test("an approved CO with no BOQ link is flagged", async () => {
    const db = fakeDb({ constructionChangeOrders: [{ id: "co1", number: 1 }] })
    expect(await svc.findApprovalsWithoutBoqComparison(db as never, ORG, PROJECT)).toHaveLength(1)
  })
})

describe("findMaterialWithoutBoqLine (#18 / #27)", () => {
  test("a material issue with no BOQ line recorded is flagged", async () => {
    const db = fakeDb({ constructionMaterialIssues: [{ id: "mi1", issuedDate: "2026-09-01", quantity: "10" }] })
    expect(await svc.findMaterialWithoutBoqLine(db as never, ORG, PROJECT)).toHaveLength(1)
  })
})

describe("findLateOrDuplicateMaterial (#19)", () => {
  test("the same material issued twice within the duplicate window is flagged", async () => {
    const db = fakeDb({
      constructionMaterialIssues: [
        { id: "mi1", materialId: "mat1", issuedDate: "2026-09-01", boqLineItemId: null },
        { id: "mi2", materialId: "mat1", issuedDate: "2026-09-02", boqLineItemId: null },
      ],
    })
    const result = await svc.findLateOrDuplicateMaterial(db as never, ORG, PROJECT)
    expect(result.some((r) => r.id === "mi2")).toBe(true)
  })

  test("the same material re-issued well outside the window is not flagged as duplicate", async () => {
    const db = fakeDb({
      constructionMaterialIssues: [
        { id: "mi1", materialId: "mat1", issuedDate: "2026-09-01", boqLineItemId: null },
        { id: "mi2", materialId: "mat1", issuedDate: "2026-10-01", boqLineItemId: null },
      ],
    })
    expect(await svc.findLateOrDuplicateMaterial(db as never, ORG, PROJECT)).toHaveLength(0)
  })

  test("material issued after progress on its own activity already started is flagged as late", async () => {
    const db = fakeDb({
      constructionMaterialIssues: [{ id: "mi1", materialId: "mat1", issuedDate: "2026-09-10", boqLineItemId: "line1" }],
      constructionBoqLineItems: [{ id: "line1", activityId: "act1" }],
      constructionWorkProgressEntries: [{ entryDate: "2026-09-01", activityId: "act1" }],
    })
    const result = await svc.findLateOrDuplicateMaterial(db as never, ORG, PROJECT)
    expect(result.some((r) => r.id === "mi1")).toBe(true)
  })
})

describe("findMissingDailyReports (#20 / #26)", () => {
  test("a gap day inside the active date range with no diary is flagged", async () => {
    const db = fakeDb({
      constructionWorkProgressEntries: [{ entryDate: "2020-01-01" }, { entryDate: "2020-01-03" }],
      constructionSiteDiaries: [{ diaryDate: "2020-01-01" }, { diaryDate: "2020-01-03" }],
    })
    const result = await svc.findMissingDailyReports(db as never, ORG, PROJECT)
    expect(result.some((r) => r.id === "2020-01-02")).toBe(true)
  })

  test("every day in range has a diary -- nothing flagged", async () => {
    const db = fakeDb({
      constructionWorkProgressEntries: [{ entryDate: "2020-01-01" }, { entryDate: "2020-01-02" }],
      constructionSiteDiaries: [{ diaryDate: "2020-01-01" }, { diaryDate: "2020-01-02" }],
    })
    expect(await svc.findMissingDailyReports(db as never, ORG, PROJECT)).toHaveLength(0)
  })

  test("a project with no progress entries yet has nothing to check (not an error)", async () => {
    const db = fakeDb({ constructionWorkProgressEntries: [], constructionSiteDiaries: [] })
    expect(await svc.findMissingDailyReports(db as never, ORG, PROJECT)).toHaveLength(0)
  })

  test("findMissingDailyReports: every calendar day across a DST change is reported exactly once, whatever the host timezone (2026-09-30 fix)", async () => {
    // US DST started 2026-03-08. The old local-time setDate() walk, on a
    // host in America/New_York, produced 03-07, 03-08, 03-08, 03-09 --
    // 03-08 twice and 03-10 never. process.env.TZ is honoured at run time
    // by Bun, so this reproduces a non-UTC server without touching the OS.
    const previousTz = process.env.TZ
    process.env.TZ = "America/New_York"
    try {
      const db = fakeDb({
        constructionWorkProgressEntries: [{ entryDate: "2026-03-07" }, { entryDate: "2026-03-10" }],
        constructionSiteDiaries: [],
      })
      const ids = (await svc.findMissingDailyReports(db as never, ORG, PROJECT)).map((r) => r.id)
      expect(ids).toEqual(["2026-03-07", "2026-03-08", "2026-03-09", "2026-03-10"])
    } finally {
      if (previousTz === undefined) delete process.env.TZ
      else process.env.TZ = previousTz
    }
  })
})

describe("findUnlinkedRoster (#21)", () => {
  test("a roster entry with no employeeId is flagged", async () => {
    const db = fakeDb({ constructionLabourRoster: [{ id: "r1", name: "Falcon gang 3", employeeId: null }] })
    expect(await svc.findUnlinkedRoster(db as never, ORG, PROJECT)).toHaveLength(1)
  })
})

describe("findAmbiguousBoqVersions (#22) -- already-closed invariant, proven here", () => {
  // The detector now reads EVERY BOQ of the project (status included) and
  // filters approved rows in memory -- so these rows carry their status.
  test("two approved rows in the SAME chain (one is the other's parent) violates the invariant", async () => {
    const db = fakeDb({ constructionBoqs: [{ id: "boq2", version: 2, parentBoqId: "boq1", status: "approved" }, { id: "boq1", version: 1, parentBoqId: null, status: "approved" }] })
    expect(await svc.findAmbiguousBoqVersions(db as never, ORG, PROJECT)).toHaveLength(1)
  })

  test("two independent (non-chained) approved BOQs are legitimate, not flagged (E-116)", async () => {
    const db = fakeDb({ constructionBoqs: [{ id: "boqA", version: 1, parentBoqId: null, status: "approved" }, { id: "boqB", version: 1, parentBoqId: null, status: "approved" }] })
    expect(await svc.findAmbiguousBoqVersions(db as never, ORG, PROJECT)).toHaveLength(0)
  })

  test("findAmbiguousBoqVersions: v1 approved -> v2 superseded -> v3 approved IS flagged (non-adjacent, 2026-09-30 fix)", async () => {
    const db = fakeDb({ constructionBoqs: [
      { id: "v1", version: 1, parentBoqId: null, status: "approved" },
      { id: "v2", version: 2, parentBoqId: "v1", status: "superseded" },
      { id: "v3", version: 3, parentBoqId: "v2", status: "approved" },
    ] })
    expect((await svc.findAmbiguousBoqVersions(db as never, ORG, PROJECT)).map((r) => r.id)).toEqual(["v3"])
  })

  test("findAmbiguousBoqVersions: a normal history (v1 superseded -> v2 approved) is not flagged", async () => {
    const db = fakeDb({ constructionBoqs: [
      { id: "v1", version: 1, parentBoqId: null, status: "superseded" },
      { id: "v2", version: 2, parentBoqId: "v1", status: "approved" },
    ] })
    expect(await svc.findAmbiguousBoqVersions(db as never, ORG, PROJECT)).toHaveLength(0)
  })
})

describe("findMismatchedSubcontractorInvoices (#23)", () => {
  test("an invoice line exceeding its BOQ line's cumulative billed amount is flagged", async () => {
    const db = fakeDb({
      erpPurchaseInvoiceItems: [{ id: "pii1", boqLineItemId: "line1", amount: "5000", invoiceId: "inv1" }],
      constructionBoqLineItems: [{ id: "line1", boqId: "boq1" }],
      constructionBoqs: [{ id: "boq1", orgId: ORG, projectId: PROJECT }],
      constructionInterimBillLineItems: [{ boqLineItemId: "line1", cumulativeAmount: "3000" }],
    })
    expect(await svc.findMismatchedSubcontractorInvoices(db as never, ORG, PROJECT)).toHaveLength(1)
  })

  test("an invoice line within the billed amount is not flagged", async () => {
    const db = fakeDb({
      erpPurchaseInvoiceItems: [{ id: "pii1", boqLineItemId: "line1", amount: "2000", invoiceId: "inv1" }],
      constructionBoqLineItems: [{ id: "line1", boqId: "boq1" }],
      constructionBoqs: [{ id: "boq1", orgId: ORG, projectId: PROJECT }],
      constructionInterimBillLineItems: [{ boqLineItemId: "line1", cumulativeAmount: "3000" }],
    })
    expect(await svc.findMismatchedSubcontractorInvoices(db as never, ORG, PROJECT)).toHaveLength(0)
  })

  test("findMismatchedSubcontractorInvoices: an over-invoice SPLIT across two lines is flagged on both (2026-09-30 fix)", async () => {
    const db = fakeDb({
      erpPurchaseInvoiceItems: [
        { id: "pii1", boqLineItemId: "line1", amount: "2000", invoiceId: "inv1" },
        { id: "pii2", boqLineItemId: "line1", amount: "2000", invoiceId: "inv2" },
      ],
      constructionBoqLineItems: [{ id: "line1", boqId: "boq1" }],
      constructionBoqs: [{ id: "boq1" }],
      constructionInterimBillLineItems: [{ boqLineItemId: "line1", cumulativeAmount: "3000" }],
    })
    expect((await svc.findMismatchedSubcontractorInvoices(db as never, ORG, PROJECT)).map((r) => r.id).sort()).toEqual(["pii1", "pii2"])
  })
})

describe("findOverdueSnags / findRetentionHeldDespiteSnagsClosed (#24)", () => {
  test("an overdue, not-verified-closed snag is flagged", async () => {
    const db = fakeDb({ constructionPunchListItems: [{ id: "p1", number: 1, description: "Paint touch-up", dueDate: "2020-01-01", status: "open" }] })
    expect(await svc.findOverdueSnags(db as never, ORG, PROJECT)).toHaveLength(1)
  })

  test("retention held while a snag is still open is NOT flagged -- not yet a red flag", async () => {
    const db = fakeDb({ constructionPunchListItems: [{ id: "p1", status: "open" }], constructionInterimBills: [{ id: "b1", billNumber: 1, retentionAmount: "500", retentionReleasedAmount: null }] })
    expect(await svc.findRetentionHeldDespiteSnagsClosed(db as never, ORG, PROJECT)).toHaveLength(0)
  })

  test("retention still held after every snag is verified closed IS flagged", async () => {
    // The detector now reads the project's whole snag list (status only)
    // and decides "all closed" in memory, so the closed snag is supplied.
    const db = fakeDb({ constructionPunchListItems: [{ id: "p1", status: "verified_closed" }], constructionInterimBills: [{ id: "b1", billNumber: 1, retentionAmount: "500", retentionReleasedAmount: null }] })
    expect(await svc.findRetentionHeldDespiteSnagsClosed(db as never, ORG, PROJECT)).toHaveLength(1)
  })

  test("retention already fully released after snags close is not flagged", async () => {
    const db = fakeDb({ constructionPunchListItems: [{ id: "p1", status: "verified_closed" }], constructionInterimBills: [{ id: "b1", billNumber: 1, retentionAmount: "500", retentionReleasedAmount: "500" }] })
    expect(await svc.findRetentionHeldDespiteSnagsClosed(db as never, ORG, PROJECT)).toHaveLength(0)
  })

  test("findRetentionHeldDespiteSnagsClosed: a project with NO snags on record is not flagged (vacuous 'all closed', 2026-09-30 fix)", async () => {
    const db = fakeDb({ constructionPunchListItems: [], constructionInterimBills: [{ id: "b1", billNumber: 1, retentionAmount: "500", retentionReleasedAmount: null }] })
    expect(await svc.findRetentionHeldDespiteSnagsClosed(db as never, ORG, PROJECT)).toHaveLength(0)
  })
})

describe("findApprovalsWithoutEvidence (#25)", () => {
  test("an approved CO with no attached document is flagged", async () => {
    const db = fakeDb({ constructionChangeOrders: [{ id: "co1", number: 1 }], documents: [] })
    expect(await svc.findApprovalsWithoutEvidence(db as never, ORG, PROJECT)).toHaveLength(1)
  })

  test("an approved CO with a linked evidence document is not flagged", async () => {
    const db = fakeDb({ constructionChangeOrders: [{ id: "co1", number: 1 }], documents: [{ id: "d1", orgId: ORG, linkedEntityType: "construction_change_order", linkedEntityId: "co1" }] })
    expect(await svc.findApprovalsWithoutEvidence(db as never, ORG, PROJECT)).toHaveLength(0)
  })
})

describe("findProgressRegressions (#28)", () => {
  test("a later SNAPSHOT entry reporting a lower percent than a prior one is flagged", async () => {
    const db = fakeDb({
      constructionWorkProgressEntries: [
        { id: "e1", activityId: "act1", entryDate: "2026-09-01", percentComplete: "60", createdAt: new Date("2026-09-01"), entryBasis: "SNAPSHOT" },
        { id: "e2", activityId: "act1", entryDate: "2026-09-02", percentComplete: "40", createdAt: new Date("2026-09-02"), entryBasis: "SNAPSHOT" },
      ],
    })
    const result = await svc.findProgressRegressions(db as never, ORG, PROJECT)
    expect(result.some((r) => r.id === "e2")).toBe(true)
  })

  test("monotonically increasing progress is never flagged", async () => {
    const db = fakeDb({
      constructionWorkProgressEntries: [
        { id: "e1", activityId: "act1", entryDate: "2026-09-01", percentComplete: "40", createdAt: new Date("2026-09-01"), entryBasis: "SNAPSHOT" },
        { id: "e2", activityId: "act1", entryDate: "2026-09-02", percentComplete: "60", createdAt: new Date("2026-09-02"), entryBasis: "SNAPSHOT" },
      ],
    })
    expect(await svc.findProgressRegressions(db as never, ORG, PROJECT)).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// N+1 regression guards (fixed 2026-09-21) -- 6 detectors used to run 1-3
// extra DB round-trips PER ROW instead of a batched IN-clause lookup, which
// was the real cause of getProjectExceptions() timing out at 60s on the real
// demo project (ai-os/boss/ACTIVE-CLAIMS.yaml, 2026-09-21 entry). Each of
// these asserts the total query-call count stays bounded and N-independent
// at N=25 rows -- before this fix, N=25 would have produced roughly
// 2N-3N extra calls on top of the base queries; these thresholds would fail
// immediately if a future edit reintroduced a per-row query.
// ---------------------------------------------------------------------------
describe("N+1 regression guards", () => {
  test("findApprovedChangeOrdersNeverBilled (#2): query count stays constant as N grows", async () => {
    const N = 25
    const orders = Array.from({ length: N }, (_, i) => ({ id: `co${i}`, number: i, boqRevisionId: `boq${i}`, costImpact: "5000" }))
    const lineItems = Array.from({ length: N }, (_, i) => ({ id: `line${i}`, boqId: `boq${i}` }))
    const { db, total } = countCalls(fakeDb({ constructionChangeOrders: orders, constructionBoqLineItems: lineItems, constructionInterimBillLineItems: [] }))
    const result = await svc.findApprovedChangeOrdersNeverBilled(db as never, ORG, PROJECT)
    expect(result).toHaveLength(N)
    expect(total()).toBeLessThanOrEqual(3)
  })

  test("findOldDrawingProgress (#4): query count stays constant as N grows", async () => {
    const N = 25
    const rows = Array.from({ length: N }, (_, i) => ({ id: `e${i}`, entryDate: "2026-09-01", drawingDocumentId: `doc${i}` }))
    const docs = Array.from({ length: N }, (_, i) => ({ id: `doc${i}`, isLatestVersion: false, name: `Plan ${i}` }))
    const { db, total } = countCalls(fakeDb({ constructionWorkProgressEntries: rows, documents: docs }))
    const result = await svc.findOldDrawingProgress(db as never, ORG, PROJECT)
    expect(result).toHaveLength(N)
    expect(total()).toBeLessThanOrEqual(2)
  })

  test("findWorkWithoutApprovedBoq (#7): query count stays constant as N grows", async () => {
    const N = 25
    const entries = Array.from({ length: N }, (_, i) => ({ id: `e${i}`, entryDate: "2026-09-01", boqLineItemId: `line${i}` }))
    const lines = Array.from({ length: N }, (_, i) => ({ id: `line${i}`, boqId: `boq${i}` }))
    const boqs = Array.from({ length: N }, (_, i) => ({ id: `boq${i}`, status: "draft" }))
    const { db, total } = countCalls(fakeDb({ constructionWorkProgressEntries: entries, constructionBoqLineItems: lines, constructionBoqs: boqs }))
    const result = await svc.findWorkWithoutApprovedBoq(db as never, ORG, PROJECT)
    expect(result).toHaveLength(N)
    expect(total()).toBeLessThanOrEqual(3)
  })

  test("findProgressNeverBilled (#9): query count stays constant as N grows", async () => {
    const N = 25
    const entries = Array.from({ length: N }, (_, i) => ({ boqLineItemId: `line${i}`, percentComplete: "40" }))
    const { db, total } = countCalls(fakeDb({ constructionWorkProgressEntries: entries, constructionInterimBillLineItems: [], constructionBoqLineItems: [] }))
    const result = await svc.findProgressNeverBilled(db as never, ORG, PROJECT)
    expect(result).toHaveLength(N)
    expect(total()).toBeLessThanOrEqual(3)
  })

  test("findLateOrDuplicateMaterial (#19) 'late' half: query count stays constant as N grows", async () => {
    const N = 25
    const issues = Array.from({ length: N }, (_, i) => ({ id: `mi${i}`, materialId: `mat${i}`, issuedDate: "2026-09-10", boqLineItemId: `line${i}` }))
    const lines = Array.from({ length: N }, (_, i) => ({ id: `line${i}`, activityId: `act${i}` }))
    const progress = Array.from({ length: N }, (_, i) => ({ entryDate: "2026-09-01", activityId: `act${i}` }))
    const { db, total } = countCalls(fakeDb({ constructionMaterialIssues: issues, constructionBoqLineItems: lines, constructionWorkProgressEntries: progress }))
    const result = await svc.findLateOrDuplicateMaterial(db as never, ORG, PROJECT)
    expect(result.filter((r) => r.detail.includes("arrived late"))).toHaveLength(N)
    expect(total()).toBeLessThanOrEqual(3)
  })

  test("findMismatchedSubcontractorInvoices (#23): query count stays constant as N grows", async () => {
    const N = 25
    const boqs = [{ id: "boq1", orgId: ORG, projectId: PROJECT }]
    const lines = Array.from({ length: N }, (_, i) => ({ id: `line${i}`, boqId: "boq1" }))
    const invoiceItems = Array.from({ length: N }, (_, i) => ({ id: `pii${i}`, boqLineItemId: `line${i}`, amount: "5000", invoiceId: `inv${i}` }))
    const { db, total } = countCalls(fakeDb({ constructionBoqs: boqs, constructionBoqLineItems: lines, erpPurchaseInvoiceItems: invoiceItems, constructionInterimBillLineItems: [] }))
    const result = await svc.findMismatchedSubcontractorInvoices(db as never, ORG, PROJECT)
    expect(result).toHaveLength(N)
    // 5, not 4, since 2026-09-30: one batched lookup of which linked
    // purchase invoices are cancelled (still constant, still N-independent).
    expect(total()).toBeLessThanOrEqual(5)
  })

  test("findApprovalsWithoutEvidence (#25): query count stays constant as N grows", async () => {
    const N = 25
    const orders = Array.from({ length: N }, (_, i) => ({ id: `co${i}`, number: i }))
    const { db, total } = countCalls(fakeDb({ constructionChangeOrders: orders, documents: [] }))
    const result = await svc.findApprovalsWithoutEvidence(db as never, ORG, PROJECT)
    expect(result).toHaveLength(N)
    expect(total()).toBeLessThanOrEqual(2)
  })
})

// ---------------------------------------------------------------------------
// getProjectExceptions -- the one function that opens withTenantContext.
// Proves the aggregator wires the shared detectors to BOTH of their numbered
// items (X-27 discipline: one computation, two labels) and returns all 28.
// ---------------------------------------------------------------------------
const realTenantScoped = await import("@/lib/db/tenant-scoped")

afterEach(async () => {
  mock.restore()
  await mock.module("@/lib/db/tenant-scoped", () => realTenantScoped)
})

describe("getProjectExceptions", () => {
  test("a project that does not exist (or belongs to another org) 404s rather than returning an empty report silently", async () => {
    const emptyDb = fakeDb({ projects: [] })
    await mock.module("@/lib/db/tenant-scoped", () => ({
      ...realTenantScoped,
      withTenantContext: mock(async (_ctx: unknown, fn: (db: unknown) => Promise<unknown>) => fn(emptyDb)),
    }))
    const { getProjectExceptions, ServiceError } = await import("./construction-exceptions-service")
    let caught: unknown
    try {
      await getProjectExceptions({ orgId: ORG }, "missing-project")
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(ServiceError)
    expect((caught as InstanceType<typeof ServiceError>).status).toBe(404)
  })

  test("returns exactly the 28 numbered items, with shared detectors appearing under both their labels", async () => {
    const emptyDb = fakeDb({ projects: [{ id: PROJECT, orgId: ORG }] })
    await mock.module("@/lib/db/tenant-scoped", () => ({
      ...realTenantScoped,
      withTenantContext: mock(async (_ctx: unknown, fn: (db: unknown) => Promise<unknown>) => fn(emptyDb)),
    }))
    const { getProjectExceptions } = await import("./construction-exceptions-service")
    const checks = await getProjectExceptions({ orgId: ORG }, PROJECT)

    const itemNumbers = checks.map((c) => c.item)
    for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28]) {
      expect(itemNumbers).toContain(n)
    }
    // Regression guard for a real bug (fixed 2026-09-21): #24 used to be
    // push()'d twice under the same number (two different detectors --
    // overdue snags and retention-held -- merged into one owner item), which
    // silently inflated the array to 29 entries while still passing a bare
    // `toContain` check on every number 1-28. Assert both the exact count
    // AND that every item number is genuinely unique, so a future
    // reintroduction of a duplicate push() is caught here, not just by the
    // separate cross-repo e2e spec's hard `toBe(28)` assertion.
    expect(checks).toHaveLength(28)
    expect(new Set(itemNumbers).size).toBe(28)
    // #1 and #8 share one detector -- proven by both being false together on an empty project.
    expect(checks.find((c) => c.item === 1)!.flagged).toBe(false)
    expect(checks.find((c) => c.item === 8)!.flagged).toBe(false)
    // Every check reports a formula in words -- never a bare boolean with no way to verify it.
    for (const c of checks) expect(c.formula.length).toBeGreaterThan(10)
  })
})

// ===========================================================================
// REAL POSTGRES -- Sumeet EXC-ITEM-01..28 closure evidence (2026-09-30).
//
// WHAT IS REAL: Postgres itself (PGlite, real Postgres compiled to WASM, no
// server), built from scripts/verify/fixtures/construction-exceptions-
// service.base.sql -- the LIVE schema of every table the 24 detectors read,
// generated from the live Supabase project's own pg_catalog (column types,
// NOT NULL, defaults, enums, PK/UNIQUE/CHECK, the 4 in-set FKs). The real
// drizzle query builder over schema.ts's real table declarations. The real
// aggregator getProjectExceptionsWithDb() and every real detector with its
// real WHERE clause. NOTHING IS FAKED.
//
// WHAT IT PROVES, per item: the exact set of flagged record ids equals the
// hand-derived expected set for one realistic scenario project -- so a
// detector that stops firing (missed positive) OR starts firing on a
// negative control fails. Every WHERE-clause filter has a matching negative
// control: a DECOY row in another project of the same org (project filter),
// a DECOY row in another org sharing this project's id (org filter), and a
// wrong-status / wrong-category / NULL-vs-set / date-boundary row for each
// status, category, isNull/isNotNull and lt/gte predicate. Two further
// scenario projects cover #24's retention half (snags all closed) and a
// project with no snag list at all (must be fully clear).
//
// Every expected id set below is derived BY HAND from the INSERTs, not
// captured from the service's own output.
// ===========================================================================
const R_ORG = "rp-org"
const R_ORG_X = "rp-org-x" // decoy org: its rows reuse R_PROJ's id to prove the org filter
const R_PROJ = "rp-proj"
const R_PROJ_X = "rp-proj-x" // decoy project in the same org: proves the project filter
const R_PROJ_RET = "rp-proj-ret"
const R_PROJ_NOSNAG = "rp-proj-nosnag"

const REAL_PG_FIXTURES = `
INSERT INTO compliance.projects (id, product_id, org_id, name) VALUES
 ('rp-proj','prod-1','rp-org','Main scenario'),
 ('rp-proj-x','prod-1','rp-org','Decoy: other project, same org'),
 ('rp-proj-ret','prod-1','rp-org','Retention scenario: every snag closed'),
 ('rp-proj-nosnag','prod-1','rp-org','No snag list yet');

INSERT INTO compliance.construction_boqs (id, org_id, project_id, version, parent_boq_id, title, status, created_by_id, approved_at, customer_approved_at) VALUES
 ('boq-v1','rp-org','rp-proj',1,NULL,'Tower','superseded','u1','2026-01-05T10:00:00Z','2026-01-06T10:00:00'),
 ('boq-v2','rp-org','rp-proj',2,'boq-v1','Tower','approved','u1','2026-01-20T10:00:00Z',NULL),
 ('boq-draft','rp-org','rp-proj',1,NULL,'Annex','draft','u1',NULL,NULL),
 ('boq-appr','rp-org','rp-proj',1,NULL,'Podium','approved','u1','2026-01-01T10:00:00Z','2026-01-02T10:00:00'),
 ('boq-c1','rp-org','rp-proj',1,NULL,'Facade','approved','u1','2026-01-03T10:00:00Z','2026-01-03T12:00:00'),
 ('boq-c2','rp-org','rp-proj',2,'boq-c1','Facade','superseded','u1',NULL,NULL),
 ('boq-c3','rp-org','rp-proj',3,'boq-c2','Facade','approved','u1','2026-01-21T10:00:00Z',NULL),
 ('boq-x-a','rp-org','rp-proj-x',1,NULL,'Decoy','approved','u1','2026-01-01T00:00:00Z',NULL),
 ('boq-x-b','rp-org','rp-proj-x',2,'boq-x-a','Decoy','approved','u1','2026-01-02T00:00:00Z',NULL),
 ('boq-x-draft','rp-org','rp-proj-x',1,NULL,'Decoy draft','draft','u1',NULL,NULL),
 ('boq-ox-a','rp-org-x','rp-proj',1,NULL,'Decoy','approved','u1','2026-01-01T00:00:00Z',NULL),
 ('boq-ox-b','rp-org-x','rp-proj',2,'boq-ox-a','Decoy','approved','u1','2026-01-02T00:00:00Z',NULL),
 ('boq-ox-draft','rp-org-x','rp-proj',1,NULL,'Decoy draft','draft','u1',NULL,NULL);

INSERT INTO compliance.construction_boq_line_items (id, boq_id, activity_id, description, unit, org_id) VALUES
 ('li-v1-a','boq-v1','act-a','Slab','m3','rp-org'),
 ('li-v2-a','boq-v2','act-a','Slab','m3','rp-org'),
 ('li-v2-new','boq-v2','act-b','Extra partition','m2','rp-org'),
 ('li-draft','boq-draft','act-c','Annex wall','m2','rp-org'),
 ('li-appr','boq-appr','act-d','Podium paving','m2','rp-org'),
 ('li-c2','boq-c2','act-f','Cladding','m2','rp-org'),
 ('li-c3','boq-c3','act-g','Cladding','m2','rp-org'),
 ('li-x-draft','boq-x-draft','act-x','Decoy','m2','rp-org'),
 ('li-ox-draft','boq-ox-draft','act-ox','Decoy','m2','rp-org-x');

INSERT INTO compliance.construction_interim_bills (id, org_id, project_id, boq_id, bill_number, bill_date, retention_amount, retention_released_amount, created_by_id) VALUES
 ('bill-1','rp-org','rp-proj','boq-v2',1,'2026-01-28',500,NULL,'u1'),
 ('bill-ret-held','rp-org','rp-proj-ret','boq-ret',1,'2026-01-28',700,NULL,'u1'),
 ('bill-ret-partial','rp-org','rp-proj-ret','boq-ret',2,'2026-01-29',400,100,'u1'),
 ('bill-ret-invoiced','rp-org','rp-proj-ret','boq-ret',5,'2026-02-01',250,NULL,'u1'),
 ('bill-ret-released','rp-org','rp-proj-ret','boq-ret',3,'2026-01-30',300,300,'u1'),
 ('bill-ret-none','rp-org','rp-proj-ret','boq-ret',4,'2026-01-31',0,NULL,'u1'),
 ('bill-nosnag','rp-org','rp-proj-nosnag','boq-ns',1,'2026-01-28',500,NULL,'u1');

UPDATE compliance.construction_interim_bills SET sales_invoice_id = 'sinv-5' WHERE id = 'bill-ret-invoiced';

INSERT INTO compliance.construction_interim_bill_line_items (id, interim_bill_id, boq_line_item_id, cumulative_amount) VALUES
 ('bl-1','bill-1','li-v2-a',3000),
 ('bl-2','bill-1','li-appr',5000);

INSERT INTO compliance.documents (id, name, file_url, org_id, is_latest_version, linked_entity_type, linked_entity_id) VALUES
 ('doc-old','Plan A rev 1','https://files.test/plan-a-r1.pdf','rp-org',false,NULL,NULL),
 ('doc-new','Plan A rev 2','https://files.test/plan-a-r2.pdf','rp-org',true,NULL,NULL),
 ('doc-ev-co1','CO-1 signed quote','https://files.test/co1.pdf','rp-org',true,'construction_change_order','co1'),
 ('doc-ev-co3','CO-3 client email','https://files.test/co3.pdf','rp-org',true,'construction_change_order','co3'),
 ('doc-ev-co8','CO-8 memo','https://files.test/co8.pdf','rp-org',true,'construction_change_order','co8'),
 ('doc-wrongtype-co2','Not CO evidence','https://files.test/boq.pdf','rp-org',true,'construction_boq','co2'),
 ('doc-otherorg-co2','Other org file','https://files.test/ox.pdf','rp-org-x',true,'construction_change_order','co2');

INSERT INTO compliance.construction_work_progress_entries (id, org_id, project_id, activity_id, entry_date, percent_complete, recorded_by_id, created_at, boq_line_item_id, entry_basis, drawing_document_id, drawing_confirmed_at) VALUES
 ('w1','rp-org','rp-proj','act-a','2026-01-10',30,'u1','2026-01-10T09:00:00Z','li-v1-a','SNAPSHOT',NULL,NULL),
 ('w2','rp-org','rp-proj','act-a','2026-01-25',50,'u1','2026-01-25T09:00:00Z','li-v2-a','SNAPSHOT',NULL,NULL),
 ('w3','rp-org','rp-proj','act-b','2026-01-15',20,'u1','2026-01-15T09:00:00Z','li-v2-new','DELTA',NULL,NULL),
 ('w4','rp-org','rp-proj','act-c','2026-01-12',10,'u1','2026-01-12T09:00:00Z','li-draft','DELTA',NULL,NULL),
 ('w5','rp-org','rp-proj','act-d','2026-01-12',0,'u1','2026-01-12T10:00:00Z','li-appr','DELTA',NULL,NULL),
 ('w6','rp-org','rp-proj','act-a','2026-01-26',40,'u1','2026-01-26T09:00:00Z','li-v2-a','SNAPSHOT',NULL,NULL),
 ('w7','rp-org','rp-proj','act-b','2026-01-27',5,'u1','2026-01-27T09:00:00Z',NULL,'DELTA',NULL,NULL),
 ('w8','rp-org','rp-proj','act-e','2026-01-11',0,'u1','2026-01-11T09:00:00Z',NULL,'DELTA','doc-old',NULL),
 ('w9','rp-org','rp-proj','act-e','2026-01-13',0,'u1','2026-01-13T09:00:00Z',NULL,'DELTA','doc-new','2026-01-13T08:00:00'),
 ('w10','rp-org','rp-proj','act-e','2026-01-13',0,'u1','2026-01-13T10:00:00Z',NULL,'DELTA','doc-new',NULL),
 ('w11','rp-org','rp-proj','act-e','2026-01-11',0,'u1','2026-01-11T10:00:00Z',NULL,'DELTA','doc-old','2026-01-11T08:00:00'),
 ('w12','rp-org','rp-proj','act-f','2026-01-13',0,'u1','2026-01-13T11:00:00Z','li-c2','DELTA',NULL,NULL),
 ('w13','rp-org','rp-proj','act-h','2026-01-16',60,'u1','2026-01-16T09:00:00Z',NULL,'SNAPSHOT',NULL,NULL),
 ('w14','rp-org','rp-proj','act-h','2026-01-16',55,'u1','2026-01-16T10:00:00Z',NULL,'SNAPSHOT',NULL,NULL),
 ('w16','rp-org','rp-proj','act-i','2026-01-16',65,'u1','2026-01-16T12:00:00Z',NULL,'SNAPSHOT',NULL,NULL),
 ('w15','rp-org','rp-proj','act-i','2026-01-16',70,'u1','2026-01-16T12:00:00Z',NULL,'SNAPSHOT',NULL,NULL),
 ('w19','rp-org','rp-proj','act-j','2026-01-16',60,'u1','2026-01-16T13:00:00.000100Z',NULL,'SNAPSHOT',NULL,NULL),
 ('w18','rp-org','rp-proj','act-j','2026-01-16',50,'u1','2026-01-16T13:00:00.000900Z',NULL,'SNAPSHOT',NULL,NULL),
 ('wx1','rp-org','rp-proj-x','act-x','2025-06-01',10,'u1','2025-06-01T09:00:00Z','li-x-draft','SNAPSHOT','doc-old',NULL),
 ('wx2','rp-org','rp-proj-x','act-x','2025-06-02',5,'u1','2025-06-02T09:00:00Z',NULL,'SNAPSHOT',NULL,NULL),
 ('wox1','rp-org-x','rp-proj','act-ox','2025-06-01',10,'u1','2025-06-01T09:00:00Z','li-ox-draft','SNAPSHOT','doc-old',NULL),
 ('wox2','rp-org-x','rp-proj','act-ox','2025-06-02',5,'u1','2025-06-02T09:00:00Z',NULL,'SNAPSHOT',NULL,NULL),
 ('wox3','rp-org-x','rp-proj','act-a','2026-01-01',5,'u1','2026-01-01T09:00:00Z',NULL,'DELTA',NULL,NULL);

INSERT INTO compliance.construction_site_diaries (id, org_id, project_id, diary_date, work_done, recorded_by_id) VALUES
 ('d1','rp-org','rp-proj','2026-01-10','Slab poured, level 2','u1'),
 ('d2','rp-org','rp-proj','2026-01-14','Extra partition built on level 3 at client request','u1'),
 ('d3','rp-org','rp-proj','2026-01-16','   ','u1'),
 ('d4','rp-org','rp-proj','2026-01-17',NULL,'u1'),
 ('dx1','rp-org','rp-proj-x','2026-01-19','Decoy work','u1'),
 ('dox1','rp-org-x','rp-proj','2026-01-18','Decoy work','u1');

INSERT INTO compliance.construction_change_orders (id, org_id, project_id, number, title, cost_impact, status, requested_by_id, approved_by_id, boq_revision_id, created_at) VALUES
 ('co1','rp-org','rp-proj',1,'Facade upgrade',5000,'approved','u1','u2','boq-c3',now() - interval '40 days'),
 ('co2','rp-org','rp-proj',2,'Extra partition',3000,'approved','u1','u1','boq-v2',now() - interval '40 days'),
 ('co3','rp-org','rp-proj',3,'Swap tile brand',0,'approved','u1','u2',NULL,now() - interval '40 days'),
 ('co4','rp-org','rp-proj',4,'Add canopy',1000,'pending_approval','u1',NULL,NULL,now() - interval '30 days'),
 ('co5','rp-org','rp-proj',5,'Add bollards',1000,'pending_approval','u1',NULL,NULL,now() - interval '1 day'),
 ('co6','rp-org','rp-proj',6,'Draft idea',1000,'draft','u1','u1',NULL,now() - interval '30 days'),
 ('co7','rp-org','rp-proj',7,'Rejected idea',1000,'rejected','u1','u2',NULL,now() - interval '60 days'),
 ('co8','rp-org','rp-proj',8,'Zero-cost facade note',0,'approved','u1','u2','boq-c3',now() - interval '40 days'),
 ('cox1','rp-org','rp-proj-x',1,'Decoy',100,'approved','u9','u9',NULL,now() - interval '30 days'),
 ('cox2','rp-org','rp-proj-x',2,'Decoy',100,'pending_approval','u9',NULL,NULL,now() - interval '30 days'),
 ('coox1','rp-org-x','rp-proj',1,'Decoy',100,'approved','u9','u9',NULL,now() - interval '30 days'),
 ('coox2','rp-org-x','rp-proj',2,'Decoy',100,'pending_approval','u9',NULL,NULL,now() - interval '30 days');

INSERT INTO compliance.construction_vendor_disputes (id, org_id, project_id, description, amount_disputed, status, raised_by_id) VALUES
 ('vd1','rp-org','rp-proj','Rebar quantity disagreement',12000,'open','u1'),
 ('vd2','rp-org','rp-proj','Settled scaffolding claim',800,'resolved','u1'),
 ('vdx','rp-org','rp-proj-x','Decoy',1,'open','u1'),
 ('vdox','rp-org-x','rp-proj','Decoy',1,'open','u1');

INSERT INTO compliance.construction_customer_complaints (id, org_id, project_id, category, description, severity, status, raised_by_id) VALUES
 ('cc1','rp-org','rp-proj','work_dispute','Tiles re-laid twice, client disputes the finish','high','open','u1'),
 ('cc2','rp-org','rp-proj','general','Site noise after 10pm','low','open','u1'),
 ('cc3','rp-org','rp-proj','work_dispute','Old dispute, settled','medium','resolved','u1'),
 ('ccx','rp-org','rp-proj-x','work_dispute','Decoy','high','open','u1'),
 ('ccox','rp-org-x','rp-proj','work_dispute','Decoy','high','open','u1');

INSERT INTO compliance.construction_materials (id, org_id, project_id, name, unit) VALUES
 ('mat-1','rp-org','rp-proj','Cement','bag'),
 ('mat-2','rp-org','rp-proj','Rebar','t'),
 ('mat-3','rp-org','rp-proj','Sand','m3'),
 ('mat-x','rp-org','rp-proj-x','Decoy','bag'),
 ('mat-ox','rp-org-x','rp-proj','Decoy','bag');

INSERT INTO compliance.construction_material_issues (id, org_id, project_id, material_id, issued_date, quantity, boq_line_item_id, created_by_id) VALUES
 ('mi1','rp-org','rp-proj','mat-1','2026-01-05',10,NULL,'u1'),
 ('mi2','rp-org','rp-proj','mat-1','2026-01-07',10,NULL,'u1'),
 ('mi3','rp-org','rp-proj','mat-2','2026-01-05',2,'li-v1-a','u1'),
 ('mi4','rp-org','rp-proj','mat-2','2026-01-20',2,'li-v2-a','u1'),
 ('mi5','rp-org','rp-proj','mat-2','2026-01-22',2,'li-v2-a','u1'),
 ('mi6','rp-org','rp-proj','mat-1','2026-01-05',4,NULL,'u1'),
 ('mi8','rp-org','rp-proj','mat-3','2026-01-09',3,NULL,'u1'),
 ('mi7','rp-org','rp-proj','mat-3','2026-01-09',3,NULL,'u1'),
 ('mix1','rp-org','rp-proj-x','mat-x','2026-01-05',1,NULL,'u1'),
 ('mix2','rp-org','rp-proj-x','mat-x','2026-01-06',1,NULL,'u1'),
 ('miox1','rp-org-x','rp-proj','mat-ox','2026-01-05',1,NULL,'u1'),
 ('miox2','rp-org-x','rp-proj','mat-1','2026-01-06',1,NULL,'u1');

INSERT INTO compliance.construction_labour_roster (id, org_id, project_id, name, is_active, employee_id) VALUES
 ('r1','rp-org','rp-proj','Falcon gang 3',true,NULL),
 ('r2','rp-org','rp-proj','Mason A',true,'emp-1'),
 ('r3','rp-org','rp-proj','Helper B (left site)',false,NULL),
 ('rx','rp-org','rp-proj-x','Decoy',true,NULL),
 ('rox','rp-org-x','rp-proj','Decoy',true,NULL);

INSERT INTO compliance.construction_punch_list_items (id, org_id, project_id, number, description, status, due_date, created_by_id) VALUES
 ('p1','rp-org','rp-proj',1,'Paint touch-up, lobby','open','2020-01-01','u1'),
 ('p2','rp-org','rp-proj',2,'Door closer','open','2099-01-01','u1'),
 ('p3','rp-org','rp-proj',3,'Skirting','verified_closed','2020-01-01','u1'),
 ('p4','rp-org','rp-proj',4,'Grout','ready_for_review','2020-01-02','u1'),
 ('p5','rp-org','rp-proj',5,'Signage','open',NULL,'u1'),
 ('px','rp-org','rp-proj-x',1,'Decoy','open','2020-01-01','u1'),
 ('pox','rp-org-x','rp-proj',1,'Decoy','open','2020-01-01','u1'),
 ('pr1','rp-org','rp-proj-ret',1,'Final clean','verified_closed','2020-01-01','u1'),
 ('pr2','rp-org','rp-proj-ret',2,'Handrail','verified_closed',NULL,'u1'),
 ('prox','rp-org-x','rp-proj-ret',1,'Decoy open snag in another org','open','2099-01-01','u1');

INSERT INTO compliance.erp_purchase_invoices (id, org_id, supplier_id, invoice_number, posting_date, status) VALUES
 ('pinv-1','rp-org','sup-1',1,'2026-01-28','submitted'),
 ('pinv-2','rp-org','sup-1',2,'2026-01-28','cancelled'),
 ('pinv-3','rp-org','sup-2',3,'2026-01-29','paid');

INSERT INTO compliance.erp_purchase_invoice_items (id, invoice_id, description, amount, boq_line_item_id) VALUES
 ('pii1','pinv-1','Partition labour',2000,'li-v2-a'),
 ('pii2','pinv-3','Partition labour balance',2000,'li-v2-a'),
 ('pii3','pinv-1','Paving labour',4000,'li-appr'),
 ('pii4','pinv-2','Paving labour (cancelled invoice)',9000,'li-appr'),
 ('pii5','pinv-1','Extra partition labour',100,'li-v2-new'),
 ('piix','pinv-1','Decoy on another project''s BOQ line',99999,'li-x-draft');
`

/** Hand-derived from REAL_PG_FIXTURES above -- see each line's reasoning. */
const R_EXPECTED: Record<number, string[]> = {
  1: ["d2"], // d1 has w1 that day; d3 blank; d4 NULL; dx1/dox1 decoys
  8: ["d2"], // same detector as #1
  2: ["co1"], // co1 -> boq-c3 (li-c3 never billed). co2 -> boq-v2 (li-v2-a billed). co3/co8 cost 0
  3: ["w10", "w8"], // drawing named, drawing_confirmed_at NULL. w9/w11 confirmed
  4: ["w11", "w8"], // named drawing doc-old is_latest_version=false. w9/w10 name doc-new
  5: ["co4"], // pending 30d. co5 pending 1d; co6 draft; decoys cox2/coox2
  6: ["co2"], // approved by its own requester. co6 is a draft; decoys cox1/coox1
  7: ["w12", "w3", "w4"], // w3 dated before boq-v2's approval; w4 draft BOQ; w12 superseded, never approved. w1: superseded but WAS approved before it
  9: ["li-draft", "li-v1-a", "li-v2-new"], // progress > 0 and never billed. li-v2-a billed; li-appr progress 0
  10: ["vd1"],
  11: ["cc1"], // open AND work_dispute. cc2 general; cc3 resolved
  12: ["cc1", "cc2"],
  13: ["boq-c2", "boq-c3", "boq-v2"], // parent_boq_id set
  14: ["boq-c2", "boq-c3", "boq-v2"], // same detector as #13
  15: ["boq-c3", "boq-v2"], // approved, customer_approved_at NULL. boq-appr/boq-c1 have it
  16: ["boq-c3", "boq-v2"], // same detector as #15
  17: ["co3"], // approved, no BOQ revision linked
  18: ["mi1", "mi2", "mi6", "mi7", "mi8"], // no BOQ line
  // mat-1 ordered (date, id): mi1, mi6 (same day -> mi6 is the re-issue), mi2 (2 days after mi6).
  // mat-3: mi8 is INSERTED before mi7 on the same day, so id order (mi7, mi8) is the opposite of insertion
  // order -- between this pair and mi1/mi6 (inserted in id order), any tie order other than id is caught.
  // mat-2: mi3 01-05 on time; mi4 01-20 late (act-a progress from 01-10); mi5 01-22 late AND 2 days after mi4 -> ONE record.
  19: ["mi2", "mi4", "mi5", "mi6", "mi8"],
  20: ["2026-01-11", "2026-01-12", "2026-01-13", "2026-01-15", "2026-01-18", "2026-01-19", "2026-01-20", "2026-01-21", "2026-01-22", "2026-01-23", "2026-01-24", "2026-01-25", "2026-01-26", "2026-01-27"],
  21: ["r1"], // active, no employee. r2 linked; r3 inactive
  22: ["boq-c3"], // boq-c1 approved -> boq-c2 superseded -> boq-c3 approved
  23: ["pii1", "pii2", "pii5"], // li-v2-a: 2000+2000 > 3000 billed; li-v2-new: 100 > 0. li-appr: 4000 <= 5000 once cancelled pinv-2 is excluded
  24: ["p1", "p4"], // overdue and not verified_closed. p2 future; p3 closed; p5 no due date. Retention half: snags still open here
  25: ["co2"], // approved with no construction_change_order evidence doc in THIS org
  26: [], // filled from #20 below (same detector)
  27: ["mi1", "mi2", "mi6", "mi7", "mi8"], // same detector as #18
  // w6 40% after w2 50% (act-a); w14 55% after w13 60% same day, later created_at;
  // w16 65% after w15 70% -- same day AND same created_at, so id order (w15, w16) decides.
  // w18 50% after w19 60% -- same day and same MILLISECOND, 800 microseconds later: only Postgres's own
  // microsecond ordering sees it (a JS Date sort would fall back to id order w18, w19 and miss it). w3->w7 drop is DELTA
  28: ["w14", "w16", "w18", "w6"],
}
R_EXPECTED[26] = R_EXPECTED[20]

/** The record type each item's rows carry -- what PROJEXA's ExceptionsClient.recordHref() maps to a drill-down screen. */
const R_RECORD_TYPE: Record<number, string> = {
  1: "site_diary", 8: "site_diary", 2: "change_order", 3: "work_progress_entry", 4: "work_progress_entry",
  5: "change_order", 6: "change_order", 7: "work_progress_entry", 9: "boq_line_item", 10: "vendor_dispute",
  11: "customer_complaint", 12: "customer_complaint", 13: "boq", 14: "boq", 15: "boq", 16: "boq", 17: "change_order",
  18: "material_issue", 19: "material_issue", 20: "date", 21: "labour_roster", 22: "boq", 23: "invoice_item",
  24: "punch_list_item", 25: "change_order", 26: "date", 27: "material_issue", 28: "work_progress_entry",
}

describe("real Postgres (PGlite, live schema snapshot): getProjectExceptionsWithDb", () => {
  let pglite: PGlite
  let main: svc.ExceptionCheck[] = []
  let retention: svc.ExceptionCheck[] = []
  let noSnags: svc.ExceptionCheck[] = []
  let db: unknown

  beforeAll(async () => {
    pglite = await PGlite.create()
    await pglite.exec(readFileSync(new URL("../../../scripts/verify/fixtures/construction-exceptions-service.base.sql", import.meta.url), "utf8"))
    await pglite.exec(REAL_PG_FIXTURES)
    db = drizzle(pglite, { schema })
    main = await svc.getProjectExceptionsWithDb(db as never, { orgId: R_ORG }, R_PROJ)
    retention = await svc.getProjectExceptionsWithDb(db as never, { orgId: R_ORG }, R_PROJ_RET)
    noSnags = await svc.getProjectExceptionsWithDb(db as never, { orgId: R_ORG }, R_PROJ_NOSNAG)
  }, 120_000)

  afterAll(async () => {
    await pglite?.close()
  })

  const ids = (checks: svc.ExceptionCheck[], item: number) => checks.find((c) => c.item === item)!.records.map((r) => r.id).sort()
  const check = (checks: svc.ExceptionCheck[], item: number) => checks.find((c) => c.item === item)!

  function expectItem(item: number) {
    const c = check(main, item)
    expect(ids(main, item)).toEqual([...R_EXPECTED[item]].sort())
    expect(c.count).toBe(R_EXPECTED[item].length)
    expect(c.flagged).toBe(R_EXPECTED[item].length > 0)
    for (const r of c.records) expect(r.recordType as string).toBe(R_RECORD_TYPE[item])
  }

  test("real Postgres: the report has exactly the 28 numbered items, each once", () => {
    expect(main.map((c) => c.item).sort((a, b) => a - b)).toEqual(Array.from({ length: 28 }, (_, i) => i + 1))
  })

  test("real Postgres #01 findDiaryWithoutProgressEntry: only the diary with real work text and no progress entry that day", () => expectItem(1))
  test("real Postgres #02 findApprovedChangeOrdersNeverBilled: only the approved, priced CO whose BOQ revision was never billed", () => expectItem(2))
  test("real Postgres #03 findUnconfirmedDrawingProgress: only progress naming a drawing with no confirmation", () => expectItem(3))
  test("real Postgres #04 findOldDrawingProgress: only progress built from a superseded drawing version", () => expectItem(4))
  test("real Postgres #05 findStuckApprovals: only the CO pending_approval for over the threshold", () => expectItem(5))
  test("real Postgres #06 findSelfApprovedChangeOrders: only the approved CO its own requester approved", () => expectItem(6))
  test("real Postgres #07 findWorkWithoutApprovedBoq: never-approved BOQs and work dated before approval, not work under a BOQ approved at the time", () => expectItem(7))
  test("real Postgres #08 findDiaryWithoutProgressEntry (shared with #1): the same diary", () => {
    expectItem(8)
    expect(check(main, 8).records).toEqual(check(main, 1).records)
  })
  test("real Postgres #09 findProgressNeverBilled: only BOQ lines with progress > 0 and no interim bill, linked to their parent BOQ", () => {
    expectItem(9)
    const linkByLine = Object.fromEntries(check(main, 9).records.map((r) => [r.id, r.linkId]))
    expect(linkByLine).toEqual({ "li-draft": "boq-draft", "li-v1-a": "boq-v1", "li-v2-new": "boq-v2" })
  })
  test("real Postgres #10 findOpenVendorDisputes: only the open dispute on this project", () => expectItem(10))
  test("real Postgres #11 findOpenCustomerComplaints(work_dispute): only the open work_dispute complaint", () => expectItem(11))
  test("real Postgres #12 findOpenCustomerComplaints: every open complaint on this project, any category", () => expectItem(12))
  test("real Postgres #13 findNewBoqRevisions: only BOQs that are revisions (parent set)", () => expectItem(13))
  test("real Postgres #14 findNewBoqRevisions (shared with #13): the same revisions", () => expectItem(14))
  test("real Postgres #15 findBoqWithoutCustomerApproval: only approved BOQs with no customer approval on record", () => expectItem(15))
  test("real Postgres #16 findBoqWithoutCustomerApproval (shared with #15): the same BOQs", () => expectItem(16))
  test("real Postgres #17 findApprovalsWithoutBoqComparison: only the approved CO with no BOQ revision linked", () => expectItem(17))
  test("real Postgres #18 findMaterialWithoutBoqLine: only issues with no BOQ line, linked to the material's own screen", () => {
    expectItem(18)
    const materialByIssue = Object.fromEntries(check(main, 18).records.map((r) => [r.id, r.linkId]))
    expect(materialByIssue).toEqual({ mi1: "mat-1", mi2: "mat-1", mi6: "mat-1", mi7: "mat-3", mi8: "mat-3" })
  })
  test("real Postgres #19 findLateOrDuplicateMaterial: the re-issue inside the window and the issue after progress started, each issue once", () => {
    expectItem(19)
    const mi5 = check(main, 19).records.find((r) => r.id === "mi5")!
    expect(mi5.detail).toContain("possible duplicate order")
    expect(mi5.detail).toContain("arrived late")
  })
  test("real Postgres #20 findMissingDailyReports: every day in the project's progress range with no diary, and nothing outside it", () => expectItem(20))
  test("real Postgres #21 findUnlinkedRoster: only the active roster entry with no employee profile", () => expectItem(21))
  test("real Postgres #22 findAmbiguousBoqVersions: the approved v3 whose v1 is still approved two links up the chain", () => expectItem(22))
  test("real Postgres #23 findMismatchedSubcontractorInvoices: lines on BOQ lines over-invoiced in total, cancelled invoices excluded", () => expectItem(23))
  test("real Postgres #24 findOverdueSnags + findRetentionHeldDespiteSnagsClosed: overdue open snags; retention not flagged while snags are open", () => expectItem(24))
  test("real Postgres #24 findRetentionHeldDespiteSnagsClosed: every snag closed -> only the bills still holding retention; no snags -> nothing", () => {
    expect(ids(retention, 24)).toEqual(["bill-ret-held", "bill-ret-invoiced", "bill-ret-partial"])
    for (const r of check(retention, 24).records) expect(r.recordType as string).toBe("interim_bill")
    // Drill-down: an invoiced bill carries its sales invoice id (the real
    // /invoices/[id] screen); a bill not yet invoiced carries no linkId.
    const linkByBill = Object.fromEntries(check(retention, 24).records.map((r) => [r.id, r.linkId ?? null]))
    expect(linkByBill).toEqual({ "bill-ret-held": null, "bill-ret-invoiced": "sinv-5", "bill-ret-partial": null })
    expect(ids(noSnags, 24)).toEqual([])
  })
  test("real Postgres #25 findApprovalsWithoutEvidence: only the approved CO with no evidence document of the right type in this org", () => expectItem(25))
  test("real Postgres #26 findMissingDailyReports (shared with #20): the same days", () => expectItem(26))
  test("real Postgres #27 findMaterialWithoutBoqLine (shared with #18): the same issues", () => expectItem(27))
  test("real Postgres #28 findProgressRegressions: SNAPSHOT drops only, same-day ties ordered by created_at", () => expectItem(28))

  test("real Postgres: a project with only closed snags and retention flags ONLY #24; a project with no data is fully clear", () => {
    expect(retention.filter((c) => c.flagged).map((c) => c.item)).toEqual([24])
    expect(noSnags.filter((c) => c.flagged)).toEqual([])
    expect(noSnags).toHaveLength(28)
  })

  test("real Postgres: the same project id under a different org is a 404, never another tenant's report", async () => {
    let caught: unknown
    try {
      await svc.getProjectExceptionsWithDb(db as never, { orgId: R_ORG_X }, R_PROJ)
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(svc.ServiceError)
    expect((caught as InstanceType<typeof svc.ServiceError>).status).toBe(404)
  })

  test("real Postgres: decoy rows (other project, other org) never leak into any item", () => {
    const allFlagged = main.flatMap((c) => c.records.map((r) => r.id))
    for (const decoy of ["dx1", "dox1", "wx1", "wx2", "wox1", "wox2", "wox3", "cox1", "cox2", "coox1", "coox2", "vdx", "vdox", "ccx", "ccox", "mix1", "mix2", "miox1", "miox2", "rx", "rox", "px", "pox", "boq-x-a", "boq-x-b", "boq-ox-a", "boq-ox-b", "li-x-draft", "li-ox-draft", "piix", "2025-06-01"]) {
      expect(allFlagged).not.toContain(decoy)
    }
    expect(R_PROJ_X).not.toBe(R_PROJ)
  })
})
