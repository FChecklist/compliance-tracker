/// <reference types="bun-types" />
// Wave A (VERIDIAN Review Framework remediation, 2026-07-17, security/bug
// quick-fix item 1): this file had zero test coverage before this wave.
// Covers validateApiKey()'s new demo-key environment gate (KNOWN_DEMO_KEY_IDS
// + DEMO_API_KEY_IDS allowlist) with `@/lib/db` mock.module()'d out, matching
// orchestra-model-resolver.test.ts's established pattern for this kind of
// dependency (never touching a live DB from a .test.ts file).
import { describe, test, expect, mock, afterEach, beforeEach } from "bun:test"

function mockDbFor(row: Record<string, unknown> | undefined) {
  mock.module("@/lib/db", () => ({
    db: {
      query: { apiKeys: { findFirst: mock(async () => row) } },
      update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
      insert: () => ({ values: () => Promise.resolve() }),
      select: () => ({ from: () => ({ where: () => Promise.resolve([{ count: 0 }]) }) }),
    },
    apiKeys: {}, apiKeyRequestLog: {},
  }))
  mock.module("@/lib/api-keys", () => ({ hashSHA256: mock(async () => "hash-doesnt-matter") }))
}

function demoKeyRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "projexa_demo_key",
    orgId: "projexa_demo_org",
    name: "PROJEXA Frontend Service Key",
    scopes: "read,write",
    rateLimitPerMinute: null,
    isActive: true,
    ...overrides,
  }
}

function request() {
  return new Request("https://example.com/api/v1/whatever", {
    headers: { authorization: "Bearer vk_test_token" },
  })
}

describe("validateApiKey: demo-key environment gate", () => {
  const originalEnv = process.env.DEMO_API_KEY_IDS

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.DEMO_API_KEY_IDS
    else process.env.DEMO_API_KEY_IDS = originalEnv
  })

  test("rejects the known demo key (projexa_demo_key) when DEMO_API_KEY_IDS is unset -- the current production default", async () => {
    delete process.env.DEMO_API_KEY_IDS
    mockDbFor(demoKeyRow())

    const { validateApiKey } = await import("./api-key-auth")
    const result = await validateApiKey(request())
    expect(result.status).toBe("invalid")
  })

  test("rejects the known demo key when DEMO_API_KEY_IDS is set to unrelated ids", async () => {
    process.env.DEMO_API_KEY_IDS = "some_other_key,another_key"
    mockDbFor(demoKeyRow())

    const { validateApiKey } = await import("./api-key-auth")
    const result = await validateApiKey(request())
    expect(result.status).toBe("invalid")
  })

  test("allows the known demo key once explicitly allowlisted via DEMO_API_KEY_IDS", async () => {
    process.env.DEMO_API_KEY_IDS = "projexa_demo_key"
    mockDbFor(demoKeyRow())

    const { validateApiKey } = await import("./api-key-auth")
    const result = await validateApiKey(request())
    expect(result.status).toBe("ok")
    if (result.status === "ok") {
      expect(result.context.orgId).toBe("projexa_demo_org")
    }
  })

  test("a real, non-demo key is completely unaffected by this gate regardless of DEMO_API_KEY_IDS", async () => {
    delete process.env.DEMO_API_KEY_IDS
    mockDbFor({
      id: "a-real-provisioned-cuid-id",
      orgId: "org-1",
      name: "Real customer key",
      scopes: "read",
      rateLimitPerMinute: null,
      isActive: true,
    })

    const { validateApiKey } = await import("./api-key-auth")
    const result = await validateApiKey(request())
    expect(result.status).toBe("ok")
  })

  test("an inactive/missing key is still rejected as invalid, unrelated to the demo-key gate", async () => {
    mockDbFor(undefined)
    const { validateApiKey } = await import("./api-key-auth")
    const result = await validateApiKey(request())
    expect(result.status).toBe("invalid")
  })
})
