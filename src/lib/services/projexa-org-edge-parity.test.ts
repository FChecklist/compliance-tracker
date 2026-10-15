// AUDIT-100 G-09: the edge half of the PARITY CONTRACT for POST /api/org/provision and GET|POST /api/org/repair.
// supabase/functions/projexa-api/org-parity.golden.json was RECORDED from the real PROJEXA Next pipeline (middleware + route + requireAuth + veridian-client;
// projexa repo src/lib/org-provision-parity.test.ts). Every scenario is replayed through the edge handler (org-provision.ts) with the same identities and the
// same world (the VERIDIAN side is the SQL function's rpc, PROJEXA's organizations / memberships are its REST): same status, same JSON body, same effects.
// Handler-only: injected fakes, no network, no database. Plus: the key never leaves the function, the rate limit, the legacy mirror, the key lookups.
import { beforeEach, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { generateApiKey, handleOrg, isOrgRequest, readCredential, resetOrgRateLimit, sha256Hex, PROVISION_MAX_PER_WINDOW, type OrgDeps } from "../../../supabase/functions/projexa-api/org-provision"
import { createOrgKeyLookup } from "../../../supabase/functions/projexa-api/lookups"
import { createVeridianOrgIdLookup } from "../../../supabase/functions/projexa-api/member-link"
import type { SessionVerifier } from "../../../supabase/functions/ai-work-link/session"

const DIR = join(import.meta.dir, "..", "..", "..", "supabase", "functions", "projexa-api")
type Identity = { sub: string; email: string | null; membership: { organization_id: string; role: string | null } | null | "error" }
type World = { credentials?: boolean; veridian?: "ok" | { status: number; error: string }; org_insert?: "ok" | "error"; membership_insert?: "ok" | "error"; store?: "ok" | "error" | "silent_noop"; org_read?: "ok" | "missing" | "error"; org_country?: string | null }
type Case = { name: string; method: "GET" | "POST"; path: string; body?: unknown; raw_body?: string; who: string; world?: World }
type Effects = { veridian_provisioned: { name: string; country: string | null }[]; orgs_inserted: { name: string; slug_prefix: string }[]; memberships_inserted: { user_id: string; role: string; organization_is_new: boolean }[]; credentials_stored: { organization: "new" | "existing"; veridian_org_id: string }[] }
const golden = JSON.parse(readFileSync(join(DIR, "org-parity.golden.json"), "utf8")) as {
  identities: Record<string, Identity>
  org_a: string
  new_org: string
  veridian_new_org: string
  cases: { case: Case; expect: { status: number; body: unknown; effects: Effects } }[]
}
const ISSUER = "https://evpckeuxgvahguwsaeul.supabase.co/auth/v1"
const PROJEXA = "https://projexa.test"
const FN = "https://pcrjmlpuqsbocqfwoxod.supabase.co/functions/v1/projexa-api"

type Run = { status: number; body: unknown; effects: Effects; keys: string[] }
/** The edge handler with the world of the scenario; `over` lets a test swap a dependency. */
async function runEdge(c: Case, over: Partial<OrgDeps> = {}): Promise<Run> {
  const w = c.world ?? {}
  const fx: Effects = { veridian_provisioned: [], orgs_inserted: [], memberships_inserted: [], credentials_stored: [] }
  const keysSeen: string[] = []
  let stored = false
  const id = c.who === "signed_out" ? null : golden.identities[c.who]
  const session: SessionVerifier = async (token) => (id && token === `tok:${c.who}` ? { ok: true, sub: id.sub, email: id.email, issuer: ISSUER, iat: 1 } : { ok: false, reason: "invalid" })
  const rpc: OrgDeps["rpc"] = async (fn, args) => {
    if (fn === "projexa_provision_org") {
      fx.veridian_provisioned.push({ name: String(args.p_name), country: (args.p_country as string | null) ?? null })
      const v = w.veridian ?? "ok"
      if (v === "ok") return { data: [{ outcome: "created", organisation_id: golden.veridian_new_org }], error: null }
      if (v.status === 400) return { data: [{ outcome: "bad_input", organisation_id: null }], error: null }
      return { data: null, error: { message: v.error } }
    }
    if (fn === "projexa_org_credential_get") return { data: w.credentials || stored ? [{ veridian_org_id: "v-existing", api_key: "key-existing" }] : [], error: null }
    if (fn === "projexa_org_credential_put") {
      keysSeen.push(String(args.p_api_key))
      if (w.store === "error") return { data: null, error: { message: "boom" } }
      if (w.store !== "silent_noop") stored = true
      fx.credentials_stored.push({ organization: args.p_projexa_org_id === golden.new_org ? "new" : "existing", veridian_org_id: String(args.p_veridian_org_id) })
      return { data: "stored", error: null }
    }
    throw new Error(`unexpected rpc ${fn}`)
  }
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    const method = (init?.method ?? "GET").toUpperCase()
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : null
    if (url.pathname === "/rest/v1/organizations" && method === "POST") {
      if (w.org_insert === "error") return new Response(JSON.stringify({ message: 'duplicate key value violates unique constraint "organizations_slug_key"' }), { status: 409 })
      fx.orgs_inserted.push({ name: body.name, slug_prefix: String(body.slug).replace(/-[a-z0-9]{1,5}$/, "") })
      return new Response(JSON.stringify({ id: golden.new_org, name: body.name, slug: body.slug }), { status: 201 })
    }
    if (url.pathname === "/rest/v1/memberships" && method === "POST") {
      if (w.membership_insert === "error") return new Response(JSON.stringify({ message: 'new row violates row-level security policy for table "memberships"' }), { status: 403 })
      fx.memberships_inserted.push({ user_id: body.user_id, role: body.role, organization_is_new: body.organization_id === golden.new_org })
      return new Response(null, { status: 201 })
    }
    if (url.pathname === "/rest/v1/organizations" && method === "GET") {
      if (w.org_read === "error") throw new TypeError("fetch failed")
      if (w.org_read === "missing") return new Response("[]", { status: 200 })
      return new Response(JSON.stringify([{ name: "Existing Org", country: w.org_country === undefined ? "IN" : w.org_country }]), { status: 200 })
    }
    throw new Error(`unexpected fetch ${method} ${url.href}`)
  }) as typeof fetch
  const deps: OrgDeps = {
    session,
    issuer: ISSUER,
    membership: async (_t, sub) => {
      const m = Object.values(golden.identities).find((i) => i.sub === sub)?.membership
      return m === "error" ? { ok: false } : { ok: true, row: m ?? null }
    },
    rpc,
    projexaUrl: PROJEXA,
    projexaAnonKey: "anon",
    fetchImpl,
    randomKey: () => "vk_" + "k".repeat(32),
    randomSuffix: () => "abcde",
    ...over,
  }
  const sent = c.raw_body !== undefined ? c.raw_body : c.body === undefined ? undefined : JSON.stringify(c.body)
  const headers: Record<string, string> = sent === undefined ? {} : { "content-type": "application/json" }
  if (c.who !== "signed_out") headers.authorization = `Bearer tok:${c.who}`
  const res = await handleOrg(new Request(`${FN}${c.path}`, { method: c.method, headers, body: sent }), deps)
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : null, effects: fx, keys: keysSeen }
}

