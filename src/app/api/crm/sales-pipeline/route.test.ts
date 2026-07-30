/// <reference types="bun-types" />
// Thin wiring test, same shape as v1/projexa/module-chain/route.test.ts and
// settings/branding/route.test.ts -- proves this in-app route (a) always
// calls getSalesPipelineOverview with the authenticated caller's own orgId
// (never a request-supplied one), (b) the 401/400 gates short-circuit before
// the service is ever called, and (c) a ServiceError from the service maps
// to its own status code rather than a generic 500. @/lib/supabase/auth-guard
// and @/lib/services/crm-service are both mocked (not the real modules), so
// this file exercises only the route's own wiring -- no live DB, matching
// this repo's no-live-DB-from-.test.ts precedent.
import { describe, test, expect, mock } from "bun:test"

// A local stand-in for compliance-service.ts's real ServiceError -- kept
// minimal (message + status only) rather than importing the real class,
// because importing anything from the real @/lib/services/crm-service (even
// just to re-export its ServiceError) pulls in that file's full transitive
// import graph (policy-enforcement-engine, prompt-os-resolver, etc.), several
// of which import OTHER named exports (e.g. hasRole) from
// @/lib/supabase/auth-guard that this file's own auth-guard mock below
// doesn't provide -- same class of failure module-chain/route.test.ts and
// branding/route.test.ts both avoid by never spreading a real module's
// exports over a mock.
class FakeServiceError extends Error {
  constructor(message: string, public status: number) { super(message) }
}

function mockAuth(ctx: { orgId: string | null; response?: Response | null }) {
  mock.module("@/lib/supabase/auth-guard", () => ({
    requireAuth: mock(async () => ({ user: null, dbUser: null, orgId: ctx.orgId, response: ctx.response ?? null })),
  }))
}

const OVERVIEW = {
  totalLeads: 12,
  totalOpportunities: 5,
  leadsByStatus: { new: 7, contacted: 5 },
  opportunitiesByStage: { prospecting: { count: 3, value: 15000 }, won: { count: 2, value: 40000 } },
  wonCount: 2,
  lostCount: 1,
  winRate: 2 / 3,
  openPipelineValue: 15000,
  overdueLeadFollowUps: 4,
  overdueOpportunityFollowUps: 1,
}

function mockOverview(impl: () => Promise<unknown>) {
  const getSalesPipelineOverview = mock(impl)
  mock.module("@/lib/services/crm-service", () => ({ getSalesPipelineOverview, ServiceError: FakeServiceError }))
  return getSalesPipelineOverview
}

describe("GET /api/crm/sales-pipeline", () => {
  test("calls getSalesPipelineOverview with the authenticated caller's own orgId and returns it as-is", async () => {
    mockAuth({ orgId: "org-a" })
    const getSalesPipelineOverview = mockOverview(async () => OVERVIEW)

    const { GET } = await import("./route")
    const res = await GET()

    expect(res.status).toBe(200)
    expect(getSalesPipelineOverview).toHaveBeenCalledWith({ orgId: "org-a" })
    expect(await res.json()).toEqual(OVERVIEW)
  })

  test("a different org resolves a different orgId into the service call -- no cross-tenant bleed", async () => {
    mockAuth({ orgId: "org-b" })
    const getSalesPipelineOverview = mockOverview(async () => OVERVIEW)

    const { GET } = await import("./route")
    await GET()

    expect(getSalesPipelineOverview).toHaveBeenCalledWith({ orgId: "org-b" })
    expect(getSalesPipelineOverview).not.toHaveBeenCalledWith(expect.objectContaining({ orgId: "org-a" }))
  })

  test("an unauthenticated caller gets the auth-guard's own response, service is never called", async () => {
    mockAuth({ orgId: null, response: new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }) })
    const getSalesPipelineOverview = mockOverview(async () => OVERVIEW)

    const { GET } = await import("./route")
    const res = await GET()

    expect(res.status).toBe(401)
    expect(getSalesPipelineOverview).not.toHaveBeenCalled()
  })

  test("an authenticated user with no organisation gets 400, not a crash", async () => {
    mockAuth({ orgId: null })
    const getSalesPipelineOverview = mockOverview(async () => OVERVIEW)

    const { GET } = await import("./route")
    const res = await GET()

    expect(res.status).toBe(400)
    expect(getSalesPipelineOverview).not.toHaveBeenCalled()
  })

  test("a ServiceError from the service (e.g. sales module disabled) surfaces its own status, not a generic 500", async () => {
    mockAuth({ orgId: "org-a" })
    mockOverview(async () => { throw new FakeServiceError("Sales & CRM is not enabled for this organisation", 403) })

    const { GET } = await import("./route")
    const res = await GET()

    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe("Sales & CRM is not enabled for this organisation")
  })

  test("an unexpected error still returns 500, not an unhandled throw", async () => {
    mockAuth({ orgId: "org-a" })
    mockOverview(async () => { throw new Error("boom") })

    const { GET } = await import("./route")
    const res = await GET()

    expect(res.status).toBe(500)
  })
})
