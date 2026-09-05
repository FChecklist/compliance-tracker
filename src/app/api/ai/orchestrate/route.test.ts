/// <reference types="bun-types" />
// R75 Phase 5 (G1 compliance authz gap-closure). This route triggers a real,
// potentially-costly LLM call and persists an orchestra-execution-log row
// on every call, and previously had no role floor at all beyond generic
// auth (any authenticated org member, including viewer/stage_0/
// client_viewer/external_auditor-rank accounts, could trigger it). Fixed to
// require "member".
//
// Every non-schema import the route pulls in is mocked (auth-guard,
// tenant-scoped DB, the LLM cache, the mother-router model resolver, the
// prompt-OS resolver, the orchestra execution logger, the policy engine,
// and the purpose-bound-ai domain constant) so this file exercises only the
// route's OWN wiring -- does it call requireRole() -- not the AI pipeline
// itself. The "document.uploaded" event type is used deliberately: it is
// the one VALID_EVENTS member whose payload-enrichment branch never touches
// withTenantContext, so the at-role test can reach a real 200 without
// having to fake a compliance-item/notice DB row.
import { describe, test, expect, mock } from "bun:test"
import { ROLE_RANK } from "@/lib/supabase/role-rank"

function dbUser(role: string) {
  return { id: "user-1", role, orgId: "org-1" } as any
}

function fakeRequireRole(user: any, minimumRole: string) {
  const userRank = ROLE_RANK[user?.role as keyof typeof ROLE_RANK] ?? 0
  const requiredRank = ROLE_RANK[minimumRole as keyof typeof ROLE_RANK] ?? 99
  if (userRank < requiredRank) {
    return new Response(JSON.stringify({ error: `This action requires ${minimumRole} role or higher` }), { status: 403 }) as any
  }
  return null
}

function mockOrchestrateDeps() {
  mock.module("@/lib/db/tenant-scoped", () => ({
    withTenantContext: mock(async () => { throw new Error("withTenantContext should not be called for the document.uploaded event type") }),
  }))
  mock.module("@/lib/llm-response-cache", () => ({
    callLLMJsonCached: mock(async () => { throw new Error("callLLMJsonCached should not be called when no model is configured") }),
  }))
  mock.module("@/lib/ai-router/mother-router", () => ({
    resolveModel: mock(async () => ({ resolvedConfig: null })),
  }))
  mock.module("@/lib/prompt-os-resolver", () => ({
    resolvePromptTemplate: mock(async () => "SYSTEM PROMPT"),
  }))
  mock.module("@/lib/orchestra-execution-logger", () => ({
    recordOrchestraExecution: mock(() => {}),
  }))
  mock.module("@/lib/policy-enforcement-engine", () => ({
    enforcePolicy: mock(() => ({ allowed: true })),
    refusalMessageFor: mock(() => "refused"),
  }))
  mock.module("@/lib/purpose-bound-ai", () => ({ DEFAULT_DOMAIN: "compliance" }))
}

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/ai/orchestrate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("POST /api/ai/orchestrate (access control)", () => {
  test("a viewer (below member) is rejected with 403 and no AI pipeline call is made", async () => {
    mockOrchestrateDeps()
    const resolveModel = mock(async () => { throw new Error("resolveModel should not be called for a below-role caller") })
    mock.module("@/lib/ai-router/mother-router", () => ({ resolveModel }))
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, user: { id: "auth-1" }, dbUser: dbUser("viewer"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
    }))

    const { POST } = await import("./route")
    const res = await POST(makeRequest({ eventType: "document.uploaded", entityId: "doc-1" }) as any)
    expect(res.status).toBe(403)
    expect(resolveModel).not.toHaveBeenCalled()
    mock.restore()
  })

  test("a member-rank user passes the role gate and the orchestration pipeline runs", async () => {
    mockOrchestrateDeps()
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, user: { id: "auth-1" }, dbUser: dbUser("member"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
    }))

    const { POST } = await import("./route")
    const res = await POST(makeRequest({ eventType: "document.uploaded", entityId: "doc-1" }) as any)
    expect(res.status).not.toBe(403)
    // No AI model configured (resolveModel's resolvedConfig is null) -- the
    // route's own honest fallback: a real 200 with default actions, not an
    // error, and definitely not the role gate.
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.eventType).toBe("document.uploaded")
    expect(Array.isArray(body.actions)).toBe(true)
    mock.restore()
  })
})
