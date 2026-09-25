/// <reference types="bun-types" />
// PROJEXA-BUILD-001 U-25 (PMD-01): the identity gateway (Edge Function supabase/functions/projexa-read + drizzle/0618). Three proofs,
// none touching a live database or the network:
//   1. TOKEN: the real verifier (jwt.ts) with the real jose package, a real ES256 key pair made with WebCrypto, tokens signed here
//      with SignJWT, and the public key served through an injected key resolver (jose's createLocalJWKSet) in place of the PROJEXA
//      key set URL: the PROJEXA issuer is accepted; a foreign issuer, a wrong audience, an expired token, alg none / HS256 / RS256,
//      a bad signature, an altered payload and no token are all 401 with one generic body.
//   2. HANDLER: the real request handler (handler.ts) end to end through that verifier, with the RPC passed in: unlinked,
//      deactivated and ambiguous callers get 403 USER_NOT_LINKED with auth-guard.ts's own sentence; another organisation's project
//      is 404 and never carries rows; the switch off is 503; CORS and cache headers; project-side cost fields stripped; and the token
//      never appears in a response body or a log line.
//   3. SQL on PGlite (real Postgres as WASM): drizzle/0618_build001_projexa_gateway.sql and its down file over the committed base
//      snapshot of the live tables (scripts/verify/fixtures/0618_build001_projexa_gateway.base.sql): org A reads only org A's
//      lines, org B's project is not_found, unlinked is not_linked, the switch, keyset paging, grants service_role only (guard G-5
//      is 0), why the wrapper cannot switch to app_runtime (Postgres refuses SET ROLE inside SECURITY DEFINER), and the down file.
// Lives under src/ because bunfig.toml sets [test] root = "src". Run: bun test --isolate src/lib/services/projexa-read-gateway.test.ts
import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { readFileSync, readdirSync } from "node:fs"
import { PGlite } from "@electric-sql/pglite"
import * as jose from "jose"
import {
  PROJEXA_ISSUER,
  PROJEXA_JWKS_URL,
  verifyProjexaToken,
  createProjexaKeyResolver,
  type JoseLike,
  type KeyResolver,
} from "../../../supabase/functions/projexa-read/jwt"
import {
  handleProjexaRead,
  ALLOWED_ORIGINS,
  PROJECT_SIDE_COST_FIELDS,
  USER_NOT_LINKED_MESSAGE,
  type GatewayDeps,
  type RpcResult,
} from "../../../supabase/functions/projexa-read/handler"

const REPO_ROOT = new URL("../../../", import.meta.url)
const read = (rel: string) => readFileSync(new URL(rel, REPO_ROOT), "utf8")
const FORWARD = read("drizzle/0618_build001_projexa_gateway.sql")
const DOWN = read("drizzle/down/0618_build001_projexa_gateway.down.sql")
const BASE = read("scripts/verify/fixtures/0618_build001_projexa_gateway.base.sql")
const JOSE = jose as unknown as JoseLike

const SUB_A = "0a0a0a0a-0000-4000-8000-00000000000a"
const SUB_B = "0b0b0b0b-0000-4000-8000-00000000000b"
const SUB_DEACT = "0d0d0d0d-0000-4000-8000-00000000000d"
const SUB_UNLINKED = "0e0e0e0e-0000-4000-8000-00000000000e"
const KID = "test-es256-kid"

type Keys = { privateKey: CryptoKey; publicKey: CryptoKey }
let es256: Keys
let otherEs256: Keys
let keys: KeyResolver

async function sign(opts: { iss?: string; aud?: string; sub?: string; exp?: number | string; claims?: Record<string, unknown>; key?: CryptoKey; kid?: string } = {}) {
  const jwt = new jose.SignJWT({ role: "authenticated", email: "person.a@example.test", ...(opts.claims ?? {}) })
    .setProtectedHeader({ alg: "ES256", kid: opts.kid ?? KID, typ: "JWT" })
    .setIssuer(opts.iss ?? PROJEXA_ISSUER)
    .setAudience(opts.aud ?? "authenticated")
    .setSubject(opts.sub ?? SUB_A)
    .setIssuedAt()
    .setExpirationTime(opts.exp ?? "1h")
  return jwt.sign(opts.key ?? es256.privateKey)
}

const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url")

beforeAll(async () => {
  // A real ES256 (ECDSA P-256) key pair from WebCrypto, the same key type PROJEXA's key set publishes.
  es256 = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as Keys
  otherEs256 = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as Keys
  const jwk = await jose.exportJWK(es256.publicKey)
  keys = jose.createLocalJWKSet({ keys: [{ ...jwk, kid: KID, alg: "ES256", use: "sig" }] })
})

const verify = (token: string) => verifyProjexaToken(token, { jose: JOSE, keys })

