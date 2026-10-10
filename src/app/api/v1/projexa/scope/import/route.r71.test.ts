/// <reference types="bun-types" />
// R-71 "Import: Malformed row rejected readably" -- closure test through the real import route and the REAL parser.
//
// Earlier proof was pure-function tests of mapRowsToLineItems. Here a real CSV with one malformed row (Qty "TBD") is
// posted to the real POST handler, which runs the real parseBoqSpreadsheet(); only auth and the BOQ write service are
// doubled. Asserted: the preview names the bad row in plain words and counts it as an error and keeps it out of
// "willImport"; a commit never hands the bad row to the writer (the write double records exactly what would be saved)
// while the good rows still go; a file whose rows are ALL malformed is refused with 400 and nothing is written.
// Run: bun test --isolate src/app/api/v1/projexa/scope/import/route.r71.test.ts
import { describe, test, expect, mock, beforeEach } from "bun:test"
import { actingPersonDouble } from "@/lib/supabase/__test-helpers__/acting-person-double"

const written: Array<{ lineItems: Array<{ itemCode?: string | null; description: string }> }> = []

beforeEach(() => {
  written.length = 0
  mock.module("@/lib/supabase/auth-guard", () => ({
    ...actingPersonDouble(),
    requireAuthOrApiKey: mock(async () => ({ orgId: "org-r71", dbUser: null, apiKey: { id: "key-1" }, response: null })),
    requireRoleOrScope: mock(() => null),
    resolveWriteActorId: mock(async () => ({ actorId: "person-1", error: null })),
  }))
  mock.module("@/lib/services/construction-boq-service", () => ({
    createBoq: mock(async (_ctx: unknown, input: { lineItems: Array<{ itemCode?: string | null; description: string }> }) => {
      written.push(input)
      return { id: "boq-1" }
    }),
    createBoqRevision: mock(async () => ({ id: "rev" })),
  }))
})

function upload(csv: string, dryRun: boolean) {
  const formData = new FormData()
  formData.set("file", new File([csv], "boq.csv", { type: "text/csv" }))
  formData.set("projectId", "project-1")
  return {
    formData: async () => formData,
    nextUrl: { searchParams: new URLSearchParams(dryRun ? "dryRun=1" : "") },
  } as any
}

const MIXED = "code,description,unit,quantity,rate\n1,Blockwork,sqm,10,5\n2,Plaster,sqm,TBD,5\n3,Paint,sqm,4,6\n"
const ALL_BAD = "code,description,unit,quantity,rate\n1,Blockwork,sqm,lots,5\n2,Plaster,sqm,TBD,5\n"

describe("R-71 POST /api/v1/projexa/scope/import: a malformed row is rejected readably", () => {
  test("preview: names the sheet row in words, counts one error, willImport excludes it, nothing written", async () => {
    const { POST } = await import("./route")
    const res = await POST(upload(MIXED, true))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.dryRun).toBe(true)
    expect(body.issues).toContainEqual({ row: 3, message: "Row 3: Qty is not a number", blocking: true })
    expect(body.summary.rowsWithErrors).toBe(1)
    expect(body.summary.readyLines).toBe(2)
    expect(written).toEqual([])
  })

  test("commit: the bad row is never handed to the writer, the good rows are", async () => {
    const { POST } = await import("./route")
    const res = await POST(upload(MIXED, false))
    expect(res.status).toBe(201)
    expect(written).toHaveLength(1)
    expect(written[0].lineItems.map((l) => l.description)).toEqual(["Blockwork", "Paint"])
  })

  test("commit of a file where every row is malformed: 400 'No usable line items', nothing written", async () => {
    const { POST } = await import("./route")
    const res = await POST(upload(ALL_BAD, false))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe("No usable line items found in this spreadsheet")
    expect(written).toEqual([])
  })
})
