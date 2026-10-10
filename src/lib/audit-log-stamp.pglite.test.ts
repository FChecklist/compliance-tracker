/// <reference types="bun-types" />
// AUDIT TRAIL slice 1: offline proof of drizzle/0730_audit_trail_stamp_columns.sql, its down file, and the optional `stamp` of logActivity(),
// on PGlite (real Postgres as WASM). No live database is touched. BASE = the committed live snapshot of compliance.audit_logs (2026-09-25,
// 18 columns) plus drizzle/0619 (the 19th, surface), i.e. the live shape of 2026-10-06.
//
// PROVEN, in order (tests share one database and run in order):
//   1. logActivity() WITHOUT a stamp works before and after 0730 (backward compatible; the insert names no stamp column);
//   2. 0730 adds 17 nullable columns, validated checks, leaves existing rows untouched, and a second run changes nothing;
//   3. logActivity() WITH a stamp stores every stamp field, and the row is RE-READ from the table (not from a return value);
//   4. the database CHECKs refuse an unknown channel/source;
//   5. INTERNAL ONLY: as app_runtime the 19 old columns are readable, but selecting any stamp column, or select *, is denied;
//      anon/authenticated read nothing; service_role reads the stamp; app_runtime can still INSERT (what logActivity needs);
//   6. the down file removes the columns and restores table-level SELECT for app_runtime.
// Run: bun test --isolate src/lib/audit-log-stamp.pglite.test.ts
import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { readFileSync } from "node:fs"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import * as schema from "@/lib/db/schema"
import { logActivity } from "@/lib/audit"
import { buildStamp } from "@/lib/audit-stamp"
import type { TenantDb } from "@/lib/db/tenant-scoped"

const REPO_ROOT = new URL("../../", import.meta.url)
const read = (p: string) => readFileSync(new URL(p, REPO_ROOT), "utf8")
const BASE_SQL = read("scripts/verify/fixtures/0619_build001_audit_surface.base.sql")
const F0619 = read("drizzle/0619_build001_audit_surface.sql")
const F0730 = read("drizzle/0730_audit_trail_stamp_columns.sql")
const D0730 = read("drizzle/down/0730_audit_trail_stamp_columns.down.sql")

const ROLES_SQL = `
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE ROLE authenticator NOLOGIN; CREATE ROLE app_runtime NOLOGIN;`
const STAMP_COLUMNS = ["product", "channel", "source", "action_class", "device_id", "ai_name", "ai_link_id", "ai_call_id", "client_at", "server_at",
  "clock_skew_ms", "ip_prefix", "ua_family", "internet_id", "correlation_id", "relay_device_id", "diff"]

let pg: PGlite
const person = { id: "user_1", name: "Site Manager", role: "manager" } as never
const db = () => drizzle({ client: pg, schema }) as unknown as TenantDb
async function columns(): Promise<string[]> {
  return (await pg.query<{ c: string }>("select column_name c from information_schema.columns where table_schema='compliance' and table_name='audit_logs' order by ordinal_position")).rows.map((r) => r.c)
}
async function asRole<T>(role: string, sql: string): Promise<{ ok: true; rows: T[] } | { ok: false; code: string }> {
  await pg.exec(`SET ROLE ${role}; SET app.current_org_id = 'org_a';`)
  try {
    return { ok: true, rows: (await pg.query<T>(sql)).rows }
  } catch (e) {
    return { ok: false, code: String((e as { code?: string }).code) }
  } finally {
    await pg.exec("RESET ROLE")
  }
}

beforeAll(async () => {
  pg = await PGlite.create()
  await pg.exec(ROLES_SQL)
  await pg.exec("SET TIME ZONE 'UTC'")
  await pg.exec(BASE_SQL)
  await pg.exec("GRANT USAGE ON SCHEMA compliance TO app_runtime, service_role;")
  await pg.exec(F0619)
}, 60_000)
afterAll(async () => { await pg?.close() })

