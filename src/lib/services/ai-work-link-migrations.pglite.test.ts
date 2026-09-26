/// <reference types="bun-types" />
// PROJEXA-BUILD-001 U-46 step 1 (BR-483 to BR-488): offline proof of migrations drizzle/0621 to 0628 (the database of the Universal AI
// Work Link) and of their down files, on PGlite (real Postgres compiled to WASM). No live database is touched.
// BUILD-002 WP-09a extends it to 0629 (the write path's SQL) and 0630 (the two provenance columns of compliance.submissions): the
// migration count, the function inventory, the owner-only list and the round trip below include them.
//
// BASE: scripts/verify/fixtures/0625_build001_awl_read_functions.base.sql, the committed read-only snapshot of the live tables the
// link reads, with the roles and the live database's default privileges added by __test-helpers__/awl-pglite.ts (so a missing REVOKE
// in a migration is a failing test here, not a silent pass).
//
// WHAT IS PROVEN, in order (the tests of a describe share one database and run in order):
//   forward files   apply in number order and a second run changes nothing (and never resets the writes_enabled switch); the register
//                   rows' own SQL, BR-484 (no link function executable by anon, none of the token-taking ones by authenticated),
//                   BR-485 (guard trigger, range partitions), BR-486 (idempotency index), BR-487 (timestamptz only); the exact
//                   function inventory and its grants; pinned search_path; RLS on and forced with no policy, and no table grant to
//                   anon, authenticated, PUBLIC, app_runtime (service_role reads the three config tables only); the append-only guard,
//                   also for a role that lacks EXECUTE on the trigger function; the partial unique index; retention.
//   cron job        a stand-in cron schema: the job is registered once with its name, schedule and command, and unscheduled by the
//                   down file.
//   down files      applied in reverse, they restore the base snapshot exactly (columns, constraints, indexes, policies, functions with
//                   their grants, triggers, RLS flags, table and routine grants), twice over, and the forward files apply again.
//
// Run: bun test --isolate src/lib/services/ai-work-link-migrations.pglite.test.ts
import { describe, test, expect, beforeAll, afterAll, setDefaultTimeout } from "bun:test"
import type { PGlite } from "@electric-sql/pglite"
import { AWL_MIGRATIONS, downSql, failure, forwardSql, one, openAwlPglite, read } from "./__test-helpers__/awl-pglite"

// PGlite tests run real Postgres as WASM: a loaded laptop or CI runner can pass bun's 5 s default for one test
setDefaultTimeout(60_000)

// The LIVE_FACTS section (b) schema hash, over the three schemas the migrations touch, with triggers, partitions and grants added.
const STATE_CTE = `
with cols as (
  -- the position is the RANK among the table's live columns, not attnum: a dropped column leaves a gap in attnum, so a column that a down
  -- file dropped and a forward file added again (0630's via) would sit at a higher attnum with the same place in the table
  select 'col:'||table_schema||'.'||table_name||'.'||lpad((row_number() over (partition by table_schema, table_name order by ordinal_position))::text, 3, '0')||'.'||column_name||':'||data_type||':'||is_nullable||':'||coalesce(column_default, '') s
  from information_schema.columns where table_schema in ('compliance', 'platform', 'public')
), cons as (
  select 'con:'||n.nspname||'.'||c.relname||'.'||k.conname||':'||k.contype::text||':'||pg_get_constraintdef(k.oid) s
  from pg_constraint k join pg_class c on c.oid = k.conrelid join pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('compliance', 'platform', 'public')
), idx as (
  select 'idx:'||schemaname||'.'||tablename||'.'||indexname||':'||indexdef s
  from pg_indexes where schemaname in ('compliance', 'platform', 'public')
), pol as (
  select 'pol:'||schemaname||'.'||tablename||'.'||policyname||':'||cmd||':'||roles::text||':'||coalesce(qual, '')||':'||coalesce(with_check, '') s
  from pg_policies where schemaname in ('compliance', 'platform', 'public')
), fn as (
  select 'fn:'||n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||'):'||md5(pg_get_functiondef(p.oid))||':'||p.prosecdef::text||':'||coalesce(p.proacl::text, 'default') s
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('compliance', 'platform', 'public') and p.prokind in ('f', 'p')
), rls as (
  select 'rls:'||n.nspname||'.'||c.relname||':'||c.relkind::text||':'||c.relispartition::text||':'||c.relrowsecurity::text||':'||c.relforcerowsecurity::text s
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where c.relkind in ('r', 'p') and n.nspname in ('compliance', 'platform', 'public')
), grants as (
  select 'grant:'||table_schema||'.'||table_name||':'||grantee||':'||privilege_type s
  from information_schema.role_table_grants where table_schema in ('compliance', 'platform', 'public')
), rgrants as (
  select 'rgrant:'||routine_schema||'.'||routine_name||':'||grantee||':'||privilege_type s
  from information_schema.role_routine_grants where routine_schema in ('compliance', 'platform', 'public')
), trg as (
  select 'trg:'||n.nspname||'.'||c.relname||'.'||t.tgname||':'||pg_get_triggerdef(t.oid) s
  from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
  where not t.tgisinternal and n.nspname in ('compliance', 'platform', 'public')
), allr as (
  select * from cols union all select * from cons union all select * from idx union all select * from pol
  union all select * from fn union all select * from rls union all select * from grants union all select * from rgrants
  union all select * from trg
)`

