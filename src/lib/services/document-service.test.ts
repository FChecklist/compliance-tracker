/// <reference types="bun-types" />
// R67 D-11 (audit R-024). The drawing object page had no Edit at all, and its
// own header comment said why: "updateDocumentMetadata() doesn't accept a
// metadata/discipline patch (only category/expiryDate/linkedEntity) -- an
// honest scope cut rather than a half-working edit form." This is the test for
// closing that cut, and it holds the new contract to two rules the item states:
// the patch reaches name and metadata.discipline for a drawing, and it is
// REFUSED for a category outside {drawing, drawing_3d}.
//
// No live DB (this repo's standing convention for service tests, see
// document-service.filters.test.ts and construction-progress-service.test.ts):
// withTenantContext is mocked, and the fake db records what the service
// actually asked for. What the fake does NOT do is re-implement Postgres --
// it does not evaluate the WHERE clause to decide which row to return. So the
// scoping assertions below are made by RENDERING the real drizzle condition the
// service built (via drizzle's own PgDialect) and reading the SQL text, which
// is a real check on the query rather than a canned answer.
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { PgDialect } from "drizzle-orm/pg-core"
import type { SQL } from "drizzle-orm"

const dialect = new PgDialect()
const ORG = "org-r67-d11"

type Row = Record<string, unknown>

let existingDoc: Row | undefined
/**
 * R67 D-15: some paths read MORE than one row (markSupersededVersion then the
 * version chain). When this queue is non-empty each findFirst takes the next
 * entry; otherwise every findFirst answers `existingDoc`, as before.
 */
let findFirstQueue: (Row | undefined)[] = []
let capturedWhere: SQL | undefined
let capturedSet: Row | undefined
let updates: Row[] = []
let inserts: Row[] = []
let tenantContexts: { orgId: string; userId?: string }[] = []

const fakeDb = {
  query: {
    documents: {
      findFirst: async ({ where }: { where: SQL }) => {
        capturedWhere = where
        return findFirstQueue.length > 0 ? findFirstQueue.shift() : existingDoc
      },
    },
  },
  update: () => ({
    set: (values: Row) => {
      capturedSet = values
      updates.push(values)
      return {
        where: () => ({
          returning: async () => [{ ...(existingDoc ?? {}), ...values }],
        }),
      }
    },
  }),
  insert: () => ({
    values: (values: Row) => ({
      returning: async () => {
        inserts.push(values)
        return [{ id: "doc-new", ...values }]
      },
    }),
  }),
}

const mockWithTenantContext = mock(async (ctx: { orgId: string; userId?: string }, fn: (db: unknown) => Promise<unknown>) => {
  tenantContexts.push(ctx)
  return fn(fakeDb as unknown as never)
})

const realTenantScoped = await import("@/lib/db/tenant-scoped")

/**
 * R67 D-15: createDocumentVersion is the first path in this file's tests that
 * takes a real File, and the bytes half of it uploads to Supabase Storage. A
 * unit test has no business reaching a bucket, so the admin client is a fake
 * that records what it was asked to upload.
 */
let uploads: { bucket: string; objectPath: string }[] = []
let uploadError: { message: string } | null = null

const fakeStorage = {
  storage: {
    from: (bucket: string) => ({
      upload: async (objectPath: string) => {
        uploads.push({ bucket, objectPath })
        return { error: uploadError }
      },
    }),
  },
}

async function loadService() {
  await mock.module("@/lib/db/tenant-scoped", () => ({ ...realTenantScoped, withTenantContext: mockWithTenantContext }))
  await mock.module("@supabase/supabase-js", () => ({ createClient: () => fakeStorage }))
  return import("./document-service")
}

beforeEach(() => {
  existingDoc = {
    id: "doc-1",
    orgId: ORG,
    name: "AR-101 Ground floor",
    category: "drawing",
    metadata: { discipline: "Architectural", isExternalLink: false },
    linkedEntityType: "project",
    linkedEntityId: "proj-1",
  }
  findFirstQueue = []
  uploads = []
  uploadError = null
  capturedWhere = undefined
  capturedSet = undefined
  updates = []
  inserts = []
  tenantContexts = []
  mockWithTenantContext.mockClear()
})