beforeEach(() => resetOrgRateLimit())

// scenarios where the edge is DELIBERATELY different (README.md "Known, deliberate differences"); everything else must equal the golden exactly
const DIFFERENT: Record<string, { status: number; body: unknown }> = {
  // the Next route throws on `body.orgName.trim()` for a non-string (an empty 500); the edge refuses it like an empty name
  "provision: orgName not a string": { status: 400, body: { error: "orgName is required" } },
}

describe("org provision / repair: the golden contract recorded from the Next pipeline", () => {
  test("every golden scenario: same status, same body, same effects", async () => {
    expect(golden.cases.length).toBeGreaterThanOrEqual(35)
    for (const g of golden.cases) {
      resetOrgRateLimit()
      const out = await runEdge(g.case)
      const want = DIFFERENT[g.case.name] ?? { status: g.expect.status, body: g.expect.body }
      expect({ name: g.case.name, status: out.status, body: out.body }).toEqual({ name: g.case.name, ...want })
      if (!DIFFERENT[g.case.name]) expect({ name: g.case.name, effects: out.effects }).toEqual({ name: g.case.name, effects: g.expect.effects })
    }
  })

  test("the contract is not vacuous: a new organisation is made, VERIDIAN first, and a refusal writes nothing", () => {
    const by = (n: string) => golden.cases.find((c) => c.case.name === n)!.expect
    expect(by("provision: new organisation").status).toBe(201)
    expect(by("provision: new organisation").effects.credentials_stored).toHaveLength(1)
    expect(by("provision: VERIDIAN answers 500").effects.orgs_inserted).toHaveLength(0)
    expect(by("repair POST: member").effects.veridian_provisioned).toHaveLength(0)
  })
})

