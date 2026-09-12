/// <reference types="bun-types" />
// R85 Addendum 3 v4 FINAL, Phase 7 (D89, gates 7-01..7-12, GATE C7). Real,
// committed, re-runnable proofs -- matching this codebase's bar
// (R74-RULING-03). 7-11 and 7-12 are MANDATORY and each carries its own real
// RED-then-GREEN falsifiability proof, performed by hand and pasted verbatim
// in this phase's PR description/commit message, not just asserted here.
//
// DB-backed suites mock ONLY @/lib/db/tenant-scoped (withTenantContext) and
// ./boq-baseline-service (listBaselineVersionsWithDb) -- the same
// "don't touch a live DB from a .test.ts file" convention every sibling in
// this directory already uses (see boq-baseline-service.test.ts,
// construction-boq-service.dual-view-wiring.test.ts). Export/parse tests use
// the REAL xlsx library end to end (real bytes in, real bytes out) --
// nothing about SheetJS itself is mocked, because 7-11/7-12 exist
// specifically to prove the REAL produced file round-trips and is
// structurally safe.
import { afterEach, describe, expect, mock, test } from "bun:test"
import * as XLSX from "xlsx"
import * as realTenantScoped from "@/lib/db/tenant-scoped"
import * as realBoqBaselineService from "./boq-baseline-service"
import * as realConstructionBoqService from "./construction-boq-service"

afterEach(async () => {
  mock.restore()
  await mock.module("@/lib/db/tenant-scoped", () => realTenantScoped)
  await mock.module("./boq-baseline-service", () => realBoqBaselineService)
  await mock.module("./construction-boq-service", () => realConstructionBoqService)
})

// ─────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────
const ORG_ID = "org-1"
const BOQ_ID = "boq-1"

type FakeLineRow = {
  id: string
  boqId: string
  orgId: string
  itemCode: string | null
  description: string
  unit: string
  qtyProject: string | null
  rateProject: string | null
  qtyContract: string | null
  rateContract: string | null
  parentLineItemId: string | null
}

const LINE_A: FakeLineRow = {
  id: "line-a", boqId: BOQ_ID, orgId: ORG_ID, itemCode: "C-01", description: "Excavation", unit: "m3",
  qtyProject: "100", rateProject: "40", qtyContract: "100", rateContract: "50", parentLineItemId: null,
}
const LINE_B: FakeLineRow = {
  id: "line-b", boqId: BOQ_ID, orgId: ORG_ID, itemCode: "C-02", description: "Backfill", unit: "m3",
  qtyProject: null, rateProject: null, qtyContract: "50", rateContract: "20", parentLineItemId: null,
}

function mountFakeDb(opts: {
  lines?: FakeLineRow[]
  boq?: { id: string; orgId: string; projectId?: string } | null
  updateCalls?: Array<{ id: string; set: Record<string, unknown> }>
}) {
  const lines = opts.lines ?? [LINE_A, LINE_B]
  const boq = opts.boq !== undefined ? opts.boq : { id: BOQ_ID, orgId: ORG_ID, projectId: "proj-1" }
  const updateCalls = opts.updateCalls ?? []
  const fakeDb = {
    query: {
      constructionBoqs: { findFirst: mock(async () => boq) },
      constructionBoqLineItems: { findMany: mock(async () => lines) },
    },
    update: mock((_table: unknown) => ({
      set: (set: Record<string, unknown>) => ({
        where: async () => {
          updateCalls.push({ id: "unknown", set })
          return []
        },
      }),
    })),
  }
  return { fakeDb, updateCalls }
}