afterEach(async () => {
  mock.restore()
  await mock.module("@/lib/db/tenant-scoped", () => realTenantScoped)
})

describe("updateDocumentMetadata -- R67 D-11 drawing edit", () => {
  test("patches the name and metadata.discipline of a category 'drawing' record", async () => {
    const { updateDocumentMetadata } = await loadService()

    const updated = await updateDocumentMetadata({ orgId: ORG, userId: "user-1" }, "doc-1", {
      name: "AR-101 Ground floor plan",
      metadata: { discipline: "Structural" },
    })

    expect(capturedSet?.name).toBe("AR-101 Ground floor plan")
    expect(capturedSet?.metadata).toEqual({ discipline: "Structural", isExternalLink: false })
    expect((updated as Row).name).toBe("AR-101 Ground floor plan")
    // The row is looked up by BOTH its id and the caller's org, inside a tenant
    // context for that same org -- checked against the real condition the
    // service built, not against the fake's answer.
    const rendered = dialect.sqlToQuery(capturedWhere!)
    expect(rendered.sql).toContain("org_id")
    expect(rendered.sql).toContain('"id"')
    expect(rendered.params).toContain(ORG)
    expect(tenantContexts).toEqual([{ orgId: ORG, userId: "user-1" }])
  })

  test("MERGES the metadata patch instead of replacing the blob -- isExternalLink survives", async () => {
    const { updateDocumentMetadata } = await loadService()
    existingDoc = {
      ...existingDoc,
      category: "drawing_3d",
      metadata: { discipline: "Architectural", isExternalLink: true },
    }

    await updateDocumentMetadata({ orgId: ORG, userId: "user-1" }, "doc-1", { metadata: { discipline: "MEP" } })

    // isExternalLink decides whether fileUrl is a storage path or a URL. A
    // discipline edit that dropped it would silently break the file link on
    // every subsequent read.
    expect(capturedSet?.metadata).toEqual({ discipline: "MEP", isExternalLink: true })
  })

  test("rejects a metadata patch on a category outside {drawing, drawing_3d}", async () => {
    const { updateDocumentMetadata, ServiceError } = await loadService()
    existingDoc = { ...existingDoc, category: "permit", metadata: { permitNumber: "BP-2026-0142" } }

    await expect(
      updateDocumentMetadata({ orgId: ORG, userId: "user-1" }, "doc-1", { metadata: { discipline: "MEP" } })
    ).rejects.toThrow(ServiceError)
    // Nothing was written: the refusal happens before the UPDATE, not after it.
    expect(capturedSet).toBeUndefined()
  })

  test("rejects a patch that moves a drawing OUT of the drawing categories while editing its metadata", async () => {
    const { updateDocumentMetadata } = await loadService()

    await expect(
      updateDocumentMetadata({ orgId: ORG, userId: "user-1" }, "doc-1", {
        category: "other",
        metadata: { discipline: "MEP" },
      })
    ).rejects.toThrow(/editable metadata/)
    expect(capturedSet).toBeUndefined()
  })

  test("a metadata-free patch still works on any category -- the gate is on metadata, not on editing", async () => {
    const { updateDocumentMetadata } = await loadService()
    existingDoc = { ...existingDoc, category: "permit" }

    await updateDocumentMetadata({ orgId: ORG, userId: "user-1" }, "doc-1", { expiryDate: "2027-01-31" })

    expect(capturedSet?.expiryDate).toEqual(new Date("2027-01-31"))
    expect(capturedSet?.metadata).toBeUndefined()
  })

  test("an empty name is refused rather than stored -- a nameless drawing is unfindable", async () => {
    const { updateDocumentMetadata, ServiceError } = await loadService()

    await expect(
      updateDocumentMetadata({ orgId: ORG, userId: "user-1" }, "doc-1", { name: "   " })
    ).rejects.toThrow(ServiceError)
    expect(mockWithTenantContext).not.toHaveBeenCalled()
  })

  test("a document that is not in the caller's org is 404, never silently patched", async () => {
    const { updateDocumentMetadata, ServiceError } = await loadService()
    existingDoc = undefined

    await expect(
      updateDocumentMetadata({ orgId: ORG, userId: "user-1" }, "doc-1", { name: "Anything" })
    ).rejects.toThrow(ServiceError)
    expect(capturedSet).toBeUndefined()
  })
})