async function state(db: PGlite): Promise<string[]> {
  return (await db.query<{ s: string }>(`${STATE_CTE} select s from allr order by s`)).rows.map((x) => x.s)
}

const applyAll = async (db: PGlite) => {
  for (const name of AWL_MIGRATIONS) await db.exec(forwardSql(name))
}
const undoAll = async (db: PGlite) => {
  for (const name of [...AWL_MIGRATIONS].reverse()) await db.exec(downSql(name))
}

// the 39 functions the ten migrations create, all in schema public: 17 named by spec section 10.11, 3 of the write path's executor
// (BUILD-002 WP-09a: claim, finish, draft state) and 19 helpers
const SPEC_FUNCTIONS = [
  "ai_work_link__resolve", "ai_work_link_log_call", "ai_work_link_log_call_result", "ai_work_link_context", "ai_work_link_records",
  "ai_work_link_record", "ai_work_link_record_intent", "ai_work_link_intent_status", "ai_work_link_history", "ai_work_link_create_for",
  "ai_work_link_draft_confirm", "ai_work_link_revoke_service",
  "ai_work_link_create", "ai_work_link_list", "ai_work_link_revoke", "ai_work_link_warning",
  "ai_work_link_call_retention",
]
const HELPER_FUNCTIONS = [
  "ai_work_link__role_rank", "ai_work_link__can_read_project", "ai_work_link__hash_token", "ai_work_link__ip_prefix",
  "ai_work_link__clean_path", "ai_work_link__mask_email", "ai_work_link__cost_visible", "ai_work_link__hidden_cols",
  "ai_work_link__project_people", "ai_work_link__eligibility", "ai_work_link__require", "ai_work_link__user_for_project",
  "ai_work_link__records_core", "ai_work_link__registry_version", "ai_work_link__create_call_partition", "ai_work_link_call_guard",
]
// BUILD-002 WP-09a (migration 0629): three functions the executor calls, and three helpers only they call
const WRITE_PATH_FUNCTIONS = ["ai_work_link_intent_claim", "ai_work_link_intent_finish", "ai_work_link_draft_state"]
const WRITE_PATH_HELPERS = ["ai_work_link__live", "ai_work_link__intent_state", "ai_work_link__sweep_intents"]
const ALL_FUNCTIONS = [...SPEC_FUNCTIONS, ...HELPER_FUNCTIONS, ...WRITE_PATH_FUNCTIONS, ...WRITE_PATH_HELPERS].sort()
// executable by the owner alone: the retention job (spec 10.10), the guard trigger function, and the helpers that only the other functions call
const OWNER_ONLY = [
  "ai_work_link_call_retention", "ai_work_link__cost_visible", "ai_work_link__hidden_cols", "ai_work_link__project_people",
  "ai_work_link__eligibility", "ai_work_link__require", "ai_work_link__user_for_project", "ai_work_link__records_core",
  "ai_work_link__create_call_partition", "ai_work_link_call_guard", ...WRITE_PATH_HELPERS,
]

const TABLES = ["ai_work_link_settings", "ai_work_link_record_kinds", "ai_work_link_functions", "ai_work_link_intent", "ai_work_link_call"]
const CONFIG_TABLES = ["ai_work_link_settings", "ai_work_link_record_kinds", "ai_work_link_functions"]

const monthsFromNow = (delta: number) => `(date_trunc('month', now() at time zone 'UTC') + interval '${delta} months')::date`

