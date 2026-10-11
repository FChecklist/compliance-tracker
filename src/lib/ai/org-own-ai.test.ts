/// <reference types="bun-types" />
// "Connect your AI" service: the key is tested BEFORE it is saved, stored encrypted, never returned, and removing it erases it.
// Faked: the database (one in-memory row), the encryption and the one-call connection test. Real: the service logic.
// Falsifiability: delete the testProviderConnection check in saveOwnAi and "a key that fails the test is not saved" fails.
import { beforeEach, describe, expect, mock, test } from "bun:test"

type Row = { id: string; orgId: string; orchestraLayerId: string | null; provider: string; modelName: string | null; encryptedApiKey: string | null; isActive: boolean; updatedAt: Date }
let row: Row | null = null
let testResult: { ok: true } | { ok: false; error: string } = { ok: true }
const tested: Array<{ provider: string; model: string; key: string }> = []

const table = { orgId: "orgId", orchestraLayerId: "layer", id: "id", isActive: "isActive" }
const realDrizzle = await import("drizzle-orm")
mock.module("drizzle-orm", () => ({ ...realDrizzle, and: (...a: unknown[]) => a, eq: (a: unknown, b: unknown) => [a, b], isNull: (a: unknown) => a }))
const tx = {
  query: { customerModelConfig: { findFirst: async () => row } },
  update: () => ({ set: (patch: Partial<Row>) => ({ where: async () => { row = { ...(row as Row), ...patch } } }) }),
  insert: () => ({ values: async (v: Partial<Row>) => { row = { id: "r1", updatedAt: new Date(), modelName: null, encryptedApiKey: null, isActive: true, orchestraLayerId: null, ...v } as Row } }),
  delete: () => ({ where: async () => { row = null } }),
}
mock.module("@/lib/db", () => ({ customerModelConfig: table, db: { query: { customerModelConfig: { findFirst: async () => row } } } }))
mock.module("@/lib/db/tenant-scoped", () => ({ withTenantContext: async (_c: unknown, fn: (t: typeof tx) => unknown) => fn(tx) }))
mock.module("@/lib/ai-config-crypto", () => ({ encryptApiKey: async (k: string) => `enc(${k})`, decryptApiKey: async (c: string) => c.slice(4, -1) }))
mock.module("@/lib/orchestra-model-resolver", () => ({ testProviderConnection: async (provider: string, model: string, key: string) => { tested.push({ provider, model, key }); return testResult } }))
const svc = await import("./org-own-ai")

beforeEach(() => { row = null; testResult = { ok: true }; tested.length = 0 })

describe("org own AI", () => {
  test("not connected by default", async () => {
    expect(await svc.getOwnAiStatus("org-1")).toEqual({ connected: false, provider: null, model: null, changedAt: null })
    expect(await svc.resolveOrgOwnAi("org-1")).toBeNull()
  })
  test("a good key is tested with the default fast model, saved encrypted, and the status never shows it", async () => {
    const status = await svc.saveOwnAi("org-1", { provider: "openai", apiKey: "fake-test-key-aaaa1111" })
    expect(tested).toEqual([{ provider: "openai", model: "gpt-4o-mini", key: "fake-test-key-aaaa1111" }])
    expect(row?.encryptedApiKey).toBe("enc(fake-test-key-aaaa1111)")
    expect(status).toMatchObject({ connected: true, provider: "openai", model: "gpt-4o-mini" })
    expect(JSON.stringify(status)).not.toContain("fake-test-key-aaaa1111")
    expect(await svc.resolveOrgOwnAi("org-1")).toEqual({ provider: "openai", model: "gpt-4o-mini", apiKey: "fake-test-key-aaaa1111" })
  })
  test("a key that fails the test is not saved, and the reason is shown", async () => {
    testResult = { ok: false, error: "Provider rejected the request (HTTP 401)" }
    await expect(svc.saveOwnAi("org-1", { provider: "anthropic", apiKey: "bad-key-1234" })).rejects.toThrow(/nothing was saved.*401/)
    expect(row).toBeNull()
  })
  test("a vendor we do not know, or a key with spaces, is refused before any call", async () => {
    await expect(svc.saveOwnAi("org-1", { provider: "mystery", apiKey: "fake-test-key-aaaa1111" })).rejects.toThrow(/Choose one of/)
    await expect(svc.saveOwnAi("org-1", { provider: "openai", apiKey: "fake key with spaces" })).rejects.toThrow(/no spaces/)
    expect(tested).toHaveLength(0)
  })
  test("saving again replaces the key and model; removing erases it", async () => {
    await svc.saveOwnAi("org-1", { provider: "openai", apiKey: "fake-first-key-cccc3333" })
    await svc.saveOwnAi("org-1", { provider: "google", model: "gemini-2.0-flash", apiKey: "fake-second-key-dddd4444" })
    expect(row).toMatchObject({ provider: "google", encryptedApiKey: "enc(fake-second-key-dddd4444)" })
    expect(await svc.removeOwnAi("org-1")).toMatchObject({ connected: false })
    expect(row).toBeNull()
  })
})