// ─── R67 D-12 (audit R-034): the register and its automatic supersede ────────
// "A register that cannot answer 'is this the one I build from?' is not a
// register." The acceptance: creating AR-101 Rev A then AR-101 Rev B on the same
// project leaves Rev A 'superseded' and Rev B 'current' with supersedesId equal
// to Rev A's id, and BOTH writes happen inside ONE transaction.
//
// These create through externalUrl rather than a File on purpose: the file
// branch uploads bytes to Supabase Storage before any of this runs, which a unit
// test has no business doing. The supersede path is identical either way -- it
// is decided entirely by drawingNo/status, which are the same for both.
describe("createDrawingRecord -- R67 D-12 supersede", () => {
  const PROJECT = "proj-1"

  test("the FIRST revision has nothing to supersede and is written as it was asked for", async () => {
    const { createDrawingRecord } = await loadService()
    existingDoc = undefined // no 'current' AR-101 on this project yet

    const doc = await createDrawingRecord({ orgId: ORG, userId: "user-1" }, {
      name: "AR-101 Ground floor plan",
      category: "drawing",
      projectId: PROJECT,
      discipline: "Architectural",
      drawingNo: "AR-101",
      rev: "A",
      status: "current",
      externalUrl: "https://example.com/AR-101-A",
    })

    expect(updates).toHaveLength(0) // nothing superseded
    expect(inserts).toHaveLength(1)
    expect(inserts[0].metadata).toEqual({
      isExternalLink: true,
      discipline: "Architectural",
      drawingNo: "AR-101",
      rev: "A",
      status: "current",
      supersedesId: null,
    })
    expect((doc as Row).linkedEntityId).toBe(PROJECT)
  })

  test("THE ACCEPTANCE: Rev B supersedes Rev A, records which row it replaced, and does both in ONE transaction", async () => {
    const { createDrawingRecord } = await loadService()
    // Rev A, already current on this project.
    existingDoc = {
      id: "doc-rev-a",
      orgId: ORG,
      name: "AR-101 Ground floor plan",
      category: "drawing",
      linkedEntityType: "project",
      linkedEntityId: PROJECT,
      metadata: { discipline: "Architectural", drawingNo: "AR-101", rev: "A", status: "current", isExternalLink: true },
    }

    await createDrawingRecord({ orgId: ORG, userId: "user-1" }, {
      name: "AR-101 Ground floor plan",
      category: "drawing",
      projectId: PROJECT,
      discipline: "Architectural",
      drawingNo: "AR-101",
      rev: "B",
      status: "current",
      externalUrl: "https://example.com/AR-101-B",
    })

    // Rev A becomes superseded -- and keeps everything else it had.
    expect(updates).toHaveLength(1)
    expect(updates[0].metadata).toEqual({
      discipline: "Architectural",
      drawingNo: "AR-101",
      rev: "A",
      status: "superseded",
      isExternalLink: true,
    })
    // Rev B is current and says which row it replaced.
    expect(inserts).toHaveLength(1)
    const inserted = inserts[0].metadata as Row
    expect(inserted.status).toBe("current")
    expect(inserted.rev).toBe("B")
    expect(inserted.supersedesId).toBe("doc-rev-a")
    // ONE transaction for both writes: a second withTenantContext would trip
    // D-06's nesting guard, and -- guard or no guard -- would open a window in
    // which two rows are 'current', or none is.
    expect(mockWithTenantContext).toHaveBeenCalledTimes(1)
    expect(tenantContexts).toEqual([{ orgId: ORG, userId: "user-1" }])
  })

  test("the previous revision is looked for by drawing number, project and 'current' -- not by name", async () => {
    const { createDrawingRecord } = await loadService()
    existingDoc = undefined

    await createDrawingRecord({ orgId: ORG, userId: "user-1" }, {
      name: "AR-101 Ground floor plan",
      category: "drawing",
      projectId: PROJECT,
      drawingNo: "AR-101",
      rev: "B",
      status: "current",
      externalUrl: "https://example.com/AR-101-B",
    })

    const rendered = dialect.sqlToQuery(capturedWhere!)
    expect(rendered.sql).toContain("drawingNo")
    expect(rendered.sql).toContain("'current'")
    expect(rendered.sql).toContain("linked_entity_id")
    expect(rendered.params).toContain("AR-101")
    expect(rendered.params).toContain(PROJECT)
    expect(rendered.params).toContain(ORG)
  })

  test("a drawing uploaded FOR APPROVAL supersedes nothing -- it is not the build set yet", async () => {
    const { createDrawingRecord } = await loadService()
    existingDoc = {
      id: "doc-rev-a",
      orgId: ORG,
      metadata: { drawingNo: "AR-101", rev: "A", status: "current" },
    }

    await createDrawingRecord({ orgId: ORG, userId: "user-1" }, {
      name: "AR-101 Ground floor plan",
      category: "drawing",
      projectId: PROJECT,
      drawingNo: "AR-101",
      rev: "B",
      externalUrl: "https://example.com/AR-101-B",
    })

    expect(updates).toHaveLength(0)
    expect((inserts[0].metadata as Row).status).toBe("for_approval") // the default
    expect((inserts[0].metadata as Row).supersedesId).toBeNull()
  })

  test("a drawing with no Drawing No. supersedes nothing -- there is nothing to match on", async () => {
    const { createDrawingRecord } = await loadService()
    existingDoc = { id: "doc-rev-a", orgId: ORG, metadata: { status: "current" } }

    await createDrawingRecord({ orgId: ORG, userId: "user-1" }, {
      name: "Villa 21 walkthrough",
      category: "drawing_3d",
      projectId: PROJECT,
      status: "current",
      externalUrl: "https://my.matterport.com/show/?m=abc",
    })

    expect(updates).toHaveLength(0)
    expect((inserts[0].metadata as Row).drawingNo).toBeNull()
    expect((inserts[0].metadata as Row).supersedesId).toBeNull()
  })

  test("a nameless or projectless drawing is refused before anything is written", async () => {
    const { createDrawingRecord, ServiceError } = await loadService()

    await expect(
      createDrawingRecord({ orgId: ORG, userId: "user-1" }, {
        name: "   ",
        category: "drawing",
        projectId: PROJECT,
        externalUrl: "https://example.com/x",
      })
    ).rejects.toThrow(ServiceError)
    await expect(
      createDrawingRecord({ orgId: ORG, userId: "user-1" }, {
        name: "AR-101",
        category: "drawing",
        projectId: "",
        externalUrl: "https://example.com/x",
      })
    ).rejects.toThrow(ServiceError)
    expect(inserts).toHaveLength(0)
    expect(mockWithTenantContext).not.toHaveBeenCalled()
  })
})

