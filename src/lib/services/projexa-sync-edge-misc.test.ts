// projexa-sync Edge handler, everything but CORS and push, with injected fakes (no database). Review D1 findings: F-09 (426 direction), F5 (pull by
// 200 real ids), F-10 (byte limits before buffering, per-route caps), tests-quality:F09 (untested error branches), F-01 (register cooldown), F7
// (release memory, light /release/current), F-14a (top-level catch), F13 (no silently unsigned page), F-11 (key caches), TI-2 / F-12 (holder-bound
// attestation, view-bound row signatures), F15 (a channel per view class).
import { describe, expect, test } from "bun:test"
import {
  BODY_MAX_BYTES,
  createKeyCaches,
  handleSync,
  KEY_TTL_MS,
  PULL_IDS_MAX,
  RateLimiter,
  RELEASE_ORIGIN,
  releaseOriginOf,
  RELEASE_TTL_MS,
  type PublicKeyInfo,
  type Rpc,
  type SyncDeps,
} from "../../../supabase/functions/projexa-sync/handler"
import {
  b64url,
  canonicalize,
  createSigning,
  fromB64url,
  generateKeyRecord,
  holderProofMessage,
  importPublic,
  itemMessageV3,
  jwkThumbprint,
  sha256Hex,
  verifyHolderProof,
  verifyMessage,
  type KeyRecord,
  type Signing,
} from "../../../supabase/functions/projexa-sync/sign"
import type { SessionVerifier } from "../../../supabase/functions/ai-work-link/session"

type J = Record<string, unknown>
const BASE = "https://x.supabase.co/functions/v1/projexa-sync"
const T0 = new Date("2026-10-02T00:00:00Z")
const session: SessionVerifier = async (t) =>
  t === "down" ? { ok: false, reason: "unavailable" } : t.startsWith("tok:") ? { ok: true, sub: t.slice(4), email: null, issuer: "test", iat: null } : { ok: false, reason: "invalid" }

/** A stand-in database: counts calls per function; `over` replaces any answer. */
function fakeDb(over: Record<string, (args: J) => Promise<{ data: unknown; error: { message: string; code?: string } | null }>> = {}) {
  const calls: Record<string, number> = {}
  const rpc: Rpc = async (fn, args = {}) => {
    calls[fn] = (calls[fn] ?? 0) + 1
    if (over[fn]) return over[fn](args)
    if (fn === "projexa_sync_manifest") return { data: { status: "ok", user: { id: "u1", org_id: "org-a" }, projects: [{ id: "proj-a" }], kinds: [], view_class: "vc-member", org_view_class: "ovc-member" }, error: null }
    if (fn === "projexa_release_current") return { data: { registered: true, current: { release_version: "2026.10.02-002", files: [{ path: "a.js" }] }, min_compatible: "2026.10.02-002" }, error: null }
    if (fn === "projexa_sync_pull_ids" || fn === "projexa_sync_org_pull_ids") return { data: { status: "ok", items: (args.p_ids as string[]).map((id) => ({ id, updated_at: "2026-10-01T00:00:00Z", version: 1, data: { id, title: "x" } })), money_visible: true }, error: null }
    if (fn === "projexa_sync_pull") return { data: { status: "ok", items: [{ id: "t1", updated_at: "2026-10-01T00:00:00Z", version: 3, data: { id: "t1", title: "x" } }], money_visible: true }, error: null }
    if (fn === "projexa_sync_ids") return { data: { status: "ok", ids: [], has_more: false }, error: null }
    if (fn.startsWith("projexa_job_")) return { data: { status: "ok", job: null, outcome: "ok" }, error: null }
    return { data: null, error: { message: "no such function", code: "42883" } }
  }
  return { rpc, calls }
}

