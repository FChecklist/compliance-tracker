/// <reference types="bun-types" />
// PROJEXA-BUILD-001 U-47b (register row BR-497; spec sections 9.2 W-B, 9.3, 9.5; audit A-20; harness AWL-H18): the Level-2 confirm route,
// POST F/drafts/{id}/confirm of the Edge Function ai-work-link, run as the REAL handler (handleAwl, confirm.ts, session.ts) over the REAL SQL
// (drizzle/0618 and 0621 to 0628 on PGlite, real Postgres as WASM): no Deno, no network, no live database.
//
// WHAT IS REAL: the handler, the token verifier with the real jose package and real ES256 key pairs (one per Auth project, served through
// jose's local key set in place of the published key sets), and the database functions ai_work_link_record_intent, ai_work_link_draft_confirm
// and projexa_read_resolve_user. WHAT IS FAKED: only the failure cases, by wrapping the same rpc so one function errors, throws or answers a
// shape nobody knows (the fail-closed proofs), and the clock of the per-person brake.
//
// WHAT IS PROVEN
//   401  no session, a link token, garbage, alg none / HS256, expired, wrong audience, a foreign issuer, another project's key, an
//        anonymous or non-authenticated token, a sub that is not a UUID: one answer, no WWW-Authenticate, and NO database call at all
//   403  another person's session (the draft stays awaiting_confirmation), a person who is not one active user of one organisation, the
//        other Auth project's person with the same shape of token
//   200  the draft's own person with the right token, from either Auth project: the row is confirmed, confirmed_by is the person, and the
//        answer names the state and nothing else
//   the token  hashed at rest (sha256, never the token), single use (a second and a parallel call), wrong token, unknown draft, expired
//        (the row reads expired afterwards), the writes switch off (503, nothing consumed, the same token works once it is on)
//   fail closed  an identity error, a confirm error, a throw and an unknown shape are 503 and nothing is reported as confirmed
//   the brake  the 11th call of one person in a minute is 429 with Retry-After and reaches no SQL; another person is unaffected
//   never returned  the confirm token, the session token, the draft's parameters (a money figure), any organisation, link or person id
//
// Run: bun test --isolate src/lib/services/ai-work-link-confirm.test.ts
import { describe, test, expect, beforeAll, afterAll, beforeEach, setDefaultTimeout } from "bun:test"
import type { PGlite } from "@electric-sql/pglite"
import * as jose from "jose"
import { configFromEnv } from "../../../supabase/functions/ai-work-link/config"
import { CONFIRM_LIMIT_PER_MINUTE, USER_NOT_LINKED_MESSAGE, resetConfirmLimits } from "../../../supabase/functions/ai-work-link/confirm"
import { handleAwl } from "../../../supabase/functions/ai-work-link/handler"
import {
  ACCEPTED_ALGORITHMS, CLOCK_TOLERANCE_SECONDS, JWKS_CACHE_MAX_AGE_MS, PROJEXA_AUDIENCE, PROJEXA_ISSUER, PROJEXA_JWKS_URL, VERIDIAN_ISSUER, VERIDIAN_JWKS_URL,
} from "../../../supabase/functions/ai-work-link/jwt"
import type { Rpc, RpcResult } from "../../../supabase/functions/ai-work-link/reads"
import { createSessionVerifier, type JoseLike, type KeyResolver } from "../../../supabase/functions/ai-work-link/session"
import * as projexaRead from "../../../supabase/functions/projexa-read/jwt"
import { createAwlDb, forwardSql, one, sha256Hex } from "./__test-helpers__/awl-pglite"

// PGlite tests run real Postgres as WASM: a loaded laptop or CI runner can pass bun's 5 s default for one test
setDefaultTimeout(60_000)

type J = Record<string, any>

const F = "https://pcrjmlpuqsbocqfwoxod.supabase.co/functions/v1/ai-work-link"
const config = configFromEnv(() => undefined)
const JOSE = jose as unknown as JoseLike

// the people: two of organisation A (a manager and a member), an admin of A, someone of organisation B, and an inactive person
const AUTH = {
  mgr: "11111111-1111-4111-8111-111111111111",
  mem: "22222222-2222-4222-8222-222222222222",
  adm: "33333333-3333-4333-8333-333333333333",
  b: "44444444-4444-4444-8444-444444444444",
  off: "66666666-6666-4666-8666-666666666666",
  nobody: "77777777-7777-4777-8777-777777777777",
}

