/// <reference types="bun-types" />
// R67 E-39 (R-271 / R-297 / R-293). The project dashboard payload gained three
// fields, and one of them is a MONEY-DERIVED figure under a new name.
//
// progressByBoqValuePct is the same number as percentByValue -- earned value
// over contract value. percentByValue is already redacted below manager rank
// (F059); adding a second name for it without adding it to the same list would
// have handed a non-manager the earned-value percentage on the very same
// response. That is the exact failure mode the redaction list exists to
// prevent, and it is what this file holds.
//
// Same mock.module convention as the sibling org-level dashboard/route.test.ts.
import { describe, test, expect, mock } from "bun:test"

class ServiceError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

const DASHBOARD = {
  projectId: "proj_cedar",
  projectName: "Cedar Heights Villa - Phase 1",
  budget: null,
  revenue: 475_000,
  expenses: 185_000,
  progressPercent: 60,
  progressByActivityLogPct: 60,
  progressByBoqValuePct: 25,
  delayedTaskCount: 0,
  photoCount: 3,
  taskCount: 9,
  projectValue: 500_000,
  earnedValue: 118_750,
  percentByValue: 25,
  contractValue: 475_000,
  generatedAt: "2026-09-03T14:02:00.000Z",
}

function mockAuth(ctx: { orgId: string | null; isManager?: boolean }) {
  mock.module("@/lib/supabase/auth-guard", () => ({
    requireAuthOrApiKey: mock(async () => ({
      orgId: ctx.orgId,
      dbUser: ctx.orgId ? { id: "user-1" } : null,
      apiKey: null,
      response: null,
    })),
    hasRole: mock(() => ctx.isManager ?? true),
  }))
}

function mockService() {
  const getProjectDashboard = mock(async () => DASHBOARD)
  mock.module("@/lib/services/construction-dashboard-service", () => ({ getProjectDashboard, ServiceError }))
  return getProjectDashboard
}

const params = Promise.resolve({ projectId: "proj_cedar" })

describe("GET /api/v1/projexa/dashboard/[projectId] (E-39)", () => {
  test("a manager gets every figure, including both named progress bases and generatedAt", async () => {
    mockAuth({ orgId: "org_1", isManager: true })
    mockService()

    const { GET } = await import("./route")
    const body = await (await GET(new Request("http://localhost/x"), { params })).json()

    expect(body.progressByBoqValuePct).toBe(25)
    expect(body.progressByActivityLogPct).toBe(60)
    expect(body.generatedAt).toBe("2026-09-03T14:02:00.000Z")
    // null, not 0 -- the whole point of E-39's backend half.
    expect(body.budget).toBe(null)
  })

  test("below manager rank, progressByBoqValuePct is redacted with the money it is derived from", async () => {
    mockAuth({ orgId: "org_1", isManager: false })
    mockService()

    const { GET } = await import("./route")
    const body = await (await GET(new Request("http://localhost/x"), { params })).json()

    for (const field of ["budget", "revenue", "expenses", "projectValue", "earnedValue", "percentByValue", "contractValue"]) {
      expect(body[field]).toBe(null)
    }
    // The new name for percentByValue must not be a way around that list.
    expect(body.progressByBoqValuePct).toBe(null)
  })

  test("the activity-log progress is NOT redacted -- it is a completion figure, not money", async () => {
    mockAuth({ orgId: "org_1", isManager: false })
    mockService()

    const { GET } = await import("./route")
    const body = await (await GET(new Request("http://localhost/x"), { params })).json()

    // Same treatment progressPercent beside it has always had.
    expect(body.progressByActivityLogPct).toBe(60)
    expect(body.progressPercent).toBe(60)
    expect(body.generatedAt).toBe("2026-09-03T14:02:00.000Z")
  })

  test("a caller with no resolvable org gets 400, and the service is never called", async () => {
    mockAuth({ orgId: null })
    const getProjectDashboard = mockService()

    const { GET } = await import("./route")
    const res = await GET(new Request("http://localhost/x"), { params })

    expect(res.status).toBe(400)
    expect(getProjectDashboard).not.toHaveBeenCalled()
  })
})
