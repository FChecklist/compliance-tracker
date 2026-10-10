// PROJEXA-BUILD-001 U-36 / U-37 (BR-506, BR-507, BR-508): the shared fixtures of the extraction tests.
//   * craftZip(): a zip archive written by hand, for the archives a workbook writer never produces (declared sizes that lie,
//     entries that share one stream) and for the data-descriptor layout of .NET writers (repackWithDataDescriptors());
//     buildWorkbook() can also declare a sheet range that holds no cells.
//   * buildFixtureWorkbook(): a 22-sheet synthetic BOQ workbook generated with SheetJS (one sheet per trade, a title row, a blank
//     row, a header row, root lines, a weighted sub-task line, blank rows in between, one hidden sheet, one empty sheet, one line
//     with a float that Excel stores as 0.30000000000000004). It has the shape of the largest real BOQ (many trade sheets, weighted
//     sub-tasks) and none of its content: the repositories are public, so no client name, figure or line of a real BOQ is used.
//   * deterministicModel: a stand-in for the extraction model that reads the digest it is given and turns each line-shaped row into
//     a BOQ line. It sees exactly what a real model would (the request the Edge Function builds), so a sheet that the digest builder
//     skipped is a sheet that produces no lines.
//   * edgeCallerFor(): an EdgeCaller that runs the REAL Edge Function handler (handler.ts) in process with an injected model, so the
//     tests cross the same boundary the route crosses (JSON body in, status and JSON out).
import { deflateRawSync } from "node:zlib"
import * as XLSX from "xlsx"
import {
  bearerMatches,
  handleProjexaDocumentExtract,
  type ExtractDeps,
  type ModelCall,
} from "../../../../supabase/functions/projexa-document-extract/handler"
import { testBudget } from "./extract-budget-fixtures"
import { projectSourceLedgerKey, type EdgeAttribution, type EdgeCaller, type LedgerClaim, type ProjectSourceLedger } from "../document-extraction-service"

export const SHARED_SECRET = "test-shared-secret-0123456789abcdef0123"

export const TRADES = [
  "Preliminaries", "Earthworks", "Concrete", "Masonry", "Plaster", "Flooring", "Ceiling", "Painting", "Joinery", "Doors", "Windows",
  "Waterproofing", "Plumbing", "Drainage", "Electrical", "Lighting", "HVAC", "Fire Fighting", "External Works", "Landscaping",
  "Furniture", "Provisional Sums",
] as const

/** Lines the fixture holds per trade sheet: two roots and one weighted sub-task. */
export const LINES_PER_SHEET = 3
export const HIDDEN_TRADE = "Ceiling"

/**
 * The 22 trade sheets plus one empty sheet at the end (23 sheets in the file, 22 with content). SheetJS stores the parts of the file
 * uncompressed unless asked; Excel deflates them, so `compressed` builds the same workbook the way a real file is written.
 */
export function buildFixtureWorkbook(options: { compressed?: boolean } = {}): Buffer {
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
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx", compression: options.compressed === true }) as Buffer
}

/**
 * A workbook of the given sheets (name and rows), for the cases that need something other than the trade fixture. `declaredRange`
 * replaces a sheet's range (the dimension the file states) without adding cells, which is how a small file declares a huge sheet.
 * `origin` puts the first row at a cell other than A1 (a sheet whose data starts below the top of the grid).
 */
export function buildWorkbook(
  sheets: Array<{ name: string; rows: unknown[][]; declaredRange?: string; origin?: string }>,
  options: { compressed?: boolean } = {},
): Buffer {
  const wb = XLSX.utils.book_new()
  for (const s of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(s.rows, (s.origin ? { origin: s.origin } : undefined) as unknown as XLSX.AOA2SheetOpts | undefined)
    if (s.declaredRange) ws["!ref"] = s.declaredRange
    XLSX.utils.book_append_sheet(wb, ws, s.name)
  }
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx", compression: options.compressed === true }) as Buffer
}

