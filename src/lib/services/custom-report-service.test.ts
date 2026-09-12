/// <reference types="bun-types" />
// New coverage for custom-report-service.ts, required by
// scripts/check-new-test-coverage.mjs ("Previously-untested files touched")
// on PR #1663 (saved_reports/capability-tree userId fix). Zero coverage
// existed on main for this file before this commit. Per
// F-2026-0910-W-PROD-014.
//
// Same convention as this window's own auth-failure-service.test.ts and
// sso-service.test.ts: mock.module() every dependency, reset controllable
// state in beforeEach, import the function under test AFTER mocks are set
// up. ./compliance-service is mocked with a minimal, faithful ServiceError
// re-implementation, NOT the real file -- importing the real file pulls in
// its own much larger @/lib/db export surface and throws the exact "Export
// named X not found" SyntaxError F-2026-0910-W-PROD-009 already diagnosed.
//
// This file also proves this window's own W-PROD fix in place: all five
// mutating/reading functions (listSavedReports, createSavedReport,
// updateSavedReport, deleteSavedReport, runReport) were rewritten
// 2026-09-10 to pass userId into withTenantContext -- this test asserts the
// REAL argument withTenantContext is called with, not just that a function
// returns without throwing.
import { describe, expect, test, mock, beforeEach } from "bun:test"

class MockServiceError extends Error {
  public status: number
  public kind: string
  constructor(message: string, status: number, opts?: { kind?: string }) {
    super(message)
    this.status = status
    this.kind = opts?.kind ?? (status >= 500 ? "system" : "business")
  }
}
mock.module("./compliance-service", () => ({ ServiceError: MockServiceError }))

// Distinct, real (not `{}`) column stand-ins so eq()/and() (the REAL
// drizzle-orm functions, not mocked -- they are pure builders, no DB
// connection) have real column-shaped values to reference, and so equality
// assertions on captured where-clauses are meaningful.
function col(name: string) {
  return { name }
}
const savedReportsTable = { id: col("id"), orgId: col("orgId") }
const complianceItemsTable = { orgId: col("orgId"), status: col("status"), priority: col("priority"), departmentId: col("departmentId") }
const noticesTable = { orgId: col("orgId"), status: col("status"), authority: col("authority") }
const constructionAttendanceTable = { orgId: col("orgId"), status: col("status"), rosterId: col("rosterId") }

mock.module("@/lib/db", () => ({
  savedReports: savedReportsTable,
  complianceItems: complianceItemsTable,
  notices: noticesTable,
  risks: {}, pmsIssues: {}, incidents: {}, constructionBoqs: {},
  constructionWorkProgressEntries: {},
  constructionAttendance: constructionAttendanceTable,
}))

let tenantContextCalls: Array<{ orgId: string; userId?: string }> = []
let fakeFindFirstResult: Record<string, unknown> | undefined
let fakeFindManyResult: Array<Record<string, unknown>> = []
let insertReturning: Array<Record<string, unknown>> = []
let updateReturning: Array<Record<string, unknown>> = []
let deleteCalled = false
// select().from().where() is awaited directly for the ungrouped "Total"
// branch, and has .groupBy(col) chained for the grouped branch -- a real
// drizzle query builder supports both shapes off the same call. Modelled
// here as a real Promise (for direct await) with a .groupBy method attached
// (for the chained form), matching the actual shape runReport() calls both
// ways depending on whether the report has a groupByField.
let ungroupedCountRows: Array<{ count: number }> = [{ count: 0 }]
let groupedRows: Array<{ groupValue: unknown; count: number }> = []

mock.module("@/lib/db/tenant-scoped", () => ({
  withTenantContext: async (ctx: { orgId: string; userId?: string }, fn: (tx: unknown) => unknown) => {
    tenantContextCalls.push(ctx)
    const fakeDb = {
      query: {
        savedReports: {
          findFirst: async () => fakeFindFirstResult,
          findMany: async () => fakeFindManyResult,
        },
      },
      insert: () => ({ values: () => ({ returning: async () => insertReturning }) }),
      update: () => ({ set: () => ({ where: () => ({ returning: async () => updateReturning }) }) }),
      delete: () => ({ where: async () => { deleteCalled = true } }),
      select: () => ({
        from: () => ({
          where: () => {
            const p = Promise.resolve(ungroupedCountRows) as Promise<Array<{ count: number }>> & { groupBy: (c: unknown) => Promise<typeof groupedRows> }
            p.groupBy = async () => groupedRows
            return p
          },
        }),
      }),
    }
    return fn(fakeDb)
  },
}))

beforeEach(() => {
  tenantContextCalls = []
  fakeFindFirstResult = undefined
  fakeFindManyResult = []
  insertReturning = []
  updateReturning = []
  deleteCalled = false
  ungroupedCountRows = [{ count: 0 }]
  groupedRows = []
})

