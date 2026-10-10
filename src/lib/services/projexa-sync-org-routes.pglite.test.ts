/// <reference types="bun-types" />
// PROJEXA SYNC, ORGANISATION KINDS OVER HTTP: drizzle/0684 on PGlite and the REAL Edge handler (supabase/functions/projexa-sync/handler.ts). The SQL rules (scope, role gate, column allow-list,
// versions) are projexa-sync-org-masters.pglite.test.ts's; what is proven here is that they REACH a laptop through the routes with the right wire format:
//   * manifest:   org_kinds (only what the role may read) and org_view_class; the 28 project kinds are unchanged
//   * pull:       POST /pull {kind} with no project (absent, null or "__org__"): keyset pages that never skip or repeat, every item with a version and a signature that verifies over
//                 px2|org|__org__|kind|id|version|updated_at|hash, the page's kid; the exact-ids mode; a real project id for an organisation kind is the ONE 404
//   * isolation:  organisation B's person gets only B's rows; a viewer gets the one 404 for restricted masters; the project routes cannot be pointed at "__org__"
//   * ids/changes: the id inventory and the organisation feed (project "__org__": updates, tombstones, only the kinds the role may read)
// Run: bun test --isolate src/lib/services/projexa-sync-org-routes.pglite.test.ts
import { describe, test, expect, beforeAll, afterAll, setDefaultTimeout } from "bun:test"
import type { PGlite } from "@electric-sql/pglite"
import { handleSync, ORG_KINDS as EDGE_ORG_KINDS, RateLimiter, SYNC_KINDS, type Rpc } from "../../../supabase/functions/projexa-sync/handler"
import type { SessionVerifier } from "../../../supabase/functions/ai-work-link/session"
import { canonicalize, createSigning, generateKeyRecord, importPublic, itemMessage, sha256Hex, verifyMessage, type KeyRecord, type Signing } from "../../../supabase/functions/projexa-sync/sign"
import type { J } from "./__test-helpers__/awl-user-link-db"
import { pgRpc } from "./__test-helpers__/awl-records-v2-db"
import { build, ORG_KINDS, OWN_A, RANK2, SUBS } from "./__test-helpers__/projexa-org-fixture"

setDefaultTimeout(240_000)
const NOW = new Date("2026-10-02T00:00:00Z")

let db: PGlite
let rpc: Rpc
let key: KeyRecord
let signing: Signing
const session: SessionVerifier = async (token) => (token.startsWith("tok:") ? { ok: true, sub: token.slice(4), email: null, issuer: "test", iat: null } : { ok: false, reason: "invalid" })

async function hit(user: string, path: string, body?: unknown) {
  const req = new Request(`https://x.supabase.co/functions/v1/projexa-sync/${path}`, { method: body === undefined ? "GET" : "POST", headers: { authorization: `Bearer tok:${SUBS[user]}` }, body: body === undefined ? undefined : JSON.stringify(body) })
  const res = await handleSync(req, { rpc, session, limiter: new RateLimiter(100000), now: () => NOW, signing: async () => signing })
  return { status: res.status, json: (await res.json()) as J }
}
const pull = (user: string, kind: string, extra: Record<string, unknown> = {}) => hit(user, "pull", { kind, after: null, limit: 200, ...extra })
const idsOf = async (user: string, kind: string) => ((await pull(user, kind)).json.items as J[]).map((i) => i.id as string).sort()
const ONE_404 = { status: 404, json: { error: "Not found" } }

beforeAll(async () => {
  db = await build()
  rpc = pgRpc(db)
  key = await generateKeyRecord()
  await rpc("projexa_sync_key_put", { p_kid: key.kid, p_public: key.public_jwk, p_private: key.private_jwk })
  signing = await createSigning(key)
}, 300_000)
afterAll(async () => {
  await db.close()
})