// ------------------------------------------------------------------------------------------------ 1. token
describe("verifyProjexaToken (jwt.ts) with real jose and a real ES256 key", () => {
  test("a token from the PROJEXA issuer, audience authenticated, signed by the key set's key, is accepted", async () => {
    expect(await verify(await sign())).toEqual({ ok: true, sub: SUB_A, email: "person.a@example.test" })
  })

  test("a foreign issuer (verdian-ai's own Auth) is refused", async () => {
    expect(await verify(await sign({ iss: "https://pcrjmlpuqsbocqfwoxod.supabase.co/auth/v1" }))).toEqual({ ok: false, reason: "invalid" })
  })

  test("a wrong audience is refused", async () => {
    expect(await verify(await sign({ aud: "anon" }))).toEqual({ ok: false, reason: "invalid" })
  })

  test("an expired token is refused (beyond the 5 second clock tolerance)", async () => {
    expect(await verify(await sign({ exp: Math.floor(Date.now() / 1000) - 120 }))).toEqual({ ok: false, reason: "invalid" })
  })

  test("alg none, HS256 and RS256 are refused", async () => {
    const payload = { iss: PROJEXA_ISSUER, aud: "authenticated", sub: SUB_A, role: "authenticated", exp: Math.floor(Date.now() / 1000) + 600 }
    const none1 = `${b64url({ alg: "none", typ: "JWT" })}.${b64url(payload)}.`
    const none2 = `${b64url({ alg: "none", typ: "JWT", kid: KID })}.${b64url(payload)}.AAAA`
    const hs = await new jose.SignJWT(payload).setProtectedHeader({ alg: "HS256", kid: KID }).sign(new TextEncoder().encode("s".repeat(48)))
    const rsa = await jose.generateKeyPair("RS256")
    const rs = await new jose.SignJWT(payload).setProtectedHeader({ alg: "RS256", kid: KID }).sign(rsa.privateKey)
    for (const t of [none1, none2, hs, rs]) expect(await verify(t)).toEqual({ ok: false, reason: "invalid" })
  })

  test("a signature by another key (same kid), and a payload altered after signing, are refused", async () => {
    expect(await verify(await sign({ key: otherEs256.privateKey }))).toEqual({ ok: false, reason: "invalid" })
    const [h, , s] = (await sign()).split(".")
    const forged = `${h}.${b64url({ iss: "https://evil.example/auth/v1", aud: "authenticated", sub: SUB_B, role: "authenticated", exp: Math.floor(Date.now() / 1000) + 600 })}.${s}`
    expect(await verify(forged)).toEqual({ ok: false, reason: "invalid" })
    expect(await verify(await sign({ kid: "unknown-kid" }))).toEqual({ ok: false, reason: "invalid" })
  })

  test("a non-UUID sub, a role other than authenticated, an anonymous sign-in and garbage are refused", async () => {
    expect(await verify(await sign({ sub: "not-a-uuid" }))).toEqual({ ok: false, reason: "invalid" })
    expect(await verify(await sign({ claims: { role: "service_role" } }))).toEqual({ ok: false, reason: "invalid" })
    expect(await verify(await sign({ claims: { is_anonymous: true } }))).toEqual({ ok: false, reason: "invalid" })
    for (const t of ["", "abc", "a.b", "a.b.c.d", "x".repeat(9000)]) expect(await verify(t)).toEqual({ ok: false, reason: "invalid" })
  })

  test("a key set that cannot be fetched is 'unavailable' (503), not 'invalid' (401)", async () => {
    const down: KeyResolver = async () => {
      throw new jose.errors.JWKSTimeout()
    }
    const net: KeyResolver = async () => {
      throw new TypeError("error sending request")
    }
    expect(await verifyProjexaToken(await sign(), { jose: JOSE, keys: down })).toEqual({ ok: false, reason: "unavailable" })
    expect(await verifyProjexaToken(await sign(), { jose: JOSE, keys: net })).toEqual({ ok: false, reason: "unavailable" })
  })

  test("the production resolver is the PROJEXA key set URL with a 10 minute cache", () => {
    const seen: Array<{ url: string; opts: Record<string, unknown> | undefined }> = []
    createProjexaKeyResolver({ createRemoteJWKSet: (url, opts) => { seen.push({ url: url.href, opts }); return async () => null } })
    expect(seen).toEqual([{ url: PROJEXA_JWKS_URL, opts: { cacheMaxAge: 600000, cooldownDuration: 30000, timeoutDuration: 5000 } }])
    expect(PROJEXA_JWKS_URL).toBe(`${PROJEXA_ISSUER}/.well-known/jwks.json`)
  })
})

describe("projexa-read source guards (BR-317, BR-318)", () => {
  const dir = new URL("supabase/functions/projexa-read/", REPO_ROOT)
  const files = readdirSync(dir).map((f) => ({ f, text: readFileSync(new URL(f, dir), "utf8") }))

  test("the key set URL literal appears on exactly one line of the function's source (BR-317)", () => {
    const lines = files.flatMap(({ text }) => text.split("\n").filter((l) => l.includes(PROJEXA_JWKS_URL)))
    expect(lines.length).toBe(1)
  })

  test("no JWT signing secret, service-role key or PROJEXA secret is named or embedded in the source (BR-318)", () => {
    for (const { f, text } of files) {
      expect({ f, hit: /JWT_SECRET|jwt_secret/.test(text) }).toEqual({ f, hit: false })
      expect({ f, hit: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/.test(text) }).toEqual({ f, hit: false })
    }
  })

  test("index.ts pins npm:jose to the version the test runs (node_modules/jose)", () => {
    const pinned = /npm:jose@([0-9.]+)/.exec(files.find((x) => x.f === "index.ts")!.text)?.[1]
    const installed = (JSON.parse(read("node_modules/jose/package.json")) as { version: string }).version
    expect(pinned).toBe(installed)
  })
})

