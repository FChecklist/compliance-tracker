/// <reference types="bun-types" />
// Sumeet requirement #3: the per-claim status transitions
// (draft/submit/approve/reject/invoice) and the claim's document-flow
// timeline, both reachable from PROJEXA for the first time.
import { describe, test, expect, mock } from "bun:test"

class ServiceError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

function mockAuth(ctx: { orgId: string | null; response?: Response | null; roleErr?: Response | null }) {
  mock.module("@/lib/supabase/auth-guard", () => ({
    requireAuthOrApiKey: mock(async () => ({
      orgId: ctx.orgId,
      dbUser: ctx.orgId ? { id: "user-1" } : null,
      apiKey: null,
      response: ctx.response ?? null,
    })),
    requireRoleOrScope: mock(() => ctx.roleErr ?? null),
  }))
}

function mockService(overrides: Record<string, unknown> = {}) {
  mock.module("@/lib/services/construction-billing-workflow-service", () => ({
    draftClaim: mock(async () => ({})),
    submitClaim: mock(async () => ({})),
    approveClaim: mock(async () => ({})),
    rejectClaim: mock(async () => ({})),
    invoiceApprovedClaim: mock(async () => ({})),
    getClaimTimeline: mock(async () => ({})),
    ServiceError,
    ...overrides,
  }))
}

describe("GET /api/v1/projexa/billing-claims/[id] -- claim timeline", () => {
  test("returns the claim's document-flow timeline", async () => {
    mockAuth({ orgId: "org-1" })
    const timeline = { claim: { id: "c1" }, steps: [], isStuck: false }
    const getClaimTimeline = mock(async () => timeline)
    mockService({ getClaimTimeline })

    const { GET } = await import("./route")
    const res = await GET({} as any, { params: Promise.resolve({ id: "c1" }) })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(timeline)
    expect(getClaimTimeline).toHaveBeenCalledWith({ orgId: "org-1" }, "c1")
  })
})

describe("PATCH /api/v1/projexa/billing-claims/[id] -- state-machine transitions", () => {
  test("draft calls draftClaim", async () => {
    mockAuth({ orgId: "org-1" })
    const draftClaim = mock(async () => ({ id: "c1", status: "drafted" }))
    mockService({ draftClaim })

    const { PATCH } = await import("./route")
    const res = await PATCH({ json: async () => ({ action: "draft" }) } as any, { params: Promise.resolve({ id: "c1" }) })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id: "c1", status: "drafted" })
    expect(draftClaim).toHaveBeenCalledWith({ orgId: "org-1", userId: "user-1" }, "c1")
  })

  test("submit calls submitClaim", async () => {
    mockAuth({ orgId: "org-1" })
    const submitClaim = mock(async () => ({ id: "c1", status: "submitted" }))
    mockService({ submitClaim })

    const { PATCH } = await import("./route")
    const res = await PATCH({ json: async () => ({ action: "submit" }) } as any, { params: Promise.resolve({ id: "c1" }) })

    expect(res.status).toBe(200)
    expect(submitClaim).toHaveBeenCalledWith({ orgId: "org-1", userId: "user-1" }, "c1")
  })

  test("approve calls approveClaim", async () => {
    mockAuth({ orgId: "org-1" })
    const approveClaim = mock(async () => ({ id: "c1", status: "client_approved" }))
    mockService({ approveClaim })

    const { PATCH } = await import("./route")
    const res = await PATCH({ json: async () => ({ action: "approve" }) } as any, { params: Promise.resolve({ id: "c1" }) })

    expect(res.status).toBe(200)
    expect(approveClaim).toHaveBeenCalledWith({ orgId: "org-1", userId: "user-1" }, "c1")
  })

  test("reject calls rejectClaim with the rejection reason", async () => {
    mockAuth({ orgId: "org-1" })
    const rejectClaim = mock(async () => ({ id: "c1", status: "rejected" }))
    mockService({ rejectClaim })

    const { PATCH } = await import("./route")
    const res = await PATCH(
      { json: async () => ({ action: "reject", rejectionReason: "Client disputes quantities" }) } as any,
      { params: Promise.resolve({ id: "c1" }) }
    )

    expect(res.status).toBe(200)
    expect(rejectClaim).toHaveBeenCalledWith({ orgId: "org-1", userId: "user-1" }, "c1", "Client disputes quantities")
  })

  test("invoice calls invoiceApprovedClaim with billDate/taxTemplateId and the caller's dbUser", async () => {
    mockAuth({ orgId: "org-1" })
    const invoiceApprovedClaim = mock(async () => ({ claim: { id: "c1", status: "invoiced" }, bill: { id: "b1" }, invoice: { id: "i1" } }))
    mockService({ invoiceApprovedClaim })

    const { PATCH } = await import("./route")
    const res = await PATCH(
      { json: async () => ({ action: "invoice", billDate: "2026-10-01", taxTemplateId: "tax-1" }) } as any,
      { params: Promise.resolve({ id: "c1" }) }
    )

    expect(res.status).toBe(200)
    expect(invoiceApprovedClaim).toHaveBeenCalledWith(
      { orgId: "org-1", userId: "user-1", dbUser: { id: "user-1" } },
      "c1",
      { billDate: "2026-10-01", taxTemplateId: "tax-1" }
    )
  })

  test("invoice without billDate/taxTemplateId is refused before reaching the service layer", async () => {
    mockAuth({ orgId: "org-1" })
    const invoiceApprovedClaim = mock(async () => ({}))
    mockService({ invoiceApprovedClaim })

    const { PATCH } = await import("./route")
    const res = await PATCH({ json: async () => ({ action: "invoice" }) } as any, { params: Promise.resolve({ id: "c1" }) })

    expect(res.status).toBe(400)
    expect(invoiceApprovedClaim).not.toHaveBeenCalled()
  })

  test("an unknown action is refused, never silently no-op'd", async () => {
    mockAuth({ orgId: "org-1" })
    mockService()

    const { PATCH } = await import("./route")
    const res = await PATCH({ json: async () => ({ action: "delete" }) } as any, { params: Promise.resolve({ id: "c1" }) })

    expect(res.status).toBe(400)
  })

  test("a service-layer refusal (invalid transition) surfaces its real status code", async () => {
    mockAuth({ orgId: "org-1" })
    const draftClaim = mock(async () => { throw new ServiceError("Cannot move a 'invoiced' claim to 'drafted' -- valid next status(es): none (terminal)", 409) })
    mockService({ draftClaim })

    const { PATCH } = await import("./route")
    const res = await PATCH({ json: async () => ({ action: "draft" }) } as any, { params: Promise.resolve({ id: "c1" }) })

    expect(res.status).toBe(409)
  })
})