describe("drizzle/0621 to 0630 forward files on PGlite over the live-shaped base snapshot", () => {
  let db: PGlite
  let baseState: string[]
  let forwardState: string[]
  // read right after the first apply: later tests flip the switch and put it back, so only this reading shows what the migration created
  let switchAfterApply: { n: number; w: boolean }

  beforeAll(async () => {
    db = await openAwlPglite()
    baseState = await state(db)
    await applyAll(db)
    forwardState = await state(db)
    switchAfterApply = await one<{ n: number; w: boolean }>(db, "select count(*)::int n, bool_or(writes_enabled) w from platform.ai_work_link_settings")
  }, 120_000) // PGlite starts and the ten migrations apply here: slow on a loaded laptop, and bun's default hook limit is 5 s
  afterAll(async () => {
    await db.close()
  })

  test("the ten migrations apply in order, and the state differs from the base", () => {
    expect(AWL_MIGRATIONS.length).toBe(10)
    expect(forwardState.length).toBeGreaterThan(baseState.length + 100)
  })

  test("a second run of every forward file changes nothing, and never resets the writes_enabled switch", async () => {
    await db.exec("update platform.ai_work_link_settings set writes_enabled = true")
    await applyAll(db)
    expect((await one<{ w: boolean; n: number }>(db, "select writes_enabled w, (select count(*)::int from platform.ai_work_link_settings) n from platform.ai_work_link_settings")).w).toBe(true)
    expect((await one<{ n: number }>(db, "select count(*)::int n from platform.ai_work_link_settings")).n).toBe(1)
    await db.exec("update platform.ai_work_link_settings set writes_enabled = false")
    expect(await state(db)).toEqual(forwardState)
  })

  test("the switch is created OFF, and there is exactly one settings row", async () => {
    expect(switchAfterApply).toEqual({ n: 1, w: false })
    // and it is still one row, off, now
    const r = await one<{ n: number; w: boolean }>(db, "select count(*)::int n, bool_or(writes_enabled) w from platform.ai_work_link_settings")
    expect(r).toEqual({ n: 1, w: false })
  })

  test("BR-484: the register row's own two assertions read 1 and 1", async () => {
    const first = await one<{ v: number }>(
      db,
      `select case when count(*) >= 1 and count(*) filter (where has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE')) = 0 then 1 else 0 end v
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname like 'ai\\_work\\_link%' and p.proname not in ('ai_work_link_create', 'ai_work_link_list', 'ai_work_link_revoke', 'ai_work_link_warning')`,
    )
    expect(first.v).toBe(1)
    const second = await one<{ v: number }>(
      db,
      `select case when count(*) >= 1 and count(*) filter (where has_function_privilege('anon', p.oid, 'EXECUTE')) = 0 then 1 else 0 end v
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname like 'ai\\_work\\_link%'`,
    )
    expect(second.v).toBe(1)
  })

  test("the function inventory is exactly the 39 expected, and the four spec 'authenticated' functions are among them", async () => {
    const names = (await db.query<{ n: string }>("select p.proname n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace where ns.nspname = 'public' and p.proname like 'ai\\_work\\_link%' order by 1")).rows.map((r) => r.n)
    expect(names).toEqual(ALL_FUNCTIONS)
    expect(SPEC_FUNCTIONS.length).toBe(17)
    for (const f of ["ai_work_link_create", "ai_work_link_list", "ai_work_link_revoke", "ai_work_link_warning"]) expect(names).toContain(f)
  })

  test("grants: service_role runs the spec's functions and the pure helpers; the internal helpers and the retention job are owner-only; nobody else runs anything, PUBLIC included", async () => {
    const r = await db.query<{ n: string; anon: boolean; auth: boolean; app: boolean; svc: boolean; pub: boolean }>(
      `select p.proname n,
              has_function_privilege('anon', p.oid, 'EXECUTE') anon,
              has_function_privilege('authenticated', p.oid, 'EXECUTE') auth,
              has_function_privilege('app_runtime', p.oid, 'EXECUTE') app,
              has_function_privilege('service_role', p.oid, 'EXECUTE') svc,
              coalesce((select bool_or(a.grantee = 0) from aclexplode(p.proacl) a), false) pub
       from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
       where ns.nspname = 'public' and p.proname like 'ai\\_work\\_link%' order by 1`,
    )
    expect(r.rows.length).toBe(39)
    for (const row of r.rows) {
      expect({ n: row.n, anon: row.anon, auth: row.auth, app: row.app, pub: row.pub }).toEqual({ n: row.n, anon: false, auth: false, app: false, pub: false })
      expect({ n: row.n, svc: row.svc }).toEqual({ n: row.n, svc: !OWNER_ONLY.includes(row.n) })
    }
  })

  test("every SECURITY DEFINER function pins search_path to pg_catalog, pg_temp; every function does (no unpinned helper)", async () => {
    const r = await db.query<{ n: string; definer: boolean; cfg: string | null }>(
      `select p.proname n, p.prosecdef definer, array_to_string(p.proconfig, ',') cfg
       from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
       where ns.nspname in ('public', 'platform') and p.proname like 'ai\\_work\\_link%' order by 1`,
    )
    expect(r.rows.length).toBe(39) // all in schema public: the 37 of the link lifecycle and the two of the call log (trigger function, partition helper)
    const definers = r.rows.filter((x) => x.definer)
    expect(definers.length).toBeGreaterThanOrEqual(20)
    for (const row of r.rows) expect({ n: row.n, cfg: row.cfg }).toEqual({ n: row.n, cfg: "search_path=pg_catalog, pg_temp" })
  })

  test("the guard of SHARED_BOUNDARY.md (G-3): no SECURITY DEFINER function in platform or compliance is executable by anon or authenticated", async () => {
    const r = await one<{ n: number }>(
      db,
      `select count(*)::int n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
       where ns.nspname in ('platform', 'compliance') and p.prosecdef
         and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'))`,
    )
    expect(r.n).toBe(0)
  })

  test("the five tables have RLS on and forced, no policy, and no grant to anon, authenticated, PUBLIC or app_runtime", async () => {
    const parts = (await db.query<{ n: string }>("select c.relname n from pg_class c join pg_namespace ns on ns.oid = c.relnamespace where ns.nspname = 'platform' and c.relkind = 'r' and c.relispartition and c.relname like 'ai\_work\_link\_call\_2%'")).rows.map((r) => r.n)
    expect(parts.length).toBe(3)
    for (const t of [...TABLES, ...parts]) {
      const r = await one<Record<string, boolean>>(
        db,
        `select c.relrowsecurity rls, c.relforcerowsecurity forced,
                exists (select 1 from pg_policies p where p.schemaname = 'platform' and p.tablename = c.relname) has_policy,
                (has_table_privilege('anon', c.oid, 'SELECT') or has_table_privilege('anon', c.oid, 'INSERT') or has_table_privilege('anon', c.oid, 'UPDATE') or has_table_privilege('anon', c.oid, 'DELETE')) anon,
                (has_table_privilege('authenticated', c.oid, 'SELECT') or has_table_privilege('authenticated', c.oid, 'INSERT') or has_table_privilege('authenticated', c.oid, 'UPDATE') or has_table_privilege('authenticated', c.oid, 'DELETE')) auth,
                (has_table_privilege('app_runtime', c.oid, 'SELECT') or has_table_privilege('app_runtime', c.oid, 'INSERT') or has_table_privilege('app_runtime', c.oid, 'UPDATE') or has_table_privilege('app_runtime', c.oid, 'DELETE')) app,
                coalesce((select bool_or(a.grantee = 0) from aclexplode(c.relacl) a), false) pub,
                (has_table_privilege('service_role', c.oid, 'INSERT') or has_table_privilege('service_role', c.oid, 'UPDATE') or has_table_privilege('service_role', c.oid, 'DELETE')) svc_write,
                has_table_privilege('service_role', c.oid, 'SELECT') svc_read
         from pg_class c join pg_namespace ns on ns.oid = c.relnamespace where ns.nspname = 'platform' and c.relname = $1`,
        [t],
      )
      expect({ t, rls: r.rls, forced: r.forced, has_policy: r.has_policy, anon: r.anon, auth: r.auth, app: r.app, pub: r.pub, svc_write: r.svc_write }).toEqual({
        t, rls: true, forced: true, has_policy: false, anon: false, auth: false, app: false, pub: false, svc_write: false,
      })
      expect({ t, svc_read: r.svc_read }).toEqual({ t, svc_read: CONFIG_TABLES.includes(t) })
    }
  })

  test("BR-487: every link table column is timestamptz (the register row's SELECT reads 1), including the partitions", async () => {
    const reg = await one<{ v: number }>(
      db,
      `select case when count(distinct c.relname) >= 3 and count(*) filter (where a.atttypid = 'timestamp without time zone'::regtype) = 0 then 1 else 0 end v
       from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'platform' and c.relname like 'ai\\_work\\_link%' and c.relkind in ('r', 'p') and a.attnum > 0 and not a.attisdropped`,
    )
    expect(reg.v).toBe(1)
    const stamps = await one<{ n: number; naive: number }>(
      db,
      `select count(*) filter (where a.atttypid = 'timestamp with time zone'::regtype)::int n, count(*) filter (where a.atttypid in ('timestamp without time zone'::regtype, 'date'::regtype, 'time without time zone'::regtype))::int naive
       from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'platform' and c.relname = 'ai_work_link_call' and a.attnum > 0 and not a.attisdropped`,
    )
    expect(stamps.n).toBe(2)
    expect(stamps.naive).toBe(0)
  })

  test("BR-485: the guard trigger, the range partitioning and the three partitions of the current and next two months", async () => {
    expect((await one<{ n: number }>(db, "select count(*)::int n from pg_trigger where tgrelid = 'platform.ai_work_link_call'::regclass and tgname = 'ai_work_link_call_guard'")).n).toBe(1)
    expect((await one<{ n: number }>(db, "select count(*)::int n from pg_partitioned_table pt join pg_class c on c.oid = pt.partrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'platform' and c.relname = 'ai_work_link_call' and pt.partstrat = 'r'")).n).toBe(1)
    const want = (await db.query<{ n: string }>(`select 'ai_work_link_call_' || to_char(m, 'YYYY_MM') n from generate_series(0, 2) i, lateral (select ${monthsFromNow(0)} + make_interval(months => i) m) x order by 1`)).rows.map((r) => r.n)
    const have = (await db.query<{ n: string }>("select c.relname n from pg_inherits h join pg_class c on c.oid = h.inhrelid where h.inhparent = 'platform.ai_work_link_call'::regclass order by 1")).rows.map((r) => r.n)
    expect(have).toEqual(want)
    // every partition carries a copy of the guard trigger (a row trigger on the parent is cloned)
    const cloned = await one<{ n: number }>(db, "select count(*)::int n from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relispartition and t.tgname = 'ai_work_link_call_guard' and t.tgparentid <> 0")
    expect(cloned.n).toBe(3)
    // the bounds are UTC month starts
    const bound = await one<{ b: string }>(db, `select pg_get_expr(c.relpartbound, c.oid) b from pg_class c where c.relname = 'ai_work_link_call_' || to_char(${monthsFromNow(0)}, 'YYYY_MM')`)
    expect(bound.b).toMatch(/FROM \('\d{4}-\d{2}-01 00:00:00\+00'\) TO \('\d{4}-\d{2}-01 00:00:00\+00'\)/)
  })

  test("the call log is append-only: no delete, only a pending row's status, bytes and finished_at may be filled, once", async () => {
    await db.exec("insert into platform.ai_work_link_call (id, method, path) values ('call-1', 'GET', '/context')")
    const del = await failure(db, "delete from platform.ai_work_link_call where id = 'call-1'")
    expect(del.code).toBe("42501")
    expect(del.message).toContain("append-only")
    for (const col of ["method = 'POST'", "path = '/other'", "ip_prefix = '1.2.3.0/24'", "ua_family = 'x'", "org_id = 'o'", "link_id = 'no-such-link'", "called_at = called_at + interval '1 minute'", "id = 'call-2'"]) {
      // status is set in the same update on purpose: the guard also refuses an update that fills no status, so without it a column that
      // lost its freeze would still be refused and this loop could not tell
      const f = await failure(db, `update platform.ai_work_link_call set ${col}, status = 200 where id = 'call-1'`)
      expect({ col, code: f.code }).toEqual({ col, code: "42501" })
    }
    // a fill must set status
    expect((await failure(db, "update platform.ai_work_link_call set bytes = 5 where id = 'call-1'")).code).toBe("42501")
    await db.exec("update platform.ai_work_link_call set status = 200, bytes = 10, finished_at = now() where id = 'call-1'")
    expect((await one<{ s: number; b: number }>(db, "select status s, bytes b from platform.ai_work_link_call where id = 'call-1'"))).toEqual({ s: 200, b: 10 })
    // once: a second fill, and any later change, is refused
    expect((await failure(db, "update platform.ai_work_link_call set status = 500 where id = 'call-1'")).code).toBe("42501")
    expect((await failure(db, "update platform.ai_work_link_call set bytes = 11 where id = 'call-1'")).code).toBe("42501")
  })

  test("the guard fires for a role that has SELECT, UPDATE and DELETE but no EXECUTE on the trigger function (Postgres does not check it at fire time)", async () => {
    await db.exec("insert into platform.ai_work_link_call (id, method, path) values ('call-2', 'GET', '/context')")
    expect((await one<{ e: boolean }>(db, "select has_function_privilege('service_role', 'public.ai_work_link_call_guard()', 'EXECUTE') e")).e).toBe(false)
    await db.exec("grant usage on schema platform to service_role; grant select, update, delete on platform.ai_work_link_call to service_role")
    try {
      await db.exec("set role service_role")
      // the refusal must be the guard's own sentence, not a missing table privilege
      const del = await failure(db, "delete from platform.ai_work_link_call where id = 'call-2'")
      expect(del.message).toContain("append-only")
      const upd = await failure(db, "update platform.ai_work_link_call set method = 'PUT' where id = 'call-2'")
      expect(upd.message).toContain("append-only")
    } finally {
      await db.exec("reset role")
      await db.exec("revoke select, update, delete on platform.ai_work_link_call from service_role; revoke usage on schema platform from service_role")
    }
    // a role with no grant at all cannot even read the log
    await db.exec("set role app_runtime")
    const denied = await failure(db, "select 1 from platform.ai_work_link_call")
    await db.exec("reset role")
    expect(denied.code).toBe("42501")
    expect(denied.message).toContain("permission denied")
  })

  test("BR-486: the idempotency index is a PARTIAL unique index, and a failed, refused or expired intent frees its key", async () => {
    const def = await one<{ d: string }>(db, "select indexdef d from pg_indexes where schemaname = 'platform' and tablename = 'ai_work_link_intent' and indexname = 'ai_work_link_intent_idem_live'")
    expect(def.d.toLowerCase()).toMatch(/^create unique index.*\(link_id, idempotency_key\).*where.*status/)
    const reg = await one<{ n: number }>(db, "select count(*)::int n from pg_indexes where schemaname = 'platform' and tablename = 'ai_work_link_intent' and indexdef ilike 'create unique index%(link_id, idempotency_key)%where%status%'")
    expect(reg.n).toBe(1)

    await db.exec(`insert into platform.user_ai_links (id, org_id, user_id, product, project_id, token_hash, expires_at) values ('lnk-i', 'org-a', 'u-a', 'projexa', 'p-a', 'h-i', now() + interval '1 day')`)
    const ins = (id: string, key: string, status: string) =>
      db.query(
        `insert into platform.ai_work_link_intent (id, link_id, org_id, project_id, user_id, function_id, params, kind, idempotency_key, status, expires_at)
         values ($1, 'lnk-i', 'org-a', 'p-a', 'u-a', 'record_work_progress', '{}', 'action', $2, $3, now() + interval '1 hour')`,
        [id, key, status],
      )
    for (const held of ["recorded", "executing", "done", "awaiting_confirmation", "confirmed"]) {
      await ins(`held-${held}-1`, `k-${held}`, held)
      const dup = await failure(db, `insert into platform.ai_work_link_intent (id, link_id, org_id, project_id, user_id, function_id, params, kind, idempotency_key, status, expires_at)
        values ('held-${held}-2', 'lnk-i', 'org-a', 'p-a', 'u-a', 'record_work_progress', '{}', 'action', 'k-${held}', 'recorded', now() + interval '1 hour')`)
      expect({ held, code: dup.code }).toEqual({ held, code: "23505" })
    }
    for (const freed of ["failed", "refused", "expired"]) {
      await ins(`freed-${freed}-1`, `k-${freed}`, freed)
      // the key is free while the intent is failed, refused or expired: a retry with the same key is accepted, and can then be held itself
      await ins(`freed-${freed}-2`, `k-${freed}`, "recorded")
      const third = await failure(db, `insert into platform.ai_work_link_intent (id, link_id, org_id, project_id, user_id, function_id, params, kind, idempotency_key, status, expires_at)
        values ('freed-${freed}-3', 'lnk-i', 'org-a', 'p-a', 'u-a', 'record_work_progress', '{}', 'action', 'k-${freed}', 'recorded', now() + interval '1 hour')`)
      expect({ freed, code: third.code }).toEqual({ freed, code: "23505" })
    }
    // the same key on another link is a different key
    await db.exec(`insert into platform.user_ai_links (id, org_id, user_id, product, project_id, token_hash, expires_at) values ('lnk-j', 'org-a', 'u-b', 'projexa', 'p-a', 'h-j', now() + interval '1 day')`)
    await db.exec(`insert into platform.ai_work_link_intent (id, link_id, org_id, project_id, user_id, function_id, params, kind, idempotency_key, status, expires_at)
      values ('other-link', 'lnk-j', 'org-a', 'p-a', 'u-b', 'record_work_progress', '{}', 'action', 'k-done', 'done', now() + interval '1 hour')`)
  })

  test("the intent table's own checks: a bad kind or status, an over-long key, and a confirm token on an action are refused", async () => {
    const row = (kind: string, key: string, status: string, extra = "") =>
      `insert into platform.ai_work_link_intent (id, link_id, org_id, project_id, user_id, function_id, params, kind, idempotency_key, status, expires_at${extra ? ", confirm_token_hash" : ""})
       values ('x-${key.length}-${kind}-${status}', 'lnk-i', 'org-a', 'p-a', 'u-a', 'f', '{}', '${kind}', '${key}', '${status}', now() + interval '1 hour'${extra ? ", 'abc'" : ""})`
    expect((await failure(db, row("bogus", "kk1", "recorded"))).code).toBe("23514")
    expect((await failure(db, row("action", "kk2", "bogus"))).code).toBe("23514")
    expect((await failure(db, row("action", "k".repeat(129), "recorded"))).code).toBe("23514")
    expect((await failure(db, row("action", "kk3", "recorded", "token"))).code).toBe("23514")
    expect((await failure(db, row("draft", "kk5", "awaiting_confirmation", "token"))).code).toBe("")
    expect((await failure(db, "insert into platform.ai_work_link_intent (id, link_id, org_id, project_id, user_id, function_id, params, kind, idempotency_key, status, expires_at) values ('nolink', 'no-such-link', 'o', 'p', 'u', 'f', '{}', 'action', 'kk4', 'recorded', now())")).code).toBe("23503")
  })

  test("the seed: 27 reviewed functions of which exactly 10 are on links, 13 record kinds, and the registry version function reads the seed's hash", async () => {
    const r = await one<{ f: number; on_links: number; k: number }>(db, "select (select count(*)::int from platform.ai_work_link_functions) f, (select count(*)::int from platform.ai_work_link_functions where link_level is not null) on_links, (select count(*)::int from platform.ai_work_link_record_kinds) k")
    expect(r).toEqual({ f: 27, on_links: 10, k: 13 })
    const version = (await one<{ v: string }>(db, "select public.ai_work_link__registry_version() v")).v
    expect(version).toMatch(/^[0-9a-f]{64}$/)
    expect(read("drizzle/0628_build001_awl_seed.sql")).toContain(`-- registry version ${version}`)
  })

  // BUILD-002: 0628 is the frozen first seed; the generated JSON is the CURRENT registry, which is 0644's block (0628 plus six rows). So the
  // comparison applies 0644 on top of 0628 first, and puts the 0628 state back afterwards with 0628's own idempotent file (it deletes the
  // rows it does not name and upserts its own), so the tests after this one see the state they always saw.
  test("the seeded rows, after 0644, are exactly the generated JSON, row by row (the seed and the Edge Function's registry cannot differ)", async () => {
    await db.exec(forwardSql("0644_build002_awl_seed_project_boq"))
    type FnJson = { function_id: string; product: string; kind: string; link_level: number | null; money_sensitive: boolean; min_role_rank: number; excluded_reason: string | null; text_params: string[] }
    type KindJson = { kind: string; money_columns: string[]; filters: unknown }
    const fnJson = (JSON.parse(read("supabase/functions/ai-work-link/function-registry.generated.json")) as FnJson[]).map((f) => ({
      function_id: f.function_id, product: f.product, kind: f.kind, link_level: f.link_level, money_sensitive: f.money_sensitive, min_role_rank: f.min_role_rank, excluded_reason: f.excluded_reason, text_params: f.text_params,
    }))
    const fnRows = (await db.query<FnJson>("select function_id, product, kind, link_level::int link_level, money_sensitive, min_role_rank::int min_role_rank, excluded_reason, text_params from platform.ai_work_link_functions order by function_id")).rows
    expect(fnRows).toEqual(fnJson)
    // the kinds: 0644 keeps the 13 of 0628; BUILD-002 WP-06's 0643 is the generator's current seed migration, applied AFTER 0644, and holds
    // all 33 kinds with the whole function registry. So the generated JSON is compared with the rows after 0628 -> 0644 -> 0643.
    const kindJson = JSON.parse(read("supabase/functions/ai-work-link/record-kinds.generated.json")) as KindJson[]
    expect((await db.query<{ kind: string }>("select kind from platform.ai_work_link_record_kinds")).rows.map((r) => r.kind).sort()).toEqual(kindJson.slice(0, 13).map((k) => k.kind).sort())
    await db.exec(forwardSql("0643_build002_record_kinds"))
    const kindRows = (await db.query<KindJson>("select kind, money_columns, filters from platform.ai_work_link_record_kinds")).rows
    expect(kindRows).toHaveLength(33)
    expect([...kindRows].sort((a, b) => (a.kind < b.kind ? -1 : 1))).toEqual([...kindJson].sort((a, b) => (a.kind < b.kind ? -1 : 1)))
    const fnAfter = (await db.query<FnJson>("select function_id, product, kind, link_level::int link_level, money_sensitive, min_role_rank::int min_role_rank, excluded_reason, text_params from platform.ai_work_link_functions order by function_id")).rows
    expect(fnAfter).toEqual(fnJson)
    const version = (await one<{ v: string }>(db, "select public.ai_work_link__registry_version() v")).v
    expect(read("drizzle/0643_build002_record_kinds.sql")).toContain(`-- registry version ${version}`)
    // back to the 0628 state: 0643's down file restores the 0625 core and 0644's rows, then 0628's own idempotent file puts its rows back
    await db.exec(downSql("0643_build002_record_kinds"))
    await db.exec(forwardSql("0628_build001_awl_seed"))
    expect((await one<{ n: number }>(db, "select count(*)::int n from platform.ai_work_link_functions")).n).toBe(27)
    expect((await one<{ n: number }>(db, "select count(*)::int n from platform.ai_work_link_record_kinds")).n).toBe(13)
  })

  test("the function table refuses a function that is both on a link and excluded, and one that is neither", async () => {
    const ins = (level: string, reason: string) =>
      failure(db, `insert into platform.ai_work_link_functions (function_id, product, kind, link_level, money_sensitive, min_role_rank, excluded_reason) values ('t_${Math.random()}', 'projexa', 'read', ${level}, false, 1, ${reason})`)
    expect((await ins("1", "'why'")).code).toBe("23514")
    expect((await ins("null", "null")).code).toBe("23514")
    expect((await ins("7", "null")).code).toBe("23514")
  })

  test("retention creates the partitions ahead and drops whole partitions older than 90 days, without a single row delete", async () => {
    // an old partition with a row in it, one just inside the 90 days, and the current one with a row
    for (const back of [6, 5, 1]) await db.exec(`select public.ai_work_link__create_call_partition(${monthsFromNow(-back)})`)
    await db.exec(`insert into platform.ai_work_link_call (id, method, path, called_at) values ('old-6', 'GET', '/a', (${monthsFromNow(-6)})::timestamptz + interval '3 days')`)
    await db.exec(`insert into platform.ai_work_link_call (id, method, path, called_at) values ('old-5', 'GET', '/a', (${monthsFromNow(-5)})::timestamptz + interval '3 days')`)
    await db.exec(`insert into platform.ai_work_link_call (id, method, path, called_at) values ('recent-1', 'GET', '/a', (${monthsFromNow(-1)})::timestamptz + interval '3 days')`)
    // a month ahead that the retention job must create, by removing the third partition first
    const third = `ai_work_link_call_${(await one<{ m: string }>(db, `select to_char(${monthsFromNow(2)}, 'YYYY_MM') m`)).m}`
    await db.exec(`drop table platform.${third}`)

    const r = (await one<{ r: { created: string[]; dropped: string[]; keep_days: number } }>(db, "select public.ai_work_link_call_retention() r")).r
    expect(r.keep_days).toBe(90)
    expect(r.created).toEqual([third])
    expect(r.dropped.length).toBeGreaterThanOrEqual(2)
    const have = (await db.query<{ n: string }>("select c.relname n from pg_inherits h join pg_class c on c.oid = h.inhrelid where h.inhparent = 'platform.ai_work_link_call'::regclass")).rows.map((x) => x.n)
    for (const back of [6, 5]) {
      const name = `ai_work_link_call_${(await one<{ m: string }>(db, `select to_char(${monthsFromNow(-back)}, 'YYYY_MM') m`)).m}`
      expect(have).not.toContain(name)
      expect(r.dropped).toContain(name)
    }
    const recent = `ai_work_link_call_${(await one<{ m: string }>(db, `select to_char(${monthsFromNow(-1)}, 'YYYY_MM') m`)).m}`
    expect(have).toContain(recent)
    expect(have).toContain(third)
    expect((await db.query("select id from platform.ai_work_link_call where id in ('old-6', 'old-5')")).rows.length).toBe(0)
    expect((await db.query("select id from platform.ai_work_link_call where id = 'recent-1'")).rows.length).toBe(1)
    // the rows the job dropped were dropped with their partition: the log still refuses a row delete
    expect((await failure(db, "delete from platform.ai_work_link_call where id = 'recent-1'")).code).toBe("42501")
    // detached tables are gone, not left behind
    expect((await one<{ n: number }>(db, "select count(*)::int n from pg_class c join pg_namespace ns on ns.oid = c.relnamespace where ns.nspname = 'platform' and c.relname like 'ai\\_work\\_link\\_call\\_2%' and not c.relispartition")).n).toBe(0)
    // a second run has nothing to do
    const again = (await one<{ r: { created: string[]; dropped: string[] } }>(db, "select public.ai_work_link_call_retention() r")).r
    expect(again.created).toEqual([])
    expect(again.dropped).toEqual([])
    expect((await failure(db, "select public.ai_work_link_call_retention(0)")).message).toContain("at least 1")
  })
})

