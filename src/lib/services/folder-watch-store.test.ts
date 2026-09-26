/// <reference types="bun-types" />
// PROJEXA-BUILD-002 WP-13 (register row AW-605): way 5 on REAL SQL. PGlite (real Postgres compiled to WASM, in process) holds the
// tables the flow touches (compliance.source_object with the WP-02 job columns, compliance.submissions, compliance.users, the products
// and the BOQ tables); only withTenantContext is replaced, by a double that opens one real transaction per call and refuses nesting.
// The scan, the cursor store, the proposal store and the extraction ledger are the real code. The folder is the fake folder and the
// model is the stand-in model; nothing reaches a network, a Drive, a mailbox or a live database.
//
// WHAT IS PROVEN
//   1. the cursor row: one per person and connected folder (an upsert on the ledger table's partial unique index), never mistaken for
//      a ledger row, unreadable garbage reads as no cursor;
//   2. the proposal row: one per file hash and organisation, the shape the approval list reads, no amount in it; a schedule's create_boq
//      proposal is now a prepared source of a project's approval list; the organisation-wide
//      list shows a member their own and a manager the organisation's, hides a decided or claimed one, and never shows the parameters
//      of a proposal of another function;
//   3. the ZOOMIES workbook dropped in a folder becomes ONE parked job (needs_answers, 27 questions), ONE proposal and a cursor, and
//      no project and no BOQ, with no human trigger but the scan; the list shows it with counts and no amount;
//   4. idempotency by file hash: scanning again, scanning with the cursor deleted, and the same bytes in a second source (a Drive
//      folder after a mailbox) all leave one job row, one proposal and ONE model call in total;
//   5. crash after the job row and before the cursor: the cursor write fails once after the job is parked and the proposal is
//      recorded; the next scan finds the job by its hash, records nothing twice, makes no second model call and moves the cursor;
//   6. crash after the claim and before the extraction ended: the claim is held (the file waits, the cursor does not pass it) until it
//      goes stale, then is taken over and finished.
//
// Run: bun test --isolate src/lib/services/folder-watch-store.test.ts
import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test"
import * as realTenantScoped from "@/lib/db/tenant-scoped"
import { createExtractionPglite, insertProduct, insertUser } from "./__test-helpers__/document-extraction-pglite"
import { edgeCallerFor, edgeDeps } from "./__test-helpers__/document-extraction-fixtures"
import { carefulHumanModel } from "./__test-helpers__/zoomies-standin-model"
import { zoomiesWorkbook } from "./__test-helpers__/zoomies-workbook"
import { fakeFolder } from "./__test-helpers__/fake-folder-source"
import type { CursorStore, FolderCursor, ScanDeps } from "./folder-watch-service"

const ORG = "org-fw"
const OTHER_ORG = "org-other"
const ACTOR = "user-fw"
const MANAGER = "user-mgr"
const OTHER_MEMBER = "user-other-member"
const PRODUCT = "product-fw"

const SUBMISSIONS_SQL = `
CREATE TYPE compliance.submission_status AS ENUM ('chat', 'in_progress', 'done', 'partial', 'failed');
CREATE TYPE compliance.submission_classification AS ENUM ('CHAT_ONLY', 'TASK', 'MULTIPLE_TASKS');
CREATE TABLE compliance.submissions (
  id text PRIMARY KEY,
  org_id text NOT NULL,
  project_id text,
  mode text NOT NULL,
  selected_chain jsonb,
  raw_input text NOT NULL,
  user_id text NOT NULL,
  status compliance.submission_status DEFAULT 'in_progress' NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  classification compliance.submission_classification,
  level smallint,
  source text,
  l0_hit_rate numeric(5,4),
  model_calls integer,
  cache_hits integer,
  level1_outcome text,
  level1_refusal_code text,
  via text,
  ai_link_id text
);`

let h: Awaited<ReturnType<typeof createExtractionPglite>>
let depth = 0
async function tenantDouble<T>(_ctx: unknown, fn: (tx: never) => Promise<T>): Promise<T> {
  if (depth > 0) throw new Error("nested withTenantContext (the real one refuses this too)")
  depth++
  try {
    return await h.db.transaction((tx) => fn(tx as never))
  } finally {
    depth--
  }
}