// ------------------------------------------------------------------------------------------------ 2. handler
type Call = { fn: string; args?: Record<string, unknown> }
const ORG_B_ROW = { id: "line-of-org-b", description: "ORG-B-SECRET-LINE", orgMarker: "org-b" }

function makeDeps(opts: { enabled?: boolean | "error"; boq?: unknown; boqError?: string; verify?: GatewayDeps["verify"] } = {}) {
  const calls: Call[] = []
  const logs: string[] = []
  const deps: GatewayDeps = {
    verify: opts.verify ?? verify,
    log: (line) => logs.push(line),
    rpc: async (fn, args): Promise<RpcResult> => {
      calls.push({ fn, args })
      if (fn === "projexa_read_enabled") {
        if (opts.enabled === "error") return { data: null, error: { message: "rpc down" } }
        return { data: opts.enabled ?? true, error: null }
      }
      if (fn === "projexa_read_boq_lines") {
        if (opts.boqError) return { data: null, error: { message: opts.boqError } }
        return { data: opts.boq ?? { status: "ok", rows: [{ id: "l1", description: "Excavation", quantity: "10" }], nextAfter: null }, error: null }
      }
      return { data: null, error: { message: `unexpected rpc ${fn}` } }
    },
  }
  return { deps, calls, logs }
}

function req(init: { method?: string; token?: string | null; auth?: string; query?: string; origin?: string } = {}): Request {
  const headers: Record<string, string> = {}
  if (init.auth !== undefined) headers.Authorization = init.auth
  else if (init.token) headers.Authorization = `Bearer ${init.token}`
  if (init.origin) headers.Origin = init.origin
  const query = init.query ?? "fn=boq_lines&projectId=proj-a&limit=50"
  return new Request(`https://example.test/functions/v1/projexa-read?${query}`, { method: init.method ?? "GET", headers })
}

// Every response body and every log line of this describe block, to check at the end that no token ever leaked.
const seenTokens: string[] = []
const seenOutput: string[] = []
async function run(r: Request, deps: GatewayDeps, logs: string[]): Promise<{ res: Response; body: any; text: string }> {
  const res = await handleProjexaRead(r, deps)
  const text = await res.text()
  seenOutput.push(text, ...logs, ...[...res.headers.entries()].map(([k, v]) => `${k}: ${v}`))
  return { res, body: text ? JSON.parse(text) : null, text }
}

