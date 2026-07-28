// VERIDIAN_Architecture_v2.0 phase_8 (2026-07-28): engine-prompt-marketplace.
// Same "never a live DB from a .test.ts file" discipline as the other
// phase_8 service tests.
/// <reference types="bun-types" />
import { describe, expect, test, mock, afterEach } from "bun:test"

const ADMIN_USER = { id: "user-1", role: "veridian_admin", orgId: "org-1" } as any
const CTX = { userId: ADMIN_USER.id, dbUser: ADMIN_USER }

function buildMockDb(opts: { version?: any; insertedRow?: any; updatedRow?: any; listings?: any[] }) {
  const promptVersionsFindFirst = mock(async () => opts.version)
  const promptMarketplaceListingsFindMany = mock(async () => opts.listings ?? [])
  const insertValues = mock(() => ({ returning: mock(async () => [opts.insertedRow]) }))
  const insert = mock(() => ({ values: insertValues }))
  const updateWhere = mock(() => ({ returning: mock(async () => (opts.updatedRow ? [opts.updatedRow] : [])) }))
  const updateSet = mock(() => ({ where: updateWhere }))
  const update = mock(() => ({ set: updateSet }))

  return {
    db: {
      query: {
        promptVersions: { findFirst: promptVersionsFindFirst },
        promptMarketplaceListings: { findMany: promptMarketplaceListingsFindMany },
      },
      insert, update,
    },
    promptVersions: {}, promptMarketplaceListings: {},
    insert, update, promptMarketplaceListingsFindMany,
  }
}

async function setup(opts: Parameters<typeof buildMockDb>[0]) {
  const dbMocks = buildMockDb(opts)
  // Spread the real module first -- compliance-service.ts (ServiceError's
  // home, imported by the module under test) named-imports auditLogs/
  // complianceItems/etc. from "@/lib/db" too, and a mock.module() factory
  // replaces the whole module namespace, so omitting those breaks that
  // unrelated import at evaluation time. `db` is a lazy Proxy (db/index.ts)
  // that opens no connection on import, so importing the real module here
  // is safe -- we override `db` below anyway.
  const actualDb = await import("@/lib/db")
  await mock.module("@/lib/db", () => ({ ...actualDb, ...dbMocks }))
  return dbMocks
}

afterEach(() => {
  mock.restore()
})

describe("publishToMarketplace", () => {
  test("rejects a version that has not reached Production", async () => {
    await setup({ version: { id: "v1", lifecycleState: "Draft" } })
    const { publishToMarketplace } = await import("./prompt-marketplace-service")
    await expect(publishToMarketplace(CTX, { versionId: "v1", title: "My Prompt" })).rejects.toThrow(/Production/)
  })

  test("rejects an empty title", async () => {
    await setup({ version: { id: "v1", lifecycleState: "Production" } })
    const { publishToMarketplace } = await import("./prompt-marketplace-service")
    await expect(publishToMarketplace(CTX, { versionId: "v1", title: "   " })).rejects.toThrow(/title/)
  })

  test("404s for an unknown prompt version", async () => {
    await setup({ version: undefined })
    const { publishToMarketplace } = await import("./prompt-marketplace-service")
    await expect(publishToMarketplace(CTX, { versionId: "missing", title: "My Prompt" })).rejects.toThrow(/Unknown prompt version/)
  })

  test("lists a Production version with real attribution", async () => {
    const inserted = {
      id: "l1", promptVersionId: "v1", title: "My Prompt", description: null, tags: ["support"],
      status: "listed", publishedByOrgId: "org-1", createdAt: new Date(), updatedAt: new Date(),
    }
    const dbMocks = await setup({ version: { id: "v1", lifecycleState: "Production" }, insertedRow: inserted })
    const { publishToMarketplace } = await import("./prompt-marketplace-service")

    const result = await publishToMarketplace(CTX, { versionId: "v1", title: "My Prompt", tags: ["support"] })

    expect(result.title).toBe("My Prompt")
    expect(result.publishedByOrgId).toBe("org-1")
    expect(dbMocks.insert).toHaveBeenCalled()
  })
})

describe("listMarketplaceListings", () => {
  test("returns only listed entries", async () => {
    const listing = { id: "l1", promptVersionId: "v1", title: "My Prompt", description: null, tags: [], status: "listed", publishedByOrgId: null, createdAt: new Date(), updatedAt: new Date() }
    await setup({ listings: [listing] })
    const { listMarketplaceListings } = await import("./prompt-marketplace-service")

    const result = await listMarketplaceListings()

    expect(result).toHaveLength(1)
    expect(result[0]!.title).toBe("My Prompt")
  })
})

describe("unlistFromMarketplace", () => {
  test("404s for an unknown listing", async () => {
    await setup({ updatedRow: undefined })
    const { unlistFromMarketplace } = await import("./prompt-marketplace-service")
    await expect(unlistFromMarketplace(CTX, "missing")).rejects.toThrow(/Unknown marketplace listing/)
  })

  test("marks a real listing as unlisted", async () => {
    const updated = { id: "l1", promptVersionId: "v1", title: "My Prompt", description: null, tags: [], status: "unlisted", publishedByOrgId: null, createdAt: new Date(), updatedAt: new Date() }
    await setup({ updatedRow: updated })
    const { unlistFromMarketplace } = await import("./prompt-marketplace-service")

    const result = await unlistFromMarketplace(CTX, "l1")

    expect(result.status).toBe("unlisted")
  })
})
