/// <reference types="bun-types" />
// PROJEXA SYNC: the version / change-feed machinery over the WHOLE chain (0677, 0678, 0679, 0683, 0684, 0686) on PGlite, built the way the live database is
// (projexa-org-fixture), with the real Edge handler where a route is involved. What the independent review found and what is proven here:
//   * every table:    all 37 tracked tables (28 project kinds, 9 organisation kinds) have EXACTLY their three statement-level triggers, and an insert, an update
//                     and a delete of a fresh row of each give version 1 / 2 / a tombstone under the right project (tests:F08)
//   * not a project:  a DPDP document (linked to something else) writes no head and no log, through insert, update and delete, and the write succeeds
//   * leaving:        a record moved to another project is a tombstone in the project it left and an update in the new one; an unlinked document, a MoM that
//                     stops being about a project and an archived wiki page are tombstones; a cascade child that was never tracked gets its tombstone (sync:SYNC-07)
//   * the hash:       a touch of updated_at alone is not a version; a change to a column a laptop does not receive IS (the documented decision, sync:SYNC-14)
//   * health:         platform.projexa_tracking_health() is ok on a healthy database and NOT ok when a trigger is disabled or missing, when the log refuses writes,
//                     or when tracking errors were counted (sql:SQL-08)
//   * retention:      the prune functions delete old history, raise the floor, and a laptop below the floor is told reset_required (sql:SQL-06, sync:SYNC-10)
//   * one poll:       /heads answers every readable project's head and the organisation's in one call, and its view classes change with a role change and a
//                     cost-visibility change, as do the manifest's and every page's (requirements:F2, F11)
//   * digest:         the /ids digest equals the laptop's own computation and moves on a delete; /ids carries the version of every id (requirements:F6, sync:SYNC-08)
//   * cost:           a 2,000-row insert in one statement consumes TWO transaction ids (its own and one subtransaction; not one per row) (sql:SQL-01, sync:SYNC-06)
//   * grants:         every function and table of 0678-0686: nothing for anon / authenticated / app_runtime / PUBLIC, service_role only for the entry points, every
//                     SECURITY DEFINER function has a pinned search_path, every table forces row level security; the log cannot be changed by service_role (tests:F04, F11)
// Run: bun test --isolate src/lib/services/projexa-sync-tracking.pglite.test.ts
import { describe, test, expect, beforeAll, afterAll, setDefaultTimeout } from "bun:test"
import { createHash } from "node:crypto"
import type { PGlite } from "@electric-sql/pglite"
import { handleSync, RateLimiter, type Rpc } from "../../../supabase/functions/projexa-sync/handler"
import type { SessionVerifier } from "../../../supabase/functions/ai-work-link/session"
import { forwardSql } from "./__test-helpers__/awl-pglite"
import type { J } from "./__test-helpers__/awl-user-link-db"
import { pgRpc } from "./__test-helpers__/awl-records-v2-db"
import { SUBS, build } from "./__test-helpers__/projexa-org-fixture"
import { TRACKED, editableColumn, insertSql, minimalRow } from "./__test-helpers__/projexa-track-fixture"

setDefaultTimeout(240_000)

let db: PGlite
let rpc: Rpc
const NOW = new Date("2026-10-02T00:00:00Z")
const session: SessionVerifier = async (token) => (token.startsWith("tok:") ? { ok: true, sub: token.slice(4), email: null, issuer: "test", iat: null } : { ok: false, reason: "invalid" })
async function hit(user: string, path: string, body?: unknown) {
  const req = new Request(`https://x.supabase.co/functions/v1/projexa-sync/${path}`, { method: body === undefined ? "GET" : "POST", headers: { authorization: `Bearer tok:${SUBS[user]}` }, body: body === undefined ? undefined : JSON.stringify(body) })
  const res = await handleSync(req, { rpc, session, limiter: new RateLimiter(100000), now: () => NOW })
  return { status: res.status, json: (await res.json()) as J }
}
const q = async <T = J>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows
const head = async (kind: string, id: string) => {
  const r = (await q(`select version, deleted, project_id from platform.projexa_record_head where kind = $1 and record_id = $2`, [kind, id]))[0]
  return r ? { version: Number(r.version), deleted: r.deleted as boolean, project_id: r.project_id as string } : undefined
}
const log = async (kind: string, id: string) => (await q(`select project_id, version, op from platform.projexa_change_log where kind = $1 and record_id = $2 order by seq`, [kind, id])).map((r) => [r.project_id, Number(r.version), r.op])
const feedHead = async (user: string, project: string) => (await hit(user, "changes", { project_id: project, after_seq: null })).json.head_seq as number
const feedSince = async (user: string, project: string, after: number) => (await hit(user, "changes", { project_id: project, after_seq: after })).json

