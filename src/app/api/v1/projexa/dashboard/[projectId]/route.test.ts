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
//
// R-50 REOPENED (platform.sumeet_requirements): this route no longer imports
// hasRole() -- it resolves a financial-visibility role via
// resolveActingUser() (the D-05 identity bridge), so mock.module() must
// spread the REAL auth-guard module or the route's real, unmocked imports
// (resolveActingUser/readActingUserId/readActingUserEmail) silently
// disappear at module-link time.
import { describe, test, expect, mock } from "bun:test"
import * as realAuthGuard from "@/lib/supabase/auth-guard"

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

function mockAuth(ctx: {
  orgId: string | null
  /** Session (dbUser) caller's rank -- default true/"manager". Ignored when apiKeyOnly is set. */
  isManager?: boolean
  /** PROJEXA-style caller: a shared per-org API key, no session dbUser. */
  apiKeyOnly?: boolean
  /** The role resolveActingUser() resolves to for an apiKeyOnly caller. null/
   * undefined means resolution failed (no headers, unmapped id). */
  actingRole?: string | null
}) {
  mock.module("@/lib/supabase/auth-guard", () => ({
    ...realAuthGuard,
    requireAuthOrApiKey: mock(async () => ({
      orgId: ctx.orgId,
      dbUser: ctx.apiKeyOnly
        ? null
        : ctx.orgId
          ? { id: "user-1", role: (ctx.isManager ?? true) ? "manager" : "member" }
          : null,
      apiKey: ctx.apiKeyOnly ? { id: "key-1", name: "test key", scopes: ["read", "write"] } : null,
      response: null,
    })),
    resolveActingUser: mock(async () => ({
      user: ctx.actingRole ? { id: "acting-1", role: ctx.actingRole } : null,
      error: null,
    })),
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

  // R-50 REOPENED (platform.sumeet_requirements, live-confirmed): the OLD
  // code gated redaction on `ctx.dbUser && !hasRole(ctx.dbUser, "manager")`.
  // PROJEXA authenticates every call with a single shared per-org API key
  // (never a per-user VERIDIAN session), so ctx.dbUser was ALWAYS null for a
  // PROJEXA-proxied request -- that `&&` never fired, for ANY role,
  // including client_viewer. This is the regression test: it fails against
  // the pre-fix logic (an apiKeyOnly caller got the full dashboard
  // unconditionally, byte-identical to what a manager would see -- exactly
  // what the live repro against the real karan.malhotra clientViewer account
  // found) and passes against the fix (resolveActingUser() resolves a real
  // role from PROJEXA's X-Acting-User-Email header, and the SAME "manager"
  // floor this route always used is applied to it).
  test("R-50: an API-key (PROJEXA) caller resolving to client_viewer is redacted -- the hard floor holds over the real proxy path", async () => {
    mockAuth({ orgId: "org_1", apiKeyOnly: true, actingRole: "client_viewer" })
    mockService()

    const { GET } = await import("./route")
    const req = new Request("http://localhost/x", { headers: { "x-acting-user-email": "karan.malhotra@example.com" } })
    const body = await (await GET(req, { params })).json()

    for (const field of ["budget", "revenue", "expenses", "projectValue", "earnedValue", "percentByValue", "contractValue"]) {
      expect(body[field]).toBe(null)
    }
    expect(body.progressByBoqValuePct).toBe(null)
    expect(body.financialsRedacted).toBe(true)
    // Non-money figures survive.
    expect(body.progressByActivityLogPct).toBe(60)
  })

  test("R-50: an API-key (PROJEXA) caller resolving to a manager/CEO-tier role sees the real figures -- the fix does not over-broaden the gate", async () => {
    mockAuth({ orgId: "org_1", apiKeyOnly: true, actingRole: "manager" })
    mockService()

    const { GET } = await import("./route")
    const req = new Request("http://localhost/x", { headers: { "x-acting-user-email": "ceo@example.com" } })
    const body = await (await GET(req, { params })).json()

    expect(body.revenue).toBe(475_000)
    expect(body.expenses).toBe(185_000)
    expect(body.earnedValue).toBe(118_750)
    expect(body.contractValue).toBe(475_000)
    expect(body.financialsRedacted).toBeUndefined()
  })

  test("R-50: an API-key caller with NO resolvable acting user (no header, unmapped id) fails closed -- redacted, not an error", async () => {
    mockAuth({ orgId: "org_1", apiKeyOnly: true, actingRole: null })
    mockService()

    const { GET } = await import("./route")
    const res = await GET(new Request("http://localhost/x"), { params })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.revenue).toBe(null)
    expect(body.financialsRedacted).toBe(true)
  })
})
