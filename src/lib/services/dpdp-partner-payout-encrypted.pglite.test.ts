/// <reference types="bun-types" />
// drizzle/0699 on PGlite (real Postgres + real pgcrypto; no live database touched): Sales Partner payout details are stored encrypted.
//   * the migration refuses to run until the Vault secret exists, and converts rows already in the table;
//   * the REAL public.dpdp_partner_save_payout_details body (copied out of the migration) writes through the view: the stored columns are ciphertext
//     ('enc1:...'), never the PAN, account number, IFSC, UPI id or name; a second save updates in place;
//   * the view reads them back decrypted, so every reader that selects from dpdp.partner_payout_detail keeps working unchanged;
//   * with the Vault secret removed, a read or a save FAILS and nothing is written in plain text;
//   * the roll-back decrypts back into the original table.
// Run: bun test --isolate src/lib/services/dpdp-partner-payout-encrypted.pglite.test.ts
import { beforeAll, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'

const read = (f: string) => readFileSync(new URL(`../../../drizzle/${f}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const up = read('0699_dpdp_partner_payout_encrypted.sql')
const down = read('down/0699_dpdp_partner_payout_encrypted.down.sql')
const m0674 = read('0674_dpdp_sales_partner_lifecycle.sql')
const tableDdl = m0674.match(/create table if not exists dpdp\.partner_payout_detail \([\s\S]*?\n\);/)![0]
const KEY = 'k'.repeat(40)

let db: PGlite
const q = async <T = Record<string, unknown>>(sql: string, args: unknown[] = []) => (await db.query<T>(sql, args)).rows

beforeAll(async () => {
  db = new PGlite({ extensions: { pgcrypto } })
  await db.exec(`
    create role anon nologin; create role authenticated nologin;
    create schema extensions; create extension pgcrypto schema extensions;
    create schema dpdp; create schema auth; create schema vault;
    create table vault.secrets (name text primary key, decrypted_secret text);
    create view vault.decrypted_secrets as select name, decrypted_secret from vault.secrets;
    create function auth.jwt() returns jsonb language sql stable as $f$ select '{"email":"partner@example.test"}'::jsonb $f$;
    create table dpdp.identity (id text primary key);
    create table dpdp.sales_partner (identity_id text primary key references dpdp.identity (id), status text not null default 'invited', terms_version text);
    ${tableDdl}
    alter table dpdp.partner_payout_detail enable row level security;
    insert into dpdp.identity values ('p1'), ('p2');
    insert into dpdp.sales_partner values ('p1', 'invited', 'v1'), ('p2', 'invited', 'v1');
    -- a row that exists BEFORE the migration, in plain text
    insert into dpdp.partner_payout_detail (identity_id, method, upi_id) values ('p2', 'upi', 'old.partner@okbank');
    -- stand-ins for the helpers the save function calls
    create function public.dpdp__caller_identity_id() returns text language sql as $f$ select current_setting('test.identity') $f$;
    create function public.dpdp__partner_event(a text, b text, c text, d text) returns void language sql as $f$ select $f$;
    create function public.dpdp__partner_notify(a text, b text, c text, d jsonb, e boolean) returns void language sql as $f$ select $f$;
    create function public.dpdp__partner_try_activate(a text) returns boolean language sql as $f$ select false $f$;
  `)
}, 120_000)

describe('the migration', () => {
  test('refuses to run while the Vault secret is missing, and changes nothing', async () => {
    await expect(db.exec(up)).rejects.toThrow(/Create the Vault secret dpdp_payout_key/)
    expect((await q<{ k: string }>(`select c.relkind::text as k from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'dpdp' and c.relname = 'partner_payout_detail'`))[0].k).toBe('r')
  })
  test('with the secret in place it converts an existing plain-text row and swaps in the view', async () => {
    await db.exec(`insert into vault.secrets values ('dpdp_payout_key', '${KEY}')`)
    await db.exec(up)
    const raw = (await q<{ upi_id: string }>(`select upi_id from dpdp.partner_payout_store where identity_id = 'p2'`))[0].upi_id
    expect(raw.startsWith('enc1:')).toBe(true)
    expect(raw).not.toContain('old.partner')
    expect((await q<{ upi_id: string }>(`select upi_id from dpdp.partner_payout_detail where identity_id = 'p2'`))[0].upi_id).toBe('old.partner@okbank')
  })
  test('can be applied a second time without double encryption', async () => {
    await db.exec(up)
    expect((await q<{ upi_id: string }>(`select upi_id from dpdp.partner_payout_detail where identity_id = 'p2'`))[0].upi_id).toBe('old.partner@okbank')
  })
})

describe('the real save function, writing through the view', () => {
  const save = async (identity: string, args: unknown[]) => {
    await db.exec(`select set_config('test.identity', '${identity}', false)`)
    return (await q<{ r: Record<string, unknown> }>(`select public.dpdp_partner_save_payout_details($1, $2, $3, $4, $5, $6) as r`, args))[0].r
  }
  test('a bank detail with PAN: stored encrypted, nothing in plain text, read back decrypted', async () => {
    const r = await save('p1', ['bank', null, 'Asha Rao', '123456789012', 'HDFC0001234', 'ABCDE1234F'])
    expect(r.ok).toBe(true)
    const raw = (await q<Record<string, string>>(`select * from dpdp.partner_payout_store where identity_id = 'p1'`))[0]
    for (const col of ['account_name', 'account_number', 'ifsc', 'pan']) expect(raw[col].startsWith('enc1:'), col).toBe(true)
    expect(raw.upi_id).toBeNull()
    expect(JSON.stringify(raw)).not.toMatch(/123456789012|HDFC0001234|ABCDE1234F|Asha Rao/)
    const seen = (await q<Record<string, string>>(`select * from dpdp.partner_payout_detail where identity_id = 'p1'`))[0]
    expect(seen).toMatchObject({ method: 'bank', account_name: 'Asha Rao', account_number: '123456789012', ifsc: 'HDFC0001234', pan: 'ABCDE1234F' })
  })
  test('a second save replaces the row in place (one row, updated), still encrypted', async () => {
    await save('p1', ['upi', 'asha@okbank', null, null, null, null])
    expect((await q<{ n: number }>(`select count(*)::int as n from dpdp.partner_payout_store where identity_id = 'p1'`))[0].n).toBe(1)
    const raw = (await q<Record<string, string | null>>(`select * from dpdp.partner_payout_store where identity_id = 'p1'`))[0]
    expect(String(raw.upi_id).startsWith('enc1:')).toBe(true)
    expect(raw.account_number).toBeNull()
    expect((await q<{ upi_id: string }>(`select upi_id from dpdp.partner_payout_detail where identity_id = 'p1'`))[0].upi_id).toBe('asha@okbank')
  })
  test('the same plain value encrypts differently each time (not a lookup you can match)', async () => {
    const a = (await q<{ c: string }>(`select dpdp.payout_enc('ABCDE1234F') as c`))[0].c
    const b = (await q<{ c: string }>(`select dpdp.payout_enc('ABCDE1234F') as c`))[0].c
    expect(a).not.toBe(b)
  })
  test('browser roles cannot run the key or the decrypt function, or read the view', async () => {
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`)
      const errs: string[] = []
      for (const sql of [`select dpdp.payout_key()`, `select dpdp.payout_dec('enc1:x')`, `select * from dpdp.partner_payout_detail`]) {
        try { await db.query(sql); errs.push('ALLOWED ' + sql) } catch (e) { errs.push('denied') }
      }
      await db.exec('reset role')
      expect(errs).toEqual(['denied', 'denied', 'denied'])
    }
  })
})

