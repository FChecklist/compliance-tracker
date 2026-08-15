/// <reference types="bun-types" />
// task-20260727-101145 (external-AI-facing reporting API gateway):
// STRICT_TENANT_ISOLATION was the Owner's explicit top requirement for this
// task. The real isolation guarantee lives in withTenantContext()'s Postgres
// RLS policies inside executeReportDefinition() (already relied on at ~30
// other call sites, confirmed live via Supabase MCP against this project's
// real report_definitions/compliance_items RLS policies while building this
// route -- see the PR description for that evidence) -- this task's own new
// code has exactly one job that could newly break tenant isolation: never
// let a caller's request body/query substitute a different org for the
// authenticated caller's own ctx.orgId. That is what this file's
// "tenant isolation" tests actually verify, both directly (attempted
// spoofing) and via two independent orgs never bleeding into each other.
//
// Matches this repo's established no-live-DB .test.ts convention (see
// api-key-auth.test.ts, branding/route.test.ts): @/lib/supabase/auth-guard
// and @/lib/services/report-engine-service are both mock.module()'d --
// requireReportsReadAccess itself has its own dedicated real-implementation
// tests in src/lib/supabase/auth-guard.test.ts, so it's stubbed to
// always-allow here to isolate this file to the tenant-isolation/format
// concerns only.
import { describe, test, expect, mock } from "bun:test"
import { NextRequest } from "next/server"
import * as XLSX from "xlsx"

function mockAuth(ctx: { orgId: string | null; apiKeyId?: string; response?: Response | null }) {
  mock.module("@/lib/supabase/auth-guard", () => ({
    requireAuthOrApiKey: mock(async () => ({
      orgId: ctx.orgId,
      dbUser: null,
      apiKey: ctx.orgId ? { id: ctx.apiKeyId ?? "key-1", name: "Test Key", scopes: ["read"] } : null,
      response: ctx.response ?? null,
    })),
    requireReportsReadAccess: mock(() => null),
  }))
}

function mockEngine(result: unknown) {
  const executeReportDefinition = mock(async () => result)
  // Also stubs getFullReportCatalog (unused by this route) -- see the
  // matching comment in ../../catalog/route.test.ts's mockCatalog() for why:
  // mock.module() replaces this module's exports process-wide, and that
  // file imports the same specifier.
  mock.module("@/lib/services/report-engine-service", () => ({
    executeReportDefinition,
    getFullReportCatalog: mock(async () => []),
    ServiceError: class ServiceError extends Error {
      status: number
      constructor(message: string, status: number) {
        super(message)
        this.status = status
      }
    },
  }))
  return executeReportDefinition
}

function postRequest(body: unknown, query = "") {
  return new NextRequest(`http://localhost/api/v1/reports/definitions/report-1/run${query}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer vk_test" },
    body: JSON.stringify(body),
  })
}

describe("POST /api/v1/reports/definitions/[id]/run (tenant isolation)", () => {
  test("orgId passed to executeReportDefinition is ALWAYS the authenticated org, never a value from the request body", async () => {
    mockAuth({ orgId: "org-b", apiKeyId: "key-org-b" })
    const executeReportDefinition = mockEngine({ columns: ["Note"], rows: [] })

    const { POST } = await import("./route")
    const res = await POST(
      postRequest({ orgId: "org-a", params: { orgId: "org-a", companyId: "spoofed" } }) as any,
      { params: Promise.resolve({ id: "report-1" }) }
    )

    expect(res.status).toBe(200)
    expect(executeReportDefinition).toHaveBeenCalledTimes(1)
    const [ctxArg] = executeReportDefinition.mock.calls[0] as [{ orgId: string; userId?: string }, string, unknown]
    expect(ctxArg.orgId).toBe("org-b")
  })

  test("two independent orgs calling the same report id never see their orgId cross over", async () => {
    mockAuth({ orgId: "org-a", apiKeyId: "key-org-a" })
    const executeA = mockEngine({ columns: ["Note"], rows: [{ Note: "org-a data" }] })
    const { POST: POST_A } = await import("./route")
    await POST_A(postRequest({}) as any, { params: Promise.resolve({ id: "report-1" }) })
    expect((executeA.mock.calls[0] as any[])[0].orgId).toBe("org-a")

    mockAuth({ orgId: "org-b", apiKeyId: "key-org-b" })
    const executeB = mockEngine({ columns: ["Note"], rows: [{ Note: "org-b data" }] })
    const { POST: POST_B } = await import("./route")
    await POST_B(postRequest({}) as any, { params: Promise.resolve({ id: "report-1" }) })
    expect((executeB.mock.calls[0] as any[])[0].orgId).toBe("org-b")
  })

  test("a missing/invalid API key never reaches executeReportDefinition", async () => {
    mockAuth({ orgId: null, response: new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }) })
    const executeReportDefinition = mockEngine({ columns: [], rows: [] })

    const { POST } = await import("./route")
    const res = await POST(postRequest({}) as any, { params: Promise.resolve({ id: "report-1" }) })

    expect(res.status).toBe(401)
    expect(executeReportDefinition).not.toHaveBeenCalled()
  })
})

describe("POST /api/v1/reports/definitions/[id]/run (export wiring)", () => {
  const RESULT = { columns: ["Department", "Open Items"], rows: [{ Department: "Legal", "Open Items": 3 }, { Department: "Finance", "Open Items": 12 }] }

  test("?format=csv returns the report's rows as real CSV, flowing through the shared export builder unmocked", async () => {
    mockAuth({ orgId: "org-b" })
    mockEngine(RESULT)

    const { POST } = await import("./route")
    const res = await POST(postRequest({}, "?format=csv") as any, { params: Promise.resolve({ id: "report-1" }) })

    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toMatch(/text\/csv/)
    const text = await res.text()
    expect(text).toBe("Department,Open Items\nLegal,3\nFinance,12")
  })

  test("?format=xlsx returns a real, re-readable XLSX workbook containing the report's rows", async () => {
    mockAuth({ orgId: "org-b" })
    mockEngine(RESULT)

    const { POST } = await import("./route")
    const res = await POST(postRequest({}, "?format=xlsx") as any, { params: Promise.resolve({ id: "report-1" }) })

    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toMatch(/spreadsheetml/)
    const buffer = Buffer.from(await res.arrayBuffer())
    const wb = XLSX.read(buffer, { type: "buffer" })
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]])
    expect(rows).toEqual(RESULT.rows)
  })

  test("no format param returns plain JSON (default), unchanged from the existing session-auth route's shape", async () => {
    mockAuth({ orgId: "org-b" })
    mockEngine(RESULT)

    const { POST } = await import("./route")
    const res = await POST(postRequest({}) as any, { params: Promise.resolve({ id: "report-1" }) })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(RESULT)
  })
})
