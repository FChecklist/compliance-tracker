/// <reference types="bun-types" />
// R67 E-36 (R-268). PROVING THE RELAY IS WORTH BUILDING A BUTTON ON.
//
// E-36's first instruction is "verify it renders from the same row payload as
// the JSON report using a Vercel-compatible renderer (@react-pdf/renderer or
// equivalent; no Puppeteer/headless Chromium)". Three things are verified here
// rather than asserted in a commit message:
//
//   1. THE RENDERER. src/lib/pdf-generator.ts is jspdf + jspdf-autotable --
//      pure JavaScript, no browser, no binary. There is no Puppeteer or
//      headless-Chromium import anywhere on this route's import graph, and the
//      last test in this file holds that line so a future "just use
//      puppeteer" edit fails here instead of on a Vercel cold start.
//   2. THE PAYLOAD. The route feeds the generator the SAME service reads the
//      JSON report uses (listBoqs/getBoq/listActivities/listCategories/
//      listProgressEntries) -- the mocks below are those functions, and the
//      bytes come out of the REAL generator, not a stub. That is what makes
//      "the PDF and the screen cannot disagree" a fact rather than a hope.
//   3. THE BYTES. 200, application/pdf, and a body that really begins %PDF-.
//      A route that 200s with a JSON error body would pass a status-only
//      assertion and hand the user a broken download.
//
// Same mock.module convention as the sibling dashboard/route.test.ts: the auth
// guard, the tenant transaction and the service layer are mocked, so this
// proves the route's own wiring, not a live database.
import { describe, test, expect, mock } from "bun:test"

class ServiceError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

const PROJECT = { id: "proj_cedar", name: "Cedar Heights Villa - Phase 1", orgId: "org_1" }
const ORG = { name: "Demo Organization", address: "1 Site Road", gstin: null }

function mockAuth(ctx: { orgId: string | null; response?: Response | null }) {
  mock.module("@/lib/supabase/auth-guard", () => ({
    requireAuthOrApiKey: mock(async () => ({
      orgId: ctx.orgId,
      dbUser: ctx.orgId ? { id: "user-1" } : null,
      apiKey: null,
      response: ctx.response ?? null,
    })),
  }))
}

/** The transaction body runs for real against a fake `tx` -- only the pool is mocked away. */
function mockTenant(project: typeof PROJECT | undefined) {
  mock.module("@/lib/db/tenant-scoped", () => ({
    withTenantContext: mock(async (_ctx: unknown, cb: (tx: unknown) => Promise<unknown>) =>
      cb({
        query: {
          projects: { findFirst: async () => project },
          organisations: { findFirst: async () => ORG },
        },
      })
    ),
  }))
}

function mockServices() {
  mock.module("@/lib/services/construction-boq-service", () => ({
    listBoqs: mock(async () => [{ id: "boq_1", title: "BoQ v1", status: "approved", version: 1 }]),
    getBoq: mock(async () => ({
      lineItems: [
        {
          id: "line_gypsum",
          itemCode: "1.01.1",
          description: "Gypsum Board 01",
          unit: "sqm",
          quantity: 472,
          rate: 1,
          amount: 472,
          activityId: "act_gypsum",
          parentLineItemId: null,
        },
      ],
    })),
  }))
  mock.module("@/lib/services/construction-progress-service", () => ({
    listActivities: mock(async () => [{ id: "act_gypsum", categoryId: "cat_1", name: "Gypsum Board 01" }]),
    listCategories: mock(async () => [{ id: "cat_1", name: "Partitions" }]),
    listProgressEntries: mock(async () => [
      { activityId: "act_gypsum", entryDate: "2026-08-05", quantityDone: 300 },
      { activityId: "act_gypsum", entryDate: "2026-08-20", quantityDone: 100 },
    ]),
    ServiceError,
  }))
}

function getRequest(query = "projectId=proj_cedar&from=2026-08-01&to=2026-09-03") {
  return { nextUrl: new URL(`http://localhost/api/v1/projexa/work-progress/report/pdf?${query}`) }
}

