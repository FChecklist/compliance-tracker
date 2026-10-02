/// <reference types="bun-types" />
// PROJEXA LOCAL-FIRST SYNC: drizzle/0678_projexa_sync_keys_ids.sql on PGlite (real Postgres as WASM, built the way the live database is: 0618 gateway,
// the AI work link, 0677 read side) and the REAL Edge handler (supabase/functions/projexa-sync/handler.ts + sign.ts) running over those SQL functions.
//   * ids:       one page of the ids a person may read NOW (keyset by id); another organisation's row, a foreign / private / unknown project and an
//                unsupported kind are ONE 404; a row deleted on the server disappears from the list (this is how a laptop learns of deletes)
//   * view class: equal for two people who are redacted alike, different when a role sees money and another does not
//   * keys:      exactly one active key; the private half never leaves through the public list; rotation keeps older public halves verifiable
//   * signing:   every pulled row carries a signature that verifies, and fails for a changed row, project, kind, id, timestamp or organisation
//   * attest:    a short-lived signed statement (organisation, projects, view class) a peer laptop can verify, plus an organisation channel that is
//                stable inside one organisation and different across organisations
//   * vectors:   the canonical JSON text and its SHA-256 are fixed (the laptop asserts the same constants)
// Run: bun test --isolate src/lib/services/projexa-sync-keys-ids.pglite.test.ts
import { describe, test, expect, beforeAll, afterAll, setDefaultTimeout } from "bun:test"
import type { PGlite } from "@electric-sql/pglite"
import { handleSync, RateLimiter, type Rpc } from "../../../supabase/functions/projexa-sync/handler"
import type { SessionVerifier } from "../../../supabase/functions/ai-work-link/session"
import { canonicalize, createSigning, fromB64url, generateKeyRecord, importPublic, itemMessage, sha256Hex, TEST_VECTOR, verifyMessage, type KeyRecord, type Signing } from "../../../supabase/functions/projexa-sync/sign"
import { forwardSql } from "./__test-helpers__/awl-pglite"
import { createUserLinkDb, type J } from "./__test-helpers__/awl-user-link-db"
import { insert, pgRpc } from "./__test-helpers__/awl-records-v2-db"

setDefaultTimeout(120_000)

const SUBS: Record<string, string> = {
  "u-mgr": "11111111-1111-4111-8111-111111111111",
  "u-sen": "55555555-5555-4555-8555-555555555555",
  "u-mem": "22222222-2222-4222-8222-222222222222",
  "u-view": "66666666-6666-4666-8666-666666666666",
  "u-adm": "33333333-3333-4333-8333-333333333333",
  "u-b": "44444444-4444-4444-8444-444444444444",
}
const NOW = new Date("2026-10-02T00:00:00Z")

let db: PGlite
let rpc: Rpc
let key: KeyRecord
let signing: Signing

const session: SessionVerifier = async (token) => (token.startsWith("tok:") ? { ok: true, sub: token.slice(4), email: null, issuer: "test", iat: null } : { ok: false, reason: "invalid" })

type Opts = { signed?: boolean; method?: string; auth?: boolean }
async function hit(user: string | null, path: string, body?: unknown, o: Opts = {}) {
  const headers: Record<string, string> = {}
  if (user && o.auth !== false) headers.authorization = `Bearer tok:${SUBS[user] ?? user}`
  const method = o.method ?? (body === undefined ? "GET" : "POST")
  const req = new Request(`https://x.supabase.co/functions/v1/projexa-sync/${path}`, { method, headers, body: method === "GET" || body === undefined ? undefined : JSON.stringify(body) })
  const res = await handleSync(req, {
    rpc,
    session,
    limiter: new RateLimiter(100000),
    now: () => NOW,
    signing: o.signed === false ? undefined : async () => signing,
    publicKeys: async () => {
      const r = await rpc("projexa_sync_public_keys")
      return (r.data as never) ?? []
    },
  })
  return { status: res.status, json: (await res.json()) as J }
}
const idsOf = async (user: string, project: string, kind: string, extra: Record<string, unknown> = {}) => hit(user, "ids", { project_id: project, kind, ...extra })

