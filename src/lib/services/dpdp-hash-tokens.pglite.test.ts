/// <reference types="bun-types" />
// drizzle/0763 on PGlite (real Postgres + real pgcrypto; no live database touched): consent link tokens and organisation join codes are no longer stored or matched in plain text.
//   * the migration refuses to run without the Vault key;
//   * consent_token: rows that existed BEFORE the migration keep working with the very same link (transition), the plain column is emptied, a plain token written by an older
//     writer is turned into a hash by the trigger, an unknown link is refused, and the real preview / answer / withdraw functions (the live ones from 0725, as changed here) work;
//   * org_invite: existing plain codes are encrypted in place and get a keyed hash; a new plain code is encrypted by the trigger; lookup by code works in any letter case through
//     the hash; the stored value never contains the code; the roll-back decrypts them back.
// Run: bun test --isolate src/lib/services/dpdp-hash-tokens.pglite.test.ts
import { beforeAll, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'

const read = (f: string) => readFileSync(new URL(`../../../drizzle/${f}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex')
const m0723 = read('0723_dpdp_partner_payout_encrypted.sql')
const payoutFns = m0723.slice(m0723.indexOf('create or replace function dpdp.payout_key()'), m0723.indexOf('revoke all on function dpdp.payout_key()'))
const m0609 = read('0609_dpdp_wo011_step5_rpc.sql')
const origConsent = m0609.match(/create or replace function public\.dpdp_parent_consent\(p_token text, p_answer text\)[\s\S]*?\n\$\$;/)![0]
const up0725 = read('0725_dpdp_consent_page_purposes_guardian_withdraw.sql')
const up = read('0763_dpdp_hash_consent_token_and_invite_code.sql')
const down = read('down/0763_dpdp_hash_consent_token_and_invite_code.down.sql')
const KEY = 'k'.repeat(40)

let db: PGlite
const q = async <T = Record<string, unknown>>(sql: string, args: unknown[] = []) => (await db.query<T>(sql, args)).rows
const j = async (sql: string, args: unknown[] = []) => (await q<{ r: any }>(sql, args))[0].r
const preview = (t: string) => j(`select public.dpdp_parent_consent_preview($1) as r`, [t])
const v2 = (t: string, answers: unknown) => j(`select public.dpdp_parent_consent_v2($1, $2::jsonb, null) as r`, [t, JSON.stringify(answers)])
const withdraw = (t: string, k: string) => j(`select public.dpdp_consent_withdraw($1, $2) as r`, [t, k])

beforeAll(async () => {
  db = new PGlite({ extensions: { pgcrypto } })
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role app_runtime nologin; create role service_role nologin;
    create schema extensions; create extension pgcrypto schema extensions;
    create schema dpdp; create schema vault;
    create table vault.secrets (name text primary key, decrypted_secret text);
    create view vault.decrypted_secrets as select name, decrypted_secret from vault.secrets;
    create table dpdp.organisation (id text primary key, name text);
    create table dpdp.notice_version (id text primary key, org_id text, doc_kind text, version text, languages text[]);
    create table dpdp.grievance_officer (id text primary key, org_id text, email text, superseded_at timestamp, published_since timestamp);
    create table dpdp.consent_campaign (id text primary key, org_id text, group_id text, notice_version_id text, sent_at timestamp, channel text default 'email');
    create table dpdp.consent_token (id text primary key, campaign_id text, token text not null unique, contact_hash text, opened_at timestamp, acted_at timestamp, expires_at timestamp not null);
    create table dpdp.consent_record (id text primary key, token_id text, purpose_key text, granted boolean, notice_version_id text, language text default 'en', recorded_at timestamp default now(), withdrawn_at timestamp);
    create table dpdp.events_seen (kind text, summary text);
    create function public.dpdp__append_event(a text, b text, c text, d text, e text) returns void language sql as $f$ insert into dpdp.events_seen values (d, e) $f$;
    create table dpdp.org_invite (org_id text primary key references dpdp.organisation (id) on delete cascade, code text not null unique, created_at timestamp not null default now());

    insert into dpdp.organisation values ('o1', 'Sunrise School'), ('o2', 'Beta Co');
    insert into dpdp.notice_version values ('n1', 'o1', 'privacy', '1.0', '{en}');
    insert into dpdp.grievance_officer values ('g1', 'o1', 'officer@sunrise.example', null, now());
    insert into dpdp.consent_campaign (id, org_id, group_id, notice_version_id) values ('c1', 'o1', 'g', 'n1');
    -- links that exist BEFORE the migration, with their token in plain text
    insert into dpdp.consent_token values ('t-old-1', 'c1', 'tok-legacy-aaa', 'h1', null, null, now() + interval '30 days'), ('t-old-2', 'c1', 'tok-legacy-bbb', 'h2', null, null, now() + interval '30 days');
    insert into dpdp.org_invite (org_id, code) values ('o1', 'ABCD2345');
  `)
  // The reader functions in the migration are the live ones, which declare variables of tables this harness does not need: skip the declaration check, as the other harnesses do by omission.
  await db.exec('set check_function_bodies = off')
  await db.exec(origConsent)
  await db.exec(up0725)
  await db.exec(payoutFns)
}, 180_000)