describe("the retention cron job, on a database with a stand-in cron schema", () => {
  let db: PGlite

  beforeAll(async () => {
    db = await openAwlPglite()
    // pg_cron's two facts this migration uses: a schema cron, a table cron.job, and cron.schedule(name, schedule, command) that
    // upserts by name and records the role that created the job
    await db.exec(`
      create schema cron;
      create table cron.job (jobid serial primary key, jobname text unique, schedule text not null, command text not null, username text not null default current_user, active boolean not null default true);
      create function cron.schedule(p_name text, p_schedule text, p_command text) returns bigint language sql as $$
        insert into cron.job (jobname, schedule, command) values (p_name, p_schedule, p_command)
        on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command returning jobid::bigint $$;
      create function cron.unschedule(p_name text) returns boolean language sql as $$
        with d as (delete from cron.job where jobname = p_name returning 1) select exists (select 1 from d) $$;
    `)
    await applyAll(db)
  }, 120_000)
  afterAll(async () => {
    await db.close()
  })

  test("BR-485: the job exists once, active, at 04:10 UTC daily, running the retention function as the applying role", async () => {
    const r = await db.query<{ jobname: string; schedule: string; command: string; active: boolean; username: string }>("select jobname, schedule, command, active, username from cron.job")
    expect(r.rows).toEqual([
      { jobname: "ai-work-link-call-retention", schedule: "10 4 * * *", command: "select public.ai_work_link_call_retention()", active: true, username: "postgres" },
    ])
    expect((await one<{ n: number }>(db, "select count(*)::int n from cron.job where jobname = 'ai-work-link-call-retention' and active")).n).toBe(1)
  })

  test("applying the migration again leaves one job", async () => {
    await db.exec(forwardSql("0627_build001_awl_retention"))
    expect((await one<{ n: number }>(db, "select count(*)::int n from cron.job")).n).toBe(1)
  })

  test("the job's own command text runs and returns the retention report", async () => {
    const cmd = (await one<{ c: string }>(db, "select command c from cron.job")).c
    const r = await db.query<Record<string, { keep_days: number }>>(cmd)
    expect(r.rows[0].ai_work_link_call_retention.keep_days).toBe(90)
  })

  test("the down file unschedules the job, and a second run is safe", async () => {
    await db.exec(downSql("0627_build001_awl_retention"))
    expect((await one<{ n: number }>(db, "select count(*)::int n from cron.job")).n).toBe(0)
    await db.exec(downSql("0627_build001_awl_retention"))
  })
})