const deps = (rpc: Rpc, over: Partial<SyncDeps> = {}): SyncDeps => ({ rpc, session, limiter: new RateLimiter(100000), now: () => T0, log: () => {}, ...over })
const call = (d: SyncDeps, route: string, o: { method?: string; body?: BodyInit | null; token?: string | null; headers?: Record<string, string> } = {}) =>
  handleSync(
    new Request(`${BASE}/${route}`, {
      method: o.method ?? (o.body !== undefined ? "POST" : "GET"),
      body: o.body ?? undefined,
      headers: { ...(o.token === null ? {} : { authorization: `Bearer ${o.token ?? "tok:u1"}` }), origin: "https://projexa-ai.com", ...(o.headers ?? {}) },
      // @ts-expect-error bun/undici need this for a stream body
      duplex: "half",
    }),
    d,
  )
const cuid = (i: number, len = 24) => (`c${i.toString(36)}` + "x".repeat(len)).slice(0, len)

describe("the update gate points the right way (F-09)", () => {
  test("an OLDER protocol is 426; a NEWER protocol is a retryable 503 SERVER_UPDATING (never 426), and the laptop keeps its queue", async () => {
    const { rpc } = fakeDb()
    expect((await call(deps(rpc), "manifest", { headers: { "x-px-client": "2026.10.02-002; protocol=1; schema=3" } })).status).toBe(426)
    const newer = await call(deps(rpc), "manifest", { headers: { "x-px-client": "2026.10.09-001; protocol=3; schema=4" } })
    expect(newer.status).toBe(503)
    expect(newer.headers.get("retry-after")).toBe("300")
    expect(((await newer.json()) as J).code).toBe("SERVER_UPDATING")
    expect((await call(deps(rpc), "manifest", { headers: { "x-px-client": "2026.10.02-002; protocol=2; schema=3" } })).status).toBe(200)
    // the routes a laptop needs to update stay reachable either way
    expect((await call(deps(rpc), "release/current", { headers: { "x-px-client": "2026.10.09-001; protocol=3" } })).status).toBe(200)
  })
})

describe("pull by exact ids carries a real batch (F5)", () => {
  for (const len of [24, 64]) {
    test(`200 ids of ${len} characters: 200 for a project kind and an organisation kind; 300 ids: 400`, async () => {
      const { rpc, calls } = fakeDb()
      const ids = Array.from({ length: PULL_IDS_MAX }, (_, i) => cuid(i, len))
      const proj = await call(deps(rpc), "pull", { body: JSON.stringify({ project_id: "proj-a", kind: "tasks", ids }) })
      expect(proj.status).toBe(200)
      expect(((await proj.json()) as J).items as unknown[]).toHaveLength(PULL_IDS_MAX)
      const org = await call(deps(rpc), "pull", { body: JSON.stringify({ kind: "vendors", ids }) })
      expect(org.status).toBe(200)
      expect(calls.projexa_sync_org_pull_ids).toBe(1)
      const tooMany = await call(deps(rpc), "pull", { body: JSON.stringify({ project_id: "proj-a", kind: "tasks", ids: Array.from({ length: 300 }, (_, i) => cuid(i, 24)) }) })
      expect(tooMany.status).toBe(400)
    })
  }
})

