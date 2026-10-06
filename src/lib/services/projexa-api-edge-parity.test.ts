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
import { ALLOWED_ORIGINS, apiPathOf, createUpstreamCache, handleApi, UPLOAD_MAX_BYTES, type ApiDeps, type UpstreamCache } from "../../../supabase/functions/projexa-api/handler"
import { createMembershipLookup, createOrgKeyLookup } from "../../../supabase/functions/projexa-api/lookups"
import { checkApiWriteAccess, EDGE_ROUTES, SOURCE_SHA256, sourceData } from "../../../supabase/functions/projexa-api/policy.generated"
import type { SessionVerifier } from "../../../supabase/functions/ai-work-link/session"

const DIR = join(import.meta.dir, "..", "..", "..", "supabase", "functions", "projexa-api")
type Identity = { sub: string; email: string | null; membership: { organization_id: string; role: string } | null | "error" }
type Upstream = { kind: "json"; status: number; body: unknown } | { kind: "text"; status: number; status_text: string; text: string } | { kind: "refused" }
/** raw_body (batch 5): the body sent as text (empty / broken / JSON null / array / number), for the lenient, defaulted and validated body reads. */
type Multipart = { fields: [string, string][]; files?: { field: string; name: string; type: string; content: string }[] }
/** content_type (batch 7): with raw_body, for a body that is not JSON; multipart (batch 7): an upload form. */
type Case = { name: string; method: string; path: string; body?: unknown; raw_body?: string; content_type?: string; multipart?: Multipart; who: string; upstream: Upstream }
type Step = { method: string; path: string; who: string; upstream: Upstream; advance_ms?: number }
type Call = { method: string; path: string; authorization: string | null; acting_user: string | null; acting_email: string | null; content_type: string | null; body: unknown }
/** cache_control: present only when the answer sets a Cache-Control other than "no-store" (the projexa recorder normalises the same way). */
type Outcome = { status: number; body: unknown; retry_after: string | null; upstream_calls: Call[]; cache_control?: string; revalidated?: { tags: string[]; paths: string[] } }
const golden = JSON.parse(readFileSync(join(DIR, "parity.golden.json"), "utf8")) as {
  identities: Record<string, Identity>
  org_keys: Record<string, string>
  upstream_base: string
  cases: { case: Case; expect: Outcome }[]
  sequences: { sequence: { name: string; steps: Step[] }; expect: Outcome[] }[]
}

const ISSUER = "https://evpckeuxgvahguwsaeul.supabase.co/auth/v1"
const ROOT = golden.upstream_base.replace(/\/projexa$/, "")
function wirePath(url: string): string {
  const href = new URL(url).href
  const base = new URL(golden.upstream_base).href
  if (href.startsWith(base)) return href.slice(base.length)
  if (!href.startsWith(new URL(ROOT).href + "/")) throw new Error(`unexpected upstream ${href}`)
  return `[root]${href.slice(new URL(ROOT).href.length)}`
}
const FN = "https://pcrjmlpuqsbocqfwoxod.supabase.co/functions/v1/projexa-api"

/** What an upload sends upstream, as the projexa recorder writes it (names, text, each file's name / type / size / text, in order). */
async function recordForm(form: FormData) {
  const out: [string, string | { file: { name: string; type: string; size: number; text: string } }][] = []
  for (const [name, value] of form.entries()) {
    if (typeof value === "string") out.push([name, value])
    else out.push([name, { file: { name: value.name, type: value.type, size: value.size, text: await value.text() } }])
  }
  return { multipart: out }
}
/** The request a browser sends for a case (the same builder as the projexa recorder's): JSON, raw text with its content type, or a multipart form. */
function requestBody(c: Pick<Case, "body" | "raw_body" | "content_type" | "multipart">): { headers: Record<string, string>; body: BodyInit | undefined } {
  if (c.multipart) {
    const form = new FormData()
    for (const [k, v] of c.multipart.fields) form.append(k, v)
    for (const f of c.multipart.files ?? []) form.append(f.field, new File([f.content], f.name, { type: f.type }))
    return { headers: {}, body: form }
  }
  const sent = c.raw_body !== undefined ? c.raw_body : c.body === undefined ? undefined : JSON.stringify(c.body)
  return { headers: sent === undefined ? {} : { "content-type": c.content_type ?? "application/json" }, body: sent }
}

