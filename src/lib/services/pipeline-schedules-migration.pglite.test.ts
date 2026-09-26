/// <reference types="bun-types" />
// PROJEXA-BUILD-001 U-40: offline proof of drizzle/0642_build001_pipeline_schedules.sql and its down file on PGlite (real Postgres
// compiled to WASM). No live database is touched.
//
// BASE: the committed snapshot scripts/verify/fixtures/0642_build001_pipeline_schedules.base.sql (compliance.users, compliance.submissions
// and compliance.audit_logs as they are live, read from the catalog of pcrjmlpuqsbocqfwoxod on 2026-09-25 with
// scripts/verify/gen-base-snapshot.mjs), after the roles the Supabase baseline has, schema compliance's live default privileges
// (SELECT, INSERT, UPDATE, DELETE on new tables to service_role and app_runtime) and a stand-in for Supabase Vault's decrypted view.
//
// WHAT IS PROVEN, in order (the tests of the first describe share one database and run in order):
//   1. before 0642 the table and the two functions do not exist;
//   2. 0642 adds exactly one table (12 columns, every timestamp timestamptz), its primary key, the foreign key to compliance.users
//      with ON DELETE CASCADE, three CHECKs, three indexes (one partial on next_run_at WHERE is_active), RLS enabled, two policies in
//      the pattern of report_schedules and the same 8 grants; and two SECURITY DEFINER functions in public; it changes nothing that
//      was there before; a second run changes nothing; without pg_cron it creates no job;
//   3. the CHECKs refuse a blank function id, a params value that is not a JSON object, and a cadence that is not five fields;
//   4. deleting the owner deletes the owner's schedules, and a schedule for a user that does not exist is refused;
//   5. for app_runtime, RLS shows each organisation only its own schedules, shows nothing with no organisation set, and refuses an
//      INSERT for another organisation; service_role sees all; anon, authenticated and public hold no privilege on the table;
//   6. both functions are SECURITY DEFINER, pinned to an empty search_path, executable by service_role alone; the bearer check is
//      true only for the Vault secret projexa_scheduler_bridge_secret (not for the timer's or the DPDP one); the due count counts
//      active schedules whose next_run_at is at or before now and nothing else;
//   7. the down file restores the base schema exactly, keeps every user, submission and audit row, is safe to run twice, and the
//      forward file applies again after it.
// The second describe runs 0642 against a stand-in pg_cron schema: the job projexa-scheduler-bridge is created once, at
// */5 * * * *, INACTIVE, its command posts to the Edge Function through the two Vault secrets and never names an /api/internal
// route (register row BR-516); a second run does not flip a job the PM switched on back off; the down file unschedules it.
//
// Run: bun test --isolate src/lib/services/pipeline-schedules-migration.pglite.test.ts
import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { readFileSync } from "node:fs"
import { PGlite } from "@electric-sql/pglite"

const REPO_ROOT = new URL("../../../", import.meta.url)
const read = (p: string) => readFileSync(new URL(p, REPO_ROOT), "utf8")
const FORWARD = read("drizzle/0642_build001_pipeline_schedules.sql")
const DOWN = read("drizzle/down/0642_build001_pipeline_schedules.down.sql")
const BASE = read("scripts/verify/fixtures/0642_build001_pipeline_schedules.base.sql")

const ROLES_SQL = `
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE ROLE authenticator NOLOGIN;
CREATE ROLE app_runtime NOLOGIN;
CREATE SCHEMA compliance;
GRANT USAGE ON SCHEMA compliance TO app_runtime, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA compliance GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO service_role, app_runtime;
CREATE SCHEMA vault;
-- Stand-in for Supabase Vault's view (the real one is a view over vault.secrets).
CREATE TABLE vault.decrypted_secrets (name text, decrypted_secret text, created_at timestamptz NOT NULL DEFAULT now());
`