describe("isValidSourceEntity / isValidGroupByField", () => {
  test("accepts every real whitelisted sourceEntity, rejects an unknown one", async () => {
    const { isValidSourceEntity } = await import("./custom-report-service")
    expect(isValidSourceEntity("compliance_items")).toBe(true)
    expect(isValidSourceEntity("construction_attendance")).toBe(true)
    expect(isValidSourceEntity("not_a_real_table")).toBe(false)
    // The AI-generated pseudo-entity is deliberately NOT in the whitelist --
    // it is a different, non-live code path entirely (this file's own header).
    expect(isValidSourceEntity("ai_generated")).toBe(false)
  })

  test("accepts only the real per-entity groupByField whitelist", async () => {
    const { isValidGroupByField } = await import("./custom-report-service")
    expect(isValidGroupByField("compliance_items", "priority")).toBe(true)
    expect(isValidGroupByField("compliance_items", "authority")).toBe(false) // that's a notices field
    expect(isValidGroupByField("notices", "authority")).toBe(true)
  })
})

describe("listSavedReports -- userId threading (BUG FIX 2026-09-10)", () => {
  test("passes the REAL userId into withTenantContext, not just orgId", async () => {
    fakeFindManyResult = [{ id: "r1", name: "Report 1" }]
    const { listSavedReports } = await import("./custom-report-service")
    const result = await listSavedReports({ orgId: "org-1", userId: "user-1" })

    expect(tenantContextCalls).toEqual([{ orgId: "org-1", userId: "user-1" }])
    expect(result).toEqual(fakeFindManyResult)
  })
})

describe("createSavedReport -- validation", () => {
  const ctx = { orgId: "org-1", userId: "user-1", dbUser: {} as never }

  test("rejects a missing/blank name with a real ServiceError(400)", async () => {
    const { createSavedReport } = await import("./custom-report-service")
    await expect(createSavedReport(ctx, { name: "   ", sourceEntity: "compliance_items" })).rejects.toMatchObject({ status: 400, message: "name is required" })
  })

  test("rejects an unknown sourceEntity with a real ServiceError(400) naming the real whitelist", async () => {
    const { createSavedReport } = await import("./custom-report-service")
    await expect(createSavedReport(ctx, { name: "Report", sourceEntity: "not_a_real_table" })).rejects.toMatchObject({ status: 400 })
  })

  test("rejects a groupByField that isn't in that sourceEntity's own whitelist", async () => {
    const { createSavedReport } = await import("./custom-report-service")
    await expect(createSavedReport(ctx, { name: "Report", sourceEntity: "notices", groupByField: "priority" })).rejects.toMatchObject({ status: 400 })
  })

  test("ai_generated sourceEntity requires aiGeneratedData with real columns[]/rows[] arrays", async () => {
    const { createSavedReport } = await import("./custom-report-service")
    await expect(createSavedReport(ctx, { name: "AI Report", sourceEntity: "ai_generated" })).rejects.toMatchObject({ status: 400 })
    await expect(createSavedReport(ctx, { name: "AI Report", sourceEntity: "ai_generated", aiGeneratedData: { columns: "not-an-array", rows: [] } })).rejects.toMatchObject({ status: 400 })
  })

  test("a valid report is created, passing the real userId into withTenantContext as BOTH ownedById and the tenant context userId", async () => {
    insertReturning = [{ id: "new-report", orgId: "org-1", name: "Report", sourceEntity: "compliance_items" }]
    const { createSavedReport } = await import("./custom-report-service")
    const result = await createSavedReport(ctx, { name: "Report", sourceEntity: "compliance_items", groupByField: "status" })

    expect(result).toEqual(insertReturning[0])
    expect(tenantContextCalls).toEqual([{ orgId: "org-1", userId: "user-1" }])
  })
})

describe("updateSavedReport / deleteSavedReport -- userId threading and 404 (BUG FIX 2026-09-10)", () => {
  test("updateSavedReport throws a real ServiceError(404) when the report doesn't exist for this org, and still threads userId", async () => {
    fakeFindFirstResult = undefined
    const { updateSavedReport } = await import("./custom-report-service")
    await expect(updateSavedReport({ orgId: "org-1", userId: "user-1" }, "missing-report", { name: "New name" })).rejects.toMatchObject({ status: 404, message: "Report not found" })
    expect(tenantContextCalls).toEqual([{ orgId: "org-1", userId: "user-1" }])
  })

  test("updateSavedReport updates an existing (including the owner's own PRIVATE) report", async () => {
    fakeFindFirstResult = { id: "r1", orgId: "org-1", visibility: "private", ownedById: "user-1" }
    updateReturning = [{ id: "r1", orgId: "org-1", name: "Renamed" }]
    const { updateSavedReport } = await import("./custom-report-service")
    const result = await updateSavedReport({ orgId: "org-1", userId: "user-1" }, "r1", { name: "Renamed" })
    expect(result).toEqual(updateReturning[0])
  })

  test("deleteSavedReport throws a real ServiceError(404) when the report doesn't exist for this org", async () => {
    fakeFindFirstResult = undefined
    const { deleteSavedReport } = await import("./custom-report-service")
    await expect(deleteSavedReport({ orgId: "org-1", userId: "user-1" }, "missing-report")).rejects.toMatchObject({ status: 404 })
    expect(deleteCalled).toBe(false)
  })

  test("deleteSavedReport deletes an existing report and threads the real userId", async () => {
    fakeFindFirstResult = { id: "r1", orgId: "org-1" }
    const { deleteSavedReport } = await import("./custom-report-service")
    await deleteSavedReport({ orgId: "org-1", userId: "user-1" }, "r1")
    expect(deleteCalled).toBe(true)
    expect(tenantContextCalls).toEqual([{ orgId: "org-1", userId: "user-1" }])
  })
})