describe("the lists", () => {
  test("the Edge list of organisation kinds is the SQL list, in the same order, and disjoint from the project kinds", async () => {
    const sql = (await db.query<J>(`select unnest(public.projexa_sync__org_kinds()) k`)).rows.map((r) => r.k)
    // this fixture stops at 0684 (9 kinds); 0691 appends to the same list, so the Edge list starts with exactly these (the full list is checked in projexa-sync-erp-hr-kinds.pglite.test.ts)
    expect(sql).toEqual([...EDGE_ORG_KINDS].slice(0, sql.length))
    expect([...EDGE_ORG_KINDS].slice(0, ORG_KINDS.length)).toEqual([...ORG_KINDS])
    for (const k of EDGE_ORG_KINDS) expect((SYNC_KINDS as readonly string[]).includes(k)).toBe(false)
  })

  test("manifest: a member sees all 9 organisation kinds, a viewer only cost_visibility; org_view_class differs between them; the project kinds are unchanged", async () => {
    const mem = (await hit("u-mem", "manifest")).json
    expect((mem.org_kinds as J[]).map((k) => k.kind)).toEqual([...ORG_KINDS])
    for (const k of mem.org_kinds as J[]) expect(k).toMatchObject({ project_scoped: false, deletes_supported: true })
    expect((mem.kinds as J[]).map((k) => k.kind)).toEqual([...SYNC_KINDS])
    const view = (await hit("u-view", "manifest")).json
    expect((view.org_kinds as J[]).map((k) => k.kind)).toEqual(["cost_visibility"])
    expect(mem.org_view_class).toMatch(/^[0-9a-f]{16}$/)
    expect(view.org_view_class).not.toBe(mem.org_view_class)
  })
})

describe("POST /pull for an organisation kind", () => {
  for (const kind of RANK2) {
    test(`${kind}: exactly the organisation's rows with a version and a signature, with no project in the request`, async () => {
      const r = await pull("u-mem", kind)
      expect(r.status).toBe(200)
      expect((r.json.items as J[]).map((i) => i.id).sort()).toEqual(OWN_A[kind])
      expect(r.json.kid).toBe(key.kid)
      for (const it of r.json.items as J[]) {
        expect(typeof it.version).toBe("number")
        expect(typeof it.sig).toBe("string")
      }
      expect(JSON.stringify(r.json)).not.toContain("SECRET")
    })
  }

  test("signature: it verifies over the px2 message with the sentinel project, and not with a project id, another kind or another version", async () => {
    const r = await pull("u-mem", "vendors")
    const it = (r.json.items as J[])[0]
    const pub = await importPublic(key.public_jwk)
    const base = { org: "org-a", project: "__org__", kind: "vendors", id: it.id as string, version: it.version as number, updatedAt: it.updated_at as string, dataHash: await sha256Hex(canonicalize(it.data)) }
    expect(await verifyMessage(pub, itemMessage(base), it.sig)).toBe(true)
    for (const bad of [{ ...base, project: "proj-a" }, { ...base, kind: "customers" }, { ...base, version: base.version + 1 }, { ...base, org: "org-b" }]) expect(await verifyMessage(pub, itemMessage(bad), it.sig)).toBe(false)
  })

  test("paging: limit 1 walks every row exactly once, in the same order as one big page", async () => {
    const all = ((await pull("u-mem", "vendors")).json.items as J[]).map((i) => i.id)
    const seen: string[] = []
    let after: string | null = null
    for (let i = 0; i < 10; i++) {
      const r = await pull("u-mem", "vendors", { after, limit: 1 })
      for (const it of r.json.items as J[]) seen.push(it.id)
      after = (r.json.next_cursor as string | null) ?? after
      if (!r.json.has_more) break
    }
    expect(seen).toEqual(all)
  })

  test("the sentinel and null are accepted as 'no project'; a real project id for an organisation kind is the ONE 404", async () => {
    expect((await pull("u-mem", "vendors", { project_id: "__org__" })).status).toBe(200)
    expect((await pull("u-mem", "vendors", { project_id: null })).status).toBe(200)
    expect(await pull("u-mem", "vendors", { project_id: "proj-a" })).toEqual(ONE_404)
  })

  test("exact ids: the asked rows only, a decoy id of another organisation is absent; validation", async () => {
    const r = await hit("u-mem", "pull", { kind: "vendors", ids: ["ven-1", "SECRET-ven-b", "nope"] })
    expect((r.json.items as J[]).map((i) => i.id)).toEqual(["ven-1"])
    expect((await hit("u-mem", "pull", { kind: "vendors", ids: [] })).status).toBe(400)
    expect((await hit("u-mem", "pull", { kind: "vendors", ids: ["bad id!"] })).status).toBe(400)
    expect((await hit("u-mem", "pull", { kind: "vendors", ids: "ven-1" })).status).toBe(400)
    expect((await pull("u-mem", "vendors", { limit: 0 })).status).toBe(400)
    expect((await pull("u-mem", "vendors", { after: "not a cursor" })).status).toBe(400)
  })

  test("isolation: organisation B's person gets only B's rows; a viewer / client_viewer gets the one 404 for restricted masters but may read cost_visibility", async () => {
    expect(await idsOf("u-b", "vendors")).toEqual(["SECRET-ven-b"])
    expect(await idsOf("u-b", "customers")).toEqual(["SECRET-cus-b"])
    for (const kind of RANK2) {
      expect([kind, await pull("u-view", kind)]).toEqual([kind, ONE_404])
      expect([kind, await pull("u-cv", kind)]).toEqual([kind, ONE_404])
    }
    expect((await pull("u-view", "cost_visibility")).status).toBe(200)
  })

  test("the project routes cannot be pointed at the organisation feed, and an unknown kind is not served", async () => {
    expect(await hit("u-mem", "pull", { project_id: "__org__", kind: "tasks", after: null, limit: 5 })).toEqual(ONE_404)
    expect((await hit("u-mem", "pull", { kind: "vendorz", after: null, limit: 5 })).status).toBe(400) // no project and not an organisation kind
    expect(await hit("u-mem", "pull", { project_id: "proj-a", kind: "vendorz", after: null, limit: 5 })).toEqual(ONE_404)
  })
})

