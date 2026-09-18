/// <reference types="bun-types" />
// Sumeet requirement #7: proves a real, live GET-only endpoint exists for a
// project's billing-milestone queue (constructionProgressClaims), reachable
// from PROJEXA for the first time. Same convention as the sibling
// v1/projexa/schedule/route.test.ts.
import { describe, test, expect, mock } from "bun:test"

function mockAuth(ctx: { orgId: string | null; response?: Response | null }) {
  mock.module("@/lib/supabase/auth-guard", () => ({
    requireAuthOrApiKey: mock(async () => ({
      orgId: ctx.orgId,
      dbUser: ctx.orgId ? { id: "user-1" } : null,
      apiKey: null,
      response: ctx.response ?? null,
    })),
    requireOrg: mock((c: { orgId: string | null }) =>
      c.orgId ? null : new Response(JSON.stringify({ error: "No organisation on this account" }), { status: 400 })
    ),
  }))
}

describe("GET /api/v1/projexa/billing-claims", () => {
  test("returns the project's billing-due queue", async () => {
    mockAuth({ orgId: "org-1" })
    const claims = [{ id: "claim-1", projectId: "proj-1", status: "submitted", scheduledDate: "2026-08-01", isOverdue: true }]
    const listBillingDueQueue = mock(async () => claims)
    mock.module("@/lib/services/construction-billing-workflow-service", () => ({ listBillingDueQueue }))

    const { GET } = await import("./route")
    const res = await GET({ nextUrl: new URL("http://localhost/api/v1/projexa/billing-claims?projectId=proj-1") } as any)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ claims })
    expect(listBillingDueQueue).toHaveBeenCalledWith({ orgId: "org-1" }, "proj-1")
  })

  test("no organisation on the account is refused before reaching the service layer", async () => {
    mockAuth({ orgId: null })
    const listBillingDueQueue = mock(async () => [])
    mock.module("@/lib/services/construction-billing-workflow-service", () => ({ listBillingDueQueue }))

    const { GET } = await import("./route")
    const res = await GET({ nextUrl: new URL("http://localhost/api/v1/projexa/billing-claims") } as any)

    expect(res.status).toBe(400)
    expect(listBillingDueQueue).not.toHaveBeenCalled()
  })
})
