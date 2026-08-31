/// <reference types="bun-types" />
// Thin wiring test, same pattern as v1/reports/catalog/route.test.ts --
// proves buildCapabilityTree() is always called with the authenticated
// caller's own orgId (never a request-supplied one -- there's no orgId in
// the request at all, only in the auth context, so this is the
// tenant-isolation regression guard the task's SUCCESS_CRITERIA asks for:
// two different orgs' API keys can never resolve to the same tree), that
// the 401/403 gates short-circuit before it's ever called, and that the
// construction_intelligence branch (owned by the sibling
// /api/v1/projexa/capability-tree route) is filtered out of the response.
import { describe, test, expect, mock } from "bun:test"
import { NextRequest } from "next/server"

async function mockAuth(ctx: { orgId: string | null; response?: Response | null; scopeErr?: Response | null }) {
  // R60/E-138: must spread ...actual -- this factory used to replace the
  // WHOLE @/lib/supabase/auth-guard module with only these two exports,
  // which silently "worked" under bun test's default (non---isolate) run
  // only by accident: some other file's mock (which does spread ...actual)
  // would leave a complete module registered in the shared global cache,
  // and this file's incomplete one would piggyback on it. Under bun test
  // --isolate (fresh module graph per file, no cross-file leakage), a
  // transitive import elsewhere in this route's chain needing hasRole from
  // this module threw "Export named 'hasRole' not found" for real --
  // confirmed by reproducing locally with --isolate, applying only this
  // one-line change, and getting a clean pass across repeated runs.
  const actual = await import("@/lib/supabase/auth-guard")
  mock.module("@/lib/supabase/auth-guard", () => ({
    ...actual,
    requireAuthOrApiKey: mock(async () => ({
      orgId: ctx.orgId,
      dbUser: null,
      apiKey: ctx.orgId ? { id: "key-1", name: "Test Key", scopes: ["read"] } : null,
      response: ctx.response ?? null,
    })),
    requireRoleOrScope: mock(() => ctx.scopeErr ?? null),
  }))
}

async function mockTree(nodes: unknown[]) {
  const buildCapabilityTree = mock(async () => nodes)
  const actual = await import("@/lib/services/capability-tree-service")
  mock.module("@/lib/services/capability-tree-service", () => ({ ...actual, buildCapabilityTree }))
  return buildCapabilityTree
}

function getRequest(query = "") {
  return new NextRequest(`http://localhost/api/v1/projexa/module-chain${query}`, {
    headers: { authorization: "Bearer vk_test" },
  })
}

describe("GET /api/v1/projexa/module-chain", () => {
  test("calls buildCapabilityTree with the authenticated caller's own orgId only", async () => {
    await mockAuth({ orgId: "org-b" })
    const buildCapabilityTree = await mockTree([{ key: "grc", label: "VERI GRC AI", leaf: false, children: [] }])

    const { GET } = await import("./route")
    const res = await GET(getRequest() as any)

    expect(res.status).toBe(200)
    expect(buildCapabilityTree).toHaveBeenCalledWith({ orgId: "org-b", moduleScope: undefined, userId: "key-1" })
    expect(await res.json()).toEqual({ nodes: [{ key: "grc", label: "VERI GRC AI", leaf: false, children: [] }] })
  })

  test("a different org's key resolves a different orgId into buildCapabilityTree -- no cross-tenant bleed", async () => {
    await mockAuth({ orgId: "org-other" })
    const buildCapabilityTree = await mockTree([{ key: "erp", label: "VERI ERP", leaf: false, children: [] }])

    const { GET } = await import("./route")
    await GET(getRequest() as any)

    expect(buildCapabilityTree).toHaveBeenCalledWith({ orgId: "org-other", moduleScope: undefined, userId: "key-1" })
    expect(buildCapabilityTree).not.toHaveBeenCalledWith(expect.objectContaining({ orgId: "org-b" }))
  })

  test("filters the construction_intelligence branch out of the response (PROJEXA already owns that via its own endpoint)", async () => {
    await mockAuth({ orgId: "org-b" })
    await mockTree([
      { key: "grc", label: "VERI GRC AI", leaf: false, children: [] },
      { key: "construction_intelligence", label: "Construction Intelligence", leaf: false, children: [] },
      { key: "erp", label: "VERI ERP", leaf: false, children: [] },
    ])

    const { GET } = await import("./route")
    const res = await GET(getRequest() as any)
    const body = await res.json()

    expect(body.nodes.map((n: { key: string }) => n.key)).toEqual(["grc", "erp"])
  })

  test("forwards ?module= as moduleScope", async () => {
    await mockAuth({ orgId: "org-b" })
    const buildCapabilityTree = await mockTree([])

    const { GET } = await import("./route")
    await GET(getRequest("?module=erp") as any)

    expect(buildCapabilityTree).toHaveBeenCalledWith({ orgId: "org-b", moduleScope: "erp", userId: "key-1" })
  })

  test("an organisation-less caller gets 400, buildCapabilityTree is never called", async () => {
    await mockAuth({ orgId: null })
    const buildCapabilityTree = await mockTree([])

    const { GET } = await import("./route")
    const res = await GET(getRequest() as any)

    expect(res.status).toBe(400)
    expect(buildCapabilityTree).not.toHaveBeenCalled()
  })

  test("an invalid/missing API key never reaches buildCapabilityTree", async () => {
    await mockAuth({ orgId: null, response: new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }) })
    const buildCapabilityTree = await mockTree([])

    const { GET } = await import("./route")
    const res = await GET(getRequest() as any)

    expect(res.status).toBe(401)
    expect(buildCapabilityTree).not.toHaveBeenCalled()
  })

  test("a key without read scope is rejected with 403 before buildCapabilityTree runs", async () => {
    await mockAuth({ orgId: "org-b", scopeErr: new Response(JSON.stringify({ error: "scoped" }), { status: 403 }) })
    const buildCapabilityTree = await mockTree([])

    const { GET } = await import("./route")
    const res = await GET(getRequest() as any)

    expect(res.status).toBe(403)
    expect(buildCapabilityTree).not.toHaveBeenCalled()
  })
})
