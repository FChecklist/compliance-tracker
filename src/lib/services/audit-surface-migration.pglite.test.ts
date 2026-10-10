/// <reference types="bun-types" />
// PROJEXA-BUILD-001 U-32 part A (register rows BR-415, BR-410): offline proof of
// drizzle/0619_build001_audit_surface.sql (the nullable surface column of compliance.audit_logs and its four-key
// CHECK audit_logs_surface_check) and its down file, on PGlite (real Postgres compiled to WASM). No live database is
// touched.
//
// BASE: the committed snapshot scripts/verify/fixtures/0619_build001_audit_surface.base.sql, read from the live catalog
// of pcrjmlpuqsbocqfwoxod on 2026-09-25 by scripts/verify/gen-base-snapshot.mjs: 18 columns, primary key, six indexes,
// row-level security enabled and forced, the two policies app_runtime_tenant_isolation and
// service_role_bypass_audit_logs, INSERT and SELECT for app_runtime and service_role, and compliance.current_org_id()
// (the tenant policy calls it). Left out by the generator: the two foreign keys and the compliance_app grants. SEED: six
// rows covering the actor shapes logActivity() writes (person, key, key and person, support session, database trigger,
// every nullable column NULL).
//
// WHAT IS PROVEN, in order (the tests share one database and run in order):
//   1. on the base, BR-415's query reads 0, and the insert logActivity() makes through Drizzle fails, because
//      schema.ts now names the column: the migration must be applied before this code serves traffic;
//   2. 0619 adds exactly the column (nullable text, no default) and the check (validated), every existing row keeps
//      every value and reads NULL, BR-415's query reads 1, and a second run changes nothing;
//   3. the check refuses any value outside the four keys (SQLSTATE 23514, on INSERT and on UPDATE) and accepts NULL
//      and each of the four keys;
//   4. row-level security, the two policies, the grants and the index list are unchanged, and the tenant policy still
//      scopes app_runtime on a row that carries a surface;
//   5. the real logActivity() through drizzle-orm's PGlite driver stores a given surface, stores NULL when none is given
//      (the insert names the column with DEFAULT), and refuses an unknown key before any write;
//   6. the down file removes the check and the column, restores the exact prior schema (the 18 columns in order), keeps
//      every row apart from the surface values (the data loss its header states), and is safe to run twice.
//
// Run: bun test --isolate src/lib/services/audit-surface-migration.pglite.test.ts
import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { readFileSync } from "node:fs"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import * as schema from "@/lib/db/schema"
import { AUDIT_SURFACES, logActivity } from "@/lib/audit"
import type { TenantDb } from "@/lib/db/tenant-scoped"

const REPO_ROOT = new URL("../../../", import.meta.url)
const read = (p: string) => readFileSync(new URL(p, REPO_ROOT), "utf8")
const F0619 = read("drizzle/0619_build001_audit_surface.sql")
const D0619 = read("drizzle/down/0619_build001_audit_surface.down.sql")
const BASE_SQL = read("scripts/verify/fixtures/0619_build001_audit_surface.base.sql")

// The roles the snapshot's policies and grants name (the Supabase baseline of the replay creates the same five), and
// the schema USAGE app_runtime holds live, which the snapshot does not carry (it holds table grants only).
const ROLES_SQL = `
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE ROLE authenticator NOLOGIN;
CREATE ROLE app_runtime NOLOGIN;
`
const SCHEMA_USAGE_SQL = "GRANT USAGE ON SCHEMA compliance TO app_runtime;"

// Register row BR-415, the SELECT of its verify_command, verbatim from ai-os/projexa-build-001/BOOLEAN_REGISTER.csv.
const BR415 = "select count(*) from information_schema.columns where table_schema='compliance' and table_name='audit_logs' and column_name='surface'"

const BASE_COLUMNS = [
  "id", "action", "entity_type", "entity_id", "user_id", "details", "ip_address", "created_at", "org_id", "client_id",
  "actor_name", "actor_role", "user_agent", "api_key_id", "support_session_id", "acting_on_behalf_of_user_id",
  "session_id", "office_id",
]

