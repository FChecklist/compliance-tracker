/// <reference types="bun-types" />
// PROJEXA-BUILD-002 WP-15 (register row AW-606, way 5): approving the proposal a folder scan prepared, on REAL SQL.
//
// PGlite (real Postgres compiled to WASM, in process) holds the tables; only withTenantContext is replaced, by a double that opens one
// real transaction per call and refuses nesting. The scan, the stores, the ledger, createProject and createBoq are the real code; the
// folder is the fake folder and the model is the stand-in model. Nothing reaches a network, a Drive, a mailbox or a live database.
//
// WHAT IS PROVEN, every figure read back from the tables:
//   1. the ZOOMIES workbook dropped in a folder is scanned (one parked proposal, no project) and then APPROVED: the file is fetched
//      again from the source, and the tables hold 1 project, 1 BOQ, 53 lines adding up to AED 1,596,280, the project's lead and the BOQ's
//      creator are the approving person, the proposal is decided (done, linked to the project) and no longer listed;
//   2. only the proposal's owner can approve it (the file is read with their connection): another person, even a manager, creates nothing;
//   3. the file fetched again must be the file that was proposed: a changed file is refused (file_changed), nothing is made, the claim is
//      given back, and the proposal can still be approved once the source holds the right file again;
//   4. a source that is not connected, or that cannot hand the file over, makes nothing and leaves the proposal pending;
//   5. the questions: without acknowledgeQuestions nothing is made (needs_answers) and the proposal stays pending; with it the project
//      is made from what the job stored, so the model was called ONCE in all (the scan's call), never a second time;
//   6. one approval per proposal: a second approval is already_decided, and two overlapping approvals make ONE project.
//
// Run: bun test --isolate src/lib/services/folder-watch-approve.test.ts
import { AsyncLocalStorage } from "node:async_hooks"
import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test"
import * as realTenantScoped from "@/lib/db/tenant-scoped"
import { createExtractionPglite, insertProduct, insertUser } from "./__test-helpers__/document-extraction-pglite"
import { SUBMISSIONS_SQL } from "./__test-helpers__/submissions-pglite"
import { edgeCallerFor, edgeDeps } from "./__test-helpers__/document-extraction-fixtures"
import { carefulHumanModel } from "./__test-helpers__/zoomies-standin-model"
import { zoomiesWorkbook } from "./__test-helpers__/zoomies-workbook"
import { fakeFolder } from "./__test-helpers__/fake-folder-source"
import { FolderSourceError, type FolderSource } from "./folder-watch-service"
import { ServiceError } from "./service-error"
import type { ApproveProposalDeps } from "./folder-watch-approve"

const ORG = "org-approve"
const OWNER = "user-owner"
const MANAGER = "user-manager"
const PRODUCT = "product-approve"
const TOTAL = 1_596_280

let h: Awaited<ReturnType<typeof createExtractionPglite>>
// One real transaction per call, run one at a time (PGlite is one connection); nesting is tracked per async call chain, so two
// overlapping approvals are two callers, not a nested one.
const inTransaction = new AsyncLocalStorage<true>()
let queue: Promise<unknown> = Promise.resolve()
async function tenantDouble<T>(_ctx: unknown, fn: (tx: never) => Promise<T>): Promise<T> {
  if (inTransaction.getStore()) throw new Error("nested withTenantContext (the real one refuses this too)")
  const run = queue.then(() => inTransaction.run(true, () => h.db.transaction((tx) => fn(tx as never))))
  queue = run.catch(() => undefined)
  return run
}

let scanService: typeof import("./folder-watch-service")
let store: typeof import("./folder-watch-store")
let extraction: typeof import("./document-extraction-service")
let approve: typeof import("./folder-watch-approve")
let dashboard: typeof import("./construction-dashboard-service")
let boqService: typeof import("./construction-boq-service")

beforeAll(async () => {
  h = await createExtractionPglite()
  await h.pg.exec(SUBMISSIONS_SQL)
  await insertProduct(h, { id: PRODUCT, org_id: ORG })
  for (const id of [OWNER, MANAGER]) await insertUser(h, { id, org_id: ORG })
  mock.module("@/lib/db/tenant-scoped", () => ({ ...realTenantScoped, withTenantContext: tenantDouble }))
  scanService = await import("./folder-watch-service")
  store = await import("./folder-watch-store")
  extraction = await import("./document-extraction-service")
  approve = await import("./folder-watch-approve")
  dashboard = await import("./construction-dashboard-service")
  boqService = await import("./construction-boq-service")
}, 60_000)

afterAll(async () => {
  await h.pg.close()
})

beforeEach(async () => {
  await h.pg.exec("truncate compliance.source_object, compliance.submissions, compliance.projects, compliance.construction_boqs, compliance.construction_boq_line_items")
  modelCalls = 0
})