const SEED_SQL = `
INSERT INTO compliance.users (id, name, email, password_hash, role, org_id) VALUES
  ('user-a', 'Asha M', 'asha@example.test', 'x', 'manager', 'org-a'),
  ('user-b', 'Ravi K', 'ravi@example.test', 'x', 'member', 'org-b'),
  ('user-c', 'Meera S', 'meera@example.test', 'x', 'member', 'org-a');
INSERT INTO compliance.submissions (id, org_id, mode, raw_input, user_id) VALUES ('sub-1', 'org-a', 'Projects', 'x', 'user-a');
INSERT INTO compliance.audit_logs (id, action, entity_type, entity_id, user_id, org_id, actor_name, actor_role)
  VALUES ('aud-1', 'x', 'y', 'z', 'user-a', 'org-a', 'Asha M', 'manager');
`

// Every object of schema compliance and every function of schema public the schema hash of scripts/verify/schema-hash.sql looks at,
// one line each. NOT NULL constraints (contype n, listed by Postgres 18) are left to the column lines.
const SNAPSHOT_SQL = `
with cols as (
  select 'col:'||table_name||'.'||lpad(ordinal_position::text, 3, '0')||'.'||column_name||':'||data_type||':'||is_nullable||':'||coalesce(column_default, '') s
  from information_schema.columns where table_schema = 'compliance'
), cons as (
  select 'con:'||c.relname||'.'||k.conname||':'||k.contype::text||':'||pg_get_constraintdef(k.oid) s
  from pg_constraint k join pg_class c on c.oid = k.conrelid join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'compliance' and k.contype <> 'n'
), idx as (
  select 'idx:'||tablename||'.'||indexname||':'||indexdef s from pg_indexes where schemaname = 'compliance'
), pol as (
  select 'pol:'||tablename||'.'||policyname||':'||cmd||':'||roles::text||':'||coalesce(qual, '')||':'||coalesce(with_check, '') s
  from pg_policies where schemaname = 'compliance'
), rls as (
  select 'rls:'||c.relname||':'||c.relrowsecurity::text||':'||c.relforcerowsecurity::text s
  from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.relkind in ('r', 'p') and n.nspname = 'compliance'
), grants as (
  select 'grant:'||table_name||':'||grantee||':'||privilege_type s from information_schema.role_table_grants
  where table_schema = 'compliance' and grantee <> 'postgres'
), fns as (
  select 'fn:'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||'):'||p.prosecdef::text||':'||coalesce(array_to_string(p.proconfig, ','), '')||':'||md5(pg_get_functiondef(p.oid))||':'||coalesce(p.proacl::text, '') s
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
)
select s from (select * from cols union all select * from cons union all select * from idx union all select * from pol
  union all select * from rls union all select * from grants union all select * from fns) a order by s`

let pg: PGlite

async function snapshot(db: PGlite = pg): Promise<string[]> {
  return (await db.query<{ s: string }>(SNAPSHOT_SQL)).rows.map((r) => r.s)
}
async function scalar(sql: string, db: PGlite = pg): Promise<string | null> {
  return (await db.query<{ v: string | null }>(`select ((${sql}))::text as v`)).rows[0]?.v ?? null
}
async function fails(sqlText: string, db: PGlite = pg): Promise<string> {
  try {
    await db.exec(sqlText)
  } catch (err) {
    return (err as Error).message
  }
  throw new Error("expected this SQL to fail")
}
async function asRole<T>(role: string, orgId: string | null, fn: () => Promise<T>): Promise<T> {
  await pg.exec("BEGIN")
  try {
    await pg.exec(`SET LOCAL ROLE ${role}`)
    if (orgId) await pg.query("select set_config('app.current_org_id', $1, true)", [orgId])
    return await fn()
  } finally {
    await pg.exec("ROLLBACK")
  }
}
const newLines = (after: string[], before: string[]) => after.filter((l) => !before.includes(l))
const insertSchedule = (id: string, over: { org?: string; owner?: string; fn?: string; params?: string; cadence?: string; next?: string; active?: boolean } = {}) =>
  `INSERT INTO compliance.pipeline_schedules (id, org_id, owner_user_id, function_id, params, cadence, next_run_at, is_active)
   VALUES ('${id}', '${over.org ?? "org-a"}', '${over.owner ?? "user-a"}', '${over.fn ?? "get_construction_project_dashboard"}',
           '${over.params ?? '{"projectId":"p-1"}'}'::jsonb, '${over.cadence ?? "0 9 * * 1-5"}', '${over.next ?? "2026-09-26T09:00:00Z"}', ${over.active ?? true})`

