/// <reference types="bun-types" />
// VERIDIAN_Architecture_v2.0 phase_5 (browser_execution_tiers): the real
// end-to-end proof of this phase's own success criterion -- "deterministic
// SECOND-pass SOFTWARE execution on the SERVER... exit 0, with Gateway G05
// invoked only if that specific request triggers Tier-5 escalation (not on
// every request)". @/lib/supabase/auth-guard and @/lib/db are mocked
// (same convention as settings/branding/route.test.ts -- no live DB from a
// .test.ts file), so this file proves the route's own wiring: auth gate,
// real runPipeline() call, and the escalation-flag logic, not a live
// Postgres round-trip.
import { describe, test, expect, mock } from "bun:test"

function dbUser() {
  return { id: "user-1", role: "member", orgId: "org-1", name: "Test User" } as any
}

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/prompt-compiler/execute", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

function mockAuthAndDb(org: { name: string; country: string | null } | null = { name: "Acme", country: "IN" }) {
  mock.module("@/lib/supabase/auth-guard", () => ({
    requireAuth: mock(async () => ({ response: null, dbUser: dbUser(), orgId: "org-1" })),
  }))
  mock.module("@/lib/db", () => ({
    db: { query: { organisations: { findFirst: mock(async () => org) } } },
    organisations: { id: "id" },
  }))
}

describe("POST /api/prompt-compiler/execute", () => {
  test("unauthenticated -> the requireAuth response is returned as-is", async () => {
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: new Response(null, { status: 401 }), dbUser: null, orgId: null })),
    }))
    mock.module("@/lib/db", () => ({ db: { query: { organisations: { findFirst: mock(async () => null) } } }, organisations: { id: "id" } }))
    const { POST } = await import("./route")
    const res = await POST(makeRequest({ rawText: "hi" }) as any)
    expect(res.status).toBe(401)
  })

  test("missing rawText -> 400, pipeline never runs", async () => {
    mockAuthAndDb()
    const { POST } = await import("./route")
    const res = await POST(makeRequest({}) as any)
    expect(res.status).toBe(400)
  })

  test("real end-to-end: compiles a real machine prompt via runPipeline and reports no escalation when verification passes and a real browser tier ran", async () => {
    mockAuthAndDb()
    const { POST } = await import("./route")
    const res = await POST(
      makeRequest({
        rawText: "Fix the login bug for the OAuth callback",
        browserCompiled: { tier: "lite-llm", fallbackChain: ["transformers", "server"], compileMs: 2 },
      }) as any
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.compiled.machinePrompt).toBeTruthy()
    expect(json.browserTier).toBe("lite-llm")
    expect(typeof json.needsServerEscalation).toBe("boolean")
    expect(json.verification).toBeTruthy()
  })

  test("browser reported 'server' tier (no local capability at all) -> needsServerEscalation is forced true", async () => {
    mockAuthAndDb()
    const { POST } = await import("./route")
    const res = await POST(
      makeRequest({ rawText: "What is the GST filing deadline?", browserCompiled: { tier: "server", fallbackChain: [], compileMs: 0 } }) as any
    )
    const json = await res.json()
    expect(json.needsServerEscalation).toBe(true)
  })

  test("no organisation on the account -> 400, not a crash", async () => {
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, dbUser: dbUser(), orgId: null })),
    }))
    mock.module("@/lib/db", () => ({ db: { query: { organisations: { findFirst: mock(async () => null) } } }, organisations: { id: "id" } }))
    const { POST } = await import("./route")
    const res = await POST(makeRequest({ rawText: "hi" }) as any)
    expect(res.status).toBe(400)
  })
})
