/// <reference types="bun-types" />
// PROJEXA-BUILD-002 WP-02: the ledger row as the JOB RECORD of a "create a project from a workbook" request, on PGlite (real Postgres
// in process; only withTenantContext's connection is replaced). States: received, reading, needs_answers, ready, created, rejected.
//
// WHAT IS PROVEN
//   1. jobViewFromRow (pure): how a row reads, including a row written before job_state existed.
//   2. The ledger on real SQL: the claim sets received; a parked job (needs_answers, ready) is a `resume` claim for the same
//      organisation and file, never for another organisation; a running claim is taken over after 15 minutes, a parked one only
//      after 7 days (from when it was parked, not from when it was claimed); a refusal releases the row WITH its reason and the row
//      stays readable; the CHECK refuses a state outside the six; a released row is not changed by a late setState.
//   3. The service on that ledger: a job with questions waits (0 projects) and is finished by a second submit with no second model
//      call; mode prepare parks in ready; a refused job (a shortfall) is rejected with its code and can be sent again; a job read
//      between start and run is `received`, and `created` after it, which is what the route's ?async=1 does.
//
// Run: bun test --isolate src/lib/services/document-extraction-job.test.ts
import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test"
import * as realTenantScoped from "@/lib/db/tenant-scoped"
import { createExtractionPglite, insertProduct, insertUser } from "./__test-helpers__/document-extraction-pglite"
import { buildWorkbook, deterministicModel, edgeCallerFor, edgeDeps } from "./__test-helpers__/document-extraction-fixtures"
import { carefulHumanModel } from "./__test-helpers__/zoomies-standin-model"
import { zoomiesWorkbook } from "./__test-helpers__/zoomies-workbook"
import type { ModelCall } from "../../../supabase/functions/projexa-document-extract/handler"
import { ExtractionRejectedError } from "./document-extraction-schema"

const ORG = "org-job"
const OTHER_ORG = "org-other"
const PRODUCT = "product-construction"
const ACTOR = "user-1"
const HASH = "ab".repeat(32)

let h: Awaited<ReturnType<typeof createExtractionPglite>>
let depth = 0
// Two requests in flight together overlap without nesting; the double cannot tell them apart, so a test that races two says so.
let allowOverlap = false
async function tenantDouble<T>(_ctx: unknown, fn: (tx: never) => Promise<T>): Promise<T> {
  if (depth > 0 && !allowOverlap) throw new Error("nested withTenantContext (the real one refuses this too)")
  depth++
  try {
    return await h.db.transaction((tx) => fn(tx as never))
  } finally {
    depth--
  }
}

type Svc = typeof import("./document-extraction-service")
let svc: Svc
let createProject: typeof import("@/lib/services/construction-dashboard-service").createProject
let createBoq: typeof import("@/lib/services/construction-boq-service").createBoq

beforeAll(async () => {
  h = await createExtractionPglite()
  await insertProduct(h, { id: PRODUCT, org_id: ORG })
  await insertUser(h, { id: ACTOR, org_id: ORG })
  mock.module("@/lib/db/tenant-scoped", () => ({ ...realTenantScoped, withTenantContext: tenantDouble }))
  svc = await import("./document-extraction-service")
  createProject = (await import("@/lib/services/construction-dashboard-service")).createProject
  createBoq = (await import("@/lib/services/construction-boq-service")).createBoq
}, 60_000)

afterAll(async () => {
  await h.pg.close()
})

beforeEach(async () => {
  await h.pg.exec("truncate compliance.projects, compliance.construction_boqs, compliance.construction_boq_line_items, compliance.source_object")
  depth = 0
  allowOverlap = false
})

type Row = Record<string, unknown>
const rows = async (sql: string, params: unknown[] = []): Promise<Row[]> => (await h.pg.query(sql, params)).rows as Row[]
const ledgerRows = () => rows("select id, org_id, job_state, job_result, linked_entity_id, deleted_at, extract_error from compliance.source_object order by created_at, id")
const ledger = (org = ORG) => svc.createDbProjectSourceLedger({ orgId: org, actorId: ACTOR })
const claim = (org = ORG, hash = HASH, fileName = "a.xlsx") => ledger(org).claim({ contentSha256: hash, fileName, byteSize: 10 })
const count = async (table: string) => Number((await rows(`select count(*)::int as n from compliance.${table}`))[0].n)
const jobOf = (jobId: string, org = ORG) => svc.getProjectSourceJob({ orgId: org, actorId: ACTOR }, { jobId })