describe("the key and the trust chain", () => {
  const NEW = golden.cases.find((g) => g.case.name === "provision: new organisation")!.case

  test("the key is generated here, only its hash goes into provisioning, and it is stored only through the credentials function", async () => {
    const seen: Record<string, unknown>[] = []
    const base = await runEdge(NEW, {
      rpc: async (fn, args) => {
        seen.push({ fn, ...args })
        if (fn === "projexa_provision_org") return { data: [{ outcome: "created", organisation_id: "v1" }], error: null }
        return { data: fn === "projexa_org_credential_put" ? "stored" : [], error: null }
      },
    })
    expect(base.status).toBe(201)
    const key = "vk_" + "k".repeat(32)
    const prov = seen.find((s) => s.fn === "projexa_provision_org")!
    expect(prov.p_key_hash).toBe(createHash("sha256").update(key).digest("hex"))
    expect(prov.p_key_prefix).toBe("vk_kkkkk...")
    expect(JSON.stringify(prov)).not.toContain(key)
    expect(seen.find((s) => s.fn === "projexa_org_credential_put")!.p_api_key).toBe(key)
    expect(JSON.stringify(base.body)).not.toContain(key) // never returned
  })

  test("generateApiKey: vk_ + 32 alphanumerics, not repeating", () => {
    const keys = new Set(Array.from({ length: 50 }, generateApiKey))
    expect(keys.size).toBe(50)
    for (const k of keys) expect(k).toMatch(/^vk_[A-Za-z0-9]{32}$/)
  })

  test("a token of another issuer, a bad token and an unavailable verifier never reach VERIDIAN", async () => {
    let touched = 0
    const rpc: OrgDeps["rpc"] = async () => {
      touched++
      return { data: null, error: null }
    }
    const mk = (session: SessionVerifier) => runEdge(NEW, { session, rpc })
    expect((await mk(async () => ({ ok: true, sub: "x", email: null, issuer: "https://evil.example/auth/v1", iat: 1 }))).status).toBe(401)
    expect((await mk(async () => ({ ok: false, reason: "invalid" }))).status).toBe(401)
    expect((await mk(async () => ({ ok: false, reason: "unavailable" }))).status).toBe(503)
    expect(touched).toBe(0)
  })

  test("the provisioning rate limit (20 per minute per instance): the 21st call is 429 and creates nothing", async () => {
    const ok = golden.cases.find((g) => g.case.name === "provision: new organisation")!.case
    for (let i = 0; i < PROVISION_MAX_PER_WINDOW; i++) expect((await runEdge(ok)).status).toBe(201)
    const over = await runEdge(ok)
    expect(over.status).toBe(429)
    expect(over.body).toEqual({ error: "Could not provision your PROJEXA workspace: Too many provisioning requests. Try again in a minute." })
    expect(over.effects.orgs_inserted).toHaveLength(0)
    let t = 0
    resetOrgRateLimit()
    for (let i = 0; i < PROVISION_MAX_PER_WINDOW + 1; i++) await runEdge(ok, { now: () => t })
    t = 61_000
    expect((await runEdge(ok, { now: () => t })).status).toBe(201) // the window moved on
  })

  test("the SQL says not_configured: 503 with a clear message, nothing on the PROJEXA side", async () => {
    const out = await runEdge(NEW, { rpc: async () => ({ data: [{ outcome: "not_configured", organisation_id: null }], error: null }) })
    expect(out.status).toBe(503)
    expect(out.effects.orgs_inserted).toHaveLength(0)
  })

  test("the legacy mirror: written once after a new organisation while on, never when off, a mirror failure does not fail the signup", async () => {
    const calls: { url: string; body: unknown }[] = []
    const makeFetch = (mirrorStatus: number) =>
      (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input))
        if (url.pathname === "/rest/v1/veridian_credentials") {
          calls.push({ url: url.href, body: JSON.parse(String(init?.body)) })
          return new Response(null, { status: mirrorStatus })
        }
        if (url.pathname === "/rest/v1/organizations") return new Response(JSON.stringify({ id: golden.new_org }), { status: 201 })
        return new Response(null, { status: 201 })
      }) as typeof fetch
    const okRpc: OrgDeps["rpc"] = async (fn) => ({ data: fn === "projexa_provision_org" ? [{ outcome: "created", organisation_id: "v1" }] : fn === "projexa_org_credential_put" ? "stored" : [], error: null })
    const on = await runEdge(NEW, { rpc: okRpc, fetchImpl: makeFetch(201), legacy: { serviceRoleKey: "srk", mirror: true } })
    expect(on.status).toBe(201)
    expect(calls).toHaveLength(1)
    expect(calls[0].body).toEqual({ organization_id: golden.new_org, veridian_org_id: "v1", veridian_api_key: "vk_" + "k".repeat(32) })
    expect(calls[0].url).toContain("on_conflict=organization_id")
    calls.length = 0
    const failing = await runEdge(NEW, { rpc: okRpc, fetchImpl: makeFetch(500), legacy: { serviceRoleKey: "srk", mirror: true } })
    expect(failing.status).toBe(201)
    calls.length = 0
    const off = await runEdge(NEW, { rpc: okRpc, fetchImpl: makeFetch(201), legacy: { serviceRoleKey: "srk", mirror: false } })
    expect(off.status).toBe(201)
    expect(calls).toHaveLength(0)
  })

  test("isOrgRequest routes only the two org paths", () => {
    for (const p of ["/api/org/provision", "/functions/v1/projexa-api/api/org/provision", "/projexa-api/api/org/repair/"]) expect(isOrgRequest(new Request(`https://x.test${p}`))).toBe(true)
    for (const p of ["/api/org/invites/accept", "/api/org/provisionx", "/api/org", "/api/projects"]) expect(isOrgRequest(new Request(`https://x.test${p}`))).toBe(false)
  })
})