describe("body limits in BYTES, before buffering (F-10, tests-quality:F09 item 4)", () => {
  test("a Content-Length over the cap is 413 without reading the body", async () => {
    const { rpc } = fakeDb()
    let pulled = 0
    const stream = new ReadableStream<Uint8Array>({ pull: (c) => void (pulled++, c.enqueue(new Uint8Array(1024))) })
    const r = await call(deps(rpc), "ids", { body: stream, headers: { "content-length": String(10_000_000) } })
    expect(r.status).toBe(413)
    expect(pulled).toBeLessThanOrEqual(1)
  })

  test("a streamed body with no Content-Length stops at the cap (it is never read whole)", async () => {
    const { rpc } = fakeDb()
    let pulled = 0
    const stream = new ReadableStream<Uint8Array>({ pull: (c) => void (pulled++, c.enqueue(new Uint8Array(1024))) })
    const r = await call(deps(rpc), "ids", { body: stream })
    expect(r.status).toBe(413)
    expect(pulled).toBeLessThan(20)
  })

  test("bytes, not characters: 1,500 Devanagari characters (4,500 bytes) is over /ids' 4 KB", async () => {
    const { rpc } = fakeDb()
    const body = JSON.stringify({ project_id: "proj-a", kind: "tasks", pad: "क".repeat(1500) })
    expect(body.length).toBeLessThan(BODY_MAX_BYTES)
    expect((await call(deps(rpc), "ids", { body })).status).toBe(413)
  })

  test("one 413 per limit: /ids and /pull keyset 4,097 B ok-or-413 by route, /push 262,145 B, jobs per action", async () => {
    const { rpc } = fakeDb()
    const pad = (n: number) => JSON.stringify({ pad: "x".repeat(n - 10) })
    expect((await call(deps(rpc), "ids", { body: pad(4097) })).status).toBe(413)
    expect((await call(deps(rpc), "pull", { body: pad(16_385) })).status).toBe(413)
    expect((await call(deps(rpc), "push", { body: pad(262_145) })).status).toBe(413)
    expect((await call(deps(rpc), "jobs/claim", { body: pad(3000) })).status).toBe(413)
    expect((await call(deps(rpc), "jobs/heartbeat", { body: pad(3000) })).status).toBe(413)
    expect((await call(deps(rpc), "jobs/enqueue", { body: pad(21_000) })).status).toBe(413)
    expect((await call(deps(rpc), "jobs/result", { body: pad(299_000) })).status).not.toBe(413)
    expect((await call(deps(rpc), "jobs/result", { body: pad(300_001) })).status).toBe(413)
  })
})

describe("error branches a laptop depends on (tests-quality:F09)", () => {
  test("session service down is 503 on manifest, pull and push, NEVER 401 (a 401 signs the person out)", async () => {
    const { rpc } = fakeDb()
    for (const route of ["manifest", "pull", "push"]) {
      const r = await call(deps(rpc), route, { token: "down", ...(route === "manifest" ? {} : { body: "{}" }) })
      expect(r.status).toBe(503)
      expect(JSON.stringify(await r.json()).toLowerCase()).not.toContain("sign in")
    }
  })

  test("an SQL error is a closed 500 (no relation name, no message); a thrown RPC is 503 with no address", async () => {
    const { rpc } = fakeDb({ projexa_sync_manifest: async () => ({ data: null, error: { message: "relation platform.secret does not exist", code: "42P01" } }) })
    const r = await call(deps(rpc), "manifest")
    expect(r.status).toBe(500)
    const text = await r.text()
    expect(text).not.toContain("relation")
    expect(text).not.toContain("secret")
    const { rpc: down } = fakeDb({
      projexa_sync_manifest: async () => {
        throw new Error("connect ECONNREFUSED 10.0.0.5:6543")
      },
    })
    const d = await call(deps(down), "manifest")
    expect(d.status).toBe(503)
    expect(await d.text()).not.toContain("10.0.0.5")
  })

  test("AW409 is 409; AW404 is the one 404", async () => {
    const { rpc } = fakeDb({ projexa_sync_ids: async () => ({ data: null, error: { message: "x", code: "AW409" } }), projexa_sync_pull: async () => ({ data: null, error: { message: "x", code: "AW404" } }) })
    expect((await call(deps(rpc), "ids", { body: JSON.stringify({ project_id: "proj-a", kind: "tasks" }) })).status).toBe(409)
    expect((await call(deps(rpc), "pull", { body: JSON.stringify({ project_id: "proj-a", kind: "tasks" }) })).status).toBe(404)
  })

  test("the org memory: two signed pulls sharing one isolate make ONE manifest call; after 61 s it is fetched again", async () => {
    const { rpc, calls } = fakeDb()
    const signing = await createSigning(await generateKeyRecord())
    let now = T0
    const d = deps(rpc, { signing: async () => signing, now: () => now, orgCache: new Map() })
    const body = JSON.stringify({ project_id: "proj-a", kind: "tasks" })
    expect((await call(d, "pull", { body })).status).toBe(200)
    expect((await call(d, "pull", { body })).status).toBe(200)
    expect(calls.projexa_sync_manifest).toBe(1)
    now = new Date(T0.getTime() + 61_000)
    await call(d, "pull", { body })
    expect(calls.projexa_sync_manifest).toBe(2)
  })

  test("/release/register: rpc throw 503, AW400 502, AW409 409", async () => {
    const rec = await (async () => {
      const rest = { release_version: "2026.10.05-001", files: [] }
      return { ...rest, manifest_sha256: await sha256Hex(canonicalize(rest)) }
    })()
    const fetchImpl = (async () => new Response(JSON.stringify(rec), { status: 200 })) as unknown as typeof fetch
    const cases: Array<[() => Promise<never> | Promise<{ data: unknown; error: { message: string; code?: string } | null }>, number]> = [
      [async () => Promise.reject(new Error("down")) as never, 503],
      [async () => ({ data: null, error: { message: "bad", code: "AW400" } }), 502],
      [async () => ({ data: null, error: { message: "taken", code: "AW409" } }), 409],
    ]
    for (const [answer, status] of cases) {
      const { rpc } = fakeDb({ projexa_release_register: answer as never })
      expect((await call(deps(rpc, { fetchImpl }), "release/register", { body: "{}" })).status).toBe(status)
    }
  })

  test("an unexpected throw anywhere is ONE closed 500 a browser can read, and the log line carries no message (F-14a)", async () => {
    const { rpc } = fakeDb()
    const lines: string[] = []
    const d = deps(rpc, {
      log: (l) => lines.push(l),
      session: async () => {
        throw new Error("secret row data 4111-1111")
      },
    })
    const r = await call(d, "manifest")
    expect(r.status).toBe(500)
    expect(r.headers.get("access-control-allow-origin")).toBe("https://projexa-ai.com")
    expect(lines.join("\n")).toContain("manifest")
    expect(lines.join("\n")).not.toContain("4111")
  })
})