beforeAll(async () => {
  db = await build()
  await db.exec(forwardSql("0686_projexa_sync_hardening"))
  rpc = pgRpc(db)
  // parents for the kinds whose project comes through another row
  await db.exec(insertSql("construction_boqs", await minimalRow(db, "construction_boqs", { id: "trk-boq", org_id: "org-a", project_id: "proj-a" })))
  await db.exec(insertSql("pms_issues", await minimalRow(db, "pms_issues", { id: "trk-iss", org_id: "org-a", project_id: "proj-a" })))
  await db.exec(insertSql("construction_materials", await minimalRow(db, "construction_materials", { id: "trk-mat", org_id: "org-a", project_id: "proj-a" })))
}, 300_000)
afterAll(async () => {
  await db.close()
})

describe("every tracked table (tests:F08)", () => {
  test("each of the 37 tables has exactly its three statement-level triggers, carrying its kind", async () => {
    const rows = await q(`select c.relname, t.tgname, (string_to_array(encode(t.tgargs, 'escape'), '\\000'))[1] kind, t.tgtype
                          from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_proc p on p.oid = t.tgfoid
                          where p.proname = 'projexa_track_change' and not t.tgisinternal order by 1, 2`)
    expect(rows.length).toBe(3 * TRACKED.length)
    for (const t of TRACKED) {
      const mine = rows.filter((r) => r.relname === t.table)
      expect([t.table, mine.map((r) => [r.tgname, r.kind, Number(r.tgtype)])]).toEqual([t.table, [["projexa_track_d", t.kind, 8], ["projexa_track_i", t.kind, 4], ["projexa_track_u", t.kind, 16]]])
    }
    expect((await q(`select count(*)::int n from pg_trigger where tgname = 'projexa_track_change'`))[0].n).toBe(0)
  })

  for (const t of TRACKED) {
    test(`${t.kind} (${t.table}): insert = version 1, a real change = version 2, a delete = a tombstone, under ${t.org ? "'__org__'" : "the right project"}`, async () => {
      const id = `trk-${t.kind}`
      const project = t.kind === "project" ? id : t.org ? "__org__" : "proj-a"
      const fixed = { id, org_id: "org-a", ...t.link("proj-a") }
      if (t.kind === "project") Object.assign(fixed, { product_id: "prod", name: "Tracked project" })
      if (t.kind === "org_people") Object.assign(fixed, { name: "Tracked Person", email: "trk@a.example.test", role: "member" })
      await db.exec(insertSql(t.table, await minimalRow(db, t.table, fixed)))
      expect([t.kind, await head(t.kind, id)]).toEqual([t.kind, { version: 1, deleted: false, project_id: project }])
      if (t.kind === "cost_visibility") await db.exec(`update compliance.cost_visibility_config set can_see_cost = false where id = '${id}'`)
      else await db.exec(`update compliance.${t.table} set "${await editableColumn(db, t.table)}" = 'changed by the test' where id = '${id}'`)
      expect([t.kind, (await head(t.kind, id))?.version]).toEqual([t.kind, 2])
      await db.exec(`delete from compliance.${t.table} where id = '${id}'`)
      expect([t.kind, await log(t.kind, id)]).toEqual([t.kind, [[project, 1, "I"], [project, 2, "U"], [project, 3, "D"]]])
      expect((await head(t.kind, id))?.deleted).toBe(true)
    })
  }
})