type Svc = typeof import("./folder-watch-service")
type Store = typeof import("./folder-watch-store")
type Extraction = typeof import("./document-extraction-service")
let scanService: Svc
let store: Store
let extraction: Extraction

beforeAll(async () => {
  h = await createExtractionPglite()
  await h.pg.exec(SUBMISSIONS_SQL)
  await insertProduct(h, { id: PRODUCT, org_id: ORG })
  for (const id of [ACTOR, MANAGER, OTHER_MEMBER]) await insertUser(h, { id, org_id: ORG })
  mock.module("@/lib/db/tenant-scoped", () => ({ ...realTenantScoped, withTenantContext: tenantDouble }))
  scanService = await import("./folder-watch-service")
  store = await import("./folder-watch-store")
  extraction = await import("./document-extraction-service")
}, 60_000)

afterAll(async () => {
  await h.pg.close()
})

beforeEach(async () => {
  await h.pg.exec("truncate compliance.source_object, compliance.submissions, compliance.projects, compliance.construction_boqs, compliance.construction_boq_line_items")
  depth = 0
})

type Row = Record<string, unknown>
const rows = async (sql: string, params: unknown[] = []): Promise<Row[]> => (await h.pg.query(sql, params)).rows as Row[]
const count = async (table: string, where = "true") => Number((await rows(`select count(*)::int as n from compliance.${table} where ${where}`))[0].n)
const T = (minute: number) => new Date(Date.UTC(2026, 8, 27, 10, minute, 0))

function scanWorld(options: { kind?: "mailbox" | "drive" | "test"; wrapCursors?: (real: CursorStore) => CursorStore } = {}) {
  const folder = fakeFolder([], { kind: options.kind, untrusted: true })
  const ctx = { orgId: ORG, actorId: ACTOR }
  const edge = edgeCallerFor(edgeDeps(carefulHumanModel))
  const realCursors = store.createDbCursorStore(ctx)
  const deps: ScanDeps = {
    source: folder.source,
    cursors: options.wrapCursors ? options.wrapCursors(realCursors) : realCursors,
    proposals: store.createDbProposalStore(ctx),
    ledger: extraction.createDbProjectSourceLedger(ctx),
    callEdge: edge,
  }
  return {
    folder,
    edge,
    deps,
    scan: () => scanService.scanConnectedFolder({ ...ctx, scheduleId: "schedule-1", productId: PRODUCT, folderKey: "folder-1" }, deps),
  }
}

const zoomies = () => ({ id: "file-zoomies", name: "SMD.ZOOMIES.xlsx", bytes: zoomiesWorkbook(), modifiedAt: T(10) })

// --------------------------------------------------------------------------------------------------------------------- 1. the cursor

