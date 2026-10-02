/// <reference types="bun-types" />
// PROJEXA SYNC: the WHOLE chain together (tests:F18). Every other suite builds a partial chain; this one applies 0618, 0677, 0678, 0679, 0680, 0681, 0682, 0683, 0684
// and 0686 in number order on an empty PGlite (the organisation master tables created before 0684, as live), then:
//   * every route answers once through the REAL Edge handler, for a manager, a member and a viewer
//   * the catalog of every function and table of the chain (tests:F04): nothing for anon / authenticated / app_runtime / PUBLIC, no helper ('__') for service_role,
//     every SECURITY DEFINER function pins search_path, every platform.projexa_* table forces row level security and grants nothing
//   * the down files in strict reverse order (0686 .. 0678) leave exactly 0677's objects, and the 0677 pull still answers
//   * the forward files applied again (twice) give the same catalog and a working tracker, feed and poll
// Run: bun test --isolate src/lib/services/projexa-sync-chain.pglite.test.ts
import { describe, test, expect, beforeAll, afterAll, setDefaultTimeout } from "bun:test"
import type { PGlite } from "@electric-sql/pglite"
import { handleSync, RateLimiter, type Rpc } from "../../../supabase/functions/projexa-sync/handler"
import type { SessionVerifier } from "../../../supabase/functions/ai-work-link/session"
import { createSigning, generateKeyRecord, type Signing } from "../../../supabase/functions/projexa-sync/sign"
import { downSql, forwardSql } from "./__test-helpers__/awl-pglite"
import { createUserLinkDb, type J } from "./__test-helpers__/awl-user-link-db"
import { insert, pgRpc } from "./__test-helpers__/awl-records-v2-db"
import { FIXTURE, MASTER_TABLES, SUBS } from "./__test-helpers__/projexa-org-fixture"

setDefaultTimeout(300_000)

const CHAIN = ["0678_projexa_sync_keys_ids", "0679_projexa_record_versions", "0680_projexa_release_registry", "0681_projexa_sync_push", "0682_projexa_work_jobs",
  "0683_projexa_sync_more_kinds", "0684_projexa_sync_org_masters", "0686_projexa_sync_hardening"]
const NOW = new Date("2026-10-02T00:00:00Z")
let db: PGlite
let rpc: Rpc
let signing: Signing
const session: SessionVerifier = async (token) => (token.startsWith("tok:") ? { ok: true, sub: token.slice(4), email: null, issuer: "test", iat: null } : { ok: false, reason: "invalid" })
async function hit(user: string, path: string, body?: unknown) {
  const req = new Request(`https://x.supabase.co/functions/v1/projexa-sync/${path}`, { method: body === undefined ? "GET" : "POST", headers: { authorization: `Bearer tok:${SUBS[user]}` }, body: body === undefined ? undefined : JSON.stringify(body) })
  const res = await handleSync(req, { rpc, session, limiter: new RateLimiter(100000), now: () => NOW, signing: async () => signing })
  return { status: res.status, json: (await res.json()) as J }
}
const q = async <T = J>(sql: string) => (await db.query<T>(sql)).rows

async function applyForward() {
  for (const m of CHAIN) {
    if (m.startsWith("0684")) await db.exec(MASTER_TABLES)
    await db.exec(forwardSql(m))
  }
}