beforeAll(async () => {
  db = await createUserLinkDb()
  await db.exec(forwardSql("0618_build001_projexa_gateway"))
  await db.exec(forwardSql("0677_projexa_sync_read"))
  await db.exec(forwardSql("0678_projexa_sync_keys_ids"))
  rpc = pgRpc(db)
  key = await generateKeyRecord()
  const put = await rpc("projexa_sync_key_put", { p_kid: key.kid, p_public: key.public_jwk, p_private: key.private_jwk })
  expect(put.error).toBeNull()
  signing = await createSigning(key)
  await db.exec(
    [
      insert("pms_issues", [
        { id: "t1", org_id: "org-a", project_id: "proj-a", type_id: "ty", status_id: "st", number: 1, title: "Pour slab", updated_at: "2026-09-01T10:00:00.000001Z" },
        { id: "t2", org_id: "org-a", project_id: "proj-a", type_id: "ty", status_id: "st", number: 2, title: "Paint wall", updated_at: "2026-09-01T10:00:00.000002Z" },
        { id: "t3", org_id: "org-a", project_id: "proj-a", type_id: "ty", status_id: "st", number: 3, title: "Tie one", updated_at: "2026-09-01T11:00:00Z" },
        { id: "t4", org_id: "org-a", project_id: "proj-a", type_id: "ty", status_id: "st", number: 4, title: "Tie two", updated_at: "2026-09-01T11:00:00Z" },
        { id: "t5", org_id: "org-a", project_id: "proj-a", type_id: "ty", status_id: "st", number: 5, title: "Five", updated_at: "2026-09-01T12:00:00Z" },
        { id: "tx", org_id: "org-a", project_id: "proj-a2", type_id: "ty", status_id: "st", number: 1, title: "Other project", updated_at: "2026-09-01T10:00:00Z" },
        { id: "tp", org_id: "org-a", project_id: "proj-priv", type_id: "ty", status_id: "st", number: 1, title: "Private task", updated_at: "2026-09-01T10:00:00Z" },
        { id: "tb", org_id: "org-b", project_id: "proj-b", type_id: "ty", status_id: "st", number: 1, title: "B task", updated_at: "2026-09-01T10:00:00Z" },
        { id: "tw", org_id: "org-b", project_id: "proj-a", type_id: "ty", status_id: "st", number: 9, title: "Wrong org row", updated_at: "2026-09-01T10:00:00Z" },
      ]),
      insert("construction_boqs", [{ id: "boq1", org_id: "org-a", project_id: "proj-a", title: "BOQ 1", created_by_id: "u-mgr" }]),
      insert("construction_boq_line_items", [
        { id: "li1", boq_id: "boq1", org_id: "org-a", description: "Slab", unit: "cum", quantity: 10, rate: 5000, amount: 50000, created_at: "2026-09-01T09:00:00Z" },
        { id: "li2", boq_id: "boq1", org_id: "org-a", description: "Wall", unit: "sqm", quantity: 20, rate: 700, amount: 14000, created_at: "2026-09-01T09:30:00Z" },
      ]),
    ].join("\n"),
  )
}, 300_000)
afterAll(async () => {
  await db.close()
})

