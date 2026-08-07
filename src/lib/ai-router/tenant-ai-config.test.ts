/// <reference types="bun-types" />
// Super Boss v2 plan task V2-5 (BYOB bring-your-own-AI-model, 2026-07-20):
// unit tests for resolveTenantAiConfig() -- the software_team-scope analog
// of orchestra-model-resolver.ts's resolveModelConfig(), the resolver that
// decrypts an org's own BYO AI model for runRole()/computeSoftwareTeam-
// Resolution(). This file covers the resolver's three documented branches
// (no active row -> null; inert row -> null; active+complete row -> decrypted
// config) and the encryption round-trip contract -- the task's DONE-CRITERIA
// "encryption round-trip" + "no-config fallback" tests.
//
// Matching this codebase's own established pattern (see
// orchestra-model-resolver.test.ts's header): resolveTenantAiConfig() is a
// DB-backed wrapper (it calls db.query.tenantAiConfig.findFirst and
// decrypts via ai-config-crypto.ts's pgcrypto round-trip), so the DB and the
// crypto module are mock.module()'d out -- this repo's CI runs `bun test`
// against a placeholder DATABASE_URL with no real Postgres behind it
// (.github/workflows/ci.yml), so a test that actually hit pgcrypto would
// hang there. The real pgcrypto encrypt/decrypt round-trip is exercised by
// the existing customerModelConfig BYO path that uses the IDENTICAL
// encryptApiKey/decryptApiKey functions; here the crypto module is mocked so
// the round-trip CONTRACT (ciphertext in -> plaintext out, key never
// returned to a client) is what's asserted, not the pgcrypto internals.
import { describe, test, expect, mock } from "bun:test"

// Minimal chainable mock for db.update(...).set(...).where(...).then(...)
// -- resolveTenantAiConfig's fire-and-forget lastUsedAt touch, the same
// shape orchestra-model-resolver.test.ts's mockDbUpdateChain() builds.
function mockDbUpdateChain() {
  const chain = {
    set: mock(() => chain),
    where: mock(() => chain),
    then: (resolve: (v: unknown) => void) => resolve(undefined),
  }
  return mock(() => chain)
}

// The named schema tables mother-router.ts imports directly from "@/lib/db"
// (line 54). The mock must provide these as real table-shaped objects so the
// module's top-level `import { ..., tenantAiConfig, ... }` binding succeeds;
// only `db.query.tenantAiConfig.findFirst` and `db.update` are actually
// exercised by resolveTenantAiConfig(), the rest are inert placeholders
// (same posture as task-register-service.test.ts's minimal db mock).
const inertTable = new Proxy({}, { get: () => () => {} })
async function loadResolverWith(dbQuery: { findFirst: ReturnType<typeof mock> }, decrypt: (c: string) => Promise<string>) {
  mock.module("@/lib/db", () => ({
    db: {
      query: { tenantAiConfig: { findFirst: dbQuery.findFirst } },
      update: mockDbUpdateChain(),
    },
    // mother-router.ts's direct named imports -- placeholder table shapes.
    aiRoutingPolicies: inertTable,
    aiRoutingAuditLog: inertTable,
    organisations: inertTable,
    subscriptionPlans: inertTable,
    users: inertTable,
    tenantAiConfig: inertTable,
  }))
  mock.module("@/lib/ai-config-crypto", () => ({ decryptApiKey: mock(decrypt) }))
  // cost-guard.ts imports tokenUsageLedger from "@/lib/db" at module load;
  // mocking it (as orchestra-model-resolver.test.ts does) keeps cost-guard's
  // body from running against our partial @/lib/db mock.
  mock.module("@/lib/cost-guard", () => ({ canIncurCost: mock(async () => ({ allowed: true })) }))
  // Re-import fresh so the mocked bindings take effect (module cache).
  return import("./mother-router")
}

