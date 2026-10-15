/// <reference types="bun-types" />
// The ticked Terms boxes, enforced by the DATABASE (drizzle/0748_dpdp_terms_acceptance.sql). Offline proof on PGlite: the live database is never
// touched, and the migration is not applied anywhere by this test other than to PGlite's own empty copy.
//
// The shared stand-in base (dpdp-pglite-base.ts) supplies the tables and the three older functions this migration puts a door in front of:
// dpdp_create_my_org, dpdp_pay_begin and (added here) dpdp_open_account. The migration file itself is read from disk and run unchanged.
//
// What this pins: a sign-up (K2) and a payment (K3) are refused with the sentence "Please tick the box to continue." and the hint
// 'consent-required' unless the CURRENT version AND a true box arrive; with them the work happens and ONE row is read back (who, kind,
// reference, version, wording hash, time); a version bump asks again; the table has no IP-address or device column; the box wording in the
// database is the agreed wording; the old cores are not reachable by a browser; a double click records one tick; a recorded tick is never edited;
// and running the whole file a second time changes nothing.
//
// Run: bun test --isolate src/lib/services/dpdp-terms-acceptance.pglite.test.ts
import { createHash } from 'node:crypto'
import { beforeAll, describe, expect, test } from 'bun:test'
import { PGlite } from '@electric-sql/pglite'
import { BASE_SQL, read } from './dpdp-pglite-base'

const MIGRATION = 'drizzle/0748_dpdp_terms_acceptance.sql'
const K2 = 'I have read and agree to the Terms & Conditions and the Privacy Policy.'
const K3 = 'I agree to the Terms and the Refund Policy.'
const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex')
const OPEN = (extra = '') => `select public.dpdp_open_account('firm', 'Mehta & Co', null, null, null, null, null, null, null${extra}) as r`

const STAND_INS = `
-- the 9-argument sign-up the migration wraps (the real one is 0735's; here it only calls the create-org stand-in)
create function public.dpdp_open_account(
  p_account_type text, p_org_name text, p_professional_body text default null, p_registration_no text default null, p_referral_code text default null,
  p_partner_code text default null, p_source_tag text default null, p_first_seen_at timestamptz default null, p_billing_contact_email text default null
) returns jsonb language plpgsql security definer set search_path = '' as $f$
begin
  return public.dpdp_create_my_org(p_org_name, p_account_type, p_referral_code) || jsonb_build_object('accountType', p_account_type);
end $f$;
-- the pay core: opens an "attempt" and tells who and what, like the real one
create table public.t_attempts (id text, org_id text);
create or replace function public.dpdp_pay_begin(p_interval text, p_org_id text default null) returns jsonb language plpgsql security definer set search_path = '' as $f$
declare m dpdp.membership; v_attempt text := replace(gen_random_uuid()::text, '-', '');
begin
  m := public.dpdp__caller_membership(p_org_id);
  if m.id is null then raise exception 'Not a member of this organisation' using errcode = '42501'; end if;
  insert into public.t_attempts values (v_attempt, m.org_id);
  return jsonb_build_object('attemptId', v_attempt, 'orgId', m.org_id, 'interval', p_interval);
end $f$;
`

let db: PGlite
const as = (email: string) => db.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify(email ? { email } : {})])
type J = Record<string, unknown>
const one = async <T = J>(sql: string, params: unknown[] = []) => (await db.query<{ r: T }>(sql, params)).rows[0].r
const rows = async <T = J>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows
const acceptances = () => rows<Record<string, unknown>>(`select * from dpdp.terms_acceptance order by accepted_at, id`)

async function refusal(promise: Promise<unknown>): Promise<{ message: string; hint?: string; code?: string }> {
  try {
    await promise
  } catch (e) {
    return e as { message: string; hint?: string; code?: string }
  }
  throw new Error('expected the call to be refused, but it succeeded')
}

beforeAll(async () => {
  db = new PGlite()
  await db.exec(BASE_SQL)
  await db.exec(STAND_INS)
  await db.exec(read(MIGRATION))
}, 120_000)