describe("runReport -- ai_generated static echo path", () => {
  test("echoes the stored AI proposal's chartRows and aiGeneratedData, without touching any live table", async () => {
    fakeFindFirstResult = {
      id: "r1", orgId: "org-1", sourceEntity: "ai_generated",
      aiGeneratedData: { chartRows: [{ groupValue: "A", count: 3 }], columns: ["A"], rows: [["A", 3]] },
    }
    const { runReport } = await import("./custom-report-service")
    const result = await runReport({ orgId: "org-1", userId: "user-1" }, "r1")
    expect(result.rows).toEqual([{ groupValue: "A", count: 3 }])
    expect(result.aiGeneratedData).toEqual(fakeFindFirstResult!.aiGeneratedData)
  })

  test("an ai_generated report with no chartRows yet still returns cleanly with an empty rows array, not a crash", async () => {
    fakeFindFirstResult = { id: "r1", orgId: "org-1", sourceEntity: "ai_generated", aiGeneratedData: null }
    const { runReport } = await import("./custom-report-service")
    const result = await runReport({ orgId: "org-1", userId: "user-1" }, "r1")
    expect(result.rows).toEqual([])
  })
})

describe("runReport -- live whitelisted queries, real userId threading (BUG FIX 2026-09-10)", () => {
  test("throws a real ServiceError(404) when the report doesn't exist for this org (the false-'Report not found' bug for a private report's own owner)", async () => {
    fakeFindFirstResult = undefined
    const { runReport } = await import("./custom-report-service")
    await expect(runReport({ orgId: "org-1", userId: "user-1" }, "missing")).rejects.toMatchObject({ status: 404 })
    expect(tenantContextCalls).toEqual([{ orgId: "org-1", userId: "user-1" }])
  })

  test("a report with no groupByField returns the real ungrouped Total row, not a hardcoded 0", async () => {
    fakeFindFirstResult = { id: "r1", orgId: "org-1", sourceEntity: "compliance_items", groupByField: null }
    ungroupedCountRows = [{ count: 42 }]
    const { runReport } = await import("./custom-report-service")
    const result = await runReport({ orgId: "org-1", userId: "user-1" }, "r1")
    expect(result.rows).toEqual([{ groupValue: "Total", count: 42 }])
  })

  test("a report with a real whitelisted groupByField returns the real grouped rows", async () => {
    fakeFindFirstResult = { id: "r1", orgId: "org-1", sourceEntity: "compliance_items", groupByField: "status" }
    groupedRows = [{ groupValue: "open", count: 5 }, { groupValue: "closed", count: 12 }]
    const { runReport } = await import("./custom-report-service")
    const result = await runReport({ orgId: "org-1", userId: "user-1" }, "r1")
    expect(result.rows).toEqual(groupedRows)
  })

  test("a groupByField NOT in that sourceEntity's own whitelist is silently ignored, falling back to Total -- never an invalid column reaches the query", async () => {
    fakeFindFirstResult = { id: "r1", orgId: "org-1", sourceEntity: "notices", groupByField: "priority" } // priority is compliance_items' field, not notices'
    ungroupedCountRows = [{ count: 7 }]
    const { runReport } = await import("./custom-report-service")
    const result = await runReport({ orgId: "org-1", userId: "user-1" }, "r1")
    expect(result.rows).toEqual([{ groupValue: "Total", count: 7 }])
  })

  test("a construction-domain sourceEntity (construction_attendance) runs the same real switch branch", async () => {
    fakeFindFirstResult = { id: "r1", orgId: "org-1", sourceEntity: "construction_attendance", groupByField: "rosterId" }
    groupedRows = [{ groupValue: "roster-a", count: 4 }]
    const { runReport } = await import("./custom-report-service")
    const result = await runReport({ orgId: "org-1", userId: "user-1" }, "r1")
    expect(result.rows).toEqual(groupedRows)
  })

  test("an invalid/corrupted sourceEntity on the stored row throws a real ServiceError(400), not a silent empty result", async () => {
    fakeFindFirstResult = { id: "r1", orgId: "org-1", sourceEntity: "not_a_real_table", groupByField: null }
    const { runReport } = await import("./custom-report-service")
    await expect(runReport({ orgId: "org-1", userId: "user-1" }, "r1")).rejects.toMatchObject({ status: 400, message: "Report has an invalid sourceEntity" })
  })
})
