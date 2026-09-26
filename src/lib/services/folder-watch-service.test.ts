/// <reference types="bun-types" />
// PROJEXA-BUILD-002 WP-13 (register row AW-605): the scan of a connected mailbox or folder (folder-watch-service.ts) on a fake folder,
// with the REAL extraction job (startExtractionJob / runExtractionJob, the real Edge Function handler in process with a stand-in
// model) and in-memory stores for the cursor, the proposals and the ledger. The database halves (the cursor row, the proposal row, the
// ledger on real SQL, a crash between the job and the cursor) are in folder-watch-store.test.ts.
//
// WHAT IS PROVEN
//   1. cursor arithmetic: newer means later, or at the same time with an unseen id; advancing keeps the ids of one instant;
//   2. one scan handles the new files oldest first whatever order the source lists them in, records ONE proposal per file, moves the
//      cursor past each file only after its proposal is recorded, and creates no project and no BOQ (the deps hold a createProject and
//      a createBoq that throw; a scan that reached them would fail);
//   3. the same bytes under two names or ids are one job and one proposal, and a second scan of a folder that lists everything again
//      does nothing new and makes no second model call;
//   4. the caps: a name that is not .xlsx, a listed size or a real size over the limit, a sender that is not allowed: counted, never
//      read as a job, and the cursor moves on; a file that is not a workbook creates no job row and no proposal;
//   5. waits and failures: the extraction not set up holds the cursor and costs no attempt, a failing download is tried three times
//      and then skipped, and a proposal that could not be recorded leaves the job parked and is finished by the next scan;
//   6. the run limit, the deadline, and two files at the same instant (one per run, none twice, none missed).
//
// Run: bun test --isolate src/lib/services/folder-watch-service.test.ts
import { describe, expect, test } from "bun:test"
import {
  advanceCursor,
  FOLDER_WATCH_LIMITS,
  isNewerThanCursor,
  scanConnectedFolder,
  type CursorStore,
  type FolderCursor,
  type FolderFile,
  type ProposalDraft,
  type ProposalStore,
  type ScanDeps,
} from "./folder-watch-service"
import { buildWorkbook, deterministicModel, edgeCallerFor, edgeDeps, memoryLedger } from "./__test-helpers__/document-extraction-fixtures"
import { carefulHumanModel } from "./__test-helpers__/zoomies-standin-model"
import { zoomiesWorkbook } from "./__test-helpers__/zoomies-workbook"
import { fakeFolder, type FakeEntry } from "./__test-helpers__/fake-folder-source"
import type { ModelCall } from "../../../supabase/functions/projexa-document-extract/handler"

const ORG = "org-w"
const ACTOR = "user-w"
const T = (minute: number) => new Date(Date.UTC(2026, 8, 27, 10, minute, 0))

/** A one-line workbook whose line is `n` (so every n is different bytes and a different hash). */
const book = (n: number) => buildWorkbook([{ name: "Bill", rows: [["Item", "Description", "Unit", "Qty", "Price"], ["1.01", `Floor ${n}`, "m2", 10, 500]] }])
const entry = (id: string, minute: number, n: number, extra: Partial<FakeEntry> = {}): FakeEntry => ({ id, name: `${id}.xlsx`, bytes: book(n), modifiedAt: T(minute), ...extra })

function memoryCursors() {
  const rows = new Map<string, FolderCursor>()
  const writes: FolderCursor[] = []
  const store: CursorStore = {
    read: async (key) => rows.get(key) ?? null,
    write: async (key, cursor) => {
      writes.push(cursor)
      rows.set(key, cursor)
    },
  }
  return { store, rows, writes }
}

function memoryProposals(failFirst = 0) {
  const byHash = new Map<string, { id: string; draft: ProposalDraft }>()
  const attempts = { n: 0 }
  const store: ProposalStore = {
    async record(draft) {
      if (attempts.n++ < failFirst) throw new Error("the proposal could not be stored")
      const held = byHash.get(draft.contentSha256)
      if (held) return { id: held.id, created: false }
      const id = `proposal-${byHash.size + 1}`
      byHash.set(draft.contentSha256, { id, draft })
      return { id, created: true }
    },
  }
  return { store, byHash, drafts: () => [...byHash.values()].map((v) => v.draft) }
}

