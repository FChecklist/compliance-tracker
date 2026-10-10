/// <reference types="bun-types" />
// Sumeet requirement #3: the per-claim status transitions
// (draft/submit/approve/reject/invoice) and the claim's document-flow
// timeline, both reachable from PROJEXA for the first time.
import { describe, test, expect, mock } from "bun:test"
import { actingPersonDouble } from "@/lib/supabase/__test-helpers__/acting-person-double"

class ServiceError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

// PROJEXA-E2E-001 surface-4 fix, made strict by U-20b: the route resolves the
// acting person through requireActingPerson (auth-guard.ts). The shared double
// mirrors its contract and reads the request's REAL headers, so a session
// caller is user-1 and an API-key caller must send X-Acting-User.
const PERSON_42 = { id: "real-person-42" }
function mockAuth(ctx: {
  orgId: string | null
  response?: Response | null
  roleErr?: Response | null
  viaApiKey?: boolean
}) {
  mock.module("@/lib/supabase/auth-guard", () => ({
    ...actingPersonDouble((actorId) => (actorId === "projexa-user-42" ? PERSON_42 : null)),
    requireAuthOrApiKey: mock(async () => ({
      orgId: ctx.orgId,
      dbUser: ctx.orgId && !ctx.viaApiKey ? { id: "user-1" } : null,
      apiKey: ctx.viaApiKey ? { id: "key-1", name: "PROJEXA org key", scopes: ["read", "write"] } : null,
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

// PROJEXA-E2E-001 surface-4 (email): live testing of the digest reply-by-
// email path found that this route (like rfis/submittals/punch-list's own
// PATCH handlers) NEVER attributed a claim transition to the real acting
// person -- it always used `ctx.dbUser?.id ?? ctx.apiKey!.id`, which for
// every PROJEXA-proxied call (a shared per-org API key, ctx.dbUser always
// null) meant approve/reject/draft/submit/invoice were attributed to the
// API key's own row, not whoever actually approved/rejected it -- even
// when a real acting-user identity WAS available (digest-item-
// dispatcher.ts sends X-Acting-User/X-Acting-User-Email specifically so
// this would resolve). Live-verified equivalent for the sibling RFI route:
// answering an RFI via the real reply pipeline stored answered_by_id as
// the org's api_keys.id, not the real person's compliance.users.id.
describe("PATCH /api/v1/projexa/billing-claims/[id] -- real acting-user attribution (PROJEXA-E2E-001 surface-4 fix, U-20b)", () => {
  const keyPatch = (body: Record<string, unknown>, headers: Record<string, string>) =>
    ({ json: async () => body, headers: new Headers(headers) }) as any

  test("an API-key caller naming a linked person is attributed to that person, never the key", async () => {
    mockAuth({ orgId: "org-1", viaApiKey: true })
    const approveClaim = mock(async () => ({ id: "c1", status: "client_approved" }))
    mockService({ approveClaim })

    const { PATCH } = await import("./route")
    const res = await PATCH(keyPatch({ action: "approve" }, { "X-Acting-User": "projexa-user-42" }), { params: Promise.resolve({ id: "c1" }) })

    expect(res.status).toBe(200)
    // The claim is attributed to the REAL resolved person, never the
    // shared API key -- this is the entire point of the fix.
    expect(approveClaim).toHaveBeenCalledWith({ orgId: "org-1", userId: "real-person-42" }, "c1")
  })

  test("invoicing through an API key hands the service the person AND the key, so the invoice's audit row names both", async () => {
    mockAuth({ orgId: "org-1", viaApiKey: true })
    const invoiceApprovedClaim = mock(async () => ({ claim: { id: "c1", status: "invoiced" } }))
    mockService({ invoiceApprovedClaim })

    const { PATCH } = await import("./route")
    const res = await PATCH(
      keyPatch({ action: "invoice", billDate: "2026-10-01", taxTemplateId: "tax-1" }, { "X-Acting-User": "projexa-user-42" }),
      { params: Promise.resolve({ id: "c1" }) }
    )

    expect(res.status).toBe(200)
    expect(invoiceApprovedClaim).toHaveBeenCalledWith(
      { orgId: "org-1", userId: "real-person-42", dbUser: PERSON_42, apiKey: { id: "key-1", name: "PROJEXA org key" }, actingViaApiKey: true },
      "c1",
      { billDate: "2026-10-01", taxTemplateId: "tax-1" }
    )
  })

  test("a caller whose acting-user signal fails to resolve is refused, never silently attributed to a fallback identity", async () => {
    mockAuth({ orgId: "org-1", viaApiKey: true })
    const approveClaim = mock(async () => ({ id: "c1", status: "client_approved" }))
    mockService({ approveClaim })

    const { PATCH } = await import("./route")
    const res = await PATCH(keyPatch({ action: "approve" }, { "X-Acting-User": "nobody-we-know" }), { params: Promise.resolve({ id: "c1" }) })

    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe("USER_NOT_LINKED")
    expect(approveClaim).not.toHaveBeenCalled()
  })

  test("U-20b: an API-key caller that names nobody is refused with ACTING_USER_REQUIRED, never recorded as the key", async () => {
    mockAuth({ orgId: "org-1", viaApiKey: true })
    const approveClaim = mock(async () => ({ id: "c1", status: "client_approved" }))
    mockService({ approveClaim })

    const { PATCH } = await import("./route")
    const res = await PATCH(keyPatch({ action: "approve" }, {}), { params: Promise.resolve({ id: "c1" }) })

    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe("ACTING_USER_REQUIRED")
    expect(approveClaim).not.toHaveBeenCalled()
  })
})