type Row = Record<string, unknown>
const rows = async (sql: string, params: unknown[] = []): Promise<Row[]> => (await h.pg.query(sql, params)).rows as Row[]
const count = async (table: string, where = "true") => Number((await rows(`select count(*)::int as n from compliance.${table} where ${where}`))[0].n)
const T = (minute: number) => new Date(Date.UTC(2026, 8, 27, 10, minute, 0))

let modelCalls = 0
const edge = () => edgeCallerFor(edgeDeps(async (req) => (modelCalls++, carefulHumanModel(req))))

/** A folder holding the ZOOMIES workbook, scanned once: the proposal exists and nothing else. */
async function scannedWorld() {
  const folder = fakeFolder([{ id: "file-zoomies", name: "SMD.ZOOMIES.xlsx", bytes: zoomiesWorkbook(), modifiedAt: T(10) }], { kind: "drive" })
  const ctx = { orgId: ORG, actorId: OWNER }
  const callEdge = edge()
  const ledger = extraction.createDbProjectSourceLedger(ctx)
  const result = await scanService.scanConnectedFolder(
    { ...ctx, scheduleId: "schedule-1", productId: PRODUCT, folderKey: "folder-1" },
    { source: folder.source, cursors: store.createDbCursorStore(ctx), proposals: store.createDbProposalStore(ctx), ledger, callEdge },
  )
  expect(result.counts.proposed).toBe(1)
  const [proposal] = await rows("select id from compliance.submissions")
  return { folder, proposalId: String(proposal.id), callEdge }
}

function depsFor(person: string, source: FolderSource | Error, callEdge = edge()): ApproveProposalDeps<{ id: string }, { id: string }> {
  return {
    callEdge,
    ledger: extraction.createDbProjectSourceLedger({ orgId: ORG, actorId: person }),
    createProject: dashboard.createProject as never,
    createBoq: boqService.createBoq as never,
    openSource: async () => {
      if (source instanceof Error) throw source
      return source
    },
  }
}

const input = (proposalId: string, more: Partial<Parameters<typeof approve.approveFolderProposal>[0]> = {}) => ({ orgId: ORG, person: { id: OWNER }, proposalId, ...more })

async function figures() {
  const total = Number((await rows("select coalesce(sum(quantity * rate), 0)::numeric as t from compliance.construction_boq_line_items"))[0].t)
  return {
    projects: await count("projects"),
    boqs: await count("construction_boqs"),
    lines: await count("construction_boq_line_items"),
    total: Math.round(total * 100) / 100,
  }
}