describe('the migration', () => {
  test('refuses to run without the Vault key, and changes nothing', async () => {
    await expect(db.exec(up)).rejects.toThrow(/dpdp_payout_key/)
    expect((await q<{ token: string }>(`select token from dpdp.consent_token where id = 't-old-1'`))[0].token).toBe('tok-legacy-aaa')
  })
  test('with the key in place it applies', async () => {
    await db.exec(`insert into vault.secrets values ('dpdp_payout_key', '${KEY}')`)
    await db.exec(up)
  })
})

describe('consent tokens', () => {
  test('rows that existed before keep their link: the plain value is gone, its SHA-256 is stored', async () => {
    const rows = await q<{ id: string; token: string | null; token_hash: string }>(`select id, token, token_hash from dpdp.consent_token order by id`)
    expect(rows).toEqual([{ id: 't-old-1', token: null, token_hash: sha('tok-legacy-aaa') }, { id: 't-old-2', token: null, token_hash: sha('tok-legacy-bbb') }])
  })
  test('the SAME link still opens, is answered once, and can be withdrawn (transition: old links keep working)', async () => {
    expect(await preview('tok-legacy-aaa')).toMatchObject({ ok: true, orgName: 'Sunrise School', alreadyAnswered: false })
    expect(await v2('tok-legacy-aaa', { consent: 'yes' })).toEqual({ ok: true, recorded: 1 })
    expect((await v2('tok-legacy-aaa', { consent: 'no' })).reason).toMatch(/already been used/)
    expect(await preview('tok-legacy-aaa')).toMatchObject({ alreadyAnswered: true, canWithdraw: true })
    expect(await withdraw('tok-legacy-aaa', 'consent')).toMatchObject({ ok: true })
  })
  test('the original answer function works with an old link too', async () => {
    expect(await j(`select public.dpdp_parent_consent('tok-legacy-bbb', 'yes') as r`)).toEqual({ ok: true, answer: 'yes' })
  })
  test('the hash itself is not a working link, and an unknown or empty link is refused', async () => {
    expect((await preview(sha('tok-legacy-aaa'))).ok).toBe(false)
    expect((await preview('nope')).ok).toBe(false)
    expect((await preview('')).ok).toBe(false)
    expect((await v2('nope', { consent: 'yes' })).ok).toBe(false)
  })
  test('a plain token written by an older writer is turned into a hash on the way in, and works', async () => {
    await db.exec(`insert into dpdp.consent_token (id, campaign_id, token, contact_hash, expires_at) values ('t-new', 'c1', 'tok-new-ccc', 'h3', now() + interval '30 days')`)
    const row = (await q<{ token: string | null; token_hash: string }>(`select token, token_hash from dpdp.consent_token where id = 't-new'`))[0]
    expect(row).toEqual({ token: null, token_hash: sha('tok-new-ccc') })
    expect(await preview('tok-new-ccc')).toMatchObject({ ok: true })
  })
  test('a new row written with only the hash (the application\'s own writer) works', async () => {
    await db.exec(`insert into dpdp.consent_token (id, campaign_id, token_hash, contact_hash, expires_at) values ('t-app', 'c1', '${sha('tok-app-ddd')}', 'h4', now() + interval '30 days')`)
    expect(await preview('tok-app-ddd')).toMatchObject({ ok: true })
  })
  test('no plain token is anywhere in the table', async () => {
    expect((await q(`select 1 from dpdp.consent_token where token is not null`)).length).toBe(0)
  })
  test('two links cannot share a hash', async () => {
    await expect(db.exec(`insert into dpdp.consent_token (id, campaign_id, token_hash, contact_hash, expires_at) values ('t-dup', 'c1', '${sha('tok-app-ddd')}', 'h5', now())`)).rejects.toThrow(/unique|duplicate/i)
  })
})