describe("rows that are not a project's, and rows that leave a project (sync:SYNC-07)", () => {
  test("a DPDP document (linked to a compliance item) writes no head and no log through insert, update and delete, and the writes succeed", async () => {
    const before = (await q(`select count(*)::int n from platform.projexa_change_log`))[0].n
    await db.exec(insertSql("documents", await minimalRow(db, "documents", { id: "dpdp-1", org_id: "org-a", linked_entity_type: "compliance_item", linked_entity_id: "proj-a", uploaded_by_id: "u-mem" })))
    await db.exec(`update compliance.documents set ${await editableColumn(db, "documents")} = 'dpdp edit' where id = 'dpdp-1'`)
    await db.exec(`delete from compliance.documents where id = 'dpdp-1'`)
    expect(await head("documents", "dpdp-1")).toBeUndefined()
    expect((await q(`select count(*)::int n from platform.projexa_change_log`))[0].n).toBe(before)
    expect((await q(`select count(*)::int n from compliance.documents where id = 'dpdp-1'`))[0].n).toBe(0)
  })

  test("the project kind: renaming a project is an update under its own id", async () => {
    await db.exec(`update compliance.projects set name = 'Villa A (renamed)' where id = 'proj-a2'`)
    expect((await log("project", "proj-a2")).at(-1)).toEqual(["proj-a2", (await head("project", "proj-a2"))!.version, "U"])
  })

  test("a task moved to another project: a tombstone in the project it left, an update in the new one, the same version", async () => {
    await db.exec(insertSql("pms_issues", await minimalRow(db, "pms_issues", { id: "mv-1", org_id: "org-a", project_id: "proj-a" })))
    const fromA = await feedHead("u-mgr", "proj-a")
    const fromA2 = await feedHead("u-mgr", "proj-a2")
    await db.exec(`update compliance.pms_issues set project_id = 'proj-a2' where id = 'mv-1'`)
    expect(await log("tasks", "mv-1")).toEqual([["proj-a", 1, "I"], ["proj-a", 2, "D"], ["proj-a2", 2, "U"]])
    expect(await head("tasks", "mv-1")).toEqual({ version: 2, deleted: false, project_id: "proj-a2" })
    expect(((await feedSince("u-mgr", "proj-a", fromA)).changes as J[]).filter((c) => c.id === "mv-1")).toEqual([{ seq: expect.any(Number), kind: "tasks", id: "mv-1", version: 2, op: "D" }])
    expect(((await feedSince("u-mgr", "proj-a2", fromA2)).changes as J[]).filter((c) => c.id === "mv-1").map((c) => [c.version, c.op])).toEqual([[2, "U"]])
  })

  test("a document unlinked from the project is a tombstone there; linked again it comes back", async () => {
    await db.exec(insertSql("documents", await minimalRow(db, "documents", { id: "doc-u", org_id: "org-a", linked_entity_type: "project", linked_entity_id: "proj-a", uploaded_by_id: "u-mem" })))
    await db.exec(`update compliance.documents set linked_entity_type = 'compliance_item' where id = 'doc-u'`)
    expect(await head("documents", "doc-u")).toEqual({ version: 2, deleted: true, project_id: "proj-a" })
    await db.exec(`update compliance.documents set ${await editableColumn(db, "documents")} = 'edited while unlinked' where id = 'doc-u'`)
    expect((await head("documents", "doc-u"))!.version).toBe(2) // not a project's row now: nothing to tell any laptop
    await db.exec(`update compliance.documents set linked_entity_type = 'project' where id = 'doc-u'`)
    expect(await log("documents", "doc-u")).toEqual([["proj-a", 1, "I"], ["proj-a", 2, "D"], ["proj-a", 3, "U"]])
  })

  test("a MoM that stops being about a project and an archived wiki page are tombstones", async () => {
    await db.exec(insertSql("veri_meetings", await minimalRow(db, "veri_meetings", { id: "mom-x", org_id: "org-a", context_entity_type: "project", context_entity_id: "proj-a" })))
    await db.exec(`update compliance.veri_meetings set context_entity_type = 'compliance_item' where id = 'mom-x'`)
    expect((await log("meeting_minutes", "mom-x")).map((l) => l[2])).toEqual(["I", "D"])
    await db.exec(insertSql("pms_wiki_pages", await minimalRow(db, "pms_wiki_pages", { id: "wiki-x", org_id: "org-a", project_id: "proj-a", is_archived: false })))
    await db.exec(`update compliance.pms_wiki_pages set is_archived = true where id = 'wiki-x'`)
    await db.exec(`update compliance.pms_wiki_pages set is_archived = false where id = 'wiki-x'`)
    expect(await log("wiki_pages", "wiki-x")).toEqual([["proj-a", 1, "I"], ["proj-a", 2, "D"], ["proj-a", 3, "U"]])
  })

  test("a cascade: BOQ lines that were NEVER tracked, deleted with their BOQ by a foreign key, each get a tombstone under the project", async () => {
    await db.exec(insertSql("construction_boqs", await minimalRow(db, "construction_boqs", { id: "cas-boq", org_id: "org-a", project_id: "proj-a" })))
    await db.exec(`alter table compliance.construction_boq_line_items disable trigger projexa_track_i`)
    for (const id of ["cas-l1", "cas-l2"]) await db.exec(insertSql("construction_boq_line_items", await minimalRow(db, "construction_boq_line_items", { id, org_id: "org-a", boq_id: "cas-boq" })))
    await db.exec(`alter table compliance.construction_boq_line_items enable trigger projexa_track_i`)
    await db.exec(`delete from platform.projexa_record_head where kind = 'boqs' and record_id = 'cas-boq'`) // the BOQ is untracked too (as before tracking began)
    expect(await head("boq_lines", "cas-l1")).toBeUndefined()
    await db.exec(`alter table compliance.construction_boq_line_items add constraint trk_cascade foreign key (boq_id) references compliance.construction_boqs (id) on delete cascade not valid`)
    try {
      await db.exec(`delete from compliance.construction_boqs where id = 'cas-boq'`)
    } finally {
      await db.exec(`alter table compliance.construction_boq_line_items drop constraint trk_cascade`)
    }
    expect(await log("boq_lines", "cas-l1")).toEqual([["proj-a", 1, "D"]])
    expect(await log("boq_lines", "cas-l2")).toEqual([["proj-a", 1, "D"]])
  })

  test("the application order (BOQ deleted first, then its untracked lines, no foreign key): the lines find the project through the BOQ's tombstone", async () => {
    await db.exec(insertSql("construction_boqs", await minimalRow(db, "construction_boqs", { id: "ord-boq", org_id: "org-a", project_id: "proj-a" })))
    await db.exec(`alter table compliance.construction_boq_line_items disable trigger projexa_track_i`)
    await db.exec(insertSql("construction_boq_line_items", await minimalRow(db, "construction_boq_line_items", { id: "ord-l1", org_id: "org-a", boq_id: "ord-boq" })))
    await db.exec(`alter table compliance.construction_boq_line_items enable trigger projexa_track_i`)
    await db.exec(`delete from compliance.construction_boqs where id = 'ord-boq'`)
    await db.exec(`delete from compliance.construction_boq_line_items where id = 'ord-l1'`)
    expect(await log("boq_lines", "ord-l1")).toEqual([["proj-a", 1, "D"]])
  })
})

