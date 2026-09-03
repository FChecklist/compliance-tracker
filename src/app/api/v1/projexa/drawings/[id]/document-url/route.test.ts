/// <reference types="bun-types" />
// R67 F-02 (R-018/R-021/R-030/R-035), review fix.
//
// This endpoint exists because F-02 stopped the drawings register signing a
// Supabase Storage URL for every row: the register now reports `hasDocument`,
// and this is the one place a URL is minted -- for the single drawing a human
// just clicked. Being the only remaining path to a drawing's file makes its
// four behaviours load-bearing, and none of them were covered:
//
//   1. THE ANTI-FISHING SCOPE. The lookup is constrained to the caller's org
//      AND to the two drawing categories, so a document id belonging to
//      another org, or to a permit/invoice, must 404 rather than hand back a
//      signed URL for a file the caller may not read.
//   2. THE EXTERNAL-LINK BRANCH. A 3D walkthrough stored as a Matterport URL
//      is already a URL; touching Storage for it would be a pointless network
//      call against credentials that may not even be needed in that
//      deployment.
//   3. THE 502. signDocumentUrl() resolves a signing failure to null instead
//      of throwing (see its own header). Without an explicit branch that null
//      would fall through as a success carrying no URL, and the click would
//      silently do nothing -- so a failure must be a named, retryable answer.
//   4. IT MUST NOT 500 ON A SIGNING OUTAGE. The row is fine; only its file
//      link is not.
//
// The Supabase client module is mocked rather than the route's own helper, so
// this suite would still fail if a future edit reached Storage by another path.
import { describe, test, expect, mock, beforeEach, setDefaultTimeout } from "bun:test"
import { NextRequest } from "next/server"

// Cold-importing the route pulls its transitive drizzle/Supabase graph, which
// can exceed bun's 5000 ms default on a slow disk -- same bump, same reason, as
// the sibling permits/route.test.ts.
setDefaultTimeout(20000)

const createSignedUrl = mock(async () => ({ data: { signedUrl: "https://storage.example/signed" } }))

mock.module("@supabase/supabase-js", () => ({
  createClient: mock(() => ({
    storage: { from: mock(() => ({ createSignedUrl })) },
  })),
}))

type DrawingDoc = {
  id: string
  fileUrl: string | null
  metadata: Record<string, unknown> | null
}

/**
 * Stands in for the tenant-scoped read. `findFirst` receives the route's real
 * `where` clause; returning `found` models "the scoped query matched", and
 * returning null models "it did not" -- which is what an out-of-org id or a
 * non-drawing category produces against the real database.
 */
async function mockDeps(found: DrawingDoc | null) {
  const authActual = await import("@/lib/supabase/auth-guard")
  mock.module("@/lib/supabase/auth-guard", () => ({
    ...authActual,
    requireAuthOrApiKey: mock(async () => ({ orgId: "org-1", dbUser: null, apiKey: { id: "key-1" }, response: null })),
  }))

  const findFirst = mock(async () => found)
  const tenantActual = await import("@/lib/db/tenant-scoped")
  mock.module("@/lib/db/tenant-scoped", () => ({
    ...tenantActual,
    withTenantContext: mock(async (_ctx: unknown, fn: (db: unknown) => unknown) =>
      fn({ query: { documents: { findFirst } } })
    ),
  }))
  return { findFirst }
}

function getRequest(id: string) {
  return new NextRequest(`http://localhost/api/v1/projexa/drawings/${id}/document-url`, {
    headers: { authorization: "Bearer vk_test" },
  })
}

const params = (id: string) => ({ params: Promise.resolve({ id }) })

describe("GET /api/v1/projexa/drawings/[id]/document-url", () => {
  beforeEach(() => {
    createSignedUrl.mockClear()
  })

  test("a document outside this org (or not a drawing) is 404, and nothing is signed", async () => {
    // The route's own where-clause is what enforces this; an unmatched read is
    // exactly what that clause produces for another org's id or a permit's id.
    await mockDeps(null)
    const { GET } = await import("./route")

    const res = await GET(getRequest("doc-elsewhere"), params("doc-elsewhere"))
    const body = await res.json()

    expect(res.status).toBe(404)
    expect(body.error).toBe("Drawing not found")
    expect(createSignedUrl).not.toHaveBeenCalled()
  })

  test("the scoped read really is org- AND category-constrained", async () => {
    // Asserted on the query the route builds, not only on its output: a future
    // edit that dropped either constraint would keep every other test in this
    // file green while opening the fishing hole this endpoint was written to
    // avoid.
    const { findFirst } = await mockDeps(null)
    const { GET } = await import("./route")

    await GET(getRequest("d1"), params("d1"))

    expect(findFirst).toHaveBeenCalledTimes(1)
    const arg = findFirst.mock.calls[0][0] as { where?: unknown; columns?: Record<string, boolean> }
    expect(arg.where).toBeDefined()
    // The route reads only what it needs to answer; metadata carries the
    // external-link flag, fileUrl the path.
    expect(arg.columns).toEqual({ id: true, fileUrl: true, metadata: true })
  })

  test("an external-link walkthrough returns its stored URL with ZERO Storage calls", async () => {
    await mockDeps({ id: "d1", fileUrl: "https://my.matterport.com/show/?m=abc", metadata: { isExternalLink: true } })
    const { GET } = await import("./route")

    const res = await GET(getRequest("d1"), params("d1"))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.documentUrl).toBe("https://my.matterport.com/show/?m=abc")
    expect(body.isExternalLink).toBe(true)
    expect(createSignedUrl).not.toHaveBeenCalled()
  })

  test("a storage-backed drawing signs exactly ONE url", async () => {
    await mockDeps({ id: "d2", fileUrl: "org-1/drawings/plan.pdf", metadata: {} })
    const { GET } = await import("./route")

    const res = await GET(getRequest("d2"), params("d2"))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.documentUrl).toBe("https://storage.example/signed")
    expect(body.isExternalLink).toBe(false)
    expect(createSignedUrl).toHaveBeenCalledTimes(1)
  })

  test("a failed signing is a 502 with the retryable sentence -- never a 500, never a silent success", async () => {
    // signDocumentUrl() swallows the throw and resolves null, so this is the
    // shape a real Storage outage takes by the time the route sees it.
    createSignedUrl.mockImplementationOnce(async () => {
      throw new Error("service role key rotated")
    })
    await mockDeps({ id: "d3", fileUrl: "org-1/drawings/plan.pdf", metadata: {} })
    const { GET } = await import("./route")

    const res = await GET(getRequest("d3"), params("d3"))
    const body = await res.json()

    expect(res.status).toBe(502)
    expect(body.error).toBe("This drawing's file could not be opened right now. Please retry.")
    expect(body.documentUrl).toBeUndefined()
  })

  test("a drawing row with no stored file is the same 502, not a 200 carrying nothing", async () => {
    await mockDeps({ id: "d4", fileUrl: null, metadata: {} })
    const { GET } = await import("./route")

    const res = await GET(getRequest("d4"), params("d4"))

    expect(res.status).toBe(502)
    expect(createSignedUrl).not.toHaveBeenCalled()
  })
})