/**
 * A zip archive written by hand, for the archives a workbook writer never produces. Each entry states its own compression method
 * (0 stored, 8 deflate, anything else as given) and the uncompressed size the archive DECLARES, which may be a lie: the parser and
 * the size check must not trust it. `sharesDataOf` makes an entry's central-directory record point at the local header of an earlier
 * entry (overlapping entries). Checksums are left zero: these archives are for refusals, not for reading.
 */
export function craftZip(
  entries: Array<{ name: string; data: Buffer; method?: number; declaredSize?: number; sharesDataOf?: number; dataDescriptor?: boolean }>,
): Buffer {
  const chunks: Buffer[] = []
  const localAt: number[] = []
  const bodies = entries.map((e) => ((e.method ?? 8) === 8 ? deflateRawSync(e.data) : e.data))
  let offset = 0
  const push = (b: Buffer) => {
    chunks.push(b)
    offset += b.length
  }
  for (const [i, e] of entries.entries()) {
    const method = e.method ?? 8
    const body = bodies[i]
    const name = Buffer.from(e.name)
    const head = Buffer.alloc(30)
    head.writeUInt32LE(0x04034b50, 0)
    head.writeUInt16LE(20, 4)
    head.writeUInt16LE(e.dataDescriptor ? 8 : 0, 6)
    head.writeUInt16LE(method, 8)
    // With a data descriptor the local header carries zero sizes and the sizes follow the data (what .NET zip writers produce).
    if (!e.dataDescriptor) {
      head.writeUInt32LE(body.length, 18)
      head.writeUInt32LE(e.declaredSize ?? e.data.length, 22)
    }
    head.writeUInt16LE(name.length, 26)
    localAt.push(offset)
    push(head)
    push(name)
    push(body)
    if (e.dataDescriptor) {
      const descriptor = Buffer.alloc(16)
      descriptor.writeUInt32LE(0x08074b50, 0)
      descriptor.writeUInt32LE(body.length, 8)
      descriptor.writeUInt32LE(e.declaredSize ?? e.data.length, 12)
      push(descriptor)
    }
  }
  const centralAt = offset
  entries.forEach((e, i) => {
    const method = e.method ?? 8
    const body = bodies[i]
    const name = Buffer.from(e.name)
    const rec = Buffer.alloc(46)
    rec.writeUInt32LE(0x02014b50, 0)
    rec.writeUInt16LE(20, 4)
    rec.writeUInt16LE(20, 6)
    rec.writeUInt16LE(e.dataDescriptor ? 8 : 0, 8)
    rec.writeUInt16LE(method, 10)
    rec.writeUInt32LE(body.length, 20)
    rec.writeUInt32LE(e.declaredSize ?? e.data.length, 24)
    rec.writeUInt16LE(name.length, 28)
    rec.writeUInt32LE(localAt[e.sharesDataOf ?? i], 42)
    push(rec)
    push(name)
  })
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(offset - centralAt, 12)
  end.writeUInt32LE(centralAt, 16)
  push(end)
  return Buffer.concat(chunks)
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

/**
 * The same workbook written the way .NET zip writers write it: every part deflated, its sizes in a data descriptor after the data
 * and zero in the local header. Built by reading the parts of a workbook SheetJS wrote and writing them again with craftZip().
 */
export function repackWithDataDescriptors(workbook: Buffer): Buffer {
  const cfb = XLSX.CFB.read(workbook, { type: "buffer" })
  const parts: Array<{ name: string; data: Buffer; dataDescriptor: boolean }> = []
  cfb.FullPaths.forEach((fullPath, i) => {
    const file = cfb.FileIndex[i]
    // SheetJS lists a root entry and one marker entry that are not parts of the archive.
    if (file.type !== 2 || !fullPath.startsWith("Root Entry/") || fullPath.startsWith("Root Entry/\u0001")) return
    parts.push({ name: fullPath.slice("Root Entry/".length), data: Buffer.from(file.content as Uint8Array), dataDescriptor: true })
  })
  return craftZip(parts)
}

/** Deps for the real handler: the shared secret as the credential, the given model (or none), a budget on an in-memory ledger with a very high cap (U-36b), no log output. */
export function edgeDeps(model: ModelCall | null, extra: Partial<ExtractDeps> = {}): ExtractDeps {
  return { verifyCaller: async (req) => bearerMatches(req.headers.get("authorization"), SHARED_SECRET), model, budget: testBudget(), log: () => {}, ...extra }
}

/** An EdgeCaller that posts to the real handler in process. `calls` counts requests and keeps the last body sent. */
export function edgeCallerFor(
  deps: ExtractDeps,
  bearer: string = SHARED_SECRET,
): EdgeCaller & { calls: { count: number; lastBody: string | null; attributions: Array<EdgeAttribution | undefined> } } {
  const calls = { count: 0, lastBody: null as string | null, attributions: [] as Array<EdgeAttribution | undefined> }
  const caller = async (bodyJson: string, attribution?: EdgeAttribution) => {
    calls.count++
    calls.lastBody = bodyJson
    calls.attributions.push(attribution)
    const res = await handleProjexaDocumentExtract(
      new Request("https://edge.test/functions/v1/projexa-document-extract", {
        method: "POST",
        headers: {
          authorization: `Bearer ${bearer}`,
          "content-type": "application/json",
          ...(attribution
            ? {
                "x-projexa-org-id": attribution.orgId,
                "x-projexa-user-id": attribution.userId,
                ...(attribution.requestId ? { "x-projexa-request-id": attribution.requestId } : {}),
              }
            : {}),
        },
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
  const rows = new Map<string, { claimId: string; projectId: string | null; parked: { state: "needs_answers" | "ready"; result: unknown } | null }>()
  // `events` is the sequence of claim, attach and release calls that earlier tests assert exactly; setState() is recorded apart, in
  // `states`, so a new state label never changes those sequences.
  const events: string[] = []
  const states: Array<{ claimId: string; state: string; result?: unknown }> = []
  /** What each release() was told: whether the attempt reached a model (the real ledger does not count one that did not), and why it was refused. */
  const releases: Array<{ claimId: string; modelCalled: boolean; rejection?: { code: string; message: string; issues?: string[] } }> = []
  let n = 0
  const ledger: ProjectSourceLedger = {
    async claim({ contentSha256 }): Promise<LedgerClaim> {
      events.push("claim")
      const held = rows.get(projectSourceLedgerKey(contentSha256))
      if (held) {
        if (held.projectId) return { kind: "duplicate", projectId: held.projectId }
        if (held.parked) return { kind: "resume", claimId: held.claimId, state: held.parked.state, result: held.parked.result }
        return { kind: "in_progress" }
      }
      const claimId = `claim-${++n}`
      rows.set(projectSourceLedgerKey(contentSha256), { claimId, projectId: null, parked: null })
      return { kind: "claimed", claimId }
    },
    async attach(claimId, projectId) {
      events.push("attach")
      for (const r of rows.values()) if (r.claimId === claimId) r.projectId = projectId
    },
    async release(claimId, options) {
      events.push("release")
      releases.push({ claimId, modelCalled: options?.modelCalled !== false, ...(options?.rejection ? { rejection: options.rejection } : {}) })
      for (const [k, r] of rows) if (r.claimId === claimId && !r.projectId) rows.delete(k)
    },
    async setState(claimId, state, result) {
      states.push({ claimId, state, ...(result !== undefined ? { result } : {}) })
      for (const r of rows.values()) {
        if (r.claimId !== claimId) continue
        r.parked = state === "needs_answers" || state === "ready" ? { state, result } : null
      }
    },
    async takeParked(claimId) {
      for (const r of rows.values()) {
        if (r.claimId !== claimId || !r.parked || r.projectId) continue
        r.parked = null
        states.push({ claimId, state: "reading" })
        return true
      }
      return false
    },
  }
  return { ledger, rows, events, releases, states }
}