// ------------------------------------------------------------------------------------------------------------ 1. pure

describe("jobViewFromRow", () => {
  const base = { id: "j1", jobState: null as string | null, linkedEntityId: null as string | null, jobResult: null as unknown, displayName: "a.xlsx", deletedAt: null as Date | null, updatedAt: new Date("2026-09-26T10:00:00Z") }

  test("a row written before job_state existed reads as created (has a project), rejected (released) or received", () => {
    expect(svc.jobViewFromRow({ ...base, linkedEntityId: "p1" })).toMatchObject({ state: "created", projectId: "p1" })
    expect(svc.jobViewFromRow({ ...base, deletedAt: new Date() })).toMatchObject({ state: "rejected", projectId: null, error: null })
    expect(svc.jobViewFromRow(base)).toMatchObject({ state: "received", projectId: null, questions: [], reconciliation: null, stats: null })
  })

  test("a parked job shows its questions, reconciliation and stats but not its lines", () => {
    const stored = {
      v: 1,
      extracted: { lines: "many" },
      questions: [{ kind: "no_rate", sheet: "S", row: 4, text: "t" }],
      reconciliation: { status: "matched", expected: 10, actual: 10, difference: 0, tolerance: 1, source: "reader", byArea: [] },
      stats: { sheets: 22, rows: 300, lines: 53 },
      source: "model+reader",
    }
    const view = svc.jobViewFromRow({ ...base, jobState: "needs_answers", jobResult: stored })
    expect(view).toMatchObject({ jobId: "j1", state: "needs_answers", fileName: "a.xlsx", questions: stored.questions, reconciliation: stored.reconciliation, stats: stored.stats, updatedAt: "2026-09-26T10:00:00.000Z" })
    expect(JSON.stringify(view)).not.toContain("many")
  })

  test("a refused job shows its code, message and issues", () => {
    const view = svc.jobViewFromRow({ ...base, jobState: "rejected", deletedAt: new Date(), jobResult: { code: "extraction_total_mismatch", message: "m", issues: ["i"] } })
    expect(view).toMatchObject({ state: "rejected", error: { code: "extraction_total_mismatch", message: "m", issues: ["i"] } })
  })

  test("a created job shows its project, from the link or from the stored result", () => {
    expect(svc.jobViewFromRow({ ...base, jobState: "created", linkedEntityId: "p9", jobResult: { projectId: "p9", stats: { sheets: 1, rows: 2, lines: 3 } } })).toMatchObject({ state: "created", projectId: "p9", stats: { sheets: 1, rows: 2, lines: 3 } })
    expect(svc.jobViewFromRow({ ...base, jobState: "rejected", jobResult: { code: "boq_create_failed", message: "m", projectId: "p7" } })).toMatchObject({ state: "rejected", projectId: "p7", error: { code: "boq_create_failed" } })
  })
})

// ------------------------------------------------------------------------------------------------------- 2. the ledger