const SEED_SQL = `
INSERT INTO compliance.audit_logs (id, action, entity_type, entity_id, user_id, details, ip_address, created_at, org_id,
  client_id, actor_name, actor_role, user_agent, api_key_id, support_session_id, acting_on_behalf_of_user_id, session_id, office_id)
VALUES
  ('seed-a1', 'boq.created', 'construction_boq', 'boq_1', 'user_1', '{"lines":3}', '203.0.113.7', '2026-09-20 10:00:00+00', 'org_a',
   'client_1', 'Site Manager', 'manager', 'Mozilla/5.0', NULL, NULL, NULL, '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08', NULL),
  ('seed-a2', 'progress.recorded', 'construction_progress', 'prog_1', NULL, NULL, NULL, '2026-09-20 10:01:00+00', 'org_a',
   NULL, 'API Key: PROJEXA (provisioned)', 'api_key', NULL, 'key_1', NULL, NULL, NULL, NULL),
  ('seed-a3', 'rfi.updated', 'construction_rfi', 'rfi_1', 'user_1', 'status: open -> answered', '198.51.100.2', '2026-09-20 10:02:00+00', 'org_a',
   NULL, 'Site Manager', 'manager', 'node', 'key_1', NULL, NULL, NULL, 'branch_1'),
  ('seed-b1', 'support_session.started', 'support_session', 'ss_1', 'user_9', 'it''s a "quoted" detail', NULL, '2026-09-21 08:00:00+00', 'org_b',
   'client_2', 'Support Agent', 'support', NULL, NULL, 'ss_1', 'user_8', NULL, 'branch_2'),
  ('seed-b2', 'db_trigger.update', 'users', 'user_8', NULL, '{"old":{"role":"member"},"new":{"role":"admin"}}', NULL, '2026-09-21 08:05:00+00', 'org_b',
   NULL, 'db_trigger', 'system', NULL, NULL, NULL, NULL, NULL, NULL),
  ('seed-b3', 'x', 'x', 'x', NULL, NULL, NULL, '2026-09-21 08:10:00+00', 'org_b',
   NULL, 'n', 'r', NULL, NULL, NULL, NULL, NULL, NULL);
`

const SNAPSHOT_SQL = `
with cols as (
  select 'col:'||table_name||'.'||lpad(ordinal_position::text, 3, '0')||'.'||column_name||':'||data_type||':'||is_nullable||':'||coalesce(column_default, '') s
  from information_schema.columns where table_schema = 'compliance'
), cons as (
  select 'con:'||c.relname||'.'||k.conname||':'||k.contype::text||':'||k.convalidated::text||':'||pg_get_constraintdef(k.oid) s
  from pg_constraint k join pg_class c on c.oid = k.conrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'compliance'
), idx as (
  select 'idx:'||tablename||'.'||indexname||':'||indexdef s from pg_indexes where schemaname = 'compliance'
), pol as (
  select 'pol:'||tablename||'.'||policyname||':'||permissive||':'||cmd||':'||roles::text||':'||coalesce(qual, '')||':'||coalesce(with_check, '') s
  from pg_policies where schemaname = 'compliance'
), rls as (
  select 'rls:'||c.relname||':'||c.relrowsecurity::text||':'||c.relforcerowsecurity::text s
  from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.relkind in ('r', 'p') and n.nspname = 'compliance'
), grants as (
  select 'grant:'||table_name||':'||grantee||':'||privilege_type s from information_schema.role_table_grants where table_schema = 'compliance'
), trg as (
  select 'trg:'||c.relname||'.'||t.tgname s
  from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'compliance' and not t.tgisinternal
)
select s from (select * from cols union all select * from cons union all select * from idx union all select * from pol
  union all select * from rls union all select * from grants union all select * from trg) a order by s`

let pg: PGlite

