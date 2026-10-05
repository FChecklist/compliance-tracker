// AUDIT-100 A2: the edge half of the PARITY CONTRACT between PROJEXA's Next pipeline (Vercel) and the Supabase Edge Function `projexa-api`.
// supabase/functions/projexa-api/parity.golden.json was RECORDED from the real PROJEXA Next pipeline (middleware + route handler + requireAuth +
// veridian-client + veridian-response; projexa repo src/lib/projexa-api-parity.test.ts) and copied here by projexa's
// scripts/projexa-api-edge.mjs. Every case is replayed through the edge handler with the same identities, organisation keys and upstream
// answers: same status, same JSON body, same Retry-After, and the same upstream calls (method, path, key, acting person, body).
// Handler-only: injected fakes, no network, no database.
import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { ALLOWED_ORIGINS, apiPathOf, handleApi, type ApiDeps } from "../../../supabase/functions/projexa-api/handler"
import { createMembershipLookup, createOrgKeyLookup } from "../../../supabase/functions/projexa-api/lookups"
import { checkApiWriteAccess, EDGE_ROUTES, SOURCE_SHA256, sourceData } from "../../../supabase/functions/projexa-api/policy.generated"
import type { SessionVerifier } from "../../../supabase/functions/ai-work-link/session"

const DIR = join(import.meta.dir, "..", "..", "..", "supabase", "functions", "projexa-api")
type Identity = { sub: string; email: string | null; membership: { organization_id: string; role: string } | null | "error" }
type Upstream = { kind: "json"; status: number; body: unknown } | { kind: "text"; status: number; status_text: string; text: string } | { kind: "refused" }
type Case = { name: string; method: string; path: string; body?: unknown; who: string; upstream: Upstream }
type Call = { method: string; path: string; authorization: string | null; acting_user: string | null; acting_email: string | null; content_type: string | null; body: unknown }
/** cache_control: present only when the answer sets a Cache-Control other than "no-store" (the projexa recorder normalises the same way). */
type Outcome = { status: number; body: unknown; retry_after: string | null; upstream_calls: Call[]; cache_control?: string }
const golden = JSON.parse(readFileSync(join(DIR, "parity.golden.json"), "utf8")) as {
  identities: Record<string, Identity>
  org_keys: Record<string, string>
  upstream_base: string
  cases: { case: Case; expect: Outcome }[]
}

const ISSUER = "https://evpckeuxgvahguwsaeul.supabase.co/auth/v1"
const FN = "https://pcrjmlpuqsbocqfwoxod.supabase.co/functions/v1/projexa-api"

/** The edge function with fakes for the session, the two PROJEXA reads and the upstream; `policy` lets a mutation test swap the gate. */
async function runEdge(c: Case, over: Partial<ApiDeps> = {}, extraHeaders: Record<string, string> = {}): Promise<Outcome> {
  const calls: Call[] = []
  const id = c.who === "signed_out" ? null : golden.identities[c.who]
  const session: SessionVerifier = async (token) => (id && token === `tok:${c.who}` ? { ok: true, sub: id.sub, email: id.email, issuer: ISSUER, iat: 1 } : { ok: false, reason: "invalid" })
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const h = new Headers(init?.headers)
    calls.push({
      method: (init?.method ?? "GET").toUpperCase(),
      // as it goes on the wire (URL-normalised), exactly how the projexa recorder writes it
      path: new URL(url).href.slice(new URL(golden.upstream_base).href.length),
      authorization: h.get("authorization"),
      acting_user: h.get("x-acting-user"),
      acting_email: h.get("x-acting-user-email"),
      content_type: h.get("content-type"),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
    })
    const u = c.upstream
    if (u.kind === "refused") throw new TypeError("error sending request: tcp connect error: Connection refused (os error 111)")
    if (u.kind === "text") return new Response(u.text, { status: u.status, statusText: u.status_text })
    return new Response(JSON.stringify(u.body), { status: u.status, headers: { "Content-Type": "application/json" } })
  }) as typeof fetch
  const deps: ApiDeps = {
    session,
    issuer: ISSUER,
    membership: async () => (!id || id.membership === "error" ? { ok: false } : { ok: true, row: id.membership }),
    orgKey: async (org) => golden.org_keys[org] ?? null,
    upstreamBase: golden.upstream_base,
    fetchImpl,
    ...over,
  }
  const headers: Record<string, string> = { ...extraHeaders }
  if (c.who !== "signed_out") headers.authorization = `Bearer tok:${c.who}`
  if (c.body !== undefined) headers["content-type"] = "application/json"
  const res = await handleApi(new Request(`${FN}${c.path}`, { method: c.method, headers, body: c.body === undefined ? undefined : JSON.stringify(c.body) }), deps)
  const text = await res.text()
  let body: unknown = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = { __not_json__: text.slice(0, 80) }
  }
  const cc = res.headers.get("cache-control")
  return { status: res.status, body, retry_after: res.headers.get("retry-after"), upstream_calls: calls, ...(cc && cc !== "no-store" ? { cache_control: cc } : {}) }
}