const FIXTURE_SQL = `
insert into compliance.users (id, name, email, password_hash, role, is_active, org_id, auth_user_id) values
  ('u-mgr', 'Mira Manager', 'mira@a.example.test', 'x', 'manager', true, 'org-a', '${AUTH.mgr}'),
  ('u-mem', 'Mo Member',    'mo@a.example.test',   'x', 'member',  true, 'org-a', '${AUTH.mem}'),
  ('u-adm', 'Ada Admin',    'ada@a.example.test',  'x', 'admin',   true, 'org-a', '${AUTH.adm}'),
  ('u-off', 'Off Member',   'off@a.example.test',  'x', 'member',  false, 'org-a', '${AUTH.off}'),
  ('u-b',   'Bo Manager',   'bo@b.example.test',   'x', 'manager', true, 'org-b', '${AUTH.b}');
insert into compliance.projects (id, product_id, org_id, name, lead_user_id, access_level) values
  ('proj-a', 'prod', 'org-a', 'Villa A', 'u-mgr', 'public'),
  ('proj-b', 'prod', 'org-b', 'Tower B', 'u-b', 'public');
`

let db: PGlite
let sqlCalls: string[] = []
let bodies: string[] = []
let logs: string[] = []

/** The same call the service-role client makes: a public function with named arguments. */
const realRpc: Rpc = async (fn, args = {}) => {
  sqlCalls.push(fn)
  const names = Object.keys(args)
  const call = `public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(", ")})`
  try {
    if (fn === "projexa_read_resolve_user") {
      const r = await db.query(`select * from ${call}`, names.map((n) => args[n]))
      return { data: r.rows, error: null }
    }
    const r = await db.query<{ r: unknown }>(`select ${call} as r`, names.map((n) => args[n]))
    return { data: r.rows[0]?.r ?? null, error: null }
  } catch (e) {
    const err = e as { message?: string; code?: string }
    return { data: null, error: { message: String(err.message ?? e), code: err.code } }
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------- keys
type Pair = { privateKey: CryptoKey; publicKey: CryptoKey }
const KID = "test-key"
let projexaKeys: Pair
let veridianKeys: Pair
let strangerKeys: Pair
let keysByIssuer: Record<string, KeyResolver>

async function localSet(pair: Pair): Promise<KeyResolver> {
  const jwk = await jose.exportJWK(pair.publicKey)
  return jose.createLocalJWKSet({ keys: [{ ...jwk, kid: KID, alg: "ES256", use: "sig" }] }) as unknown as KeyResolver
}
const newPair = async () => (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as Pair

type SignOpts = { sub?: string; iss?: string; aud?: string; exp?: string | number; key?: CryptoKey; claims?: Record<string, unknown>; email?: string | null }
async function sign(o: SignOpts = {}): Promise<string> {
  const jwt = new jose.SignJWT({ role: "authenticated", ...(o.email === null ? {} : { email: o.email ?? "person@example.test" }), ...(o.claims ?? {}) })
    .setProtectedHeader({ alg: "ES256", kid: KID })
    .setIssuer(o.iss ?? PROJEXA_ISSUER)
    .setAudience(o.aud ?? "authenticated")
    .setSubject(o.sub ?? AUTH.mgr)
    .setIssuedAt()
    .setExpirationTime(o.exp ?? "1h")
  return jwt.sign(o.key ?? projexaKeys.privateKey)
}
const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url")

// ---------------------------------------------------------------------------------------------------------------------------------- run
let clock = 1_800_000_000_000
type Over = Partial<Record<string, (args: Record<string, unknown>) => Promise<RpcResult>>>

function makeRpc(over: Over): Rpc {
  return async (fn, args = {}) => {
    const o = over[fn]
    if (o) {
      sqlCalls.push(fn)
      return o(args)
    }
    return realRpc(fn, args)
  }
}

async function confirm(draftId: string, opts: { token?: string | null; body?: unknown; rawBody?: string; over?: Over; headers?: Record<string, string> } = {}): Promise<{ res: Response; json: J; text: string }> {
  const headers: Record<string, string> = { "content-type": "application/json", ...(opts.headers ?? {}) }
  if (opts.token) headers.authorization = `Bearer ${opts.token}`
  const rawBody = opts.rawBody ?? JSON.stringify(opts.body ?? {})
  const res = await handleAwl(new Request(`${F}/drafts/${draftId}/confirm`, { method: "POST", headers, body: rawBody }), {
    config,
    rpc: makeRpc(opts.over ?? {}),
    session: createSessionVerifier({ jose: JOSE, keys: keysByIssuer }),
    log: (line) => logs.push(line),
    now: () => clock,
  })
  const text = await res.text()
  bodies.push(text)
  let json: J = {}
  try {
    json = JSON.parse(text)
  } catch {
    // not JSON
  }
  return { res, json, text }
}

// ---------------------------------------------------------------------------------------------------------------------------------- data
const setWrites = (on: boolean) => db.exec(`update platform.ai_work_link_settings set writes_enabled = ${on}`)
const MONEY_PARAMS = { name: "Ravi", dailyRate: 48123 }

async function mint(userId: string, projectId: string): Promise<J> {
  return (await one<{ r: J }>(db, "select public.ai_work_link_create_for($1, $2, $3, $4::text[], $5, $6, $7) r", [userId, projectId, 1, null, 7, true, null])).r
}
let draftN = 0
/** A draft of the person's own link: its id and the one-time confirm token (only the SQL function ever returns it). */
async function draftFor(userId = "u-mgr", projectId = "proj-a", params: unknown = MONEY_PARAMS, fn = "add_roster_entry"): Promise<{ id: string; token: string; linkToken: string }> {
  const link = await mint(userId, projectId)
  const d = (await one<{ r: J }>(db, "select public.ai_work_link_record_intent($1, 'draft', $2, $3::jsonb, $4) r", [link.token, fn, JSON.stringify(params), `k-${++draftN}`])).r
  return { id: d.intent_id, token: d.confirm_token, linkToken: link.token }
}
const rowOf = (id: string) => one<J>(db, "select status, confirmed_at, confirmed_by, confirm_token_hash, expires_at from platform.ai_work_link_intent where id = $1", [id])

beforeAll(async () => {
  db = await createAwlDb("0628")
  await db.exec(forwardSql("0618_build001_projexa_gateway"))
  await db.exec(FIXTURE_SQL)
  projexaKeys = await newPair()
  veridianKeys = await newPair()
  strangerKeys = await newPair()
  keysByIssuer = { [PROJEXA_ISSUER]: await localSet(projexaKeys), [VERIDIAN_ISSUER]: await localSet(veridianKeys) }
}, 120_000)
afterAll(async () => {
  await db.close()
})
beforeEach(async () => {
  sqlCalls = []
  logs = []
  resetConfirmLimits()
  clock += 10 * 60_000
  await setWrites(true)
})

// ---------------------------------------------------------------------------------------------------------------------------------- 401
describe("401: no valid session, and nothing is read or written", () => {
  test("no Authorization header: 401, no WWW-Authenticate, and not one database call", async () => {
    const d = await draftFor()
    sqlCalls = []
    const r = await confirm(d.id, { body: { confirmToken: d.token } })
    expect(r.res.status).toBe(401)
    expect(r.res.headers.get("www-authenticate")).toBeNull()
    expect(r.json).toMatchObject({ status: 401, code: "SESSION_REQUIRED" })
    expect(sqlCalls).toEqual([])
    expect((await rowOf(d.id)).status).toBe("awaiting_confirmation")
  })

  test("a link token in the Authorization header is not a session", async () => {
    const d = await draftFor()
    sqlCalls = []
    const r = await confirm(d.id, { token: d.linkToken, body: { confirmToken: d.token } })
    expect(r.res.status).toBe(401)
    expect(r.json.code).toBe("SESSION_REQUIRED")
    expect(sqlCalls).toEqual([])
  })

  test("a malformed or forged token is 401 with one code, the database is never called, and the draft stays put", async () => {
    const d = await draftFor()
    const good = await sign()
    const [h, p, s] = good.split(".")
    const payload = { iss: PROJEXA_ISSUER, aud: "authenticated", sub: AUTH.mgr, role: "authenticated", exp: Math.floor(Date.now() / 1000) + 600 }
    const hs = await new jose.SignJWT(payload).setProtectedHeader({ alg: "HS256", kid: KID }).sign(new TextEncoder().encode("s".repeat(48)))
    const cases: Record<string, string> = {
      "not a JWT": "garbage",
      "two parts": `${h}.${p}`,
      "empty parts": "..",
      "non-base64 characters": "a!b.c.d",
      "alg none": `${b64url({ alg: "none", typ: "JWT" })}.${b64url(payload)}.`,
      "alg none with a signature": `${b64url({ alg: "none", typ: "JWT", kid: KID })}.${b64url(payload)}.AAAA`,
      HS256: hs,
      "expired": await sign({ exp: Math.floor(Date.now() / 1000) - 120 }),
      "wrong audience": await sign({ aud: "anon" }),
      "a foreign issuer": await sign({ iss: "https://evil.example/auth/v1" }),
      "signed by another key": await sign({ key: strangerKeys.privateKey }),
      "verdian-ai issuer signed with PROJEXA's key": await sign({ iss: VERIDIAN_ISSUER }),
      "PROJEXA issuer signed with verdian-ai's key": await sign({ key: veridianKeys.privateKey }),
      "payload altered after signing": `${h}.${b64url({ ...payload, sub: AUTH.adm })}.${s}`,
      "an anonymous sign-in": await sign({ claims: { is_anonymous: true } }),
      "role service_role": await sign({ claims: { role: "service_role" } }),
      "a sub that is not a UUID": await sign({ sub: "u-mgr" }),
      "no exp": await new jose.SignJWT({ role: "authenticated" }).setProtectedHeader({ alg: "ES256", kid: KID }).setIssuer(PROJEXA_ISSUER).setAudience("authenticated").setSubject(AUTH.mgr).sign(projexaKeys.privateKey),
      "8,200 characters": "a".repeat(8200),
    }
    for (const [name, token] of Object.entries(cases)) {
      sqlCalls = []
      const r = await confirm(d.id, { token, body: { confirmToken: d.token } })
      expect(`${name}: ${r.res.status} ${r.json.code}`).toBe(`${name}: 401 SESSION_INVALID`)
      expect(r.res.headers.get("www-authenticate")).toBeNull()
      expect(`${name}: ${sqlCalls.join(",")}`).toBe(`${name}: `)
      expect(r.text).not.toContain(token)
    }
    expect((await rowOf(d.id)).status).toBe("awaiting_confirmation")
  })

  test("a key set that cannot be read is 503, not a 401 that blames the person's session", async () => {
    const d = await draftFor()
    const broken: Record<string, KeyResolver> = { ...keysByIssuer, [PROJEXA_ISSUER]: async () => { throw Object.assign(new Error("timeout"), { code: "ERR_JWKS_TIMEOUT" }) } }
    const res = await handleAwl(new Request(`${F}/drafts/${d.id}/confirm`, { method: "POST", headers: { authorization: `Bearer ${await sign()}` }, body: JSON.stringify({ confirmToken: d.token }) }), {
      config, rpc: realRpc, session: createSessionVerifier({ jose: JOSE, keys: broken }), log: (l) => logs.push(l), now: () => clock,
    })
    expect(res.status).toBe(503)
    expect((await res.json()).code).toBe("SESSION_CHECK_UNAVAILABLE")
    expect((await rowOf(d.id)).status).toBe("awaiting_confirmation")
  })
})

// ---------------------------------------------------------------------------------------------------------------------------------- 403
describe("403: not the draft's person", () => {
  test("another person's valid session is 403 NOT_YOUR_DRAFT, and the draft is untouched (a colleague, an admin of the same organisation)", async () => {
    const d = await draftFor("u-mgr")
    for (const sub of [AUTH.mem, AUTH.adm]) {
      const r = await confirm(d.id, { token: await sign({ sub }), body: { confirmToken: d.token } })
      expect(`${sub} ${r.res.status} ${r.json.code}`).toBe(`${sub} 403 NOT_YOUR_DRAFT`)
    }
    const row = await rowOf(d.id)
    expect(row).toMatchObject({ status: "awaiting_confirmation", confirmed_at: null, confirmed_by: null })
    // and the owner can still confirm afterwards: the refusals consumed nothing
    expect((await confirm(d.id, { token: await sign({ sub: AUTH.mgr }), body: { confirmToken: d.token } })).res.status).toBe(200)
  })

  test("a person of another organisation, and the same person with verdian-ai's own sign-in, are 403 too", async () => {
    const d = await draftFor("u-mgr")
    const other = await confirm(d.id, { token: await sign({ sub: AUTH.b }), body: { confirmToken: d.token } })
    expect(other.res.status).toBe(403)
    expect(other.json.code).toBe("NOT_YOUR_DRAFT")
    const viaVeridian = await confirm(d.id, { token: await sign({ sub: AUTH.mem, iss: VERIDIAN_ISSUER, key: veridianKeys.privateKey }), body: { confirmToken: d.token } })
    expect(viaVeridian.res.status).toBe(403)
    expect((await rowOf(d.id)).status).toBe("awaiting_confirmation")
  })

  test("a valid session of someone who is not one active user of one organisation is 403 USER_NOT_LINKED, and the confirm function is never called", async () => {
    const d = await draftFor("u-mgr")
    for (const sub of [AUTH.nobody, AUTH.off]) {
      sqlCalls = []
      const r = await confirm(d.id, { token: await sign({ sub }), body: { confirmToken: d.token } })
      expect(`${r.res.status} ${r.json.code}`).toBe("403 USER_NOT_LINKED")
      expect(r.json.error).toBe(USER_NOT_LINKED_MESSAGE)
      expect(sqlCalls).toEqual(["projexa_read_resolve_user"])
    }
    expect((await rowOf(d.id)).status).toBe("awaiting_confirmation")
  })
})

// ---------------------------------------------------------------------------------------------------------------------------------- 200
describe("200: the draft's own person with the right token", () => {
  test("the draft becomes confirmed through the SQL function, by that person, and the answer names the state and nothing else", async () => {
    const d = await draftFor("u-mgr")
    const r = await confirm(d.id, { token: await sign({ sub: AUTH.mgr }), body: { confirmToken: d.token } })
    expect(r.res.status).toBe(200)
    expect(r.json).toEqual({ draft_id: d.id, status: "confirmed", function_id: "add_roster_entry", message: "Confirmed. The change is queued for the executor." })
    expect(sqlCalls).toEqual(["projexa_read_resolve_user", "ai_work_link_draft_confirm"])
    const row = await rowOf(d.id)
    expect(row).toMatchObject({ status: "confirmed", confirmed_by: "u-mgr" })
    expect(row.confirmed_at).not.toBeNull()
  })

  test("a verdian-ai sign-in works the same (same person, the other Auth project's key set)", async () => {
    const d = await draftFor("u-mem", "proj-a", { name: "x", dailyRate: 1 })
    const r = await confirm(d.id, { token: await sign({ sub: AUTH.mem, iss: VERIDIAN_ISSUER, key: veridianKeys.privateKey }), body: { confirmToken: d.token } })
    expect(r.res.status).toBe(200)
    expect((await rowOf(d.id)).confirmed_by).toBe("u-mem")
  })

  test("the answer carries no money figure, no parameters, no ids of an organisation, link or person, and neither token", async () => {
    const d = await draftFor("u-mgr", "proj-a", { name: "Ravi", dailyRate: 48123, amount: 999777, rate: 5551 })
    const session = await sign({ sub: AUTH.mgr })
    const r = await confirm(d.id, { token: session, body: { confirmToken: d.token } })
    expect(r.res.status).toBe(200)
    expect(Object.keys(r.json).sort()).toEqual(["draft_id", "function_id", "message", "status"])
    for (const leak of [d.token, session, d.linkToken, "48123", "999777", "5551", "dailyRate", "amount", "org-a", "u-mgr", "proj-a", "params"]) expect(r.text).not.toContain(leak)
  })
})

// ---------------------------------------------------------------------------------------------------------------------------------- token
describe("the confirm token: hashed at rest, single use, tied to the draft, expiring", () => {
  test("only the sha256 of the token is stored, and the token is not in the row", async () => {
    const d = await draftFor()
    const row = await rowOf(d.id)
    expect(d.token).toMatch(/^[0-9a-f]{64}$/)
    expect(row.confirm_token_hash).toBe(sha256Hex(d.token))
    expect(JSON.stringify(row)).not.toContain(d.token)
    const whole = await one<{ t: string }>(db, "select i::text t from platform.ai_work_link_intent i where id = $1", [d.id])
    expect(whole.t).not.toContain(d.token)
  })

  test("single use: the same token again is 409 CONFIRM_ALREADY_USED and the row does not change", async () => {
    const d = await draftFor()
    const session = await sign()
    const first = await confirm(d.id, { token: session, body: { confirmToken: d.token } })
    expect(first.res.status).toBe(200)
    const before = await rowOf(d.id)
    for (let i = 0; i < 2; i++) {
      const again = await confirm(d.id, { token: session, body: { confirmToken: d.token } })
      expect(again.res.status).toBe(409)
      expect(again.json.code).toBe("CONFIRM_ALREADY_USED")
    }
    expect(await rowOf(d.id)).toEqual(before)
  })

  test("two confirmations at the same moment: exactly one wins", async () => {
    const d = await draftFor()
    const session = await sign()
    const both = await Promise.all([confirm(d.id, { token: session, body: { confirmToken: d.token } }), confirm(d.id, { token: session, body: { confirmToken: d.token } })])
    expect(both.map((b) => b.res.status).sort()).toEqual([200, 409])
    expect(both.find((b) => b.res.status === 409)?.json.code).toBe("CONFIRM_ALREADY_USED")
  })

  test("a wrong token, another draft's token and an unknown draft are all 409 CONFIRM_TOKEN_INVALID with the same body, and nothing is consumed", async () => {
    const d = await draftFor()
    const other = await draftFor()
    const session = await sign()
    const wrong = await confirm(d.id, { token: session, body: { confirmToken: "0".repeat(64) } })
    const crossed = await confirm(d.id, { token: session, body: { confirmToken: other.token } })
    const unknown = await confirm("no-such-draft-0000", { token: session, body: { confirmToken: d.token } })
    for (const r of [wrong, crossed, unknown]) {
      expect(r.res.status).toBe(409)
      expect(r.json.code).toBe("CONFIRM_TOKEN_INVALID")
    }
    expect(wrong.text).toBe(unknown.text)
    expect((await rowOf(d.id)).status).toBe("awaiting_confirmation")
    expect((await rowOf(other.id)).status).toBe("awaiting_confirmation")
    expect((await confirm(d.id, { token: session, body: { confirmToken: d.token } })).res.status).toBe(200)
  })

  test("an expired draft is 410 CONFIRM_EXPIRED, the row then reads expired, and the token cannot be revived", async () => {
    const d = await draftFor()
    await db.query("update platform.ai_work_link_intent set expires_at = now() - interval '1 minute' where id = $1", [d.id])
    const session = await sign()
    const r = await confirm(d.id, { token: session, body: { confirmToken: d.token } })
    expect(r.res.status).toBe(410)
    expect(r.json.code).toBe("CONFIRM_EXPIRED")
    expect((await rowOf(d.id)).status).toBe("expired")
    const again = await confirm(d.id, { token: session, body: { confirmToken: d.token } })
    expect(again.res.status).toBe(409)
    expect(again.json.code).toBe("CONFIRM_ALREADY_USED")
  })

  test("the 48-hour window: a draft that has 1 minute left still confirms", async () => {
    const d = await draftFor()
    await db.query("update platform.ai_work_link_intent set expires_at = now() + interval '1 minute' where id = $1", [d.id])
    expect((await confirm(d.id, { token: await sign(), body: { confirmToken: d.token } })).res.status).toBe(200)
  })

  test("writes switched off: 503 WRITES_NOT_ENABLED, the draft waits, and the same token works once they are on", async () => {
    const d = await draftFor()
    await setWrites(false)
    const session = await sign()
    const off = await confirm(d.id, { token: session, body: { confirmToken: d.token } })
    expect(off.res.status).toBe(503)
    expect(off.json.code).toBe("WRITES_NOT_ENABLED")
    expect(await rowOf(d.id)).toMatchObject({ status: "awaiting_confirmation", confirmed_at: null })
    await setWrites(true)
    expect((await confirm(d.id, { token: session, body: { confirmToken: d.token } })).res.status).toBe(200)
  })
})

// ---------------------------------------------------------------------------------------------------------------------------------- request
describe("the request", () => {
  test("a missing, empty, non-string or over-long confirmToken, a body that is not JSON, and a JSON array are 400 after the session check", async () => {
    const d = await draftFor()
    const session = await sign()
    const bodies400: Array<unknown> = [{}, { confirmToken: "" }, { confirmToken: 12 }, { confirmToken: null }, { confirmToken: "a".repeat(201) }, [d.token]]
    for (const body of bodies400) {
      const r = await confirm(d.id, { token: session, body })
      expect(`${JSON.stringify(body).slice(0, 30)} ${r.res.status} ${r.json.code}`).toBe(`${JSON.stringify(body).slice(0, 30)} 400 CONFIRM_TOKEN_REQUIRED`)
    }
    for (const rawBody of ["", "not json", "{"]) expect((await confirm(d.id, { token: session, rawBody })).res.status).toBe(400)
    expect((await confirm(d.id, { token: session, rawBody: JSON.stringify({ confirmToken: "x".repeat(9000) }) })).res.status).toBe(413)
    expect((await rowOf(d.id)).status).toBe("awaiting_confirmation")
  })

  test("a draft id that is not an id is 404, a wrong method is 405, and an unknown app path is 404", async () => {
    const session = await sign()
    expect((await confirm("bad id!", { token: session, body: { confirmToken: "x" } })).res.status).toBe(404)
    expect((await confirm("a".repeat(129), { token: session, body: { confirmToken: "x" } })).res.status).toBe(404)
    const get = await handleAwl(new Request(`${F}/drafts/abc/confirm`, { method: "GET", headers: { authorization: `Bearer ${session}` } }), { config, rpc: realRpc, session: createSessionVerifier({ jose: JOSE, keys: keysByIssuer }) })
    expect(get.status).toBe(405)
    expect(get.headers.get("allow")).toBe("POST")
  })

  test("without the session verifier wired, the route keeps its U-46b1 answers: 401 with none, 501 with one, and no database call", async () => {
    const calls: string[] = []
    const rpc: Rpc = async (fn) => {
      calls.push(fn)
      return { data: null, error: null }
    }
    const none = await handleAwl(new Request(`${F}/drafts/abc/confirm`, { method: "POST", body: "{}" }), { config, rpc })
    const some = await handleAwl(new Request(`${F}/drafts/abc/confirm`, { method: "POST", headers: { authorization: "Bearer eyJhbGciOiJFUzI1NiJ9.e30.sig" }, body: "{}" }), { config, rpc })
    expect([none.status, some.status]).toEqual([401, 501])
    expect(calls).toEqual([])
  })

  test("every answer carries the private headers, and a 401 has no WWW-Authenticate", async () => {
    const d = await draftFor()
    for (const r of [await confirm(d.id, { body: {} }), await confirm(d.id, { token: await sign(), body: {} }), await confirm(d.id, { token: await sign(), body: { confirmToken: d.token } })]) {
      expect(r.res.headers.get("cache-control")).toBe("no-store")
      expect(r.res.headers.get("referrer-policy")).toBe("no-referrer")
      expect(r.res.headers.get("x-content-type-options")).toBe("nosniff")
      expect(r.res.headers.get("www-authenticate")).toBeNull()
    }
  })
})

// ---------------------------------------------------------------------------------------------------------------------------------- brake
describe("the per-person brake, and failing closed", () => {
  test(`the ${CONFIRM_LIMIT_PER_MINUTE + 1}th call of one person inside a minute is 429 with Retry-After and reaches no SQL; another person is unaffected; a minute later it serves again`, async () => {
    const d = await draftFor()
    const session = await sign({ sub: AUTH.mgr })
    for (let i = 0; i < CONFIRM_LIMIT_PER_MINUTE; i++) {
      const r = await confirm(d.id, { token: session, body: { confirmToken: "0".repeat(64) } })
      expect(r.res.status).toBe(409)
      clock += 1000
    }
    sqlCalls = []
    const over = await confirm(d.id, { token: session, body: { confirmToken: d.token } })
    expect(over.res.status).toBe(429)
    expect(over.json.code).toBe("RATE_LIMITED")
    expect(over.res.headers.get("retry-after")).toBe("60")
    expect(sqlCalls).toEqual([])
    expect((await rowOf(d.id)).status).toBe("awaiting_confirmation")
    // someone else is not held back by this person's calls
    expect((await confirm(d.id, { token: await sign({ sub: AUTH.mem }), body: { confirmToken: d.token } })).res.status).toBe(403)
    // a minute after the first call of the window, the person is served again
    clock += 61_000
    expect((await confirm(d.id, { token: session, body: { confirmToken: d.token } })).res.status).toBe(200)
  })

  test("an error, a throw or an unknown shape from the identity lookup is 503 and the confirm function is not called", async () => {
    const d = await draftFor()
    const cases: Array<[string, Over]> = [
      ["error", { projexa_read_resolve_user: async () => ({ data: null, error: { message: "boom", code: "XX000" } }) }],
      ["throw", { projexa_read_resolve_user: async () => { throw new Error("connection reset") } }],
      ["no rows", { projexa_read_resolve_user: async () => ({ data: [], error: null }) }],
      ["a row with no user", { projexa_read_resolve_user: async () => ({ data: [{ user_id: null, org_id: "org-a", reason: null }], error: null }) }],
    ]
    for (const [name, over] of cases) {
      sqlCalls = []
      const r = await confirm(d.id, { token: await sign(), body: { confirmToken: d.token }, over })
      expect(`${name}: ${r.res.status} ${r.json.code}`).toBe(`${name}: 503 CONFIRM_UNAVAILABLE`)
      expect(sqlCalls).not.toContain("ai_work_link_draft_confirm")
    }
    expect((await rowOf(d.id)).status).toBe("awaiting_confirmation")
  })

  test("an error, a throw or an unknown shape from the confirm function is 503, never a success, and the log holds no secret", async () => {
    const d = await draftFor()
    const session = await sign()
    const cases: Array<[string, Over]> = [
      ["error", { ai_work_link_draft_confirm: async () => ({ data: null, error: { message: "boom", code: "XX000" } }) }],
      ["throw", { ai_work_link_draft_confirm: async () => { throw new Error("connection reset") } }],
      ["null", { ai_work_link_draft_confirm: async () => ({ data: null, error: null }) }],
      ["unknown status", { ai_work_link_draft_confirm: async () => ({ data: { status: "maybe" }, error: null }) }],
      ["unknown refusal", { ai_work_link_draft_confirm: async () => ({ data: { status: "refused", reason: "cosmic_rays" }, error: null }) }],
      ["an array", { ai_work_link_draft_confirm: async () => ({ data: [{ status: "confirmed" }], error: null }) }],
    ]
    for (const [name, over] of cases) {
      const r = await confirm(d.id, { token: session, body: { confirmToken: d.token }, over })
      expect(`${name}: ${r.res.status} ${r.json.code}`).toBe(`${name}: 503 CONFIRM_UNAVAILABLE`)
      expect(r.json.status).toBe(503)
    }
    expect((await rowOf(d.id)).status).toBe("awaiting_confirmation")
    expect(logs.length).toBeGreaterThan(0)
    for (const line of logs) for (const secret of [d.token, session, d.linkToken]) expect(line).not.toContain(secret)
  })

  test("a database error text is never echoed to the caller", async () => {
    const d = await draftFor()
    const r = await confirm(d.id, { token: await sign(), body: { confirmToken: d.token }, over: { ai_work_link_draft_confirm: async () => ({ data: null, error: { message: "relation platform.secret_table does not exist", code: "42P01" } }) } })
    expect(r.res.status).toBe(503)
    expect(r.text).not.toContain("secret_table")
  })
})

// ---------------------------------------------------------------------------------------------------------------------------------- settings
describe("the settings match projexa-read, and nothing the route ever said held a secret", () => {
  test("jwt.ts holds the same PROJEXA issuer, key set, audience, algorithm, cache age and clock tolerance as projexa-read/jwt.ts", () => {
    expect(PROJEXA_ISSUER).toBe(projexaRead.PROJEXA_ISSUER)
    expect(PROJEXA_JWKS_URL).toBe(projexaRead.PROJEXA_JWKS_URL)
    expect(PROJEXA_AUDIENCE).toBe(projexaRead.PROJEXA_AUDIENCE)
    expect([...ACCEPTED_ALGORITHMS]).toEqual([...projexaRead.ACCEPTED_ALGORITHMS])
    expect(JWKS_CACHE_MAX_AGE_MS).toBe(projexaRead.JWKS_CACHE_MAX_AGE_MS)
    expect(CLOCK_TOLERANCE_SECONDS).toBe(projexaRead.CLOCK_TOLERANCE_SECONDS)
    expect(VERIDIAN_ISSUER).toBe("https://pcrjmlpuqsbocqfwoxod.supabase.co/auth/v1")
    expect(VERIDIAN_JWKS_URL).toBe(`${VERIDIAN_ISSUER}/.well-known/jwks.json`)
    expect(USER_NOT_LINKED_MESSAGE).toBe("Your PROJEXA account is not linked to a VERIDIAN user - ask your admin")
  })

  test("across the whole file, no answer body carried a 64-character hex token, a JWT, or a money key", () => {
    expect(bodies.length).toBeGreaterThan(40)
    for (const b of bodies) {
      expect(b).not.toMatch(/[0-9a-f]{64}/)
      expect(b).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}\./)
      expect(b).not.toMatch(/dailyRate|"amount"|"rate"|password/i)
    }
  })
})