function world(entries: FakeEntry[] = [], model: ModelCall | null = deterministicModel, options: { untrusted?: boolean; failProposals?: number } = {}) {
  const folder = fakeFolder(entries, { untrusted: options.untrusted })
  const cursors = memoryCursors()
  const proposals = memoryProposals(options.failProposals ?? 0)
  const memory = memoryLedger()
  let configured = model !== null
  const good = edgeCallerFor(edgeDeps(model ?? deterministicModel))
  const bad = edgeCallerFor(edgeDeps(null))
  const callEdge: ScanDeps["callEdge"] = (body, attribution) => (configured ? good : bad)(body, attribution)
  const deps: ScanDeps = { source: folder.source, cursors: cursors.store, proposals: proposals.store, ledger: memory.ledger, callEdge }
  const input = { orgId: ORG, actorId: ACTOR, scheduleId: "schedule-1", productId: "product-1", folderKey: "folder-1" }
  return {
    folder,
    cursors,
    proposals,
    memory,
    modelCalls: () => good.calls.count,
    configure: (on: boolean) => void (configured = on),
    scan: (extra: Partial<Parameters<typeof scanConnectedFolder>[0]> = {}) => scanConnectedFolder({ ...input, ...extra }, deps),
    cursor: () => cursors.rows.get("test:folder-1") ?? null,
  }
}

// --------------------------------------------------------------------------------------------------------------------- 1. cursor

describe("the cursor arithmetic", () => {
  const file = (id: string, minute: number): FolderFile => ({ id, name: `${id}.xlsx`, mimeType: null, sizeBytes: 1, modifiedAt: T(minute) })

  test("a file is newer when it is later, or at the same instant with an id not yet handled; no cursor means everything is new", () => {
    expect(isNewerThanCursor(file("a", 5), null)).toBe(true)
    const cursor: FolderCursor = { v: 1, modifiedAt: T(5).toISOString(), ids: ["a"] }
    expect(isNewerThanCursor(file("a", 5), cursor)).toBe(false)
    expect(isNewerThanCursor(file("b", 5), cursor)).toBe(true)
    expect(isNewerThanCursor(file("z", 4), cursor)).toBe(false)
    expect(isNewerThanCursor(file("z", 6), cursor)).toBe(true)
  })

  test("advancing keeps the ids of one instant and starts a fresh list at a later one", () => {
    const first = advanceCursor(null, file("a", 5))
    expect(first).toEqual({ v: 1, modifiedAt: T(5).toISOString(), ids: ["a"] })
    const same = advanceCursor(first, file("b", 5))
    expect(same.ids).toEqual(["a", "b"])
    expect(advanceCursor(same, file("b", 5)).ids).toEqual(["a", "b"])
    expect(advanceCursor(same, file("c", 7))).toEqual({ v: 1, modifiedAt: T(7).toISOString(), ids: ["c"] })
  })
})

// --------------------------------------------------------------------------------------------------------------------- 2. one scan

