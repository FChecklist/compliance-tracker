/// <reference types="bun-types" />
// PROJEXA LOCAL-FIRST: drizzle/0680_projexa_release_registry.sql on PGlite (real Postgres as WASM) and the REAL Edge handler (supabase/functions/projexa-sync/handler.ts).
//   * numbering:  every path gets a PERMANENT file_no on first sight; file_version is 1 on first sight and +1 each time the bytes differ from the previous release
//   * history:    the registry keeps every release and every file row; a repeat registration is a no-op; the same version name with other content is refused (409)
//   * policy:     a laptop below min_compatible, or speaking another protocol, is told to update (426); the routes it needs to update stay reachable; a dev build is never blocked
//   * install:    one row per laptop event for the signed-in PERSON, only for a registered release with a matching digest, capped at 50 a day
//   * register:   the Edge function registers ONLY what the owner published at projexa-ai.com/_release/release.json, refusing a manifest that does not match its own digest
//   * reversible: the down file removes everything; the forward file applies twice
// Run: bun test --isolate src/lib/services/projexa-sync-release.pglite.test.ts
import { describe, test, expect, beforeAll, afterAll, setDefaultTimeout } from "bun:test"
import type { PGlite } from "@electric-sql/pglite"
import { handleSync, RateLimiter, RELEASE_MANIFEST_URL, RELEASE_TTL_MS, SERVER_PROTOCOL, type Rpc } from "../../../supabase/functions/projexa-sync/handler"
import type { SessionVerifier } from "../../../supabase/functions/ai-work-link/session"
import { canonicalize, sha256Hex } from "../../../supabase/functions/projexa-sync/sign"
import { forwardSql, downSql } from "./__test-helpers__/awl-pglite"
import { createUserLinkDb, type J } from "./__test-helpers__/awl-user-link-db"
import { pgRpc } from "./__test-helpers__/awl-records-v2-db"

setDefaultTimeout(180_000)

const SUBS: Record<string, string> = { "u-mgr": "11111111-1111-4111-8111-111111111111", "u-mem": "22222222-2222-4222-8222-222222222222" }
const NOW = new Date("2026-10-02T12:00:00Z")
const hex = (c: string) => c.repeat(64)

let db: PGlite
let rpc: Rpc
let fetchResult: { ok: boolean; status?: number; body: string } | "throw" = "throw"
let fetchedUrls: string[] = []

const session: SessionVerifier = async (token) => (token.startsWith("tok:") ? { ok: true, sub: token.slice(4), email: null, issuer: "test", iat: null } : { ok: false, reason: "invalid" })
const fakeFetch = (async (url: string) => {
  fetchedUrls.push(String(url))
  if (fetchResult === "throw") throw new Error("network")
  return { ok: fetchResult.ok, status: fetchResult.status ?? 200, text: async () => fetchResult.body } as unknown as Response
}) as unknown as typeof fetch

async function hit(user: string, path: string, body?: unknown, headers: Record<string, string> = {}, method?: string) {
  const m = method ?? (body === undefined ? "GET" : "POST")
  const req = new Request(`https://x.supabase.co/functions/v1/projexa-sync/${path}`, { method: m, headers: { authorization: `Bearer tok:${SUBS[user]}`, ...headers }, body: m === "GET" ? undefined : JSON.stringify(body ?? {}) })
  // a fresh releaseBox per call: the one-minute memory is the handler's own (tested in "the release is remembered for a minute"), the registry is what is under test here
  const res = await handleSync(req, { rpc, session, limiter: new RateLimiter(100000), now: () => NOW, fetchImpl: fakeFetch, releaseBox: { at: 0, value: null } })
  return { status: res.status, json: (await res.json()) as J }
}

type FileIn = { path: string; sha256: string; size: number }
async function manifest(version: string, files: FileIn[], o: { builtAt?: string; bundleSha?: string; git?: string } = {}) {
  const body: Record<string, unknown> = {
    release_version: version,
    git_sha: o.git ?? "abc1234",
    built_at: o.builtAt ?? "2026-10-02T10:00:00Z",
    protocol: 2,
    schema: 3,
    bundle: { path: `/_release/px-${version}.tar.gz`, size: 1234567, sha256: o.bundleSha ?? hex("b") },
    files,
  }
  return { ...body, manifest_sha256: await sha256Hex(canonicalize(body)) }
}
const register = (m: unknown) => rpc("projexa_release_register", { p_manifest: m })
const rows = async (sql: string) => (await db.query<Record<string, unknown>>(sql)).rows

