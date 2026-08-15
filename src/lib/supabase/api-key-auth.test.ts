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

// VERIDIAN Review Framework gap-closure (2026-08-15, "API Developer
// Experience" -- Sandbox/test environment for API integrators): covers the
// DEMO_KEY_RATE_LIMIT_PER_MINUTE safety ceiling applied to demo/sandbox keys
// once they're allowlisted, independent of what the DB row itself says.
describe("validateApiKey: demo-key sandbox rate-limit ceiling", () => {
  const originalEnv = process.env.DEMO_API_KEY_IDS

  beforeEach(() => {
    process.env.DEMO_API_KEY_IDS = "projexa_demo_key"
  })

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.DEMO_API_KEY_IDS
    else process.env.DEMO_API_KEY_IDS = originalEnv
  })

  function mockDbForWithCount(row: Record<string, unknown> | undefined, count: number) {
    mock.module("@/lib/db", () => ({
      db: {
        query: { apiKeys: { findFirst: mock(async () => row) } },
        update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
        insert: () => ({ values: () => Promise.resolve() }),
        select: () => ({ from: () => ({ where: () => Promise.resolve([{ count }]) }) }),
      },
      apiKeys: {}, apiKeyRequestLog: {},
    }))
    mock.module("@/lib/api-keys", () => ({ hashSHA256: mock(async () => "hash-doesnt-matter") }))
  }

  test("an allowlisted demo key with rateLimitPerMinute: null (unlimited in the DB) is still capped at the sandbox ceiling", async () => {
    mockDbForWithCount(demoKeyRow({ rateLimitPerMinute: null }), 30)

    const { validateApiKey } = await import("./api-key-auth")
    const result = await validateApiKey(request())
    expect(result.status).toBe("rate_limited")
  })

  test("an allowlisted demo key under the sandbox ceiling still succeeds", async () => {
    mockDbForWithCount(demoKeyRow({ rateLimitPerMinute: null }), 5)

    const { validateApiKey } = await import("./api-key-auth")
    const result = await validateApiKey(request())
    expect(result.status).toBe("ok")
  })

  test("a demo key with a DB-configured limit stricter than the sandbox ceiling still uses the stricter DB limit", async () => {
    mockDbForWithCount(demoKeyRow({ rateLimitPerMinute: 5 }), 5)

    const { validateApiKey } = await import("./api-key-auth")
    const result = await validateApiKey(request())
    expect(result.status).toBe("rate_limited")
  })

  test("a real, non-demo key with rateLimitPerMinute: null is unaffected by the sandbox ceiling -- stays unlimited", async () => {
    mockDbForWithCount(
      { id: "a-real-provisioned-cuid-id", orgId: "org-1", name: "Real customer key", scopes: "read", rateLimitPerMinute: null, isActive: true },
      1000,
    )

    const { validateApiKey } = await import("./api-key-auth")
    const result = await validateApiKey(request())
    expect(result.status).toBe("ok")
  })
})
