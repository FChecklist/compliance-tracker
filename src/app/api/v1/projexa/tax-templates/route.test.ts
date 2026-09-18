/// <reference types="bun-types" />
// Sumeet requirement #3: invoicing a billing milestone needs a real
// taxTemplateId -- this is the first PROJEXA-reachable route for VERIDIAN's
// tax templates.
import { describe, test, expect, mock } from "bun:test"

class ServiceError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

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

describe("GET /api/v1/projexa/tax-templates", () => {
  test("returns the org's tax templates", async () => {
    mockAuth({ orgId: "org-1" })
    const taxTemplates = [{ id: "tax-1", name: "GST 18%", items: [] }]
    const listTaxTemplates = mock(async () => taxTemplates)
    mock.module("@/lib/services/erp-invoicing-service", () => ({ listTaxTemplates }))

    const { GET } = await import("./route")
    const res = await GET({} as any)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ taxTemplates })
    expect(listTaxTemplates).toHaveBeenCalledWith({ orgId: "org-1" })
  })

  test("an org without ERP enabled gets the real 403, not a 500", async () => {
    mockAuth({ orgId: "org-1" })
    const listTaxTemplates = mock(async () => {
      throw new ServiceError("This capability is not part of the Module your organization purchased. Please contact your organization's administrator. This capability is already in the ERP module.", 403)
    })
    mock.module("@/lib/services/erp-invoicing-service", () => ({ listTaxTemplates }))
    mock.module("@/lib/services/compliance-service", () => ({ ServiceError }))

    const { GET } = await import("./route")
    const res = await GET({} as any)

    expect(res.status).toBe(403)
  })

  test("no organisation on the account is refused before reaching the service layer", async () => {
    mockAuth({ orgId: null })
    const listTaxTemplates = mock(async () => [])
    mock.module("@/lib/services/erp-invoicing-service", () => ({ listTaxTemplates }))

    const { GET } = await import("./route")
    const res = await GET({} as any)

    expect(res.status).toBe(400)
    expect(listTaxTemplates).not.toHaveBeenCalled()
  })
})