describe("the ledger on real SQL", () => {
  test("a claim is received; a parked job is a resume claim for the same organisation and file, and only for it", async () => {
    const first = await claim()
    expect(first.kind).toBe("claimed")
    const id = (first as { claimId: string }).claimId
    expect((await ledgerRows())[0]).toMatchObject({ id, job_state: "received", job_result: null, linked_entity_id: null })
    expect(await claim()).toEqual({ kind: "in_progress" })

    await ledger().setState(id, "reading")
    expect((await ledgerRows())[0].job_state).toBe("reading")
    expect(await claim()).toEqual({ kind: "in_progress" })

    const stored = { v: 1, questions: [{ kind: "no_rate", sheet: "S", row: 4, text: "t" }] }
    await ledger().setState(id, "needs_answers", stored)
    expect(await claim()).toEqual({ kind: "resume", claimId: id, state: "needs_answers", result: stored })
    await ledger().setState(id, "ready", stored)
    expect(await claim()).toEqual({ kind: "resume", claimId: id, state: "ready", result: stored })
    // Another organisation with the same file has its own claim.
    expect((await claim(OTHER_ORG)).kind).toBe("claimed")
    expect((await ledgerRows()).length).toBe(2)
  })

  test("a running claim is taken over after 15 minutes; a parked one after 7 days from when it was parked", async () => {
    const running = (await claim()) as { claimId: string }
    await h.pg.query("update compliance.source_object set created_at = now() - interval '16 minutes' where id = $1", [running.claimId])
    const takenOver = await claim()
    expect(takenOver.kind).toBe("claimed")
    expect((takenOver as { claimId: string }).claimId).not.toBe(running.claimId)
    expect((await ledgerRows()).find((r) => r.id === running.claimId)!.deleted_at).not.toBeNull()

    // Parked long ago but touched three days ago: still waiting, although created far more than 15 minutes ago.
    const parked = takenOver as { claimId: string }
    await ledger().setState(parked.claimId, "needs_answers", { v: 1 })
    await h.pg.query("update compliance.source_object set created_at = now() - interval '9 days', updated_at = now() - interval '3 days' where id = $1", [parked.claimId])
    expect((await claim()).kind).toBe("resume")
    // Parked eight days ago: free.
    await h.pg.query("update compliance.source_object set updated_at = now() - interval '8 days' where id = $1", [parked.claimId])
    const after = await claim()
    expect(after.kind).toBe("claimed")
    expect((after as { claimId: string }).claimId).not.toBe(parked.claimId)
  })

  test("a refusal releases the row with its reason: the file can be sent again, and the reason can still be read", async () => {
    const first = (await claim()) as { claimId: string }
    await ledger().release(first.claimId, { modelCalled: true, rejection: { code: "extraction_total_mismatch", message: "short", issues: ["a", "b"] } })
    const row = (await ledgerRows())[0]
    expect(row.job_state).toBe("rejected")
    expect(row.deleted_at).not.toBeNull()
    expect(row.job_result).toEqual({ code: "extraction_total_mismatch", message: "short", issues: ["a", "b"] })
    expect(await jobOf(first.claimId)).toMatchObject({ jobId: first.claimId, state: "rejected", error: { code: "extraction_total_mismatch", message: "short", issues: ["a", "b"] } })
    const again = await claim()
    expect(again.kind).toBe("claimed")
    expect((again as { claimId: string }).claimId).not.toBe(first.claimId)
    // A late state write on the released row changes nothing.
    await ledger().setState(first.claimId, "reading")
    expect((await ledgerRows()).find((r) => r.id === first.claimId)!.job_state).toBe("rejected")
    // A release without a rejection leaves the state alone (the row was received) and a modelCalled:false mark still counts nothing.
    await ledger().release((again as { claimId: string }).claimId, { modelCalled: false })
    expect((await ledgerRows()).find((r) => r.id === (again as { claimId: string }).claimId)).toMatchObject({ job_state: "received", extract_error: svc.LEDGER_NO_MODEL_CALL_MARK })
  })

  test("a parked job is taken by one call only; a job that is reading is not parked any more, and is stale after 15 minutes from when it started reading", async () => {
    const first = (await claim()) as { claimId: string }
    expect(await ledger().takeParked(first.claimId)).toBe(false)
    await ledger().setState(first.claimId, "needs_answers", { v: 1 })
    allowOverlap = true
    const [a, b] = await Promise.all([ledger().takeParked(first.claimId), ledger().takeParked(first.claimId)])
    allowOverlap = false
    expect([a, b].sort()).toEqual([false, true])
    expect((await ledgerRows())[0].job_state).toBe("reading")
    expect(await ledger().takeParked(first.claimId)).toBe(false)
    expect(await claim()).toEqual({ kind: "in_progress" })
    // A job parked for days and taken just now is not old for that: reading counts from when it started reading.
    await h.pg.query("update compliance.source_object set created_at = now() - interval '9 days' where id = $1", [first.claimId])
    expect(await claim()).toEqual({ kind: "in_progress" })
    await h.pg.query("update compliance.source_object set updated_at = now() - interval '16 minutes' where id = $1", [first.claimId])
    const taken = await claim()
    expect(taken.kind).toBe("claimed")
    expect((taken as { claimId: string }).claimId).not.toBe(first.claimId)
    // A linked or released job is never taken.
    await ledger().setState((taken as { claimId: string }).claimId, "ready", { v: 1 })
    await ledger().attach((taken as { claimId: string }).claimId, "project-z")
    expect(await ledger().takeParked((taken as { claimId: string }).claimId)).toBe(false)
  })

  test("the CHECK refuses a state outside the six", async () => {
    const first = (await claim()) as { claimId: string }
    await expect(svc.createDbProjectSourceLedger({ orgId: ORG, actorId: ACTOR }).setState(first.claimId, "done" as never)).rejects.toThrow()
    expect((await ledgerRows())[0].job_state).toBe("received")
  })

  test("a job is read by its id or by the file's hash, for its own organisation only; a created job shows its project", async () => {
    const first = (await claim()) as { claimId: string }
    await ledger().attach(first.claimId, "project-x")
    await ledger().setState(first.claimId, "created", { projectId: "project-x", boqId: "boq-x", stats: { sheets: 1, rows: 1, lines: 1 }, questions: 0 })
    expect(await jobOf(first.claimId)).toMatchObject({ state: "created", projectId: "project-x", stats: { sheets: 1, rows: 1, lines: 1 } })
    expect(await svc.getProjectSourceJob({ orgId: ORG, actorId: ACTOR }, { contentSha256: HASH })).toMatchObject({ jobId: first.claimId, state: "created" })
    expect(await jobOf(first.claimId, OTHER_ORG)).toBeNull()
    expect(await svc.getProjectSourceJob({ orgId: OTHER_ORG, actorId: ACTOR }, { contentSha256: HASH })).toBeNull()
    expect(await svc.getProjectSourceJob({ orgId: ORG, actorId: ACTOR }, {})).toBeNull()
    // A row that is not a from-document ledger row is not a job.
    await h.pg.query("insert into compliance.source_object (id, org_id, origin, sha256, extract_status, doc_uid) values ('not-a-job', $1, 'upload', 'k', 'EMBEDDED', 'd-nj')", [ORG])
    expect(await jobOf("not-a-job")).toBeNull()
  })
})

