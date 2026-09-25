/// <reference types="bun-types" />
// PROJEXA-BUILD-001 U-37 (BR-508): the idempotency ledger of document-extraction-service.ts, run on real Postgres.
//
// WHAT IS PROVEN. "The same file twice gives the first project" rests on SQL: an insert that hits a partial unique index and does
// nothing, a select that reads the age of a claim with the database clock, and updates that free or link a row. A JavaScript fake
// would only replay this file's own idea of that SQL, so the real claim/attach/release statements run through drizzle's PGlite
// driver (in-process Postgres, see __test-helpers__/document-extraction-pglite.ts) against compliance.source_object as it is in the
// live catalog, partial unique index included. Only withTenantContext is replaced (one real transaction per call, nesting refused).
//
// Run: bun test --isolate src/lib/services/document-extraction-ledger.test.ts
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test"
import * as realTenantScoped from "@/lib/db/tenant-scoped"
import { createExtractionPglite } from "./__test-helpers__/document-extraction-pglite"

const ORG = "org-ledger-a"
const OTHER_ORG = "org-ledger-b"
const ACTOR = "person-ledger-1"
const HASH_A = "a".repeat(64)
const HASH_B = "b".repeat(64)

let h: Awaited<ReturnType<typeof createExtractionPglite>>
let svc: typeof import("./document-extraction-service")

beforeAll(async () => {
  h = await createExtractionPglite()
  mock.module("@/lib/db/tenant-scoped", () => ({ ...realTenantScoped, withTenantContext: h.withTenantContextDouble }))
  svc = await import("./document-extraction-service")
}, 60_000)

afterAll(async () => {
  await h.pg.close()
})

const sql = async (text: string, params: unknown[] = []) => (await h.pg.query(text, params)).rows as Array<Record<string, unknown>>
const claim = (orgId: string, contentSha256: string, fileName = "villa.xlsx") =>
  h.withTenantContextDouble({ orgId, userId: ACTOR }, (db) => svc.claimProjectSourceWithDb(db, { orgId, actorId: ACTOR, contentSha256, fileName, byteSize: 4096 }))
const attach = (claimId: string, projectId: string) => h.withTenantContextDouble({ orgId: ORG }, (db) => svc.attachProjectSourceWithDb(db, claimId, projectId))
const release = (claimId: string) => h.withTenantContextDouble({ orgId: ORG }, (db) => svc.releaseProjectSourceWithDb(db, claimId))
const liveRows = (orgId: string) => sql("select * from compliance.source_object where org_id = $1 and deleted_at is null", [orgId])

describe("a claim is one source_object row", () => {
  test("the first claim inserts the row the ledger notes describe: no storage path, the real hash in content_sha256, a derived key in sha256", async () => {
    const result = await claim(ORG, HASH_A, "Villa BOQ.xlsx")
    expect(result.kind).toBe("claimed")
    const rows = await liveRows(ORG)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      id: (result as { claimId: string }).claimId,
      org_id: ORG,
      origin: "upload",
      origin_ref: "projexa-from-document:v1",
      storage_path: null,
      content_sha256: HASH_A,
      title: "Villa BOQ.xlsx",
      display_name: "Villa BOQ.xlsx",
      linked_entity_type: "project",
      linked_entity_id: null,
      extract_status: "SKIPPED_UNSUPPORTED",
      created_by_id: ACTOR,
      deleted_at: null,
    })
    expect(Number(rows[0].byte_size)).toBe(4096)
    expect(rows[0].sha256).toBe(svc.projectSourceLedgerKey(HASH_A))
    expect(rows[0].sha256).not.toBe(HASH_A)
    expect(String(rows[0].doc_uid).length).toBeGreaterThan(10)
  })

  test("the catch-up worker never picks a ledger row up (it takes PENDING, EXTRACTED and CHUNKED only)", async () => {
    const stuck = await sql("select id from compliance.source_object where extract_status in ('PENDING','EXTRACTED','CHUNKED') and deleted_at is null")
    expect(stuck).toEqual([])
  })
})