describe("release memory and registration cost (F-01, F7)", () => {
  test("the registry's current release is remembered for RELEASE_TTL_MS (5 minutes), then read again", async () => {
    const { rpc, calls } = fakeDb()
    let now = T0
    const d = deps(rpc, { now: () => now, releaseBox: { at: 0, value: null } })
    const h = { "x-px-client": "2026.10.02-002; protocol=2; schema=3" }
    await call(d, "manifest", { headers: h })
    now = new Date(T0.getTime() + RELEASE_TTL_MS - 1000)
    await call(d, "manifest", { headers: h })
    expect(RELEASE_TTL_MS).toBe(300_000)
    expect(calls.projexa_release_current).toBe(1)
    now = new Date(T0.getTime() + RELEASE_TTL_MS + 1000)
    await call(d, "manifest", { headers: h })
    expect(calls.projexa_release_current).toBe(2)
  })

  test("P4: PX_RELEASE_ORIGIN decides where release bytes come from: releaseOriginOf, /release/current `origin`, and the manifest the registry reads", async () => {
    const bucket = "https://pcrjmlpuqsbocqfwoxod.supabase.co/storage/v1/object/public/projexa-release"
    expect(releaseOriginOf(undefined)).toBe(RELEASE_ORIGIN)
    expect(releaseOriginOf("")).toBe(RELEASE_ORIGIN)
    expect(releaseOriginOf(`${bucket}/`)).toBe(bucket)
    // not a plain https URL = the safe default, never an attacker-shaped value
    for (const bad of ["http://x.example/p", "https://u:p@x.example/p", "https://x.example/p?q=1", "https://x.example/p#h", "not a url", "javascript:alert(1)"]) {
      expect(releaseOriginOf(bad)).toBe(RELEASE_ORIGIN)
    }
    const { rpc } = fakeDb()
    expect(((await (await call(deps(rpc), "release/current")).json()) as J).origin).toBe(RELEASE_ORIGIN)
    expect(((await (await call(deps(rpc, { releaseOrigin: bucket }), "release/current")).json()) as J).origin).toBe(bucket)
    const rec = { release_version: "2026.10.05-001", files: [] as unknown[] }
    const man = { ...rec, manifest_sha256: await sha256Hex(canonicalize(rec)) }
    const seen: string[] = []
    const fetchImpl = (async (url: string) => (seen.push(url), new Response(JSON.stringify(man), { status: 200 }))) as unknown as typeof fetch
    await call(deps(rpc, { fetchImpl, releaseOrigin: bucket, registerBox: { at: 0, answer: null }, releaseBox: { at: 0, value: null } }), "release/register", { body: "{}" })
    expect(seen).toEqual([`${bucket}/_release/release.json`])
  })

  test("/release/current?files=0 leaves out the file table", async () => {
    const { rpc } = fakeDb()
    const full = (await (await call(deps(rpc), "release/current")).json()) as { current: J }
    expect(full.current.files).toBeDefined()
    const light = (await (await call(deps(rpc), "release/current?files=0")).json()) as { current: J }
    expect(light.current.files).toBeUndefined()
    expect(light.current.release_version).toBe("2026.10.02-002")
  })

  test("register fetches the owner's manifest at most once a minute per isolate whoever asks, and 'already registered' forces no re-read", async () => {
    const rest = { release_version: "2026.10.05-001", files: [] }
    const man = { ...rest, manifest_sha256: await sha256Hex(canonicalize(rest)) }
    let fetches = 0
    const fetchImpl = (async () => (fetches++, new Response(JSON.stringify(man), { status: 200 }))) as unknown as typeof fetch
    const { rpc, calls } = fakeDb({ projexa_release_register: async () => ({ data: { registered: false, reason: "already_registered" }, error: null }) })
    let now = T0
    const d = deps(rpc, { fetchImpl, now: () => now, registerBox: { at: 0, answer: null }, releaseBox: { at: 0, value: null } })
    for (let i = 0; i < 5; i++) expect((await call(d, "release/register", { body: "{}", token: `tok:u${i}` })).status).toBe(200)
    expect(fetches).toBe(1)
    expect(calls.projexa_release_register).toBe(1)
    expect(calls.projexa_release_current ?? 0).toBe(0)
    now = new Date(T0.getTime() + 61_000)
    await call(d, "release/register", { body: "{}" })
    expect(fetches).toBe(2)
  })
})