describe("what is a new version (sync:SYNC-14, decision: the whole row minus updated_at and generated columns)", () => {
  test("a touch of updated_at alone is not a version; a change to a column the laptop does not receive is", async () => {
    await db.exec(insertSql("pms_issues", await minimalRow(db, "pms_issues", { id: "hash-1", org_id: "org-a", project_id: "proj-a" })))
    await db.exec(`update compliance.pms_issues set updated_at = now() + interval '1 hour' where id = 'hash-1'`)
    expect((await head("tasks", "hash-1"))!.version).toBe(1)
    // pms_issues.assigned_by_id is not in the tasks projection (records_core); a change to it still makes a version on purpose (values derived from unsent columns)
    const projected = ((await q(`select (public.ai_work_link__records_core(public.ai_work_link__bind(public.projexa_sync__ctx('u-mgr', 'org-a'), 'proj-a'), 'tasks', null, 1, '{}'::jsonb, 'hash-1')) -> 'items' -> 0 r`))[0].r ?? {}) as J
    expect(Object.keys(projected)).not.toContain("assigned_by_id")
    await db.exec(`update compliance.pms_issues set assigned_by_id = 'u-mgr' where id = 'hash-1'`)
    expect((await head("tasks", "hash-1"))!.version).toBe(2)
  })
})