describe("the same file twice", () => {
  test("while the first claim has no project the second is in_progress; after attach every later claim is a duplicate naming the first project", async () => {
    const first = await claim(ORG, HASH_B)
    expect(first.kind).toBe("claimed")
    expect(await claim(ORG, HASH_B)).toEqual({ kind: "in_progress" })
    await attach((first as { claimId: string }).claimId, "project-first")
    expect(await claim(ORG, HASH_B, "renamed copy.xlsx")).toEqual({ kind: "duplicate", projectId: "project-first" })
    expect(await claim(ORG, HASH_B)).toEqual({ kind: "duplicate", projectId: "project-first" })
    const rows = await sql("select linked_entity_type, linked_entity_id from compliance.source_object where sha256 = $1 and deleted_at is null", [svc.projectSourceLedgerKey(HASH_B)])
    expect(rows).toEqual([{ linked_entity_type: "project", linked_entity_id: "project-first" }])
  })

  test("another organisation's claim of the same bytes is its own claim", async () => {
    const result = await claim(OTHER_ORG, HASH_B)
    expect(result.kind).toBe("claimed")
    expect((await liveRows(OTHER_ORG)).length).toBe(1)
  })

  test("a different file is a different claim", async () => {
    expect((await claim(ORG, "c".repeat(64))).kind).toBe("claimed")
  })

  test("two claims for one new file at the same moment: exactly one is claimed, the other is in_progress", async () => {
    // Two transactions in flight together (the tenant-context double reads any overlap as nesting, so this test opens them on the db).
    const inTransaction = () =>
      h.db.transaction((tx) => svc.claimProjectSourceWithDb(tx as never, { orgId: ORG, actorId: ACTOR, contentSha256: "d".repeat(64), fileName: "v.xlsx", byteSize: 1 }))
    const both = await Promise.all([inTransaction(), inTransaction()])
    expect(both.map((r) => r.kind).sort()).toEqual(["claimed", "in_progress"])
    expect((await sql("select id from compliance.source_object where sha256 = $1 and deleted_at is null", [svc.projectSourceLedgerKey("d".repeat(64))])).length).toBe(1)
  })

  test("a real capture of the same bytes (a document upload) does not collide with the ledger row, and is left alone", async () => {
    const hash = "e".repeat(64)
    await sql(
      "insert into compliance.source_object (id, org_id, origin, sha256, content_sha256, doc_uid, linked_entity_type, linked_entity_id) values ('capture-1', $1, 'upload', $2, $2, 'doc-uid-capture-1', 'document', 'document-1')",
      [ORG, hash],
    )
    expect((await claim(ORG, hash)).kind).toBe("claimed")
    const capture = await sql("select linked_entity_type, linked_entity_id, deleted_at from compliance.source_object where id = 'capture-1'")
    expect(capture).toEqual([{ linked_entity_type: "document", linked_entity_id: "document-1", deleted_at: null }])
  })
})

describe("release and attach", () => {
  test("release frees the key: the same file can be claimed again, and the freed row is soft-deleted, not removed", async () => {
    const hash = "f".repeat(64)
    const first = (await claim(ORG, hash)) as { kind: "claimed"; claimId: string }
    await release(first.claimId)
    const second = await claim(ORG, hash)
    expect(second.kind).toBe("claimed")
    expect((second as { claimId: string }).claimId).not.toBe(first.claimId)
    const all = await sql("select id, deleted_at from compliance.source_object where sha256 = $1 order by created_at", [svc.projectSourceLedgerKey(hash)])
    expect(all).toHaveLength(2)
    expect(all.filter((r) => r.deleted_at === null)).toHaveLength(1)
  })

  test("release leaves a claim that already has a project alone", async () => {
    const hash = "1".repeat(64)
    const c = (await claim(ORG, hash)) as { claimId: string }
    await attach(c.claimId, "project-kept")
    await release(c.claimId)
    expect(await claim(ORG, hash)).toEqual({ kind: "duplicate", projectId: "project-kept" })
  })

  test("attach to a claim that was released is an error, not a silent success", async () => {
    const c = (await claim(ORG, "2".repeat(64))) as { claimId: string }
    await release(c.claimId)
    await expect(attach(c.claimId, "project-x")).rejects.toThrow("no longer exists")
  })
})

describe("a claim that never reached a project", () => {
  const backdate = (id: string, minutes: number) => sql("update compliance.source_object set created_at = now() - ($2 * interval '1 minute') where id = $1", [id, minutes])

  test("younger than the ttl it is in_progress; older, it is taken over: the stale row is soft-deleted and a new claim is returned", async () => {
    const hash = "3".repeat(64)
    const old = (await claim(ORG, hash)) as { claimId: string }
    await backdate(old.claimId, 5)
    expect(await claim(ORG, hash)).toEqual({ kind: "in_progress" })
    await backdate(old.claimId, svc.LEDGER_CLAIM_TTL_SECONDS / 60 + 1)
    const taken = await claim(ORG, hash)
    expect(taken.kind).toBe("claimed")
    expect((taken as { claimId: string }).claimId).not.toBe(old.claimId)
    const rows = await sql("select id, deleted_at from compliance.source_object where sha256 = $1 order by created_at", [svc.projectSourceLedgerKey(hash)])
    expect(rows.find((r) => r.id === old.claimId)!.deleted_at).not.toBeNull()
    expect(rows.filter((r) => r.deleted_at === null)).toHaveLength(1)
  })

  test("a claim with a project is never taken over, however old", async () => {
    const hash = "4".repeat(64)
    const c = (await claim(ORG, hash)) as { claimId: string }
    await attach(c.claimId, "project-old")
    await backdate(c.claimId, 60 * 24 * 30)
    expect(await claim(ORG, hash)).toEqual({ kind: "duplicate", projectId: "project-old" })
  })
})

describe("createDbProjectSourceLedger -- what the route uses", () => {
  test("each step is one tenant transaction and none is opened inside another", async () => {
    const before = h.stats.calls
    const ledger = svc.createDbProjectSourceLedger({ orgId: ORG, actorId: ACTOR })
    const c = await ledger.claim({ contentSha256: "5".repeat(64), fileName: "x.xlsx", byteSize: 10 })
    expect(c.kind).toBe("claimed")
    await ledger.attach((c as { claimId: string }).claimId, "project-via-ledger")
    expect(await ledger.claim({ contentSha256: "5".repeat(64), fileName: "x.xlsx", byteSize: 10 })).toEqual({ kind: "duplicate", projectId: "project-via-ledger" })
    const c2 = await ledger.claim({ contentSha256: "6".repeat(64), fileName: "y.xlsx", byteSize: 10 })
    await ledger.release((c2 as { claimId: string }).claimId)
    expect(h.stats.calls - before).toBe(5)
    expect(h.stats.maxDepth).toBe(1)
  })
})
