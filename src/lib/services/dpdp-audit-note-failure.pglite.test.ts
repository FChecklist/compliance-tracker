/// <reference types="bun-types" />
// drizzle/0760 on PGlite: dpdp_audit_note_failure writes a code into dpdp.audit_failure, only service_role may call it, and it never raises into the caller.
// Run: bun test --isolate src/lib/services/dpdp-audit-note-failure.pglite.test.ts
import { beforeAll, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const read = (f: string) => readFileSync(new URL(`../../../drizzle/${f}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
let db: PGlite
const q = async <T = Record<string, unknown>>(sql: string, args: unknown[] = []) => (await db.query<T>(sql, args)).rows

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role app_runtime nologin; create role service_role nologin;
    create schema dpdp;
    create table dpdp.audit_failure (id bigint generated always as identity primary key, at timestamptz not null default now(), source text, error text);
  `)
  await db.exec(read('0760_dpdp_audit_note_failure.sql'))
}, 120_000)

describe('dpdp_audit_note_failure', () => {
  test('service_role can note a failure; it lands as a code, trimmed', async () => {
    await db.exec(`set role service_role`)
    await db.query(`select public.dpdp_audit_note_failure('edge_function', 'no_key')`)
    await db.query(`select public.dpdp_audit_note_failure($1, $2)`, ['x'.repeat(200), 'y'.repeat(500)])
    await db.exec(`reset role`)
    const rows = await q<{ source: string; error: string }>(`select source, error from dpdp.audit_failure order by id`)
    expect(rows[0]).toEqual({ source: 'edge_function', error: 'no_key' })
    expect(rows[1].source.length).toBe(60)
    expect(rows[1].error.length).toBe(120)
  })
  test('null input does not raise', async () => {
    await db.query(`select public.dpdp_audit_note_failure(null, null)`)
    const last = (await q<{ source: string; error: string }>(`select source, error from dpdp.audit_failure order by id desc limit 1`))[0]
    expect(last).toEqual({ source: 'edge_function', error: 'unknown' })
  })
  test('anon, authenticated and app_runtime cannot call it', async () => {
    for (const role of ['anon', 'authenticated', 'app_runtime']) {
      await db.exec(`set role ${role}`)
      await expect(db.query(`select public.dpdp_audit_note_failure('s', 'e')`)).rejects.toThrow(/permission denied/)
      await db.exec(`reset role`)
    }
  })
  test('the roll-back removes the function', async () => {
    await db.exec(read('down/0760_dpdp_audit_note_failure.down.sql'))
    expect((await q(`select 1 from pg_proc where proname = 'dpdp_audit_note_failure'`)).length).toBe(0)
  })
})