describe("handleProjexaRead (handler.ts) through the real verifier", () => {
  const consoleSeen: string[] = []
  const saved = { log: console.log, error: console.error, warn: console.warn, info: console.info }
  let token: string

  beforeAll(async () => {
    token = await sign()
    seenTokens.push(token)
    for (const k of ["log", "error", "warn", "info"] as const) {
      console[k] = (...a: unknown[]) => { consoleSeen.push(a.map(String).join(" ")); }
    }
  })
  afterAll(() => {
    Object.assign(console, saved)
  })

  test("a verified, linked caller of the project's organisation gets 200 with the rows and the wrapper gets only the verified identity", async () => {
    const { deps, calls, logs } = makeDeps({ boq: { status: "ok", rows: [{ id: "l1" }, { id: "l2" }], nextAfter: "l2" } })
    const { res, body } = await run(req({ token, query: "fn=boq_lines&projectId=proj-a&after=l0&limit=2&orgId=org-b" }), deps, logs)
    expect(res.status).toBe(200)
    expect(body).toEqual({ fn: "boq_lines", projectId: "proj-a", rows: [{ id: "l1" }, { id: "l2" }], nextAfter: "l2" })
    expect(calls.map((c) => c.fn)).toEqual(["projexa_read_enabled", "projexa_read_boq_lines"])
    // the organisation is never taken from the request: an orgId query parameter is ignored and no org argument exists
    expect(calls[1].args).toEqual({ p_sub: SUB_A, p_email: "person.a@example.test", p_project_id: "proj-a", p_after: "l0", p_limit: 2 })
  })

  test("no token, a malformed header, a foreign issuer, an expired token and alg none are all 401 with one generic body, before any RPC", async () => {
    const bad = [
      req({ token: null }),
      req({ auth: "Basic dXNlcjpwYXNz" }),
      req({ auth: "Bearer" }),
      req({ token: await sign({ iss: "https://pcrjmlpuqsbocqfwoxod.supabase.co/auth/v1" }) }),
      req({ token: await sign({ exp: Math.floor(Date.now() / 1000) - 120 }) }),
      req({ token: `${b64url({ alg: "none" })}.${b64url({ iss: PROJEXA_ISSUER, aud: "authenticated", sub: SUB_A, role: "authenticated", exp: 9999999999 })}.x` }),
    ]
    for (const r of bad) {
      const presented = (r.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "")
      if (presented.split(".").length === 3) seenTokens.push(presented)
      const { deps, calls, logs } = makeDeps()
      const { res, body } = await run(r, deps, logs)
      expect(res.status).toBe(401)
      expect(body).toEqual({ error: "Unauthorized" })
      expect(res.headers.get("www-authenticate")).toBe('Bearer realm="projexa-read"')
      expect(calls).toEqual([])
    }
  })

  test("the key set being unreachable is 503, not 401", async () => {
    const { deps, calls, logs } = makeDeps({ verify: (t) => verifyProjexaToken(t, { jose: JOSE, keys: async () => { throw new jose.errors.JWKSTimeout() } }) })
    const { res } = await run(req({ token }), deps, logs)
    expect(res.status).toBe(503)
    expect(calls).toEqual([])
  })

  test("unlinked, deactivated and ambiguous callers get 403 USER_NOT_LINKED with auth-guard.ts's own sentence", async () => {
    const authGuard = read("src/lib/supabase/auth-guard.ts")
    const guardSentence = /export const USER_NOT_LINKED_MESSAGE = "([^"]+)"/.exec(authGuard)?.[1]
    expect(USER_NOT_LINKED_MESSAGE).toBe(guardSentence!)
    for (const status of ["not_linked", "deactivated", "ambiguous"]) {
      const { deps, logs } = makeDeps({ boq: { status } })
      const { res, body } = await run(req({ token }), deps, logs)
      expect(res.status).toBe(403)
      expect(body).toEqual({ error: USER_NOT_LINKED_MESSAGE, code: "USER_NOT_LINKED" })
    }
  })

  test("another organisation's project is 404 and never carries a row, even if the wrapper were to send some", async () => {
    const { deps, logs } = makeDeps({ boq: { status: "not_found", rows: [ORG_B_ROW], nextAfter: ORG_B_ROW.id } })
    const { res, body, text } = await run(req({ token, query: "fn=boq_lines&projectId=proj-of-org-b" }), deps, logs)
    expect(res.status).toBe(404)
    expect(body).toEqual({ error: "Not found" })
    expect(text).not.toContain("ORG-B-SECRET-LINE")
    expect(text).not.toContain(ORG_B_ROW.id)
  })

  test("the switch off (false, RPC error, or the wrapper saying disabled) is 503 and reads no data", async () => {
    for (const enabled of [false, "error"] as const) {
      const { deps, calls, logs } = makeDeps({ enabled })
      const { res, body } = await run(req({ token }), deps, logs)
      expect(res.status).toBe(503)
      expect(body).toEqual({ error: "Service unavailable" })
      expect(calls.map((c) => c.fn)).toEqual(["projexa_read_enabled"])
    }
    const { deps, logs } = makeDeps({ boq: { status: "disabled" } })
    expect((await run(req({ token }), deps, logs)).res.status).toBe(503)
  })

  test("bad parameters are 400; a method other than GET/OPTIONS is 405; a wrapper error is a generic 500", async () => {
    for (const query of ["fn=boq_lines", "fn=boq_lines&projectId=a%20b", "fn=boq_lines&projectId=p&limit=0", "fn=boq_lines&projectId=p&limit=501", "fn=boq_lines&projectId=p&limit=abc", "fn=boq_lines&projectId=p&after=x%27y", "fn=users&projectId=p", "projectId=p"]) {
      const { deps, logs } = makeDeps()
      expect((await run(req({ token, query }), deps, logs)).res.status).toBe(400)
    }
    const post = makeDeps()
    expect((await run(req({ token, method: "POST" }), post.deps, post.logs)).res.status).toBe(405)
    const broken = makeDeps({ boqError: "relation compliance.construction_boq_line_items does not exist" })
    const { res, text } = await run(req({ token }), broken.deps, broken.logs)
    expect(res.status).toBe(500)
    expect(text).not.toContain("compliance.")
  })

  test("the default limit is 100 and the largest is 500", async () => {
    const a = makeDeps()
    await run(req({ token, query: "fn=boq_lines&projectId=p" }), a.deps, a.logs)
    expect(a.calls[1].args?.p_limit).toBe(100)
    const b = makeDeps()
    await run(req({ token, query: "fn=boq_lines&projectId=p&limit=500" }), b.deps, b.logs)
    expect(b.calls[1].args?.p_limit).toBe(500)
  })

  test("CORS: an allowed PROJEXA origin is echoed, any other origin is not; cache and Vary headers are always set", async () => {
    for (const origin of ALLOWED_ORIGINS) {
      const { deps, logs } = makeDeps()
      const { res } = await run(req({ token, origin }), deps, logs)
      expect(res.headers.get("access-control-allow-origin")).toBe(origin)
      expect(res.headers.get("cache-control")).toBe("private, no-store")
      expect(res.headers.get("vary")).toBe("Authorization, Origin")
    }
    for (const r of [req({ token, origin: "https://evil.example" }), req({ token: null, origin: "https://evil.example" })]) {
      const { deps, logs } = makeDeps()
      const { res } = await run(r, deps, logs)
      expect(res.headers.get("access-control-allow-origin")).toBeNull()
      expect(res.headers.get("cache-control")).toBe("private, no-store")
      expect(res.headers.get("vary")).toBe("Authorization, Origin")
    }
    const unauth = makeDeps()
    const { res } = await run(req({ token: null, origin: "https://projexa-ai.com" }), unauth.deps, unauth.logs)
    expect(res.status).toBe(401)
    expect(res.headers.get("access-control-allow-origin")).toBe("https://projexa-ai.com")
  })

  test("OPTIONS preflight: 204, no RPC, methods and headers only for an allowed origin", async () => {
    const ok = makeDeps()
    const { res } = await run(new Request("https://example.test/functions/v1/projexa-read", { method: "OPTIONS", headers: { Origin: "https://www.projexa-ai.com", "Access-Control-Request-Method": "GET" } }), ok.deps, ok.logs)
    expect(res.status).toBe(204)
    expect(res.headers.get("access-control-allow-origin")).toBe("https://www.projexa-ai.com")
    expect(res.headers.get("access-control-allow-methods")).toBe("GET, OPTIONS")
    expect(res.headers.get("access-control-allow-headers")).toContain("authorization")
    expect(ok.calls).toEqual([])
    const evil = makeDeps()
    const r2 = await run(new Request("https://example.test/functions/v1/projexa-read", { method: "OPTIONS", headers: { Origin: "https://evil.example" } }), evil.deps, evil.logs)
    expect(r2.res.status).toBe(204)
    expect(r2.res.headers.get("access-control-allow-origin")).toBeNull()
    expect(r2.res.headers.get("access-control-allow-methods")).toBeNull()
  })

  test("project-side cost fields are stripped from every row, and the handler's list covers cost-visibility-service.ts's", async () => {
    const svc = read("src/lib/services/cost-visibility-service.ts")
    const block = /PROJECT_SIDE_COST_FIELDS: ReadonlySet<string> = new Set\(\[([\s\S]*?)\]\)/.exec(svc)?.[1] ?? ""
    const names = [...block.replace(/\/\/.*$/gm, "").matchAll(/"([A-Za-z]+)"/g)].map((m) => m[1])
    expect(names.length).toBeGreaterThanOrEqual(10)
    for (const n of names) expect(PROJECT_SIDE_COST_FIELDS.has(n)).toBe(true)
    const { deps, logs } = makeDeps({ boq: { status: "ok", rows: [{ id: "l1", quantity: "2", qtyProject: "3", rateProject: "99", qtyContract: "2" }], nextAfter: null } })
    const { body } = await run(req({ token }), deps, logs)
    expect(body.rows).toEqual([{ id: "l1", quantity: "2", qtyContract: "2" }])
  })

  test("no token, and no part of a token's signature, ever appeared in a response body, a header or a log line", () => {
    const all = [...seenOutput, ...consoleSeen].join("\n")
    expect(seenOutput.length).toBeGreaterThan(20)
    for (const t of seenTokens) {
      expect(all.includes(t)).toBe(false)
      const sig = t.split(".")[2]
      if (sig && sig.length > 8) expect(all.includes(sig)).toBe(false)
    }
  })
})

