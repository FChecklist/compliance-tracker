/// <reference types="bun-types" />
// PROJEXA-BUILD-002 WP-13 (register row AW-605): the scan_connected_folder job (scan-connected-folder-job.ts, scheduled-jobs.ts) with
// its dependencies replaced by a fake folder and in-memory stores. What is proven:
//   1. the schedule's params: only the known keys, a source of mailbox or drive, a product, a Drive folder for drive, a label and a
//      sender list for a mailbox only, a small file limit; anything else names its reason and reads nothing;
//   2. who may run it: the owner's role read by the bridge must be member or above; the product must exist in the organisation; a
//      person who has not connected the toolkit gets a failure code and reason, not a crash;
//   3. a good run answers with numbers only (and a stop word when it stopped early), passes the sender list and the file limit to the
//      scan, and runs as the OWNER (the ledger, cursor and proposal stores are opened for the owner's id);
//   4. a source that cannot be listed is BACKEND_UNAVAILABLE with the source's own stable word, never its message;
//   5. the job is in no registry: no chat sentence, link or API key can name it (isScheduledJob is the only door).
//
// Run: bun test --isolate src/lib/pipeline/scan-connected-folder-job.test.ts
import { describe, expect, test } from "bun:test"
import { parseScanParams, runScanConnectedFolderJob, type ScanJobDeps } from "./scan-connected-folder-job"
import { isScheduledJob, runScheduledJob, SCAN_CONNECTED_FOLDER, SCHEDULED_JOB_IDS, type ScheduledJobContext } from "./scheduled-jobs"
import { EXECUTABLE_FUNCTION_IDS } from "./executor"
import { functionSpec } from "./function-registry"
import { ServiceError } from "@/lib/services/compliance-service"
import { buildWorkbook, deterministicModel, edgeCallerFor, edgeDeps, memoryLedger } from "@/lib/services/__test-helpers__/document-extraction-fixtures"
import { fakeFolder } from "@/lib/services/__test-helpers__/fake-folder-source"
import { FolderSourceError, type CursorStore, type FolderCursor, type ProposalDraft, type ProposalStore } from "@/lib/services/folder-watch-service"

const book = (n: number) => buildWorkbook([{ name: "Bill", rows: [["Item", "Description", "Unit", "Qty", "Price"], ["1.01", `Floor ${n}`, "m2", 10, 500]] }])
const T = (minute: number) => new Date(Date.UTC(2026, 8, 27, 10, minute, 0))

function deps(over: Partial<ScanJobDeps> = {}) {
  const folder = fakeFolder([
    { id: "a", name: "a.xlsx", bytes: book(1), modifiedAt: T(10), sender: "friend@example.test" },
    { id: "b", name: "b.xlsx", bytes: book(2), modifiedAt: T(20), sender: "stranger@example.test" },
  ])
  const seen = { openedFor: [] as string[], cursorsFor: [] as string[], proposalsFor: [] as string[], ledgerFor: [] as string[], params: [] as unknown[] }
  const cursorRows = new Map<string, FolderCursor>()
  const drafts: ProposalDraft[] = []
  const memory = memoryLedger()
  const edge = edgeCallerFor(edgeDeps(deterministicModel))
  const real: ScanJobDeps = {
    async openSource(ctx, params) {
      seen.openedFor.push(ctx.actorId)
      seen.params.push(params)
      return folder.source
    },
    cursors: (ctx): CursorStore => {
      seen.cursorsFor.push(ctx.actorId)
      return { read: async (k) => cursorRows.get(k) ?? null, write: async (k, c) => void cursorRows.set(k, c) }
    },
    proposals: (ctx): ProposalStore => {
      seen.proposalsFor.push(ctx.actorId)
      return { record: async (d) => (drafts.push(d), { id: `p${drafts.length}`, created: true }) }
    },
    ledger: (ctx) => {
      seen.ledgerFor.push(ctx.actorId)
      return memory.ledger
    },
    callEdge: () => edge,
    productExists: async (_ctx, productId) => productId === "product-1",
    now: () => 0,
  }
  return { deps: { ...real, ...over } as ScanJobDeps, folder, seen, drafts, cursorRows, memory }
}