async function mountAndImportRoundtripService(opts: {
  lines?: FakeLineRow[]
  boq?: { id: string; orgId: string; projectId?: string } | null
  baselineVersions?: number[]
  updateCalls?: Array<{ id: string; set: Record<string, unknown> }>
}) {
  const { fakeDb, updateCalls } = mountFakeDb(opts)
  // `.update(table).set(x).where(y)` needs to capture WHICH row id it targeted --
  // rebuild the update mock so `where` receives the drizzle `eq(...)` condition
  // object and we can read the id back out of it for assertions.
  const capturedUpdates: Array<{ set: Record<string, unknown>; whereArg: unknown }> = []
  fakeDb.update = mock((_table: unknown) => ({
    set: (set: Record<string, unknown>) => ({
      where: async (whereArg: unknown) => {
        capturedUpdates.push({ set, whereArg })
        return []
      },
    }),
  })) as unknown as typeof fakeDb.update

  await mock.module("@/lib/db/tenant-scoped", () => ({
    ...realTenantScoped,
    withTenantContext: mock(async (_ctx: { orgId: string }, fn: (db: unknown) => Promise<unknown>) => fn(fakeDb)),
  }))
  await mock.module("./boq-baseline-service", () => ({
    listBaselineVersionsWithDb: mock(async () => (opts.baselineVersions ?? []).map((v) => ({ version: v }))),
  }))
  const svc = await import("./boq-excel-roundtrip-service")
  return { svc, fakeDb, updateCalls, capturedUpdates }
}

const READ_CTX = { orgId: ORG_ID }
const WRITE_CTX = { orgId: ORG_ID, userId: "user-1" }

// ─────────────────────────────────────────────────────────────────────────
// parseUploadedBoq -- 7-10: a malformed file changes nothing
// ─────────────────────────────────────────────────────────────────────────
describe("parseUploadedBoq -- 7-10 malformed file detection", () => {
  test("garbage bytes (not a real .xlsx) -> fileErrors, no rows read", async () => {
    const { parseUploadedBoq } = await import("./boq-excel-roundtrip-service")
    const result = parseUploadedBoq(Buffer.from("this is not a spreadsheet at all, just plain text"))
    expect(result.fileErrors.length).toBeGreaterThan(0)
    expect(result.rows.length).toBe(0)
    expect(result.contentHash).toBe("")
  })

  test("a real .xlsx missing the required Line ID column -> fileErrors, nothing parsed", async () => {
    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.aoa_to_sheet([["Item Code", "Description", "Unit"], ["C-01", "Excavation", "m3"]])
    XLSX.utils.book_append_sheet(wb, ws, "Sheet1")
    const buf = XLSX.write(wb, { bookType: "xlsx", type: "buffer" }) as Buffer

    const { parseUploadedBoq } = await import("./boq-excel-roundtrip-service")
    const result = parseUploadedBoq(buf)
    expect(result.fileErrors.length).toBeGreaterThan(0)
    expect(result.fileErrors[0]).toContain("Line ID")
    expect(result.rows.length).toBe(0)
  })

  test("a well-formed file parses rows, computes a real content hash, and is deterministic (RE-parsing the SAME bytes yields the SAME hash)", async () => {
    const { parseUploadedBoq, exportInternalBoq } = await import("./boq-excel-roundtrip-service")
    await mock.module("./construction-boq-service", () => ({
      getBoq: mock(async () => ({ id: BOQ_ID, lineItems: [{ ...LINE_A, ...moneyView(LINE_A) }] })),
    }))
    await mock.module("./cost-visibility-service", () => ({
      applyCostVisibility: mock(async (_ctx: unknown, _role: unknown, data: unknown) => data),
    }))
    const buf = await exportInternalBoq(READ_CTX, BOQ_ID, "admin")
    const first = parseUploadedBoq(buf)
    const second = parseUploadedBoq(buf)
    expect(first.contentHash).toBe(second.contentHash)
    expect(first.contentHash.length).toBe(64) // sha256 hex
    expect(first.rows.length).toBe(1)
    expect(first.rows[0]!.lineId).toBe("line-a")
  })

  test("a non-numeric Qty cell is flagged per-row (malformedFields), but the FILE itself is not rejected -- other rows still parse", async () => {
    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.aoa_to_sheet([
      ["Line ID", "Item Code", "Description", "Unit", "Qty (Contract)", "Rate (Contract)"],
      ["line-a", "C-01", "Excavation", "m3", "not-a-number", "50"],
      ["line-b", "C-02", "Backfill", "m3", "50", "20"],
    ])
    XLSX.utils.book_append_sheet(wb, ws, "Sheet1")
    const buf = XLSX.write(wb, { bookType: "xlsx", type: "buffer" }) as Buffer

    const { parseUploadedBoq } = await import("./boq-excel-roundtrip-service")
    const result = parseUploadedBoq(buf)
    expect(result.fileErrors.length).toBe(0)
    expect(result.rows.length).toBe(2)
    expect(result.rows[0]!.malformedFields).toContain("Qty (Contract)")
    expect(result.rows[1]!.malformedFields.length).toBe(0)
  })

  test("a currency-suffixed header (Rate (Contract) [INR]) still matches this file's own re-download", async () => {
    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.aoa_to_sheet([
      ["Line ID", "Item Code", "Description", "Unit", "Qty (Contract)", "Rate (Contract) [INR]"],
      ["line-a", "C-01", "Excavation", "m3", "100", "55"],
    ])
    XLSX.utils.book_append_sheet(wb, ws, "Sheet1")
    const buf = XLSX.write(wb, { bookType: "xlsx", type: "buffer" }) as Buffer
    const { parseUploadedBoq } = await import("./boq-excel-roundtrip-service")
    const result = parseUploadedBoq(buf)
    expect(result.fileErrors.length).toBe(0)
    expect(result.rows[0]!.rateContract).toBe(55)
  })
})