describe("the cursor row", () => {
  const cursor: FolderCursor = { v: 1, modifiedAt: T(5).toISOString(), ids: ["a"] }

  test("is written once per person and connected folder, updated in place, and read back", async () => {
    const mine = store.createDbCursorStore({ orgId: ORG, actorId: ACTOR })
    expect(await mine.read("drive:f1")).toBeNull()
    await mine.write("drive:f1", cursor)
    await mine.write("drive:f1", { ...cursor, ids: ["a", "b"] })
    expect(await mine.read("drive:f1")).toEqual({ ...cursor, ids: ["a", "b"] })
    expect(await count("source_object", `origin_ref = '${store.FOLDER_CURSOR_ORIGIN_REF}'`)).toBe(1)

    // Another folder, another person and another organisation each have their own.
    await mine.write("drive:f2", cursor)
    await store.createDbCursorStore({ orgId: ORG, actorId: MANAGER }).write("drive:f1", cursor)
    await store.createDbCursorStore({ orgId: OTHER_ORG, actorId: ACTOR }).write("drive:f1", cursor)
    expect(await count("source_object", `origin_ref = '${store.FOLDER_CURSOR_ORIGIN_REF}'`)).toBe(4)
    expect(await mine.read("drive:f1")).toEqual({ ...cursor, ids: ["a", "b"] })
    expect(await store.createDbCursorStore({ orgId: ORG, actorId: MANAGER }).read("drive:f2")).toBeNull()
  })

  test("is not a ledger row: no job state, no project link, invisible to the job read and to the hourly count", async () => {
    await store.createDbCursorStore({ orgId: ORG, actorId: ACTOR }).write("drive:f1", cursor)
    const [row] = await rows("select origin, origin_ref, job_state, linked_entity_id, storage_path, extract_status from compliance.source_object")
    expect(row).toEqual({ origin: "connector", origin_ref: store.FOLDER_CURSOR_ORIGIN_REF, job_state: null, linked_entity_id: null, storage_path: null, extract_status: "SKIPPED_UNSUPPORTED" })
    const key = store.folderCursorKey(ACTOR, "drive:f1")
    expect(await extraction.getProjectSourceJob({ orgId: ORG, actorId: ACTOR }, { contentSha256: key })).toBeNull()
    const claim = await extraction.createDbProjectSourceLedger({ orgId: ORG, actorId: ACTOR }).claim({ contentSha256: "cd".repeat(32), fileName: "a.xlsx", byteSize: 1 })
    expect(claim.kind).toBe("claimed")
  })

  test("stored garbage reads as no cursor", async () => {
    await store.createDbCursorStore({ orgId: ORG, actorId: ACTOR }).write("drive:f1", cursor)
    await h.pg.exec(`update compliance.source_object set job_result = '{"v":2,"modifiedAt":"x"}'::jsonb`)
    expect(await store.createDbCursorStore({ orgId: ORG, actorId: ACTOR }).read("drive:f1")).toBeNull()
    expect(store.readStoredCursor({ v: 1, modifiedAt: "not a date", ids: [] })).toBeNull()
    expect(store.readStoredCursor({ v: 1, modifiedAt: T(1).toISOString(), ids: [1] })).toBeNull()
    expect(store.readStoredCursor(null)).toBeNull()
  })
})

// --------------------------------------------------------------------------------------------------------------------- 2. proposals

