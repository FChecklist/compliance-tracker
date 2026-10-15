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
    requireRoleOrScope: mock(() => null),
    requireActingPerson: mock(async () => ({ acting: { person: { id: "user-1" } }, error: null })),
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
    mock.module("@/lib/services/erp-invoicing-service", () => ({ listTaxTemplates, createTaxTemplate: mock(async () => ({})) }))

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
    mock.module("@/lib/services/erp-invoicing-service", () => ({ listTaxTemplates, createTaxTemplate: mock(async () => ({})) }))
    mock.module("@/lib/services/compliance-service", () => ({ ServiceError }))

    const { GET } = await import("./route")
    const res = await GET({} as any)

    expect(res.status).toBe(403)
  })

  test("no organisation on the account is refused before reaching the service layer", async () => {
    mockAuth({ orgId: null })
    const listTaxTemplates = mock(async () => [])
    mock.module("@/lib/services/erp-invoicing-service", () => ({ listTaxTemplates, createTaxTemplate: mock(async () => ({})) }))

    const { GET } = await import("./route")
    const res = await GET({} as any)

    expect(res.status).toBe(400)
    expect(listTaxTemplates).not.toHaveBeenCalled()
  })
})

describe("POST /api/v1/projexa/tax-templates", () => {
  function mockWrite(roleResponse: Response | null) {
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuthOrApiKey: mock(async () => ({ orgId: "org-1", dbUser: { id: "user-1" }, apiKey: null, response: null })),
      requireRoleOrScope: mock(() => roleResponse),
      requireOrg: mock(() => null),
      requireActingPerson: mock(async () => ({ acting: { person: { id: "user-1" } }, error: null })),
    }))
  }
  const req = (body: unknown) => ({ json: async () => body }) as any

  test("creates a template and passes the lines to the service", async () => {
    mockWrite(null)
    const createTaxTemplate = mock(async (..._a: unknown[]) => ({ id: "tax-9", name: "GST 18%" }))
    mock.module("@/lib/services/erp-invoicing-service", () => ({ listTaxTemplates: mock(async () => []), createTaxTemplate }))
    mock.module("@/lib/services/compliance-service", () => ({ ServiceError }))
    const { POST } = await import("./route")
    const res = await POST(req({ name: "GST 18%", isSalesTax: true, items: [{ taxAccountId: "a1", rate: 9 }, { taxAccountId: "a2", rate: 9 }] }))
    expect(res.status).toBe(201)
    const input = createTaxTemplate.mock.calls[0][1] as { items: { rate: number }[]; isSalesTax: boolean }
    expect(input.isSalesTax).toBe(true)
    expect(input.items.map((i) => i.rate)).toEqual([9, 9])
  })

  test("a string rate is not coerced; the service refuses it with 400", async () => {
    mockWrite(null)
    const createTaxTemplate = mock(async (_c: unknown, i: { items: { rate: number }[] }) => {
      if (!Number.isFinite(i.items[0].rate)) throw new ServiceError("Each tax rate must be a number between 0 and 100", 400)
      return { id: "x" }
    })
    mock.module("@/lib/services/erp-invoicing-service", () => ({ listTaxTemplates: mock(async () => []), createTaxTemplate }))
    mock.module("@/lib/services/compliance-service", () => ({ ServiceError }))
    const { POST } = await import("./route")
    const res = await POST(req({ name: "x", items: [{ taxAccountId: "a1", rate: "9" }] }))
    expect(res.status).toBe(400)
  })

  test("a role below manager is refused before the service is touched", async () => {
    mockWrite(new Response("{}", { status: 403 }))
    const createTaxTemplate = mock(async () => ({}))
    mock.module("@/lib/services/erp-invoicing-service", () => ({ listTaxTemplates: mock(async () => []), createTaxTemplate }))
    const { POST } = await import("./route")
    const res = await POST(req({ name: "x", items: [] }))
    expect(res.status).toBe(403)
    expect(createTaxTemplate).not.toHaveBeenCalled()
  })
})