async function snapshot(): Promise<string[]> {
  return (await pg.query<{ s: string }>(SNAPSHOT_SQL)).rows.map((r) => r.s)
}
async function rows(where = "true"): Promise<string[]> {
  return (await pg.query<{ j: string }>(`select to_jsonb(r)::text j from compliance.audit_logs r where ${where} order by id`)).rows.map((r) => r.j)
}
// One JSON text per row with its keys sorted, so rows built in JS compare equal to rows read back from to_jsonb.
function canon(rowsJson: string[]): string[] {
  return rowsJson.map((j) => {
    const o = JSON.parse(j) as Record<string, unknown>
    return JSON.stringify(Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]])))
  })
}
async function scalar(sql: string): Promise<string | null> {
  return (await pg.query<{ v: string | null }>(`select ((${sql}))::text as v`)).rows[0]?.v ?? null
}
async function columnNames(): Promise<string[]> {
  return (await pg.query<{ c: string }>(
    `select column_name c from information_schema.columns where table_schema = 'compliance' and table_name = 'audit_logs' order by ordinal_position`,
  )).rows.map((r) => r.c)
}
// The SQLSTATE and constraint of a statement that must fail.
async function failure(sqlText: string): Promise<{ code: string; constraint: string | null; message: string }> {
  try {
    await pg.exec(sqlText)
  } catch (err) {
    const e = err as { code?: string; constraint?: string; message: string }
    return { code: String(e.code), constraint: e.constraint ?? null, message: e.message }
  }
  throw new Error(`expected this SQL to fail: ${sqlText}`)
}
const insertWithSurface = (id: string, surface: string | null, org = "org_a") =>
  `INSERT INTO compliance.audit_logs (id, action, entity_type, entity_id, org_id, actor_name, actor_role, surface)
   VALUES ('${id}', 'check.probe', 'probe', '${id}', '${org}', 'Probe', 'manager', ${surface === null ? "NULL" : `'${surface.replace(/'/g, "''")}'`})`

