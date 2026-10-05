/// <reference types="bun-types" />
// drizzle/0697 on PGlite (real Postgres as WASM; no live database touched): every dpdp table with row-level security OFF gets it ON, and every path
// that works today still works.
//   * anon and authenticated (the roles a browser can become) can no longer read or write a dpdp table directly, even when they hold the grants;
//   * a SECURITY DEFINER public.dpdp_* function (how the app and every edge function reach the data) still reads and writes;
//   * service_role (BYPASSRLS, the edge functions) still sees everything;
//   * app_runtime keeps its access through the one explicit policy;
//   * a table that already had RLS on with its own policy is not touched and is not logged;
//   * a second run does nothing; the roll-back script restores the exact prior state.
// Run: bun test --isolate src/lib/services/dpdp-rls-hardening.pglite.test.ts
import { beforeAll, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const read = (f: string) => readFileSync(new URL(`../../../drizzle/${f}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const up = read('0697_dpdp_rls_on_for_every_dpdp_table.sql')
const down = read('down/0697_dpdp_rls_on_for_every_dpdp_table.down.sql')

let db: PGlite
const q = async <T = Record<string, unknown>>(sql: string, args: unknown[] = []) => (await db.query<T>(sql, args)).rows
/** Runs `sql` as `role` and always puts the superuser role back. */
async function as<T>(role: string, sql: string): Promise<T[]> {
  await db.exec(`set role ${role}`)
  try { return (await db.query<T>(sql)).rows } finally { await db.exec('reset role') }
}
const flags = async () => Object.fromEntries((await q<{ relname: string; relrowsecurity: boolean }>(`select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'dpdp' and c.relkind = 'r' and c.relname <> 'rls_hardening_log'`)).map((r) => [r.relname, r.relrowsecurity]))

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role app_runtime nologin; create role service_role nologin bypassrls;
    create schema dpdp;
    grant usage on schema dpdp to anon, authenticated, app_runtime, service_role;
    create table dpdp.identity (id text primary key, primary_email text);
    create table dpdp.session (id text primary key, identity_id text, token_hash text);
    create table dpdp.consent_record (id text primary key, org_id text, answer text);
    create table dpdp.organisation (id text primary key, name text);
    insert into dpdp.identity values ('i1','a@example.test'), ('i2','b@example.test');
    insert into dpdp.session values ('s1','i1','hash1');
    insert into dpdp.consent_record values ('c1','o1','yes');
    insert into dpdp.organisation values ('o1','Acme');
    -- a table that already had RLS on, with its own policy (as organisation does live)
    alter table dpdp.organisation enable row level security;
    create policy own_org on dpdp.organisation for select to authenticated using (id = 'o1');
    -- the worst case: every browser-facing role holds table grants
    grant select, insert, update, delete on all tables in schema dpdp to anon, authenticated, app_runtime, service_role;
    -- how the app reaches data: a SECURITY DEFINER function owned by the table owner
    create schema public_fn;
    create function public.dpdp_who(p_id text) returns text language sql security definer set search_path = '' as $f$ select primary_email from dpdp.identity where id = p_id $f$;
    create function public.dpdp_add_identity(p_id text, p_email text) returns void language sql security definer set search_path = '' as $f$ insert into dpdp.identity values (p_id, p_email) $f$;
    grant execute on function public.dpdp_who(text), public.dpdp_add_identity(text, text) to anon, authenticated, app_runtime, service_role;
  `)
  await db.exec(up)
}, 120_000)

describe('every dpdp table has row-level security on', () => {
  test('the tables that had it off now have it on; the one that already had it on is unchanged and not logged', async () => {
    expect(await flags()).toEqual({ identity: true, session: true, consent_record: true, organisation: true })
    expect((await q<{ table_name: string }>(`select table_name from dpdp.rls_hardening_log order by 1`)).map((r) => r.table_name)).toEqual(['consent_record', 'identity', 'session'])
    expect((await q<{ n: number }>(`select count(*)::int as n from pg_policies where schemaname = 'dpdp' and tablename = 'organisation'`))[0].n).toBe(1)
  })
})

describe('what a browser can no longer do', () => {
  for (const role of ['anon', 'authenticated']) {
    test(`${role}: reads nothing from identity, session or consent_record, even with grants`, async () => {
      for (const t of ['identity', 'session', 'consent_record']) expect(await as(role, `select * from dpdp.${t}`)).toEqual([])
    })
    test(`${role}: cannot write one either`, async () => {
      await db.exec(`set role ${role}`)
      let err = ''
      try { await db.query(`insert into dpdp.identity values ('x','x@example.test')`) } catch (e) { err = (e as Error).message }
      await db.exec('reset role')
      expect(err).toMatch(/row-level security/)
      expect((await as(role, `update dpdp.identity set primary_email = 'hacked' returning id`)).length).toBe(0)
      expect((await as(role, `delete from dpdp.session returning id`)).length).toBe(0)
    })
  }
})

describe('what keeps working', () => {
  test('a SECURITY DEFINER dpdp function reads and writes, called as anon or authenticated', async () => {
    for (const role of ['anon', 'authenticated']) {
      expect((await as<{ w: string }>(role, `select public.dpdp_who('i1') as w`))[0].w).toBe('a@example.test')
    }
    await as('authenticated', `select public.dpdp_add_identity('i3', 'c@example.test')`)
    expect((await q<{ n: number }>(`select count(*)::int as n from dpdp.identity`))[0].n).toBe(3)
    await q(`delete from dpdp.identity where id = 'i3'`)
  })
  test('service_role (BYPASSRLS) still sees every row', async () => {
    expect((await as(`service_role`, `select * from dpdp.identity`)).length).toBe(2)
  })
  test('app_runtime keeps the access it had, through one explicit policy per table', async () => {
    expect((await as('app_runtime', `select * from dpdp.identity`)).length).toBe(2)
    expect((await as('app_runtime', `update dpdp.session set token_hash = 'h2' returning id`)).length).toBe(1)
    expect((await q<{ n: number }>(`select count(*)::int as n from pg_policies where schemaname = 'dpdp' and policyname = 'dpdp_app_runtime_all'`))[0].n).toBe(3)
  })
  test('a table that already had its own policy still answers by it', async () => {
    expect((await as(`authenticated`, `select * from dpdp.organisation`)).length).toBe(1)
  })
})

describe('idempotent and reversible', () => {
  test('a second run changes nothing', async () => {
    await db.exec(up)
    expect((await q<{ n: number }>(`select count(*)::int as n from dpdp.rls_hardening_log`))[0].n).toBe(3)
    expect((await q<{ n: number }>(`select count(*)::int as n from pg_policies where schemaname = 'dpdp' and policyname = 'dpdp_app_runtime_all'`))[0].n).toBe(3)
  })
  test('the roll-back switches off exactly the three it switched on, and leaves the pre-existing one alone', async () => {
    await db.exec(down)
    expect(await flags()).toEqual({ identity: false, session: false, consent_record: false, organisation: true })
    expect((await q<{ n: number }>(`select count(*)::int as n from pg_policies where schemaname = 'dpdp' and tablename = 'organisation'`))[0].n).toBe(1)
    expect((await q<{ t: string | null }>(`select to_regclass('dpdp.rls_hardening_log')::text as t`))[0].t).toBeNull()
    // and the original, unprotected behaviour is back (grants are what they were)
    expect((await as('anon', `select * from dpdp.identity`)).length).toBe(2)
  })
})