function moneyView(line: FakeLineRow) {
  const qp = line.qtyProject === null ? null : Number(line.qtyProject)
  const rp = line.rateProject === null ? null : Number(line.rateProject)
  const qc = line.qtyContract === null ? null : Number(line.qtyContract)
  const rc = line.rateContract === null ? null : Number(line.rateContract)
  const projectValue = qp === null || rp === null ? "NOT_SET" : qp * rp
  const contractValue = qc === null || rc === null ? "NOT_SET" : qc * rc
  return { projectValue, contractValue, variance: "NOT_SET", variancePercent: "NOT_SET", quantityVariance: "NOT_SET", rateVariance: "NOT_SET" }
}

// ─────────────────────────────────────────────────────────────────────────
// diffOneRow -- pure classification unit tests, no DB/mocking needed
// ─────────────────────────────────────────────────────────────────────────
describe("diffOneRow -- pure classification (7-05 four-way split)", () => {
  test("unmatched Line ID -> rejected, never matched by position (X-19)", async () => {
    const { diffOneRow } = await import("./boq-excel-roundtrip-service")
    const row = { sheetRow: 2, lineId: "does-not-exist", malformedFields: [], derivedColumnsWithValues: 0 }
    const result = diffOneRow(row, undefined, { hasConfirmedBaseline: false, evidenceProvided: false })
    expect(result.rejectedReason).toContain("does not match any line item")
    expect(result.changes.length).toBe(0)
  })

  test("no Line ID at all -> rejected (new lines cannot be added via upload)", async () => {
    const { diffOneRow } = await import("./boq-excel-roundtrip-service")
    const row = { sheetRow: 3, lineId: null, malformedFields: [], derivedColumnsWithValues: 0 }
    const result = diffOneRow(row, LINE_A, { hasConfirmedBaseline: false, evidenceProvided: false })
    expect(result.rejectedReason).toContain("no Line ID")
  })

  test("a malformed cell -> rejected with the field named", async () => {
    const { diffOneRow } = await import("./boq-excel-roundtrip-service")
    const row = { sheetRow: 4, lineId: "line-a", malformedFields: ["Qty (Contract)"], derivedColumnsWithValues: 0 }
    const result = diffOneRow(row, LINE_A, { hasConfirmedBaseline: false, evidenceProvided: false })
    expect(result.rejectedReason).toContain("Qty (Contract)")
  })

  test("structural change (description) detected as columnClass structural", async () => {
    const { diffOneRow } = await import("./boq-excel-roundtrip-service")
    const row = { sheetRow: 2, lineId: "line-a", description: "Excavation (revised)", malformedFields: [], derivedColumnsWithValues: 0 }
    const result = diffOneRow(row, LINE_A, { hasConfirmedBaseline: false, evidenceProvided: false })
    expect(result.changes).toEqual([
      { lineItemId: "line-a", sheetRow: 2, field: "description", columnClass: "structural", before: "Excavation", after: "Excavation (revised)" },
    ])
  })

  test("COST change (rateProject) accepted with NO evidence gate, even when a baseline is confirmed (7-05)", async () => {
    const { diffOneRow } = await import("./boq-excel-roundtrip-service")
    const row = { sheetRow: 2, lineId: "line-a", rateProject: 45, malformedFields: [], derivedColumnsWithValues: 0 }
    const result = diffOneRow(row, LINE_A, { hasConfirmedBaseline: true, evidenceProvided: false })
    expect(result.changes).toEqual([{ lineItemId: "line-a", sheetRow: 2, field: "rateProject", columnClass: "cost", before: 40, after: 45 }])
    expect(result.pending.length).toBe(0)
  })

  test("CONTRACT change before any confirmed baseline -> accepted into `changes`", async () => {
    const { diffOneRow } = await import("./boq-excel-roundtrip-service")
    const row = { sheetRow: 2, lineId: "line-a", rateContract: 55, malformedFields: [], derivedColumnsWithValues: 0 }
    const result = diffOneRow(row, LINE_A, { hasConfirmedBaseline: false, evidenceProvided: false })
    expect(result.changes).toEqual([{ lineItemId: "line-a", sheetRow: 2, field: "rateContract", columnClass: "contract", before: 50, after: 55 }])
    expect(result.pending.length).toBe(0)
  })

  test("CONTRACT change AFTER a confirmed baseline, NO evidence -> FLAGGED into `pending`, excluded from `changes` (never silently dropped)", async () => {
    const { diffOneRow } = await import("./boq-excel-roundtrip-service")
    const row = { sheetRow: 2, lineId: "line-a", rateContract: 55, malformedFields: [], derivedColumnsWithValues: 0 }
    const result = diffOneRow(row, LINE_A, { hasConfirmedBaseline: true, evidenceProvided: false })
    expect(result.changes.length).toBe(0)
    expect(result.pending).toEqual([{ lineItemId: "line-a", sheetRow: 2, field: "rateContract", columnClass: "contract", before: 50, after: 55 }])
  })

  test("CONTRACT change AFTER a confirmed baseline, WITH evidence -> accepted into `changes`", async () => {
    const { diffOneRow } = await import("./boq-excel-roundtrip-service")
    const row = { sheetRow: 2, lineId: "line-a", rateContract: 55, malformedFields: [], derivedColumnsWithValues: 0 }
    const result = diffOneRow(row, LINE_A, { hasConfirmedBaseline: true, evidenceProvided: true })
    expect(result.changes.length).toBe(1)
    expect(result.pending.length).toBe(0)
  })

  test("X-04: clearing a cost cell (blank -> null) is a real detected change, never confused with 'no change'", async () => {
    const { diffOneRow } = await import("./boq-excel-roundtrip-service")
    const row = { sheetRow: 2, lineId: "line-a", rateProject: null, malformedFields: [], derivedColumnsWithValues: 0 }
    const result = diffOneRow(row, LINE_A, { hasConfirmedBaseline: false, evidenceProvided: false })
    expect(result.changes).toEqual([{ lineItemId: "line-a", sheetRow: 2, field: "rateProject", columnClass: "cost", before: 40, after: null }])
  })

  test("column absent from the file (undefined) is NOT a change -- only a present-but-blank cell means 'clear'", async () => {
    const { diffOneRow } = await import("./boq-excel-roundtrip-service")
    const row = { sheetRow: 2, lineId: "line-a", malformedFields: [], derivedColumnsWithValues: 0 } // no qtyProject/rateProject/etc keys at all
    const result = diffOneRow(row, LINE_A, { hasConfirmedBaseline: false, evidenceProvided: false })
    expect(result.changes.length).toBe(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────
// diffUpload -- DB-backed (7-06/7-07: computed and returned, nothing written)
// ─────────────────────────────────────────────────────────────────────────
describe("diffUpload -- integration over a fake tenant-scoped db", () => {
  test("computedIgnored counts DERIVED-column edits without ever applying them (7-05: 'the system SAYS SO')", async () => {
    const { svc } = await mountAndImportRoundtripService({})
    const rows = [{ sheetRow: 2, lineId: "line-a", derivedColumnsWithValues: 3, malformedFields: [] }]
    const diff = await svc.diffUpload(READ_CTX, BOQ_ID, rows, { contentHash: "abc" })
    expect(diff.countsByColumnClass.computedIgnored).toBe(3)
    expect(diff.changes.length).toBe(0)
  })

  test("linesNotInUpload reports lines the file never mentioned, without deleting them", async () => {
    const { svc } = await mountAndImportRoundtripService({})
    const rows = [{ sheetRow: 2, lineId: "line-a", malformedFields: [], derivedColumnsWithValues: 0 }] // line-b never mentioned
    const diff = await svc.diffUpload(READ_CTX, BOQ_ID, rows, { contentHash: "abc" })
    expect(diff.linesNotInUpload).toEqual(["line-b"])
  })

  test("evidenceRequired/evidenceSatisfied: false/true when there is no confirmed baseline at all", async () => {
    const { svc } = await mountAndImportRoundtripService({ baselineVersions: [] })
    const rows = [{ sheetRow: 2, lineId: "line-a", rateContract: 99, malformedFields: [], derivedColumnsWithValues: 0 }]
    const diff = await svc.diffUpload(READ_CTX, BOQ_ID, rows, { contentHash: "abc" })
    expect(diff.evidenceRequired).toBe(false)
    expect(diff.evidenceSatisfied).toBe(true)
    expect(diff.changes.length).toBe(1)
  })

  test("evidenceRequired true, evidenceSatisfied false when a baseline is confirmed and no evidenceArtefactRef given -- the contract change is pending, not applied", async () => {
    const { svc } = await mountAndImportRoundtripService({ baselineVersions: [1] })
    const rows = [{ sheetRow: 2, lineId: "line-a", rateContract: 99, malformedFields: [], derivedColumnsWithValues: 0 }]
    const diff = await svc.diffUpload(READ_CTX, BOQ_ID, rows, { contentHash: "abc" })
    expect(diff.evidenceRequired).toBe(true)
    expect(diff.evidenceSatisfied).toBe(false)
    expect(diff.changes.length).toBe(0)
    expect(diff.contractChangesPendingEvidence.length).toBe(1)
  })

  test("confirmedDiffToken is deterministic for the same input, and changes when the evidence decision changes", async () => {
    const { svc } = await mountAndImportRoundtripService({ baselineVersions: [1] })
    const rows = [{ sheetRow: 2, lineId: "line-a", rateContract: 99, malformedFields: [], derivedColumnsWithValues: 0 }]
    const diffA = await svc.diffUpload(READ_CTX, BOQ_ID, rows, { contentHash: "abc" })
    const diffB = await svc.diffUpload(READ_CTX, BOQ_ID, rows, { contentHash: "abc" })
    expect(diffA.confirmedDiffToken).toBe(diffB.confirmedDiffToken)
    const diffC = await svc.diffUpload(READ_CTX, BOQ_ID, rows, { contentHash: "abc", evidenceArtefactRef: "PO-2026-0100" })
    expect(diffC.confirmedDiffToken).not.toBe(diffA.confirmedDiffToken)
  })

  test("BOQ not found -> ServiceError 404", async () => {
    const { svc } = await mountAndImportRoundtripService({ boq: null })
    await expect(svc.diffUpload(READ_CTX, BOQ_ID, [], { contentHash: "abc" })).rejects.toMatchObject({ status: 404 })
  })
})

// ─────────────────────────────────────────────────────────────────────────
// applyUpload -- 7-07 (one transaction or none), 7-06/X-20 (token must match)
// ─────────────────────────────────────────────────────────────────────────
describe("applyUpload -- non-structural path (in-place cell edits)", () => {
  test("a stale confirmedDiffToken is refused (409) and NOTHING is written", async () => {
    const { svc, capturedUpdates } = await mountAndImportRoundtripService({})
    const rows = [{ sheetRow: 2, lineId: "line-a", rateProject: 45, malformedFields: [], derivedColumnsWithValues: 0 }]
    await expect(
      svc.applyUpload(WRITE_CTX, BOQ_ID, rows, { confirmedDiffToken: "not-the-real-token", contentHash: "abc" })
    ).rejects.toMatchObject({ status: 409 })
    expect(capturedUpdates.length).toBe(0)
  })

  test("zero changes -> applied: false, nothing written", async () => {
    const { svc, capturedUpdates } = await mountAndImportRoundtripService({})
    const rows = [{ sheetRow: 2, lineId: "line-a", malformedFields: [], derivedColumnsWithValues: 0 }] // no cell values at all -> no change
    const diff = await svc.diffUpload(READ_CTX, BOQ_ID, rows, { contentHash: "abc" })
    const result = await svc.applyUpload(WRITE_CTX, BOQ_ID, rows, { confirmedDiffToken: diff.confirmedDiffToken, contentHash: "abc" })
    expect(result.applied).toBe(false)
    expect(capturedUpdates.length).toBe(0)
  })

  test("a real cost-cell edit is applied via an in-place UPDATE, matching the diff exactly", async () => {
    const { svc, capturedUpdates } = await mountAndImportRoundtripService({})
    const rows = [{ sheetRow: 2, lineId: "line-a", rateProject: 45, malformedFields: [], derivedColumnsWithValues: 0 }]
    const diff = await svc.diffUpload(READ_CTX, BOQ_ID, rows, { contentHash: "abc" })
    const result = await svc.applyUpload(WRITE_CTX, BOQ_ID, rows, { confirmedDiffToken: diff.confirmedDiffToken, contentHash: "abc" })
    expect(result.applied).toBe(true)
    expect(result.changesApplied).toBe(1)
    expect(result.revisionCreated).toBeNull()
    expect(capturedUpdates.length).toBe(1)
    expect(capturedUpdates[0]!.set).toEqual({ rateProject: "45" })
  })

  test("X-21 falsifiable proof: if ANY targeted row's value changed since the diff was computed, the WHOLE apply refuses and NO row is updated -- not even the other, still-valid one", async () => {
    // line-a's rateProject drifts to 999 AFTER the diff below is computed but
    // BEFORE apply runs (simulating a concurrent edit) -- re-mount with the
    // drifted value for the apply call specifically.
    const rows = [
      { sheetRow: 2, lineId: "line-a", rateProject: 45, malformedFields: [], derivedColumnsWithValues: 0 },
      { sheetRow: 3, lineId: "line-b", rateContract: 25, malformedFields: [], derivedColumnsWithValues: 0 },
    ]
    const { svc: diffSvc } = await mountAndImportRoundtripService({})
    const diff = await diffSvc.diffUpload(READ_CTX, BOQ_ID, rows, { contentHash: "abc" })

    const driftedLineA = { ...LINE_A, rateProject: "999" } // drifted since the diff above was computed
    const { svc: applySvc, capturedUpdates } = await mountAndImportRoundtripService({ lines: [driftedLineA, LINE_B] })
    await expect(
      applySvc.applyUpload(WRITE_CTX, BOQ_ID, rows, { confirmedDiffToken: diff.confirmedDiffToken, contentHash: "abc" })
    ).rejects.toMatchObject({ status: 409 })
    expect(capturedUpdates.length).toBe(0) // line-b's own, still-valid change was NEVER written either
  })
})

describe("applyUpload -- structural path routes through createBoqRevision, not an in-place edit", () => {
  test("a structural (description) change calls createBoqRevision with the full carried-forward line set, cost/contract fields included", async () => {
    const revisionCalls: unknown[] = []
    await mock.module("./construction-boq-service", () => ({
      getBoq: mock(async () => ({
        id: BOQ_ID,
        lineItems: [
          { ...LINE_A, ...moneyView(LINE_A) },
          { ...LINE_B, ...moneyView(LINE_B) },
        ],
      })),
      createBoqRevision: mock(async (_ctx: unknown, _boqId: string, input: unknown) => {
        revisionCalls.push(input)
        return { id: "boq-2", version: 2, lineItems: [] }
      }),
      toLineItemInput: mock((row: FakeLineRow) => ({
        itemCode: row.itemCode ?? undefined,
        description: row.description,
        unit: row.unit,
        quantity: 1,
        rate: 1,
        qtyProject: row.qtyProject != null ? Number(row.qtyProject) : undefined,
        rateProject: row.rateProject != null ? Number(row.rateProject) : undefined,
        qtyContract: row.qtyContract != null ? Number(row.qtyContract) : undefined,
        rateContract: row.rateContract != null ? Number(row.rateContract) : undefined,
      })),
    }))

    const { svc } = await mountAndImportRoundtripService({})
    const rows = [{ sheetRow: 2, lineId: "line-a", description: "Excavation (revised)", malformedFields: [], derivedColumnsWithValues: 0 }]
    const diff = await svc.diffUpload(READ_CTX, BOQ_ID, rows, { contentHash: "abc" })
    expect(diff.hasStructuralChanges).toBe(true)

    const result = await svc.applyUpload(WRITE_CTX, BOQ_ID, rows, { confirmedDiffToken: diff.confirmedDiffToken, contentHash: "abc" })
    expect(result.applied).toBe(true)
    expect(result.revisionCreated).toEqual({ id: "boq-2", version: 2 })
    expect(revisionCalls.length).toBe(1)
    const input = revisionCalls[0] as { lineItems: Array<{ description: string; qtyProject?: number; rateProject?: number }> }
    // line-a carries the OVERLAID description AND its ORIGINAL cost figures
    // forward (the real bug this phase fixed in toLineItemInput -- see
    // construction-boq-service.dual-view-write.test.ts for the dedicated
    // regression proof).
    const revisedA = input.lineItems.find((l) => l.description === "Excavation (revised)")
    expect(revisedA?.qtyProject).toBe(100)
    expect(revisedA?.rateProject).toBe(40)
    // line-b, untouched by this upload, is STILL present in the full set
    // (createBoqRevision replaces ALL lines -- it must not be dropped).
    expect(input.lineItems.length).toBe(2)
  })
})

// ─────────────────────────────────────────────────────────────────────────
// redactUploadDiffForCostVisibility
// ─────────────────────────────────────────────────────────────────────────
describe("redactUploadDiffForCostVisibility", () => {
  test("strips cost-class changes for a cost-blind caller, keeps contract-class changes", async () => {
    const { redactUploadDiffForCostVisibility } = await import("./boq-excel-roundtrip-service")
    const diff = {
      changes: [
        { lineItemId: "l1", sheetRow: 2, field: "rateProject" as const, columnClass: "cost" as const, before: 1, after: 2 },
        { lineItemId: "l1", sheetRow: 2, field: "rateContract" as const, columnClass: "contract" as const, before: 3, after: 4 },
      ],
    }
    const redacted = redactUploadDiffForCostVisibility(diff, false)
    expect(redacted.changes.length).toBe(1)
    expect(redacted.changes[0]!.columnClass).toBe("contract")

    const unredacted = redactUploadDiffForCostVisibility(diff, true)
    expect(unredacted.changes.length).toBe(2)
  })
})

// ─────────────────────────────────────────────────────────────────────────
// applyFrozenHeaderRow -- 7-04, fails safe by design
// ─────────────────────────────────────────────────────────────────────────
describe("applyFrozenHeaderRow", () => {
  test("patches a real SheetJS-produced workbook with a real freeze-pane element that survives a re-parse", async () => {
    const { applyFrozenHeaderRow } = await import("./boq-excel-roundtrip-service")
    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.aoa_to_sheet([["a", "b"], [1, 2], [3, 4]])
    XLSX.utils.book_append_sheet(wb, ws, "Sheet1")
    const buf = XLSX.write(wb, { bookType: "xlsx", type: "buffer" }) as Buffer

    const patched = applyFrozenHeaderRow(buf)
    expect(patched.length).toBeGreaterThan(buf.length) // the pane XML was really added

    // Re-parse with the REAL xlsx library -- proves the patched zip is still valid
    const reparsed = XLSX.read(patched, { type: "buffer" })
    const reparsedWs = reparsed.Sheets[reparsed.SheetNames[0]!]!
    expect(XLSX.utils.sheet_to_json(reparsedWs, { header: 1 })).toEqual([["a", "b"], [1, 2], [3, 4]])
  })

  test("fails safe on a buffer that is not a zip at all -- returns the input unchanged, never throws", async () => {
    const { applyFrozenHeaderRow } = await import("./boq-excel-roundtrip-service")
    const garbage = Buffer.from("not a zip file")
    expect(applyFrozenHeaderRow(garbage)).toBe(garbage)
  })
})

// ─────────────────────────────────────────────────────────────────────────
// 7-11 [MANDATORY]: ROUND-TRIP PROOF -- download, upload UNMODIFIED, assert
// ZERO changes.
// ─────────────────────────────────────────────────────────────────────────
describe("7-11 [MANDATORY] round-trip: download then re-upload UNMODIFIED -> ZERO changes", () => {
  test("the INTERNAL export, uploaded back unmodified, produces zero changes and zero rejected rows", async () => {
    await mock.module("./construction-boq-service", () => ({
      getBoq: mock(async () => ({ id: BOQ_ID, lineItems: [{ ...LINE_A, ...moneyView(LINE_A) }, { ...LINE_B, ...moneyView(LINE_B) }] })),
    }))
    await mock.module("./cost-visibility-service", () => ({
      applyCostVisibility: mock(async (_ctx: unknown, _role: unknown, data: unknown) => data),
    }))
    const { exportInternalBoq, parseUploadedBoq } = await import("./boq-excel-roundtrip-service")
    const buffer = await exportInternalBoq(READ_CTX, BOQ_ID, "admin")
    const parsed = parseUploadedBoq(buffer)
    expect(parsed.fileErrors).toEqual([])

    const { svc } = await mountAndImportRoundtripService({})
    const diff = await svc.diffUpload(READ_CTX, BOQ_ID, parsed.rows, { contentHash: parsed.contentHash })
    expect(diff.changes).toEqual([])
    expect(diff.rejectedRows).toEqual([])
    expect(diff.linesNotInUpload).toEqual([])
  })

  test("the CUSTOMER export, uploaded back unmodified, produces zero changes and zero rejected rows", async () => {
    await mock.module("./construction-boq-service", () => ({
      getBoq: mock(async () => ({ id: BOQ_ID, lineItems: [{ ...LINE_A, ...moneyView(LINE_A) }, { ...LINE_B, ...moneyView(LINE_B) }] })),
    }))
    const { exportCustomerBoq, parseUploadedBoq } = await import("./boq-excel-roundtrip-service")
    const buffer = await exportCustomerBoq(READ_CTX, BOQ_ID)
    const parsed = parseUploadedBoq(buffer)
    expect(parsed.fileErrors).toEqual([])

    const { svc } = await mountAndImportRoundtripService({})
    const diff = await svc.diffUpload(READ_CTX, BOQ_ID, parsed.rows, { contentHash: parsed.contentHash })
    expect(diff.changes).toEqual([])
    expect(diff.rejectedRows).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────────────────
// 7-12 [MANDATORY]: TWO EXPORT TEMPLATES -- the customer one must be
// INCAPABLE of emitting any cost-detail figure. PASS = open the PRODUCED
// file's real bytes with the xlsx library and confirm the forbidden columns
// are absent -- reading the code is not the proof, reading the file is.
// ─────────────────────────────────────────────────────────────────────────
describe("7-12 [MANDATORY] the customer template cannot emit qty_project/rate_project/project_value/variance/either decomposition term", () => {
  test("open the produced CUSTOMER .xlsx's real header row -- none of the forbidden columns are present", async () => {
    await mock.module("./construction-boq-service", () => ({
      getBoq: mock(async () => ({ id: BOQ_ID, lineItems: [{ ...LINE_A, ...moneyView(LINE_A) }] })),
    }))
    const { exportCustomerBoq } = await import("./boq-excel-roundtrip-service")
    const buffer = await exportCustomerBoq(READ_CTX, BOQ_ID)

    // Parse the REAL produced bytes with the REAL xlsx library -- this is
    // the actual proof; nothing about this test reads boq-excel-roundtrip-
    // service.ts's source to decide the answer.
    const wb = XLSX.read(buffer, { type: "buffer" })
    const ws = wb.Sheets[wb.SheetNames[0]!]!
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1 }) as unknown[][]
    const headerRow = (rows[0] ?? []).map((h) => String(h))
    const headerText = headerRow.join(" | ")

    const forbidden = [
      "Qty (Project)",
      "Rate (Project)",
      "DERIVED: Project Value",
      "DERIVED: Contract Value",
      "DERIVED: Variance",
      "DERIVED: Variance %",
      "DERIVED: Quantity Variance",
      "DERIVED: Rate Variance",
    ]
    for (const label of forbidden) {
      expect(headerText).not.toContain(label)
    }
    // And the sheet has SOME real content -- proves this isn't passing by
    // accident because the file is empty.
    expect(headerRow).toContain("Qty (Contract)")
    expect(rows.length).toBeGreaterThan(1)
  })
})