const ctx = (over: Partial<ScheduledJobContext> = {}): ScheduledJobContext => ({
  orgId: "org-1",
  scheduleId: "schedule-1",
  owner: { id: "owner-1", role: "member" },
  params: { source: "drive", folderId: "1AbCdEfGhIj", productId: "product-1" },
  deadlineAt: Number.MAX_SAFE_INTEGER,
  ...over,
})

describe("the schedule's params", () => {
  test("a drive schedule needs a folder; a mailbox schedule takes a label and senders; unknown keys and wrong shapes are refused with a reason", () => {
    expect(parseScanParams({ source: "drive", folderId: " 1AbCdEfGhIj ", productId: "p" })).toEqual({ ok: true, value: { source: "drive", productId: "p", folderId: "1AbCdEfGhIj", folderKey: "1AbCdEfGhIj" } })
    expect(parseScanParams({ source: "mailbox", productId: "p" })).toEqual({ ok: true, value: { source: "mailbox", productId: "p", folderKey: "inbox" } })
    expect(parseScanParams({ source: "mailbox", productId: "p", label: "projects", allowedSenders: ["Asha@Example.test"], maxFiles: 2 })).toEqual({
      ok: true,
      value: { source: "mailbox", productId: "p", folderKey: "projects", label: "projects", allowedSenders: ["asha@example.test"], maxFiles: 2 },
    })
    const reason = (params: Record<string, unknown>) => (parseScanParams(params) as { ok: false; reason: string }).reason
    expect(reason({ source: "drive", productId: "p" })).toBe("folder_required")
    expect(reason({ source: "ftp", productId: "p" })).toBe("source_invalid")
    expect(reason({ source: "drive", folderId: "f", productId: "" })).toBe("product_required")
    expect(reason({ source: "drive", folderId: "f", productId: "p", label: "x" })).toBe("label_not_for_drive")
    expect(reason({ source: "drive", folderId: "f", productId: "p", allowedSenders: ["a@b.test"] })).toBe("senders_invalid")
    expect(reason({ source: "mailbox", productId: "p", folderId: "f" })).toBe("folder_not_for_mailbox")
    expect(reason({ source: "mailbox", productId: "p", allowedSenders: ["not an address"] })).toBe("senders_invalid")
    expect(reason({ source: "mailbox", productId: "p", allowedSenders: [] })).toBe("senders_invalid")
    expect(reason({ source: "mailbox", productId: "p", allowedSenders: Array.from({ length: 21 }, (_, i) => `a${i}@b.test`) })).toBe("senders_invalid")
    expect(reason({ source: "mailbox", productId: "p", maxFiles: 6 })).toBe("max_files_invalid")
    expect(reason({ source: "mailbox", productId: "p", maxFiles: 1.5 })).toBe("max_files_invalid")
    expect(reason({ source: "mailbox", productId: "p", projectId: "x" })).toBe("unknown_param")
    expect(reason({ source: "mailbox", productId: "p", label: " " })).toBe("label_invalid")
  })
})

