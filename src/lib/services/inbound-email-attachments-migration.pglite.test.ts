/// <reference types="bun-types" />
// PROJEXA-BUILD-001 U-31: offline proof of drizzle/0620_build001_inbound_email_attachments.sql and its down file on PGlite
// (real Postgres compiled to WASM). No live database is touched.
//
// BASE: the committed snapshot scripts/verify/fixtures/0620_build001_inbound_email_attachments.base.sql, read from the live
// catalog of pcrjmlpuqsbocqfwoxod on 2026-09-25 (compliance.inbound_email_messages as it is live: RLS enabled and not forced,
// one app_runtime SELECT policy on compliance.current_org_id(), the service_role bypass, table grants to app_runtime and
// service_role), after the roles the Supabase baseline has and schema compliance's live default privileges
// (pg_default_acl, read 2026-09-25: SELECT, INSERT, UPDATE, DELETE on new tables to service_role and app_runtime).
//
// WHAT IS PROVEN, in order (the tests share one database and run in order):
//   1. before 0620 the table does not exist;
//   2. 0620 adds exactly one table (9 columns), its primary key, the foreign key to inbound_email_messages with ON DELETE
//      CASCADE, the size CHECK, one index on inbound_message_id, RLS enabled AND forced, two policies and the same 8 grants
//      as inbound_email_messages; it changes nothing on inbound_email_messages; a second run changes nothing;
//   3. deleting a message deletes its attachments, and an attachment of a message that does not exist is refused;
//   4. the CHECK refuses a file over 10485760 bytes and a size_bytes that is not the stored length, and accepts exactly
//      10485760 bytes;
//   5. for app_runtime, RLS shows each organisation only its own attachments, shows nothing with no organisation set, and
//      refuses an INSERT;
//   6. the down file restores the base schema exactly, keeps every message row, is safe to run twice, and the forward file
//      applies again after it.
//
// Run: bun test --isolate src/lib/services/inbound-email-attachments-migration.pglite.test.ts
import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { readFileSync } from "node:fs"
import { PGlite } from "@electric-sql/pglite"

const REPO_ROOT = new URL("../../../", import.meta.url)
const read = (p: string) => readFileSync(new URL(p, REPO_ROOT), "utf8")
const FORWARD = read("drizzle/0620_build001_inbound_email_attachments.sql")
const DOWN = read("drizzle/down/0620_build001_inbound_email_attachments.down.sql")
const BASE = read("scripts/verify/fixtures/0620_build001_inbound_email_attachments.base.sql")

const ROLES_SQL = `
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE ROLE authenticator NOLOGIN;
CREATE ROLE app_runtime NOLOGIN;
CREATE SCHEMA compliance;
GRANT USAGE ON SCHEMA compliance TO app_runtime, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA compliance GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO service_role, app_runtime;
`

const SEED_SQL = `
INSERT INTO compliance.inbound_email_messages (id, org_id, user_id, from_address, to_address, subject, resend_message_id, received_at) VALUES
  ('msg-a', 'org-a', 'user-a', 'site@vendor.test', 'asha@mail.veridian-aios.com', 'BOQ for Villa 21', 'email_a', '2026-09-25 10:00:00'),
  ('msg-b', 'org-b', 'user-b', 'site@other.test', 'ravi@mail.veridian-aios.com', 'Tower B BOQ', 'email_b', '2026-09-25 11:00:00'),
  ('msg-none', NULL, NULL, 'x@unknown.test', 'nobody@mail.veridian-aios.com', 'misdirected', 'email_none', '2026-09-25 12:00:00');
`