const A: FileIn[] = [
  { path: "_next/static/chunks/main-aaa.js", sha256: hex("1"), size: 100 },
  { path: "_next/static/css/app-bbb.css", sha256: hex("2"), size: 50 },
  { path: "logo.svg", sha256: hex("3"), size: 10 },
]

beforeAll(async () => {
  db = await createUserLinkDb()
  await db.exec(forwardSql("0618_build001_projexa_gateway"))
  await db.exec(forwardSql("0677_projexa_sync_read"))
  await db.exec(forwardSql("0678_projexa_sync_keys_ids"))
  await db.exec(forwardSql("0680_projexa_release_registry"))
  rpc = pgRpc(db)
}, 300_000)
afterAll(async () => {
  await db.close()
})

describe("registering releases: permanent numbers, versions that move with the bytes", () => {
  test("nothing registered yet: current says so", async () => {
    expect((await rpc("projexa_release_current")).data).toEqual({ registered: false, current: null, min_compatible: "" })
  })

  test("the first release: file numbers 1..3 in manifest order, every file at version 1", async () => {
    const r = await register(await manifest("2026.10.01-001", A, { builtAt: "2026-10-01T10:00:00Z" }))
    expect(r.error).toBeNull()
    expect(r.data).toMatchObject({ registered: true, release_version: "2026.10.01-001", files_added: 3, files_changed: 0, files_unchanged: 0, files: 3, bytes: 160 })
    const f = await rows(`select path, file_no, file_version from platform.projexa_release_file where release_version = '2026.10.01-001' order by file_no`)
    expect(f.map((x) => [x.path, Number(x.file_no), Number(x.file_version)])).toEqual([["_next/static/chunks/main-aaa.js", 1, 1], ["_next/static/css/app-bbb.css", 2, 1], ["logo.svg", 3, 1]])
  })

  test("registering the same manifest again is a no-op", async () => {
    const m = await manifest("2026.10.01-001", A, { builtAt: "2026-10-01T10:00:00Z" })
    expect((await register(m)).data).toMatchObject({ registered: false, reason: "already_registered", release_version: "2026.10.01-001" })
    expect(Number((await rows(`select count(*) n from platform.projexa_release`))[0].n)).toBe(1)
  })

  test("a later release: changed bytes +1, identical bytes keep the version, a new path gets the next number, a dropped path simply is not in it", async () => {
    const B: FileIn[] = [
      { path: "_next/static/chunks/main-aaa.js", sha256: hex("9"), size: 120 }, // changed
      { path: "logo.svg", sha256: hex("3"), size: 10 }, // identical
      { path: "_next/static/chunks/new-ccc.js", sha256: hex("4"), size: 7 }, // new
    ]
    const r = await register(await manifest("2026.10.02-001", B, { builtAt: "2026-10-02T10:00:00Z", bundleSha: hex("c") }))
    expect(r.data).toMatchObject({ registered: true, files_added: 1, files_changed: 1, files_unchanged: 1 })
    const f = await rows(`select path, file_no, file_version from platform.projexa_release_file where release_version = '2026.10.02-001' order by file_no`)
    expect(f.map((x) => [x.path, Number(x.file_no), Number(x.file_version)])).toEqual([["_next/static/chunks/main-aaa.js", 1, 2], ["logo.svg", 3, 1], ["_next/static/chunks/new-ccc.js", 4, 1]])
    // the dropped path keeps its number forever and its history
    expect(Number((await rows(`select file_no from platform.projexa_file where path = '_next/static/css/app-bbb.css'`))[0].file_no)).toBe(2)
    expect(Number((await rows(`select count(*) n from platform.projexa_release_file where path = '_next/static/css/app-bbb.css'`))[0].n)).toBe(1)
  })

  test("bytes that return to an older state are a NEW version of that file (the version moves whenever the bytes differ from the previous release)", async () => {
    const C: FileIn[] = [{ path: "_next/static/chunks/main-aaa.js", sha256: hex("1"), size: 100 }]
    await register(await manifest("2026.10.03-001", C, { builtAt: "2026-10-03T10:00:00Z", bundleSha: hex("d") }))
    expect(Number((await rows(`select file_version from platform.projexa_release_file where release_version = '2026.10.03-001'`))[0].file_version)).toBe(3)
  })

  test("the same version name with different content is refused (AW409); nothing is overwritten", async () => {
    const r = await register(await manifest("2026.10.02-001", [{ path: "other.js", sha256: hex("5"), size: 1 }], { builtAt: "2026-10-02T10:00:00Z", bundleSha: hex("e") }))
    expect(r.error?.code).toBe("AW409")
    expect(Number((await rows(`select count(*) n from platform.projexa_release_file where release_version = '2026.10.02-001'`))[0].n)).toBe(3)
  })

  test("malformed manifests are refused (AW400) and leave nothing behind", async () => {
    const before = Number((await rows(`select count(*) n from platform.projexa_release`))[0].n)
    const ok = await manifest("2026.10.09-001", A, { builtAt: "2026-10-09T10:00:00Z" })
    const bad: unknown[] = [
      { ...ok, release_version: "v1" },
      { ...ok, manifest_sha256: "nope" },
      { ...ok, files: [] },
      { ...ok, files: [{ path: "../etc/passwd", sha256: hex("1"), size: 1 }] },
      { ...ok, files: [{ path: "a\u0007b.js", sha256: hex("1"), size: 1 }] },
      { ...ok, files: [{ path: "a.js", sha256: "short", size: 1 }] },
      { ...ok, files: [{ path: "a.js", sha256: hex("1"), size: -1 }] },
      { ...ok, bundle: { path: "", size: 1, sha256: hex("b") } },
      { ...ok, protocol: "x" },
      { ...ok, built_at: "yesterday" },
    ]
    const codes: string[] = []
    for (const m of bad) codes.push((await register(m)).error?.code ?? "no error")
    expect(codes).toEqual(bad.map(() => "AW400"))
    expect(Number((await rows(`select count(*) n from platform.projexa_release`))[0].n)).toBe(before)
  })

  test("refused before anything is written: an impossible date, a partial timestamp, a repeated path, a string size, over 5,000 files, a bad bundle size, a bad file at the END", async () => {
    const before = Number((await rows(`select count(*) n from platform.projexa_release`))[0].n)
    const maxNo = Number((await rows(`select max(file_no) n from platform.projexa_file`))[0].n)
    const ok = await manifest("2026.10.08-001", A, { builtAt: "2026-10-08T10:00:00Z" })
    const many = Array.from({ length: 5001 }, (_, i) => ({ path: `f${i}.js`, sha256: hex("1"), size: 1 }))
    const bad: Array<[string, unknown]> = [
      ["impossible date", { ...ok, built_at: "2026-13-45T00:00:00Z" }],
      ["date only", { ...ok, built_at: "2026-10-08T" }],
      ["repeated path", { ...ok, files: [{ path: "dup.js", sha256: hex("1"), size: 1 }, { path: "dup.js", sha256: hex("2"), size: 2 }] }],
      ["size as a string", { ...ok, files: [{ path: "s.js", sha256: hex("1"), size: "1" }] }],
      ["5001 files", { ...ok, files: many }],
      ["bundle size", { ...ok, bundle: { path: "/x.tar.gz", size: "big", sha256: hex("b") } }],
      ["bad file last", { ...ok, files: [{ path: "brand-new-1.js", sha256: hex("1"), size: 1 }, { path: "brand-new-2.js", sha256: hex("1"), size: 1 }, { path: "../x", sha256: hex("1"), size: 1 }] }],
    ]
    const codes: Array<[string, string]> = []
    for (const [name, m] of bad) codes.push([name, (await register(m)).error?.code ?? "no error"])
    expect(codes).toEqual(bad.map(([name]) => [name, "AW400"]))
    expect(Number((await rows(`select count(*) n from platform.projexa_release`))[0].n)).toBe(before)
    // no permanent number was burnt: the next new path gets max + 1
    const r = await register(await manifest("2026.10.02-002", [{ path: "next-number.js", sha256: hex("6"), size: 1 }], { builtAt: "2026-10-02T11:00:00Z", bundleSha: hex("6") }))
    expect(r.error).toBeNull()
    expect(Number((await rows(`select file_no from platform.projexa_file where path = 'next-number.js'`))[0].file_no)).toBe(maxNo + 1)
    // a fractional, zone-offset timestamp (what the build script writes) is accepted
    expect((await register(await manifest("2026.10.02-003", [{ path: "z1.js", sha256: hex("7"), size: 1 }], { builtAt: "2026-10-02T11:30:00.000+05:30", bundleSha: hex("7") }))).error).toBeNull()
  })

  test("current is the newest build with its file table in file-number order", async () => {
    const d = (await rpc("projexa_release_current")).data as J
    expect(d.registered).toBe(true)
    expect(d.current.release_version).toBe("2026.10.03-001")
    expect(d.current.files).toEqual([{ path: "_next/static/chunks/main-aaa.js", file_no: 1, file_version: 3, sha256: hex("1"), size: 100 }])
    expect(d.current.bundle).toMatchObject({ path: "/_release/px-2026.10.03-001.tar.gz" })
  })

  test("a hotfix registered LATER with an EARLIER built_at does not become current (the choice: newest build wins, re-registering an old build never rolls laptops back)", async () => {
    const r = await register(await manifest("2026.10.04-001", [{ path: "hotfix.js", sha256: hex("8"), size: 1 }], { builtAt: "2026-10-02T23:00:00Z", bundleSha: hex("8") }))
    expect(r.data).toMatchObject({ registered: true })
    expect(((await rpc("projexa_release_current")).data as J).current.release_version).toBe("2026.10.03-001")
  })
})

