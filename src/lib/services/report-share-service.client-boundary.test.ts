/// <reference types="bun-types" />
// R85 Addendum 3 v4 Phase 6 -- VISIBILITY AND THE CLIENT BOUNDARY, gate
// 6-03b. resolveReportShareLink() backs the PUBLIC, UNAUTHENTICATED
// /api/reports/share/[token] route (see that route.ts's own "Intentionally
// public" comment) -- it must never carry cost/project-side/variance fields,
// even for a share token an internal user created with full cost
// visibility. There is no role to check here at all (redactForPublicShare
// is unconditional, see cost-visibility-service.ts), which is exactly what
// is proven below: mocking a real service response that DOES contain
// rate_project-shaped data, then asserting the public resolver strips it
// regardless.
import { describe, test, expect, mock, beforeEach } from "bun:test"

const ORG_ID = "org-1"

const RAW_LINE_ITEM = {
  id: "line-1",
  boqId: "boq-1",
  parentLineItemId: null as string | null,
  qtyProject: "100",
  rateProject: "40",
  qtyContract: "100",
  rateContract: "50",
  description: "Excavation",
}

function mockLink(reportType: string) {
  mock.module("@/lib/db/preauth-lookups", () => ({
    lookupReportShareLinkByToken: mock(async () => ({
      id: "link-1",
      orgId: ORG_ID,
      reportType,
      reportRef: JSON.stringify({ projectId: "proj-1", from: "2026-09-01", to: "2026-09-10" }),
      token: "tok-1",
      createdById: "user-1",
      expiresAt: new Date("2026-12-01T00:00:00Z"),
      revokedAt: null,
      createdAt: new Date("2026-08-01T00:00:00Z"),
    })),
  }))
}

function mockBoqReads() {
  mock.module("./construction-boq-service", () => ({
    listBoqs: mock(async () => [{ id: "boq-1", title: "Villa Phase 1", status: "approved" }]),
    getBoq: mock(async () => ({ id: "boq-1", title: "Villa Phase 1", status: "approved", lineItems: [{ ...RAW_LINE_ITEM }] })),
  }))
}

function mockProgressReads() {
  mock.module("./construction-progress-service", () => ({
    listActivities: mock(async () => []),
    listCategories: mock(async () => []),
    listProgressEntries: mock(async () => []),
  }))
}

function mockDashboard() {
  mock.module("./construction-dashboard-service", () => ({
    getProjectDashboard: mock(async () => ({ totalValue: 100000 })),
  }))
}

function mockReportsService() {
  mock.module("./construction-reports-service", () => ({
    attendanceSummary: mock(async () => ({ totalDays: 10 })),
    // A real boqBudgetVarianceReport does not carry qty/rate-project shaped
    // data today -- these fields are added here deliberately so this test
    // proves redactForPublicShare's wrapper works structurally, independent
    // of exactly what construction-reports-service.ts happens to return
    // right now (which is a different, out-of-scope feature -- see this
    // phase's own ACTIVE-CLAIMS.yaml note on Point 154's budget overlay).
    boqBudgetVarianceReport: mock(async () => ({
      boqTitle: "Villa Phase 1",
      totalBudget: 50000,
      totalVendorAmount: 20000,
      lines: [{ isRootLine: true, description: "Excavation", amount: 5000, ...RAW_LINE_ITEM }],
    })),
  }))
}

beforeEach(() => {
  mockBoqReads()
  mockProgressReads()
  mockDashboard()
  mockReportsService()
})

describe("resolveReportShareLink -- 6-03b: a public unauthenticated share token never carries cost fields", () => {
  test("work_progress report: lineItems never contain rate_project/qty_project, contract-side figures survive", async () => {
    mockLink("work_progress")
    const { resolveReportShareLink } = await import("./report-share-service")
    const result = (await resolveReportShareLink("tok-1")) as { lineItems: Array<Record<string, unknown>> }
    const text = JSON.stringify(result)
    expect(text).not.toContain("rateProject")
    expect(text).not.toContain("qtyProject")
    expect(result.lineItems[0]!.qtyContract).toBe("100")
    expect(result.lineItems[0]!.rateContract).toBe("50")
    expect(result.lineItems[0]!.description).toBe("Excavation")
  })

  test("project_status report: lines never contain project-side decomposition fields either", async () => {
    mockLink("project_status")
    const { resolveReportShareLink } = await import("./report-share-service")
    const result = (await resolveReportShareLink("tok-1")) as { lines: Array<Record<string, unknown>> }
    const text = JSON.stringify(result)
    expect(text).not.toContain("rateProject")
    expect(text).not.toContain("qtyProject")
    expect(result.lines[0]!.qtyContract).toBe("100")
  })
})