let s0: string[] = []
let s1: string[] = []
let originalUsers: string[] = []

beforeAll(async () => {
  pg = await PGlite.create()
  await pg.exec(ROLES_SQL)
  await pg.exec(BASE)
  await pg.exec(SEED_SQL)
  originalUsers = (await pg.query<{ j: string }>("select to_jsonb(u)::text j from compliance.users u order by id")).rows.map((r) => r.j)
  s0 = await snapshot()
}, 60_000)

afterAll(async () => {
  await pg?.close()
})

describe("drizzle/0642 build001_pipeline_schedules on the 2026-09-25 base (PGlite)", () => {
  test("1. before 0642 the table and the two functions do not exist", async () => {
    expect(await scalar("select to_regclass('compliance.pipeline_schedules') is null")).toBe("true")
    expect(s0.filter((l) => l.startsWith("fn:"))).toEqual([])
    expect(originalUsers).toHaveLength(3)
  })

  test("2. 0642 adds exactly the table, its constraints, indexes, RLS, policies and grants and the two functions; a second run changes nothing", async () => {
    await pg.exec(FORWARD)
    s1 = await snapshot()
    const added = newLines(s1, s0)

    expect(added.filter((l) => !l.startsWith("fn:"))).toEqual(
      [
        "col:pipeline_schedules.001.id:text:NO:(gen_random_uuid())::text",
        "col:pipeline_schedules.002.org_id:text:NO:",
        "col:pipeline_schedules.003.owner_user_id:text:NO:",
        "col:pipeline_schedules.004.function_id:text:NO:",
        "col:pipeline_schedules.005.params:jsonb:NO:'{}'::jsonb",
        "col:pipeline_schedules.006.cadence:text:NO:",
        "col:pipeline_schedules.007.next_run_at:timestamp with time zone:NO:",
        "col:pipeline_schedules.008.last_run_at:timestamp with time zone:YES:",
        "col:pipeline_schedules.009.last_result:jsonb:YES:",
        "col:pipeline_schedules.010.is_active:boolean:NO:true",
        "col:pipeline_schedules.011.created_at:timestamp with time zone:NO:now()",
        "col:pipeline_schedules.012.updated_at:timestamp with time zone:NO:now()",
        "con:pipeline_schedules.pipeline_schedules_cadence_check:c:CHECK ((btrim(cadence) ~ '^\\S+(\\s+\\S+){4}$'::text))",
        "con:pipeline_schedules.pipeline_schedules_function_id_check:c:CHECK ((btrim(function_id) <> ''::text))",
        "con:pipeline_schedules.pipeline_schedules_owner_user_id_fkey:f:FOREIGN KEY (owner_user_id) REFERENCES compliance.users(id) ON DELETE CASCADE",
        "con:pipeline_schedules.pipeline_schedules_params_check:c:CHECK ((jsonb_typeof(params) = 'object'::text))",
        "con:pipeline_schedules.pipeline_schedules_pkey:p:PRIMARY KEY (id)",
        "grant:pipeline_schedules:app_runtime:DELETE",
        "grant:pipeline_schedules:app_runtime:INSERT",
        "grant:pipeline_schedules:app_runtime:SELECT",
        "grant:pipeline_schedules:app_runtime:UPDATE",
        "grant:pipeline_schedules:service_role:DELETE",
        "grant:pipeline_schedules:service_role:INSERT",
        "grant:pipeline_schedules:service_role:SELECT",
        "grant:pipeline_schedules:service_role:UPDATE",
        "idx:pipeline_schedules.idx_pipeline_schedules_due:CREATE INDEX idx_pipeline_schedules_due ON compliance.pipeline_schedules USING btree (next_run_at) WHERE is_active",
        "idx:pipeline_schedules.idx_pipeline_schedules_org_id:CREATE INDEX idx_pipeline_schedules_org_id ON compliance.pipeline_schedules USING btree (org_id)",
        "idx:pipeline_schedules.idx_pipeline_schedules_owner_user_id:CREATE INDEX idx_pipeline_schedules_owner_user_id ON compliance.pipeline_schedules USING btree (owner_user_id)",
        "idx:pipeline_schedules.pipeline_schedules_pkey:CREATE UNIQUE INDEX pipeline_schedules_pkey ON compliance.pipeline_schedules USING btree (id)",
        "pol:pipeline_schedules.app_runtime_org_scoped:ALL:{app_runtime}:(org_id = compliance.current_org_id()):",
        "pol:pipeline_schedules.service_role_bypass_pipeline_schedules:ALL:{service_role}:true:",
        "rls:pipeline_schedules:true:false",
      ].sort()
    )
    expect(added.filter((l) => l.startsWith("fn:")).map((l) => l.split(":")[0] + ":" + l.split(":")[1])).toEqual([
      "fn:projexa_scheduler_bridge_check_bearer(p_bearer text)",
      "fn:projexa_scheduler_bridge_due_count()",
    ])
    // Nothing that was there before is gone or changed.
    expect(newLines(s0, s1)).toEqual([])
    expect(await scalar("select count(*) from compliance.users")).toBe("3")

    await pg.exec(FORWARD)
    expect(await snapshot()).toEqual(s1)
  })

  test("2b. without pg_cron the forward file creates no job (there is no cron schema to hold one)", async () => {
    expect(await scalar("select to_regnamespace('cron') is null")).toBe("true")
  })

  test("3. the CHECKs refuse a blank function id, a params value that is not a JSON object, and a cadence that is not five fields", async () => {
    expect(await fails(insertSchedule("s-blank", { fn: "   " }))).toContain("pipeline_schedules_function_id_check")
    for (const params of ["[]", '"text"', "5", "null"]) {
      expect(await fails(insertSchedule("s-params", { params }))).toContain("pipeline_schedules_params_check") // "null" here is the JSON null, not SQL NULL
    }
    for (const cadence of ["", "* * * *", "* * * * * *", "daily"]) {
      expect(await fails(insertSchedule("s-cadence", { cadence }))).toContain("pipeline_schedules_cadence_check")
    }
    expect(await scalar("select count(*) from compliance.pipeline_schedules")).toBe("0")
    await pg.exec(insertSchedule("s-ok", { cadence: "  */5   * * * *  " }))
    expect(await scalar("select count(*) from compliance.pipeline_schedules where id = 's-ok'")).toBe("1")
    await pg.exec("DELETE FROM compliance.pipeline_schedules WHERE id = 's-ok'")
  })

  test("4. deleting the owner deletes the owner's schedules (ON DELETE CASCADE); a schedule for a user that does not exist is refused", async () => {
    await pg.exec(`INSERT INTO compliance.users (id, name, email, password_hash, org_id) VALUES ('user-gone', 'Gone', 'gone@example.test', 'x', 'org-a')`)
    await pg.exec(insertSchedule("s-gone-1", { owner: "user-gone" }))
    await pg.exec(insertSchedule("s-gone-2", { owner: "user-gone" }))
    await pg.exec(insertSchedule("s-kept", { owner: "user-c" }))
    await pg.exec("DELETE FROM compliance.users WHERE id = 'user-gone'")
    expect(await scalar("select count(*) from compliance.pipeline_schedules where owner_user_id = 'user-gone'")).toBe("0")
    expect(await scalar("select count(*) from compliance.pipeline_schedules where id = 's-kept'")).toBe("1")

    expect(await fails(insertSchedule("s-orphan", { owner: "user-missing" }))).toContain("pipeline_schedules_owner_user_id_fkey")
    await pg.exec("DELETE FROM compliance.pipeline_schedules WHERE id = 's-kept'")
    expect(await scalar("select count(*) from compliance.pipeline_schedules")).toBe("0")
  })

  test("5. for app_runtime, RLS shows each organisation only its own schedules, nothing without an organisation, and refuses another organisation's INSERT", async () => {
    await pg.exec(insertSchedule("s-a1", { org: "org-a", owner: "user-a" }))
    await pg.exec(insertSchedule("s-a2", { org: "org-a", owner: "user-c" }))
    await pg.exec(insertSchedule("s-b1", { org: "org-b", owner: "user-b" }))
    const ids = () => pg.query<{ id: string }>("select id from compliance.pipeline_schedules order by id").then((r) => r.rows.map((x) => x.id))

    expect(await asRole("app_runtime", "org-a", ids)).toEqual(["s-a1", "s-a2"])
    expect(await asRole("app_runtime", "org-b", ids)).toEqual(["s-b1"])
    expect(await asRole("app_runtime", null, ids)).toEqual([])
    expect(await asRole("service_role", null, ids)).toEqual(["s-a1", "s-a2", "s-b1"])

    const refused = await asRole("app_runtime", "org-a", async () => {
      try {
        await pg.exec(insertSchedule("s-x", { org: "org-b", owner: "user-b" }))
        return ""
      } catch (err) {
        return (err as Error).message
      }
    })
    expect(refused).toContain("row-level security")
    const ownOrg = await asRole("app_runtime", "org-a", async () => {
      await pg.exec(insertSchedule("s-a3", { org: "org-a", owner: "user-a" }))
      return scalar("select count(*) from compliance.pipeline_schedules")
    })
    expect(ownOrg).toBe("3")

    for (const role of ["anon", "authenticated"]) {
      for (const priv of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
        expect(await scalar(`select has_table_privilege('${role}', 'compliance.pipeline_schedules', '${priv}')`)).toBe("false")
      }
    }
    // PUBLIC (grantee 0) holds nothing either.
    expect(await scalar("select count(*) from pg_class c cross join lateral aclexplode(c.relacl) a where c.oid = 'compliance.pipeline_schedules'::regclass and a.grantee = 0")).toBe("0")
  })

  test("6a. both functions are SECURITY DEFINER, pinned to an empty search_path, and executable by service_role alone", async () => {
    const r = (
      await pg.query<{ definers: number; anon: number; auth: number; pub: number; app: number; svc: number; pinned: number }>(
        `select count(*) filter (where p.prosecdef)::int definers,
                count(*) filter (where has_function_privilege('anon', p.oid, 'EXECUTE'))::int anon,
                count(*) filter (where has_function_privilege('authenticated', p.oid, 'EXECUTE'))::int auth,
                count(*) filter (where p.proacl is null or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0))::int pub,
                count(*) filter (where has_function_privilege('app_runtime', p.oid, 'EXECUTE'))::int app,
                count(*) filter (where has_function_privilege('service_role', p.oid, 'EXECUTE'))::int svc,
                count(*) filter (where array_to_string(p.proconfig, ',') = 'search_path=""')::int pinned
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname like 'projexa\\_scheduler\\_bridge\\_%'`
      )
    ).rows[0]
    expect(r).toEqual({ definers: 2, anon: 0, auth: 0, pub: 0, app: 0, svc: 2, pinned: 2 })
  })

  test("6b. projexa_scheduler_bridge_check_bearer: false with no secret, false for another job's secret, false for a wrong or short bearer, true only for its own secret", async () => {
    const secret = "s".repeat(48)
    const check = async (b: string | null) => scalar(`select public.projexa_scheduler_bridge_check_bearer(${b === null ? "null" : `'${b}'`})`)
    expect(await check(secret)).toBe("false")
    await pg.exec(`insert into vault.decrypted_secrets (name, decrypted_secret) values ('dpdp_timer_secret', '${secret}'), ('projexa_timer_secret', '${secret}')`)
    expect(await check(secret)).toBe("false")
    await pg.exec(`insert into vault.decrypted_secrets (name, decrypted_secret) values ('projexa_scheduler_bridge_secret', '${secret}')`)
    expect(await check(secret)).toBe("true")
    expect(await check("x".repeat(48))).toBe("false")
    expect(await check("short")).toBe("false")
    expect(await check(null)).toBe("false")
    await pg.exec("delete from vault.decrypted_secrets")
    expect(await check(secret)).toBe("false")
  })

  test("6c. projexa_scheduler_bridge_due_count counts active schedules due now, and nothing else", async () => {
    await pg.exec("DELETE FROM compliance.pipeline_schedules")
    const due = () => scalar("select public.projexa_scheduler_bridge_due_count()")
    expect(await due()).toBe("0")
    await pg.exec(insertSchedule("d-past", { next: "2020-01-01T00:00:00Z" }))
    await pg.exec(insertSchedule("d-past-2", { next: "2020-01-02T00:00:00Z", org: "org-b", owner: "user-b" }))
    await pg.exec(insertSchedule("d-inactive", { next: "2020-01-01T00:00:00Z", active: false }))
    await pg.exec(insertSchedule("d-future", { next: "2999-01-01T00:00:00Z" }))
    expect(await due()).toBe("2")
    await pg.exec("UPDATE compliance.pipeline_schedules SET next_run_at = '2999-01-01T00:00:00Z' WHERE id = 'd-past'")
    expect(await due()).toBe("1")
    await pg.exec("DELETE FROM compliance.pipeline_schedules")
  })

  test("7. the down file restores the base schema exactly, keeps every user, submission and audit row, is safe to run twice; the forward file applies again", async () => {
    await pg.exec(insertSchedule("last-1"))
    await pg.exec(DOWN)
    expect(await snapshot()).toEqual(s0)
    expect((await pg.query<{ j: string }>("select to_jsonb(u)::text j from compliance.users u order by id")).rows.map((r) => r.j)).toEqual(originalUsers)
    expect(await scalar("select (select count(*) from compliance.submissions) || '/' || (select count(*) from compliance.audit_logs)")).toBe("1/1")
    await pg.exec(DOWN)
    expect(await snapshot()).toEqual(s0)

    await pg.exec(FORWARD)
    expect(await snapshot()).toEqual(s1)
    expect(await scalar("select count(*) from compliance.pipeline_schedules")).toBe("0")
  })
})