describe("the update gate (426) and the release routes", () => {
  test("no floor set: every client is served; a dev build and a client with no header are never blocked", async () => {
    expect((await hit("u-mgr", "manifest", undefined, { "x-px-client": "2026.09.01-001; protocol=2; schema=3" })).status).toBe(200)
    expect((await hit("u-mgr", "manifest", undefined, { "x-px-client": "dev; protocol=2; schema=3" })).status).toBe(200)
    expect((await hit("u-mgr", "manifest")).status).toBe(200)
  })

  test("a floor blocks the older release and a foreign protocol with 426; the newer one passes", async () => {
    await rpc("projexa_release_set_min_compatible", { p_release: "2026.10.02-001" })
    const old = await hit("u-mgr", "manifest", undefined, { "x-px-client": "2026.10.01-001; protocol=2; schema=3" })
    expect(old.status).toBe(426)
    expect(old.json).toMatchObject({ code: "UPDATE_REQUIRED", current: "2026.10.03-001", min_compatible: "2026.10.02-001", protocol: SERVER_PROTOCOL, reason: "release" })
    expect((await hit("u-mgr", "pull", { project_id: "proj-a", kind: "tasks", after: null, limit: 5 }, { "x-px-client": "2026.10.01-001; protocol=2" })).status).toBe(426)
    expect((await hit("u-mgr", "manifest", undefined, { "x-px-client": "2026.10.02-001; protocol=2; schema=3" })).status).toBe(200)
    expect((await hit("u-mgr", "manifest", undefined, { "x-px-client": "2027.01.01-001; protocol=2; schema=3" })).status).toBe(200)
    const proto = await hit("u-mgr", "manifest", undefined, { "x-px-client": "2026.10.03-001; protocol=1; schema=3" })
    expect(proto.status).toBe(426)
    expect(proto.json.reason).toBe("protocol")
    // WITH the floor active: a dev / local build (not a release number) is never blocked -- the guard, not string order, decides ("1.0.0-local" sorts BELOW the floor)
    expect("1.0.0-local" < "2026.10.02-001").toBe(true)
    expect((await hit("u-mgr", "manifest", undefined, { "x-px-client": "1.0.0-local; protocol=2" })).status).toBe(200)
    expect((await hit("u-mgr", "manifest", undefined, { "x-px-client": "dev; protocol=2" })).status).toBe(200)
  })

  test("the release is remembered for RELEASE_TTL_MS: one registry read per window, a fresh read after register, the old value served if the registry fails", async () => {
    let reads = 0
    let failing = false
    const counting: Rpc = async (name, args) => {
      if (name === "projexa_release_current") {
        reads++
        if (failing) throw new Error("db down")
      }
      return rpc(name, args)
    }
    const box = { at: 0, value: null }
    let t = new Date("2026-10-02T12:00:00Z").getTime()
    const call = async (path: string, method = "GET", body?: unknown) => {
      const client: Record<string, string> = path === "manifest" ? { "x-px-client": "2026.10.01-001; protocol=2" } : {}
      const req = new Request(`https://x.supabase.co/functions/v1/projexa-sync/${path}`, { method, headers: { authorization: `Bearer tok:${SUBS["u-mgr"]}`, ...client }, body: body === undefined ? undefined : JSON.stringify(body) })
      const res = await handleSync(req, { rpc: counting, session, limiter: new RateLimiter(100000), now: () => new Date(t), fetchImpl: fakeFetch, releaseBox: box })
      return { status: res.status, json: (await res.json()) as J }
    }
    expect((await call("manifest")).status).toBe(426) // the floor 2026.10.02-001 is still set here
    expect(reads).toBe(1)
    t += RELEASE_TTL_MS - 1_000 // the handler's own memory (5 minutes since package D1): inside it, no new registry read
    await call("manifest")
    expect(reads).toBe(1)
    t += 2_000
    await call("manifest")
    expect(reads).toBe(2)
    // a registration refreshes at once (within the minute)
    // (built before 2026.10.03-001, so the current release does not change for the tests after this one)
    fetchResult = { ok: true, body: JSON.stringify(await manifest("2026.10.02-004", [{ path: "w.js", sha256: hex("5"), size: 1 }], { builtAt: "2026-10-02T12:00:00Z", bundleSha: hex("5") })) }
    expect((await call("release/register", "POST", {})).json).toMatchObject({ registered: true })
    const afterRegister = reads
    expect(afterRegister).toBeGreaterThan(2)
    await call("manifest") // still within the memory: no new read
    expect(reads).toBe(afterRegister)
    // the registry fails after a good read: the remembered value still gates (426), it does not fail open
    failing = true
    t += RELEASE_TTL_MS + 1_000
    expect((await call("manifest")).status).toBe(426)
    failing = false
  })

  test("the owner's manifest is fetched with no redirect, no cache and a timeout, from the one fixed URL", async () => {
    let seen: { url: string; init: RequestInit | undefined } | null = null
    const spy = (async (url: string, init?: RequestInit) => {
      seen = { url: String(url), init }
      throw new Error("network")
    }) as unknown as typeof fetch
    const req = new Request("https://x.supabase.co/functions/v1/projexa-sync/release/register", { method: "POST", headers: { authorization: `Bearer tok:${SUBS["u-mgr"]}` }, body: "{}" })
    await handleSync(req, { rpc, session, limiter: new RateLimiter(100000), now: () => NOW, fetchImpl: spy, releaseBox: { at: 0, value: null } })
    expect(seen).not.toBeNull()
    expect(seen!.url).toBe(RELEASE_MANIFEST_URL)
    expect(seen!.init).toMatchObject({ redirect: "error", cache: "no-store" })
    expect(seen!.init!.signal).toBeDefined()
  })

  test("a too-old laptop can still read the release and record its install (that is how it updates)", async () => {
    const h = { "x-px-client": "2026.09.01-001; protocol=2; schema=3" }
    const cur = await hit("u-mgr", "release/current", undefined, h)
    expect(cur.status).toBe(200)
    // "registered" is about the release the laptop REPORTED: 2026.09.01-001 is not the registry's current, so it is told so (and may ask to register)
    expect(cur.json).toMatchObject({ registered: false, min_compatible: "2026.10.02-001", protocol: SERVER_PROTOCOL })
    expect(cur.json.current.release_version).toBe("2026.10.03-001")
    expect((await hit("u-mgr", "install", { device_id: "dev-device-1", release_version: "2026.10.03-001", status: "updated", downloaded_at: "2026-10-02T11:00:00Z" }, h)).status).toBe(200)
  })

  test("`registered` is true when the laptop's reported release IS the registry's current, and for a laptop that names no release or a non-release build", async () => {
    expect((await hit("u-mgr", "release/current", undefined, { "x-px-client": "2026.10.03-001; protocol=2; schema=3" })).json).toMatchObject({ registered: true })
    expect((await hit("u-mgr", "release/current", undefined, { "x-px-client": "2026.10.09-777; protocol=2; schema=3" })).json, "a NEWER build the registry has never seen").toMatchObject({ registered: false })
    expect((await hit("u-mgr", "release/current", undefined, { "x-px-client": "dev; protocol=2; schema=3" })).json).toMatchObject({ registered: true })
    expect((await hit("u-mgr", "release/current")).json).toMatchObject({ registered: true })
  })

  test("the manifest names the current release and the floor", async () => {
    const m = await hit("u-mgr", "manifest")
    expect(m.json.release).toEqual({ current: "2026.10.03-001", min_compatible: "2026.10.02-001", protocol: SERVER_PROTOCOL })
  })

  test("clearing the floor lifts the block", async () => {
    await rpc("projexa_release_set_min_compatible", { p_release: "" })
    expect((await hit("u-mgr", "manifest", undefined, { "x-px-client": "2026.09.01-001; protocol=2; schema=3" })).status).toBe(200)
    expect((await rpc("projexa_release_set_min_compatible", { p_release: "bad" })).error?.code).toBe("AW400")
  })
})

