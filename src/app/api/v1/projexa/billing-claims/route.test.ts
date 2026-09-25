/// <reference types="bun-types" />
// Sumeet requirement #3/#7: proves real, live endpoints exist for a
// project's billing milestones (constructionProgressClaims), reachable from
// PROJEXA for the first time. Same convention as the sibling
// v1/projexa/schedule/route.test.ts.
import { describe, test, expect, mock } from "bun:test"
import { actingPersonDouble } from "@/lib/supabase/__test-helpers__/acting-person-double"

class ServiceError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

function mockAuth(ctx: { orgId: string | null; response?: Response | null; roleErr?: Response | null }) {
  mock.module("@/lib/supabase/auth-guard", () => ({
    ...actingPersonDouble(),
    requireAuthOrApiKey: mock(async () => ({
      orgId: ctx.orgId,
      dbUser: ctx.orgId ? { id: "user-1" } : null,
      apiKey: null,
      response: ctx.response ?? null,
    })),
    requireRoleOrScope: mock(() => ctx.roleErr ?? null),
    requireOrg: mock((c: { orgId: string | null }) =>
      c.orgId ? null : new Response(JSON.stringify({ error: "No organisation on this account" }), { status: 400 })
    ),
  }))
}

describe("GET /api/v1/projexa/billing-claims", () => {
  test("returns the project's billing-due queue by default", async () => {
    mockAuth({ orgId: "org-1" })
    const claims = [{ id: "claim-1", projectId: "proj-1", status: "submitted", scheduledDate: "2026-08-01", isOverdue: true }]
    const listBillingDueQueue = mock(async () => claims)
    const listClaims = mock(async () => [])
    mock.module("@/lib/services/construction-billing-workflow-service", () => ({ listBillingDueQueue, listClaims, createProgressClaim: mock(async () => ({})), ServiceError }))

    const { GET } = await import("./route")
    const res = await GET({ nextUrl: new URL("http://localhost/api/v1/projexa/billing-claims?projectId=proj-1") } as any)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ claims })
    expect(listBillingDueQueue).toHaveBeenCalledWith({ orgId: "org-1" }, "proj-1")
    expect(listClaims).not.toHaveBeenCalled()
  })

  test("all=true returns the full billing-milestones history (invoiced included)", async () => {
    mockAuth({ orgId: "org-1" })
    const allClaims = [
      { id: "claim-1", projectId: "proj-1", status: "invoiced" },
      { id: "claim-2", projectId: "proj-1", status: "drafted" },
    ]
    const listClaims = mock(async () => allClaims)
    const listBillingDueQueue = mock(async () => [])
    mock.module("@/lib/services/construction-billing-workflow-service", () => ({ listBillingDueQueue, listClaims, createProgressClaim: mock(async () => ({})), ServiceError }))

    const { GET } = await import("./route")
    const res = await GET({ nextUrl: new URL("http://localhost/api/v1/projexa/billing-claims?projectId=proj-1&all=true") } as any)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ claims: allClaims })
    expect(listClaims).toHaveBeenCalledWith({ orgId: "org-1" }, "proj-1")
    expect(listBillingDueQueue).not.toHaveBeenCalled()
  })

  test("no organisation on the account is refused before reaching the service layer", async () => {
    mockAuth({ orgId: null })
    const listBillingDueQueue = mock(async () => [])
    mock.module("@/lib/services/construction-billing-workflow-service", () => ({ listBillingDueQueue, listClaims: mock(async () => []), createProgressClaim: mock(async () => ({})), ServiceError }))

    const { GET } = await import("./route")
    const res = await GET({ nextUrl: new URL("http://localhost/api/v1/projexa/billing-claims") } as any)

    expect(res.status).toBe(400)
    expect(listBillingDueQueue).not.toHaveBeenCalled()
  })
})

describe("POST /api/v1/projexa/billing-claims", () => {
  test("creates a new billing milestone (progress claim)", async () => {
    mockAuth({ orgId: "org-1" })
    const created = { id: "claim-1", projectId: "proj-1", status: "milestone_achieved" }
    const createProgressClaim = mock(async () => created)
    mock.module("@/lib/services/construction-billing-workflow-service", () => ({
      listBillingDueQueue: mock(async () => []), listClaims: mock(async () => []), createProgressClaim, ServiceError,
    }))

    const { POST } = await import("./route")
    const res = await POST({
      nextUrl: new URL("http://localhost/api/v1/projexa/billing-claims"),
      json: async () => ({ projectId: "proj-1", boqId: "boq-1", customerId: "cust-1", milestoneDescription: "Foundation complete", scheduledDate: "2026-10-01", retentionPercent: 5 }),
    } as any)

    expect(res.status).toBe(201)
    expect(await res.json()).toEqual(created)
    expect(createProgressClaim).toHaveBeenCalledWith(
      { orgId: "org-1", userId: "user-1" },
      { projectId: "proj-1", boqId: "boq-1", customerId: "cust-1", milestoneDescription: "Foundation complete", scheduledDate: "2026-10-01", retentionPercent: 5 }
    )
  })

  test("a service-layer refusal (missing field) surfaces its real status code", async () => {
    mockAuth({ orgId: "org-1" })
    const createProgressClaim = mock(async () => { throw new ServiceError("milestoneDescription is required", 400) })
    mock.module("@/lib/services/construction-billing-workflow-service", () => ({
      listBillingDueQueue: mock(async () => []), listClaims: mock(async () => []), createProgressClaim, ServiceError,
    }))

    const { POST } = await import("./route")
    const res = await POST({
      nextUrl: new URL("http://localhost/api/v1/projexa/billing-claims"),
      json: async () => ({ projectId: "proj-1", boqId: "boq-1", customerId: "cust-1", scheduledDate: "2026-10-01" }),
    } as any)

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: "milestoneDescription is required" })
  })
})