describe('organisation join codes', () => {
  const dec = async (org: string) => (await q<{ c: string }>(`select dpdp.payout_dec(code) as c from dpdp.org_invite where org_id = $1`, [org]))[0].c
  test('an existing plain code is encrypted in place; the stored value does not contain it; it still decrypts to the same code', async () => {
    const row = (await q<{ code: string; code_hash: string }>(`select code, code_hash from dpdp.org_invite where org_id = 'o1'`))[0]
    expect(row.code.startsWith('enc1:')).toBe(true)
    expect(row.code).not.toContain('ABCD2345')
    expect(row.code_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(await dec('o1')).toBe('ABCD2345')
  })
  test('a new plain code (what the generators write) is encrypted and hashed by the trigger', async () => {
    await db.exec(`insert into dpdp.org_invite (org_id, code) values ('o2', 'WXYZ6789')`)
    const row = (await q<{ code: string; code_hash: string }>(`select code, code_hash from dpdp.org_invite where org_id = 'o2'`))[0]
    expect(row.code.startsWith('enc1:')).toBe(true)
    expect(await dec('o2')).toBe('WXYZ6789')
  })
  test('lookup by code goes through the keyed hash, in any letter case, and an unknown code finds nothing', async () => {
    const find = async (c: string) => (await q<{ org_id: string }>(`select org_id from dpdp.org_invite where code_hash = dpdp.invite_code_hash($1)`, [c])).map((r) => r.org_id)
    expect(await find('abcd2345')).toEqual(['o1'])
    expect(await find('  ABCD2345 ')).toEqual(['o1'])
    expect(await find('WXYZ6789')).toEqual(['o2'])
    expect(await find('AAAA1111')).toEqual([])
  })
  test('the hash is keyed: it is not the plain SHA-256 of the code', async () => {
    const h = (await q<{ code_hash: string }>(`select code_hash from dpdp.org_invite where org_id = 'o1'`))[0].code_hash
    expect(h).not.toBe(sha('ABCD2345'))
  })
  test('the readers and the join lookup use the hash / decrypt (source check of the migration)', () => {
    expect(up).toContain('oi.code_hash = dpdp.invite_code_hash(v_code)')
    expect(up).not.toMatch(/upper\(oi\.code\)/)
    expect(up).toContain('dpdp.payout_dec(oi.code) as "inviteCode"')
    expect(up).not.toMatch(/t\.token = coalesce/)
  })
})

describe('roll-back', () => {
  test('decrypts the join codes back and drops the hash; consent links stay hashed and keep working', async () => {
    await db.exec(down)
    expect(await q<{ code: string }>(`select code from dpdp.org_invite order by org_id`)).toEqual([{ code: 'ABCD2345' }, { code: 'WXYZ6789' }])
    expect((await q(`select 1 from information_schema.columns where table_schema = 'dpdp' and table_name = 'org_invite' and column_name = 'code_hash'`)).length).toBe(0)
    expect(await preview('tok-new-ccc')).toMatchObject({ ok: true })
  })
})