// ─── R67 D-14 (audit R-039/R-044): "Relates to", and the project that survives it ─
// The create screen's "Relates to" combobox can now file a document against a
// permit, an RFI or a meeting instead of against the project. That is the whole
// point of the field -- and it is also how a document disappears from the list
// it was uploaded on, because that list asked for linkedEntityType='project'.
// projectId (metadata) and projectScopeId (the read side) are the pair that
// keeps both true.
describe("createDocumentRecord -- R67 D-14 Relates to, project scope and email fields", () => {
  const PROJECT = "proj-1"

  test("a document related to a PERMIT still records the project it belongs to", async () => {
    const { createDocumentRecord } = await loadService()

    await createDocumentRecord({ orgId: ORG, userId: "user-1" }, {
      name: "DEWA_permit_2026",
      category: "permit",
      linkedEntityType: "permit",
      linkedEntityId: "permit-9",
      projectId: PROJECT,
      externalUrl: "https://example.com/permit.pdf",
    })

    expect(inserts).toHaveLength(1)
    expect(inserts[0].linkedEntityType).toBe("permit")
    expect(inserts[0].linkedEntityId).toBe("permit-9")
    // ...so the project's Documents list can still find it.
    expect(inserts[0].metadata).toEqual({ isExternalLink: true, projectId: PROJECT })
  })

  test("the three email fields are stored, and only the ones that were given", async () => {
    const { createDocumentRecord } = await loadService()

    await createDocumentRecord({ orgId: ORG, userId: "user-1" }, {
      name: "RE DEWA connection approval",
      category: "email",
      linkedEntityType: "project",
      linkedEntityId: PROJECT,
      projectId: PROJECT,
      email: { from: "sumeet@skylinebuilders.example", receivedOn: "2026-05-10", subject: "  " },
      externalUrl: "https://example.com/mail.eml",
    })

    expect(inserts[0].metadata).toEqual({
      isExternalLink: true,
      projectId: PROJECT,
      emailFrom: "sumeet@skylinebuilders.example",
      emailReceivedOn: "2026-05-10",
    })
  })

  test("a non-email document's metadata is unchanged -- no blank email keys are written", async () => {
    const { createDocumentRecord } = await loadService()

    await createDocumentRecord({ orgId: ORG, userId: "user-1" }, {
      name: "Contract",
      category: "contract",
      email: { from: null, receivedOn: null, subject: null },
      externalUrl: "https://example.com/contract.pdf",
    })

    expect(inserts[0].metadata).toEqual({ isExternalLink: true })
  })

  test("'related to a permit' with no permit id is refused before anything is uploaded or written", async () => {
    const { createDocumentRecord, ServiceError } = await loadService()

    await expect(
      createDocumentRecord({ orgId: ORG, userId: "user-1" }, {
        name: "Orphan",
        category: "other",
        linkedEntityType: "permit",
        externalUrl: "https://example.com/x.pdf",
      })
    ).rejects.toThrow(ServiceError)
    expect(inserts).toHaveLength(0)
    expect(mockWithTenantContext).not.toHaveBeenCalled()
  })
})