describe("who may run it and what it needs", () => {
  test("a role below member is refused before anything is opened", async () => {
    for (const role of ["viewer", "client_viewer", "stage_0", null, "unknown_role"]) {
      const d = deps()
      expect(await runScanConnectedFolderJob(ctx({ owner: { id: "o", role } }), d.deps)).toEqual({ ok: false, code: "NOT_PERMITTED", reason: "role_below_member" })
      expect(d.seen.openedFor).toEqual([])
    }
  })

  test("a bad param, a product that is not in the organisation, and a toolkit that is not connected are failures with a reason", async () => {
    const bad = deps()
    expect(await runScanConnectedFolderJob(ctx({ params: { source: "drive", productId: "product-1" } }), bad.deps)).toEqual({ ok: false, code: "VALUE_REQUIRED", reason: "folder_required" })
    const noProduct = deps()
    expect(await runScanConnectedFolderJob(ctx({ params: { source: "drive", folderId: "1AbCdEfGhIj", productId: "product-x" } }), noProduct.deps)).toEqual({ ok: false, code: "RECORD_NOT_FOUND", reason: "product_not_found" })
    expect(noProduct.seen.openedFor).toEqual([])
    const notConnected = deps({ openSource: async () => { throw new ServiceError("No googledrive connection found for this user", 400) } })
    expect(await runScanConnectedFolderJob(ctx(), notConnected.deps)).toEqual({ ok: false, code: "REQUEST_REJECTED", reason: "not_connected" })
    const badFolder = deps({ openSource: async () => { throw new FolderSourceError("bad_folder", "the Drive folder id is not valid") } })
    expect(await runScanConnectedFolderJob(ctx(), badFolder.deps)).toEqual({ ok: false, code: "REQUEST_REJECTED", reason: "bad_folder" })
  })
})

describe("a good run", () => {
  test("runs as the owner, answers with numbers only, and passes the sender list to the scan", async () => {
    const d = deps()
    const report = await runScanConnectedFolderJob(
      ctx({ owner: { id: "owner-7", role: "manager" }, params: { source: "mailbox", productId: "product-1", allowedSenders: ["friend@example.test"] } }),
      d.deps,
    )
    expect(report).toMatchObject({ ok: true, counts: { listed: 2, handled: 1, skippedSender: 1, proposed: 1 } })
    expect(Object.values((report as { counts: Record<string, number> }).counts).every((v) => typeof v === "number")).toBe(true)
    expect(d.seen).toMatchObject({ openedFor: ["owner-7"], cursorsFor: ["owner-7"], proposalsFor: ["owner-7"], ledgerFor: ["owner-7"] })
    expect(d.drafts.map((x) => [x.ownerId, x.orgId, x.scheduleId, x.productId])).toEqual([["owner-7", "org-1", "schedule-1", "product-1"]])
    expect(JSON.stringify(report)).not.toMatch(/a\.xlsx|friend@|stranger@/)
  })

  test("stops at the file limit with a stop word, and the next run goes on from the cursor", async () => {
    const d = deps()
    const params = { source: "drive", folderId: "1AbCdEfGhIj", productId: "product-1", maxFiles: 1 }
    expect(await runScanConnectedFolderJob(ctx({ params }), d.deps)).toMatchObject({ ok: true, stopped: "limit", counts: { handled: 1, proposed: 1 } })
    expect(await runScanConnectedFolderJob(ctx({ params }), d.deps)).toMatchObject({ ok: true, counts: { handled: 1, proposed: 1 } })
    expect(d.drafts.map((x) => x.source.fileId)).toEqual(["a", "b"])
  })

  test("a source that cannot be listed is BACKEND_UNAVAILABLE with the source's own word, not its message", async () => {
    const d = deps()
    d.folder.failList("source_read_failed")
    expect(await runScanConnectedFolderJob(ctx(), d.deps)).toEqual({ ok: false, code: "BACKEND_UNAVAILABLE", reason: "source_read_failed" })
  })
})

describe("the job is reachable from the scheduler alone", () => {
  test("it is a scheduled job and in no registry: no function spec, no executor", async () => {
    expect(isScheduledJob(SCAN_CONNECTED_FOLDER)).toBe(true)
    expect(SCHEDULED_JOB_IDS).toEqual([SCAN_CONNECTED_FOLDER])
    expect(functionSpec(SCAN_CONNECTED_FOLDER)).toBeUndefined()
    expect(EXECUTABLE_FUNCTION_IDS).not.toContain(SCAN_CONNECTED_FOLDER)
    expect(isScheduledJob("create_boq")).toBe(false)
    expect(await runScheduledJob("no_such_job", ctx())).toEqual({ ok: false, code: "FUNCTION_NOT_AVAILABLE", reason: "unknown_job" })
  })
})