// ------------------------------------------------------------------------------------------------ 3. SQL on PGlite
// Live Supabase gives every new function in schema public EXECUTE for anon/authenticated/service_role, and every new table in
// schema platform read/write for service_role/app_runtime (pg_default_acl, read 2026-09-25); reproduced here so the REVOKEs are
// really tested.
const ROLES_SQL = `
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE ROLE authenticator NOLOGIN;
CREATE ROLE app_runtime NOLOGIN;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
CREATE SCHEMA platform;
ALTER DEFAULT PRIVILEGES IN SCHEMA platform GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO service_role, app_runtime;
`

const SEED_SQL = `
GRANT USAGE ON SCHEMA compliance TO app_runtime;
INSERT INTO compliance.users (id, name, email, password_hash, is_active, org_id, auth_user_id) VALUES
  ('u-a',      'A',      'person.a@example.test',  'x', true,  'org-a', '${SUB_A}'),
  ('u-b',      'B',      'person.b@example.test',  'x', true,  'org-b', '${SUB_B}'),
  ('u-deact',  'Gone',   'gone@example.test',      'x', false, 'org-a', '${SUB_DEACT}'),
  ('u-mail',   'Mail',   'mail.only@example.test', 'x', true,  'org-a', NULL),
  ('u-dup1',   'Dup 1',  'Dup@Example.test',       'x', true,  'org-a', NULL),
  ('u-dup2',   'Dup 2',  'dup@example.test',       'x', true,  'org-b', NULL),
  ('u-mailx',  'Old',    'old.mail@example.test',  'x', false, 'org-b', NULL);
INSERT INTO compliance.projects (id, product_id, org_id, name) VALUES
  ('proj-a', 'prod', 'org-a', 'Villa A'),
  ('proj-b', 'prod', 'org-b', 'Tower B');
INSERT INTO compliance.construction_boqs (id, org_id, project_id, version, title, created_by_id) VALUES
  ('boq-a1', 'org-a', 'proj-a', 1, 'A original', 'u-a'),
  ('boq-a2', 'org-a', 'proj-a', 2, 'A revision', 'u-a'),
  ('boq-b1', 'org-b', 'proj-b', 1, 'B original', 'u-b'),
  ('boq-b-on-a', 'org-b', 'proj-a', 1, 'inconsistent: org B header on org A project', 'u-b');
INSERT INTO compliance.construction_boq_line_items (id, boq_id, org_id, description, unit, quantity, rate, amount, qty_project, rate_project, qty_contract, rate_contract) VALUES
  ('la-03', 'boq-a1', 'org-a', 'A line 3', 'm3', 3, 10, 30, 3, 7, 3, 10),
  ('LA-01', 'boq-a1', 'org-a', 'A line 1', 'm3', 1, 10, 10, 1, 7, 1, 10),
  ('la-02', 'boq-a2', 'org-a', 'A line 2', 'm2', 2.5, 4.125, 10.3125, 2, 3, 2, 4),
  ('la-05', 'boq-a2', 'org-a', 'A line 5', 'nos', 5, 1, 5, 5, 1, 5, 1),
  ('la-04', 'boq-a1', 'org-a', 'A line 4', 'nos', 4, 1, 4, 4, 1, 4, 1),
  ('lx-wrong-org', 'boq-a1', 'org-b', 'ORG-B-SECRET inconsistent line on an org A BOQ', 'nos', 1, 1, 1, 1, 1, 1, 1),
  ('lx-b-header', 'boq-b-on-a', 'org-b', 'ORG-B-SECRET line under an org B header on the org A project', 'nos', 1, 1, 1, 1, 1, 1, 1),
  ('lb-01', 'boq-b1', 'org-b', 'ORG-B-SECRET B line 1', 'nos', 1, 1, 1, 1, 1, 1, 1),
  ('lb-02', 'boq-b1', 'org-b', 'ORG-B-SECRET B line 2', 'nos', 2, 1, 2, 2, 1, 2, 1);
`