// The real logActivity() on drizzle-orm's PGlite driver, with the SQL it sends recorded.
const sent: string[] = []
function drizzleDb(): TenantDb {
  return drizzle({ client: pg, schema, logger: { logQuery: (q: string) => { sent.push(q) } } }) as unknown as TenantDb
}
// What the insert puts in the surface column: "default", "param" ($n), or the column is not named at all.
function surfaceValueOf(q: string): "default" | "param" | "not named" {
  const m = /^insert into "compliance"\."audit_logs" \(([^)]*)\) values \((.*)\)$/.exec(q)
  if (!m) throw new Error(`not an audit_logs insert: ${q}`)
  const cols = m[1].split(", ").map((c) => c.replace(/"/g, ""))
  const vals = m[2].split(", ")
  if (cols.length !== vals.length) throw new Error(`column and value counts differ: ${q}`)
  const v = cols.includes("surface") ? vals[cols.indexOf("surface")] : undefined
  if (v === undefined) return "not named"
  if (v === "default") return "default"
  if (/^\$\d+$/.test(v)) return "param"
  throw new Error(`unexpected value for surface: ${v}`)
}
const person = { id: "user_1", name: "Site Manager", role: "manager" } as never
const key = { id: "key_1", name: "PROJEXA (provisioned)" }

let original: string[] = []
let s0: string[] = []
let s1: string[] = []

beforeAll(async () => {
  pg = await PGlite.create()
  await pg.exec(ROLES_SQL)
  await pg.exec("SET TIME ZONE 'UTC'")
  await pg.exec(BASE_SQL)
  await pg.exec(SCHEMA_USAGE_SQL)
  await pg.exec(SEED_SQL)
  original = await rows()
  s0 = await snapshot()
}, 60_000)

afterAll(async () => {
  await pg?.close()
})

describe("drizzle/0619 build001_audit_surface on the 2026-09-25 base (PGlite)", () => {
  test("1. on the base BR-415 reads 0, and logActivity() through Drizzle fails there: 0619 must be applied first", async () => {
    expect(original).toHaveLength(6)
    expect(await columnNames()).toEqual(BASE_COLUMNS)
    expect(await scalar(BR415)).toBe("0")

    sent.length = 0
    let message = ""
    try {
      await logActivity({ tx: drizzleDb(), action: "boq.approved", entityType: "construction_boq", entityId: "boq_1", orgId: "org_a", dbUser: person })
    } catch (err) {
      // drizzle wraps the driver error; the Postgres message is on the cause.
      const e = err as { message: string; cause?: { message?: string } }
      message = `${e.message} ${e.cause?.message ?? ""}`
    }
    expect(message).toContain('column "surface" of relation "audit_logs" does not exist')
    expect(sent).toHaveLength(1)
    expect(surfaceValueOf(sent[0])).toBe("default")
    expect(await rows()).toEqual(original)
  })

  test("2. 0619 adds exactly the column and the check, keeps every row (surface NULL), and a second run changes nothing", async () => {
    await pg.exec(F0619)
    s1 = await snapshot()
    const added = s1.filter((l) => !s0.includes(l))
    expect(added).toHaveLength(2)
    expect(added).toContain("col:audit_logs.019.surface:text:YES:")
    const check = added.find((l) => l.startsWith("con:audit_logs.audit_logs_surface_check:c:true:CHECK "))
    expect(check).toBeDefined()
    for (const k of AUDIT_SURFACES) expect(check).toContain(`'${k}'::text`)
    expect(check).toContain("surface IS NULL")
    expect(s0.filter((l) => !s1.includes(l))).toEqual([])
    expect(await columnNames()).toEqual([...BASE_COLUMNS, "surface"])
    expect(await scalar(BR415)).toBe("1")

    const withNull = original.map((j) => JSON.stringify({ ...JSON.parse(j), surface: null }))
    expect(canon(await rows())).toEqual(canon(withNull))

    await pg.exec(F0619)
    expect(await snapshot()).toEqual(s1)
    expect(canon(await rows())).toEqual(canon(withNull))
  })

  test("3. the check refuses a value outside the four keys (23514) and accepts NULL and each key", async () => {
    for (const bad of ["s5_sms", "", "S1_ONE_PAGE_AI_PREPARED", "s1_one_page_ai_prepared ", "surface_1", "s3_ai_link"]) {
      const f = await failure(insertWithSurface(`bad-${bad.length}-${bad.slice(0, 4)}`, bad))
      expect({ bad, code: f.code, constraint: f.constraint }).toEqual({ bad, code: "23514", constraint: "audit_logs_surface_check" })
    }
    const u = await failure(`UPDATE compliance.audit_logs SET surface = 'not_a_surface' WHERE id = 'seed-a1'`)
    expect(u.code).toBe("23514")
    expect(await scalar("select count(*) from compliance.audit_logs where id like 'bad-%'")).toBe("0")

    const accepted = [null, ...AUDIT_SURFACES]
    for (const [i, s] of accepted.entries()) await pg.exec(insertWithSurface(`ok-${i}`, s))
    const stored = await pg.query<{ id: string; surface: string | null }>(`select id, surface from compliance.audit_logs where id like 'ok-%' order by id`)
    expect(stored.rows).toEqual(accepted.map((s, i) => ({ id: `ok-${i}`, surface: s })))

    await pg.exec(`DELETE FROM compliance.audit_logs WHERE id like 'ok-%'`)
    expect(canon(await rows())).toEqual(canon(original.map((j) => JSON.stringify({ ...JSON.parse(j), surface: null }))))
  })

  test("4. RLS, the two policies, grants and indexes are unchanged, and the tenant policy still scopes app_runtime", async () => {
    const keep = (s: string[]) => s.filter((l) => /^(pol|rls|grant|idx|trg):/.test(l))
    expect(keep(s1)).toEqual(keep(s0))
    expect(keep(s0).filter((l) => l.startsWith("pol:"))).toHaveLength(2)
    expect(keep(s0)).toContain("rls:audit_logs:true:true")
    expect(keep(s0).filter((l) => l.startsWith("trg:"))).toEqual([])

    try {
      await pg.exec(`SET ROLE app_runtime; SELECT set_config('app.current_org_id', 'org_a', false);`)
      await pg.exec(insertWithSurface("rls-own", "s3_ai_link_chat", "org_a"))
      const other = await failure(insertWithSurface("rls-other", "s3_ai_link_chat", "org_b"))
      expect(other.code).toBe("42501")
      expect(other.message).toContain("row-level security")
      // org_a sees its three seed rows and the new one; org_b's rows stay hidden.
      expect(await scalar("select count(*) from compliance.audit_logs")).toBe("4")
      expect(await scalar("select surface from compliance.audit_logs where id = 'rls-own'")).toBe("s3_ai_link_chat")
    } finally {
      await pg.exec(`RESET ROLE; SELECT set_config('app.current_org_id', '', false);`)
    }
    await pg.exec(`DELETE FROM compliance.audit_logs WHERE id like 'rls-%'`)
  })

  test("5. the real logActivity() stores a given surface, stores NULL without one, and refuses an unknown key before any write", async () => {
    const tx = drizzleDb()
    const base = { tx, entityType: "construction_boq_line_item", orgId: "org_a" }
    sent.length = 0
    await logActivity({ ...base, action: "boq_line.approved", entityId: "line_s1", dbUser: person, apiKey: key, actingViaApiKey: true, surface: "s1_one_page_ai_prepared" })
    await logActivity({ ...base, action: "boq_line.updated", entityId: "line_none", dbUser: person })
    await logActivity({ ...base, action: "boq_line.updated", entityId: "line_null", apiKey: key, surface: null })
    for (const s of AUDIT_SURFACES) await logActivity({ ...base, action: "boq_line.updated", entityId: `line_${s}`, dbUser: person, surface: s })

    const got = await pg.query<{ entity_id: string; surface: string | null; user_id: string | null; api_key_id: string | null }>(
      `select entity_id, surface, user_id, api_key_id from compliance.audit_logs where entity_id like 'line_%' order by entity_id`,
    )
    const byEntity = Object.fromEntries(got.rows.map((r) => [r.entity_id, r]))
    expect(got.rows).toHaveLength(3 + AUDIT_SURFACES.length)
    // BR-410's shape: exactly one row for the entity, surface s1, a non-null user_id.
    expect(byEntity.line_s1).toEqual({ entity_id: "line_s1", surface: "s1_one_page_ai_prepared", user_id: "user_1", api_key_id: "key_1" })
    expect(byEntity.line_none.surface).toBeNull()
    expect(byEntity.line_null.surface).toBeNull()
    for (const s of AUDIT_SURFACES) expect(byEntity[`line_${s}`].surface).toBe(s)
    // Every insert names the column; without a surface its value is DEFAULT (drizzle-orm's rule for an absent value),
    // with one it is a bound parameter.
    expect(sent).toHaveLength(3 + AUDIT_SURFACES.length)
    expect(sent.map(surfaceValueOf)).toEqual(["param", "default", "default", ...AUDIT_SURFACES.map(() => "param" as const)])

    const before = await rows()
    sent.length = 0
    for (const bad of ["s5_sms", "", "S1_ONE_PAGE_AI_PREPARED"]) {
      await expect(
        logActivity({ ...base, action: "boq_line.updated", entityId: "line_bad", dbUser: person, surface: bad as never }),
      ).rejects.toThrow("unknown audit surface")
    }
    expect(sent).toEqual([])
    expect(await rows()).toEqual(before)
  })

  test("6. the down file restores the exact prior schema, keeps every row apart from surface, and is safe to run twice", async () => {
    const before = await rows()
    expect(await scalar("select count(*) from compliance.audit_logs where surface is not null")).toBe(String(1 + AUDIT_SURFACES.length))

    await pg.exec(D0619)
    expect(await snapshot()).toEqual(s0)
    expect(await columnNames()).toEqual(BASE_COLUMNS)
    expect(await scalar(BR415)).toBe("0")
    // The one loss: the surface values. Every other value of every row is kept.
    const withoutSurface = before.map((j) => {
      const { surface: _dropped, ...rest } = JSON.parse(j) as Record<string, unknown>
      return JSON.stringify(rest)
    })
    expect(canon(await rows())).toEqual(canon(withoutSurface))
    expect(canon(await rows("id like 'seed-%'"))).toEqual(canon(original))

    await pg.exec(D0619)
    expect(await snapshot()).toEqual(s0)
  })
})
