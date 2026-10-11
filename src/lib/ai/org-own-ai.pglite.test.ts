/// <reference types="bun-types" />
// "Connect your AI" on a REAL database with the REAL code: the actual drizzle/0746_user_ai_connections.sql runs on PGlite (real Postgres as WASM),
// then the real service (org-own-ai.ts) and the real Drizzle queries. Faked: the encryption (a reversible marker), the one-call key test, and the
// tenant transaction (it hands over the same handle; RLS itself is a production concern proven by the policies in the migration).
//
// PROVEN
//   1. Nothing connected -> nobody has an AI.   2. The organisation's connection serves everyone in the organisation, and nobody in another one.
//   3. A person's own connection wins over the organisation's.   4. A teammate's share lets exactly that teammate use it (with the sharer's name),
//   and the teammate's own connection still wins.   5. Unsharing, or the owner disconnecting, stops it at once (shares go with the connection).
//   6. Sharing needs a connection of your own, ignores yourself and people of other organisations.   7. A key that fails the test saves nothing.
//   8. No status read ever contains a key.   9. The "effective" source the chat box greys on is mine > shared > org > projexa > none.
// Falsifiability: swap the order in resolveAiFor (org before mine) and 3 and 4 fail; drop the org filter in setMyShares and 6 fails.
// Run: bun test --isolate src/lib/ai/org-own-ai.pglite.test.ts
import { afterAll, beforeAll, beforeEach, describe, expect, mock, setDefaultTimeout, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"

process.env.DATABASE_URL ??= "postgresql://postgres:placeholder@localhost:5432/postgres"
process.env.APP_RUNTIME_DATABASE_URL ??= "postgresql://app_runtime:placeholder@localhost:5432/postgres"
setDefaultTimeout(60_000)

const schema = await import("@/lib/db/schema")
const MIGRATION = readFileSync(join(import.meta.dir, "..", "..", "..", "drizzle", "0746_user_ai_connections.sql"), "utf8")

const pglite = await PGlite.create()
await pglite.exec(`
CREATE SCHEMA compliance;
CREATE ROLE app_runtime; CREATE ROLE service_role;
CREATE FUNCTION compliance.current_org_id() RETURNS text LANGUAGE sql AS $$ SELECT current_setting('app.org_id', true) $$;
CREATE TABLE compliance.users (id text PRIMARY KEY, name text NOT NULL, email text NOT NULL, role text NOT NULL DEFAULT 'member', is_active boolean NOT NULL DEFAULT true, org_id text);
CREATE TABLE compliance.customer_model_config (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text, org_id text NOT NULL, orchestra_layer_id text, provider text NOT NULL, encrypted_api_key text, model_name text,
  is_active boolean NOT NULL DEFAULT true, shared_pool_eligible boolean NOT NULL DEFAULT false, last_used_at timestamp, created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now()
);
INSERT INTO compliance.users (id, name, email, org_id) VALUES
  ('anita', 'Anita', 'a@x', 'org-1'), ('bala', 'Bala', 'b@x', 'org-1'), ('chitra', 'Chitra', 'c@x', 'org-1'), ('dev', 'Dev', 'd@y', 'org-2');
`)
await pglite.exec(MIGRATION)
const db = drizzle(pglite, { schema }) as never

let testResult: { ok: true } | { ok: false; error: string } = { ok: true }
mock.module("@/lib/db", () => ({ ...schema, db }))
mock.module("@/lib/db/tenant-scoped", () => ({ withTenantContext: async (_c: unknown, fn: (tx: never) => unknown) => fn(db) }))
mock.module("@/lib/ai-config-crypto", () => ({ encryptApiKey: async (k: string) => `enc(${k})`, decryptApiKey: async (c: string) => c.slice(4, -1) }))
mock.module("@/lib/orchestra-model-resolver", () => ({ testProviderConnection: async () => testResult }))
const svc = await import("./org-own-ai")

beforeEach(async () => {
  testResult = { ok: true }
  await pglite.exec("DELETE FROM compliance.user_ai_connection_shares; DELETE FROM compliance.user_ai_connections; DELETE FROM compliance.customer_model_config;")
})
afterAll(async () => { await pglite.close() })

describe("migration 0746", () => {
  test("applies twice without error (idempotent) and enables RLS on both tables", async () => {
    await pglite.exec(MIGRATION)
    const rls = await pglite.query<{ relname: string; relrowsecurity: boolean }>("select relname, relrowsecurity from pg_class where relname in ('user_ai_connections','user_ai_connection_shares') order by relname")
    expect(rls.rows).toEqual([{ relname: "user_ai_connection_shares", relrowsecurity: true }, { relname: "user_ai_connections", relrowsecurity: true }])
  })
})

describe("who is served by which AI", () => {
  test("1. nothing connected: nobody has an AI", async () => {
    expect(await svc.resolveAiFor("org-1", "anita")).toBeNull()
    expect(await svc.hasAiFor("org-1", "anita")).toBe(false)
  })

  test("2. the organisation's connection serves everyone in that organisation and nobody in another", async () => {
    await svc.saveOwnAi("org-1", { provider: "openai", apiKey: "fake-org-key-test" })
    expect(await svc.resolveAiFor("org-1", "anita")).toMatchObject({ source: "org", provider: "openai", apiKey: "fake-org-key-test" })
    expect(await svc.resolveAiFor("org-1", "chitra")).toMatchObject({ source: "org" })
    expect(await svc.resolveAiFor("org-2", "dev")).toBeNull()
  })

  test("3. a person's own connection wins over the organisation's", async () => {
    await svc.saveOwnAi("org-1", { provider: "openai", apiKey: "fake-org-key-test" })
    await svc.saveMyAi("org-1", "anita", { provider: "anthropic", apiKey: "fake-anita-key-test" })
    expect(await svc.resolveAiFor("org-1", "anita")).toMatchObject({ source: "mine", provider: "anthropic", apiKey: "fake-anita-key-test", model: "claude-haiku-5-5" })
    expect(await svc.resolveAiFor("org-1", "bala")).toMatchObject({ source: "org" })
  })

  test("4. a share lets exactly that teammate use it, named; the teammate's own connection still wins", async () => {
    await svc.saveMyAi("org-1", "anita", { provider: "google", apiKey: "fake-anita-key-test" })
    await svc.setMyShares("org-1", "anita", ["bala"])
    expect(await svc.resolveAiFor("org-1", "bala")).toMatchObject({ source: "shared", sharedByName: "Anita", provider: "google", apiKey: "fake-anita-key-test" })
    expect(await svc.resolveAiFor("org-1", "chitra")).toBeNull()
    await svc.saveMyAi("org-1", "bala", { provider: "groq", apiKey: "fake-bala-key-test" })
    expect(await svc.resolveAiFor("org-1", "bala")).toMatchObject({ source: "mine", provider: "groq" })
  })

  test("5. unsharing stops it at once, and disconnecting erases the key and every share", async () => {
    await svc.saveMyAi("org-1", "anita", { provider: "openai", apiKey: "fake-anita-key-test" })
    await svc.setMyShares("org-1", "anita", ["bala", "chitra"])
    expect((await svc.getMyAiStatus("org-1", "anita")).sharedWith.map((p) => p.name).sort()).toEqual(["Bala", "Chitra"])
    await svc.setMyShares("org-1", "anita", ["chitra"])
    expect(await svc.resolveAiFor("org-1", "bala")).toBeNull()
    expect(await svc.resolveAiFor("org-1", "chitra")).toMatchObject({ source: "shared" })
    await svc.removeMyAi("org-1", "anita")
    expect(await svc.resolveAiFor("org-1", "chitra")).toBeNull()
    expect((await pglite.query("select count(*)::int as n from compliance.user_ai_connection_shares")).rows).toEqual([{ n: 0 }])
    expect((await pglite.query("select count(*)::int as n from compliance.user_ai_connections")).rows).toEqual([{ n: 0 }])
  })

  test("6. sharing needs a connection of your own, ignores yourself and people of other organisations", async () => {
    await expect(svc.setMyShares("org-1", "anita", ["bala"])).rejects.toThrow(/Connect your own AI first/)
    await svc.saveMyAi("org-1", "anita", { provider: "openai", apiKey: "fake-anita-key-test" })
    await svc.setMyShares("org-1", "anita", ["anita", "dev", "nobody", "bala"])
    expect((await svc.getMyAiStatus("org-1", "anita")).sharedWith.map((p) => p.id)).toEqual(["bala"])
    expect(await svc.resolveAiFor("org-2", "dev")).toBeNull()
    await expect(svc.setMyShares("org-1", "anita", "bala")).rejects.toThrow(/list of teammates/)
  })

  test("7. a key that fails the test saves nothing, for a person and for the organisation", async () => {
    testResult = { ok: false, error: "Provider rejected the request (HTTP 401)" }
    await expect(svc.saveMyAi("org-1", "anita", { provider: "openai", apiKey: "fake-bad-key-test" })).rejects.toThrow(/Nothing was saved.*did not accept this key/)
    await expect(svc.saveOwnAi("org-1", { provider: "openai", apiKey: "fake-bad-key-test" })).rejects.toThrow(/Nothing was saved/)
    expect(await svc.resolveAiFor("org-1", "anita")).toBeNull()
  })

  test("8. no status read ever contains a key", async () => {
    await svc.saveOwnAi("org-1", { provider: "openai", apiKey: "fake-org-key-test" })
    await svc.saveMyAi("org-1", "anita", { provider: "anthropic", apiKey: "fake-anita-key-test" })
    await svc.setMyShares("org-1", "anita", ["bala"])
    for (const person of ["anita", "bala", "chitra"]) {
      const picture = await svc.getAiPicture("org-1", person, false)
      expect(JSON.stringify(picture)).not.toMatch(/fake-org-key|fake-anita-key|enc\(/)
    }
    expect(JSON.stringify(await svc.listShareCandidates("org-1", "anita"))).toBe(JSON.stringify([{ id: "bala", name: "Bala", role: "member" }, { id: "chitra", name: "Chitra", role: "member" }]))
  })

  test("9. the source the chat box greys on: mine > shared > org > projexa > none", async () => {
    const eff = async (p: string, projexa = false) => (await svc.getAiPicture("org-1", p, projexa)).effective.source
    expect(await eff("bala")).toBeNull()
    expect(await eff("bala", true)).toBe("projexa")
    await svc.saveOwnAi("org-1", { provider: "openai", apiKey: "fake-org-key-test" })
    expect(await eff("bala", true)).toBe("org")
    await svc.saveMyAi("org-1", "anita", { provider: "anthropic", apiKey: "fake-anita-key-test" })
    await svc.setMyShares("org-1", "anita", ["bala"])
    expect(await eff("bala")).toBe("shared")
    await svc.saveMyAi("org-1", "bala", { provider: "groq", apiKey: "fake-bala-key-test" })
    expect(await eff("bala")).toBe("mine")
    expect((await svc.getAiPicture("org-1", "bala", false)).sharedWithMe).toEqual([{ ownerName: "Anita", provider: "anthropic", model: "claude-haiku-5-5" }])
  })

})

describe("a refused key is explained in everyday words", () => {
  test.each([
    ["Provider rejected the request (HTTP 401): invalid api key", /did not accept this key.*copied ALL of it/],
    ["Provider rejected the request (HTTP 429): You exceeded your current quota", /no credit left.*billing page/],
    ["Provider rejected the request (HTTP 404): model not found", /cannot use that model/],
    ["Provider rejected the request (HTTP 503)", /having a problem right now/],
  ])("%s", (raw, expected) => {
    const sentence = svc.plainKeyProblem("anthropic", raw)
    expect(sentence).toMatch(expected)
    expect(sentence.startsWith("Nothing was saved.")).toBe(true)
    expect(sentence).toContain("Anthropic (Claude)")
  })
})