/** The edge function with fakes for the session, the two PROJEXA reads and the upstream; `policy` lets a mutation test swap the gate. */
async function runEdge(c: Pick<Case, "name" | "method" | "path" | "body" | "raw_body" | "content_type" | "multipart" | "who" | "upstream">, over: Partial<ApiDeps> = {}, extraHeaders: Record<string, string> = {}): Promise<Outcome> {
  const calls: Call[] = []
  const id = c.who === "signed_out" ? null : golden.identities[c.who]
  const session: SessionVerifier = async (token) => (id && token === `tok:${c.who}` ? { ok: true, sub: id.sub, email: id.email, issuer: ISSUER, iat: 1 } : { ok: false, reason: "invalid" })
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const h = new Headers(init?.headers)
    calls.push({
      method: (init?.method ?? "GET").toUpperCase(),
      // as it goes on the wire (URL-normalised), exactly how the projexa recorder writes it ("[root]" + the path under /api/v1 for a root call)
      path: wirePath(url),
      authorization: h.get("authorization"),
      acting_user: h.get("x-acting-user"),
      acting_email: h.get("x-acting-user-email"),
      content_type: h.get("content-type"),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
    })
    if (init?.body instanceof FormData) {
      const entry = calls[calls.length - 1]!
      entry.body = await recordForm(init.body)
    }
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
    cache: createUpstreamCache(), // every case starts with an empty cache (a sequence passes its own)
    ...over,
  }
  const built = requestBody(c)
  const headers: Record<string, string> = { ...extraHeaders, ...built.headers }
  if (c.who !== "signed_out") headers.authorization = `Bearer tok:${c.who}`
  const res = await handleApi(new Request(`${FN}${c.path}`, { method: c.method, headers, body: built.body }), deps)
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

/** The page-side cache entries the real Next handler cleared are recorded in the contract for the projexa repo's own test (the browser clears them);
 *  the edge does not clear anything, so that field is not part of what the edge answers. */
const withoutRevalidated = ({ revalidated: _r, ...rest }: Outcome): Outcome => rest

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
      expect(await runEdge(c)).toEqual(withoutRevalidated(want))
    })
  }
})

describe("AUDIT-100 A2 batch 7: the per-instance TTL cache, replayed as the Next pipeline answered it (sequences against one cache, a moving clock)", () => {
  for (const { sequence, expect: want } of golden.sequences) {
    test(sequence.name, async () => {
      let t = 0
      const cache = createUpstreamCache(() => t)
      const got: Outcome[] = []
      for (const [i, step] of sequence.steps.entries()) {
        t += step.advance_ms ?? 0
        got.push(await runEdge({ name: `${sequence.name} #${i + 1}`, ...step }, { cache }))
      }
      expect(got).toEqual(want.map(withoutRevalidated))
    })
  }
})

describe("AUDIT-100 A2 batch 7: what the edge adds on its own (not comparable with Next: a per-isolate cache, an upload ceiling)", () => {
  const read = (path: string, who = "owner") => ({ name: "x", method: "GET", path, who, upstream: { kind: "json", status: 200, body: { n: 1 } } as Upstream })
  const countingFetch = (calls: string[]) =>
    (async (input: RequestInfo | URL) => (calls.push(String(input)), new Response(JSON.stringify({ n: calls.length }), { status: 200, headers: { "Content-Type": "application/json" } }))) as typeof fetch

  test("the cache is fresh for exactly the TTL: 59.999 s still cached, 60 s fetches again (the real cache would serve the stale answer once; this never serves older than the TTL)", async () => {
    let t = 0
    const cache = createUpstreamCache(() => t)
    const calls: string[] = []
    const run = () => runEdge(read("/api/currencies"), { cache, fetchImpl: countingFetch(calls) })
    expect((await run()).body).toEqual({ n: 1 })
    t = 59_999
    expect((await run()).body).toEqual({ n: 1 })
    expect(calls).toHaveLength(1)
    t = 60_000
    expect((await run()).body).toEqual({ n: 2 })
    expect(calls).toHaveLength(2)
  })

  test("a cached answer is the organisation's, kept apart per organisation AND per URL, and needs neither a key lookup nor an upstream call", async () => {
    const cache = createUpstreamCache()
    const calls: string[] = []
    let keyLookups = 0
    const deps = { cache, fetchImpl: countingFetch(calls), orgKey: async (org: string) => (keyLookups++, golden.org_keys[org] ?? null) }
    await runEdge(read("/api/cost-centers"), deps)
    await runEdge(read("/api/cost-centers", "pm"), deps)
    await runEdge(read("/api/cost-centers", "client_viewer"), deps)
    expect(calls).toHaveLength(1)
    expect(keyLookups).toBe(1)
    await runEdge(read("/api/cost-centers", "wrong_org"), deps)
    await runEdge(read("/api/fiscal-years"), deps)
    expect(calls).toHaveLength(3)
  })

  test("the cache is bounded: the oldest entry goes first", () => {
    let t = 0
    const cache = createUpstreamCache(() => t, 3)
    for (const k of ["a", "b", "c", "d"]) cache.set(k, k)
    expect(["a", "b", "c", "d"].map((k) => cache.get(k, 60))).toEqual([undefined, "b", "c", "d"])
    cache.set("b", "b2") // refreshed: now the newest
    cache.set("e", "e")
    expect(["b", "c", "d", "e"].map((k) => cache.get(k, 60))).toEqual(["b2", undefined, "d", "e"])
  })

  test("only the cache_ttl routes are cached: a list read of another route goes upstream every time", async () => {
    const cache = createUpstreamCache()
    const calls: string[] = []
    for (let i = 0; i < 3; i++) await runEdge(read("/api/labour-roster?projectId=p-1"), { cache, fetchImpl: countingFetch(calls) })
    expect(calls).toHaveLength(3)
  })

  test("an upload larger than the ceiling is 413 before anything is read or sent", async () => {
    const calls: string[] = []
    const out = await runEdge({ name: "x", method: "POST", path: "/api/documents", who: "site_engineer", upstream: { kind: "json", status: 200, body: {} }, multipart: { fields: [["name", "x"]] } }, { fetchImpl: countingFetch(calls) }, { "content-length": String(UPLOAD_MAX_BYTES + 1) })
    expect(out.status).toBe(413)
    expect(out.body).toEqual({ error: "Request body too large" })
    expect(calls).toHaveLength(0)
  })

  test("an upload is relayed with NO Content-Type of its own (the multipart boundary is made by fetch), and is never retried after a connection failure", async () => {
    const seen: Headers[] = []
    const failing = (async (_i: RequestInfo | URL, init?: RequestInit) => {
      seen.push(new Headers(init?.headers))
      throw new TypeError("fetch failed")
    }) as typeof fetch
    const out = await runEdge({ name: "x", method: "POST", path: "/api/permits", who: "pm", upstream: { kind: "refused" }, multipart: { fields: [["name", "x"]], files: [{ field: "file", name: "a.pdf", type: "application/pdf", content: "x" }] } }, { fetchImpl: failing })
    expect(out.status).toBe(503)
    expect(seen).toHaveLength(1)
    expect(seen[0]!.get("content-type")).toBeNull()
    expect(seen[0]!.get("authorization")).toBe("Bearer key-org-a")
  })
})