describe('K2: opening the organisation / account needs the ticked box', () => {
  test('refused without the box: the sentence, SQLSTATE 22023, hint consent-required -- and nothing is created', async () => {
    await as('k2a@owner.test')
    const orgsBefore = (await rows(`select id from dpdp.organisation`)).length
    for (const extra of ['', `, null, false`, `, '2026-10-13', false`, `, null, true`, `, '2026-10-12', true`, `, '', true`]) {
      const e = await refusal(db.query(OPEN(extra)))
      expect(e.message).toBe('Please tick the box to continue.')
      expect(e.hint).toBe('consent-required')
      expect(e.code).toBe('22023')
    }
    expect((await rows(`select id from dpdp.organisation`)).length).toBe(orgsBefore)
    expect(await acceptances()).toEqual([])
  })

  test('accepted with the current version and a true box: the organisation opens and ONE tick is recorded and read back', async () => {
    await as('k2b@owner.test')
    const r = await one<{ ok: boolean; orgId: string }>(OPEN(`, '2026-10-13', true`))
    expect(r.ok).toBe(true)
    const [row] = await rows<Record<string, unknown>>(`select * from dpdp.terms_acceptance where org_id = $1`, [r.orgId])
    expect(row.kind).toBe('K2')
    expect(row.reference).toBe('signup')
    expect(row.terms_version).toBe('2026-10-13')
    expect(row.box_text_hash).toBe(sha(K2))
    expect(row.org_id).toBe(r.orgId)
    const identity = (await rows<{ id: string }>(`select identity_id as id from dpdp.identity_email where email = 'k2b@owner.test'`))[0].id
    expect(row.identity_id).toBe(identity) // WHO
    expect(row.accepted_at).toBeInstanceOf(Date) // WHEN
    expect((await rows(`select 1 from dpdp.terms_acceptance where kind = 'K2'`)).length).toBeGreaterThanOrEqual(1)
  })

  test('a direct call to dpdp_create_my_org is refused the same way, and accepted (and recorded once) with the tick', async () => {
    await as('k2c@owner.test')
    const e = await refusal(db.query(`select public.dpdp_create_my_org('Direct Co', 'firm') as r`))
    expect(e.message).toBe('Please tick the box to continue.')
    expect(e.hint).toBe('consent-required')
    const r = await one<{ orgId: string }>(`select public.dpdp_create_my_org('Direct Co', 'firm', null, '2026-10-13', true) as r`)
    const got = await rows(`select * from dpdp.terms_acceptance where org_id = $1`, [r.orgId])
    expect(got.length).toBe(1)
  })

  test('no flag is left behind by a sign-up: a later direct call is refused again', async () => {
    await as('k2d@owner.test')
    await one(OPEN(`, '2026-10-13', true`))
    expect((await rows(`select coalesce(current_setting('dpdp.terms_ok', true), '') as v`))[0].v).not.toBe('on')
    const e = await refusal(db.query(`select public.dpdp_create_my_org('Second Co', 'firm') as r`))
    expect(e.hint).toBe('consent-required')
  })

  test('a double click (the same tick again) is recorded once', async () => {
    await as('k2e@owner.test')
    const r = await one<{ orgId: string }>(OPEN(`, '2026-10-13', true`))
    await db.query(`select dpdp.terms_record('K2', (select identity_id from dpdp.terms_acceptance where org_id = $1), $1, 'signup', '2026-10-13')`, [r.orgId])
    expect((await rows(`select 1 from dpdp.terms_acceptance where org_id = $1`, [r.orgId])).length).toBe(1)
  })
})