// A stand-in for the parts of pg_cron the migration and its down file use, with the signatures of pg_cron 1.6: cron.schedule(name,
// schedule, command) upserts by name and returns the job id, cron.alter_job(job_id, ..., active) changes a job, cron.unschedule(name).
const CRON_STUB_SQL = `
CREATE SCHEMA cron;
CREATE TABLE cron.job (jobid bigserial PRIMARY KEY, jobname text UNIQUE, schedule text NOT NULL, command text NOT NULL, active boolean NOT NULL DEFAULT true);
CREATE FUNCTION cron.schedule(job_name text, schedule text, command text) RETURNS bigint LANGUAGE sql AS $f$
  INSERT INTO cron.job (jobname, schedule, command) VALUES (job_name, schedule, command)
  ON CONFLICT (jobname) DO UPDATE SET schedule = EXCLUDED.schedule, command = EXCLUDED.command, active = true
  RETURNING jobid $f$;
CREATE FUNCTION cron.alter_job(job_id bigint, schedule text DEFAULT NULL, command text DEFAULT NULL, database text DEFAULT NULL, username text DEFAULT NULL, active boolean DEFAULT NULL)
  RETURNS void LANGUAGE sql AS $f$
  UPDATE cron.job SET schedule = coalesce(alter_job.schedule, cron.job.schedule), command = coalesce(alter_job.command, cron.job.command), active = coalesce(alter_job.active, cron.job.active) WHERE jobid = job_id $f$;
CREATE FUNCTION cron.unschedule(job_name text) RETURNS boolean LANGUAGE sql AS $f$ WITH d AS (DELETE FROM cron.job WHERE jobname = job_name RETURNING 1) SELECT count(*) > 0 FROM d $f$;
`