describe("the proposal row and the list", () => {
  const draft = (over: Partial<import("./folder-watch-service").ProposalDraft> = {}): import("./folder-watch-service").ProposalDraft => ({
    orgId: ORG,
    ownerId: ACTOR,
    scheduleId: "schedule-1",
    productId: PRODUCT,
    contentSha256: "aa".repeat(32),
    jobId: "job-1",
    state: "needs_answers",
    fileName: "book.xlsx",
    source: { kind: "drive", folderKey: "folder-1", fileId: "file-1" },
    questionCount: 4,
    lineCount: 12,
    sheetCount: 3,
    reconciliationStatus: "matched",
    ...over,
  })

  test("one proposal per file hash and organisation, in the shape the approval list reads, with no project and no amount", async () => {
    const proposals = store.createDbProposalStore({ orgId: ORG, actorId: ACTOR })
    const first = await proposals.record(draft())
    const again = await proposals.record(draft({ jobId: "job-2", fileName: "renamed.xlsx" }))
    expect(first.created).toBe(true)
    expect(again).toEqual({ id: first.id, created: false })
    expect(await count("submissions")).toBe(1)
    const [row] = await rows("select org_id, project_id, mode, raw_input, user_id, status, classification, selected_chain from compliance.submissions")
    expect(row).toMatchObject({ org_id: ORG, project_id: null, mode: "Projects", user_id: ACTOR, status: "in_progress", classification: "TASK", raw_input: "new project from a workbook" })
    const chain = row.selected_chain as { source: string; functionId: string; params: Record<string, unknown>; note: string; scheduleId: string; contentSha256: string; jobId: string }
    expect(chain).toMatchObject({ source: "scheduler_bridge", functionId: "create_project_from_document", scheduleId: "schedule-1", contentSha256: "aa".repeat(32), jobId: "job-1" })
    expect(chain.params).toMatchObject({ productId: PRODUCT, state: "needs_answers", questionCount: 4, lineCount: 12, sheetCount: 3, reconciliationStatus: "matched", fileName: "book.xlsx" })
    expect(chain.note).toContain("4 questions need an answer")
    expect(chain.note).toContain("Nothing is created until a person approves it")

    // Another organisation with the same file is its own proposal.
    const other = await store.createDbProposalStore({ orgId: OTHER_ORG, actorId: ACTOR }).record(draft({ orgId: OTHER_ORG }))
    expect(other.created).toBe(true)
    expect(await count("submissions")).toBe(2)
  })

  test("the list: a member sees their own, a manager the organisation's; decided and claimed ones and other organisations' are absent", async () => {
    const mine = store.createDbProposalStore({ orgId: ORG, actorId: ACTOR })
    const theirs = store.createDbProposalStore({ orgId: ORG, actorId: OTHER_MEMBER })
    await mine.record(draft({ contentSha256: "01".repeat(32), state: "ready", questionCount: 0 }))
    await theirs.record(draft({ contentSha256: "02".repeat(32), ownerId: OTHER_MEMBER }))
    const decided = await mine.record(draft({ contentSha256: "03".repeat(32) }))
    const claimed = await mine.record(draft({ contentSha256: "04".repeat(32) }))
    await store.createDbProposalStore({ orgId: OTHER_ORG, actorId: ACTOR }).record(draft({ orgId: OTHER_ORG, contentSha256: "05".repeat(32) }))
    await h.pg.query("update compliance.submissions set status = 'done' where id = $1", [decided.id])
    await h.pg.query(`update compliance.submissions set selected_chain = selected_chain || '{"claimedAt":"2026-09-27T10:00:00Z"}'::jsonb where id = $1`, [claimed.id])

    const asMember = await store.listSchedulerProposals({ orgId: ORG, actorId: ACTOR }, { onlyFor: ACTOR })
    expect(asMember).toHaveLength(1)
    expect(asMember[0]).toMatchObject({ waitingOn: "approval", projectId: null, preparedById: ACTOR, folder: { state: "ready", questionCount: 0, fileName: "book.xlsx", sourceKind: "drive" } })
    const asManager = await store.listSchedulerProposals({ orgId: ORG, actorId: MANAGER })
    expect(asManager.map((p) => p.preparedById).sort()).toEqual([ACTOR, OTHER_MEMBER])
    expect(asManager.find((p) => p.preparedById === OTHER_MEMBER)?.waitingOn).toBe("answers")
  })

  test("a proposal of another function is listed by name and project only: its rates are never in the list", async () => {
    await h.pg.query(
      `insert into compliance.submissions (id, org_id, project_id, mode, selected_chain, raw_input, user_id, status)
       values ('sub-boq', $1, 'project-9', 'Projects', $2::jsonb, 'new boq', $3, 'in_progress')`,
      [ORG, JSON.stringify({ source: "scheduler_bridge", functionId: "create_boq", params: { projectId: "project-9", lineItems: [{ description: "Floor", quantity: 10, rate: 987654 }] }, note: "n", scheduleId: "s" }), ACTOR],
    )
    const [view] = await store.listSchedulerProposals({ orgId: ORG, actorId: MANAGER })
    expect(view).toMatchObject({ functionId: "create_boq", label: "New BOQ", projectId: "project-9", waitingOn: "other", folder: null })
    expect(JSON.stringify(view)).not.toContain("987654")
  })

  test("a row that is not a scheduler proposal, or has no readable chain, is not a view", () => {
    const base = { id: "x", projectId: null, userId: "u", createdAt: new Date() }
    expect(store.schedulerProposalFromRow({ ...base, selectedChain: { source: "paste_back", functionId: "create_boq" } })).toBeNull()
    expect(store.schedulerProposalFromRow({ ...base, selectedChain: null })).toBeNull()
    expect(store.schedulerProposalFromRow({ ...base, selectedChain: { source: "scheduler_bridge" } })).toBeNull()
  })

  test("a project's approval list accepts a schedule's create_boq proposal (the scheduler bridge is a prepared source) and never the folder proposal", async () => {
    const prepared = await import("@/lib/pipeline/prepared-proposals")
    expect(prepared.PREPARED_SOURCES).toContain("scheduler_bridge")
    expect(prepared.readPreparedChain({ source: "scheduler_bridge", functionId: "create_boq", params: { projectId: "p", title: "t" }, note: "n", scheduleId: "s" })).toMatchObject({ source: "scheduler_bridge", functionId: "create_boq" })
    // A proposal of a new project has no project and is not approvable from a project's list: the organisation-wide list is its home.
    expect(prepared.readPreparedChain({ source: "scheduler_bridge", functionId: "create_project_from_document", params: {}, note: null })).toBeNull()
    expect(prepared.S1_APPROVABLE_FUNCTION_IDS).not.toContain("create_project_from_document")
  })

  test("productExistsInOrg answers for this organisation's product only", async () => {
    expect(await store.productExistsInOrg({ orgId: ORG, actorId: ACTOR }, PRODUCT)).toBe(true)
    expect(await store.productExistsInOrg({ orgId: OTHER_ORG, actorId: ACTOR }, PRODUCT)).toBe(false)
    expect(await store.productExistsInOrg({ orgId: ORG, actorId: ACTOR }, "no-such-product")).toBe(false)
  })
})