describe("health check (sql:SQL-08)", () => {
  const health = async () => (await q(`select platform.projexa_tracking_health() h`))[0].h as J
  test("ok on a healthy database: every kind's triggers, expressions and a real probe write", async () => {
    await db.exec(`delete from platform.projexa_track_error`)
    const h = await health()
    expect(h.probe).toEqual({ ok: true, error: null })
    expect((h.kinds as J[]).filter((k) => !(k.triggers === 3 && k.enabled && k.expr_ok))).toEqual([])
    expect((h.kinds as J[]).length).toBe(37)
    expect(h.ok).toBe(true)
    // the probe rolled itself back
    expect((await q(`select count(*)::int n from platform.projexa_change_log where kind = '__probe__'`))[0].n).toBe(0)
  })
  test("NOT ok when a trigger is disabled, when one is missing, when the log refuses writes, and when tracking errors were counted", async () => {
    await db.exec(`alter table compliance.pms_issues disable trigger projexa_track_u`)
    let h = await health()
    expect([h.ok, (h.kinds as J[]).find((k) => k.kind === "tasks")!.enabled]).toEqual([false, false])
    await db.exec(`alter table compliance.pms_issues enable trigger projexa_track_u`)

    await db.exec(`drop trigger projexa_track_d on compliance.construction_rfis`)
    h = await health()
    expect([h.ok, (h.kinds as J[]).find((k) => k.kind === "rfis")!.triggers]).toEqual([false, 2])
    await db.exec(`create trigger projexa_track_d after delete on compliance.construction_rfis referencing old table as projexa_old for each statement execute function platform.projexa_track_change('rfis', 'col', 'project_id', '', '')`)

    await db.exec(`alter table platform.projexa_change_log add constraint trk_refuse check (kind <> '__probe__')`)
    h = await health()
    expect([h.ok, (h.probe as J).ok]).toEqual([false, false])
    await db.exec(`alter table platform.projexa_change_log drop constraint trk_refuse`)
    expect((await health()).ok).toBe(true)

    // a real tracking failure on a business write: the write succeeds, the failure is counted (once a minute at most) and the health check reports it
    await db.exec(`alter table platform.projexa_change_log add constraint trk_refuse2 check (kind <> 'materials') not valid`)
    await db.exec(`update compliance.construction_materials set ${await editableColumn(db, "construction_materials")} = 'fails to track' where id = 'trk-mat'`)
    await db.exec(`update compliance.construction_materials set ${await editableColumn(db, "construction_materials")} = 'fails again' where id = 'trk-mat'`)
    await db.exec(`alter table platform.projexa_change_log drop constraint trk_refuse2`)
    h = await health()
    expect([h.ok, (h.errors as J[]).map((e) => [e.kind, Number(e.errors)])]).toEqual([false, [["materials", 1]]])
    await db.exec(`delete from platform.projexa_track_error`)
  })
})

describe("retention (sql:SQL-06, sync:SYNC-10, requirements:F9)", () => {
  test("pruning deletes history older than the window, raises the floor, and a laptop below the floor is told reset_required", async () => {
    const cursor = await feedHead("u-mgr", "proj-a")
    // a change to the project, then age every proj-a row of the log past the window
    await db.exec(`update compliance.pms_issues set ${await editableColumn(db, "pms_issues")} = 'aged' where id = 'trk-iss'`)
    const newest = Number((await q(`select max(xid::text::bigint) x from platform.projexa_change_log where org_id = 'org-a' and project_id = 'proj-a'`))[0].x)
    await db.exec(`update platform.projexa_change_log set at = now() - interval '100 days' where org_id = 'org-a' and project_id = 'proj-a'`)
    const n = Number((await q(`select platform.projexa_prune_change_log() n`))[0].n)
    expect(n).toBeGreaterThan(0)
    expect((await q(`select count(*)::int n from platform.projexa_change_log where org_id = 'org-a' and project_id = 'proj-a'`))[0].n).toBe(0)
    expect(Number((await q(`select floor_xid::text::bigint f from platform.projexa_change_floor where org_id = 'org-a' and project_id = 'proj-a'`))[0].f)).toBe(newest)
    // the laptop's cursor is older than the pruned history: it must resync, not silently miss the tombstones that were pruned
    const r = await feedSince("u-mgr", "proj-a", cursor)
    expect([r.reset_required, r.changes]).toEqual([true, []])
    // a laptop that had already seen everything pruned carries on normally
    const ok = await feedSince("u-mgr", "proj-a", newest)
    expect(ok.reset_required).toBe(false)
    // another project of the organisation was not pruned and has no floor
    expect((await feedSince("u-mgr", "proj-a2", 0)).reset_required).toBe(false)
  })

  test("tombstone heads older than the window are pruned; live heads stay; the daily entry point runs every step", async () => {
    await db.exec(`update platform.projexa_record_head set updated_at = now() - interval '100 days' where kind = 'tasks' and record_id in ('mv-1', 'hash-1')`)
    await db.exec(`update platform.projexa_record_head set deleted = true, updated_at = now() - interval '100 days' where kind = 'boq_lines' and record_id = 'cas-l1'`)
    const out = (await q(`select platform.projexa_sync_prune() o`))[0].o as J
    expect(Number(out.tombstone_heads_deleted)).toBeGreaterThanOrEqual(1)
    expect(await head("boq_lines", "cas-l1")).toBeUndefined()
    expect(await head("tasks", "mv-1")).toBeDefined() // live record, old head: kept
    expect(Object.keys(out).sort()).toEqual(["change_log_deleted", "tombstone_heads_deleted"]) // 0680-0682 are not applied in this database
  })
})