describe('fails closed without the key', () => {
  test('with the Vault secret gone, a save and a read both fail and nothing is written in plain text', async () => {
    await db.exec(`delete from vault.secrets where name = 'dpdp_payout_key'`)
    await db.exec(`select set_config('test.identity', 'p1', false)`)
    await expect(db.query(`select public.dpdp_partner_save_payout_details('upi', 'zed@okbank')`)).rejects.toThrow(/payout encryption key/)
    await expect(db.query(`select upi_id from dpdp.partner_payout_detail`)).rejects.toThrow(/payout encryption key/)
    expect((await q<{ n: number }>(`select count(*)::int as n from dpdp.partner_payout_store where upi_id = 'zed@okbank'`))[0].n).toBe(0)
    await db.exec(`insert into vault.secrets values ('dpdp_payout_key', '${KEY}')`)
  })
})

describe('roll-back', () => {
  test('decrypts back into the original table', async () => {
    await db.exec(down)
    expect((await q<{ k: string }>(`select c.relkind::text as k from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'dpdp' and c.relname = 'partner_payout_detail'`))[0].k).toBe('r')
    const rows = await q<{ identity_id: string; upi_id: string }>(`select identity_id, upi_id from dpdp.partner_payout_detail order by identity_id`)
    expect(rows).toEqual([{ identity_id: 'p1', upi_id: 'asha@okbank' }, { identity_id: 'p2', upi_id: 'old.partner@okbank' }])
  })
})