describe("drizzle/0730 audit_trail_stamp_columns + logActivity stamp (PGlite)", () => {
  test("1+2. unstamped logActivity works before and after 0730; 0730 adds 17 nullable columns, is idempotent", async () => {
    await logActivity({ tx: db(), action: "pre.0730", entityType: "t", entityId: "e0", orgId: "org_a", dbUser: person })
    const before = await columns()
    expect(before).toHaveLength(19)
    await pg.exec(F0730)
    const after = await columns()
    expect(after.slice(0, 19)).toEqual(before)
    expect(after.slice(19)).toEqual(STAMP_COLUMNS)
    const nullable = (await pg.query<{ n: string }>("select count(*)::text n from information_schema.columns where table_schema='compliance' and table_name='audit_logs' and column_name = any($1) and is_nullable='YES' and column_default is null", [STAMP_COLUMNS])).rows[0]!.n
    expect(nullable).toBe("17")
    const invalid = (await pg.query<{ n: string }>("select count(*)::text n from pg_constraint where conrelid = 'compliance.audit_logs'::regclass and contype = 'c' and not convalidated")).rows[0]!.n
    expect(invalid).toBe("0")
    await pg.exec(F0730) // second run: no error, no change
    expect(await columns()).toEqual(after)
    await logActivity({ tx: db(), action: "post.0730", entityType: "t", entityId: "e1", orgId: "org_a", dbUser: person })
    const r = await pg.query<{ channel: string | null; server_at: string | null }>("select channel, server_at from compliance.audit_logs where entity_id='e1'")
    expect(r.rows[0]).toEqual({ channel: null, server_at: null })
  })

  test("3. a stamped logActivity persists every stamp field, re-read from the table", async () => {
    const request = new Request("https://x.test/api", { headers: {
      "x-forwarded-for": "203.0.113.77", "user-agent": "Mozilla/5.0 (Windows NT 10.0) Chrome/130.0 Safari/537.36",
      "x-px-device": "dev_ABC-12345678", "x-px-client-time": "2026-10-06T09:59:00.000Z", "x-px-internet-id": "wifi",
    } })
    const stamp = buildStamp(request, { now: new Date("2026-10-06T10:00:00.000Z"), channel: "offline", source: "outbox_replay", product: "projexa",
      actionClass: "edit", correlationId: "op_42", relayDeviceId: "relay-device-01", ai: { name: "Claude via link", linkId: "link_1", callId: "call_9" }, diff: { qty: [1, 2] } })
    await logActivity({ tx: db(), action: "boq.edited", entityType: "boq", entityId: "e2", orgId: "org_a", dbUser: person, request, stamp })
    const r = (await pg.query<{ j: Record<string, unknown> }>("select to_jsonb(a) j from compliance.audit_logs a where entity_id='e2'")).rows[0]!.j
    expect(r).toMatchObject({
      product: "projexa", channel: "offline", source: "outbox_replay", action_class: "edit", device_id: "dev_ABC-12345678",
      ai_name: "Claude via link", ai_link_id: "link_1", ai_call_id: "call_9", clock_skew_ms: 60000, ip_prefix: "203.0.113.0/24",
      ua_family: "Chrome on Windows", internet_id: "wifi", correlation_id: "op_42", relay_device_id: "relay-device-01", diff: { qty: [1, 2] },
      ip_address: "203.0.113.77", user_agent: "Mozilla/5.0 (Windows NT 10.0) Chrome/130.0 Safari/537.36",
    })
    expect(new Date(r.server_at as string).toISOString()).toBe("2026-10-06T10:00:00.000Z")
    expect(new Date(r.client_at as string).toISOString()).toBe("2026-10-06T09:59:00.000Z")
  })

  test("4. the database refuses an unknown channel or source", async () => {
    const ins = (col: string) => pg.exec(`INSERT INTO compliance.audit_logs (id, action, entity_type, entity_id, org_id, actor_name, actor_role, ${col}) VALUES ('bad-${col}', 'a','b','c','org_a','n','r','bogus')`)
    await expect(ins("channel")).rejects.toThrow()
    await expect(ins("source")).rejects.toThrow()
  })

  test("5. internal only: app_runtime cannot read stamp columns or select *, service_role can, app_runtime can still insert", async () => {
    const old = await asRole<{ n: string }>("app_runtime", "select count(*)::text n from (select id, action, ip_address, user_agent, surface from compliance.audit_logs) x")
    expect(old.ok).toBe(true)
    for (const col of STAMP_COLUMNS) {
      expect(await asRole("app_runtime", `select ${col} from compliance.audit_logs`)).toEqual({ ok: false, code: "42501" })
    }
    expect(await asRole("app_runtime", "select * from compliance.audit_logs")).toEqual({ ok: false, code: "42501" })
    for (const role of ["anon", "authenticated"]) expect(await asRole(role, "select id from compliance.audit_logs")).toEqual({ ok: false, code: "42501" })
    expect(await asRole("service_role", "select channel from compliance.audit_logs where entity_id='e2'")).toEqual({ ok: true, rows: [{ channel: "offline" }] })
    await pg.exec("SET ROLE app_runtime; SET app.current_org_id = 'org_a';")
    await pg.exec("INSERT INTO compliance.audit_logs (id, action, entity_type, entity_id, org_id, actor_name, actor_role, channel) VALUES ('rt-1','a','b','c','org_a','n','r','web')")
    await pg.exec("RESET ROLE")
  })

  test("6. the down file drops the columns and restores table-level SELECT; forward applies again", async () => {
    await pg.exec(D0730)
    expect(await columns()).toHaveLength(19)
    expect(await asRole("app_runtime", "select * from compliance.audit_logs")).toMatchObject({ ok: true })
    await pg.exec(F0730)
    expect(await columns()).toHaveLength(36)
  })
})
