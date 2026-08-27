/// <reference types="bun-types" />
// platform.crr_spec CRR-078. @/lib/db/tenant-scoped is mocked (mock.module)
// as an in-memory single-org store -- same "never touch a live DB from a
// .test.ts file" discipline task-register-service.test.ts and roster-
// overrides.test.ts already established for this codebase's DB
// dependencies (see task-register-service.test.ts's own header). @/lib/db
// itself is left real (unmocked) so `sourceObject`'s actual Drizzle column
// objects are used in the `eq(...)`/`and(...)`/`isNull(...)` calls inside
// capture.ts -- only the connection layer (withTenantContext) is faked.
//
// The storage client is passed via createSourceObject's second `deps`
// argument (a fake call-counting object, typed as capture.ts's own exported
// SourceObjectStorageClient), deliberately NOT via
// mock.module("@supabase/supabase-js", ...) -- that module is imported
// unmocked, for real, by other unrelated test files (org-branding-
// service.test.ts's real getPublicUrl() calls), and Bun's mock.module
// leaks a mocked module across every test FILE in one `bun test` run, not
// just within this one. An earlier version of this file globally mocked
// "@supabase/supabase-js" and broke org-branding-service.test.ts in CI even
// though that file never imports capture.ts or capture.test.ts -- see
// capture.ts's own createSourceObject doc comment for the same note.
//
// The live-DB half of this point's proof (the partial unique index
// `source_object_org_sha256_unique` actually enforcing the dedup contract
// this file's mock re-implements in memory) is verified separately, directly
// against the real compliance.source_object table via a rolled-back
// transaction -- see CRR-078's evidence in platform.crr_spec for that
// query and its result.
import { createHash } from "node:crypto"
import { describe, expect, test, mock, afterEach, beforeEach } from "bun:test"
import type { SourceObjectStorageClient } from "./capture"

type StoredRow = { id: string; orgId: string; sha256: string; deletedAt: null }

let rows: StoredRow[] = []
let nextId = 0
let uploadCalls: { path: string; bytesLength: number }[] = []
let uploadShouldFail = false
// capture.ts's WHERE clause is a real Drizzle `and(eq(...), eq(...), isNull(...))`
// SQL object, not introspectable here without reimplementing Drizzle's
// builder -- so the fake .where().limit() below reads this instead, set by
// recordWhere() right before each createSourceObject() call using the exact
// same sha256 algorithm capture.ts itself uses.
let lastWhereArgs: { orgId?: string; sha256?: string } = {}

function resetFakes() {
  rows = []
  nextId = 0
  uploadCalls = []
  uploadShouldFail = false
  lastWhereArgs = {}
}

function recordWhere(orgId: string, bytes: Uint8Array) {
  lastWhereArgs = { orgId, sha256: createHash("sha256").update(bytes).digest("hex") }
}

// Fake of the subset of the real @supabase/supabase-js client capture.ts
// actually calls (.storage.from(bucket).upload(path, bytes, opts)), typed
// against capture.ts's own exported SourceObjectStorageClient so this stays
// in sync with what the real function actually needs -- no `any`. Passed
// via createSourceObject's `deps.storageClient` -- see this file's header
// for why this is dependency injection, not mock.module().
function makeFakeStorageClient(): SourceObjectStorageClient {
  return {
    storage: {
      from: (_bucket: string) => ({
        upload: async (path: string, bytes: Uint8Array) => {
          uploadCalls.push({ path, bytesLength: bytes.byteLength })
          if (uploadShouldFail) return { error: { message: "simulated upload failure" } }
          return { error: null }
        },
      }),
    },
  }
}

// Fake of the subset of the Drizzle query builder capture.ts actually calls:
// .select({..}).from(sourceObject).where(cond).limit(1), and
// .insert(sourceObject).values(v).onConflictDoNothing({...}).returning({..}).
// Both read/write the same `rows` array, so a SELECT after an INSERT within
// one test sees what that INSERT just committed -- mirroring the real
// partial unique index's behavior in memory.
function makeTx() {
  return {
    select(_sel?: unknown) {
      return {
        from(_table?: unknown) {
          return {
            where(_cond?: unknown) {
              return {
                limit: async (_n: number) => {
                  const match = rows.find((r) => r.orgId === lastWhereArgs.orgId && r.sha256 === lastWhereArgs.sha256)
                  return match ? [{ id: match.id }] : []
                },
              }
            },
          }
        },
      }
    },
    insert(_table?: unknown) {
      return {
        values(v: Record<string, unknown>) {
          return {
            onConflictDoNothing(_cfg?: unknown) {
              return {
                async returning(_sel?: unknown) {
                  const orgId = v.orgId as string
                  const sha256 = v.sha256 as string
                  const conflict = rows.find((r) => r.orgId === orgId && r.sha256 === sha256)
                  if (conflict) return []
                  const id = `fake-id-${nextId++}`
                  rows.push({ id, orgId, sha256, deletedAt: null })
                  return [{ id }]
                },
              }
            },
          }
        },
      }
    },
  }
}

