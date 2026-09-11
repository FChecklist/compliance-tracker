/// <reference types="bun-types" />
// ADDED 2026-09-11 (R83 P2, R-C15 REOPENED as over-credited). R81's own
// finding: PDF export is offered for only 3 of the ~39-entry report
// catalogue -- EXPORTABLE = ["budget-variance", "project-status",
// "designer-timesheet"] (route.ts:48), every other name refused at :74-80
// with a real, specific message, never a silent empty file. Until this
// file, that whitelist boundary had ZERO test coverage anywhere -- nothing
// proved the refusal actually fires, carries the real message, or that
// every genuinely-exportable name clears the gate. This is exactly the
// "real additional coverage" PM asked for, scoped to what a test can prove
// (the boundary is real and enforced) rather than the financial-statements
// gap (widening the catalogue itself), which is product work.
import { describe, test, expect, mock } from "bun:test"

async function mockAuth(orgId: string | null = "org-1") {
  // Spread the REAL module first: route.ts's own import graph pulls in
  // other auth-guard exports (hasRole etc.) this route never calls
  // directly -- fully replacing the module (rather than overriding just
  // the two functions this route's own top-level code path uses) breaks
  // those unrelated imports with a SyntaxError, confirmed by a real first
  // run of this file.
  const real = await import("@/lib/supabase/auth-guard")
  mock.module("@/lib/supabase/auth-guard", () => ({
    ...real,
    requireAuthOrApiKey: mock(async () => ({ orgId, dbUser: { id: "user-1" }, apiKey: null, response: null })),
    requireOrg: mock(() => new Response(JSON.stringify({ error: "org required" }), { status: 400 })),
  }))
}

function req(url: string) {
  return { nextUrl: new URL(url) } as unknown as import("next/server").NextRequest
}

async function callExport(reportName: string, query = "?projectId=p1") {
  await mockAuth()
  const { GET } = await import("./route")
  return GET(req(`http://localhost/api/v1/projexa/reports/${reportName}/export${query}`), {
    params: Promise.resolve({ reportName }),
  })
}

describe("GET /api/v1/projexa/reports/[reportName]/export -- R-C15 export whitelist boundary", () => {
  test("a report NOT in the real EXPORTABLE list is refused with a real, specific message naming what IS exportable -- never a silent empty file", async () => {
    const res = await callExport("trial-balance")
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe(
      "The trial-balance report has no document export yet. Exportable reports: budget-variance, project-status, designer-timesheet"
    )
  })

  test("a second, unrelated non-exportable name is refused the same way, proving this is a real whitelist check and not a single hard-coded special case", async () => {
    const res = await callExport("cash-flow")
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain("cash-flow report has no document export yet")
  })

  for (const name of ["budget-variance", "project-status", "designer-timesheet"] as const) {
    test(`the real, currently-exportable name "${name}" clears the whitelist gate (never refused as unexportable)`, async () => {
      const res = await callExport(name)
      // These three genuinely proceed past the whitelist into real service
      // calls this test does not mock (boqBudgetVarianceReport /
      // designerTimesheetReport, real DB access via withTenantContext) --
      // outside a live tenant context they fail for an UNRELATED reason
      // (no DB connection in this unit test, caught by the route's own
      // try/catch and turned into a 500). Whatever the outcome, the
      // load-bearing assertion is that it is NEVER the whitelist refusal:
      // the message must not be the "has no document export yet" text,
      // proving these three real names are inside the boundary. Also
      // confirms the whitelist itself contains ONLY these three -- a
      // fourth real name accidentally added to EXPORTABLE would not be
      // caught by this loop, but a name silently REMOVED from it would
      // surface here as a genuine 400 with the real refusal text.
      expect(res.status, `"${name}" must not be refused by the export whitelist itself`).not.toBe(400)
      const body = await res.json().catch(() => ({}))
      expect(
        body.error ?? "",
        `"${name}" must not be refused as unexportable -- it is one of the real EXPORTABLE names`
      ).not.toContain("has no document export yet")
    })
  }

  test("projectId is required independently of the whitelist -- an exportable report name still refuses a missing projectId", async () => {
    const res = await callExport("project-status", "")
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe("projectId query param is required")
  })
})