describe("recording installs", () => {
  const base = { device_id: "laptop-aaaa-0001", release_version: "2026.10.03-001", downloaded_at: "2026-10-02T11:00:00Z", installed_at: "2026-10-02T11:01:00Z", files: 1, bytes: 100, status: "installed" }

  test("a registered release with its true digest is recorded against the signed-in person and their organisation", async () => {
    const m = (await rpc("projexa_release_current")).data as J
    const r = await hit("u-mgr", "install", { ...base, manifest_sha256: m.current.manifest_sha256, previous_release: "2026.10.02-001" })
    expect(r.status).toBe(200)
    const row = (await rows(`select user_id, org_id, device_id, release_version, previous_release, files_count, bytes, status from platform.projexa_client_install where id = ${r.json.recorded}`))[0]
    expect(row).toMatchObject({ user_id: "u-mgr", org_id: "org-a", device_id: "laptop-aaaa-0001", release_version: "2026.10.03-001", previous_release: "2026.10.02-001", status: "installed" })
    expect(Number(row.files_count)).toBe(1)
  })

  test("an unknown release, a wrong digest and a malformed field are refused; a failure may name a release that is not registered", async () => {
    const asks: Array<Record<string, unknown>> = [
      { ...base, release_version: "2030.01.01-001" },
      { ...base, manifest_sha256: hex("f") },
      { ...base, device_id: "x" },
      { ...base, status: "weird" },
      { ...base, files: -1 },
      { ...base, bytes: "many" },
      { ...base, downloaded_at: "yesterday" },
      { device_id: base.device_id },
    ]
    const statuses: number[] = []
    for (const a of asks) statuses.push((await hit("u-mgr", "install", a)).status)
    expect(statuses).toEqual(asks.map(() => 400))
    expect((await hit("u-mgr", "install", { ...base, release_version: "2030.01.01-001", status: "failed", error: "hash mismatch on 1 file" })).status).toBe(200)
  })

  test("at most 50 events per person per day", async () => {
    let last = 200
    for (let i = 0; i < 60 && last === 200; i++) last = (await hit("u-mem", "install", { ...base, device_id: `laptop-bbbb-${String(i).padStart(4, "0")}` })).status
    expect(last).toBe(429)
    expect(Number((await rows(`select count(*) n from platform.projexa_client_install where user_id = 'u-mem'`))[0].n)).toBe(50)
  })
})