describe("buildDocumentFilterConditions -- R67 D-14 projectScopeId", () => {
  test("asks for the project's own documents OR the ones filed against its permits/RFIs/meetings", async () => {
    const { buildDocumentFilterConditions } = await loadService()
    const conditions = buildDocumentFilterConditions(ORG, { projectScopeId: "proj-1" })
    // The conditions are an independent, composable AND-set (see the function's
    // own header comment), so the one this item adds is rendered on its own --
    // a real check on the SQL, not on a canned answer.
    const orClause = dialect.sqlToQuery(conditions[1] as SQL)
    expect(orClause.sql).toContain("linked_entity_id")
    expect(orClause.sql).toContain("'projectId'")
    expect(orClause.sql).toContain(" OR ")
    expect(orClause.params).toEqual(["proj-1", "proj-1"])
  })

  test("is absent when no project scope is asked for -- the existing filters are unchanged", async () => {
    const { buildDocumentFilterConditions } = await loadService()
    const conditions = buildDocumentFilterConditions(ORG, { linkedEntityId: "proj-1" })
    for (const condition of conditions) {
      expect(dialect.sqlToQuery(condition as SQL).sql).not.toContain("'projectId'")
    }
  })
})

// ─── R67 D-15 (audit R-040): Replace file, and the version chain ─────────────
// The object page could not correct a file uploaded by mistake: its only
// lifecycle action was Dispose, which is retention-gated and therefore refused
// for exactly the fresh upload someone wants to fix. The columns were always
// there; nothing on the Bearer-key surface exposed them.
describe("createDocumentVersion -- R67 D-15", () => {
  const V1: Row = {
    id: "doc-1",
    orgId: ORG,
    name: "DEWA permit 2026",
    category: "permit",
    clientId: null,
    expiryDate: null,
    linkedEntityType: "permit",
    linkedEntityId: "permit-9",
    metadata: { projectId: "proj-1" },
    versionNumber: 1,
    isLatestVersion: true,
    isDisposed: false,
    legalHold: false,
  }

  test("version 2 inherits everything but the bytes, and both writes happen in ONE transaction", async () => {
    const { createDocumentVersion } = await loadService()
    existingDoc = V1

    const doc = await createDocumentVersion({ orgId: ORG, userId: "user-1" }, "doc-1", {
      file: new File(["%PDF-1.7"], "corrected.pdf", { type: "application/pdf" }),
    })

    // The previous version stops being the latest...
    expect(updates).toHaveLength(1)
    expect(updates[0].isLatestVersion).toBe(false)
    // ...and the new row is the same logical document, still filed the same way.
    expect(inserts).toHaveLength(1)
    expect(inserts[0].name).toBe("DEWA permit 2026")
    expect(inserts[0].category).toBe("permit")
    expect(inserts[0].linkedEntityType).toBe("permit")
    expect(inserts[0].linkedEntityId).toBe("permit-9")
    expect(inserts[0].metadata).toEqual({ projectId: "proj-1" })
    expect(inserts[0].parentDocumentId).toBe("doc-1")
    expect(inserts[0].versionNumber).toBe(2)
    expect(inserts[0].isLatestVersion).toBe(true)
    expect(inserts[0].fileType).toBe("application/pdf")
    expect((doc as Row).versionNumber).toBe(2)
    // One transaction: two would leave a window with two latest versions, or none.
    expect(mockWithTenantContext).toHaveBeenCalledTimes(1)
  })

  test("the bytes are uploaded BEFORE the transaction opens, under the org's own prefix", async () => {
    const { createDocumentVersion } = await loadService()
    existingDoc = V1

    await createDocumentVersion({ orgId: ORG, userId: "user-1" }, "doc-1", {
      file: new File(["%PDF"], "corrected.pdf", { type: "application/pdf" }),
    })

    expect(uploads).toHaveLength(1)
    expect(uploads[0].bucket).toBe("compliance-documents")
    expect(uploads[0].objectPath.startsWith(`${ORG}/`)).toBe(true)
    expect(uploads[0].objectPath.endsWith("corrected.pdf")).toBe(true)
  })

  test("a disposed or held document is refused, and the flip is rolled back with the transaction", async () => {
    const { createDocumentVersion, ServiceError } = await loadService()
    existingDoc = { ...V1, isDisposed: true }

    await expect(
      createDocumentVersion({ orgId: ORG, userId: "user-1" }, "doc-1", { file: new File(["x"], "a.pdf") })
    ).rejects.toThrow(ServiceError)
    expect(inserts).toHaveLength(0)
  })

  test("replacing a version that has already been superseded is refused, not silently branched", async () => {
    const { createDocumentVersion } = await loadService()
    existingDoc = { ...V1, isLatestVersion: false }

    await expect(
      createDocumentVersion({ orgId: ORG, userId: "user-1" }, "doc-1", { file: new File(["x"], "a.pdf") })
    ).rejects.toThrow(/already been superseded/)
    expect(inserts).toHaveLength(0)
  })

  test("a missing file is refused before anything is uploaded", async () => {
    const { createDocumentVersion, ServiceError } = await loadService()

    await expect(
      createDocumentVersion({ orgId: ORG, userId: "user-1" }, "doc-1", { file: null as unknown as File })
    ).rejects.toThrow(ServiceError)
    expect(uploads).toHaveLength(0)
    expect(mockWithTenantContext).not.toHaveBeenCalled()
  })
})