describe("one scan of a folder", () => {
  test("handles the new files oldest first whatever the source's order, one proposal each, the cursor after the last, nothing created", async () => {
    const w = world([entry("late", 30, 3), entry("early", 10, 1), entry("middle", 20, 2)], deterministicModel, { untrusted: true })
    const result = await w.scan()
    expect(result.counts).toMatchObject({ listed: 3, handled: 3, proposed: 3, failed: 0, refused: 0, waiting: 0 })
    expect(result.stoppedBecause).toBeNull()
    expect(w.folder.calls.downloaded).toEqual(["early", "middle", "late"])
    expect(w.proposals.drafts().map((d) => d.source.fileId)).toEqual(["early", "middle", "late"])
    expect(w.cursor()).toEqual({ v: 1, modifiedAt: T(30).toISOString(), ids: ["late"] })
    expect(w.modelCalls()).toBe(3)
    // Each file is one parked job, and none is a created project (the deps' createProject and createBoq throw; a scan that reached
    // either would have counted the file as failed, not proposed).
    expect([...w.memory.rows.values()].every((r) => r.parked !== null && r.projectId === null)).toBe(true)
    expect(w.memory.events.filter((e) => e === "attach")).toEqual([])
  })

  test("a proposal is about the person, the schedule, the product and the file, and names no amount", async () => {
    const w = world([entry("one", 10, 1)])
    await w.scan()
    const [draft] = w.proposals.drafts()
    expect(draft).toMatchObject({ orgId: ORG, ownerId: ACTOR, scheduleId: "schedule-1", productId: "product-1", state: "ready", fileName: "one.xlsx", questionCount: 0, lineCount: 1, source: { kind: "test", folderKey: "folder-1", fileId: "one" } })
    expect(draft.contentSha256).toMatch(/^[0-9a-f]{64}$/)
    expect(JSON.stringify(draft)).not.toMatch(/500|5000/)
  })

  test("a workbook with open questions is a proposal in needs_answers, with the number of questions", async () => {
    const w = world([{ id: "zoomies", name: "SMD.ZOOMIES.xlsx", bytes: zoomiesWorkbook(), modifiedAt: T(10) }], carefulHumanModel)
    const result = await w.scan()
    expect(result.counts.proposed).toBe(1)
    const [draft] = w.proposals.drafts()
    expect(draft).toMatchObject({ state: "needs_answers", questionCount: 27, lineCount: 53, sheetCount: 22 })
    expect(w.memory.states.at(-1)).toMatchObject({ state: "needs_answers" })
  })

  test("the same bytes under two ids and names are one job and one proposal; a second scan that lists everything again does nothing", async () => {
    const w = world([entry("first", 10, 1), { ...entry("copy", 12, 1), name: "copy of first.xlsx" }], deterministicModel, { untrusted: true })
    const result = await w.scan()
    expect(result.counts).toMatchObject({ handled: 2, proposed: 1, alreadyProposed: 1 })
    expect(w.proposals.byHash.size).toBe(1)
    expect(w.memory.rows.size).toBe(1)
    expect(w.modelCalls()).toBe(1)

    const again = await w.scan()
    expect(again.counts).toMatchObject({ listed: 0, handled: 0, proposed: 0 })
    expect(w.modelCalls()).toBe(1)
    expect(w.folder.calls.download).toBe(2)
  })

  test("a file that is not a workbook creates no job and no proposal, and does not stop the files after it", async () => {
    const notBook = { ...entry("text", 10, 1), bytes: new TextEncoder().encode("PROJECT total 100\n"), sizeBytes: null }
    const w = world([notBook, entry("real", 20, 2)])
    const result = await w.scan()
    expect(result.counts).toMatchObject({ refused: 1, proposed: 1, handled: 2 })
    expect(w.memory.events.filter((e) => e === "claim")).toHaveLength(1)
    expect(w.proposals.drafts().map((d) => d.source.fileId)).toEqual(["real"])
    expect(w.cursor()?.ids).toEqual(["real"])
  })

  test("no scan ever calls createProject or createBoq: the extraction deps it passes refuse both", async () => {
    // Break: a scan given a source whose file the job would create (mode create) would reach createProject. Here the proof is the
    // other way round: the job runs in prepare mode, so with a file that has no question the state is ready and nothing was attached.
    const w = world([entry("ready", 10, 1)])
    await w.scan()
    expect(w.memory.states.map((s) => s.state)).toEqual(["reading", "ready"])
    expect(w.memory.events).toEqual(["claim"])
  })
})

// --------------------------------------------------------------------------------------------------------------------- 3. the caps

describe("the caps on untrusted files", () => {
  test("a name that is not .xlsx, a listed size over the limit and a sender that is not allowed are counted, not downloaded, and passed for good", async () => {
    const w = world([
      { ...entry("pdf", 10, 1), name: "quote.pdf" },
      entry("huge", 11, 2, { sizeBytes: FOLDER_WATCH_LIMITS.maxFileBytes + 1 }),
      entry("stranger", 12, 3, { sender: "stranger@example.test" }),
      entry("friend", 13, 4, { sender: "friend@example.test" }),
    ])
    const result = await w.scan({ allowedSenders: ["friend@example.test"] })
    expect(result.counts).toMatchObject({ listed: 4, skippedType: 1, skippedSize: 1, skippedSender: 1, proposed: 1 })
    // The pdf and the huge file also lack an allowed sender, but the type and size checks come first, so each is counted once.
    expect(w.folder.calls.downloaded).toEqual(["friend"])
    expect(w.cursor()).toEqual({ v: 1, modifiedAt: T(13).toISOString(), ids: ["friend"] })
    const again = await w.scan({ allowedSenders: ["friend@example.test"] })
    expect(again.counts.listed).toBe(0)
  })

  test("a file whose real size is over the limit although the listing said it was small is skipped after the download", async () => {
    const liar = { ...entry("liar", 10, 1), bytes: new Uint8Array(FOLDER_WATCH_LIMITS.maxFileBytes + 1), sizeBytes: 100 }
    const w = world([liar])
    const result = await w.scan()
    expect(result.counts).toMatchObject({ skippedSize: 1, proposed: 0 })
    expect(w.memory.events).toEqual([])
    expect(w.cursor()?.ids).toEqual(["liar"])
  })

  test("a file names a sender only in a mailbox; a folder file with no sender fails a sender list", async () => {
    const w = world([entry("folder-file", 10, 1)])
    const result = await w.scan({ allowedSenders: ["friend@example.test"] })
    expect(result.counts.skippedSender).toBe(1)
  })

  test("the file name in a proposal has no path and no control characters", async () => {
    const w = world([{ ...entry("odd", 10, 1), name: "..\\..\\evil\u0007name.xlsx" }])
    await w.scan()
    expect(w.proposals.drafts()[0].fileName).toBe("evilname.xlsx")
  })
})

// --------------------------------------------------------------------------------------------------------------------- 4. waits and failures

