/// <reference types="bun-types" />
// R75 Part 2 Phase 3 (R-C15): report-specific PDF export + a real sharing
// mechanism.
//
// R-C15's informal text asks for a report (not a meeting -- R-C04 already
// covers meetings) that can be exported as PDF and shared via a real
// mechanism. Confirmed real by reading the source, not assumed:
//   - PDF export: GET /api/v1/projexa/reports/[reportName]/export?format=pdf
//     (src/app/api/v1/projexa/reports/[reportName]/export/route.ts) renders a
//     real PDF via generateReportDocumentPdf/generateBudgetVarianceReportPdf.
//   - Sharing: POST /api/v1/projexa/reports/share (THIS route) mints a
//     tokenised, expiring, read-only link -- "Point 118 (WhatsApp share)" per
//     report-share-service.ts's own header comment, i.e. a plain unguessable
//     URL the user pastes into WhatsApp/email themselves (not a wa.me href
//     like veri-meeting-service's composeMeetingShareTarget -- this mechanism
//     is real but deliberately narrower). The public counterpart,
//     GET /api/reports/share/[token], then renders it with no auth.
//   - report-share-service.ts's OWN comment reads "R38 (R-C15 fix): ... an
//     API-key's id is never a real users row" on this exact route's userId
//     handling, confirming this route IS the R-C15 surface.
//
// report-share-service.test.ts already covers createReportShareLink and
// isShareLinkUsable at the service/pure level thoroughly (widening,
// expiry rules, refusal-before-transaction). Nothing before this file
// exercised this ROUTE -- the actual HTTP wiring (auth/role gate, body
// parsing, ServiceError -> status mapping, the 201 + token shape a real
// PROJEXA caller receives).
import { describe, test, expect, mock } from "bun:test"

class ServiceError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

function mockAuth(ctx: { orgId: string | null; dbUser?: unknown; apiKey?: unknown; response?: unknown; roleErr?: unknown }) {
  // "dbUser" in ctx (NOT `ctx.dbUser ?? default`): a caller that explicitly
  // passes `dbUser: null` (an API-key caller with no real users row) must
  // stay null, never fall back to the default session user -- `??` would
  // wrongly treat an explicit null the same as "not provided".
  const hasDbUser = Object.prototype.hasOwnProperty.call(ctx, "dbUser")
  mock.module("@/lib/supabase/auth-guard", () => ({
    requireAuthOrApiKey: mock(async () => ({
      orgId: ctx.orgId,
      dbUser: hasDbUser ? ctx.dbUser : (ctx.orgId ? { id: "user-1" } : null),
      apiKey: ctx.apiKey ?? null,
      response: ctx.response ?? null,
    })),
    requireRoleOrScope: mock(() => ctx.roleErr ?? null),
  }))
}

function mockService(impl?: () => Promise<unknown>) {
  const createReportShareLink = mock(
    impl ?? (async () => ({ id: "link-1", token: "tok_abc123", expiresAt: new Date("2026-09-12T10:00:00Z") }))
  )
  mock.module("@/lib/services/report-share-service", () => ({ createReportShareLink, ServiceError }))
  return createReportShareLink
}

function req(body: unknown) {
  return { json: async () => body } as unknown as Request
}

const REF = { projectId: "project-1", from: "2026-09-01", to: "2026-09-30" }

describe("POST /api/v1/projexa/reports/share -- R-C15 real report-sharing mechanism", () => {
  test("real case: a valid request mints a real link and the route hands back token + expiry as 201", async () => {
    mockAuth({ orgId: "org-1" })
    const createReportShareLink = mockService(async () => ({
      id: "link-1", token: "tok_abc123", expiresAt: new Date("2026-09-12T10:00:00Z"),
    }))

    const { POST } = await import("./route")
    const res = await POST(req({ reportType: "project_status", reportRef: REF }) as never)

    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ token: "tok_abc123", expiresAt: "2026-09-12T10:00:00.000Z" })
    expect(createReportShareLink).toHaveBeenCalledTimes(1)
    const [ctxArg, inputArg] = createReportShareLink.mock.calls[0] as [unknown, unknown]
    expect(ctxArg).toEqual({ orgId: "org-1", userId: "user-1" })
    expect(inputArg).toEqual({ reportType: "project_status", reportRef: REF, expiresInHours: undefined })
  })

  test("an API-key caller with no real users row shares as userId null, never the api key's own id", async () => {
    mockAuth({ orgId: "org-1", dbUser: null, apiKey: { id: "apikey-1" } })
    const createReportShareLink = mockService()

    const { POST } = await import("./route")
    await POST(req({ reportType: "work_progress", reportRef: REF }) as never)

    const [ctxArg] = createReportShareLink.mock.calls[0] as [{ userId: unknown }]
    expect(ctxArg.userId).toBeNull()
  })

  test("a caller below the required role/scope is refused before the service is ever called", async () => {
    mockAuth({ orgId: "org-1", roleErr: new Response(JSON.stringify({ error: "This action requires member role or higher" }), { status: 403 }) })
    const createReportShareLink = mockService()

    const { POST } = await import("./route")
    const res = await POST(req({ reportType: "project_status", reportRef: REF }) as never)

    expect(res.status).toBe(403)
    expect(createReportShareLink).not.toHaveBeenCalled()
  })

  test("no organisation on the account is refused with 400 before the service is ever called", async () => {
    mockAuth({ orgId: null })
    const createReportShareLink = mockService()

    const { POST } = await import("./route")
    const res = await POST(req({ reportType: "project_status", reportRef: REF }) as never)

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: "No organisation on this account" })
    expect(createReportShareLink).not.toHaveBeenCalled()
  })

  test("a ServiceError from the service (e.g. unsupported report type) maps to its own status, not a bare 500", async () => {
    mockAuth({ orgId: "org-1" })
    mockService(async () => { throw new ServiceError("Unsupported report type. Shareable reports: work_progress, project_status, attendance_summary", 400) })

    const { POST } = await import("./route")
    const res = await POST(req({ reportType: "payroll", reportRef: REF }) as never)

    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain("Unsupported report type")
  })
})
