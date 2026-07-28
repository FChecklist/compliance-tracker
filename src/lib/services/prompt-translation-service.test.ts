// VERIDIAN_Architecture_v2.0 phase_8 (2026-07-28): engine-prompt-translation.
// Matches this repo's established "never a live DB from a .test.ts file"
// discipline (prompt-governance-gates.test.ts / asset-routing-engine.test.ts)
// -- mocks @/lib/db, @/lib/orchestra-model-resolver, @/lib/llm-client and
// dynamically imports the module under test so Bun substitutes every mock,
// including the ones the service itself resolves at call time.
/// <reference types="bun-types" />
import { describe, expect, test, mock, afterEach } from "bun:test"

const ADMIN_USER = { id: "user-1", role: "veridian_admin", orgId: "org-1" } as any
const CTX = { userId: ADMIN_USER.id, dbUser: ADMIN_USER }

function buildMockDb(opts: { version?: any; existingTranslation?: any; insertedRow?: any; updatedRow?: any }) {
  const findFirstCalls: string[] = []
  let translationFindFirstCallCount = 0
  const promptVersionsFindFirst = mock(async () => opts.version)
  const promptTranslationsFindFirst = mock(async () => {
    translationFindFirstCallCount++
    findFirstCalls.push("translations")
    return opts.existingTranslation
  })
  const insertValues = mock(() => ({ returning: mock(async () => [opts.insertedRow]) }))
  const insert = mock(() => ({ values: insertValues }))
  const updateWhere = mock(() => ({ returning: mock(async () => [opts.updatedRow]) }))
  const updateSet = mock(() => ({ where: updateWhere }))
  const update = mock(() => ({ set: updateSet }))

  return {
    db: {
      query: {
        promptVersions: { findFirst: promptVersionsFindFirst },
        promptTranslations: { findFirst: promptTranslationsFindFirst },
      },
      insert,
      update,
    },
    promptVersions: {},
    promptTranslations: {},
    insert,
    update,
    promptVersionsFindFirst,
    promptTranslationsFindFirst,
    get translationFindFirstCallCount() { return translationFindFirstCallCount },
  }
}

async function setup(opts: Parameters<typeof buildMockDb>[0] & { modelConfig?: any; llmResult?: any }) {
  const dbMocks = buildMockDb(opts)
  // Spread the real module first -- compliance-service.ts (which
  // prompt-translation-service.ts imports ServiceError from) named-imports
  // auditLogs/complianceItems/etc. from "@/lib/db" too, and a mock.module()
  // factory replaces the whole module namespace, so omitting those would
  // break that unrelated import at evaluation time even though this test
  // never exercises those code paths. `db` itself is safe to import for
  // real here -- it's a lazy Proxy (db/index.ts) that opens no connection
  // until a query actually runs, and we override it below anyway.
  const actualDb = await import("@/lib/db")
  await mock.module("@/lib/db", () => ({ ...actualDb, ...dbMocks }))
  await mock.module("@/lib/orchestra-model-resolver", () => ({
    resolvePlatformModelConfig: mock(async () => "modelConfig" in opts ? opts.modelConfig : { provider: "groq", model: "llama-test", apiKey: "key", isCustomerConfigured: false }),
  }))
  await mock.module("@/lib/llm-client", () => ({
    callLLMJson: mock(async () => opts.llmResult ?? { data: { translatedContent: "contenu traduit" }, usage: {}, durationMs: 10 }),
  }))
  return dbMocks
}

afterEach(() => {
  mock.restore()
})

describe("translatePromptVersion", () => {
  test("rejects an unknown locale before touching the DB or an LLM", async () => {
    await setup({ version: { id: "v1", content: "Hello" } })
    const { translatePromptVersion, ServiceError } = await import("./prompt-translation-service")
    await expect(translatePromptVersion(CTX, { versionId: "v1", targetLocale: "xx" })).rejects.toThrow(ServiceError)
  })

  test("404s for an unknown prompt version", async () => {
    await setup({ version: undefined })
    const { translatePromptVersion } = await import("./prompt-translation-service")
    await expect(translatePromptVersion(CTX, { versionId: "missing", targetLocale: "fr" })).rejects.toThrow(/Unknown prompt version/)
  })

  test("returns the cached translation instead of calling the LLM again", async () => {
    const cached = { id: "t1", promptVersionId: "v1", locale: "fr", translatedContent: "cached", provider: "groq", model: "llama", createdAt: new Date() }
    const dbMocks = await setup({ version: { id: "v1", content: "Hello" }, existingTranslation: cached })
    const { translatePromptVersion } = await import("./prompt-translation-service")

    const result = await translatePromptVersion(CTX, { versionId: "v1", targetLocale: "fr" })

    expect(result.translatedContent).toBe("cached")
    expect(dbMocks.insert).not.toHaveBeenCalled()
  })

  test("calls the LLM and persists a new translation when none is cached", async () => {
    const inserted = { id: "t2", promptVersionId: "v1", locale: "fr", translatedContent: "contenu traduit", provider: "groq", model: "llama-test", createdAt: new Date() }
    const dbMocks = await setup({ version: { id: "v1", content: "Hello {{name}}" }, existingTranslation: undefined, insertedRow: inserted })
    const { translatePromptVersion } = await import("./prompt-translation-service")

    const result = await translatePromptVersion(CTX, { versionId: "v1", targetLocale: "fr" })

    expect(result.translatedContent).toBe("contenu traduit")
    expect(dbMocks.insert).toHaveBeenCalled()
  })

  test("force=true re-translates and updates the existing row instead of inserting", async () => {
    const existing = { id: "t1", promptVersionId: "v1", locale: "fr", translatedContent: "old", provider: "groq", model: "llama", createdAt: new Date() }
    const updated = { ...existing, translatedContent: "contenu traduit" }
    const dbMocks = await setup({ version: { id: "v1", content: "Hello" }, existingTranslation: existing, updatedRow: updated })
    const { translatePromptVersion } = await import("./prompt-translation-service")

    const result = await translatePromptVersion(CTX, { versionId: "v1", targetLocale: "fr", force: true })

    expect(result.translatedContent).toBe("contenu traduit")
    expect(dbMocks.update).toHaveBeenCalled()
    expect(dbMocks.insert).not.toHaveBeenCalled()
  })

  test("throws when no AI model is configured", async () => {
    await setup({ version: { id: "v1", content: "Hello" }, existingTranslation: undefined, modelConfig: null })
    const { translatePromptVersion } = await import("./prompt-translation-service")
    await expect(translatePromptVersion(CTX, { versionId: "v1", targetLocale: "fr" })).rejects.toThrow(/No AI model configured/)
  })
})