/** The catalog rules for every object of the chain (tests:F04). Returns the offending objects (empty = clean). */
async function catalogDefects(): Promise<string[]> {
  const fns = await q(`select p.oid::regprocedure::text sig, p.proname, p.prosecdef, p.proconfig,
                              has_function_privilege('anon', p.oid, 'EXECUTE') anon, has_function_privilege('authenticated', p.oid, 'EXECUTE') auth,
                              has_function_privilege('app_runtime', p.oid, 'EXECUTE') app, has_function_privilege('service_role', p.oid, 'EXECUTE') svc,
                              exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0 and a.privilege_type = 'EXECUTE') pub
                       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                       where n.nspname in ('public', 'platform') and (p.proname like 'projexa\\_sync%' or p.proname like 'projexa\\_track%' or p.proname like 'projexa\\_prune%'
                             or p.proname like 'projexa\\_release%' or p.proname like 'projexa\\_job%' or p.proname like 'projexa\\_tracking%' or p.proname like 'projexa\\_client%')`)
  const bad: string[] = []
  for (const f of fns) {
    if (f.anon || f.auth || f.app || f.pub) bad.push(`${f.sig}: callable by a client role or PUBLIC`)
    if (f.svc && String(f.proname).includes("__")) bad.push(`${f.sig}: a helper callable by service_role`)
    if (f.prosecdef && !((f.proconfig ?? []) as string[]).some((c) => c.startsWith("search_path="))) bad.push(`${f.sig}: SECURITY DEFINER without a pinned search_path`)
  }
  const tables = await q(`select c.relname, c.relrowsecurity rls, c.relforcerowsecurity force,
                                 has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE') anon, has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE') auth,
                                 has_table_privilege('app_runtime', c.oid, 'SELECT,INSERT,UPDATE,DELETE') app, has_table_privilege('service_role', c.oid, 'SELECT,INSERT,UPDATE,DELETE') svc
                          from pg_class c join pg_namespace n on n.oid = c.relnamespace
                          where n.nspname = 'platform' and c.relkind = 'r' and c.relname like 'projexa\\_%' and c.relname <> 'projexa_gateway_settings'`)
  for (const t of tables) if (!t.rls || !t.force || t.anon || t.auth || t.app || t.svc) bad.push(`platform.${t.relname}: row level security not forced or a role has a privilege`)
  return bad
}

beforeAll(async () => {
  db = await createUserLinkDb()
  await db.exec(forwardSql("0618_build001_projexa_gateway"))
  await db.exec(forwardSql("0677_projexa_sync_read"))
  await applyForward()
  await db.exec(FIXTURE)
  await db.exec(insert("pms_issues", [{ id: "ch-t1", org_id: "org-a", project_id: "proj-a", type_id: "ty", status_id: "st", number: 1, title: "Chain task", updated_at: "2026-09-01T10:00:00Z" }]))
  rpc = pgRpc(db)
  const key = await generateKeyRecord()
  await rpc("projexa_sync_key_put", { p_kid: key.kid, p_public: key.public_jwk, p_private: key.private_jwk })
  signing = await createSigning(key)
}, 600_000)
afterAll(async () => {
  await db.close()
})