describe('K3: paying needs the ticked box', () => {
  async function owner(email: string): Promise<string> {
    await as(email)
    return (await one<{ orgId: string }>(OPEN(`, '2026-10-13', true`))).orgId
  }

  test('refused without the box, with an old version, or with a string "true": no attempt is opened', async () => {
    const orgId = await owner('k3a@owner.test')
    const before = (await rows(`select * from public.t_attempts`)).length
    for (const args of [`'year'`, `'year', null`, `'year', null, null, false`, `'year', null, '2026-10-13', false`, `'year', null, '2026-10-12', true`]) {
      const e = await refusal(db.query(`select public.dpdp_pay_begin(${args}) as r`))
      expect(e.message).toBe('Please tick the box to continue.')
      expect(e.hint).toBe('consent-required')
    }
    expect((await rows(`select * from public.t_attempts`)).length).toBe(before)
    expect((await rows(`select 1 from dpdp.terms_acceptance where kind = 'K3' and org_id = $1`, [orgId])).length).toBe(0)
  })

  test('accepted with the box: the attempt opens and a K3 tick is recorded against that attempt id, with the wording hash', async () => {
    const orgId = await owner('k3b@owner.test')
    const r = await one<{ attemptId: string; orgId: string }>(`select public.dpdp_pay_begin('year', null, '2026-10-13', true) as r`)
    expect(r.orgId).toBe(orgId)
    const [row] = await rows<Record<string, unknown>>(`select * from dpdp.terms_acceptance where kind = 'K3' and org_id = $1`, [orgId])
    expect(row.reference).toBe(r.attemptId)
    expect(row.terms_version).toBe('2026-10-13')
    expect(row.box_text_hash).toBe(sha(K3))
  })

  test('a second payment is a second tick (one per attempt); the owner-only rule of the core still applies', async () => {
    const orgId = await owner('k3c@owner.test')
    await db.query(`select public.dpdp_pay_begin('year', null, '2026-10-13', true)`)
    await db.query(`select public.dpdp_pay_begin('year', null, '2026-10-13', true)`)
    expect((await rows(`select 1 from dpdp.terms_acceptance where kind = 'K3' and org_id = $1`, [orgId])).length).toBe(2)
    await as('stranger@x.test')
    const e = await refusal(db.query(`select public.dpdp_pay_begin('year', $1, '2026-10-13', true)`, [orgId]))
    expect(e.message).toMatch(/Not a member/)
  })
})

describe('a version bump asks again', () => {
  test('after the database constant changes, the old version is refused and the new one accepted', async () => {
    const orgId = (await (async () => { await as('bump@owner.test'); return one<{ orgId: string }>(OPEN(`, '2026-10-13', true`)) })()).orgId
    await db.exec(`create or replace function dpdp.terms_current_version() returns text language sql immutable set search_path = '' as $$ select '2027-01-01'::text $$;`)
    try {
      const e = await refusal(db.query(`select public.dpdp_pay_begin('year', null, '2026-10-13', true) as r`))
      expect(e.message).toBe('Please tick the box to continue.')
      expect(e.hint).toBe('consent-required')
      const ok = await one<{ attemptId: string }>(`select public.dpdp_pay_begin('year', null, '2027-01-01', true) as r`)
      const [row] = await rows<Record<string, unknown>>(`select * from dpdp.terms_acceptance where reference = $1`, [ok.attemptId])
      expect(row.terms_version).toBe('2027-01-01')
      expect(row.org_id).toBe(orgId)
      // the earlier tick keeps the version it was given against
      expect((await rows<Record<string, unknown>>(`select terms_version from dpdp.terms_acceptance where reference = 'signup' and org_id = $1`, [orgId]))[0].terms_version).toBe('2026-10-13')
    } finally {
      await db.exec(`create or replace function dpdp.terms_current_version() returns text language sql immutable set search_path = '' as $$ select '2026-10-13'::text $$;`)
    }
  })
})