describe("ids: what a laptop compares with what it holds (deletes)", () => {
  test("lists exactly the ids of the person's project, never another organisation's row", async () => {
    const r = await idsOf("u-mgr", "proj-a", "tasks")
    expect(r.status).toBe(200)
    expect(r.json.ids).toEqual(["t1", "t2", "t3", "t4", "t5"])
    expect(r.json.has_more).toBe(false)
    expect(JSON.stringify(r.json)).not.toContain("tw")
    expect(JSON.stringify(r.json)).not.toContain("tb")
  })

  test("paging by id never skips or repeats", async () => {
    const seen: string[] = []
    let after: string | null = null
    for (let i = 0; i < 10; i++) {
      const r = await idsOf("u-mgr", "proj-a", "tasks", { limit: 2, after_id: after })
      expect(r.status).toBe(200)
      seen.push(...(r.json.ids as string[]))
      if (!r.json.has_more) break
      after = r.json.next_id as string
    }
    expect(seen).toEqual(["t1", "t2", "t3", "t4", "t5"])
  })

  test("a kind that joins another table (boq_lines) is scoped on the organisation and the project", async () => {
    expect((await idsOf("u-mgr", "proj-a", "boq_lines")).json.ids).toEqual(["li1", "li2"])
    expect((await idsOf("u-b", "proj-b", "boq_lines")).json.ids).toEqual([])
  })

  test("a foreign project, a private one the person may not read, a missing one and an unsupported kind are ONE answer", async () => {
    const asks = [idsOf("u-b", "proj-a", "tasks"), idsOf("u-mem", "proj-priv", "tasks"), idsOf("u-mem", "no-such", "tasks"), idsOf("u-mem", "proj-a", "no_such_kind"), idsOf("u-mem", "proj-a", "people")]
    for (const a of await Promise.all(asks)) expect(a).toEqual({ status: 404, json: { error: "Not found" } })
    expect((await idsOf("u-sen", "proj-priv", "tasks")).json.ids).toEqual(["tp"])
  })

  test("a row deleted on the server leaves the list", async () => {
    await db.exec(insert("pms_issues", [{ id: "t-gone", org_id: "org-a", project_id: "proj-a", type_id: "ty", status_id: "st", number: 99, title: "Short lived", updated_at: "2026-09-02T10:00:00Z" }]))
    expect((await idsOf("u-mgr", "proj-a", "tasks")).json.ids).toContain("t-gone")
    await db.exec(`delete from compliance.pms_issues where id = 't-gone'`)
    expect((await idsOf("u-mgr", "proj-a", "tasks")).json.ids).not.toContain("t-gone")
  })

  test("validation: limit, cursor, body, method, session", async () => {
    expect((await idsOf("u-mgr", "proj-a", "tasks", { limit: 0 })).status).toBe(400)
    expect((await idsOf("u-mgr", "proj-a", "tasks", { limit: 5001 })).status).toBe(400)
    expect((await idsOf("u-mgr", "proj-a", "tasks", { limit: 1.5 })).status).toBe(400)
    expect((await idsOf("u-mgr", "proj-a", "tasks", { after_id: "bad id!" })).status).toBe(400)
    expect((await hit("u-mgr", "ids", { kind: "tasks" })).status).toBe(400)
    expect((await hit("u-mgr", "ids", undefined, { method: "GET" })).status).toBe(405)
    expect((await hit(null, "ids", { project_id: "proj-a", kind: "tasks" })).status).toBe(401)
    expect((await hit(NOBODY(), "ids", { project_id: "proj-a", kind: "tasks" })).status).toBe(403)
  })
})
const NOBODY = () => "99999999-9999-4999-8999-999999999999"

describe("view class and manifest", () => {
  test("the manifest carries a 16 hex view class and says deletes are supported", async () => {
    const r = await hit("u-mgr", "manifest")
    expect(r.status).toBe(200)
    expect(r.json.view_class).toMatch(/^[0-9a-f]{16}$/)
    for (const k of r.json.kinds as J[]) expect(k.deletes_supported).toBe(true)
  })

  test("a role that sees cost and one that does not are different classes; the same role twice is one class", async () => {
    const mgr = (await hit("u-mgr", "manifest")).json.view_class
    const sen = (await hit("u-sen", "manifest")).json.view_class
    const mgrAgain = (await hit("u-mgr", "manifest")).json.view_class
    expect(mgr).not.toBe(sen)
    expect(mgrAgain).toBe(mgr)
  })
})

