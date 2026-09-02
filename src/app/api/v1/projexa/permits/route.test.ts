/// <reference types="bun-types" />
// R67 F-02 (R-018/R-021/R-030/R-035) acceptance test.
//
// THE BUG. GET /api/v1/projexa/permits used to call
// `admin.storage.from(bucket).createSignedUrl(...)` once PER ROW, awaited
// inside the list request. Two consequences, both measured in the R66 audit:
// list latency scaled linearly with register size (a 40-permit register paid
// 40 Storage round trips before its first byte), and because the call was
// unguarded, one Storage misconfiguration -- rotated service-role key,
// renamed bucket -- turned the whole register into a 500 even though every
// row's real data had already been read from Postgres successfully.
//
// THE CONTRACT NOW. The list signs nothing. Each row carries `hasDocument`
// (boolean) and NO `documentUrl` key at all; the URL is minted on click by
// the existing GET /permits/{id} object route. `documentUrl: null` was
// rejected deliberately as the alternative -- it reads as "this permit has no
// file", which is a different and false statement.
//
// The Supabase client module is mocked, not the route's own helper, so this
// test would still fail if a future edit reached Storage by some other path.
import { describe, test, expect, mock, beforeEach, setDefaultTimeout } from "bun:test"
import { NextRequest } from "next/server"

// The first dynamic import() of ./route in this file pulls document-service.ts
// (and its transitive Supabase/drizzle graph) in cold, which can exceed bun's
// 5000 ms default on a slow disk. Same bump, same reason, as
// ../accounts/route.test.ts -- module compile cost, not the fix under test.
setDefaultTimeout(20000)

const createSignedUrl = mock(async () => ({ data: { signedUrl: "https://storage.example/signed" } }))

mock.module("@supabase/supabase-js", () => ({
  createClient: mock(() => ({
    storage: { from: mock(() => ({ createSignedUrl })) },
  })),
}))

function permitDoc(n: number) {
  return {
    id: `doc-${n}`,
    name: `Permit ${n}`,
    metadata: { permitAuthority: "Dubai Municipality", permitNumber: `P-${n}`, issueDate: "2026-01-0" + n },
    expiryDate: "2026-12-31",
    fileUrl: `org-1/permits/permit-${n}.pdf`,
    category: "permit",
    createdAt: new Date("2026-01-01T00:00:00Z"),
  }
}

const THREE_PERMITS = [permitDoc(1), permitDoc(2), permitDoc(3)]

async function mockDeps(docs: unknown[]) {
  const authActual = await import("@/lib/supabase/auth-guard")
  mock.module("@/lib/supabase/auth-guard", () => ({
    ...authActual,
    requireAuthOrApiKey: mock(async () => ({ orgId: "org-1", dbUser: null, apiKey: { id: "key-1" }, response: null })),
  }))

  const listExpiringDocuments = mock(async () => docs)
  const listDocuments = mock(async () => docs)
  const docActual = await import("@/lib/services/document-service")
  mock.module("@/lib/services/document-service", () => ({ ...docActual, listExpiringDocuments, listDocuments }))
  return { listExpiringDocuments, listDocuments }
}

function getRequest(query = "") {
  return new NextRequest(`http://localhost/api/v1/projexa/permits${query}`, {
    headers: { authorization: "Bearer vk_test" },
  })
}

describe("GET /api/v1/projexa/permits -- the list never signs a Storage URL", () => {
  beforeEach(() => {
    createSignedUrl.mockClear()
  })

  test("three permits produce ZERO createSignedUrl calls", async () => {
    await mockDeps(THREE_PERMITS)
    const { GET } = await import("./route")

    const res = await GET(getRequest("?projectId=proj-1&all=true"))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.permits).toHaveLength(3)
    expect(createSignedUrl).not.toHaveBeenCalled()
  })

  test("every row carries a boolean hasDocument and no documentUrl key at all", async () => {
    await mockDeps(THREE_PERMITS)
    const { GET } = await import("./route")

    const body = await (await GET(getRequest("?projectId=proj-1&all=true"))).json()

    for (const row of body.permits) {
      expect(typeof row.hasDocument).toBe("boolean")
      expect(row.hasDocument).toBe(true)
      // `in`, not `=== undefined`: the key must be ABSENT, because a null
      // documentUrl reads as "this permit has no file".
      expect("documentUrl" in row).toBe(false)
    }
  })

  test("hasDocument is false for a row with no stored file, still with no URL key", async () => {
    await mockDeps([{ ...permitDoc(4), fileUrl: "" }])
    const { GET } = await import("./route")

    const body = await (await GET(getRequest("?projectId=proj-1&all=true"))).json()

    expect(body.permits).toHaveLength(1)
    expect(body.permits[0].hasDocument).toBe(false)
    expect("documentUrl" in body.permits[0]).toBe(false)
    expect(createSignedUrl).not.toHaveBeenCalled()
  })

  test("the expiring-soon path (no ?all) is equally free of Storage calls", async () => {
    await mockDeps(THREE_PERMITS)
    const { GET } = await import("./route")

    const body = await (await GET(getRequest("?projectId=proj-1&withinDays=30"))).json()

    expect(body.permits).toHaveLength(3)
    expect(createSignedUrl).not.toHaveBeenCalled()
  })

  test("the real permit fields survive the DTO change", async () => {
    await mockDeps([permitDoc(1)])
    const { GET } = await import("./route")

    const [row] = (await (await GET(getRequest("?projectId=proj-1&all=true"))).json()).permits

    expect(row.id).toBe("doc-1")
    expect(row.name).toBe("Permit 1")
    expect(row.permitNumber).toBe("P-1")
    expect(row.permitAuthority).toBe("Dubai Municipality")
    expect(row.issueDate).toBe("2026-01-01")
    expect(row.endDate).toBe("2026-12-31")
    // back-compat alias kept -- see the route's own comment
    expect(row.expiryDate).toBe("2026-12-31")
    expect(typeof row.daysToExpiry).toBe("number")
  })
})
