/// <reference types="bun-types" />
// PROJEXA-BUILD-002 WP-01, register row AW-103: POST /api/v1/projexa/scope/import accepts the raw ZOOMIES workbook (22 sheets, a
// cover first, no Description column on sheet 1) into an existing project, and a single-sheet workbook still imports exactly as
// before.
//
// Only the login check and the BOQ writer are replaced (the writer records what it was given). The importer, the Excel reader
// and the multi-sheet reader are the real ones, and the workbook is a real .xlsx file built from zoomies-digest.json, so the
// route reads bytes the way it does in production.
import { beforeAll, describe, expect, mock, test } from "bun:test"
import * as XLSX from "xlsx"
import fixture from "@/lib/ingest/__fixtures__/zoomies-digest.json"
import type { WorkbookGrid } from "@/lib/ingest/types"

const GRID = fixture as unknown as WorkbookGrid
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

const createBoq = mock(async (_ctx: unknown, _input: unknown) => ({ id: "boq-1" }))
const createBoqRevision = mock(async () => ({ id: "boq-1-rev-2" }))

beforeAll(() => {
  mock.module("@/lib/supabase/auth-guard", () => ({
    requireAuthOrApiKey: mock(async () => ({ orgId: "org-1", dbUser: null, apiKey: { id: "key-1" }, response: null })),
    requireRoleOrScope: mock(() => null),
    resolveWriteActorId: mock(async () => ({ actorId: "person-1", error: null })),
  }))
  mock.module("@/lib/services/construction-boq-service", () => ({ createBoq, createBoqRevision }))
})

/** A real .xlsx from a grid. A cell that reads as a plain number is stored as a number, as Excel would have it. */
function workbookBytes(grid: WorkbookGrid): Buffer {
  const wb = XLSX.utils.book_new()
  for (const sheet of grid.sheets) {
    const aoa: (string | number)[][] = []
    for (const r of sheet.rows) {
      while (aoa.length < r.row - 1) aoa.push([])
      aoa[r.row - 1] = r.cells.map((c) => (/^-?\d+(\.\d+)?$/.test(c) && !/^0\d/.test(c) ? Number(c) : c))
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), sheet.name)
  }
  return Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }))
}

function tampered(sheet: string, row: number, cell: number, text: string): WorkbookGrid {
  const copy = JSON.parse(JSON.stringify(GRID)) as WorkbookGrid
  copy.sheets.find((s) => s.name === sheet)!.rows.find((r) => r.row === row)!.cells[cell] = text
  return copy
}

function request(bytes: Buffer, name: string, opts: { dryRun?: boolean; fields?: Record<string, string>; type?: string } = {}) {
  const formData = new FormData()
  formData.set("file", new File([new Uint8Array(bytes)], name, { type: opts.type ?? XLSX_MIME }))
  formData.set("projectId", "project-1")
  for (const [k, v] of Object.entries(opts.fields ?? {})) formData.set(k, v)
  return { formData: async () => formData, nextUrl: { searchParams: new URLSearchParams(opts.dryRun ? "dryRun=1" : "") } } as never
}

async function post(req: unknown) {
  const { POST } = await import("./route")
  const res = await POST(req as never)
  return { status: res.status, body: (await res.json()) as any }
}