describe("signing keys", () => {
  test("exactly one active key; a second put does not replace it", async () => {
    const other = await generateKeyRecord()
    const r = await rpc("projexa_sync_key_put", { p_kid: other.kid, p_public: other.public_jwk, p_private: other.private_jwk })
    expect((r.data as J).kid).toBe(key.kid)
    const active = (await rpc("projexa_sync_key_active")).data as J
    expect(active.kid).toBe(key.kid)
  })

  test("the public list never carries a private part", async () => {
    const list = (await rpc("projexa_sync_public_keys")).data as J[]
    expect(list.length).toBe(1)
    expect(list[0].active).toBe(true)
    expect(JSON.stringify(list)).not.toContain('"d"')
  })

  test("a malformed key is refused with AW400", async () => {
    const good = await generateKeyRecord()
    const cases: Array<Record<string, unknown>> = [
      { p_kid: "short", p_public: good.public_jwk, p_private: good.private_jwk },
      { p_kid: good.kid, p_public: good.public_jwk, p_private: { ...good.private_jwk, d: undefined } },
      { p_kid: good.kid, p_public: good.private_jwk, p_private: good.private_jwk },
      { p_kid: good.kid, p_public: { ...good.public_jwk, crv: "P-384" }, p_private: good.private_jwk },
    ]
    for (const c of cases) {
      const r = await rpc("projexa_sync_key_put", c)
      expect(r.error?.code).toBe("AW400")
    }
  })

  test("rotation retires the active key, keeps its public half verifiable and lets a new key become active", async () => {
    const old = key
    expect((await rpc("projexa_sync_key_rotate")).data).toBe(1)
    expect((await rpc("projexa_sync_key_active")).data).toBeNull()
    const next = await generateKeyRecord()
    expect(((await rpc("projexa_sync_key_put", { p_kid: next.kid, p_public: next.public_jwk, p_private: next.private_jwk })).data as J).kid).toBe(next.kid)
    const list = (await rpc("projexa_sync_public_keys")).data as J[]
    expect(list.map((k) => k.kid).sort()).toEqual([old.kid, next.kid].sort())
    expect(list.find((k) => k.kid === old.kid)?.active).toBe(false)
    // put the original key back as the active signer for the rest of the file
    await db.exec(`delete from platform.projexa_sync_key`)
    expect(((await rpc("projexa_sync_key_put", { p_kid: old.kid, p_public: old.public_jwk, p_private: old.private_jwk })).data as J).kid).toBe(old.kid)
  })
})

describe("signed rows", () => {
  async function pullSigned(user: string, project: string, kind: string) {
    const r = await hit(user, "pull", { project_id: project, kind, after: null, limit: 200 })
    expect(r.status).toBe(200)
    return r.json
  }
  const pub = () => importPublic(key.public_jwk)

  test("every row carries a signature that verifies against the published key", async () => {
    const page = await pullSigned("u-mgr", "proj-a", "tasks")
    expect(page.kid).toBe(key.kid)
    expect((page.items as J[]).length).toBeGreaterThanOrEqual(5)
    const k = await pub()
    for (const it of page.items as J[]) {
      expect(typeof it.sig).toBe("string")
      const hash = await sha256Hex(canonicalize(it.data))
      const msg = itemMessage({ org: "org-a", project: "proj-a", kind: "tasks", id: it.id, updatedAt: it.updated_at, dataHash: hash })
      expect(await verifyMessage(k, msg, it.sig)).toBe(true)
    }
  })

  test("a changed row, project, kind, id, timestamp or organisation fails verification", async () => {
    const page = await pullSigned("u-mgr", "proj-a", "tasks")
    const it = (page.items as J[])[0]
    const k = await pub()
    const base = { org: "org-a", project: "proj-a", kind: "tasks", id: it.id as string, updatedAt: it.updated_at as string, dataHash: await sha256Hex(canonicalize(it.data)) }
    expect(await verifyMessage(k, itemMessage(base), it.sig)).toBe(true)
    const tamperedData = { ...(it.data as object), title: "Changed by a peer" }
    for (const bad of [
      { ...base, dataHash: await sha256Hex(canonicalize(tamperedData)) },
      { ...base, project: "proj-a2" },
      { ...base, kind: "rfis" },
      { ...base, id: "other" },
      { ...base, updatedAt: "2026-12-31T00:00:00.000000Z" },
      { ...base, org: "org-b" },
    ]) {
      expect(await verifyMessage(k, itemMessage(bad), it.sig)).toBe(false)
    }
  })

  test("a signature from a different key does not verify", async () => {
    const page = await pullSigned("u-mgr", "proj-a", "tasks")
    const it = (page.items as J[])[0]
    const stranger = await generateKeyRecord()
    const msg = itemMessage({ org: "org-a", project: "proj-a", kind: "tasks", id: it.id as string, updatedAt: it.updated_at as string, dataHash: await sha256Hex(canonicalize(it.data)) })
    expect(await verifyMessage(await importPublic(stranger.public_jwk), msg, it.sig)).toBe(false)
  })

  test("the signature is over the row AS SENT: a person who sees less gets rows signed for what they see", async () => {
    const mgr = await pullSigned("u-mgr", "proj-a", "boq_lines")
    const sen = await pullSigned("u-sen", "proj-a", "boq_lines")
    const m = (mgr.items as J[]).find((i) => i.id === "li1")!
    const s = (sen.items as J[]).find((i) => i.id === "li1")!
    expect(JSON.stringify(m.data)).not.toBe(JSON.stringify(s.data))
    expect(m.sig).not.toBe(s.sig)
  })

  test("without a signing key the rows are returned unsigned and kid is null (a laptop will not pass them on)", async () => {
    const r = await hit("u-mgr", "pull", { project_id: "proj-a", kind: "tasks", after: null, limit: 200 }, { signed: false })
    expect(r.status).toBe(200)
    expect(r.json.kid).toBeNull()
    for (const it of r.json.items as J[]) expect(it.sig).toBeUndefined()
  })
})