// ---------------------------------------------------------------------------------------------------- 3. the service

const input = (bytes: Uint8Array, extra: Record<string, unknown> = {}) => ({ orgId: ORG, actorId: ACTOR, productId: PRODUCT, fileName: "book.xlsx", bytes, ...extra })
const depsFor = (model: ModelCall) => {
  const caller = edgeCallerFor(edgeDeps(model))
  return { caller, deps: { callEdge: caller, ledger: ledger(), createProject, createBoq } }
}
const sha = (bytes: Uint8Array) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex")

describe("the service on the real ledger", () => {
  const zoomies = zoomiesWorkbook()

  test("a job with questions waits: 0 projects, the row is parked with the extraction; a second submit finishes it with no second model call", async () => {
    const { caller, deps } = depsFor(carefulHumanModel)
    const first = await svc.createProjectFromDocument(input(zoomies), deps)
    expect(first).toMatchObject({ duplicate: false, pending: true, state: "needs_answers" })
    expect(caller.calls.count).toBe(1)
    expect(await count("projects")).toBe(0)
    expect(await count("construction_boqs")).toBe(0)
    const parked = (await ledgerRows())[0]
    expect(parked).toMatchObject({ job_state: "needs_answers", linked_entity_id: null, deleted_at: null })
    expect((parked.job_result as { questions: unknown[]; extracted: { boq: { lineItems: unknown[] } } }).questions).toHaveLength(27)
    expect((parked.job_result as { extracted: { boq: { lineItems: unknown[] } } }).extracted.boq.lineItems).toHaveLength(53)
    expect(await svc.getProjectSourceJob({ orgId: ORG, actorId: ACTOR }, { contentSha256: sha(zoomies) })).toMatchObject({ state: "needs_answers", questions: expect.any(Array) })

    const second = await svc.createProjectFromDocument(input(zoomies, { acknowledgeQuestions: true }), deps)
    expect(second).toMatchObject({ duplicate: false })
    expect(caller.calls.count).toBe(1)
    expect(await count("projects")).toBe(1)
    expect(await count("construction_boqs")).toBe(1)
    expect(await count("construction_boq_line_items")).toBe(53)
    const done = (await ledgerRows())[0]
    expect(done).toMatchObject({ job_state: "created", deleted_at: null })
    expect(done.linked_entity_id).toBe((second as { projectId: string }).projectId)
    // A third submit is a duplicate of that project.
    expect(await svc.createProjectFromDocument(input(zoomies, { acknowledgeQuestions: true }), deps)).toEqual({ duplicate: true, projectId: (second as { projectId: string }).projectId })
    expect(caller.calls.count).toBe(1)
  })

  test("mode prepare parks a job with no question in ready, and a second submit creates it with no second model call", async () => {
    const book = buildWorkbook([{ name: "Bill", rows: [["Item", "Description", "Unit", "Qty", "Price"], ["1.01", "Floor", "m2", 10, 500]] }])
    const { caller, deps } = depsFor(deterministicModel)
    expect(await svc.createProjectFromDocument(input(book, { mode: "prepare" }), deps)).toMatchObject({ pending: true, state: "ready", questions: [] })
    expect((await ledgerRows())[0].job_state).toBe("ready")
    expect(await count("projects")).toBe(0)
    expect(await svc.createProjectFromDocument(input(book), deps)).toMatchObject({ duplicate: false })
    expect(caller.calls.count).toBe(1)
    expect((await ledgerRows())[0].job_state).toBe("created")
    expect(await count("construction_boq_line_items")).toBe(1)
  })

  test("a refused job is rejected with its code and released; the same file can be sent again and this time is created", async () => {
    const book = buildWorkbook([{ name: "Bill", rows: [["Item", "Description", "Unit", "Qty", "Price"], ["1.01", "Floor", "m2", 10, 500], ["TOTAL", "", "", "", 9000]] }])
    const short: ModelCall = async (req) => JSON.stringify({ ...JSON.parse(await deterministicModel(req)), controlTotals: { grand: 9000 } })
    const { deps } = depsFor(short)
    // 5,000 of lines against 9,000 printed: a shortfall.
    await expect(svc.createProjectFromDocument(input(book), deps)).rejects.toBeInstanceOf(ExtractionRejectedError)
    const refused = (await ledgerRows())[0]
    expect(refused).toMatchObject({ job_state: "rejected" })
    expect(refused.deleted_at).not.toBeNull()
    expect(refused.job_result).toMatchObject({ code: "extraction_total_mismatch" })
    expect(await count("projects")).toBe(0)
    expect(await svc.getProjectSourceJob({ orgId: ORG, actorId: ACTOR }, { contentSha256: sha(book) })).toMatchObject({ state: "rejected", error: { code: "extraction_total_mismatch" } })
    // The shortfall is acknowledged on the second submit: a new claim, created.
    const again = await svc.createProjectFromDocument(input(book, { acknowledgeShortfall: true }), deps)
    expect(again).toMatchObject({ duplicate: false, reconciliation: { status: "shortfall" } })
    expect(await svc.getProjectSourceJob({ orgId: ORG, actorId: ACTOR }, { contentSha256: sha(book) })).toMatchObject({ state: "created" })
  })

  test("a parked job whose shortfall was acknowledged keeps the acknowledgement: finishing it does not ask again", async () => {
    const book = buildWorkbook([{ name: "Bill", rows: [["Item", "Description", "Unit", "Qty", "Price"], ["1.01", "Floor", "m2", 10, 500], ["1.02", "No rate", "m2", 3, ""], ["TOTAL", "", "", "", 9000]] }])
    const short: ModelCall = async (req) => JSON.stringify({ ...JSON.parse(await deterministicModel(req)), controlTotals: { grand: 9000 } })
    const { caller, deps } = depsFor(short)
    const parked = await svc.createProjectFromDocument(input(book, { acknowledgeShortfall: true }), deps)
    expect(parked).toMatchObject({ pending: true, state: "needs_answers" })
    expect(((await ledgerRows())[0].job_result as { acknowledgedShortfall: boolean }).acknowledgedShortfall).toBe(true)
    // The second submit acknowledges the questions only.
    const done = await svc.createProjectFromDocument(input(book, { acknowledgeQuestions: true }), deps)
    expect(done).toMatchObject({ duplicate: false, reconciliation: { status: "shortfall" } })
    expect(caller.calls.count).toBe(1)
  })

  test("a parked job that is not acknowledged for its shortfall stays parked when a second submit forgets to (nothing is lost, nothing is created)", async () => {
    const book = buildWorkbook([{ name: "Bill", rows: [["Item", "Description", "Unit", "Qty", "Price"], ["1.01", "Floor", "m2", 10, 500], ["1.02", "No rate", "m2", 3, ""], ["TOTAL", "", "", "", 5000]] }])
    const model: ModelCall = async (req) => JSON.stringify({ ...JSON.parse(await deterministicModel(req)), controlTotals: { grand: 5000 } })
    const { deps } = depsFor(model)
    expect(await svc.createProjectFromDocument(input(book), deps)).toMatchObject({ pending: true, state: "needs_answers" })
    expect(await svc.createProjectFromDocument(input(book, { acknowledgeQuestions: true }), deps)).toMatchObject({ duplicate: false })
    expect(await count("projects")).toBe(1)
  })

  test("two submits that both saw the job parked: exactly one finishes it (one project), the other is refused as in progress", async () => {
    const { caller, deps } = depsFor(carefulHumanModel)
    await svc.createProjectFromDocument(input(zoomies), deps)
    allowOverlap = true
    const both = await Promise.allSettled([
      svc.createProjectFromDocument(input(zoomies, { acknowledgeQuestions: true }), deps),
      svc.createProjectFromDocument(input(zoomies, { acknowledgeQuestions: true }), deps),
    ])
    allowOverlap = false
    expect(both.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"])
    const refused = both.find((r) => r.status === "rejected") as PromiseRejectedResult
    expect(refused.reason).toMatchObject({ code: "duplicate_in_progress" })
    expect(await count("projects")).toBe(1)
    expect(await count("construction_boqs")).toBe(1)
    expect(caller.calls.count).toBe(1)
  })

  test("a resume that still fails the gate puts the job back in parked, unchanged: a corrected submit finishes it", async () => {
    const book = buildWorkbook([{ name: "Bill", rows: [["Item", "Description", "Unit", "Qty", "Price"], ["1.01", "Floor", "m2", 10, 500], ["1.02", "No rate", "m2", 3, ""], ["TOTAL", "", "", "", 9000]] }])
    const short: ModelCall = async (req) => JSON.stringify({ ...JSON.parse(await deterministicModel(req)), controlTotals: { grand: 9000 } })
    const { caller, deps } = depsFor(short)
    // Parked with the shortfall acknowledged, then a hand-edit of the stored result drops the acknowledgement: the gate refuses on resume.
    await svc.createProjectFromDocument(input(book, { acknowledgeShortfall: true }), deps)
    await h.pg.query("update compliance.source_object set job_result = jsonb_set(job_result, '{acknowledgedShortfall}', 'false')")
    await expect(svc.createProjectFromDocument(input(book, { acknowledgeQuestions: true }), deps)).rejects.toMatchObject({ code: "extraction_total_mismatch" })
    expect((await ledgerRows())[0]).toMatchObject({ job_state: "needs_answers", deleted_at: null, linked_entity_id: null })
    expect(await count("projects")).toBe(0)
    // The corrected submit acknowledges both.
    expect(await svc.createProjectFromDocument(input(book, { acknowledgeQuestions: true, acknowledgeShortfall: true }), deps)).toMatchObject({ duplicate: false })
    expect(caller.calls.count).toBe(1)
    expect(await count("projects")).toBe(1)
  })

  test("a resume whose project cannot be created puts the job back in parked with its extraction: the next try creates it without a model call", async () => {
    const { caller, deps } = depsFor(carefulHumanModel)
    await svc.createProjectFromDocument(input(zoomies), deps)
    let failNext = true
    const flaky = {
      ...deps,
      createProject: (async (...args: Parameters<typeof createProject>) => {
        if (failNext) {
          failNext = false
          throw new Error("database is down")
        }
        return createProject(...args)
      }) as typeof createProject,
    }
    await expect(svc.createProjectFromDocument(input(zoomies, { acknowledgeQuestions: true }), flaky)).rejects.toThrow("database is down")
    expect((await ledgerRows())[0]).toMatchObject({ job_state: "needs_answers", deleted_at: null, linked_entity_id: null })
    expect(await count("projects")).toBe(0)
    expect(await svc.createProjectFromDocument(input(zoomies, { acknowledgeQuestions: true }), flaky)).toMatchObject({ duplicate: false })
    expect(caller.calls.count).toBe(1)
    expect(await count("projects")).toBe(1)
  })

  test("started and run apart, as the route does with ?async=1: the job reads received between the two and created after", async () => {
    const book = buildWorkbook([{ name: "Bill", rows: [["Item", "Description", "Unit", "Qty", "Price"], ["1.01", "Floor", "m2", 10, 500]] }])
    const { deps } = depsFor(deterministicModel)
    const start = await svc.startExtractionJob(input(book), deps)
    expect(start.kind).toBe("claimed")
    if (start.kind !== "claimed") return
    expect(await jobOf(start.claimId)).toMatchObject({ jobId: start.claimId, state: "received", projectId: null })
    // A second submit of the same file while the job runs is refused as in progress.
    await expect(svc.startExtractionJob(input(book), deps)).rejects.toMatchObject({ code: "duplicate_in_progress" })
    const result = await svc.runExtractionJob(start, input(book), deps)
    expect(result).toMatchObject({ duplicate: false })
    expect(await jobOf(start.claimId)).toMatchObject({ state: "created", projectId: (result as { projectId: string }).projectId })
  })
})