describe("one cheap poll and the view class (requirements:F2, F11)", () => {
  test("/heads answers every readable project and the organisation in one call; another organisation sees only its own", async () => {
    const r = await hit("u-mgr", "heads")
    expect(r.status).toBe(200)
    const readable = ((await hit("u-mgr", "manifest")).json.projects as J[]).map((p) => p.id as string)
    expect(readable).toContain("proj-a2")
    expect(Object.keys(r.json.heads).sort()).toEqual(["__org__", ...readable].sort())
    expect(r.json.epoch).toMatch(/^[0-9a-f]{32}$/)
    const before = r.json.heads["proj-a2"] as number
    await db.exec(`update compliance.pms_issues set ${await editableColumn(db, "pms_issues")} = 'moves the head' where id = 'mv-1'`)
    const after = (await hit("u-mgr", "heads")).json
    expect(after.heads["proj-a2"]).toBeGreaterThan(before)
    expect(after.heads["proj-a"]).toBe(r.json.heads["proj-a"])
    expect(after.heads["proj-a2"]).toBe(await feedHead("u-mgr", "proj-a2"))
    const b = (await hit("u-b", "heads")).json
    expect(Object.keys(b.heads).sort()).toEqual(["__org__", "proj-b", "proj-b-priv"])
  })

  test("a role change and a cost-visibility change change the class in /heads, in the manifest and on every page", async () => {
    const page = async (u: string) => (await hit(u, "pull", { project_id: "proj-a", kind: "tasks", after: null, limit: 1 })).json
    const v0 = (await hit("u-mem", "heads")).json
    expect(v0.view_class).toBe((await hit("u-mem", "manifest")).json.view_class)
    expect((await page("u-mem")).view_class).toBe(v0.view_class)
    await db.exec(`update compliance.users set role = 'manager' where id = 'u-mem'`)
    const v1 = (await hit("u-mem", "heads")).json
    expect(v1.view_class).not.toBe(v0.view_class)
    expect(v1.role).toBe("manager")
    expect((await page("u-mem")).view_class).toBe(v1.view_class)
    expect((await hit("u-mem", "manifest")).json.view_class).toBe(v1.view_class)
    // the organisation withholds cost from managers: the class changes again, without any row of the project changing
    await db.exec(`update compliance.cost_visibility_config set can_see_cost = false where id = 'cv1'`)
    const v2 = (await hit("u-mem", "heads")).json
    expect(v2.view_class).not.toBe(v1.view_class)
    expect((await page("u-mem")).view_class).toBe(v2.view_class)
    const vendors = (await hit("u-mem", "pull", { kind: "vendors", after: null, limit: 1 })).json
    expect(vendors.org_view_class).toBe(v2.org_view_class)
    await db.exec(`update compliance.cost_visibility_config set can_see_cost = true where id = 'cv1'`)
    await db.exec(`update compliance.users set role = 'member' where id = 'u-mem'`)
    expect((await hit("u-mem", "heads")).json.view_class).toBe(v0.view_class)
  })
})

