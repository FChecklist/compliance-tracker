/// <reference types="bun-types" />
// R85 Addendum 3 v4 FINAL, Phase 7 (D89, gates 7-01/7-02/7-04/7-12). Real
// route-handler proof -- service-layer math/redaction already covered in
// boq-excel-roundtrip-service.test.ts; this proves the ROUTE wires auth,
// the `view` query param, and the xlsx Content-Type/Content-Disposition
// headers correctly.
import { describe, test, expect, mock } from "bun:test"
import { NextRequest } from "next/server"

class FakeServiceError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

async function mockAuth(opts: { role?: string } = {}) {
  const authActual = await import("@/lib/supabase/auth-guard")
  mock.module("@/lib/supabase/auth-guard", () => ({
    ...authActual,
    requireAuthOrApiKey: mock(async () => ({
      response: null,
      orgId: "org-1",
      dbUser: { id: "user-1", role: opts.role ?? "member" },
      apiKey: null,
    })),
    requireRoleOrScope: mock(() => null),
  }))
}

function mockService(opts: { internalBuffer?: Buffer; customerBuffer?: Buffer; throwError?: FakeServiceError } = {}) {
  mock.module("@/lib/services/boq-excel-roundtrip-service", () => ({
    exportInternalBoq: mock(async () => {
      if (opts.throwError) throw opts.throwError
      return opts.internalBuffer ?? Buffer.from("internal-bytes")
    }),
    exportCustomerBoq: mock(async () => {
      if (opts.throwError) throw opts.throwError
      return opts.customerBuffer ?? Buffer.from("customer-bytes")
    }),
    ServiceError: FakeServiceError,
  }))
  // The route imports ServiceError from construction-boq-service.ts (its
  // `instanceof` check target), not from boq-excel-roundtrip-service.ts --
  // mocked here too so a thrown FakeServiceError is recognised the same way
  // a real ServiceError would be.
  mock.module("@/lib/services/construction-boq-service", () => ({ ServiceError: FakeServiceError }))
}

function req(url: string) {
  return new NextRequest(url)
}

describe("GET /api/v1/construction/boq/[id]/excel/export", () => {
  test("defaults to view=internal and calls exportInternalBoq with the caller's role", async () => {
    await mockAuth({ role: "admin" })
    mockService({ internalBuffer: Buffer.from("INTERNAL-XLSX") })
    const { GET } = await import("./route")
    const res = await GET(req("http://localhost/api/v1/construction/boq/boq-1/excel/export"), { params: Promise.resolve({ id: "boq-1" }) })
    expect(res.status).toBe(200)
    expect(res.headers.get("Content-Type")).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    expect(res.headers.get("Content-Disposition")).toContain("boq-1-internal.xlsx")
    const bytes = Buffer.from(await res.arrayBuffer())
    expect(bytes.toString()).toBe("INTERNAL-XLSX")
  })

  test("?view=customer calls exportCustomerBoq instead", async () => {
    await mockAuth({ role: "client_viewer" })
    mockService({ customerBuffer: Buffer.from("CUSTOMER-XLSX") })
    const { GET } = await import("./route")
    const res = await GET(req("http://localhost/api/v1/construction/boq/boq-1/excel/export?view=customer"), { params: Promise.resolve({ id: "boq-1" }) })
    expect(res.status).toBe(200)
    expect(res.headers.get("Content-Disposition")).toContain("boq-1-customer.xlsx")
    const bytes = Buffer.from(await res.arrayBuffer())
    expect(bytes.toString()).toBe("CUSTOMER-XLSX")
  })

  test("no org on the account -> 400", async () => {
    const authActual = await import("@/lib/supabase/auth-guard")
    mock.module("@/lib/supabase/auth-guard", () => ({
      ...authActual,
      requireAuthOrApiKey: mock(async () => ({ response: null, orgId: null, dbUser: null, apiKey: null })),
      requireRoleOrScope: mock(() => null),
    }))
    mockService()
    const { GET } = await import("./route")
    const res = await GET(req("http://localhost/api/v1/construction/boq/boq-1/excel/export"), { params: Promise.resolve({ id: "boq-1" }) })
    expect(res.status).toBe(400)
  })

  test("a ServiceError from the service layer is passed through with its own status", async () => {
    await mockAuth()
    mockService({ throwError: new FakeServiceError("BOQ not found", 404) })
    const { GET } = await import("./route")
    const res = await GET(req("http://localhost/api/v1/construction/boq/boq-1/excel/export"), { params: Promise.resolve({ id: "boq-1" }) })
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBe("BOQ not found")
  })
})
