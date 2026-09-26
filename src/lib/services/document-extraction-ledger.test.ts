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

  test("two organisations that each hold a project for the same bytes each get their own project back, and an unattached claim of one is not the other's project", async () => {
    const hash = "7".repeat(64)
    const a = (await claim(ORG, hash)) as { claimId: string }
    await attach(a.claimId, "project-of-org-a")
    const b = (await claim(OTHER_ORG, hash)) as { kind: string; claimId: string }
    expect(b.kind).toBe("claimed")
    // B has claimed the bytes but not yet attached a project: A's project must not be returned to B.
    expect(await claim(OTHER_ORG, hash)).toEqual({ kind: "in_progress" })
    await attach(b.claimId, "project-of-org-b")
    expect(await claim(ORG, hash)).toEqual({ kind: "duplicate", projectId: "project-of-org-a" })
    expect(await claim(OTHER_ORG, hash)).toEqual({ kind: "duplicate", projectId: "project-of-org-b" })
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

// The ledger rows are the per-organisation rate limit: one new claim is one extraction attempt, a released attempt stays in the table
// (soft-deleted) and still counts unless it was released before any model call (modelCalled false, marked no_model_call), and a
// submit that inserts nothing (duplicate, in_progress) or is refused is never counted.
describe("the per-organisation rate limit", () => {
  let orgCounter = 0
  const freshOrg = () => `org-ledger-rate-${++orgCounter}`

  /** n attempts of an organisation `ageMinutes` old: half of them released (soft-deleted), like failed extractions. */
  const seedAttempts = (orgId: string, n: number, ageMinutes: number, originRef: string | null = "projexa-from-document:v1") =>
    sql(
      `insert into compliance.source_object (id, org_id, origin, origin_ref, sha256, doc_uid, extract_status, created_at, deleted_at)
       select $1::text || '-' || g, $1::text, 'upload', $3::text, $1::text || '-key-' || g, $1::text || '-doc-' || g, 'SKIPPED_UNSUPPORTED',
              now() - ($2 * interval '1 minute'), case when g % 2 = 0 then now() else null end
       from generate_series(1, ${Number(n)}) g`,
      [orgId, ageMinutes, originRef],
    )
  const attemptRows = async (orgId: string) => Number((await sql("select count(*)::int as n from compliance.source_object where org_id = $1", [orgId]))[0].n)

  test("the attempt after maxClaims inside the window is rate_limited with the wait for the oldest one to leave; it inserts nothing, and refusals do not lengthen the block", async () => {
    const { maxClaims, windowSeconds } = svc.LEDGER_RATE_LIMIT
    const org = freshOrg()
    await seedAttempts(org, maxClaims, 10)
    const refused = await claim(org, "8".repeat(64))
    expect(refused.kind).toBe("rate_limited")
    const wait = (refused as { retryAfterSeconds: number }).retryAfterSeconds
    expect(wait).toBeGreaterThan(windowSeconds - 10 * 60 - 10)
    expect(wait).toBeLessThanOrEqual(windowSeconds - 10 * 60)
    expect(await attemptRows(org)).toBe(maxClaims)
    for (let i = 0; i < 3; i++) expect((await claim(org, "8".repeat(64))).kind).toBe("rate_limited")
    expect(await attemptRows(org)).toBe(maxClaims)
  })

  test("the last attempt under the limit is still claimed, and the next one is refused", async () => {
    const { maxClaims } = svc.LEDGER_RATE_LIMIT
    const org = freshOrg()
    await seedAttempts(org, maxClaims - 1, 5)
    expect((await claim(org, "9".repeat(64))).kind).toBe("claimed")
    expect((await claim(org, "a1".repeat(32))).kind).toBe("rate_limited")
  })

  test("attempts older than the window do not count", async () => {
    const { maxClaims, windowSeconds } = svc.LEDGER_RATE_LIMIT
    const org = freshOrg()
    await seedAttempts(org, maxClaims, windowSeconds / 60 + 1)
    expect((await claim(org, "a2".repeat(32))).kind).toBe("claimed")
  })

  test("another organisation's attempts do not count, and rows of a real document capture (another origin_ref) do not count", async () => {
    const { maxClaims } = svc.LEDGER_RATE_LIMIT
    const busy = freshOrg()
    await seedAttempts(busy, maxClaims, 1)
    expect((await claim(freshOrg(), "a3".repeat(32))).kind).toBe("claimed")
    const capturing = freshOrg()
    await seedAttempts(capturing, maxClaims, 1, null)
    expect((await claim(capturing, "a4".repeat(32))).kind).toBe("claimed")
  })

  test("a file that already has a project, or is being processed, is answered even over the limit: nothing is inserted, so nothing is refused", async () => {
    const { maxClaims } = svc.LEDGER_RATE_LIMIT
    const org = freshOrg()
    const done = (await claim(org, "a5".repeat(32))) as { claimId: string }
    await h.withTenantContextDouble({ orgId: org }, (db) => svc.attachProjectSourceWithDb(db, done.claimId, "project-done"))
    expect((await claim(org, "a6".repeat(32))).kind).toBe("claimed") // left unattached: in progress
    await seedAttempts(org, maxClaims, 1)
    expect(await claim(org, "a5".repeat(32))).toEqual({ kind: "duplicate", projectId: "project-done" })
    expect(await claim(org, "a6".repeat(32))).toEqual({ kind: "in_progress" })
    expect((await claim(org, "a7".repeat(32))).kind).toBe("rate_limited")
  })

  test("a claim released after a failed extraction that may have reached a model still counts as an attempt (release with no options)", async () => {
    const { maxClaims } = svc.LEDGER_RATE_LIMIT
    const org = freshOrg()
    for (let i = 0; i < maxClaims; i++) {
      const c = (await claim(org, String(i).padStart(2, "0").repeat(32))) as { kind: string; claimId: string }
      expect(c.kind).toBe("claimed")
      await h.withTenantContextDouble({ orgId: org }, (db) => svc.releaseProjectSourceWithDb(db, c.claimId))
    }
    expect(await sql("select id from compliance.source_object where org_id = $1 and deleted_at is null", [org])).toEqual([])
    expect((await claim(org, "a8".repeat(32))).kind).toBe("rate_limited")
  })

  const releaseNotCounted = (orgId: string, claimId: string) =>
    h.withTenantContextDouble({ orgId }, (db) => svc.releaseProjectSourceWithDb(db, claimId, { modelCalled: false }))

  test("a claim released before any model call is marked and does not count: 2 x maxClaims such attempts in a row, and the next claim is still claimed", async () => {
    const { maxClaims } = svc.LEDGER_RATE_LIMIT
    const org = freshOrg()
    for (let i = 0; i < maxClaims * 2; i++) {
      const c = (await claim(org, `${String(i).padStart(3, "0")}`.repeat(21) + "0")) as { kind: string; claimId: string }
      expect(c.kind).toBe("claimed")
      await releaseNotCounted(org, c.claimId)
    }
    const released = await sql("select extract_error, deleted_at is not null as freed from compliance.source_object where org_id = $1", [org])
    expect(released).toHaveLength(maxClaims * 2)
    expect(released.every((r) => r.extract_error === svc.LEDGER_NO_MODEL_CALL_MARK && r.freed === true)).toBe(true)
    expect(svc.LEDGER_NO_MODEL_CALL_MARK).toBe("no_model_call")
    expect((await claim(org, "b1".repeat(32))).kind).toBe("claimed")
  })

  test("only attempts that may have reached a model count: maxClaims - 1 of them, then any number that did not, leave room for exactly one more claim", async () => {
    const { maxClaims } = svc.LEDGER_RATE_LIMIT
    const org = freshOrg()
    for (let i = 0; i < maxClaims - 1; i++) {
      const c = (await claim(org, `1${String(i).padStart(2, "0")}`.repeat(21) + "0")) as { claimId: string }
      await h.withTenantContextDouble({ orgId: org }, (db) => svc.releaseProjectSourceWithDb(db, c.claimId, { modelCalled: true }))
    }
    for (let i = 0; i < 5; i++) {
      const c = (await claim(org, `2${String(i).padStart(2, "0")}`.repeat(21) + "0")) as { claimId: string }
      await releaseNotCounted(org, c.claimId)
    }
    expect((await claim(org, "b2".repeat(32))).kind).toBe("claimed")
    expect((await claim(org, "b3".repeat(32))).kind).toBe("rate_limited")
  })

  test("a marked claim is also left out of the wait: it is measured from the oldest attempt that counts", async () => {
    const { maxClaims, windowSeconds } = svc.LEDGER_RATE_LIMIT
    const org = freshOrg()
    // One attempt 50 minutes old that did not reach a model (marked), then maxClaims counted attempts 5 minutes old.
    await seedAttempts(org, 1, 50)
    await sql("update compliance.source_object set extract_error = $2, deleted_at = now() where org_id = $1", [org, svc.LEDGER_NO_MODEL_CALL_MARK])
    await sql(
      `insert into compliance.source_object (id, org_id, origin, origin_ref, sha256, doc_uid, extract_status, created_at)
       select 'counted-' || $1::text || '-' || g, $1::text, 'upload', 'projexa-from-document:v1', 'counted-key-' || $1::text || '-' || g, 'counted-doc-' || $1::text || '-' || g, 'SKIPPED_UNSUPPORTED', now() - interval '5 minutes'
       from generate_series(1, ${Number(maxClaims)}) g`,
      [org],
    )
    const refused = await claim(org, "b4".repeat(32))
    expect(refused.kind).toBe("rate_limited")
    const wait = (refused as { retryAfterSeconds: number }).retryAfterSeconds
    // The oldest COUNTED attempt is 5 minutes old, so the wait is about windowSeconds - 5 minutes, not windowSeconds - 50 minutes.
    expect(wait).toBeGreaterThan(windowSeconds - 5 * 60 - 10)
    expect(wait).toBeLessThanOrEqual(windowSeconds - 5 * 60)
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