describe("the delete reconcile (requirements:F6, sync:SYNC-01 (2), SYNC-08)", () => {
  const local = (ids: string[]) => {
    let x = 0n
    for (const id of ids) x ^= BigInt("0x" + createHash("sha256").update(id).digest("hex").slice(0, 16))
    return x.toString(16).padStart(16, "0")
  }
  test("the digest equals the laptop's own computation over the ids it may read, and moves when a row is deleted", async () => {
    const list = (await hit("u-mgr", "ids", { project_id: "proj-a", kind: "materials" })).json
    const d = (await hit("u-mgr", "ids", { project_id: "proj-a", kinds: ["materials", "rfis"], digest: true })).json
    expect(d.digests.materials).toEqual({ count: (list.ids as string[]).length, xor: local(list.ids as string[]) })
    expect(d.digests.rfis).toEqual({ count: 0, xor: "0000000000000000" })
    expect(d.head_seq).toBe(await feedHead("u-mgr", "proj-a"))
    await db.exec(insertSql("construction_materials", await minimalRow(db, "construction_materials", { id: "dig-1", org_id: "org-a", project_id: "proj-a" })))
    const d2 = (await hit("u-mgr", "ids", { project_id: "proj-a", kinds: ["materials"], digest: true })).json
    expect(d2.digests.materials).toEqual({ count: (list.ids as string[]).length + 1, xor: local([...(list.ids as string[]), "dig-1"]) })
    // organisation kinds: only those the role may read; another one is the one 404
    const org = (await hit("u-mem", "ids", { project_id: "__org__", kinds: ["vendors"], digest: true })).json
    expect(org.digests.vendors).toEqual({ count: 2, xor: local(["ven-1", "ven-2"]) })
    expect((await hit("u-view", "ids", { project_id: "__org__", kinds: ["vendors"], digest: true })).status).toBe(404)
    expect((await hit("u-b", "ids", { project_id: "proj-a", kinds: ["materials"], digest: true })).status).toBe(404)
  })

  test("/ids carries the version of every listed id (0 = never tracked), the head read before the list and the epoch", async () => {
    await db.exec(`alter table compliance.construction_materials disable trigger projexa_track_i`)
    await db.exec(insertSql("construction_materials", await minimalRow(db, "construction_materials", { id: "dig-0", org_id: "org-a", project_id: "proj-a" })))
    await db.exec(`alter table compliance.construction_materials enable trigger projexa_track_i`)
    const r = (await hit("u-mgr", "ids", { project_id: "proj-a", kind: "materials" })).json
    const byId = Object.fromEntries((r.ids as string[]).map((id, i) => [id, (r.versions as number[])[i]]))
    expect(byId["dig-0"]).toBe(0)
    expect(byId["dig-1"]).toBe(1)
    expect(byId["trk-mat"]).toBe((await head("materials", "trk-mat"))!.version)
    expect(r.head_seq).toBe(await feedHead("u-mgr", "proj-a"))
    expect(r.epoch).toBe((await hit("u-mgr", "heads")).json.epoch)
    const org = (await hit("u-mem", "ids", { kind: "vendors" })).json
    expect(org.versions).toEqual([1, 1])
  })
})

describe("cost (sql:SQL-01, sync:SYNC-06, requirements:F17)", () => {
  test("a 2,000-row insert in ONE statement consumes two transaction ids, its own and one subtransaction (the per-row trigger it replaces took one per row) and versions every row", async () => {
    const row = await minimalRow(db, "construction_labour_roster", { id: "cost-0", org_id: "org-a", project_id: "proj-a" })
    const keys = Object.keys(row)
    const values = Array.from({ length: 2000 }, (_, i) => `(${keys.map((k) => (k === "id" ? `'cost-${i}'` : typeof row[k] === "number" ? String(row[k]) : typeof row[k] === "boolean" ? String(row[k]) : row[k] === null ? "null" : `'${String(row[k]).replace(/'/g, "''")}-${i}'`)).join(", ")})`)
    const x0 = Number((await q(`select pg_current_xact_id()::text::bigint x`))[0].x)
    const t0 = performance.now()
    await db.exec(`insert into compliance.construction_labour_roster (${keys.map((k) => `"${k}"`).join(", ")}) values ${values.join(", ")}`)
    const ms = performance.now() - t0
    const x1 = Number((await q(`select pg_current_xact_id()::text::bigint x`))[0].x)
    const used = x1 - x0 - 1
    console.log(`[cost] 2,000-row insert: ${used} transaction id(s) for the insert statement, ${ms.toFixed(0)} ms on PGlite`)
    expect(used).toBe(2) // the statement's own, and the ONE subtransaction of its tracking call (the old per-row trigger: one per row, 2,001)
    expect((await q(`select count(*)::int n from platform.projexa_record_head where kind = 'roster' and record_id like 'cost-%'`))[0].n).toBe(2000)
    const u0 = performance.now()
    await db.exec(`update compliance.construction_labour_roster set "${await editableColumn(db, "construction_labour_roster")}" = 'bulk' where id like 'cost-%' and id < 'cost-6'`)
    console.log(`[cost] bulk update of ${(await q(`select count(*)::int n from compliance.construction_labour_roster where id like 'cost-%' and id < 'cost-6'`))[0].n} rows: ${(performance.now() - u0).toFixed(0)} ms on PGlite`)
  })

  test("a user's login (a column outside the allow-list) writes nothing to the version tables", async () => {
    const n0 = (await q(`select count(*)::int n from platform.projexa_change_log`))[0].n
    await db.exec(`update compliance.users set last_login_at = now(), updated_at = now() where org_id = 'org-a'`)
    expect((await q(`select count(*)::int n from platform.projexa_change_log`))[0].n).toBe(n0)
  })
})