describe("projexa-api parity contract: the edge handler answers exactly what PROJEXA's Next pipeline answered (AUDIT-100 A2)", () => {
  test("the contract is the real one: more than 100 cases, every route of the function, every role", () => {
    expect(golden.cases.length).toBeGreaterThan(100)
    const matches = (route: string, path: string) => {
      const pat = route.split("/").filter(Boolean)
      const segs = path.split("?")[0].split("/").filter(Boolean)
      return pat.length === segs.length && pat.every((p, i) => p.startsWith(":") || p === segs[i])
    }
    for (const r of EDGE_ROUTES) for (const m of Object.keys(r.methods)) expect(golden.cases.some((c) => c.case.method === m && matches(r.route, c.case.path)), `${m} ${r.route}`).toBe(true)
    for (const who of ["owner", "admin", "pm", "site_engineer", "member", "client_viewer", "signed_out", "no_org", "wrong_org"]) expect(golden.cases.some((c) => c.case.who === who)).toBe(true)
  })

  for (const { case: c, expect: want } of golden.cases) {
    test(c.name, async () => {
      expect(await runEdge(c)).toEqual(want)
    })
  }
})

describe("deny by default, and what the edge never does", () => {
  const owner = golden.cases.find((c) => c.case.who === "owner")!.case
  test("a path that is not one of the function's routes is 404 before anything else (even a real Vercel route, even signed in)", async () => {
    for (const path of ["/api/assistant", "/api/payroll/runs/r-1/process", "/api/scope/line-items", "/api/documents/d-1/dispose", "/api/org/invites", "/api/permits/x/extra", "/rest/v1/memberships", "/api"]) {
      const out = await runEdge({ ...owner, method: "POST", path, body: {} })
      expect(out.status).toBe(404)
      expect(out.upstream_calls).toHaveLength(0)
    }
  })
  test("a method the route does not have is 405 (PATCH a dashboard, DELETE a line)", async () => {
    expect((await runEdge({ ...owner, method: "PATCH", path: "/api/dashboard/project/p-1", body: {} })).status).toBe(405)
    expect((await runEdge({ ...owner, method: "DELETE", path: "/api/scope/line-items/li-1" })).status).toBe(405)
  })
  test("an inbound X-Acting-User / X-Acting-User-Email is never forwarded: the acting person is the verified token's", async () => {
    const pm = golden.cases.find((c) => c.case.name === "PATCH /api/scope/line-items/:id as pm")!.case
    const out = await runEdge(pm, {}, { "x-acting-user": "11111111-1111-4111-8111-111111111111", "x-acting-user-email": "ceo@a.test" })
    expect(out.upstream_calls[0].acting_user).toBe(golden.identities.pm.sub)
    expect(out.upstream_calls[0].acting_email).toBe("pm@a.test")
  })
  test("a token of another issuer (the verdian-ai project) is refused like a bad one", async () => {
    const out = await runEdge(owner, { session: async () => ({ ok: true, sub: golden.identities.owner.sub, email: null, issuer: "https://pcrjmlpuqsbocqfwoxod.supabase.co/auth/v1", iat: 1 }) })
    expect(out.status).toBe(401)
  })
  test("sign-in check unavailable is a 503 with Retry-After, not 'signed out'", async () => {
    const out = await runEdge(owner, { session: async () => ({ ok: false, reason: "unavailable" }) })
    expect(out.status).toBe(503)
    expect(out.retry_after).toBe("5")
  })
  test("an upstream that never answers: 503 UPSTREAM_TIMEOUT after the budget, no retry", async () => {
    const hang = (async (_i: RequestInfo | URL, init?: RequestInit) =>
      new Promise((_r, reject) => init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }))))) as typeof fetch
    const out = await runEdge(owner, { fetchImpl: hang, timeoutMs: 50 })
    expect(out.status).toBe(503)
    expect(out.body).toEqual({ error: "The construction data service did not respond in time. Please retry.", code: "UPSTREAM_TIMEOUT" })
  })
  test("an invalid JSON body is 400 and nothing is sent", async () => {
    const pm = golden.cases.find((c) => c.case.name === "PATCH /api/scope/line-items/:id as pm")!.case
    const res = await handleApi(
      new Request(`${FN}${pm.path}`, { method: "PATCH", headers: { authorization: "Bearer tok:pm", "content-type": "application/json" }, body: "{not json" }),
      { session: async () => ({ ok: true, sub: golden.identities.pm.sub, email: "pm@a.test", issuer: ISSUER, iat: 1 }), issuer: ISSUER, membership: async () => ({ ok: true, row: { organization_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", role: "pm" } }), orgKey: async () => "k", upstreamBase: "https://u.test", fetchImpl: (() => { throw new Error("must not be called") }) as unknown as typeof fetch },
    )
    expect(res.status).toBe(400)
  })
  test("the path is found under the function's own URL and only there", () => {
    expect(apiPathOf("/functions/v1/projexa-api/api/exceptions")).toBe("/api/exceptions")
    expect(apiPathOf("/projexa-api/api/exceptions/")).toBe("/api/exceptions")
    expect(apiPathOf("/api/exceptions")).toBe("/api/exceptions")
    expect(apiPathOf("/functions/v1/other/api/exceptions")).toBeNull()
  })
})

describe("CORS, as a browser on the PROJEXA origins sees it", () => {
  test("preflight: 204, origin echoed, Authorization + Content-Type allowed, PATCH/DELETE allowed, cached 2 h; another origin gets no allow-origin", async () => {
    const deps = { session: async () => ({ ok: false, reason: "invalid" }), issuer: ISSUER, membership: async () => ({ ok: false }), orgKey: async () => null, upstreamBase: "x" } as unknown as ApiDeps
    for (const origin of ALLOWED_ORIGINS) {
      const r = await handleApi(new Request(`${FN}/api/scope/line-items/li-1`, { method: "OPTIONS", headers: { origin, "access-control-request-method": "PATCH", "access-control-request-headers": "authorization,content-type" } }), deps)
      expect(r.status).toBe(204)
      expect(r.headers.get("access-control-allow-origin")).toBe(origin)
      expect(r.headers.get("access-control-allow-headers")).toContain("authorization")
      expect(r.headers.get("access-control-allow-methods")).toContain("PATCH")
      expect(r.headers.get("access-control-max-age")).toBe("7200")
    }
    const evil = await handleApi(new Request(`${FN}/api/exceptions`, { method: "OPTIONS", headers: { origin: "https://evil.example" } }), deps)
    expect(evil.headers.get("access-control-allow-origin")).toBeNull()
    // an error answer carries the origin too, or the browser hides the 401 from the page
    const r401 = await handleApi(new Request(`${FN}/api/exceptions?projectId=p`, { headers: { origin: "https://projexa-ai.com" } }), deps)
    expect(r401.status).toBe(401)
    expect(r401.headers.get("access-control-allow-origin")).toBe("https://projexa-ai.com")
  })
})

describe("the generated policy is the projexa repo's, untouched", () => {
  test("SOURCE_SHA256 is the hash of the data in the file (a hand edit of the table or the routes fails here)", () => {
    expect(createHash("sha256").update(JSON.stringify(sourceData())).digest("hex")).toBe(SOURCE_SHA256)
  })
  test("the gate: client_viewer may not write a BOQ line, pm may; member may not edit a document, site_engineer may; reads always pass", () => {
    expect(checkApiWriteAccess("PATCH", "/api/scope/line-items/x", "client_viewer").allowed).toBe(false)
    expect(checkApiWriteAccess("PATCH", "/api/scope/line-items/x", "pm").allowed).toBe(true)
    expect(checkApiWriteAccess("PATCH", "/api/documents/x", "member").allowed).toBe(false)
    expect(checkApiWriteAccess("PATCH", "/api/documents/x", "site_engineer").allowed).toBe(true)
    expect(checkApiWriteAccess("GET", "/api/payroll/runs", "client_viewer").allowed).toBe(true)
  })
  test("GET /_policy reports the hash and the routes (what a deploy check compares with the projexa repo)", async () => {
    const r = await handleApi(new Request(`${FN}/_policy`), { issuer: ISSUER } as unknown as ApiDeps)
    expect(await r.json()).toEqual({ source_sha256: SOURCE_SHA256, routes: EDGE_ROUTES.map((x) => x.route) })
  })
})

describe("the two PROJEXA reads", () => {
  const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
  const SUB = "00000000-0000-4000-8000-000000000003"
  test("membership: the person's own token + the anon key, oldest first; [] is 'no organisation'; an error is a failure, not 'none'", async () => {
    const seen: { url: string; headers: Headers }[] = []
    const answers = [new Response(JSON.stringify([{ organization_id: ORG, role: "pm" }])), new Response("[]"), new Response("{}", { status: 500 })]
    const lookup = createMembershipLookup({ projexaUrl: "https://p.test", anonKey: "anon", fetchImpl: (async (u: RequestInfo | URL, i?: RequestInit) => (seen.push({ url: String(u), headers: new Headers(i?.headers) }), answers.shift()!)) as typeof fetch })
    expect(await lookup("tok", SUB)).toEqual({ ok: true, row: { organization_id: ORG, role: "pm" } })
    expect(await lookup("tok", SUB)).toEqual({ ok: true, row: null })
    expect(await lookup("tok", SUB)).toEqual({ ok: false })
    expect(seen[0].url).toBe(`https://p.test/rest/v1/memberships?select=organization_id,role&user_id=eq.${SUB}&order=created_at.asc&limit=1`)
    expect(seen[0].headers.get("authorization")).toBe("Bearer tok")
    expect(seen[0].headers.get("apikey")).toBe("anon")
    expect(await lookup("tok", "not-a-uuid")).toEqual({ ok: false })
  })
  test("org key: service role, remembered 5 minutes, 'no row' never remembered, a malformed org id never queried", async () => {
    let n = 0
    let t = 0
    const rows = [[], [{ veridian_api_key: "k1" }], [{ veridian_api_key: "k2" }]]
    const lookup = createOrgKeyLookup({ projexaUrl: "https://p.test", serviceRoleKey: "srv", now: () => t, fetchImpl: (async () => new Response(JSON.stringify(rows[n++]))) as unknown as typeof fetch })
    expect(await lookup(ORG)).toBeNull()
    expect(await lookup(ORG)).toBe("k1")
    t = 299_000
    expect(await lookup(ORG)).toBe("k1")
    t = 301_000
    expect(await lookup(ORG)).toBe("k2")
    expect(await lookup("x' or 1=1")).toBeNull()
    expect(n).toBe(3)
  })
})