describe("resolveTenantAiConfig (V2-5 BYOB, software_team scope)", () => {
  // NO-CONFIG FALLBACK: the org has no active row (or the dispatch carries no
  // org context, which the caller short-circuits to a null resolve before
  // even calling this). Returns null -> the caller resolves exactly as
  // before, no tenant override applied. This is the "zero behavior change for
  // orgs that don't configure a BYO model" guarantee.
  test("no active row: returns null (no-config fallback)", async () => {
    const { resolveTenantAiConfig } = await loadResolverWith(
      { findFirst: mock(async () => undefined) },
      async () => "should-not-be-called",
    )
    const result = await resolveTenantAiConfig("org-no-row")
    expect(result).toBeNull()
  })

  // INERT-ROW GATE (mirrors resolveModelConfig's own
  // `customerConfig?.encryptedApiKey && modelName` check): an admin can save
  // provider/model first and add the key in a follow-up edit; that
  // half-configured row must NEVER be "used" -- it returns null and falls
  // through to the platform default, so a row with no key never attempts a
  // provider call that would obviously fail.
  test("inert row (model set, no key): returns null, never decrypts", async () => {
    const decrypt = mock(async () => "should-not-be-called")
    const { resolveTenantAiConfig } = await loadResolverWith(
      { findFirst: mock(async () => ({ id: "r1", orgId: "org-1", provider: "openrouter", modelName: "z-ai/glm-5.2", encryptedApiKey: null, baseUrl: null, isActive: true })) },
      decrypt,
    )
    const result = await resolveTenantAiConfig("org-1")
    expect(result).toBeNull()
    expect(decrypt).toHaveBeenCalledTimes(0)
  })

  test("inert row (key set, no model): returns null, never decrypts", async () => {
    const decrypt = mock(async () => "should-not-be-called")
    const { resolveTenantAiConfig } = await loadResolverWith(
      { findFirst: mock(async () => ({ id: "r2", orgId: "org-1", provider: "openrouter", modelName: null, encryptedApiKey: "ciphertext", baseUrl: null, isActive: true })) },
      decrypt,
    )
    const result = await resolveTenantAiConfig("org-1")
    expect(result).toBeNull()
    expect(decrypt).toHaveBeenCalledTimes(0)
  })

  // ACTIVE ROW: a complete active row is decrypted and returned with the
  // tenant's own model + decrypted key + baseUrl. The key is the DECRYPTED
  // plaintext (never the ciphertext) -- this is the contract runRole() relies
  // on to actually call the provider, and the contract the API route
  // protects by never echoing it back to a client.
  test("active complete row: decrypts key, returns tenant model+key+baseUrl", async () => {
    const decrypt = mock(async (c: string) => `decrypted:${c}`)
    const { resolveTenantAiConfig } = await loadResolverWith(
      { findFirst: mock(async () => ({ id: "r3", orgId: "org-1", provider: "openrouter", modelName: "z-ai/glm-5.2", encryptedApiKey: "ct-1", baseUrl: "https://gw.example/v1", isActive: true })) },
      decrypt,
    )
    const result = await resolveTenantAiConfig("org-1")
    expect(result).not.toBeNull()
    expect(result!.provider).toBe("openrouter")
    expect(result!.model).toBe("z-ai/glm-5.2")
    expect(result!.apiKey).toBe("decrypted:ct-1") // plaintext, not ciphertext
    expect(result!.baseUrl).toBe("https://gw.example/v1")
    expect(decrypt).toHaveBeenCalledTimes(1)
  })

  test("active row with null baseUrl: returns baseUrl null (provider default applies downstream)", async () => {
    const { resolveTenantAiConfig } = await loadResolverWith(
      { findFirst: mock(async () => ({ id: "r4", orgId: "org-1", provider: "openrouter", modelName: "z-ai/glm-5.2", encryptedApiKey: "ct-1", baseUrl: null, isActive: true })) },
      async (c) => `decrypted:${c}`,
    )
    const result = await resolveTenantAiConfig("org-1")
    expect(result!.baseUrl).toBeNull()
  })

  // ENCRYPTION ROUND-TRIP CONTRACT: the resolver stores ciphertext and
  // returns plaintext -- it never returns the ciphertext as the key, and it
  // never skips decryption. A round-trip here means: the ciphertext read
  // from the row is the value passed to decryptApiKey, and the value
  // decryptApiKey returns is the value placed in result.apiKey. This is the
  // shape the real pgcrypto round-trip (encryptApiKey then decryptApiKey)
  // preserves, asserted at the contract level since the pgcrypto internals
  // are out of CI's scope (no real Postgres in CI, per ci.yml).
  test("encryption round-trip contract: ciphertext from row -> plaintext to caller, identity preserved by mock", async () => {
    const decrypt = mock(async (c: string) => `PLAIN(${c})`)
    const { resolveTenantAiConfig } = await loadResolverWith(
      { findFirst: mock(async () => ({ id: "r5", orgId: "org-1", provider: "openrouter", modelName: "z-ai/glm-5.2", encryptedApiKey: "CIPHERTEXT", baseUrl: null, isActive: true })) },
      decrypt,
    )
    const result = await resolveTenantAiConfig("org-1")
    // The ciphertext stored on the row is what decrypt receives...
    expect(decrypt.mock.calls[0][0]).toBe("CIPHERTEXT")
    // ...and what decrypt returns is the plaintext the caller gets -- a
    // faithful round-trip, never the raw ciphertext leaked back.
    expect(result!.apiKey).toBe("PLAIN(CIPHERTEXT)")
    expect(result!.apiKey).not.toBe("CIPHERTEXT")
  })
})