describe("attestation for peer laptops", () => {
  test("a signed token states organisation, projects and view class, and expires in ten minutes", async () => {
    const r = await hit("u-mgr", "attest", {})
    expect(r.status).toBe(200)
    const [head, body, sig] = (r.json.token as string).split(".")
    const header = JSON.parse(new TextDecoder().decode(fromB64url(head)))
    const payload = JSON.parse(new TextDecoder().decode(fromB64url(body)))
    expect(header).toEqual({ alg: "ES256", typ: "px-peer", kid: key.kid })
    expect(payload.typ).toBe("px-peer")
    expect(payload.org).toBe("org-a")
    expect(payload.sub).toBe("u-mgr")
    expect(payload.projects).toContain("proj-a")
    expect(payload.projects).not.toContain("proj-b")
    expect(payload.view).toBe((await hit("u-mgr", "manifest")).json.view_class)
    expect(payload.exp - payload.iat).toBe(600)
    expect(payload.iat).toBe(Math.floor(NOW.getTime() / 1000))
    expect(await verifyMessage(await importPublic(key.public_jwk), `${head}.${body}`, sig)).toBe(true)
    expect(await verifyMessage(await importPublic(key.public_jwk), `${head}.${body}x`, sig)).toBe(false)
    expect((r.json.public_keys as J[]).map((k) => k.kid)).toEqual([key.kid])
    expect(r.json.channel).toMatch(/^[0-9a-f]{32}$/)
  })

  test("the channel is stable inside one organisation and different across organisations", async () => {
    const a1 = (await hit("u-mgr", "attest", {})).json.channel
    const a2 = (await hit("u-mem", "attest", {})).json.channel
    const b = (await hit("u-b", "attest", {})).json.channel
    expect(a1).toBe(a2)
    expect(b).not.toBe(a1)
  })

  test("a private project is not in the token of a person who may not read it", async () => {
    const mem = JSON.parse(new TextDecoder().decode(fromB64url(((await hit("u-mem", "attest", {})).json.token as string).split(".")[1])))
    const sen = JSON.parse(new TextDecoder().decode(fromB64url(((await hit("u-sen", "attest", {})).json.token as string).split(".")[1])))
    expect(mem.projects).not.toContain("proj-priv")
    expect(sen.projects).toContain("proj-priv")
  })

  test("503 when there is no signing key, 401 without a session", async () => {
    expect((await hit("u-mgr", "attest", {}, { signed: false })).status).toBe(503)
    expect((await hit(null, "attest", {})).status).toBe(401)
  })
})

describe("canonical JSON vectors (the laptop asserts the same constants)", () => {
  test("the canonical text and its SHA-256 are fixed", async () => {
    expect(canonicalize(TEST_VECTOR.value)).toBe(TEST_VECTOR.canonical)
    expect(await sha256Hex(TEST_VECTOR.canonical)).toBe(TEST_VECTOR.sha256)
  })
  test("key order does not change the canonical text; array order does", () => {
    expect(canonicalize({ a: 1, b: 2 })).toBe(canonicalize({ b: 2, a: 1 }))
    expect(canonicalize([1, 2])).not.toBe(canonicalize([2, 1]))
  })
})