describe("deny by default, and what the edge never does", () => {
  const owner = golden.cases.find((c) => c.case.who === "owner")!.case
  test("a path that is not one of the function's routes is 404 before anything else (even a real Vercel route, even signed in)", async () => {
    for (const path of ["/api/assistant", "/api/payroll/payslips/p-1/pdf", "/api/scope/line-items", "/api/documents/d-1/versions", "/api/org/invites", "/api/permits/x/extra", "/rest/v1/memberships", "/api"]) {
      const out = await runEdge({ ...owner, method: "POST", path, body: {} })
      expect(out.status).toBe(404)
      expect(out.upstream_calls).toHaveLength(0)
    }
  })
  test("batch 5: a Vercel route that is a literal sibling of a dynamic edge route is 404 here, not answered as the dynamic route", async () => {
    // GET /api/drawings/export is the xlsx download (stays on Vercel), not /api/drawings/:id with id "export"; 
    // (batch 6 moved /api/timesheets/review-day, /api/scope/categories/:id and /api/projects/overview to the edge, so they are no longer
    // shadows; /api/work-progress/photos and /report became shadows of the new /api/work-progress/:id)
    for (const [method, path] of [["GET", "/api/drawings/export?projectId=p-1"], ["GET", "/api/work-progress/photos?veridianEntryId=e-1"], ["GET", "/api/work-progress/report?projectId=p-1"], ["POST", "/api/work-progress/photos"]]) {
      const out = await runEdge({ ...owner, method, path, body: method === "GET" ? undefined : {} })
      expect(out.status, `${method} ${path}`).toBe(404)
      expect(out.upstream_calls).toHaveLength(0)
    }
    // batch 6: a literal edge route wins like in the App Router, and a method it lacks is 405 there too (POST /api/scope/categories/approve
    // is /api/scope/categories/:id with id "approve", which has PATCH and DELETE only; /api/projects/overview has GET only)
    for (const [method, path] of [["POST", "/api/scope/categories/approve"], ["PATCH", "/api/projects/overview"]]) {
      const out = await runEdge({ ...owner, method, path, body: {} })
      expect(out.status, `${method} ${path}`).toBe(405)
      expect(out.upstream_calls).toHaveLength(0)
    }
    // and the dynamic route itself still answers
    expect((await runEdge({ ...owner, method: "GET", path: "/api/drawings/dr-9" })).status).toBe(200)
    expect((await runEdge({ ...owner, method: "GET", path: "/api/materials/m-9" })).status).toBe(200)
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
  test("an invalid JSON body is the empty 500 a Next handler's unhandled throw is (it reads `await request.json()` outside its try), and nothing is sent", async () => {
    const pm = golden.cases.find((c) => c.case.name === "PATCH /api/scope/line-items/:id as pm")!.case
    const res = await handleApi(
      new Request(`${FN}${pm.path}`, { method: "PATCH", headers: { authorization: "Bearer tok:pm", "content-type": "application/json" }, body: "{not json" }),
      { session: async () => ({ ok: true, sub: golden.identities.pm.sub, email: "pm@a.test", issuer: ISSUER, iat: 1 }), issuer: ISSUER, membership: async () => ({ ok: true, row: { organization_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", role: "pm" } }), orgKey: async () => "k", upstreamBase: "https://u.test", fetchImpl: (() => { throw new Error("must not be called") }) as unknown as typeof fetch },
    )
    expect(res.status).toBe(500)
    expect(await res.text()).toBe("")
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