// --------------------------------------------------------------------------------------------------------------------- 3. the ZOOMIES file

describe("the ZOOMIES workbook dropped in a folder", () => {
  test("becomes one parked job, one proposal and a cursor, with no project and no BOQ, and shows on the list with counts and no amount", async () => {
    const w = scanWorld({ kind: "drive" })
    w.folder.add(zoomies())
    const result = await w.scan()

    expect(result.counts).toMatchObject({ listed: 1, handled: 1, proposed: 1, failed: 0, refused: 0 })
    expect(w.edge.calls.count).toBe(1)
    expect(await count("source_object", "origin_ref = 'projexa-from-document:v1'")).toBe(1)
    const [job] = await rows("select job_state, linked_entity_id, deleted_at from compliance.source_object where origin_ref = 'projexa-from-document:v1'")
    expect(job).toEqual({ job_state: "needs_answers", linked_entity_id: null, deleted_at: null })
    expect(await count("submissions")).toBe(1)
    expect(await count("projects")).toBe(0)
    expect(await count("construction_boqs")).toBe(0)
    expect(await count("construction_boq_line_items")).toBe(0)
    expect(await count("source_object", `origin_ref = '${store.FOLDER_CURSOR_ORIGIN_REF}'`)).toBe(1)
    expect(await store.createDbCursorStore({ orgId: ORG, actorId: ACTOR }).read("drive:folder-1")).toEqual({ v: 1, modifiedAt: T(10).toISOString(), ids: ["file-zoomies"] })

    const [view] = await store.listSchedulerProposals({ orgId: ORG, actorId: ACTOR }, { onlyFor: ACTOR })
    expect(view).toMatchObject({ waitingOn: "answers", projectId: null, folder: { state: "needs_answers", fileName: "SMD.ZOOMIES.xlsx", questionCount: 27, lineCount: 53, sheetCount: 22, sourceKind: "drive" } })
    // The question count is a state the person can act on; the job carries the questions themselves.
    const job2 = await extraction.getProjectSourceJob({ orgId: ORG, actorId: ACTOR }, { jobId: view.folder!.jobId })
    expect(job2).toMatchObject({ state: "needs_answers" })
    expect(job2!.questions).toHaveLength(27)
    expect(JSON.stringify(view)).not.toMatch(/1,?596,?280|1,?343,?445|252,?835/)
  })
})

// --------------------------------------------------------------------------------------------------------------------- 4. idempotency

