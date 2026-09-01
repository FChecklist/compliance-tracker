/// <reference types="bun-types" />
// R60 T7 (E-52 sweep, house-pattern "silent-empty-200"): GET previously
// returned 200 { salesInvoices: [], total: 0, page: 1, limit: 25,
// totalPages: 0 } when ctx.orgId was falsy -- on financial data, a broken
// org context looked identical to "authenticated tenant, zero invoices".
// POST in this same file already returned 400 "No organisation on this
// account" for the identical condition. Fixed to match. Same mock.module
// convention as reports/catalog/route.test.ts: auth-guard and the service
// layer are both mocked, proving the route's own wiring, not a live DB.
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
  }))
}

function mockService(implOverride?: () => Promise<unknown>) {
  const listSalesInvoicesPaged = mock(implOverride ?? (async () => ({ invoices: [], total: 0, page: 1, limit: 25, totalPages: 0 })))
  mock.module("@/lib/services/erp-invoicing-service", () => ({
    listSalesInvoicesPaged,
    createSalesInvoice: mock(async () => ({ id: "inv-1" })),
    ServiceError,
  }))
  return listSalesInvoicesPaged
}

function getRequest() {
  // Plain Request has no .nextUrl (that's a Next.js-specific NextRequest
  // extension) -- requireAuthOrApiKey is mocked above and never inspects
  // the request object itself, so a minimal stand-in carrying just the
  // .nextUrl the route body actually reads is enough here.
  return { nextUrl: new URL("http://localhost/api/v1/projexa/sales-invoices") }
}

describe("GET /api/v1/projexa/sales-invoices", () => {
  test("a caller with no resolvable org now gets 400, matching this file's own POST -- not a silent 200 empty list on financial data", async () => {
    mockAuth({ orgId: null })
    const listSalesInvoicesPaged = mockService()

    const { GET } = await import("./route")
    const res = await GET(getRequest() as any)

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: "No organisation on this account" })
    expect(listSalesInvoicesPaged).not.toHaveBeenCalled()
  })

  test("real case: authenticated + org resolved calls listSalesInvoicesPaged with the caller's own orgId", async () => {
    mockAuth({ orgId: "org-1" })
    const listSalesInvoicesPaged = mockService(async () => ({
      invoices: [
        { id: "inv-1", invoiceNumber: 1, customerId: "cust-1", salesOrderId: null, projectId: null, postingDate: "2026-08-01", dueDate: null, grandTotal: "1000.00", outstandingAmount: "1000.00", status: "unpaid" },
      ],
      total: 1,
      page: 1,
      limit: 25,
      totalPages: 1,
    }))

    const { GET } = await import("./route")
    const res = await GET(getRequest() as any)

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.total).toBe(1)
    expect(body.salesInvoices).toHaveLength(1)
    expect(body.salesInvoices[0].id).toBe("inv-1")
    expect(listSalesInvoicesPaged).toHaveBeenCalledTimes(1)
    expect(listSalesInvoicesPaged.mock.calls[0][0]).toEqual({ orgId: "org-1" })
  })
})
