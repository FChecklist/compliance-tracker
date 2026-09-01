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
      update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
      insert: () => ({ values: () => Promise.resolve() }),
      select: () => ({ from: () => ({ where: () => Promise.resolve([{ count: 0 }]) }) }),
    },
    apiKeys: {}, apiKeyRequestLog: {},
  }))
  // CRR-028 expand step: validateApiKey() now resolves the key via
  // lookupApiKeyByHash() (src/lib/db/preauth-lookups.ts, calls the
  // SECURITY DEFINER compliance.lookup_api_key_by_hash function) instead of
  // db.query.apiKeys.findFirst directly -- mock that module instead of
  // db.query so this suite exercises the real current call path rather than
  // a stale one.
  mock.module("@/lib/db/preauth-lookups", () => ({
    lookupApiKeyByHash: mock(async () => row ?? null),
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
        update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
        insert: () => ({ values: () => Promise.resolve() }),
        select: () => ({ from: () => ({ where: () => Promise.resolve([{ count }]) }) }),
      },
      apiKeys: {}, apiKeyRequestLog: {},
    }))
    // Same CRR-028 preauth-lookup call path as mockDbFor() above -- keep this
    // suite's mock shape consistent with the rest of the file's current
    // (post-CRR-028) mocking pattern rather than the older direct
    // db.query.apiKeys.findFirst shape.
    mock.module("@/lib/db/preauth-lookups", () => ({
      lookupApiKeyByHash: mock(async () => row ?? null),
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

// R43_EXEC_01 (Critical, closed as a false positive by R52/R56/R60 -- the
// row's own cross-org observation was an id-space mixup, not a real leak;
// see platform.r43_faults justification). No code fix landed for this row.
// What IS security-critical, and had zero regression coverage before this
// suite, is the invariant R52/R56/R60 actually verified by hand each time:
// validateApiKey() must resolve `context.orgId` ONLY from the DB row matched
// by the presented Bearer token's hash (via lookupApiKeyByHash) -- never
// from any other caller-controllable signal on the request (a header, a
// query param, etc.). If that ever stopped being true, PROJEXA's
// server-to-server calls (or any other API-key caller) could potentially
// assert a different tenant's orgId and this function would hand back
// another org's context, which is the exact cross-tenant leak this fault
// row worried about. This is a real regression guard, not a restatement of
// the existing demo-key-gate tests above: confirmed failing (asserts
// "org-attacker" but got "org-mine") against a deliberately introduced
// `x-org-id` header override patched into validateApiKey() locally, and
// passing again once that patch was reverted -- see PR description for the
// stash/restore output.
describe("validateApiKey: orgId comes only from the key-hash match (R43_EXEC_01 regression guard)", () => {
  test("an x-org-id header claiming a different tenant is ignored -- orgId still comes from the key's own row", async () => {
    mockDbFor({
      id: "real-key-mine",
      orgId: "org-mine",
      name: "My real key",
      scopes: "read",
      rateLimitPerMinute: null,
      isActive: true,
    })

    const { validateApiKey } = await import("./api-key-auth")
    const spoofedRequest = new Request("https://example.com/api/v1/projects", {
      headers: {
        authorization: "Bearer vk_test_token",
        // A naive implementation might trust a caller-supplied org header
        // for multi-tenant routing. validateApiKey() must never do this --
        // the only trustworthy source of orgId is the row the key's own
        // hash resolves to.
        "x-org-id": "org-attacker",
      },
    })
    const result = await validateApiKey(spoofedRequest)
    expect(result.status).toBe("ok")
    if (result.status === "ok") {
      expect(result.context.orgId).toBe("org-mine")
      expect(result.context.orgId).not.toBe("org-attacker")
    }
  })

  test("an orgId query parameter on the request URL is ignored -- orgId still comes from the key's own row", async () => {
    mockDbFor({
      id: "real-key-mine",
      orgId: "org-mine",
      name: "My real key",
      scopes: "read",
      rateLimitPerMinute: null,
      isActive: true,
    })

    const { validateApiKey } = await import("./api-key-auth")
    const spoofedRequest = new Request("https://example.com/api/v1/projects?orgId=org-attacker", {
      headers: { authorization: "Bearer vk_test_token" },
    })
    const result = await validateApiKey(spoofedRequest)
    expect(result.status).toBe("ok")
    if (result.status === "ok") {
      expect(result.context.orgId).toBe("org-mine")
      expect(result.context.orgId).not.toBe("org-attacker")
    }
  })

  test("two different keys (different hashes) resolve to their own, independent orgId -- no cross-key contamination", async () => {
    // Simulates two tenants' keys by re-mocking hashSHA256 to distinguish
    // the token, and lookupApiKeyByHash to return each key's own row only
    // for its own hash -- the closest a unit test can get to proving key A's
    // request can never come back with key B's orgId.
    mock.module("@/lib/db", () => ({
      db: {
        update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
        insert: () => ({ values: () => Promise.resolve() }),
        select: () => ({ from: () => ({ where: () => Promise.resolve([{ count: 0 }]) }) }),
      },
      apiKeys: {}, apiKeyRequestLog: {},
    }))
    mock.module("@/lib/api-keys", () => ({
      hashSHA256: mock(async (token: string) => `hash-of-${token}`),
    }))
    mock.module("@/lib/db/preauth-lookups", () => ({
      lookupApiKeyByHash: mock(async (hash: string) => {
        if (hash === "hash-of-vk_tenant_a_token") {
          return { id: "key-a", orgId: "org-a", name: "Tenant A key", scopes: "read", rateLimitPerMinute: null, isActive: true }
        }
        if (hash === "hash-of-vk_tenant_b_token") {
          return { id: "key-b", orgId: "org-b", name: "Tenant B key", scopes: "read", rateLimitPerMinute: null, isActive: true }
        }
        return null
      }),
    }))

    const { validateApiKey } = await import("./api-key-auth")
    const resultA = await validateApiKey(new Request("https://example.com/api/v1/projects", {
      headers: { authorization: "Bearer vk_tenant_a_token" },
    }))
    const resultB = await validateApiKey(new Request("https://example.com/api/v1/projects", {
      headers: { authorization: "Bearer vk_tenant_b_token" },
    }))

    expect(resultA.status).toBe("ok")
    expect(resultB.status).toBe("ok")
    if (resultA.status === "ok" && resultB.status === "ok") {
      expect(resultA.context.orgId).toBe("org-a")
      expect(resultB.context.orgId).toBe("org-b")
      expect(resultA.context.orgId).not.toBe(resultB.context.orgId)
    }
  })
})