describe("the id inventory and the organisation feed", () => {
  test("ids: the organisation's rows for a member; the one 404 for a viewer or a real project; validation", async () => {
    const r = await hit("u-mem", "ids", { kind: "companies" })
    expect(r.json.ids).toEqual(["co-1", "co-2"])
    expect(await hit("u-view", "ids", { kind: "companies" })).toEqual(ONE_404)
    expect(await hit("u-mem", "ids", { kind: "companies", project_id: "proj-a" })).toEqual(ONE_404)
    expect((await hit("u-mem", "ids", { kind: "companies", limit: 0 })).status).toBe(400)
    expect((await hit("u-mem", "ids", { kind: "companies", after_id: "bad id!" })).status).toBe(400)
    expect((await hit("u-b", "ids", { kind: "companies" })).json.ids).toEqual(["SECRET-co-b"])
  })

  test("changes with project '__org__': head first, then an update and a tombstone in order; a viewer never learns of a vendor or a company change", async () => {
    const first = await hit("u-mem", "changes", { project_id: "__org__", after_seq: null })
    expect(first.status).toBe(200)
    expect(first.json.changes).toEqual([])
    const head = first.json.head_seq as number
    await db.exec(`update compliance.erp_suppliers set supplier_name = 'Ace Cement Ltd' where id = 'ven-1'`)
    await db.exec(`delete from compliance.erp_companies where id = 'co-2'`)
    const next = await hit("u-mem", "changes", { project_id: "__org__", after_seq: head })
    expect((next.json.changes as J[]).map((c) => [c.kind, c.id, c.op])).toEqual([["vendors", "ven-1", "U"], ["companies", "co-2", "D"]])
    const v = await hit("u-view", "changes", { project_id: "__org__", after_seq: head })
    expect(JSON.stringify(v.json)).not.toContain("ven-1")
    expect(JSON.stringify(v.json)).not.toContain("co-2")
    // the new version is what a pull of that row now carries
    const row = ((await hit("u-mem", "pull", { kind: "vendors", ids: ["ven-1"] })).json.items as J[])[0]
    expect(row.version).toBe(2)
    expect(await idsOf("u-mem", "companies")).toEqual(["co-1"])
  })

  test("changes: the organisation feed of another organisation is its own (B never sees A's tombstone), and validation", async () => {
    const b = await hit("u-b", "changes", { project_id: "__org__", after_seq: 0 })
    expect(JSON.stringify(b.json)).not.toContain("co-2")
    expect((await hit("u-mem", "changes", { project_id: "__org__", after_seq: -1 })).status).toBe(400)
    expect((await hit("u-mem", "changes", { project_id: "__org__", after_seq: 0, limit: 0 })).status).toBe(400)
  })
})