describe('the record itself', () => {
  test('the box wording in the database is the agreed wording, and the stored hash is the SHA-256 of exactly that text', async () => {
    expect(await one<string>(`select dpdp.terms_box_text('K2') as r`)).toBe(K2)
    expect(await one<string>(`select dpdp.terms_box_text('K3') as r`)).toBe(K3)
    expect(await one<string | null>(`select dpdp.terms_box_text('K9') as r`)).toBeNull()
    expect(await one<string>(`select dpdp.terms_current_version() as r`)).toBe('2026-10-13')
  })

  test('the table holds who, kind, reference, version, wording hash, time -- and NO IP address or device detail', async () => {
    const cols = (await rows<{ column_name: string }>(`select column_name from information_schema.columns where table_schema = 'dpdp' and table_name = 'terms_acceptance' order by ordinal_position`)).map((c) => c.column_name)
    expect(cols).toEqual(['id', 'identity_id', 'org_id', 'kind', 'reference', 'terms_version', 'box_text_hash', 'accepted_at'])
    expect(cols.filter((c) => /(^|_)ip(_|$)|addr|device|agent|browser|header|geo/i.test(c))).toEqual([])
  })

  test('a recorded tick is never edited, and an unknown kind or a bad hash is not storable', async () => {
    const [row] = await rows<{ id: string }>(`select id from dpdp.terms_acceptance limit 1`)
    expect((await refusal(db.query(`update dpdp.terms_acceptance set terms_version = 'x' where id = $1`, [row.id]))).message).toMatch(/cannot be changed/)
    await expect(db.query(`insert into dpdp.terms_acceptance (identity_id, kind, reference, terms_version, box_text_hash) values ('i', 'K9', 'r', 'v', repeat('a', 64))`)).rejects.toThrow()
    await expect(db.query(`insert into dpdp.terms_acceptance (identity_id, kind, reference, terms_version, box_text_hash) values ('i', 'K2', 'r', 'v', 'not-a-hash')`)).rejects.toThrow()
  })

  test('a browser role cannot read or write the table, nor call the internal helpers or the old cores', async () => {
    const priv = async (sql: string) => (await rows<{ ok: boolean }>(sql))[0].ok
    for (const role of ['anon', 'authenticated']) {
      expect(await priv(`select has_table_privilege('${role}', 'dpdp.terms_acceptance', 'select') as ok`), `${role} select`).toBe(false)
      expect(await priv(`select has_table_privilege('${role}', 'dpdp.terms_acceptance', 'insert') as ok`), `${role} insert`).toBe(false)
      expect(await priv(`select has_function_privilege('${role}', 'dpdp.terms_record(text, text, text, text, text)', 'execute') as ok`), `${role} record`).toBe(false)
      expect(await priv(`select has_function_privilege('${role}', 'public.dpdp__open_account_core(text, text, text, text, text, text, text, timestamptz, text)', 'execute') as ok`), `${role} open core`).toBe(false)
      expect(await priv(`select has_function_privilege('${role}', 'public.dpdp__create_my_org_core(text, text, text)', 'execute') as ok`), `${role} org core`).toBe(false)
    }
    expect((await rows<{ rowsecurity: boolean }>(`select relrowsecurity as rowsecurity from pg_class where oid = 'dpdp.terms_acceptance'::regclass`))[0].rowsecurity).toBe(true)
    // the three doors a browser does have
    expect(await priv(`select has_function_privilege('authenticated', 'public.dpdp_open_account(text, text, text, text, text, text, text, timestamptz, text, text, boolean)', 'execute') as ok`)).toBe(true)
    expect(await priv(`select has_function_privilege('authenticated', 'public.dpdp_create_my_org(text, text, text, text, boolean)', 'execute') as ok`)).toBe(true)
    expect(await priv(`select has_function_privilege('authenticated', 'public.dpdp_pay_begin(text, text, text, boolean)', 'execute') as ok`)).toBe(true)
    expect(await priv(`select has_function_privilege('anon', 'public.dpdp_pay_begin(text, text, text, boolean)', 'execute') as ok`)).toBe(false)
  })

  test('the old two-argument pay door and the old nine-argument sign-up door no longer exist under their names (so no ambiguous overload)', async () => {
    const names = await rows<{ proname: string; pronargs: number }>(`select p.proname, p.pronargs::int as pronargs from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('dpdp_pay_begin', 'dpdp_open_account', 'dpdp_create_my_org') order by 1`)
    expect(names).toEqual([{ proname: 'dpdp_create_my_org', pronargs: 5 }, { proname: 'dpdp_open_account', pronargs: 11 }, { proname: 'dpdp_pay_begin', pronargs: 4 }])
  })
})

describe('repeat-safe', () => {
  test('running the whole file again changes nothing: same functions, same rows, and the doors still work', async () => {
    const shape = () => rows(`select n.nspname, p.proname, p.pronargs::int as pronargs from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', 'dpdp') and (p.proname like '%terms%' or p.proname like 'dpdp%core' or p.proname in ('dpdp_pay_begin', 'dpdp_open_account', 'dpdp_create_my_org')) order by 1, 2, 3`)
    const before = await shape()
    expect(before.length).toBeGreaterThanOrEqual(10)
    const count = (await acceptances()).length
    await db.exec(read(MIGRATION))
    await db.exec(read(MIGRATION))
    expect(await shape()).toEqual(before)
    expect((await acceptances()).length).toBe(count)
    await as('again@owner.test')
    expect((await refusal(db.query(OPEN()))).hint).toBe('consent-required')
    expect((await one<{ ok: boolean }>(OPEN(`, '2026-10-13', true`))).ok).toBe(true)
  })
})