describe("drizzle/down: the ten down files restore the base snapshot exactly", () => {
  let db: PGlite
  let baseState: string[]
  let forwardState: string[]

  beforeAll(async () => {
    db = await openAwlPglite()
    baseState = await state(db)
    await applyAll(db)
    forwardState = await state(db)
  }, 120_000)
  afterAll(async () => {
    await db.close()
  })

  test("applied in reverse order they leave the schema, grants, triggers and RLS flags exactly as the base was", async () => {
    await undoAll(db)
    expect(await state(db)).toEqual(baseState)
    // nothing of the link is left
    expect((await one<{ n: number }>(db, "select count(*)::int n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace where ns.nspname in ('public', 'platform') and p.proname like 'ai\\_work\\_link%'")).n).toBe(0)
    expect((await one<{ n: number }>(db, "select count(*)::int n from pg_class c join pg_namespace ns on ns.oid = c.relnamespace where ns.nspname = 'platform' and c.relname like 'ai\\_work\\_link%'")).n).toBe(0)
  })

  test("they are safe to run a second time (every step checks for its own object)", async () => {
    await undoAll(db)
    expect(await state(db)).toEqual(baseState)
  })

  test("platform.user_ai_links, its rows and its indexes are untouched by the whole round trip", async () => {
    await db.exec(`insert into platform.user_ai_links (id, org_id, user_id, token) values ('ver-keep', 'org-a', 'u-a', 'plaintext-veridian-token')`)
    await applyAll(db)
    await undoAll(db)
    expect((await one<{ n: number }>(db, "select count(*)::int n from platform.user_ai_links where id = 'ver-keep'")).n).toBe(1)
    expect(await state(db)).toEqual(baseState)
  })

  test("the forward files apply again after a rollback, to the same state as the first time", async () => {
    await applyAll(db)
    expect(await state(db)).toEqual(forwardState)
  })
})