// Every object of schema compliance the hash of scripts/verify/schema-hash.sql looks at, one line each. NOT NULL
// constraints (contype n, listed by Postgres 18) are left to the column lines.
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
)
select s from (select * from cols union all select * from cons union all select * from idx union all select * from pol
  union all select * from rls union all select * from grants) a order by s`

let pg: PGlite

async function snapshot(): Promise<string[]> {
  return (await pg.query<{ s: string }>(SNAPSHOT_SQL)).rows.map((r) => r.s)
}
async function scalar(sql: string): Promise<string | null> {
  return (await pg.query<{ v: string | null }>(`select ((${sql}))::text as v`)).rows[0]?.v ?? null
}
async function messages(): Promise<string[]> {
  return (await pg.query<{ j: string }>("select to_jsonb(m)::text j from compliance.inbound_email_messages m order by id")).rows.map((r) => r.j)
}
async function fails(sqlText: string): Promise<string> {
  try {
    await pg.exec(sqlText)
  } catch (err) {
    return (err as Error).message
  }
  throw new Error("expected this SQL to fail")
}
const newLines = (after: string[], before: string[]) => after.filter((l) => !before.includes(l))

let s0: string[] = []
let s1: string[] = []
let originalMessages: string[] = []

beforeAll(async () => {
  pg = await PGlite.create()
  await pg.exec(ROLES_SQL)
  await pg.exec(BASE)
  await pg.exec(SEED_SQL)
  originalMessages = await messages()
  s0 = await snapshot()
}, 60_000)

afterAll(async () => {
  await pg?.close()
})

describe("drizzle/0620 build001_inbound_email_attachments on the 2026-09-25 base (PGlite)", () => {
  test("1. before 0620 the table does not exist, and the base is inbound_email_messages as it is live", async () => {
    expect(await scalar("select to_regclass('compliance.inbound_email_attachments') is null")).toBe("true")
    expect(s0).toContain("rls:inbound_email_messages:true:false")
    expect(originalMessages).toHaveLength(3)
  })

  test("2. 0620 adds exactly the table and its constraints, index, forced RLS, policies and grants; a second run changes nothing", async () => {
    await pg.exec(FORWARD)
    s1 = await snapshot()

    expect(newLines(s1, s0)).toEqual(
      [
        "col:inbound_email_attachments.001.id:text:NO:",
        "col:inbound_email_attachments.002.org_id:text:NO:",
        "col:inbound_email_attachments.003.inbound_message_id:text:NO:",
        "col:inbound_email_attachments.004.file_name:text:NO:",
        "col:inbound_email_attachments.005.content_type:text:YES:",
        "col:inbound_email_attachments.006.size_bytes:integer:NO:",
        "col:inbound_email_attachments.007.content:bytea:NO:",
        "col:inbound_email_attachments.008.resend_attachment_id:text:YES:",
        "col:inbound_email_attachments.009.created_at:timestamp with time zone:NO:now()",
        "con:inbound_email_attachments.inbound_email_attachments_inbound_message_id_fkey:f:FOREIGN KEY (inbound_message_id) REFERENCES compliance.inbound_email_messages(id) ON DELETE CASCADE",
        "con:inbound_email_attachments.inbound_email_attachments_pkey:p:PRIMARY KEY (id)",
        "con:inbound_email_attachments.inbound_email_attachments_size_check:c:CHECK (((size_bytes <= 10485760) AND (octet_length(content) <= 10485760) AND (size_bytes = octet_length(content))))",
        "grant:inbound_email_attachments:app_runtime:DELETE",
        "grant:inbound_email_attachments:app_runtime:INSERT",
        "grant:inbound_email_attachments:app_runtime:SELECT",
        "grant:inbound_email_attachments:app_runtime:UPDATE",
        "grant:inbound_email_attachments:service_role:DELETE",
        "grant:inbound_email_attachments:service_role:INSERT",
        "grant:inbound_email_attachments:service_role:SELECT",
        "grant:inbound_email_attachments:service_role:UPDATE",
        "idx:inbound_email_attachments.idx_inbound_email_attachments_inbound_message_id:CREATE INDEX idx_inbound_email_attachments_inbound_message_id ON compliance.inbound_email_attachments USING btree (inbound_message_id)",
        "idx:inbound_email_attachments.inbound_email_attachments_pkey:CREATE UNIQUE INDEX inbound_email_attachments_pkey ON compliance.inbound_email_attachments USING btree (id)",
        "pol:inbound_email_attachments.app_runtime_read_own_org_inbound_email_attachments:SELECT:{app_runtime}:(org_id = compliance.current_org_id()):",
        "pol:inbound_email_attachments.service_role_bypass_inbound_email_attachments:ALL:{service_role}:true:true",
        "rls:inbound_email_attachments:true:true",
      ].sort()
    )
    // Nothing that was there before is gone or changed: inbound_email_messages is untouched.
    expect(newLines(s0, s1)).toEqual([])
    // Its grants and policies are the model the new table copies.
    expect(s1.filter((l) => l.startsWith("grant:inbound_email_messages:")).map((l) => l.split(":").slice(2).join(":"))).toEqual(
      s1.filter((l) => l.startsWith("grant:inbound_email_attachments:")).map((l) => l.split(":").slice(2).join(":"))
    )
    expect(await messages()).toEqual(originalMessages)

    await pg.exec(FORWARD)
    expect(await snapshot()).toEqual(s1)
  })

  test("3. deleting a message deletes its attachments (ON DELETE CASCADE); an attachment of a missing message is refused", async () => {
    await pg.exec(`
      INSERT INTO compliance.inbound_email_messages (id, org_id, from_address, to_address, resend_message_id, received_at)
        VALUES ('msg-gone', 'org-a', 'f@x.test', 't@x.test', 'email_gone', now());
      INSERT INTO compliance.inbound_email_attachments (id, org_id, inbound_message_id, file_name, content_type, size_bytes, content, resend_attachment_id) VALUES
        ('att-g1', 'org-a', 'msg-gone', 'a.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 4, '\\x504b0304'::bytea, 'r-g1'),
        ('att-g2', 'org-a', 'msg-gone', 'b.pdf', 'application/pdf', 3, '\\x255044'::bytea, 'r-g2');
    `)
    expect(await scalar("select count(*) from compliance.inbound_email_attachments where inbound_message_id = 'msg-gone'")).toBe("2")

    await pg.exec("DELETE FROM compliance.inbound_email_messages WHERE id = 'msg-gone'")
    expect(await scalar("select count(*) from compliance.inbound_email_attachments where inbound_message_id = 'msg-gone'")).toBe("0")

    const message = await fails(
      "INSERT INTO compliance.inbound_email_attachments (id, org_id, inbound_message_id, file_name, size_bytes, content) VALUES ('att-orphan', 'org-a', 'msg-missing', 'c.xlsx', 1, '\\x00'::bytea)"
    )
    expect(message).toContain("inbound_email_attachments_inbound_message_id_fkey")
    expect(await scalar("select count(*) from compliance.inbound_email_attachments")).toBe("0")
  })

  test("4. the size CHECK refuses over 10485760 bytes and a size_bytes that is not the stored length; exactly 10485760 is stored", async () => {
    const insert = (id: string, sizeBytes: number, contentLength: number) =>
      `INSERT INTO compliance.inbound_email_attachments (id, org_id, inbound_message_id, file_name, size_bytes, content)
       VALUES ('${id}', 'org-a', 'msg-a', '${id}.xlsx', ${sizeBytes}, convert_to(repeat('a', ${contentLength}), 'UTF8'))`

    // Over the limit, honestly declared.
    expect(await fails(insert("over", 10485761, 10485761))).toContain("inbound_email_attachments_size_check")
    // Over the limit, declared as exactly the limit (the stored bytes say otherwise).
    expect(await fails(insert("lying", 10485760, 10485761))).toContain("inbound_email_attachments_size_check")
    // Under the limit, but size_bytes is not the stored length (a truncated file would look like this).
    expect(await fails(insert("mismatch", 5, 4))).toContain("inbound_email_attachments_size_check")
    expect(await scalar("select count(*) from compliance.inbound_email_attachments")).toBe("0")

    await pg.exec(insert("exact", 10485760, 10485760))
    expect(await scalar("select size_bytes::text || '/' || octet_length(content)::text from compliance.inbound_email_attachments where id = 'exact'")).toBe(
      "10485760/10485760"
    )
    await pg.exec("DELETE FROM compliance.inbound_email_attachments WHERE id = 'exact'")
  })

  test("5. for app_runtime, RLS shows each organisation only its own attachments, nothing without an organisation, and refuses an INSERT", async () => {
    await pg.exec(`
      INSERT INTO compliance.inbound_email_attachments (id, org_id, inbound_message_id, file_name, size_bytes, content, resend_attachment_id) VALUES
        ('att-a1', 'org-a', 'msg-a', 'a1.xlsx', 2, '\\x504b'::bytea, 'r-a1'),
        ('att-a2', 'org-a', 'msg-a', 'a2.xlsx', 2, '\\x504b'::bytea, 'r-a2'),
        ('att-b1', 'org-b', 'msg-b', 'b1.xlsx', 2, '\\x504b'::bytea, 'r-b1');
    `)
    const asAppRuntime = async (orgId: string | null) => {
      await pg.exec("BEGIN")
      try {
        await pg.exec("SET LOCAL ROLE app_runtime")
        if (orgId) await pg.query("select set_config('app.current_org_id', $1, true)", [orgId])
        return (await pg.query<{ id: string }>("select id from compliance.inbound_email_attachments order by id")).rows.map((r) => r.id)
      } finally {
        await pg.exec("ROLLBACK")
      }
    }
    expect(await asAppRuntime("org-a")).toEqual(["att-a1", "att-a2"])
    expect(await asAppRuntime("org-b")).toEqual(["att-b1"])
    expect(await asAppRuntime(null)).toEqual([])

    await pg.exec("BEGIN")
    let refused = ""
    try {
      await pg.exec("SET LOCAL ROLE app_runtime")
      await pg.query("select set_config('app.current_org_id', 'org-a', true)")
      await pg.exec("INSERT INTO compliance.inbound_email_attachments (id, org_id, inbound_message_id, file_name, size_bytes, content) VALUES ('att-x', 'org-a', 'msg-a', 'x.xlsx', 1, '\\x00'::bytea)")
    } catch (err) {
      refused = (err as Error).message
    } finally {
      await pg.exec("ROLLBACK")
    }
    expect(refused).toContain("row-level security")

    // service_role (BYPASSRLS, and its own policy) sees every organisation's rows.
    await pg.exec("BEGIN")
    try {
      await pg.exec("SET LOCAL ROLE service_role")
      expect((await pg.query<{ n: number }>("select count(*)::int n from compliance.inbound_email_attachments")).rows[0].n).toBe(3)
    } finally {
      await pg.exec("ROLLBACK")
    }
  })

  test("6. the down file restores the base schema exactly, keeps every message, is safe to run twice; the forward file applies again", async () => {
    await pg.exec(DOWN)
    expect(await snapshot()).toEqual(s0)
    expect(await messages()).toEqual(originalMessages)
    await pg.exec(DOWN)
    expect(await snapshot()).toEqual(s0)

    await pg.exec(FORWARD)
    expect(await snapshot()).toEqual(s1)
    expect(await scalar("select count(*) from compliance.inbound_email_attachments")).toBe("0")
  })
})