describe("a page is never silently unsigned when a key exists (F13)", () => {
  test("signing configured but unavailable right now: 503 SIGNING_UNAVAILABLE, not unsigned rows", async () => {
    const { rpc } = fakeDb()
    const r = await call(deps(rpc, { signing: async () => null }), "pull", { body: JSON.stringify({ project_id: "proj-a", kind: "tasks" }) })
    expect(r.status).toBe(503)
    expect(((await r.json()) as J).code).toBe("SIGNING_UNAVAILABLE")
  })

  test("an organisation id carried by the SQL page is used: no manifest call to sign it", async () => {
    const { rpc, calls } = fakeDb({ projexa_sync_pull: async () => ({ data: { status: "ok", org_id: "org-a", items: [{ id: "t1", updated_at: "2026-10-01T00:00:00Z", version: 1, data: {} }] }, error: null }) })
    const key = await generateKeyRecord()
    const signing = await createSigning(key)
    const r = await call(deps(rpc, { signing: async () => signing }), "pull", { body: JSON.stringify({ project_id: "proj-a", kind: "tasks" }) })
    expect(r.status).toBe(200)
    expect(((await r.json()) as { kid: string }).kid).toBe(key.kid)
    // the view class is still remembered from one manifest; the org did not need it
    expect(calls.projexa_sync_manifest ?? 0).toBeLessThanOrEqual(1)
  })
})