describe("grants of every object of 0678-0686 (tests:F04)", () => {
  const ENTRY = new Set([
    "public.projexa_sync_key_active", "public.projexa_sync_key_put", "public.projexa_sync_key_rotate", "public.projexa_sync_public_keys", "public.projexa_sync_manifest",
    "public.projexa_sync_ids", "public.projexa_sync_pull", "public.projexa_sync_pull_ids", "public.projexa_sync_changes", "public.projexa_sync_org_pull",
    "public.projexa_sync_org_pull_ids", "public.projexa_sync_org_ids", "public.projexa_sync_org_changes", "public.projexa_sync_heads", "public.projexa_sync_ids_digest",
    "public.projexa_read_resolve_user_for", "public.projexa_read_manifest", "public.projexa_read_records",
  ])
  test("no function is executable by anon, authenticated, app_runtime or PUBLIC; service_role only for the entry points; every definer pins search_path", async () => {
    const fns = await q(`select n.nspname || '.' || p.proname name, p.oid::regprocedure::text sig, p.prosecdef, p.proconfig,
                                has_function_privilege('anon', p.oid, 'EXECUTE') anon, has_function_privilege('authenticated', p.oid, 'EXECUTE') auth,
                                has_function_privilege('app_runtime', p.oid, 'EXECUTE') app, has_function_privilege('service_role', p.oid, 'EXECUTE') svc,
                                exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0 and a.privilege_type = 'EXECUTE') pub
                         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                         where n.nspname in ('public', 'platform') and p.proname like 'projexa\\_%' and p.proname not like 'projexa\\_read\\_%'`)
    expect(fns.length).toBeGreaterThan(40)
    const bad = fns.filter((f) => f.anon || f.auth || f.app || f.pub || (f.svc && !ENTRY.has(f.name as string)) || (f.prosecdef && !((f.proconfig ?? []) as string[]).some((c) => c.startsWith("search_path="))))
    expect(bad.map((f) => f.sig)).toEqual([])
    // the private signing key is readable by service_role and by nobody else
    const key = fns.find((f) => f.name === "public.projexa_sync_key_active")!
    expect([key.svc, key.anon, key.auth, key.app, key.pub]).toEqual([true, false, false, false, false])
    for (const helper of ["platform.projexa_track_change", "platform.projexa_track__attach", "public.projexa_sync__feed", "public.projexa_sync__horizon", "public.projexa_sync__items",
      "platform.projexa_tracking_health", "platform.projexa_sync_prune", "platform.projexa_prune_change_log"]) {
      expect([helper, fns.find((f) => f.name === helper)?.svc]).toEqual([helper, false])
    }
  })
  test("every platform.projexa_* table forces row level security and grants nothing to anon, authenticated, app_runtime or service_role", async () => {
    const t = await q(`select c.relname, c.relrowsecurity rls, c.relforcerowsecurity force,
                              has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE') anon, has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE') auth,
                              has_table_privilege('app_runtime', c.oid, 'SELECT,INSERT,UPDATE,DELETE') app, has_table_privilege('service_role', c.oid, 'SELECT,INSERT,UPDATE,DELETE') svc
                       from pg_class c join pg_namespace n on n.oid = c.relnamespace
                       where n.nspname = 'platform' and c.relkind = 'r' and c.relname like 'projexa\\_%' and c.relname <> 'projexa_gateway_settings'`) // 0618's table, not of this chain
    expect(t.map((r) => r.relname).sort()).toEqual(["projexa_change_floor", "projexa_change_log", "projexa_record_head", "projexa_sync_epoch", "projexa_sync_key", "projexa_track_error"])
    expect(t.filter((r) => !r.rls || !r.force || r.anon || r.auth || r.app || r.svc).map((r) => r.relname)).toEqual([])
  })
  test("the change log is append-only for the service role and the application role (tests:F11 (1))", async () => {
    for (const role of ["service_role", "app_runtime"]) {
      for (const sql of [`update platform.projexa_change_log set op = 'U'`, `delete from platform.projexa_change_log`, `update platform.projexa_record_head set version = 1`]) {
        let err = ""
        try {
          await db.exec(`set role ${role}; ${sql}`)
        } catch (e) {
          err = String((e as Error).message)
        } finally {
          await db.exec(`reset role`)
        }
        expect([role, sql, err]).toEqual([role, sql, expect.stringContaining("permission denied")])
      }
    }
  })
})