describe("drizzle/0642 with pg_cron present (stand-in cron schema on PGlite)", () => {
  let cron: PGlite
  const jobs = async () =>
    (await cron.query<{ jobname: string; schedule: string; command: string; active: boolean }>("select jobname, schedule, command, active from cron.job order by jobid")).rows

  beforeAll(async () => {
    cron = await PGlite.create()
    await cron.exec(ROLES_SQL)
    await cron.exec(BASE)
    await cron.exec(CRON_STUB_SQL)
  }, 60_000)
  afterAll(async () => {
    await cron?.close()
  })

  test("the job projexa-scheduler-bridge is created once, every 5 minutes, INACTIVE, and its command never names an /api/internal route", async () => {
    await cron.exec(FORWARD)
    const rows = await jobs()
    expect(rows).toHaveLength(1)
    const job = rows[0]
    expect(job.jobname).toBe("projexa-scheduler-bridge")
    expect(job.schedule).toBe("*/5 * * * *")
    expect(job.active).toBe(false)
    // BR-516 in miniature: one job of that name, none whose command calls an /api/internal/ route.
    expect(rows.filter((j) => j.command.includes("/api/internal/"))).toEqual([])
    expect(job.command).not.toContain("/api/internal")
    // It posts to the Edge Function through Vault, like projexa-exchange-rate-refresh, with its own two secrets.
    expect(job.command).toContain("net.http_post")
    expect(job.command).toContain("name = 'projexa_scheduler_bridge_url'")
    expect(job.command).toContain("name = 'projexa_scheduler_bridge_secret'")
    expect(job.command).toContain('{"job":"scheduler_bridge"}')
    expect(job.command).not.toContain("projexa_timer")
    expect(job.command).not.toContain("dpdp")
  })

  test("a second run creates no second job and does not switch a job the PM turned on back off", async () => {
    await cron.exec("UPDATE cron.job SET active = true WHERE jobname = 'projexa-scheduler-bridge'")
    await cron.exec(FORWARD)
    const rows = await jobs()
    expect(rows).toHaveLength(1)
    expect(rows[0].active).toBe(true)
  })

  test("other jobs are left alone, and the down file unschedules only this one, whether it is on or off, and is safe to run twice", async () => {
    await cron.exec(`INSERT INTO cron.job (jobname, schedule, command) VALUES ('projexa-exchange-rate-refresh', '30 9 * * *', 'select 1'), ('dpdp-legal-clocks', '30 3 * * *', 'select 2')`)
    await cron.exec(DOWN)
    expect((await jobs()).map((j) => j.jobname)).toEqual(["projexa-exchange-rate-refresh", "dpdp-legal-clocks"])
    await cron.exec(DOWN)
    expect((await jobs()).map((j) => j.jobname)).toEqual(["projexa-exchange-rate-refresh", "dpdp-legal-clocks"])
    expect((await cron.query<{ n: number }>("select count(*)::int n from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'projexa\\_scheduler\\_bridge\\_%'")).rows[0].n).toBe(0)
  })
})