describe("idempotency by file hash", () => {
  test("scanning again, scanning with the cursor deleted, and the same bytes in another source leave one job, one proposal and one model call", async () => {
    const mailbox = scanWorld({ kind: "mailbox" })
    mailbox.folder.add(zoomies())
    await mailbox.scan()
    expect(await count("submissions")).toBe(1)

    const again = await mailbox.scan()
    expect(again.counts).toMatchObject({ listed: 0, handled: 0 })

    // The cursor is lost: the file is listed again, found again by its hash, and nothing new is made.
    await h.pg.exec(`delete from compliance.source_object where origin_ref = '${store.FOLDER_CURSOR_ORIGIN_REF}'`)
    const lost = await mailbox.scan()
    expect(lost.counts).toMatchObject({ handled: 1, proposed: 0, alreadyProposed: 1 })

    // The same workbook arrives in a Drive folder too.
    const drive = scanWorld({ kind: "drive" })
    drive.folder.add({ ...zoomies(), id: "drive-file", name: "copy.xlsx", modifiedAt: T(40) })
    const viaDrive = await drive.scan()
    expect(viaDrive.counts).toMatchObject({ handled: 1, proposed: 0, alreadyProposed: 1 })

    expect(await count("source_object", "origin_ref = 'projexa-from-document:v1'")).toBe(1)
    expect(await count("submissions")).toBe(1)
    expect(mailbox.edge.calls.count + drive.edge.calls.count).toBe(1)
    expect(await count("projects")).toBe(0)
  })
})

// --------------------------------------------------------------------------------------------------------------------- 5 and 6. crashes

describe("crash recovery", () => {
  test("the cursor write fails once after the job is parked and the proposal is recorded: the next scan records nothing twice and moves the cursor", async () => {
    let failures = 1
    const w = scanWorld({
      kind: "drive",
      wrapCursors: (real) => ({
        read: (key) => real.read(key),
        write: async (key, cursor) => {
          if (failures-- > 0) throw new Error("the process died before the cursor was written")
          await real.write(key, cursor)
        },
      }),
    })
    w.folder.add(zoomies())

    await expect(w.scan()).rejects.toThrow("before the cursor was written")
    expect(await count("source_object", "origin_ref = 'projexa-from-document:v1' and job_state = 'needs_answers'")).toBe(1)
    expect(await count("submissions")).toBe(1)
    expect(await count("source_object", `origin_ref = '${store.FOLDER_CURSOR_ORIGIN_REF}'`)).toBe(0)
    expect(w.edge.calls.count).toBe(1)

    const recovered = await w.scan()
    expect(recovered.counts).toMatchObject({ handled: 1, proposed: 0, alreadyProposed: 1, failed: 0 })
    expect(await count("source_object", "origin_ref = 'projexa-from-document:v1'")).toBe(1)
    expect(await count("submissions")).toBe(1)
    expect(w.edge.calls.count).toBe(1)
    expect(await store.createDbCursorStore({ orgId: ORG, actorId: ACTOR }).read("drive:folder-1")).toEqual({ v: 1, modifiedAt: T(10).toISOString(), ids: ["file-zoomies"] })
    expect((await w.scan()).counts.listed).toBe(0)
  })

  test("a claim whose process died is waited for, not passed; once stale it is taken over and finished", async () => {
    const w = scanWorld({ kind: "drive" })
    const file = zoomies()
    w.folder.add(file)
    // A process claimed the file and died while reading it: a live row in state reading, no proposal, no cursor.
    const ledger = extraction.createDbProjectSourceLedger({ orgId: ORG, actorId: ACTOR })
    const sha = new Bun.CryptoHasher("sha256").update(file.bytes).digest("hex")
    const claim = await ledger.claim({ contentSha256: sha, fileName: file.name, byteSize: file.bytes.byteLength })
    expect(claim.kind).toBe("claimed")
    await ledger.setState((claim as { claimId: string }).claimId, "reading")

    const held = await w.scan()
    expect(held.stoppedBecause).toBe("waiting")
    expect(held.counts).toMatchObject({ waiting: 1, proposed: 0 })
    expect(w.edge.calls.count).toBe(0)
    expect(await count("source_object", `origin_ref = '${store.FOLDER_CURSOR_ORIGIN_REF}'`)).toBe(0)

    await h.pg.exec("update compliance.source_object set updated_at = now() - interval '20 minutes', created_at = now() - interval '20 minutes' where origin_ref = 'projexa-from-document:v1'")
    const finished = await w.scan()
    expect(finished.counts).toMatchObject({ proposed: 1, waiting: 0 })
    expect(w.edge.calls.count).toBe(1)
    expect(await count("source_object", "origin_ref = 'projexa-from-document:v1' and deleted_at is null and job_state = 'needs_answers'")).toBe(1)
    expect(await count("submissions")).toBe(1)
  })
})
