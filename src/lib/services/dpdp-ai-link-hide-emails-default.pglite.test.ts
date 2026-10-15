/// <reference types="bun-types" />
// drizzle/0720 on PGlite (real Postgres as WASM; no live database touched): AI work links hide other people's e-mail addresses by default.
//   * the column default is TRUE and every existing link is switched to TRUE;
//   * dpdp_ai_link_create with no hide argument makes a hidden link; the person can still ask for a visible one;
//   * the e-mailed (Monday) link is always hidden;
//   * the Grievance Officer is given to an AI by role only: no name, no e-mail address anywhere in the register function;
//   * the migration can be applied twice.
// Run: bun test --isolate src/lib/services/dpdp-ai-link-hide-emails-default.pglite.test.ts
import { beforeAll, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const read = (f: string) => readFileSync(new URL(`../../../drizzle/${f}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const mig = read('0720_dpdp_ai_link_hide_emails_default.sql')
// everything but the privilege lines (the roles are not what this test is about)
const runnable = mig

let db: PGlite
const q = async <T = Record<string, unknown>>(sql: string, args: unknown[] = []) => (await db.query<T>(sql, args)).rows

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create role service_role nologin; create role app_runtime nologin; create role authenticated nologin;
    create schema dpdp; create schema extensions;
    create function extensions.gen_random_bytes(n int) returns bytea language sql as $f$ select decode(md5(random()::text || clock_timestamp()::text) || md5(random()::text), 'hex') $f$;
    create table dpdp.identity (id text primary key, primary_email text);
    create table dpdp.membership (id text primary key, org_id text, identity_id text, state text default 'active');
    create table dpdp.ai_link (
      id text primary key, org_id text, identity_id text, membership_id text, token text, token_hash text, created_at timestamp, expires_at timestamp,
      revoked_at timestamp, read_count int default 0, authority_level int, hide_emails boolean not null default false, created_by_membership_id text, label text, call_count int default 0
    );
    insert into dpdp.identity values ('i1','owner@example.test');
    insert into dpdp.membership values ('m1','o1','i1','active');
    insert into dpdp.ai_link (id, org_id, identity_id, membership_id, token_hash, created_at, expires_at, authority_level, hide_emails)
      values ('old1','o1','i1','m1','h1', now(), now() + interval '1 day', 0, false), ('old2','o1','i1','m1','h2', now(), now() + interval '1 day', 1, false), ('old3','o1','i1','m1','h3', now(), now() + interval '1 day', 1, true);
    create function public.dpdp__caller_membership(p_org_id text) returns dpdp.membership language sql as $f$ select m.* from dpdp.membership m where m.id = 'm1' $f$;
    create function public.dpdp__append_event(a text, b text, c text, d text, e text, f text) returns void language sql as $f$ select $f$;
    create function public.dpdp__ai_link_warning_for(p_membership_id text) returns jsonb language sql as $f$ select '{"jobs":3,"people":2}'::jsonb $f$;
  `)
  await db.exec(runnable)
  await db.exec(runnable) // idempotent
}, 120_000)

describe('hidden by default', () => {
  test('every existing link was switched to hidden, and the column default is now true', async () => {
    expect((await q<{ n: number }>(`select count(*)::int as n from dpdp.ai_link where hide_emails is not true`))[0].n).toBe(0)
    expect((await q<{ d: string }>(`select column_default as d from information_schema.columns where table_schema='dpdp' and table_name='ai_link' and column_name='hide_emails'`))[0].d).toBe('true')
  })
  test('dpdp_ai_link_create with no argument makes a hidden link; an explicit false is still honoured', async () => {
    const hidden = (await q<{ r: Record<string, unknown> }>(`select public.dpdp_ai_link_create() as r`))[0].r
    expect(hidden.hideEmails).toBe(true)
    expect((await q<{ h: boolean }>(`select hide_emails as h from dpdp.ai_link where id = $1`, [hidden.linkId]))[0].h).toBe(true)
    const shown = (await q<{ r: Record<string, unknown> }>(`select public.dpdp_ai_link_create(0, false) as r`))[0].r
    expect(shown.hideEmails).toBe(false)
    expect((await q<{ h: boolean }>(`select hide_emails as h from dpdp.ai_link where id = $1`, [shown.linkId]))[0].h).toBe(false)
  })
  test('the Monday e-mail link is always hidden', async () => {
    for (const days of [1, 2, 7]) {
      const r = (await q<{ r: Record<string, unknown> }>(`select public.dpdp_timer_mint_email_ai_link('m1', 1, $1) as r`, [days]))[0].r
      expect((await q<{ h: boolean; label: string }>(`select hide_emails as h, label from dpdp.ai_link where id = $1`, [r.linkId]))[0]).toEqual({ h: true, label: 'Monday email' })
    }
  })
})

describe('the Grievance Officer is given by role only', () => {
  const fn = mig.match(/create or replace function public\.dpdp_ai_link_register\([\s\S]*?\n\$\$;/)![0]
  test('the register function no longer returns the officer\'s name or e-mail address', () => {
    const go = fn.slice(fn.indexOf("'grievanceOfficer'"), fn.indexOf("'grievanceOfficer'") + 400)
    expect(go).toContain("'role', 'Grievance Officer'")
    expect(go).not.toContain('person_name')
    expect(go).not.toMatch(/go\.email/)
    expect(fn).not.toMatch(/'name', go\./)
  })
  test('the rollback script restores only the default', () => {
    const down = read('down/0720_dpdp_ai_link_hide_emails_default.down.sql')
    expect(down).toContain('set default false')
  })
})