describe("approving a folder proposal", () => {
  test("the file is fetched again and the project is made: 1 project, 1 BOQ, 53 lines, AED 1,596,280, lead and creator are the approving person, the proposal is decided", async () => {
    const world = await scannedWorld()
    expect(await figures()).toEqual({ projects: 0, boqs: 0, lines: 0, total: 0 })
    expect(world.folder.calls.download).toBe(1)

    const outcome = await approve.approveFolderProposal(input(world.proposalId, { acknowledgeQuestions: true }), depsFor(OWNER, world.folder.source))
    expect(outcome).toMatchObject({ ok: true, duplicate: false })
    expect(world.folder.calls.download).toBe(2) // the scan's, and the approval's own fetch

    expect(await figures()).toEqual({ projects: 1, boqs: 1, lines: 53, total: TOTAL })
    const [project] = await rows("select id, lead_user_id from compliance.projects")
    const [boq] = await rows("select project_id, created_by_id from compliance.construction_boqs")
    expect(project.lead_user_id).toBe(OWNER)
    expect(boq.created_by_id).toBe(OWNER)
    expect(boq.project_id).toBe(project.id)
    expect(modelCalls).toBe(1) // the scan's call; the approval finished the parked job from what it stored

    const [decided] = await rows("select status, project_id, selected_chain from compliance.submissions where id = $1", [world.proposalId])
    expect(decided.status).toBe("done")
    expect(decided.project_id).toBe(project.id)
    expect(decided.selected_chain).toMatchObject({ approvedBy: OWNER, projectId: project.id })
    expect(await store.listSchedulerProposals({ orgId: ORG, actorId: OWNER })).toHaveLength(0)
    const [job] = await rows("select job_state, linked_entity_id from compliance.source_object where origin_ref = 'projexa-from-document:v1'")
    expect(job).toEqual({ job_state: "created", linked_entity_id: project.id })
  })

  test("only the person whose schedule prepared the proposal can approve it: a manager creates nothing and the proposal stays pending", async () => {
    const world = await scannedWorld()
    const outcome = await approve.approveFolderProposal({ orgId: ORG, person: { id: MANAGER }, proposalId: world.proposalId, acknowledgeQuestions: true }, depsFor(MANAGER, world.folder.source))
    expect(outcome).toEqual({ ok: false, reason: "not_owner" })
    expect(world.folder.calls.download).toBe(1)
    expect(await figures()).toEqual({ projects: 0, boqs: 0, lines: 0, total: 0 })
    expect(await count("submissions", "status = 'in_progress' and selected_chain->>'claimedAt' is null")).toBe(1)
  })

  test("a proposal that does not exist, or is not a folder proposal, is not found", async () => {
    await scannedWorld()
    expect(await approve.approveFolderProposal(input("no-such-proposal"), depsFor(OWNER, fakeFolder().source))).toEqual({ ok: false, reason: "not_found" })
    await h.pg.exec(`update compliance.submissions set selected_chain = '{"source":"email_intelligence","functionId":"create_boq","params":{}}'::jsonb`)
    const [row] = await rows("select id from compliance.submissions")
    expect(await approve.approveFolderProposal(input(String(row.id)), depsFor(OWNER, fakeFolder().source))).toEqual({ ok: false, reason: "not_found" })
  })

  test("a changed file is refused, nothing is made, the claim is given back, and the right file then approves", async () => {
    const world = await scannedWorld()
    const changed = zoomiesWorkbook()
    changed[changed.length - 1] ^= 0xff // any different bytes: the hash no longer matches
    const wrong = fakeFolder([{ id: "file-zoomies", name: "SMD.ZOOMIES.xlsx", bytes: changed, modifiedAt: T(10) }], { kind: "drive" })

    const refused = await approve.approveFolderProposal(input(world.proposalId, { acknowledgeQuestions: true }), depsFor(OWNER, wrong.source))
    expect(refused).toEqual({ ok: false, reason: "file_changed" })
    expect(await figures()).toEqual({ projects: 0, boqs: 0, lines: 0, total: 0 })
    expect(await count("submissions", "status = 'in_progress' and selected_chain->>'claimedAt' is null")).toBe(1)

    const made = await approve.approveFolderProposal(input(world.proposalId, { acknowledgeQuestions: true }), depsFor(OWNER, world.folder.source))
    expect(made).toMatchObject({ ok: true })
    expect((await figures()).projects).toBe(1)
  })

  test("a source that is not connected, or that cannot hand the file over, makes nothing and leaves the proposal pending", async () => {
    const world = await scannedWorld()
    const notConnected = await approve.approveFolderProposal(input(world.proposalId), depsFor(OWNER, new ServiceError("no active connection", 400)))
    expect(notConnected).toEqual({ ok: false, reason: "not_connected" })
    const unavailable = await approve.approveFolderProposal(input(world.proposalId), depsFor(OWNER, new FolderSourceError("source_read_failed", "refused")))
    expect(unavailable).toEqual({ ok: false, reason: "source_unavailable", code: "source_read_failed" })
    expect(await figures()).toEqual({ projects: 0, boqs: 0, lines: 0, total: 0 })
    expect(await count("submissions", "status = 'in_progress' and selected_chain->>'claimedAt' is null")).toBe(1)
  })

  test("open questions: without acknowledgeQuestions nothing is made and the proposal stays pending; with it the project is made with no second model call", async () => {
    const world = await scannedWorld()
    const held = await approve.approveFolderProposal(input(world.proposalId), depsFor(OWNER, world.folder.source))
    expect(held).toMatchObject({ ok: false, reason: "needs_answers" })
    if (!held.ok && held.reason === "needs_answers") expect(held.questions.length).toBeGreaterThan(0)
    expect(await figures()).toEqual({ projects: 0, boqs: 0, lines: 0, total: 0 })
    expect(await count("submissions", "status = 'in_progress' and selected_chain->>'claimedAt' is null")).toBe(1)

    const made = await approve.approveFolderProposal(input(world.proposalId, { acknowledgeQuestions: true }), depsFor(OWNER, world.folder.source))
    expect(made).toMatchObject({ ok: true })
    expect(await figures()).toEqual({ projects: 1, boqs: 1, lines: 53, total: TOTAL })
    expect(modelCalls).toBe(1)
  })

  test("one approval per proposal: a second is already_decided, and two overlapping approvals make ONE project", async () => {
    const world = await scannedWorld()
    const [a, b] = await Promise.all([
      approve.approveFolderProposal(input(world.proposalId, { acknowledgeQuestions: true }), depsFor(OWNER, world.folder.source)),
      approve.approveFolderProposal(input(world.proposalId, { acknowledgeQuestions: true }), depsFor(OWNER, world.folder.source)),
    ])
    const okCount = [a, b].filter((o) => o.ok).length
    expect(okCount).toBe(1)
    const lost = [a, b].find((o) => !o.ok)
    expect(lost).toMatchObject({ ok: false })
    expect(["in_progress", "already_decided"]).toContain((lost as { reason: string }).reason)
    expect((await figures()).projects).toBe(1)

    const again = await approve.approveFolderProposal(input(world.proposalId, { acknowledgeQuestions: true }), depsFor(OWNER, world.folder.source))
    expect(again).toMatchObject({ ok: false, reason: "already_decided", status: "done" })
    expect((await figures()).projects).toBe(1)
  })
})
