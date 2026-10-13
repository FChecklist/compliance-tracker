/// <reference types="bun-types" />
// Sumeet R-C15 / R-C11 (2026-10-13): any project report downloads as PDF, XLSX and CSV from the SAME table the screen shows. Before this only three
// reports (budget-variance, project-status, designer-timesheet) had a document; every other name was refused with "has no document export yet".
// Runs the REAL route and the REAL buildReportTable / schema / writers; only auth, the report run (payload), the base currency and the tenant read are doubled.
// Run: bun test --isolate "src/app/api/v1/projexa/reports/[reportName]/export/generic.test.ts"
import { afterAll, describe, expect, mock, test } from "bun:test"
import * as XLSX from "xlsx"

const PAYLOAD = {
  byTrade: [
    { trade: "Mason", workerDays: "3", totalCost: "540" },
    { trade: "=HYPERLINK(\"http://x\")", workerDays: "1", totalCost: "180" },
  ],
}

const realAuth = await import("@/lib/supabase/auth-guard")
const realDispatch = await import("@/lib/services/report-run-dispatch")
const realTenant = await import("@/lib/db/tenant-scoped")
const realErp = await import("@/lib/services/erp-accounting-service")
let current: unknown = PAYLOAD
let runCalls: { report: string; params: string; projectId: string }[] = []
mock.module("@/lib/supabase/auth-guard", () => ({
  ...realAuth,
  requireAuthOrApiKey: mock(async () => ({ orgId: "org-1", dbUser: { id: "u1" }, apiKey: null, response: null })),
}))
mock.module("@/lib/services/report-run-dispatch", () => ({
  ...realDispatch,
  runReportPayload: mock(async (_org: string, report: string, sp: URLSearchParams, projectId: string) => {
    runCalls.push({ report, params: sp.toString(), projectId })
    return current
  }),
}))
mock.module("@/lib/services/erp-accounting-service", () => ({ ...realErp, getBaseCurrency: mock(async () => ({ baseCurrency: { code: "AED" } })) }))
mock.module("@/lib/db/tenant-scoped", () => ({
  ...realTenant,
  withTenantContext: mock(async (_c: unknown, fn: (tx: unknown) => unknown) =>
    fn({
      query: {
        projects: { findFirst: async () => ({ id: "p1", name: "UAT Villa" }) },
        organisations: { findFirst: async () => ({ name: "Demo Org", address: null, gstin: null }) },
        erpCurrencies: { findFirst: async () => ({ code: "AED" }) },
      },
    })
  ),
}))
afterAll(async () => {
  mock.restore()
  await mock.module("@/lib/supabase/auth-guard", () => realAuth)
  await mock.module("@/lib/services/report-run-dispatch", () => realDispatch)
  await mock.module("@/lib/services/erp-accounting-service", () => realErp)
  await mock.module("@/lib/db/tenant-scoped", () => realTenant)
})

async function call(report: string, query: string) {
  const { GET } = await import("./route")
  const request = { nextUrl: new URL(`http://localhost/api/v1/projexa/reports/${report}/export${query}`) } as unknown as import("next/server").NextRequest
  return GET(request, { params: Promise.resolve({ reportName: report }) })
}

describe("generic project-report export (R-C15 / R-C11)", () => {
  test("a report with no hand-written schema now exports CSV: the table's own columns, rows and a Grand Total row", async () => {
    const res = await call("manpower-cost", "?projectId=p1&format=csv")
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toContain("text/csv")
    const text = await res.text()
    const lines = text.split("\n")
    expect(lines[0]).toBe("Trade,Worker-days,Cost")
    expect(lines[1]).toBe("Mason,3,540")
    expect(lines.at(-1)).toBe("Grand Total,4,720")
  })

  test("XLSX is a real workbook with the same grid, and a text cell starting with = is stored as text, not a formula", async () => {
    const res = await call("manpower-cost", "?projectId=p1&format=xlsx")
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toContain("spreadsheetml")
    const wb = XLSX.read(Buffer.from(await res.arrayBuffer()), { type: "buffer" })
    const grid = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "" })
    expect(grid[0]).toEqual(["Trade", "Worker-days", "Cost"])
    expect(grid[1]).toEqual(["Mason", 3, 540])
    expect(String(grid[2]![0]).startsWith("'=")).toBe(true)
    expect(grid.at(-1)).toEqual(["Grand Total", 4, 720])
  })

  test("a report with no rows still downloads with its column names (CSV header line, XLSX header row), never a 0-byte file", async () => {
    current = { byTrade: [] }
    try {
      const csv = await call("manpower-cost", "?projectId=p1&format=csv")
      expect(await csv.text()).toBe("Trade,Worker-days,Cost")
      const xlsx = await call("manpower-cost", "?projectId=p1&format=xlsx")
      const wb = XLSX.read(Buffer.from(await xlsx.arrayBuffer()), { type: "buffer" })
      const grid = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "" })
      expect(grid).toEqual([["Trade", "Worker-days", "Cost"]])
    } finally {
      current = PAYLOAD
    }
  })

  test("the printed subtitle states the period in the house dd-mm-yyyy, never 2026-10-01", async () => {
    const res = await call("manpower-cost", "?projectId=p1&format=pdf&from=2026-10-01&to=2026-10-13")
    const raw = Buffer.from(await res.arrayBuffer()).toString("latin1")
    expect(raw).toContain("01-10-2026 to 13-10-2026")
    expect(raw).not.toContain("2026-10-01 to")
  })

  test("PDF is a real PDF document", async () => {
    const res = await call("manpower-cost", "?projectId=p1&format=pdf")
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toBe("application/pdf")
    const bytes = new Uint8Array(await res.arrayBuffer())
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-")
    expect(bytes.length).toBeGreaterThan(1500)
  })

  test("the report is run with the SAME query parameters the screen sent (date, trade), so file and table agree", async () => {
    runCalls = []
    await call("manpower-cost", "?projectId=p1&format=csv&date=2026-10-05&trade=Mason")
    expect(runCalls).toHaveLength(1)
    expect(runCalls[0]!.projectId).toBe("p1")
    expect(runCalls[0]!.params).toContain("date=2026-10-05")
    expect(runCalls[0]!.params).toContain("trade=Mason")
  })

  test("a name that is not a report is refused in words, and a missing projectId is refused", async () => {
    const bad = await call("trial-balance", "?projectId=p1")
    expect(bad.status).toBe(400)
    expect((await bad.json()).error).toContain("trial-balance report is not a project report")
    const noProject = await call("manpower-cost", "?format=csv")
    expect(noProject.status).toBe(400)
  })

  test("an unknown format is refused", async () => {
    const res = await call("manpower-cost", "?projectId=p1&format=docx")
    expect(res.status).toBe(400)
  })
})