describe("key caches (F-11)", () => {
  async function setup() {
    const key = await generateKeyRecord()
    let fail = false
    let publicAnswer: { data: unknown; error: { message: string } | null } = { data: [{ kid: key.kid, alg: "ES256", jwk: key.public_jwk, active: true }], error: null }
    const counts = { active: 0, publicKeys: 0, create: 0 }
    const rpc: Rpc = async (fn) => {
      if (fn === "projexa_sync_key_active") {
        counts.active++
        return fail ? { data: null, error: { message: "timeout" } } : { data: key, error: null }
      }
      if (fn === "projexa_sync_public_keys") {
        counts.publicKeys++
        return publicAnswer
      }
      return { data: null, error: { message: "x" } }
    }
    let t = 0
    const caches = createKeyCaches({ rpc, createSigning: async (r: KeyRecord) => (counts.create++, createSigning(r)), generateKeyRecord, clock: () => t })
    return { caches, counts, key, setFail: (v: boolean) => (fail = v), setPublic: (a: typeof publicAnswer) => (publicAnswer = a), advance: (ms: number) => (t += ms) }
  }

  test("a refresh that fails after the TTL keeps serving the last good key", async () => {
    const s = await setup()
    const first = await s.caches.signing()
    expect(first?.kid).toBe(s.key.kid)
    s.advance(KEY_TTL_MS + 1)
    s.setFail(true)
    expect((await s.caches.signing())?.kid).toBe(s.key.kid)
  })

  test("concurrent cold requests share ONE load", async () => {
    const s = await setup()
    await Promise.all(Array.from({ length: 10 }, () => s.caches.signing()))
    expect(s.counts.active).toBe(1)
    expect(s.counts.create).toBe(1)
  })

  test("an errored or empty public-key list is not cached for 5 minutes", async () => {
    const s = await setup()
    s.setPublic({ data: null, error: { message: "boom" } })
    expect(await s.caches.publicKeys()).toEqual([])
    s.setPublic({ data: [], error: null })
    expect(await s.caches.publicKeys()).toEqual([])
    s.setPublic({ data: [{ kid: s.key.kid, alg: "ES256", jwk: s.key.public_jwk, active: true }], error: null })
    expect(((await s.caches.publicKeys()) as PublicKeyInfo[]).map((k) => k.kid)).toEqual([s.key.kid])
    expect(s.counts.publicKeys).toBe(3)
  })
})

