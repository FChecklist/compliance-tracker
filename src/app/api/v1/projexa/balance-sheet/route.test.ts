/// <reference types="bun-types" />
// API_READ_WITHOUT_ROLE_CHECK regression guard (R58 Lane 2, 2026-08-27): this
// GET handler used to have no role floor at all -- any authenticated
// rank-1 user (viewer/client_viewer/external_auditor/stage_0, see ROLE_RANK
// in auth-guard.ts) could read the org's full balance sheet (every GL
// account's real netBalance plus totalAssets/totalLiabilities/totalEquity).
//
// requireAuthOrApiKey is mocked; requireRoleOrScope is the REAL
// implementation from auth-guard.ts (imported once, at top level, before
// mock.module runs -- same pattern auth-guard.test.ts already uses
// successfully), so these tests exercise the actual authorization decision,
// not a stubbed one. erp-financial-report-service is mocked entirely (no
// real import) -- it pulls in @/lib/db (a real postgres pool at module
// scope) which this test environment has no DATABASE_URL for, and this
// route's own logic (query-param parsing, response passthrough) is the only
// thing worth exercising here regardless.
import { describe, test, expect, mock } from "bun:test"
import { NextRequest } from "next/server"
import { requireRoleOrScope } from "@/lib/supabase/auth-guard"

class FakeServiceError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

mock.module("@/lib/supabase/auth-guard", () => ({
  requireAuthOrApiKey: mock(async () => currentAuthCtx),
  requireRoleOrScope,
}))

mock.module("@/lib/services/erp-financial-report-service", () => ({
  balanceSheet: balanceSheetMock,
  ServiceError: FakeServiceError,
}))

let currentAuthCtx: { orgId: string | null; dbUser: unknown; apiKey: unknown; response: Response | null }
const balanceSheetMock = mock(async () => SAMPLE_REPORT)

function setAuth(ctx: { orgId: string | null; role?: string; response?: Response | null }) {
  currentAuthCtx = {
    orgId: ctx.orgId,
    dbUser: ctx.role ? { id: "user-1", role: ctx.role } : null,
    apiKey: null,
    response: ctx.response ?? null,
  }
}

function getRequest(query = "") {
  return new NextRequest(`http://localhost/api/v1/projexa/balance-sheet${query}`)
}

const SAMPLE_REPORT = {
  asOfDate: "2026-08-27",
  assets: [{ accountNumber: "1000", netBalance: 500000 }],
  liabilities: [{ accountNumber: "2000", netBalance: -120000 }],
  equity: [{ accountNumber: "3000", netBalance: -380000 }],
  totalAssets: 500000,
  totalLiabilities: 120000,
  totalEquity: 380000,
  isBalanced: true,
}

describe("GET /api/v1/projexa/balance-sheet", () => {
  test("a rank-1 role (external_auditor) is rejected with 403, balanceSheet is never called", async () => {
    setAuth({ orgId: "org-1", role: "external_auditor" })
    balanceSheetMock.mockClear()

    const { GET } = await import("./route")
    const res = await GET(getRequest() as any)

    expect(res.status).toBe(403)
    expect(balanceSheetMock).not.toHaveBeenCalled()
  })

  test("a rank-1 role (client_viewer) is rejected with 403, balanceSheet is never called", async () => {
    setAuth({ orgId: "org-1", role: "client_viewer" })
    balanceSheetMock.mockClear()

    const { GET } = await import("./route")
    const res = await GET(getRequest() as any)

    expect(res.status).toBe(403)
    expect(balanceSheetMock).not.toHaveBeenCalled()
  })

  test("a rank-2 role (member, the chosen floor) succeeds and reaches balanceSheet", async () => {
    setAuth({ orgId: "org-1", role: "member" })
    balanceSheetMock.mockClear()

    const { GET } = await import("./route")
    const res = await GET(getRequest() as any)

    expect(res.status).toBe(200)
    expect(balanceSheetMock).toHaveBeenCalledTimes(1)
    expect(await res.json()).toEqual(SAMPLE_REPORT)
  })

  test("a role above the floor (admin) also succeeds", async () => {
    setAuth({ orgId: "org-1", role: "admin" })
    balanceSheetMock.mockClear()

    const { GET } = await import("./route")
    const res = await GET(getRequest() as any)

    expect(res.status).toBe(200)
    expect(balanceSheetMock).toHaveBeenCalledTimes(1)
  })

  test("an unauthenticated caller never reaches the role check or balanceSheet", async () => {
    setAuth({
      orgId: null,
      response: new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }),
    })
    balanceSheetMock.mockClear()

    const { GET } = await import("./route")
    const res = await GET(getRequest() as any)

    expect(res.status).toBe(401)
    expect(balanceSheetMock).not.toHaveBeenCalled()
  })
})