async function one<T = Record<string, unknown>>(db: PGlite, sql: string, params: unknown[] = []): Promise<T> {
  const r = await db.query<T>(sql, params)
  return r.rows[0]
}

type BoqResult = { status: string; rows?: Array<Record<string, unknown>>; nextAfter?: string | null }
const boq = async (db: PGlite, sub: string | null, email: string | null, project: string, after: string | null = null, limit = 100) =>
  (await one<{ r: BoqResult }>(db, "select public.projexa_read_boq_lines($1, $2, $3, $4, $5) r", [sub, email, project, after, limit])).r
const resolve = async (db: PGlite, sub: string | null, email: string | null) =>
  one<{ user_id: string | null; org_id: string | null; reason: string | null }>(db, "select * from public.projexa_read_resolve_user($1, $2)", [sub, email])

describe("drizzle/0618 on PGlite over the live-shaped base snapshot", () => {
  let db: PGlite

  beforeAll(async () => {
    db = new PGlite()
    await db.exec(ROLES_SQL)
    await db.exec(BASE)
    await db.exec(SEED_SQL)
  })
  afterAll(async () => {
    await db.close()
  })

  test("the forward file applies, and a second run changes nothing (and never resets the switch)", async () => {
    await db.exec(FORWARD)
    await db.exec("update platform.projexa_gateway_settings set enabled = true")
    await db.exec(FORWARD)
    expect((await one<{ e: boolean }>(db, "select enabled e from platform.projexa_gateway_settings")).e).toBe(true)
    await db.exec("update platform.projexa_gateway_settings set enabled = false")
    const r = await one<{ n: number; rows: number }>(db, "select (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'projexa\\_read\\_%') n, (select count(*)::int from platform.projexa_gateway_settings) rows")
    expect(r).toEqual({ n: 3, rows: 1 })
  })

  test("the three functions are SECURITY DEFINER, service_role only, with an empty search_path; guard G-5 is 0", async () => {
    const r = await one(
      db,
      `select count(*) filter (where p.prosecdef)::int definers,
              count(*) filter (where has_function_privilege('anon', p.oid, 'EXECUTE'))::int anon,
              count(*) filter (where has_function_privilege('authenticated', p.oid, 'EXECUTE'))::int auth,
              count(*) filter (where has_function_privilege('app_runtime', p.oid, 'EXECUTE'))::int app,
              count(*) filter (where has_function_privilege('service_role', p.oid, 'EXECUTE'))::int svc,
              count(*) filter (where array_to_string(p.proconfig, ',') = 'search_path=""')::int pinned
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname like 'projexa\\_read\\_%'`,
    )
    expect(r).toEqual({ definers: 3, anon: 0, auth: 0, app: 0, svc: 3, pinned: 3 })
    const g5 = await one<{ n: number }>(
      db,
      `select count(*)::int n from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'projexa\\_%'
         and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'))`,
    )
    expect(g5.n).toBe(0)
  })

  test("the switch table: one row, both switches off, RLS forced, SELECT for service_role only (no app_runtime, anon, authenticated)", async () => {
    expect(await one<Record<string, unknown>>(db, "select id, enabled, email_fallback from platform.projexa_gateway_settings")).toEqual({ id: 1, enabled: false, email_fallback: false })
    await expect(db.query("insert into platform.projexa_gateway_settings (id) values (2)")).rejects.toThrow()
    const t = await one(
      db,
      `select c.relrowsecurity rls, c.relforcerowsecurity force,
              has_table_privilege('service_role', c.oid, 'SELECT') svc_select,
              has_table_privilege('service_role', c.oid, 'UPDATE') svc_update,
              has_table_privilege('app_runtime', c.oid, 'SELECT') app_select,
              has_table_privilege('anon', c.oid, 'SELECT') anon_select,
              has_table_privilege('authenticated', c.oid, 'SELECT') auth_select,
              (select count(*)::int from pg_policy where polrelid = c.oid) policies
       from pg_class c where c.oid = 'platform.projexa_gateway_settings'::regclass`,
    )
    expect(t).toEqual({ rls: true, force: true, svc_select: true, svc_update: false, app_select: false, anon_select: false, auth_select: false, policies: 0 })
  })

  test("switch off: projexa_read_enabled() is false and the data wrapper returns 'disabled' without resolving anyone", async () => {
    expect((await one<{ e: boolean }>(db, "select public.projexa_read_enabled() e")).e).toBe(false)
    expect(await boq(db, SUB_A, null, "proj-a")).toEqual({ status: "disabled" })
    await db.exec("update platform.projexa_gateway_settings set enabled = true")
    expect((await one<{ e: boolean }>(db, "select public.projexa_read_enabled() e")).e).toBe(true)
  })

  test("projexa_read_resolve_user: linked, unlinked, deactivated, non-UUID and null subs", async () => {
    expect(await resolve(db, SUB_A, null)).toEqual({ user_id: "u-a", org_id: "org-a", reason: null })
    expect(await resolve(db, SUB_A.toUpperCase(), null)).toEqual({ user_id: "u-a", org_id: "org-a", reason: null })
    expect(await resolve(db, SUB_UNLINKED, null)).toEqual({ user_id: null, org_id: null, reason: "not_linked" })
    expect(await resolve(db, SUB_DEACT, "person.a@example.test")).toEqual({ user_id: null, org_id: null, reason: "deactivated" })
    expect(await resolve(db, "u-a", null)).toEqual({ user_id: null, org_id: null, reason: "not_linked" })
    expect(await resolve(db, null, null)).toEqual({ user_id: null, org_id: null, reason: "not_linked" })
  })

  test("email fallback: off by default (an unlinked sub stays not_linked); on, exactly one active match resolves and anything else does not", async () => {
    expect(await resolve(db, SUB_UNLINKED, "mail.only@example.test")).toEqual({ user_id: null, org_id: null, reason: "not_linked" })
    await db.exec("update platform.projexa_gateway_settings set email_fallback = true")
    try {
      expect(await resolve(db, SUB_UNLINKED, " Mail.Only@Example.TEST ")).toEqual({ user_id: "u-mail", org_id: "org-a", reason: null })
      expect(await resolve(db, SUB_UNLINKED, "dup@example.test")).toEqual({ user_id: null, org_id: null, reason: "ambiguous" })
      expect(await resolve(db, SUB_UNLINKED, "old.mail@example.test")).toEqual({ user_id: null, org_id: null, reason: "deactivated" })
      expect(await resolve(db, SUB_UNLINKED, "nobody@example.test")).toEqual({ user_id: null, org_id: null, reason: "not_linked" })
      // an explicit link is never overridden by an email: the deactivated sub stays deactivated even with org A's active email
      expect(await resolve(db, SUB_DEACT, "person.a@example.test")).toEqual({ user_id: null, org_id: null, reason: "deactivated" })
      expect(await boq(db, SUB_UNLINKED, "dup@example.test", "proj-a")).toEqual({ status: "ambiguous" })
    } finally {
      await db.exec("update platform.projexa_gateway_settings set email_fallback = false")
    }
  })

  test("org A's user reads org A's project: org A's lines only, in byte order, never qty_project or rate_project", async () => {
    const r = await boq(db, SUB_A, null, "proj-a")
    expect(r.status).toBe("ok")
    expect(r.rows!.map((x) => x.id)).toEqual(["LA-01", "la-02", "la-03", "la-04", "la-05"])
    expect(r.nextAfter).toBeNull()
    expect(JSON.stringify(r)).not.toContain("ORG-B-SECRET")
    const line2 = r.rows!.find((x) => x.id === "la-02")!
    expect(line2).toMatchObject({ boqId: "boq-a2", boqVersion: 2, boqStatus: "draft", quantity: "2.5", rate: "4.125", amount: "10.3125", qtyContract: "2", rateContract: "4" })
    for (const row of r.rows!) {
      expect(Object.keys(row)).not.toContain("qtyProject")
      expect(Object.keys(row)).not.toContain("rateProject")
      expect(Object.keys(row)).not.toContain("orgId")
    }
  })

  test("org B's project, a missing project, and org A's project asked by org B all answer not_found; unlinked answers not_linked", async () => {
    expect(await boq(db, SUB_A, null, "proj-b")).toEqual({ status: "not_found" })
    expect(await boq(db, SUB_A, null, "proj-missing")).toEqual({ status: "not_found" })
    expect(await boq(db, SUB_B, null, "proj-a")).toEqual({ status: "not_found" })
    expect(await boq(db, SUB_UNLINKED, null, "proj-a")).toEqual({ status: "not_linked" })
    expect(await boq(db, SUB_DEACT, null, "proj-a")).toEqual({ status: "deactivated" })
    const b = await boq(db, SUB_B, null, "proj-b")
    expect(b.rows!.map((x) => x.id)).toEqual(["lb-01", "lb-02"])
  })

  test("keyset paging: pages of 2 walk every line once, nextAfter is null on the last page and when a page is exactly full", async () => {
    const seen: string[] = []
    let after: string | null = null
    const nexts: Array<string | null> = []
    for (let i = 0; i < 5; i++) {
      const page: BoqResult = await boq(db, SUB_A, null, "proj-a", after, 2)
      seen.push(...page.rows!.map((x) => String(x.id)))
      nexts.push(page.nextAfter ?? null)
      if (!page.nextAfter) break
      after = page.nextAfter
    }
    expect(seen).toEqual(["LA-01", "la-02", "la-03", "la-04", "la-05"])
    expect(nexts).toEqual(["la-02", "la-04", null])
    expect((await boq(db, SUB_A, null, "proj-a", null, 5)).nextAfter).toBeNull()
    expect((await boq(db, SUB_A, null, "proj-a", "la-05", 5)).rows).toEqual([])
  })

  test("a limit outside 1..500 or an empty project id is refused by the wrapper itself", async () => {
    for (const [project, limit] of [["proj-a", 0], ["proj-a", 501], ["", 10]] as const) {
      await expect(db.query("select public.projexa_read_boq_lines($1, null, $2, null, $3)", [SUB_A, project, limit])).rejects.toThrow("p_limit")
    }
  })

  test("why RLS is not the second layer inside the wrapper: Postgres refuses SET ROLE inside a SECURITY DEFINER function", async () => {
    await db.exec(`create function public.t_try_role() returns text language plpgsql security definer set search_path = '' as $f$
      begin set local role app_runtime; return current_user; end $f$`)
    await expect(db.query("select public.t_try_role()")).rejects.toThrow('cannot set parameter "role" within security-definer function')
    await db.exec("drop function public.t_try_role()")
  })

  test("the tenant policies themselves isolate these tables for app_runtime (the property BR-320 checks live)", async () => {
    await db.exec("begin")
    try {
      await db.exec("set local role app_runtime")
      // with no org set, app_runtime may read compliance.users (policy app_runtime_preauth_read_users): the candidate org list
      const orgs = await db.query<{ org_id: string }>("select distinct org_id from compliance.users where org_id is not null order by 1")
      expect(orgs.rows.map((r) => r.org_id)).toEqual(["org-a", "org-b"])
      await db.query("select set_config('app.current_org_id', 'org-a', true)")
      const a = await one<{ own: number; other: number }>(db, `select count(*) filter (where b.org_id = 'org-a')::int own, count(*) filter (where b.org_id <> 'org-a')::int other
        from compliance.construction_boq_line_items l join compliance.construction_boqs b on b.id = l.boq_id`)
      expect(a).toEqual({ own: 6, other: 0 })
      await db.query("select set_config('app.current_org_id', 'org-b', true)")
      const b = await one<{ n: number }>(db, "select count(*)::int n from compliance.construction_boq_line_items where boq_id = 'boq-a1'")
      expect(b.n).toBe(0)
    } finally {
      await db.exec("rollback")
    }
  })

  test("the down file removes the three functions and the table, is safe to run twice, and the forward file applies again", async () => {
    await db.exec(DOWN)
    await db.exec(DOWN)
    const gone = await one(db, "select (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'projexa\\_read\\_%') fns, to_regclass('platform.projexa_gateway_settings') is null tbl_gone")
    expect(gone).toEqual({ fns: 0, tbl_gone: true })
    const kept = await one<{ n: number }>(db, "select count(*)::int n from compliance.construction_boq_line_items")
    expect(kept.n).toBe(9)
    await db.exec(FORWARD)
    expect(await one<Record<string, unknown>>(db, "select enabled, email_fallback from platform.projexa_gateway_settings")).toEqual({ enabled: false, email_fallback: false })
  })
})
