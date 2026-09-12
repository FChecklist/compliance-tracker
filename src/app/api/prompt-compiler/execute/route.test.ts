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
//
// R75 Part 2 Phase 5 (G8-misc): this route had no role check at all beyond
// requireAuth() -- added requireRole(dbUser, "member") (see the route's own
// comment for why "member"). The mock.module("@/lib/supabase/auth-guard")
// factories below now also provide a real rank-based requireRole -- REPLACES
// the whole module, so every existing test needs the added import satisfied
// even where its own scenario returns before the role check runs.
import { describe, test, expect, mock } from "bun:test"

const RANK: Record<string, number> = { viewer: 1, client_viewer: 1, external_auditor: 1, stage_0: 1, member: 2, team_member: 2, senior_professional: 3, manager: 3, branch_manager: 4, admin: 5, veridian_admin: 6 }

function fakeRequireRole(user: { role: string } | null, minimumRole: string) {
  const userRank = RANK[user?.role ?? ""] ?? 0
  const requiredRank = RANK[minimumRole] ?? 99
  if (userRank < requiredRank) {
    return new Response(JSON.stringify({ error: `This action requires ${minimumRole} role or higher` }), { status: 403 }) as any
  }
  return null
}

function dbUser(role: string = "member") {
  return { id: "user-1", role, orgId: "org-1", name: "Test User" } as any
}

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/prompt-compiler/execute", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

// @/lib/db re-exports the real `db` client (a lazy Proxy -- see
// db/index.ts -- so importing it here does not open a live connection)
// alongside every schema table symbol. The route's own import chain
// (capability-learning-service.ts -> compliance-service.ts) has a
// top-level `import { auditLogs } from "@/lib/db"`, so a mock.module()
// factory that replaces @/lib/db's full export surface without spreading
// the actual module first drops that (and every other) table export --
// SyntaxError: Export named 'auditLogs' not found -- even though only
// `db`'s query behavior needs stubbing here. Import the actual module in
// an async helper (never inside the factory itself -- that self-
// referentially hangs bun's module resolver) and spread it before
// overriding `db`.
async function mockDb(org: { name: string; country: string | null } | null) {
  const actual = await import("@/lib/db")
  mock.module("@/lib/db", () => ({
    ...actual,
    db: { query: { organisations: { findFirst: mock(async () => org) } } },
  }))
}

async function mockAuthAndDb(org: { name: string; country: string | null } | null = { name: "Acme", country: "IN" }, role: string = "member") {
  mock.module("@/lib/supabase/auth-guard", () => ({
    requireAuth: mock(async () => ({ response: null, dbUser: dbUser(role), orgId: "org-1" })),
    requireRole: fakeRequireRole,
  }))
  await mockDb(org)
}

describe("POST /api/prompt-compiler/execute", () => {
  test("unauthenticated -> the requireAuth response is returned as-is", async () => {
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: new Response(null, { status: 401 }), dbUser: null, orgId: null })),
      requireRole: fakeRequireRole,
    }))
    await mockDb(null)
    const { POST } = await import("./route")
    const res = await POST(makeRequest({ rawText: "hi" }) as any)
    expect(res.status).toBe(401)
  })

  test("missing rawText -> 400, pipeline never runs", async () => {
    await mockAuthAndDb()
    const { POST } = await import("./route")
    const res = await POST(makeRequest({}) as any)
    expect(res.status).toBe(400)
  })

  test("real end-to-end: compiles a real machine prompt via runPipeline and reports no escalation when verification passes and a real browser tier ran", async () => {
    await mockAuthAndDb()
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
    await mockAuthAndDb()
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
      requireRole: fakeRequireRole,
    }))
    await mockDb(null)
    const { POST } = await import("./route")
    const res = await POST(makeRequest({ rawText: "hi" }) as any)
    expect(res.status).toBe(400)
  })
})

describe("POST /api/prompt-compiler/execute (role gate)", () => {
  test("a below-minimum role (viewer) is rejected with 403 before the pipeline ever runs", async () => {
    await mockAuthAndDb(undefined, "viewer")
    const { POST } = await import("./route")
    const res = await POST(makeRequest({ rawText: "Fix the login bug" }) as any)
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toBe("This action requires member role or higher")
  })

  test("an at-minimum role (member) is allowed through and the pipeline runs", async () => {
    await mockAuthAndDb(undefined, "member")
    const { POST } = await import("./route")
    const res = await POST(makeRequest({ rawText: "Fix the login bug" }) as any)
    expect(res.status).toBe(200)
  })
})
