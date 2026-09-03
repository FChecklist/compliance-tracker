// R67 D-31 (R-090). This file had NO sibling test before this change, and the
// change is a real widening of a PUBLIC, UNAUTHENTICATED surface: the share
// mechanism behind /api/reports/share/[token] now carries a second report type
// (the trade-wise attendance summary) as well as the work progress report.
//
// What must not slip, and is asserted here:
//   - the usability rule (revoked / expired / unknown are all "no"), which is
//     the ONLY thing standing between a token and org data;
//   - that a bad request is refused BEFORE a transaction is opened, so a
//     malformed reportRef can never reach the database;
//   - that widening the type list did not turn it into "anything goes".
//
// No live DB: withTenantContext is mocked, this repo's established pattern (see
// construction-progress-service.test.ts's own header for why that is honest).
/// <reference types="bun-types" />
import { describe, expect, test, mock, beforeEach, afterEach } from "bun:test"

const ORG = "org-d31"

let insertedValues: Record<string, unknown>[] = []
let tenantCalls = 0

const fakeTx = {
  insert: () => ({
    values: (v: Record<string, unknown>) => ({
      returning: async () => {
        insertedValues.push(v)
        return [{ ...v, id: "link-1" }]
      },
    }),
  }),
}

const mockWithTenantContext = mock(async (_ctx: { orgId: string }, fn: (db: unknown) => Promise<unknown>) => {
  tenantCalls += 1
  return fn(fakeTx as unknown as never)
})

const realTenantScoped = await import("@/lib/db/tenant-scoped")
async function restoreRealModules(): Promise<void> {
  await mock.module("@/lib/db/tenant-scoped", () => realTenantScoped)
}

beforeEach(() => {
  insertedValues = []
  tenantCalls = 0
  mockWithTenantContext.mockClear()
})

afterEach(async () => {
  mock.restore()
  await restoreRealModules()
})

describe("isShareLinkUsable -- the whole guard on a public, unauthenticated route", () => {
  test("a live link is usable", async () => {
    const { isShareLinkUsable } = await import("./report-share-service")
    const now = new Date("2026-09-03T10:00:00Z")
    expect(isShareLinkUsable({ revokedAt: null, expiresAt: new Date("2026-09-10T10:00:00Z") }, now)).toBe(true)
  })

  test("a revoked link is not usable, even before its expiry", async () => {
    const { isShareLinkUsable } = await import("./report-share-service")
    const now = new Date("2026-09-03T10:00:00Z")
    expect(isShareLinkUsable({ revokedAt: new Date("2026-09-01T10:00:00Z"), expiresAt: new Date("2026-09-10T10:00:00Z") }, now)).toBe(false)
  })

  test("an expired link is not usable", async () => {
    const { isShareLinkUsable } = await import("./report-share-service")
    const now = new Date("2026-09-03T10:00:00Z")
    expect(isShareLinkUsable({ revokedAt: null, expiresAt: new Date("2026-09-02T10:00:00Z") }, now)).toBe(false)
  })

  test("a link expiring exactly now is still usable -- the boundary is inclusive, not a race", async () => {
    const { isShareLinkUsable } = await import("./report-share-service")
    const now = new Date("2026-09-03T10:00:00Z")
    expect(isShareLinkUsable({ revokedAt: null, expiresAt: now }, now)).toBe(true)
  })

  test("an unknown token (no row) is not usable, and is answered identically to expired", async () => {
    const { isShareLinkUsable } = await import("./report-share-service")
    expect(isShareLinkUsable(null, new Date())).toBe(false)
    expect(isShareLinkUsable(undefined, new Date())).toBe(false)
  })
})

describe("createReportShareLink -- R67 D-31 widening", () => {
  test("both report types are shareable, and nothing else is", async () => {
    const { SHAREABLE_REPORT_TYPES } = await import("./report-share-service")
    expect([...SHAREABLE_REPORT_TYPES]).toEqual(["work_progress", "attendance_summary"])
  })

  test("an unsupported report type is refused BEFORE any transaction is opened", async () => {
    await mock.module("@/lib/db/tenant-scoped", () => ({ withTenantContext: mockWithTenantContext }))
    const { createReportShareLink, ServiceError } = await import("./report-share-service")

    await expect(
      createReportShareLink(
        { orgId: ORG, userId: null },
        // @ts-expect-error -- deliberately outside the union, which is exactly what an HTTP body can carry
        { reportType: "payroll", reportRef: { projectId: "p1", from: "2026-09-01", to: "2026-09-03" } }
      )
    ).rejects.toThrow(ServiceError)

    expect(tenantCalls).toBe(0)
    expect(insertedValues).toHaveLength(0)
  })

  test("an incomplete reportRef is refused before any transaction is opened", async () => {
    await mock.module("@/lib/db/tenant-scoped", () => ({ withTenantContext: mockWithTenantContext }))
    const { createReportShareLink } = await import("./report-share-service")

    await expect(
      createReportShareLink(
        { orgId: ORG, userId: null },
        { reportType: "attendance_summary", reportRef: { projectId: "p1", from: "", to: "2026-09-03" } }
      )
    ).rejects.toThrow("reportRef.projectId, from and to are required")

    expect(tenantCalls).toBe(0)
    expect(insertedValues).toHaveLength(0)
  })

  test("an attendance_summary link is written with its own type, its ref, and a token", async () => {
    await mock.module("@/lib/db/tenant-scoped", () => ({ withTenantContext: mockWithTenantContext }))
    const { createReportShareLink } = await import("./report-share-service")

    const link = await createReportShareLink(
      { orgId: ORG, userId: null },
      { reportType: "attendance_summary", reportRef: { projectId: "p1", from: "2026-09-01", to: "2026-09-03" } }
    )

    expect(insertedValues).toHaveLength(1)
    expect(insertedValues[0].reportType).toBe("attendance_summary")
    expect(insertedValues[0].reportRef).toBe(JSON.stringify({ projectId: "p1", from: "2026-09-01", to: "2026-09-03" }))
    expect(insertedValues[0].orgId).toBe(ORG)
    // R38: an API-key caller has no real users row, so this is legitimately null
    // rather than an api_keys.id masquerading as one.
    expect(insertedValues[0].createdById).toBeNull()
    expect(typeof link.token).toBe("string")
    expect((link.token as string).length).toBeGreaterThan(10)
  })

  test("the default expiry is 7 days, the same window the meeting share links use", async () => {
    await mock.module("@/lib/db/tenant-scoped", () => ({ withTenantContext: mockWithTenantContext }))
    const { createReportShareLink } = await import("./report-share-service")

    const before = Date.now()
    await createReportShareLink(
      { orgId: ORG, userId: null },
      { reportType: "attendance_summary", reportRef: { projectId: "p1", from: "2026-09-01", to: "2026-09-03" } }
    )
    const expiresAt = insertedValues[0].expiresAt as Date
    const hours = (expiresAt.getTime() - before) / (60 * 60 * 1000)
    expect(hours).toBeGreaterThan(167.9)
    expect(hours).toBeLessThan(168.1)
  })
})
