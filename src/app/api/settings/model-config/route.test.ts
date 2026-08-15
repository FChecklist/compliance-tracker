/// <reference types="bun-types" />
// VERIDIAN Review Framework gap-closure, AI Platform / BYOAI: "not all 6
// supported providers are equally validated/tested for BYO keys."
//
// PR #384 already added the real connectivity check
// (testProviderConnection(), src/lib/orchestra-model-resolver.ts) that runs
// before a BYO config is persisted, and orchestra-model-resolver.test.ts
// covers that function directly -- but only with openai/groq mock fetches,
// and never through this route's own POST handler (auth/role gate,
// VALID_PROVIDERS allow-list, existing-key-reuse-on-update, persist-after-
// successful-test flow). This file closes that gap: it hits the actual
// route module (dynamic import, same pattern as
// settings/branding/route.test.ts) with a mock key per BYO-eligible
// provider, mocking only the collaborators (auth-guard, tenant-scoped DB,
// ai-config-crypto, orchestra-model-resolver) -- not a live DB or a real
// third-party network call.
//
// Provider-count note: llm-client.ts's LLMProvider type has 6 values
// (groq/openai/anthropic/google/openrouter/cerebras), but this route's own
// VALID_PROVIDERS allow-list only has 4 -- openrouter/cerebras are
// platform-internal-only providers (floor-tier failover), never exposed as
// a BYO choice here; inserting "cerebras" would also violate the Postgres
// `ai_provider` enum (schema.ts), which itself only has 5 values (no
// cerebras). So "one test per BYO-eligible provider" below means all 4,
// plus explicit coverage that the non-BYO-eligible values are correctly
// rejected rather than silently accepted.
import { describe, test, expect, mock, afterEach } from "bun:test"

const BYO_PROVIDERS = [
  { provider: "groq", model: "openai/gpt-oss-120b", key: "gsk-mock-groq-key" },
  { provider: "openai", model: "gpt-4o-mini", key: "sk-mock-openai-key" },
  { provider: "anthropic", model: "claude-haiku-4-5", key: "sk-ant-mock-key" },
  { provider: "google", model: "gemini-2.5-flash", key: "AIza-mock-google-key" },
] as const

function dbUser(role: string) {
  return { id: "user-1", role, orgId: "org-1" } as any
}

function fakeRequireRole(user: any, minimumRole: string) {
  const RANK: Record<string, number> = { viewer: 1, member: 2, manager: 3, branch_manager: 4, admin: 5, veridian_admin: 6 }
  const userRank = RANK[user?.role] ?? 0
  const requiredRank = RANK[minimumRole] ?? 99
  if (userRank < requiredRank) {
    return new Response(JSON.stringify({ error: `This action requires ${minimumRole} role or higher` }), { status: 403 }) as any
  }
  return null
}