describe("holder-bound attestation and view-bound rows (TI-2, F-12, F15)", () => {
  async function laptopKey() {
    const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"])) as CryptoKeyPair
    const pub = await crypto.subtle.exportKey("jwk", pair.publicKey)
    return { pair, jwk: { kty: "EC", crv: "P-256", x: pub.x as string, y: pub.y as string } }
  }
  const payloadOf = (token: string) => JSON.parse(new TextDecoder().decode(fromB64url(token.split(".")[1]))) as J
  const signWith = async (k: CryptoKey, msg: string) => b64url(new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, k, new TextEncoder().encode(msg))))

  test("with device_pub_jwk the token carries cnf.jkt = its RFC 7638 thumbprint; the holder passes the handshake, a replay by another key fails", async () => {
    const { rpc } = fakeDb()
    const signing = await createSigning(await generateKeyRecord())
    const a = await laptopKey()
    const r = await call(deps(rpc, { signing: async () => signing }), "attest", { body: JSON.stringify({ device_pub_jwk: a.jwk }) })
    expect(r.status).toBe(200)
    const j = (await r.json()) as J
    expect(j.holder_bound).toBe(true)
    const p = payloadOf(j.token as string)
    // RFC 7638 computed independently here: members crv, kty, x, y in that order, no whitespace
    const expected = b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify({ crv: "P-256", kty: "EC", x: a.jwk.x, y: a.jwk.y })))))
    expect((p.cnf as J).jkt).toBe(expected)
    expect(await jwkThumbprint(a.jwk as never)).toBe(expected)

    // the handshake step, offline: verifier C sends a nonce; the holder signs it with the device key
    const nonce = "n-" + crypto.randomUUID()
    const proof = await signWith(a.pair.privateKey, holderProofMessage(nonce, "laptop-C", expected))
    expect(await verifyHolderProof({ cnfJkt: (p.cnf as J).jkt as string, holderJwk: a.jwk, nonce, verifierId: "laptop-C", proof })).toBe(true)
    // B replays A's token with its own key: the thumbprint does not match
    const b = await laptopKey()
    const bProof = await signWith(b.pair.privateKey, holderProofMessage(nonce, "laptop-C", expected))
    expect(await verifyHolderProof({ cnfJkt: expected, holderJwk: b.jwk, nonce, verifierId: "laptop-C", proof: bProof })).toBe(false)
    // B presents A's public key but cannot sign with it
    expect(await verifyHolderProof({ cnfJkt: expected, holderJwk: a.jwk, nonce, verifierId: "laptop-C", proof: bProof })).toBe(false)
    // a proof made for another verifier or an old nonce does not carry over
    expect(await verifyHolderProof({ cnfJkt: expected, holderJwk: a.jwk, nonce: "other", verifierId: "laptop-C", proof })).toBe(false)
    expect(await verifyHolderProof({ cnfJkt: expected, holderJwk: a.jwk, nonce, verifierId: "laptop-D", proof })).toBe(false)
    // a token with no cnf never passes the holder step
    expect(await verifyHolderProof({ cnfJkt: undefined, holderJwk: a.jwk, nonce, verifierId: "laptop-C", proof })).toBe(false)
  })

  test("no key sent: the old bearer token (holder_bound false, no cnf); a private JWK or another curve is refused 400", async () => {
    const { rpc } = fakeDb()
    const signing = await createSigning(await generateKeyRecord())
    const d = deps(rpc, { signing: async () => signing })
    const plain = (await (await call(d, "attest", { body: "{}" })).json()) as J
    expect(plain.holder_bound).toBe(false)
    expect(payloadOf(plain.token as string).cnf).toBeUndefined()
    expect((await call(d, "attest", { body: "" })).status).toBe(200)
    const priv = (await crypto.subtle.exportKey("jwk", ((await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign"])) as CryptoKeyPair).privateKey)) as J
    expect((await call(d, "attest", { body: JSON.stringify({ device_pub_jwk: priv }) })).status).toBe(400)
    const a = await laptopKey()
    expect((await call(d, "attest", { body: JSON.stringify({ device_pub_jwk: { ...a.jwk, crv: "P-384" } }) })).status).toBe(400)
    expect((await call(d, "attest", { body: JSON.stringify({ device_pub_jwk: { ...a.jwk, x: "A".repeat(43) } }) })).status).toBe(400)
  })

  test("pulled rows carry sig3, which commits to the view class: it verifies for the person's class and fails for any other", async () => {
    const { rpc } = fakeDb()
    const key = await generateKeyRecord()
    const signing: Signing = await createSigning(key)
    const r = (await (await call(deps(rpc, { signing: async () => signing }), "pull", { body: JSON.stringify({ project_id: "proj-a", kind: "tasks" }) })).json()) as { items: J[] }
    const it = r.items[0]
    expect(typeof it.sig).toBe("string")
    expect(typeof it.sig3).toBe("string")
    const pub = await importPublic(key.public_jwk)
    const dataHash = await sha256Hex(canonicalize(it.data))
    const msg = (view: string) => itemMessageV3({ org: "org-a", project: "proj-a", kind: "tasks", view, id: "t1", version: 3, updatedAt: "2026-10-01T00:00:00Z", dataHash })
    expect(await verifyMessage(pub, msg("vc-member"), it.sig3 as string)).toBe(true)
    expect(await verifyMessage(pub, msg("vc-owner"), it.sig3 as string)).toBe(false)
  })

  test("class_channel differs between view classes of one organisation and is equal within one; channel stays per organisation", async () => {
    const signing = await createSigning(await generateKeyRecord())
    const att = async (view: string) => {
      const { rpc } = fakeDb({ projexa_sync_manifest: async () => ({ data: { status: "ok", user: { id: "u1", org_id: "org-a" }, projects: [], kinds: [], view_class: view }, error: null }) })
      return (await (await call(deps(rpc, { signing: async () => signing }), "attest", { body: "{}" })).json()) as J
    }
    const m1 = await att("vc-member")
    const m2 = await att("vc-member")
    const o = await att("vc-owner")
    expect(m1.class_channel).toBe(m2.class_channel)
    expect(m1.class_channel).not.toBe(o.class_channel)
    expect(m1.channel).toBe(o.channel)
  })
})