describe("the raw ZOOMIES workbook", () => {
  test("a dry run returns the reader's totals, lump sums and questions and writes nothing", async () => {
    createBoq.mockClear()
    const { status, body } = await post(request(workbookBytes(GRID), "ZOOMIES.xlsx", { dryRun: true }))
    expect(status).toBe(200)
    expect(body.dryRun).toBe(true)
    expect(body.source).toBe("multisheet_bills")
    expect(body.multisheet.reconciled).toBe(true)
    expect(body.multisheet.totals.grand).toEqual({ computed: 1596280, declared: 1596280, reconciled: true })
    expect(body.multisheet.lumpSums.map((l: any) => l.amount)).toEqual([175000, 22000, 10800])
    expect(body.multisheet.questions.filter((q: any) => q.kind === "no_rate")).toHaveLength(21)
    // The preview is the same shape the single-sheet dry run has: 53 lines ready, 50 rows shown.
    expect(body.summary.readyLines).toBe(53)
    expect(body.summary.willImport).toBe(53)
    expect(body.rows).toHaveLength(50)
    expect(body.summary.rowsWithErrors).toBe(0)
    expect(createBoq).not.toHaveBeenCalled()
  })

  test("a dry run needs no project", async () => {
    const req = request(workbookBytes(GRID), "ZOOMIES.xlsx", { dryRun: true })
    ;(await (req as any).formData()).delete("projectId")
    const { status, body } = await post(req)
    expect(status).toBe(200)
    expect(body.multisheet.totals.grand.computed).toBe(1596280)
  })

  test("the import creates ONE BOQ in the existing project: 50 priced lines and 3 lump sums, 1,596,280 in all", async () => {
    createBoq.mockClear()
    const { status, body } = await post(request(workbookBytes(GRID), "ZOOMIES.xlsx"))
    expect(status).toBe(201)
    expect(createBoq).toHaveBeenCalledTimes(1)
    const [ctx, input] = createBoq.mock.calls[0] as [any, any]
    expect(ctx).toEqual({ orgId: "org-1", userId: "person-1" })
    expect(input.projectId).toBe("project-1")
    expect(input.title).toBe("ZOOMIES")
    expect(input.lineItems).toHaveLength(53)
    const codes = input.lineItems.map((l: any) => l.itemCode)
    expect(new Set(codes).size).toBe(53)
    expect(codes.some((c: string) => c.includes("."))).toBe(false)
    expect(input.lineItems.every((l: any) => l.rate > 0 && l.quantity > 0)).toBe(true)
    expect(input.lineItems.filter((l: any) => l.unit === "LS")).toHaveLength(3)
    const total = input.lineItems.reduce((s: number, l: any) => s + l.quantity * l.rate, 0)
    expect(Math.round(total * 100) / 100).toBe(1596280)
    expect(body.boq).toEqual({ id: "boq-1" })
    expect(body.importSummary.totalValue).toBe(1596280)
    expect(body.importSummary.importedLineItems).toBe(53)
    expect(body.importSummary.multisheet.reconciled).toBe(true)
    expect(body.importSummary.multisheet.questions.length).toBeGreaterThan(0)
  })

  test("a workbook whose lines do not add up to the printed totals is refused unless the caller acknowledges it", async () => {
    // Play Bill 3 item 1: quantity 351 -> 350.
    const bytes = workbookBytes(tampered("Table 7", 5, 3, "350"))
    createBoq.mockClear()
    const refused = await post(request(bytes, "ZOOMIES.xlsx"))
    expect(refused.status).toBe(400)
    expect(refused.body.code).toBe("RECONCILIATION_REQUIRED")
    expect(refused.body.multisheet.diffs.length).toBeGreaterThan(0)
    expect(createBoq).not.toHaveBeenCalled()

    const acknowledged = await post(request(bytes, "ZOOMIES.xlsx", { fields: { acknowledgeShortfall: "true" } }))
    expect(acknowledged.status).toBe(201)
    expect(createBoq).toHaveBeenCalledTimes(1)
    expect(acknowledged.body.importSummary.totalValue).toBe(1596050)
    expect(acknowledged.body.importSummary.multisheet.reconciled).toBe(false)
  })

  test("a revision of an existing BOQ takes the same lines", async () => {
    createBoq.mockClear()
    createBoqRevision.mockClear()
    const { status } = await post(request(workbookBytes(GRID), "ZOOMIES.xlsx", { fields: { parentBoqId: "boq-0" } }))
    expect(status).toBe(201)
    expect(createBoq).not.toHaveBeenCalled()
    expect(createBoqRevision).toHaveBeenCalledTimes(1)
  })
})

describe("a single-sheet workbook imports exactly as before", () => {
  const single = () => {
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ["Sl No", "Description", "Unit", "Qty", "Rate"],
        ["1", "Excavation", "m3", 10, 500],
        ["2", "Backfill", "m3", 4, 250],
      ]),
      "BOQ"
    )
    return Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }))
  }

  test("the fallback is not used: same lines as the importer gives, same response shape, no multisheet key", async () => {
    createBoq.mockClear()
    const bytes = single()
    const { parseBoqSpreadsheet } = await import("@/lib/services/construction-boq-import-service")
    const direct = await parseBoqSpreadsheet(bytes, "boq.xlsx", XLSX_MIME)
    const { status, body } = await post(request(bytes, "boq.xlsx"))
    expect(status).toBe(201)
    expect((createBoq.mock.calls[0] as [unknown, any])[1].lineItems).toEqual(direct.lineItems)
    expect(direct.lineItems).toHaveLength(2)
    expect(Object.keys(body).sort()).toEqual(["boq", "importSummary"])
    expect(Object.keys(body.importSummary).sort()).toEqual(["importedLineItems", "totalRows", "totalValue", "warnings"])
    expect(body.importSummary.totalValue).toBe(6000)
  })

  test("its dry run has no source and no multisheet section", async () => {
    const { status, body } = await post(request(single(), "boq.xlsx", { dryRun: true }))
    expect(status).toBe(200)
    expect(body.source).toBeUndefined()
    expect(body.multisheet).toBeUndefined()
    expect(body.summary.readyLines).toBe(2)
    expect(body.headers).toContain("Description")
  })

  test("a workbook with no Description column and no bill sheet still answers the original 400", async () => {
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Name", "Comment"], ["a", "b"]]), "Notes")
    const { status, body } = await post(request(Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" })), "notes.xlsx"))
    expect(status).toBe(400)
    expect(body.error).toBe("Could not find a Description column in this spreadsheet")
  })

  test("a csv with no Description column is not sent to the workbook reader: the original 400 stands", async () => {
    const { status, body } = await post(request(Buffer.from("Name,Comment\na,b\n"), "notes.csv", { type: "text/csv" }))
    expect(status).toBe(400)
    expect(body.error).toBe("Could not find a Description column in this spreadsheet")
  })
})
