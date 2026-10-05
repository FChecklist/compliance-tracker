/// <reference types="bun-types" />
// drizzle/0722 on PGlite (no live database touched): the payment-proof bucket.
//   * upload only into a folder named after your own sign-in id;
//   * read back only your own folder (the platform admin reads all); nobody reads across;
//   * the bucket limits 5 MB and PNG / JPEG / WebP / PDF are set;
//   * no update or delete policy exists, so a browser cannot change or remove a proof;
//   * the roll-back restores the 0658 behaviour.
// storage.objects row-level security is the real Postgres mechanism; Supabase's own storage API sits on top of it, so what is proved here is the policy.
import { beforeAll, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const read = (f: string) => readFileSync(new URL(`../../../drizzle/${f}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const m0658 = read('0658_dpdp_payment_confirmation_flow.sql')
const up = read('0722_dpdp_payment_proof_storage_policy.sql')
const down = read('down/0722_dpdp_payment_proof_storage_policy.down.sql')

const ALICE = '11111111-1111-1111-1111-111111111111'
const BOB = '22222222-2222-2222-2222-222222222222'
const ADMIN = '99999999-9999-9999-9999-999999999999'

let db: PGlite
async function asUser<T = Record<string, unknown>>(uid: string, fn: () => Promise<T>): Promise<T> {
  await db.exec(`set role authenticated; select set_config('request.jwt.claims', '{"sub":"${uid}"}', false)`)
  try { return await fn() } finally { await db.exec(`reset role; select set_config('request.jwt.claims', '', false)`) }
}
const insert = (uid: string, name: string) => asUser(uid, async () => {
  try { await db.query(`insert into storage.objects (bucket_id, name) values ('dpdp-payment-proofs', $1)`, [name]); return 'ok' } catch (e) { return (e as Error).message }
})
const visible = (uid: string) => asUser(uid, async () => (await db.query<{ name: string }>(`select name from storage.objects where bucket_id = 'dpdp-payment-proofs' order by name`)).rows.map((r) => r.name))

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon nologin; create role authenticated nologin;
    create schema storage; create schema auth; create schema dpdp;
    grant usage on schema storage, auth to authenticated;
    create function auth.uid() returns uuid language sql stable as $f$ select (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid $f$;
    grant execute on function auth.uid() to authenticated;
  `)
  await db.exec(`
    create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text, owner uuid default auth.uid());
    grant select, insert, update, delete on storage.objects to authenticated;
    alter table storage.objects enable row level security;
    create function storage.foldername(name text) returns text[] language plpgsql immutable as $f$
    declare _parts text[]; begin select string_to_array(name, '/') into _parts; return _parts[1:array_length(_parts, 1) - 1]; end $f$;
    -- the platform-admin check: here, the one admin id
    create function public.dpdp__is_platform_admin() returns boolean language sql stable as $f$ select auth.uid() = '${ADMIN}'::uuid $f$;
  `)
  // 0658's own storage section (bucket + the two original policies), straight from the migration
  const section = m0658.slice(m0658.indexOf("insert into storage.buckets (id, name, public)"))
  await db.exec(section.slice(0, section.indexOf("with check (bucket_id = 'dpdp-payment-proofs');") + "with check (bucket_id = 'dpdp-payment-proofs');".length))
  await db.exec(`create policy "dpdp payment proof read (admin only)" on storage.objects for select to authenticated using (bucket_id = 'dpdp-payment-proofs' and public.dpdp__is_platform_admin());`)
  await db.exec(up)
}, 120_000)

describe('upload', () => {
  test('into your own folder: allowed', async () => {
    expect(await insert(ALICE, `${ALICE}/org1-abc.png`)).toBe('ok')
    expect(await insert(BOB, `${BOB}/org2-def.pdf`)).toBe('ok')
  })
  test("into someone else's folder, the bucket root, or an organisation-id folder: refused", async () => {
    expect(await insert(ALICE, `${BOB}/sneaky.png`)).toMatch(/row-level security/)
    expect(await insert(ALICE, `loose.png`)).toMatch(/row-level security/)
    expect(await insert(ALICE, `org1/old-style.png`)).toMatch(/row-level security/)
  })
  test('a different bucket is not covered by this policy', async () => {
    await db.exec(`insert into storage.buckets (id, name, public) values ('other', 'other', false)`)
    await db.exec(`set role authenticated; select set_config('request.jwt.claims', '{"sub":"${ALICE}"}', false)`)
    let err = ''
    try { await db.query(`insert into storage.objects (bucket_id, name) values ('other', '${ALICE}/x.png')`) } catch (e) { err = (e as Error).message }
    await db.exec(`reset role`)
    expect(err).toMatch(/row-level security/)
  })
})

describe('read', () => {
  test('you see only your own folder', async () => {
    expect(await visible(ALICE)).toEqual([`${ALICE}/org1-abc.png`])
    expect(await visible(BOB)).toEqual([`${BOB}/org2-def.pdf`])
  })
  test('the platform admin sees every proof', async () => {
    expect((await visible(ADMIN)).sort()).toEqual([`${ALICE}/org1-abc.png`, `${BOB}/org2-def.pdf`].sort())
  })
  test('a stranger with no sign-in id sees nothing', async () => {
    expect(await visible('33333333-3333-3333-3333-333333333333')).toEqual([])
  })
})

describe('no change or removal from a browser, and the bucket limits', () => {
  test('update and delete touch nothing', async () => {
    const upd = await asUser(ALICE, async () => (await db.query(`update storage.objects set name = '${ALICE}/renamed.png' where bucket_id = 'dpdp-payment-proofs' returning id`)).rows.length)
    const del = await asUser(ALICE, async () => (await db.query(`delete from storage.objects where bucket_id = 'dpdp-payment-proofs' returning id`)).rows.length)
    expect([upd, del]).toEqual([0, 0])
  })
  test('the bucket is capped at 5 MB and three image types plus PDF', async () => {
    const b = (await db.query<{ file_size_limit: string; allowed_mime_types: string[] }>(`select file_size_limit::text, allowed_mime_types from storage.buckets where id = 'dpdp-payment-proofs'`)).rows[0]
    expect(b.file_size_limit).toBe('5242880')
    expect(b.allowed_mime_types).toEqual(['image/png', 'image/jpeg', 'image/webp', 'application/pdf'])
  })
  test('applying it twice is harmless', async () => {
    await db.exec(up)
    expect(((await db.query<{ n: number }>(`select count(*)::int as n from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'dpdp payment proof%'`)).rows[0]).n).toBe(2)
  })
})

describe('roll-back', () => {
  test('restores the 0658 behaviour: any signed-in person uploads anywhere, only the admin reads, limits lifted', async () => {
    await db.exec(down)
    expect(await insert(ALICE, `${BOB}/anything.png`)).toBe('ok')
    expect(await visible(ALICE)).toEqual([])
    expect(((await db.query<{ file_size_limit: string | null }>(`select file_size_limit::text from storage.buckets where id = 'dpdp-payment-proofs'`)).rows[0]).file_size_limit).toBeNull()
  })
})