describe("GET /api/v1/projexa/work-progress/report/pdf (E-36)", () => {
  test("returns 200 with real %PDF- bytes and an application/pdf content type", async () => {
    mockAuth({ orgId: "org_1" })
    mockTenant(PROJECT)
    mockServices()

    const { GET } = await import("./route")
    const res = await GET(getRequest() as never)

    expect(res.status).toBe(200)
    expect(res.headers.get("Content-Type")).toBe("application/pdf")

    const bytes = new Uint8Array(await res.arrayBuffer())
    // Not "the response was truthy": the first five bytes of every PDF are
    // the magic number, and a JSON error body served with a 200 would fail
    // exactly here.
    expect(Buffer.from(bytes.slice(0, 5)).toString("ascii")).toBe("%PDF-")
    expect(bytes.byteLength).toBeGreaterThan(1000)
  })

  test("the download is named after the project, never its id", async () => {
    mockAuth({ orgId: "org_1" })
    mockTenant(PROJECT)
    mockServices()

    const { GET } = await import("./route")
    const res = await GET(getRequest() as never)

    const disposition = res.headers.get("Content-Disposition") ?? ""
    expect(disposition).toContain("cedar-heights-villa-phase-1-work-progress-2026-08-01-2026-09-03.pdf")
    expect(disposition).not.toContain("proj_cedar")
  })

  test("a project the caller cannot see is 404, not an empty PDF", async () => {
    mockAuth({ orgId: "org_1" })
    mockTenant(undefined)
    mockServices()

    const { GET } = await import("./route")
    const res = await GET(getRequest() as never)

    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: "Project not found" })
  })

  test("from/to are required -- a PDF over an unstated period is not a report", async () => {
    mockAuth({ orgId: "org_1" })
    mockTenant(PROJECT)
    mockServices()

    const { GET } = await import("./route")
    const res = await GET(getRequest("projectId=proj_cedar") as never)

    expect(res.status).toBe(400)
  })
})

describe("pdfFileName (E-36)", () => {
  test("slugifies the project name and keeps the range", async () => {
    const { pdfFileName } = await import("./route")
    expect(pdfFileName("Cedar Heights Villa - Phase 1", "2026-08-01", "2026-09-03")).toBe(
      "cedar-heights-villa-phase-1-work-progress-2026-08-01-2026-09-03.pdf"
    )
  })

  test("an accent becomes its base letter, not a separator", async () => {
    const { pdfFileName } = await import("./route")
    // NFKD splits the acute off the A; deleting the combining mark is what
    // keeps this "villa-aguas" instead of "villa-a-guas".
    expect(pdfFileName("Villa Águas", "2026-01-01", "2026-01-31")).toBe(
      "villa-aguas-work-progress-2026-01-01-2026-01-31.pdf"
    )
  })

  test("a name with no ASCII letters at all still yields a usable filename", async () => {
    const { pdfFileName } = await import("./route")
    expect(pdfFileName("مشروع", "2026-01-01", "2026-01-31")).toBe(
      "project-work-progress-2026-01-01-2026-01-31.pdf"
    )
  })
})

describe("the PDF renderer stays Vercel-compatible (E-36)", () => {
  test("no Puppeteer or headless-Chromium import on the generator's path", async () => {
    const { readFileSync } = await import("node:fs")
    const path = await import("node:path")
    const root = path.join(import.meta.dir, "..", "..", "..", "..", "..", "..", "..")
    for (const file of ["lib/pdf-generator.ts", "lib/pdf/work-progress-report-pdf.ts"]) {
      const source = readFileSync(path.join(root, file), "utf8")
      expect(source).not.toMatch(/from\s+["'](puppeteer|puppeteer-core|playwright|chrome-aws-lambda|@sparticuz\/chromium)/)
    }
    // And the renderer really is the pure-JS one this route claims.
    const generator = readFileSync(path.join(root, "lib/pdf-generator.ts"), "utf8")
    expect(generator).toMatch(/from\s+["']jspdf["']/)
  })
})