describe("the whole chain, applied together in order", () => {
  test("every route answers through the real handler, for a manager, a member and a viewer", async () => {
    for (const u of ["u-mgr", "u-mem", "u-view"]) {
      const m = await hit(u, "manifest")
      expect([u, "manifest", m.status, (m.json.kinds as J[]).length]).toEqual([u, "manifest", 200, 28])
      expect([u, "heads", (await hit(u, "heads")).status]).toEqual([u, "heads", 200])
      expect([u, "pull", (await hit(u, "pull", { project_id: "proj-a", kind: "tasks", after: null, limit: 10 })).status]).toEqual([u, "pull", 200])
      expect([u, "pull ids", (await hit(u, "pull", { project_id: "proj-a", kind: "tasks", ids: ["ch-t1"] })).status]).toEqual([u, "pull ids", 200])
      expect([u, "ids", (await hit(u, "ids", { project_id: "proj-a", kind: "roster" })).status]).toEqual([u, "ids", 200])
      expect([u, "digest", (await hit(u, "ids", { project_id: "proj-a", kinds: ["roster", "tasks"], digest: true })).status]).toEqual([u, "digest", 200])
      expect([u, "changes", (await hit(u, "changes", { project_id: "proj-a", after_seq: 0 })).status]).toEqual([u, "changes", 200])
      expect([u, "org changes", (await hit(u, "changes", { project_id: "__org__", after_seq: 0 })).status]).toEqual([u, "org changes", 200])
      expect([u, "org pull", (await hit(u, "pull", { kind: "cost_visibility", after: null, limit: 10 })).status]).toEqual([u, "org pull", 200])
      expect([u, "attest", (await hit(u, "attest", {})).status]).toEqual([u, "attest", 200])
      expect([u, "release/current", (await hit(u, "release/current")).status]).toEqual([u, "release/current", 200])
    }
    // the member may read vendors, the viewer may not (the role gate), and a member can enqueue a job and a manager claim it
    expect((await hit("u-mem", "pull", { kind: "vendors", after: null, limit: 10 })).status).toBe(200)
    expect((await hit("u-view", "pull", { kind: "vendors", after: null, limit: 10 })).status).toBe(404)
    expect((await hit("u-mgr", "jobs/enqueue", { project_id: "proj-a", type: "boq_rollup", params: { boqId: "boq1" } })).status).toBe(200)
    expect((await hit("u-mgr", "jobs/claim", { device_id: "chain-device-01", types: ["boq_rollup"] })).status).toBe(200)
    // a push without the exec function wired is a clean 503, not a crash
    expect((await hit("u-mgr", "push", { device_id: "chain-device-01", ops: [] })).status).toBeGreaterThanOrEqual(400)
    // the tracker works across the chain
    expect((await q(`select platform.projexa_tracking_health() h`))[0].h.ok).toBe(true)
  })

  test("the catalog of every function and table of the chain is clean (tests:F04)", async () => {
    expect(await catalogDefects()).toEqual([])
  })

  test("the down files in strict reverse order leave exactly 0677's objects; the 0677 pull still answers; the forward files twice restore everything", async () => {
    for (const m of [...CHAIN].reverse()) await db.exec(downSql(m))
    expect((await q(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                     where n.nspname in ('public', 'platform') and p.proname like 'projexa\\_%' and p.proname not like 'projexa\\_read%' order by 1`)).map((r) => r.proname))
      .toEqual(["projexa_sync__ctx", "projexa_sync__cursor_field", "projexa_sync__src", "projexa_sync_manifest", "projexa_sync_pull"])
    expect((await q(`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'platform' and c.relkind = 'r' and c.relname like 'projexa\\_%' order by 1`)).map((r) => r.relname))
      .toEqual(["projexa_gateway_settings"])
    expect((await q(`select count(*)::int n from pg_trigger where tgname like 'projexa_track%'`))[0].n).toBe(0)
    const p = await hit("u-mgr", "pull", { project_id: "proj-a", kind: "tasks", after: null, limit: 10 })
    expect([p.status, (p.json.items as J[]).map((i) => i.id)]).toEqual([200, ["ch-t1"]])

    await applyForward()
    await applyForward()
    expect(await catalogDefects()).toEqual([])
    expect((await q(`select count(*)::int n from pg_trigger where tgname like 'projexa_track%'`))[0].n).toBe(3 * 37)
    const key = await generateKeyRecord()
    await rpc("projexa_sync_key_put", { p_kid: key.kid, p_public: key.public_jwk, p_private: key.private_jwk })
    signing = await createSigning(key)
    const before = (await hit("u-mgr", "heads")).json.heads["proj-a"] as number
    await db.exec(`update compliance.pms_issues set title = 'After the round trip' where id = 'ch-t1'`)
    const after = (await hit("u-mgr", "heads")).json.heads["proj-a"] as number
    expect(after).toBeGreaterThan(before)
    expect(((await hit("u-mgr", "changes", { project_id: "proj-a", after_seq: before })).json.changes as J[]).map((c) => [c.id, c.version, c.op])).toEqual([["ch-t1", 1, "U"]])
    expect((await q(`select platform.projexa_tracking_health() h`))[0].h.ok).toBe(true)
  })
})
