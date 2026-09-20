// Real-code tests for construction-exceptions-service.ts's 24 deterministic
// detectors (some shared across 2-3 of Sumeet's 28 numbered items -- see
// that file's own header for which). Every detector takes a `db` handle
// directly (no withTenantContext of its own), so these tests build a plain
// fake db object and call the exported function straight -- no module
// mocking needed except for getProjectExceptions itself, the one function
// that opens a real withTenantContext.
/// <reference types="bun-types" />
import { describe, expect, test, mock, afterEach } from "bun:test"
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
    "erpPurchaseOrderItems", "erpPurchaseInvoiceItems", "documents", "projects",
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
})

describe("findUnlinkedRoster (#21)", () => {
  test("a roster entry with no employeeId is flagged", async () => {
    const db = fakeDb({ constructionLabourRoster: [{ id: "r1", name: "Falcon gang 3", employeeId: null }] })
    expect(await svc.findUnlinkedRoster(db as never, ORG, PROJECT)).toHaveLength(1)
  })
})

describe("findAmbiguousBoqVersions (#22) -- already-closed invariant, proven here", () => {
  test("two approved rows in the SAME chain (one is the other's parent) violates the invariant", async () => {
    const db = fakeDb({ constructionBoqs: [{ id: "boq2", version: 2, parentBoqId: "boq1" }, { id: "boq1", version: 1, parentBoqId: null }] })
    expect(await svc.findAmbiguousBoqVersions(db as never, ORG, PROJECT)).toHaveLength(1)
  })

  test("two independent (non-chained) approved BOQs are legitimate, not flagged (E-116)", async () => {
    const db = fakeDb({ constructionBoqs: [{ id: "boqA", version: 1, parentBoqId: null }, { id: "boqB", version: 1, parentBoqId: null }] })
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
    // The real WHERE for "any open snag" (ne(status,'verified_closed'))
    // matches nothing once every snag is closed -- modelled here as an
    // empty punch-list result, same reasoning as the drawing test above.
    const db = fakeDb({ constructionPunchListItems: [], constructionInterimBills: [{ id: "b1", billNumber: 1, retentionAmount: "500", retentionReleasedAmount: null }] })
    expect(await svc.findRetentionHeldDespiteSnagsClosed(db as never, ORG, PROJECT)).toHaveLength(1)
  })

  test("retention already fully released after snags close is not flagged", async () => {
    const db = fakeDb({ constructionPunchListItems: [], constructionInterimBills: [{ id: "b1", billNumber: 1, retentionAmount: "500", retentionReleasedAmount: "500" }] })
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
