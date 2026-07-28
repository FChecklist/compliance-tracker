// VERIDIAN_Architecture_v2.0 phase_8 (2026-07-28): engine-prompt-localization.
// Same "never a live DB from a .test.ts file" discipline as
// prompt-translation-service.test.ts. Also covers localeFormattingSamples()
// directly (pure, no mocking) -- the real, non-fabricated Intl-derived
// ground truth this service grounds its LLM call in.
/// <reference types="bun-types" />
import { describe, expect, test, mock, afterEach } from "bun:test"

const ADMIN_USER = { id: "user-1", role: "veridian_admin", orgId: "org-1" } as any
const CTX = { userId: ADMIN_USER.id, dbUser: ADMIN_USER }

afterEach(() => {
  mock.restore()
})

describe("localeFormattingSamples (pure, real Intl output, no mocking)", () => {
  test("produces distinct date formatting for en-US vs en-GB", async () => {
    const { localeFormattingSamples } = await import("./prompt-localization-service")
    const us = localeFormattingSamples("en-US")
    const gb = localeFormattingSamples("en-GB")
    expect(us.date).not.toBe(gb.date) // MM/DD/YYYY vs DD/MM/YYYY -- a real, verifiable difference
  })

  test("produces a real currency-formatted sample", async () => {
    const { localeFormattingSamples } = await import("./prompt-localization-service")
    const samples = localeFormattingSamples("en-US")
    expect(samples.currency).toContain("$")
  })
})

function buildMockDb(opts: { translation?: any; existingLocalization?: any; insertedRow?: any; updatedRow?: any }) {
  const promptTranslationsFindFirst = mock(async () => opts.translation)
  const promptLocalizationsFindFirst = mock(async () => opts.existingLocalization)
  const insertValues = mock(() => ({ returning: mock(async () => [opts.insertedRow]) }))
  const insert = mock(() => ({ values: insertValues }))
  const updateWhere = mock(() => ({ returning: mock(async () => [opts.updatedRow]) }))
  const updateSet = mock(() => ({ where: updateWhere }))
  const update = mock(() => ({ set: updateSet }))

  return {
    db: {
      query: {
        promptTranslations: { findFirst: promptTranslationsFindFirst },
        promptLocalizations: { findFirst: promptLocalizationsFindFirst },
      },
      insert, update,
    },
    promptTranslations: {}, promptLocalizations: {},
    insert, update,
  }
}

async function setup(opts: Parameters<typeof buildMockDb>[0] & { modelConfig?: any; llmResult?: any; translateResult?: any }) {
  const dbMocks = buildMockDb(opts)
  // Spread the real module first -- compliance-service.ts (ServiceError's
  // home, imported transitively via prompt-translation-service.ts) named-
  // imports auditLogs/complianceItems/etc. from "@/lib/db" too, and a
  // mock.module() factory replaces the whole module namespace, so omitting
  // those breaks that unrelated import at evaluation time. `db` is a lazy
  // Proxy (db/index.ts) that opens no connection on import, so importing
  // the real module here is safe -- we override `db` below anyway.
  const actualDb = await import("@/lib/db")
  await mock.module("@/lib/db", () => ({ ...actualDb, ...dbMocks }))
  await mock.module("@/lib/orchestra-model-resolver", () => ({
    resolvePlatformModelConfig: mock(async () => "modelConfig" in opts ? opts.modelConfig : { provider: "groq", model: "llama-test", apiKey: "key", isCustomerConfigured: false }),
  }))
  await mock.module("@/lib/llm-client", () => ({
    callLLMJson: mock(async () => opts.llmResult ?? { data: { localizedContent: "contenu localisé" }, usage: {}, durationMs: 10 }),
  }))
  const { ServiceError } = await import("./compliance-service")
  await mock.module("./prompt-translation-service", () => ({
    translatePromptVersion: mock(async () => opts.translateResult ?? { id: "t1" }),
    getCachedTranslation: mock(async () => opts.translation),
    ServiceError,
  }))
  return dbMocks
}

describe("localizePromptVersion", () => {
  test("rejects an unknown locale", async () => {
    await setup({ translation: { id: "t1", translatedContent: "Hello" } })
    const { localizePromptVersion, ServiceError } = await import("./prompt-localization-service")
    await expect(localizePromptVersion(CTX, { versionId: "v1", targetLocale: "xx" })).rejects.toThrow(ServiceError)
  })

  test("returns the cached localization instead of calling the LLM again", async () => {
    const cached = { id: "l1", promptTranslationId: "t1", localizedContent: "cached", formattingSamples: {}, provider: "groq", model: "llama", createdAt: new Date() }
    const dbMocks = await setup({ translation: { id: "t1", translatedContent: "Hello" }, existingLocalization: cached })
    const { localizePromptVersion } = await import("./prompt-localization-service")

    const result = await localizePromptVersion(CTX, { versionId: "v1", targetLocale: "fr" })

    expect(result.localizedContent).toBe("cached")
    expect(dbMocks.insert).not.toHaveBeenCalled()
  })

  test("calls the LLM and persists a new localization grounded in real formatting samples", async () => {
    const inserted = { id: "l2", promptTranslationId: "t1", localizedContent: "contenu localisé", formattingSamples: { date: "04/03/2026" }, provider: "groq", model: "llama-test", createdAt: new Date() }
    const dbMocks = await setup({ translation: { id: "t1", translatedContent: "Bonjour" }, existingLocalization: undefined, insertedRow: inserted })
    const { localizePromptVersion } = await import("./prompt-localization-service")

    const result = await localizePromptVersion(CTX, { versionId: "v1", targetLocale: "fr" })

    expect(result.localizedContent).toBe("contenu localisé")
    expect(dbMocks.insert).toHaveBeenCalled()
  })

  test("throws when no AI model is configured", async () => {
    await setup({ translation: { id: "t1", translatedContent: "Hello" }, existingLocalization: undefined, modelConfig: null })
    const { localizePromptVersion } = await import("./prompt-localization-service")
    await expect(localizePromptVersion(CTX, { versionId: "v1", targetLocale: "fr" })).rejects.toThrow(/No AI model configured/)
  })
})
