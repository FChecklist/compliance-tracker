/// <reference types="bun-types" />
// R75 Part 2 Phase 5 (G5 misc gap-closure). POST /api/help/ask had NO role
// gate at all. Fixed to require "member" -- a low-stakes, broadly-available,
// read-only in-app help/support Q&A grounded on the org's own KB pages, no
// writes, no financial data -- matching the "member" floor already
// established for a broadly-available AI call over org data
// (construction/ai/estimate-progress, reports/ai-builder/analyze).
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

function makeRequest(): Request {
  return new Request("http://localhost/api/help/ask", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question: "How do I upload a document?", currentPath: "/documents" }),
  })
}

function mockEverythingExceptAuthAndTemplate(opts: { resolvePromptTemplate: any; getPreferredAiResponseLocale: any }) {
  mock.module("@/lib/prompt-os-resolver", () => ({ resolvePromptTemplate: opts.resolvePromptTemplate }))
  mock.module("@/lib/ai-response-locale", () => ({ getPreferredAiResponseLocale: opts.getPreferredAiResponseLocale }))
  mock.module("@/lib/orchestra-model-resolver", () => ({
    resolveModelConfig: mock(async () => { throw new Error("resolveModelConfig should not be reached in this test") }),
  }))
  mock.module("@/lib/prompt-security", () => ({
    runDefenseInDepth: mock(async () => { throw new Error("runDefenseInDepth should not be reached in this test") }),
  }))
  mock.module("@/lib/policy-enforcement-engine", () => ({
    enforcePolicy: mock(() => { throw new Error("enforcePolicy should not be reached in this test") }),
    refusalMessageFor: mock(() => "refused"),
  }))
  mock.module("@/lib/purpose-bound-ai", () => ({ DEFAULT_DOMAIN: "compliance" }))
  mock.module("@/lib/services/knowledge-base-service", () => ({
    retrieveRelevantKbPages: mock(async () => []),
  }))
  mock.module("@/lib/prompt-normalizer", () => ({ normalizeForLlm: (s: string) => s }))
  mock.module("@/lib/ai-reply-gate", () => ({ passesReplyGate: () => ({ passed: true }) }))
  mock.module("@/lib/pii-redaction", () => ({ redactPii: (s: string) => s }))
  mock.module("@/lib/orchestra-execution-logger", () => ({ recordOrchestraExecution: mock(() => {}) }))
  mock.module("@/lib/prompt-cache/compiler", () => ({ compileStaticPrefix: () => ({ fingerprint: "fp" }) }))
  mock.module("@/lib/prompt-cache/metrics", () => ({ recordPromptCacheMetric: mock(() => {}) }))
}

describe("POST /api/help/ask (access control)", () => {
  test("a viewer (below member) is rejected with 403 and the help pipeline is never reached", async () => {
    const resolvePromptTemplate = mock(async () => { throw new Error("resolvePromptTemplate should not be called for a below-role caller") })
    const getPreferredAiResponseLocale = mock(async () => { throw new Error("getPreferredAiResponseLocale should not be called for a below-role caller") })
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ user: { id: "auth-1" }, response: null, dbUser: dbUser("viewer"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
    }))
    mockEverythingExceptAuthAndTemplate({ resolvePromptTemplate, getPreferredAiResponseLocale })

    const { POST } = await import("./route")
    const res = await POST(makeRequest() as any)
    expect(res.status).toBe(403)
    expect(resolvePromptTemplate).not.toHaveBeenCalled()
    expect(getPreferredAiResponseLocale).not.toHaveBeenCalled()
    mock.restore()
  })

  test("a member-rank user passes the role gate (reaches the help pipeline, not blocked with 403)", async () => {
    const getPreferredAiResponseLocale = mock(async () => "en")
    // Throws so the route's own catch returns its documented 200 fallback
    // ("help assistant is not fully configured yet") without needing every
    // downstream AI/KB module mocked out -- the only thing this test proves
    // is that the role gate did not block a member-rank caller.
    const resolvePromptTemplate = mock(async () => { throw new Error("no prompt template seeded in this test") })
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ user: { id: "auth-1" }, response: null, dbUser: dbUser("member"), orgId: "org-1" })),
      requireRole: fakeRequireRole,
    }))
    mockEverythingExceptAuthAndTemplate({ resolvePromptTemplate, getPreferredAiResponseLocale })

    const { POST } = await import("./route")
    const res = await POST(makeRequest() as any)
    expect(res.status).not.toBe(403)
    expect(resolvePromptTemplate).toHaveBeenCalledTimes(1)
    mock.restore()
  })
})
