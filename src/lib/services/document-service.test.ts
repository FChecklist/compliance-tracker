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
let capturedWhere: SQL | undefined
let capturedSet: Row | undefined
let tenantContexts: { orgId: string; userId?: string }[] = []

const fakeDb = {
  query: {
    documents: {
      findFirst: async ({ where }: { where: SQL }) => {
        capturedWhere = where
        return existingDoc
      },
    },
  },
  update: () => ({
    set: (values: Row) => {
      capturedSet = values
      return {
        where: () => ({
          returning: async () => [{ ...(existingDoc ?? {}), ...values }],
        }),
      }
    },
  }),
}

const mockWithTenantContext = mock(async (ctx: { orgId: string; userId?: string }, fn: (db: unknown) => Promise<unknown>) => {
  tenantContexts.push(ctx)
  return fn(fakeDb as unknown as never)
})

const realTenantScoped = await import("@/lib/db/tenant-scoped")

async function loadService() {
  await mock.module("@/lib/db/tenant-scoped", () => ({ ...realTenantScoped, withTenantContext: mockWithTenantContext }))
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
  capturedWhere = undefined
  capturedSet = undefined
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