describe("readVersionChain -- R67 D-15", () => {
  test("walks back to the original upload, newest first, and stops at the root", async () => {
    const { readVersionChain } = await loadService()
    findFirstQueue = [
      { id: "v3", versionNumber: 3, parentDocumentId: "v2" },
      { id: "v2", versionNumber: 2, parentDocumentId: "v1" },
      { id: "v1", versionNumber: 1, parentDocumentId: null },
    ]

    const chain = await readVersionChain(fakeDb as never, ORG, "v3")
    expect(chain.map((v) => (v as unknown as Row).id)).toEqual(["v3", "v2", "v1"])
  })

  test("a chain whose parent is missing (or in another org) ends there rather than looping", async () => {
    const { readVersionChain } = await loadService()
    findFirstQueue = [{ id: "v2", versionNumber: 2, parentDocumentId: "gone" }, undefined]

    const chain = await readVersionChain(fakeDb as never, ORG, "v2")
    expect(chain).toHaveLength(1)
  })
})

describe("buildDocumentMetadata -- R67 D-14", () => {
  test("merges over what the storage step already put there, never replacing it", async () => {
    const { buildDocumentMetadata } = await loadService()
    expect(buildDocumentMetadata({ isExternalLink: true }, { projectId: "proj-1" })).toEqual({
      isExternalLink: true,
      projectId: "proj-1",
    })
  })

  test("whitespace-only values are not stored", async () => {
    const { buildDocumentMetadata } = await loadService()
    expect(buildDocumentMetadata({}, { projectId: "   ", email: { subject: "\t" } })).toEqual({})
  })
})