function makePostRequest(body: unknown): Request {
  return new Request("http://localhost/api/settings/model-config", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

// Builds a fake tenant-scoped db whose query surface matches exactly what
// route.ts calls: db.query.customerModelConfig.findFirst/findMany,
// db.query.orchestraLayers.findMany, db.update(...).set(...).where(...)
// .returning(), db.insert(...).values(...).returning().
function fakeDb(opts: { existing?: any; layers?: any[]; configs?: any[] }) {
  const updateCalls: any[] = []
  const insertCalls: any[] = []
  return {
    updateCalls,
    insertCalls,
    query: {
      customerModelConfig: {
        findFirst: mock(async () => opts.existing ?? undefined),
        findMany: mock(async () => opts.configs ?? []),
      },
      orchestraLayers: {
        findMany: mock(async () => opts.layers ?? []),
      },
    },
    update: mock((_table: unknown) => ({
      set: (patch: unknown) => ({
        where: (_cond: unknown) => ({
          returning: async () => {
            updateCalls.push(patch)
            return [{ id: opts.existing?.id ?? "cfg-updated", orchestraLayerId: null, ...opts.existing, ...(patch as object) }]
          },
        }),
      }),
    })),
    insert: mock((_table: unknown) => ({
      values: (row: unknown) => ({
        returning: async () => {
          insertCalls.push(row)
          return [{ id: "cfg-new", ...(row as object) }]
        },
      }),
    })),
  }
}

function mockCollaborators(db: ReturnType<typeof fakeDb>, testResult: { ok: true } | { ok: false; error: string }, role = "admin") {
  const testProviderConnection = mock(async () => testResult)
  const encryptApiKey = mock(async (plaintext: string) => `enc:${plaintext}`)
  const decryptApiKey = mock(async (ciphertext: string) => ciphertext.replace(/^enc:/, ""))
  mock.module("@/lib/supabase/auth-guard", () => ({
    requireAuth: mock(async () => ({ response: null, dbUser: dbUser(role), orgId: "org-1" })),
    requireRole: fakeRequireRole,
  }))
  mock.module("@/lib/db/tenant-scoped", () => ({
    withTenantContext: mock(async (_ctx: unknown, fn: (db: unknown) => Promise<unknown>) => fn(db)),
  }))
  mock.module("@/lib/ai-config-crypto", () => ({ encryptApiKey, decryptApiKey }))
  mock.module("@/lib/orchestra-model-resolver", () => ({ testProviderConnection }))
  return { testProviderConnection, encryptApiKey, decryptApiKey }
}

afterEach(() => {
  mock.restore()
})

describe("POST /api/settings/model-config -- one connectivity-tested mock key per BYO provider", () => {
  for (const { provider, model, key } of BYO_PROVIDERS) {
    test(`${provider}: a valid mock key passes the connectivity test and the config is persisted`, async () => {
      const db = fakeDb({})
      const { testProviderConnection } = mockCollaborators(db, { ok: true })

      const { POST } = await import("./route")
      const res = await POST(makePostRequest({ provider, modelName: model, apiKey: key }) as any)

      expect(res.status).toBe(200)
      expect(testProviderConnection).toHaveBeenCalledTimes(1)
      expect(testProviderConnection.mock.calls[0]).toEqual([provider, model, key])
      expect(db.insertCalls).toHaveLength(1)
      expect(db.insertCalls[0].provider).toBe(provider)
      expect(db.insertCalls[0].encryptedApiKey).toBe(`enc:${key}`)

      const body = await res.json()
      expect(body.provider).toBe(provider)
      expect(body.hasKey).toBe(true)
      // never echoes the raw or encrypted key back to the client
      expect(JSON.stringify(body)).not.toContain(key)
      expect(JSON.stringify(body)).not.toContain("enc:")
    })

    test(`${provider}: a rejected mock key (connectivity test fails) is never persisted`, async () => {
      const db = fakeDb({})
      const { testProviderConnection } = mockCollaborators(db, { ok: false, error: "invalid api key" })

      const { POST } = await import("./route")
      const res = await POST(makePostRequest({ provider, modelName: model, apiKey: key }) as any)

      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toContain("invalid api key")
      expect(testProviderConnection).toHaveBeenCalledTimes(1)
      expect(db.insertCalls).toHaveLength(0)
    })
  }

  test("a provider outside the BYO allow-list (cerebras -- platform-internal only) is rejected before any connectivity test", async () => {
    const db = fakeDb({})
    const { testProviderConnection } = mockCollaborators(db, { ok: true })

    const { POST } = await import("./route")
    const res = await POST(makePostRequest({ provider: "cerebras", modelName: "gpt-oss-120b", apiKey: "csk-mock" }) as any)

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain("provider must be one of")
    expect(testProviderConnection).not.toHaveBeenCalled()
    expect(db.insertCalls).toHaveLength(0)
  })

  test("a provider outside the BYO allow-list (openrouter -- platform fallback only) is rejected before any connectivity test", async () => {
    const db = fakeDb({})
    const { testProviderConnection } = mockCollaborators(db, { ok: true })

    const { POST } = await import("./route")
    const res = await POST(makePostRequest({ provider: "openrouter", modelName: "meta-llama/llama-3.3-70b-instruct:free", apiKey: "or-mock" }) as any)

    expect(res.status).toBe(400)
    expect(testProviderConnection).not.toHaveBeenCalled()
    expect(db.insertCalls).toHaveLength(0)
  })

  test("an unrecognized provider string is rejected the same way", async () => {
    const db = fakeDb({})
    mockCollaborators(db, { ok: true })

    const { POST } = await import("./route")
    const res = await POST(makePostRequest({ provider: "azure", modelName: "gpt-4o", apiKey: "az-mock" }) as any)

    expect(res.status).toBe(400)
    expect(db.insertCalls).toHaveLength(0)
  })

  test("a blank modelName is rejected before any connectivity test", async () => {
    const db = fakeDb({})
    const { testProviderConnection } = mockCollaborators(db, { ok: true })

    const { POST } = await import("./route")
    const res = await POST(makePostRequest({ provider: "groq", modelName: "   ", apiKey: "gsk-mock" }) as any)

    expect(res.status).toBe(400)
    expect(testProviderConnection).not.toHaveBeenCalled()
  })

  test("updating modelName with no new apiKey reuses and decrypts the existing stored key for the connectivity test", async () => {
    const existing = {
      id: "cfg-1", orgId: "org-1", orchestraLayerId: null,
      provider: "openai", modelName: "gpt-4o-mini", encryptedApiKey: "enc:sk-existing-key",
      isActive: true, sharedPoolEligible: false,
    }
    const db = fakeDb({ existing })
    const { testProviderConnection, decryptApiKey } = mockCollaborators(db, { ok: true })

    const { POST } = await import("./route")
    const res = await POST(makePostRequest({ provider: "openai", modelName: "gpt-4o" }) as any)

    expect(res.status).toBe(200)
    expect(decryptApiKey).toHaveBeenCalledWith("enc:sk-existing-key")
    expect(testProviderConnection.mock.calls[0]).toEqual(["openai", "gpt-4o", "sk-existing-key"])
    // update path, not insert -- an existing row for this org/layer was found
    expect(db.updateCalls).toHaveLength(1)
    expect(db.insertCalls).toHaveLength(0)
    // the patch itself must not carry a new encryptedApiKey (no apiKey was supplied)
    expect(db.updateCalls[0].encryptedApiKey).toBeUndefined()
  })

  test("member (below admin) is rejected with 403 and no connectivity test runs", async () => {
    const db = fakeDb({})
    const { testProviderConnection } = mockCollaborators(db, { ok: true }, "member")

    const { POST } = await import("./route")
    const res = await POST(makePostRequest({ provider: "groq", modelName: "openai/gpt-oss-120b", apiKey: "gsk-mock" }) as any)

    expect(res.status).toBe(403)
    expect(testProviderConnection).not.toHaveBeenCalled()
  })

  test("admin is allowed through", async () => {
    const db = fakeDb({})
    mockCollaborators(db, { ok: true }, "admin")

    const { POST } = await import("./route")
    const res = await POST(makePostRequest({ provider: "groq", modelName: "openai/gpt-oss-120b", apiKey: "gsk-mock" }) as any)

    expect(res.status).toBe(200)
  })
})

describe("GET /api/settings/model-config", () => {
  test("returns layers and configs with hasKey booleans only -- never a raw/encrypted key", async () => {
    const db = fakeDb({
      layers: [{ id: "layer-1", layerKey: "task_oa", name: "Task Orchestra", layerOrder: 1 }],
      configs: [
        { id: "cfg-1", orchestraLayerId: "layer-1", provider: "openai", modelName: "gpt-4o-mini", encryptedApiKey: "enc:sk-secret", isActive: true, sharedPoolEligible: false },
        { id: "cfg-2", orchestraLayerId: null, provider: "groq", modelName: "openai/gpt-oss-120b", encryptedApiKey: null, isActive: true, sharedPoolEligible: false },
      ],
    })
    mockCollaborators(db, { ok: true })

    const { GET } = await import("./route")
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.layers).toHaveLength(1)
    expect(body.configs).toHaveLength(2)
    expect(body.configs[0].hasKey).toBe(true)
    expect(body.configs[1].hasKey).toBe(false)
    expect(JSON.stringify(body)).not.toContain("sk-secret")
    expect(JSON.stringify(body)).not.toContain("enc:")
  })

  test("no organisation on the account returns 400, not a crash", async () => {
    mock.module("@/lib/supabase/auth-guard", () => ({
      requireAuth: mock(async () => ({ response: null, dbUser: dbUser("admin"), orgId: null })),
      requireRole: fakeRequireRole,
    }))
    mock.module("@/lib/db/tenant-scoped", () => ({ withTenantContext: mock(async () => { throw new Error("should not reach the DB without an orgId") }) }))
    mock.module("@/lib/ai-config-crypto", () => ({ encryptApiKey: mock(async () => ""), decryptApiKey: mock(async () => "") }))
    mock.module("@/lib/orchestra-model-resolver", () => ({ testProviderConnection: mock(async () => ({ ok: true })) }))

    const { GET } = await import("./route")
    const res = await GET()
    expect(res.status).toBe(400)
  })
})