beforeEach(() => {
  resetFakes()
  mock.module("@/lib/db/tenant-scoped", () => ({
    withTenantContext: async (_context: { orgId: string }, fn: (tx: unknown) => Promise<unknown>) => fn(makeTx()),
  }))
})

afterEach(() => {
  mock.restore()
})

describe("createSourceObject", () => {
  test("captures a new artefact: uploads once and returns an id", async () => {
    const { createSourceObject } = await import("./capture")
    const bytes = new TextEncoder().encode("hello world")
    recordWhere("org_1", bytes)

    const id = await createSourceObject(
      { orgId: "org_1", origin: "upload", bytes, title: "hello.txt", mimeType: "text/plain" },
      { storageClient: makeFakeStorageClient() }
    )

    expect(typeof id).toBe("string")
    expect(id.length).toBeGreaterThan(0)
    expect(uploadCalls.length).toBe(1)
    expect(uploadCalls[0].bytesLength).toBe(bytes.byteLength)
  })

  test("dedup contract: identical bytes captured twice for one org returns the SAME id and does not re-upload", async () => {
    const { createSourceObject } = await import("./capture")
    const bytes = new TextEncoder().encode("identical content, captured twice")
    const storageClient = makeFakeStorageClient()
    recordWhere("org_dedup", bytes)

    const firstId = await createSourceObject({ orgId: "org_dedup", origin: "upload", bytes, title: "a.txt" }, { storageClient })
    expect(uploadCalls.length).toBe(1)

    const secondId = await createSourceObject(
      { orgId: "org_dedup", origin: "connector", bytes, title: "a-again.txt" },
      { storageClient }
    )

    expect(secondId).toBe(firstId)
    // The point's own gate_pass: "yields one source_object row" -- exactly
    // one row exists in the fake store for this org.
    expect(rows.filter((r) => r.orgId === "org_dedup").length).toBe(1)
    // And the point's own gate_pass: "one storage object" -- the second
    // capture never touched storage at all (pre-check SELECT short-circuits
    // before upload runs, per this file's header / capture.ts's header).
    expect(uploadCalls.length).toBe(1)
  })

  test("different bytes for the same org are NOT deduped -- two rows, two uploads", async () => {
    const { createSourceObject } = await import("./capture")
    const storageClient = makeFakeStorageClient()
    const bytesA = new TextEncoder().encode("content A")
    const bytesB = new TextEncoder().encode("content B, totally different")

    recordWhere("org_multi", bytesA)
    const idA = await createSourceObject({ orgId: "org_multi", origin: "upload", bytes: bytesA, title: "a.txt" }, { storageClient })

    recordWhere("org_multi", bytesB)
    const idB = await createSourceObject({ orgId: "org_multi", origin: "upload", bytes: bytesB, title: "b.txt" }, { storageClient })

    expect(idA).not.toBe(idB)
    expect(uploadCalls.length).toBe(2)
    expect(rows.filter((r) => r.orgId === "org_multi").length).toBe(2)
  })

  test("the same bytes in two different orgs are NOT deduped across tenants", async () => {
    const { createSourceObject } = await import("./capture")
    const storageClient = makeFakeStorageClient()
    const bytes = new TextEncoder().encode("shared content, different orgs")

    recordWhere("org_a", bytes)
    const idA = await createSourceObject({ orgId: "org_a", origin: "upload", bytes, title: "shared.txt" }, { storageClient })

    recordWhere("org_b", bytes)
    const idB = await createSourceObject({ orgId: "org_b", origin: "upload", bytes, title: "shared.txt" }, { storageClient })

    expect(idA).not.toBe(idB)
    expect(uploadCalls.length).toBe(2)
  })

  test("a failed storage upload throws and never reaches the insert (no row created)", async () => {
    const { createSourceObject } = await import("./capture")
    uploadShouldFail = true
    const bytes = new TextEncoder().encode("this upload will fail")
    recordWhere("org_fail", bytes)

    await expect(
      createSourceObject({ orgId: "org_fail", origin: "upload", bytes, title: "x.txt" }, { storageClient: makeFakeStorageClient() })
    ).rejects.toThrow(/storage upload failed/)
    expect(rows.filter((r) => r.orgId === "org_fail").length).toBe(0)
  })

  test("passes org/client/origin/link/business-object-type fields straight through to the insert", async () => {
    let capturedValues: Record<string, unknown> | undefined
    mock.module("@/lib/db/tenant-scoped", () => ({
      withTenantContext: async (_ctx: unknown, fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }),
          insert: () => ({
            values: (v: Record<string, unknown>) => {
              capturedValues = v
              return {
                onConflictDoNothing: () => ({
                  returning: async () => [{ id: "captured-fields-id" }],
                }),
              }
            },
          }),
        }
        return fn(tx)
      },
    }))
    const { createSourceObject } = await import("./capture")
    const bytes = new TextEncoder().encode("field passthrough check")

    const id = await createSourceObject(
      {
        orgId: "org_fields",
        clientId: "client_9",
        origin: "email",
        bytes,
        title: "invoice.pdf",
        mimeType: "application/pdf",
        linkedEntityType: "compliance_item",
        linkedEntityId: "ci_42",
        businessObjectType: "invoice",
        createdById: "user_7",
      },
      { storageClient: makeFakeStorageClient() }
    )

    expect(id).toBe("captured-fields-id")
    expect(capturedValues).toBeDefined()
    expect(capturedValues!.orgId).toBe("org_fields")
    expect(capturedValues!.clientId).toBe("client_9")
    expect(capturedValues!.origin).toBe("email")
    expect(capturedValues!.mimeType).toBe("application/pdf")
    expect(capturedValues!.title).toBe("invoice.pdf")
    expect(capturedValues!.linkedEntityType).toBe("compliance_item")
    expect(capturedValues!.linkedEntityId).toBe("ci_42")
    expect(capturedValues!.businessObjectType).toBe("invoice")
    expect(capturedValues!.createdById).toBe("user_7")
    expect(capturedValues!.byteSize).toBe(bytes.byteLength)
    // what_not_to_do / DB default reliance: extract_status is never set by
    // this function -- the column's own DB default ('PENDING') is what puts
    // every captured row in PENDING, so a future default change only has to
    // happen in one place (the migration), not here too.
    expect(capturedValues!.extractStatus).toBeUndefined()
    // docUid is birth-assigned by this function itself (the column has no
    // DB-side default -- see schema.ts) and must be a non-empty id.
    expect(typeof capturedValues!.docUid).toBe("string")
    expect((capturedValues!.docUid as string).length).toBeGreaterThan(0)
    // CRR-223: storage_path is derived from doc_uid, not the file name --
    // the same docUid value written to the row must appear in the path
    // that was actually uploaded to, and the (sanitized) title must NOT.
    const docUid = capturedValues!.docUid as string
    expect(capturedValues!.storagePath).toBe(`org_fields/${docUid}`)
    expect(capturedValues!.storagePath).toContain(docUid)
    expect(capturedValues!.storagePath as string).not.toContain("invoice")
  })

  test("CRR-223: storage path is derived from doc_uid, never from the file name -- renaming the title changes nothing about where the object lives", async () => {
    const { createSourceObject } = await import("./capture")
    const storageClient = makeFakeStorageClient()
    const bytesA = new TextEncoder().encode("crr-223 path content A")
    const bytesB = new TextEncoder().encode("crr-223 path content B")

    recordWhere("org_path", bytesA)
    await createSourceObject(
      { orgId: "org_path", origin: "upload", bytes: bytesA, title: "Very Original Name.pdf" },
      { storageClient }
    )
    recordWhere("org_path", bytesB)
    await createSourceObject(
      { orgId: "org_path", origin: "upload", bytes: bytesB, title: "Renamed After The Fact.pdf" },
      { storageClient }
    )

    expect(uploadCalls.length).toBe(2)
    for (const call of uploadCalls) {
      // Path shape is exactly `${orgId}/${docUid}` -- no file name segment
      // at all, sanitized or otherwise.
      expect(call.path.startsWith("org_path/")).toBe(true)
      expect(call.path).not.toContain("Very Original Name")
      expect(call.path).not.toContain("Renamed After The Fact")
      expect(call.path).not.toContain(".pdf")
      expect(call.path).not.toContain("untitled")
    }
    // The two objects still land at different paths (different doc_uids),
    // proving the path is real per-document identity, not a constant.
    expect(uploadCalls[0].path).not.toBe(uploadCalls[1].path)
  })
})
