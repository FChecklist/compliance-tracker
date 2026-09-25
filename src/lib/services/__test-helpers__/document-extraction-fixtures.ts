// PROJEXA-BUILD-001 U-36 / U-37 (BR-506, BR-507, BR-508): the shared fixtures of the extraction tests.
//   * buildFixtureWorkbook(): a 22-sheet synthetic BOQ workbook generated with SheetJS (one sheet per trade, a title row, a blank
//     row, a header row, root lines, a weighted sub-task line, blank rows in between, one hidden sheet, one empty sheet, one line
//     with a float that Excel stores as 0.30000000000000004). It has the shape of the largest real BOQ (many trade sheets, weighted
//     sub-tasks) and none of its content: the repositories are public, so no client name, figure or line of a real BOQ is used.
//   * deterministicModel: a stand-in for the extraction model that reads the digest it is given and turns each line-shaped row into
//     a BOQ line. It sees exactly what a real model would (the request the Edge Function builds), so a sheet that the digest builder
//     skipped is a sheet that produces no lines.
//   * edgeCallerFor(): an EdgeCaller that runs the REAL Edge Function handler (handler.ts) in process with an injected model, so the
//     tests cross the same boundary the route crosses (JSON body in, status and JSON out).
import * as XLSX from "xlsx"
import {
  bearerMatches,
  handleProjexaDocumentExtract,
  type ExtractDeps,
  type ModelCall,
} from "../../../../supabase/functions/projexa-document-extract/handler"
import { projectSourceLedgerKey, type EdgeCaller, type LedgerClaim, type ProjectSourceLedger } from "../document-extraction-service"

export const SHARED_SECRET = "test-shared-secret-0123456789abcdef0123"

export const TRADES = [
  "Preliminaries", "Earthworks", "Concrete", "Masonry", "Plaster", "Flooring", "Ceiling", "Painting", "Joinery", "Doors", "Windows",
  "Waterproofing", "Plumbing", "Drainage", "Electrical", "Lighting", "HVAC", "Fire Fighting", "External Works", "Landscaping",
  "Furniture", "Provisional Sums",
] as const

/** Lines the fixture holds per trade sheet: two roots and one weighted sub-task. */
export const LINES_PER_SHEET = 3
export const HIDDEN_TRADE = "Ceiling"

/** The 22 trade sheets plus one empty sheet at the end (23 sheets in the file, 22 with content). */
export function buildFixtureWorkbook(): Buffer {
  const wb = XLSX.utils.book_new()
  TRADES.forEach((trade, i) => {
    const n = i + 1
    const rows: unknown[][] = [
      [`${trade} works`],
      [],
      ["Item", "Description", "Unit", "Qty", "Rate", "Amount", "Breakdown %"],
      [`${n}.01`, `${trade}: main work item`, "m2", 10 * n, 100 + n, 10 * n * (100 + n)],
      [`${n}.01.1`, `${trade}: weighted sub task`, "", "", "", "", 40],
      [],
      [`${n}.02`, `${trade}: second item`, "nos", n, n === 1 ? 0.1 + 0.2 : 2000 + n, ""],
    ]
    if (trade === "Doors") rows.push([], ["Notes", "see drawing D-14"])
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), trade)
  })
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([]), "Empty sheet")
  const hiddenIndex = TRADES.indexOf(HIDDEN_TRADE)
  wb.Workbook = { Sheets: wb.SheetNames.map((_, i) => ({ Hidden: i === hiddenIndex ? 1 : 0 })) }
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer
}

/** A workbook of the given sheets (name and rows), for the cases that need something other than the trade fixture. */
export function buildWorkbook(sheets: Array<{ name: string; rows: unknown[][] }>): Buffer {
  const wb = XLSX.utils.book_new()
  for (const s of sheets) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(s.rows), s.name)
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer
}

type DocumentData = { fileName: string; sheets: Array<{ name: string; rows: Array<{ row: number; cells: string[] }> }> }