describe("waits, failures and recovery", () => {
  test("the extraction not set up holds the cursor and costs no attempt; once it is set up the same file is read", async () => {
    const w = world([entry("a", 10, 1), entry("b", 20, 2)])
    w.configure(false)
    for (let i = 0; i < 5; i++) {
      const held = await w.scan()
      expect(held.stoppedBecause).toBe("waiting")
      expect(held.counts).toMatchObject({ waiting: 1, proposed: 0, failed: 0, gaveUp: 0 })
    }
    expect(w.cursor()).toBeNull()
    expect(w.proposals.drafts()).toEqual([])
    w.configure(true)
    const done = await w.scan()
    expect(done.counts).toMatchObject({ proposed: 2, waiting: 0 })
    expect(w.cursor()?.ids).toEqual(["b"])
  })

  test("a download that fails is tried three times and then skipped, and the files after it are read", async () => {
    const w = world([entry("bad", 10, 1), entry("good", 20, 2)])
    for (const attempt of [1, 2]) {
      w.folder.failNextDownload("bad")
      const result = await w.scan()
      expect(result.counts).toMatchObject({ failed: 1, handled: 0, proposed: 0 })
      expect(result.stoppedBecause).toBe("failed")
      expect(w.cursor()?.stuck).toEqual({ id: "bad", attempts: attempt })
    }
    w.folder.failNextDownload("bad")
    const third = await w.scan()
    expect(third.counts).toMatchObject({ gaveUp: 1, proposed: 1 })
    expect(w.cursor()).toEqual({ v: 1, modifiedAt: T(20).toISOString(), ids: ["good"] })
    expect(w.proposals.drafts().map((d) => d.source.fileId)).toEqual(["good"])
  })

  test("a proposal that could not be recorded leaves the job parked, and the next scan finishes it with no second model call", async () => {
    const w = world([entry("a", 10, 1)], deterministicModel, { failProposals: 1 })
    const first = await w.scan()
    expect(first.counts).toMatchObject({ failed: 1, proposed: 0 })
    expect(w.cursor()?.modifiedAt).not.toBe(T(10).toISOString())
    expect(w.memory.rows.size).toBe(1)
    const second = await w.scan()
    expect(second.counts).toMatchObject({ proposed: 1, failed: 0 })
    expect(w.proposals.byHash.size).toBe(1)
    expect(w.memory.rows.size).toBe(1)
    expect(w.modelCalls()).toBe(1)
    expect(w.cursor()?.ids).toEqual(["a"])
  })

  test("a source that cannot be listed throws, and leaves the cursor as it was", async () => {
    const w = world([entry("a", 10, 1)])
    await w.scan()
    const before = w.cursor()
    w.folder.failList("source_read_failed")
    await expect(w.scan()).rejects.toMatchObject({ code: "source_read_failed" })
    expect(w.cursor()).toEqual(before)
  })
})

// --------------------------------------------------------------------------------------------------------------------- 5. bounds

describe("the bounds of a run", () => {
  test("at most maxFiles are handled in a run; the next run continues where the cursor stands", async () => {
    const w = world([entry("a", 10, 1), entry("b", 20, 2), entry("c", 30, 3)])
    const first = await w.scan({ maxFiles: 2 })
    expect(first.counts).toMatchObject({ handled: 2, proposed: 2 })
    expect(first.stoppedBecause).toBe("limit")
    const second = await w.scan({ maxFiles: 2 })
    expect(second.counts).toMatchObject({ handled: 1, proposed: 1 })
    expect(second.stoppedBecause).toBeNull()
    expect(w.proposals.drafts().map((d) => d.source.fileId)).toEqual(["a", "b", "c"])
  })

  test("no file is started after the deadline", async () => {
    const w = world([entry("a", 10, 1)])
    const result = await w.scan({ deadlineAt: 1000, now: () => 1000 })
    expect(result.stoppedBecause).toBe("deadline")
    expect(w.folder.calls.download).toBe(0)
    expect(w.cursor()).toBeNull()
  })

  test("two files at the same instant: one per run, none twice, none missed", async () => {
    const w = world([entry("x", 10, 1), entry("y", 10, 2)])
    const first = await w.scan({ maxFiles: 1 })
    expect(first.counts.handled).toBe(1)
    expect(w.cursor()?.ids).toEqual(["x"])
    const second = await w.scan({ maxFiles: 1 })
    expect(second.counts.handled).toBe(1)
    expect(w.cursor()?.ids).toEqual(["x", "y"])
    const third = await w.scan({ maxFiles: 1 })
    expect(third.counts.listed).toBe(0)
    expect(w.proposals.drafts().map((d) => d.source.fileId)).toEqual(["x", "y"])
  })
})