describe("POST /release/register: only what the owner published, only if it matches its own digest", () => {
  test("registers the manifest published at the owner's origin, and asks for nothing else", async () => {
    const m = await manifest("2026.10.05-001", [{ path: "z.js", sha256: hex("7"), size: 3 }], { builtAt: "2026-10-05T10:00:00Z", bundleSha: hex("f") })
    fetchResult = { ok: true, body: JSON.stringify(m) }
    fetchedUrls = []
    const r = await hit("u-mgr", "release/register", { url: "https://evil.example/release.json", release_version: "9999.99.99-999" })
    expect(r.status).toBe(200)
    expect(r.json).toMatchObject({ registered: true, release_version: "2026.10.05-001" })
    expect(fetchedUrls).toEqual([RELEASE_MANIFEST_URL])
    expect(RELEASE_MANIFEST_URL).toBe("https://projexa-ai.com/_release/release.json")
    // idempotent
    expect((await hit("u-mgr", "release/register", {})).json).toMatchObject({ registered: false })
  })

  test("a manifest altered after its digest was computed is refused", async () => {
    const m = await manifest("2026.10.06-001", [{ path: "y.js", sha256: hex("8"), size: 3 }], { builtAt: "2026-10-06T10:00:00Z" })
    fetchResult = { ok: true, body: JSON.stringify({ ...m, files: [{ path: "y.js", sha256: hex("a"), size: 3 }] }) }
    const r = await hit("u-mgr", "release/register", {})
    expect(r.status).toBe(502)
    expect(r.json.code).toBe("MANIFEST_BAD")
    expect(Number((await rows(`select count(*) n from platform.projexa_release where release_version = '2026.10.06-001'`))[0].n)).toBe(0)
  })

  test("unreachable, not JSON, not an object, oversize and a taken version name each fail closed with a plain code", async () => {
    fetchResult = "throw"
    expect((await hit("u-mgr", "release/register", {})).json.code).toBe("MANIFEST_UNREACHABLE")
    fetchResult = { ok: false, status: 404, body: "" }
    expect((await hit("u-mgr", "release/register", {})).json.code).toBe("MANIFEST_UNREACHABLE")
    fetchResult = { ok: true, body: "<html>" }
    expect((await hit("u-mgr", "release/register", {})).json.code).toBe("MANIFEST_BAD")
    fetchResult = { ok: true, body: "[1,2]" }
    expect((await hit("u-mgr", "release/register", {})).json.code).toBe("MANIFEST_BAD")
    fetchResult = { ok: true, body: " ".repeat(2_000_001) }
    expect((await hit("u-mgr", "release/register", {})).json.code).toBe("MANIFEST_BAD")
    const taken = await manifest("2026.10.05-001", [{ path: "q.js", sha256: hex("6"), size: 3 }], { builtAt: "2026-10-05T10:00:00Z", bundleSha: hex("9") })
    fetchResult = { ok: true, body: JSON.stringify(taken) }
    const r = await hit("u-mgr", "release/register", {})
    expect(r.status).toBe(409)
    expect(r.json.code).toBe("VERSION_TAKEN")
  })

  test("wrong methods and no session", async () => {
    expect((await hit("u-mgr", "release/register", undefined, {}, "GET")).status).toBe(405)
    expect((await hit("u-mgr", "release/current", {}, {}, "POST")).status).toBe(405)
    const noAuth = await handleSync(new Request("https://x/functions/v1/projexa-sync/release/current", { method: "GET" }), { rpc, session })
    expect(noAuth.status).toBe(401)
  })
})

describe("reversible", () => {
  test("the down file removes the registry; the forward file applies twice without harm", async () => {
    await db.exec(downSql("0680_projexa_release_registry"))
    expect((await rows(`select to_regclass('platform.projexa_release')::text a, to_regclass('platform.projexa_client_install')::text b`))[0]).toEqual({ a: null, b: null })
    // with no registry the handler still answers (nobody is told to update)
    expect((await hit("u-mgr", "manifest", undefined, { "x-px-client": "2020.01.01-001; protocol=2" })).status).toBe(200)
    await db.exec(forwardSql("0680_projexa_release_registry"))
    await db.exec(forwardSql("0680_projexa_release_registry"))
    expect(Number((await rows(`select count(*) n from platform.projexa_release_policy`))[0].n)).toBe(1)
  })
})