/** The document a model call was given: the JSON on the second line of the user message. */
export function documentOf(user: string): DocumentData {
  return JSON.parse(user.split("\n")[1]) as DocumentData
}

/** Turns every row that starts with an item code (1.01, 1.01.1) under a header row into a BOQ line, citing sheet and row. */
export const deterministicModel: ModelCall = async ({ user }) => {
  const doc = documentOf(user)
  const lineItems: Array<Record<string, unknown>> = []
  for (const sheet of doc.sheets) {
    const headerAt = sheet.rows.findIndex((r) => r.cells.some((c) => c.toLowerCase() === "description"))
    if (headerAt < 0) continue
    for (const r of sheet.rows.slice(headerAt + 1)) {
      const [code, description, unit, qty, rate, , breakdown] = r.cells
      if (!code || !/^\d+(\.\d+)+$/.test(code) || !description) continue
      const parts = code.split(".")
      const isChild = parts.length === 3
      lineItems.push({
        source: { sheet: sheet.name, row: r.row },
        itemCode: code,
        ...(isChild ? { parentItemCode: parts.slice(0, 2).join("."), breakdownPercentage: Number(breakdown) } : {}),
        description,
        unit: unit ?? "",
        ...(!isChild && qty ? { quantity: Number(qty) } : {}),
        ...(!isChild && rate ? { rate: Number(rate) } : {}),
        category: sheet.name,
      })
    }
  }
  const base = doc.fileName.replace(/\.xlsx$/i, "") || "Untitled project"
  return JSON.stringify({ schema: "boq_project_v1", project: { name: base }, boq: { title: `${base} BOQ`, lineItems } })
}

/** Deps for the real handler: the shared secret as the credential, the given model (or none), no log output. */
export function edgeDeps(model: ModelCall | null, extra: Partial<ExtractDeps> = {}): ExtractDeps {
  return { verifyCaller: async (req) => bearerMatches(req.headers.get("authorization"), SHARED_SECRET), model, log: () => {}, ...extra }
}

/** An EdgeCaller that posts to the real handler in process. `calls` counts requests and keeps the last body sent. */
export function edgeCallerFor(deps: ExtractDeps, bearer: string = SHARED_SECRET): EdgeCaller & { calls: { count: number; lastBody: string | null } } {
  const calls = { count: 0, lastBody: null as string | null }
  const caller = async (bodyJson: string) => {
    calls.count++
    calls.lastBody = bodyJson
    const res = await handleProjexaDocumentExtract(
      new Request("https://edge.test/functions/v1/projexa-document-extract", {
        method: "POST",
        headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" },
        body: bodyJson,
      }),
      deps,
    )
    let body: unknown = null
    try {
      body = await res.json()
    } catch {
      body = null
    }
    return { status: res.status, body }
  }
  return Object.assign(caller, { calls })
}

/**
 * An in-memory stand-in for the ledger with the same rules as the real one (one live claim per content key; a claim that has a
 * project is a duplicate; a claim without one is in progress; release frees an unattached claim). `events` records the calls.
 */
export function memoryLedger() {
  const rows = new Map<string, { claimId: string; projectId: string | null }>()
  const events: string[] = []
  let n = 0
  const ledger: ProjectSourceLedger = {
    async claim({ contentSha256 }): Promise<LedgerClaim> {
      events.push("claim")
      const held = rows.get(projectSourceLedgerKey(contentSha256))
      if (held) return held.projectId ? { kind: "duplicate", projectId: held.projectId } : { kind: "in_progress" }
      const claimId = `claim-${++n}`
      rows.set(projectSourceLedgerKey(contentSha256), { claimId, projectId: null })
      return { kind: "claimed", claimId }
    },
    async attach(claimId, projectId) {
      events.push("attach")
      for (const r of rows.values()) if (r.claimId === claimId) r.projectId = projectId
    },
    async release(claimId) {
      events.push("release")
      for (const [k, r] of rows) if (r.claimId === claimId && !r.projectId) rows.delete(k)
    },
  }
  return { ledger, rows, events }
}