describe("the key lookups read the compliance-side table first, the legacy table for an organisation not moved yet", () => {
  const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
  const legacyFetch = (async (input: RequestInfo | URL) => {
    const u = String(input)
    if (u.includes("select=veridian_api_key&")) return new Response(JSON.stringify([{ veridian_api_key: "legacy-key" }]), { status: 200 })
    if (u.includes("select=veridian_org_id&")) return new Response(JSON.stringify([{ veridian_org_id: "legacy-v" }]), { status: 200 })
    throw new Error(`unexpected ${u}`)
  }) as typeof fetch

  test("orgKey: new table wins, then legacy, then null; a failing rpc falls back", async () => {
    const mk = (rpc: OrgDeps["rpc"]) => createOrgKeyLookup({ projexaUrl: PROJEXA, serviceRoleKey: "srk", rpc, fetchImpl: legacyFetch })
    expect(await mk(async () => ({ data: [{ veridian_org_id: "v", api_key: "new-key" }], error: null }))(ORG)).toBe("new-key")
    expect(await mk(async () => ({ data: [], error: null }))(ORG)).toBe("legacy-key")
    expect(await mk(async () => ({ data: null, error: { message: "x" } }))(ORG)).toBe("legacy-key")
    expect(await mk(async () => { throw new Error("net") })(ORG)).toBe("legacy-key")
    expect(await createOrgKeyLookup({ projexaUrl: "", serviceRoleKey: "", rpc: async () => ({ data: [], error: null }) })(ORG)).toBeNull()
    expect(await mk(async () => ({ data: [], error: null }))("not-a-uuid")).toBeNull()
  })

  test("veridianOrgId: the same order", async () => {
    const mk = (rpc: OrgDeps["rpc"]) => createVeridianOrgIdLookup({ projexaUrl: PROJEXA, serviceRoleKey: "srk", rpc, fetchImpl: legacyFetch })
    expect(await mk(async () => ({ data: "v-new", error: null }))(ORG)).toBe("v-new")
    expect(await mk(async () => ({ data: null, error: null }))(ORG)).toBe("legacy-v")
    expect(await mk(async () => ({ data: null, error: { message: "x" } }))(ORG)).toBe("legacy-v")
  })

  test("readCredential: no legacy configured and no row is null", async () => {
    expect(await readCredential({ rpc: async () => ({ data: [], error: null }) } as unknown as OrgDeps, ORG)).toBeNull()
    expect(await readCredential({ rpc: async () => ({ data: [{ veridian_org_id: "v", api_key: "k" }], error: null }) } as unknown as OrgDeps, ORG)).toEqual({ veridianOrgId: "v", apiKey: "k" })
    expect(await sha256Hex("abc")).toBe(createHash("sha256").update("abc").digest("hex"))
  })
})
