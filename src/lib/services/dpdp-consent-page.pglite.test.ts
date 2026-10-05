/// <reference types="bun-types" />
// drizzle/0701 on PGlite (real Postgres as WASM; no live database touched): the consent page's database side.
//   * an existing campaign (no purposes stored, not a child) behaves as before, and the ORIGINAL dpdp_parent_consent (copied out of drizzle/0609) still works;
//   * the page can show the notice text (the organisation's own, or a plain standard one), the purposes, each with the person's current answer;
//   * one answer per purpose, once; a child's campaign needs the parent's or guardian's name and relationship;
//   * withdraw works with the SAME link, without a new link and after the link's expiry, as a new row, never an edit;
//   * nothing about creating a campaign or a token changed: the new columns are additive and defaulted.
// Run: bun test --isolate src/lib/services/dpdp-consent-page.pglite.test.ts
import { beforeAll, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const read = (f: string) => readFileSync(new URL(`../../../drizzle/${f}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const up = read('0701_dpdp_consent_page_purposes_guardian_withdraw.sql')
const down = read('down/0701_dpdp_consent_page_purposes_guardian_withdraw.down.sql')
const m0609 = read('0609_dpdp_wo011_step5_rpc.sql')
const origConsent = m0609.match(/create or replace function public\.dpdp_parent_consent\(p_token text, p_answer text\)[\s\S]*?\n\$\$;/)![0]

let db: PGlite
const q = async <T = Record<string, unknown>>(sql: string, args: unknown[] = []) => (await db.query<T>(sql, args)).rows
const j = async (sql: string, args: unknown[] = []) => (await q<{ r: any }>(sql, args))[0].r
const preview = (t: string) => j(`select public.dpdp_parent_consent_preview($1) as r`, [t])
const v2 = (t: string, answers: unknown, guardian: unknown = null) => j(`select public.dpdp_parent_consent_v2($1, $2::jsonb, $3::jsonb) as r`, [t, JSON.stringify(answers), guardian === null ? null : JSON.stringify(guardian)])
const withdraw = (t: string, k: string) => j(`select public.dpdp_consent_withdraw($1, $2) as r`, [t, k])

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role app_runtime nologin; create role service_role nologin;
    create schema dpdp;
    create table dpdp.organisation (id text primary key, name text);
    create table dpdp.notice_version (id text primary key, org_id text, doc_kind text, version text, languages text[]);
    create table dpdp.grievance_officer (id text primary key, org_id text, email text, superseded_at timestamp, published_since timestamp);
    create table dpdp.consent_campaign (id text primary key, org_id text, group_id text, notice_version_id text, sent_at timestamp, channel text default 'email');
    create table dpdp.consent_token (id text primary key, campaign_id text, token text unique, contact_hash text, opened_at timestamp, acted_at timestamp, expires_at timestamp not null);
    create table dpdp.consent_record (id text primary key, token_id text, purpose_key text, granted boolean, notice_version_id text, language text default 'en', recorded_at timestamp default now(), withdrawn_at timestamp);
    create table dpdp.events_seen (kind text, summary text);
    create function public.dpdp__append_event(a text, b text, c text, d text, e text) returns void language sql as $f$ insert into dpdp.events_seen values (d, e) $f$;

    insert into dpdp.organisation values ('o1', 'Sunrise School');
    insert into dpdp.notice_version values ('n1', 'o1', 'privacy', '1.0', '{en}'), ('n2', 'o1', 'privacy', '2.0', '{en}');
    insert into dpdp.grievance_officer values ('g1', 'o1', 'officer@sunrise.example', null, now());
    -- a legacy campaign: no purposes, not a child
    insert into dpdp.consent_campaign (id, org_id, group_id, notice_version_id) values ('c-legacy', 'o1', 'g', 'n1');
    insert into dpdp.consent_token values ('t1', 'c-legacy', 'tok-legacy', 'h1', null, null, now() + interval '30 days'), ('t1b', 'c-legacy', 'tok-legacy-2', 'h1b', null, null, now() + interval '30 days');
  `)
  // the ORIGINAL answer function, straight from 0609 (it must keep working after 0701)
  await db.exec(origConsent)
  await db.exec(up)
  await db.exec(`
    insert into dpdp.consent_campaign (id, org_id, group_id, notice_version_id, purposes) values
      ('c-multi', 'o1', 'g', 'n1', '[{"key":"trip","label":"School trip photos"},{"key":"news","label":"Newsletter"}]');
    insert into dpdp.consent_campaign (id, org_id, group_id, notice_version_id, purposes, principal_is_child) values
      ('c-child', 'o1', 'g', 'n2', '[{"key":"photos","label":"Photos of your child"}]', true);
    update dpdp.notice_version set body_text = 'Sunrise School keeps your child''s photos for one year.' where id = 'n2';
    insert into dpdp.consent_token values
      ('t2', 'c-multi', 'tok-multi', 'h2', null, null, now() + interval '30 days'),
      ('t3', 'c-child', 'tok-child', 'h3', null, null, now() + interval '30 days'),
      ('t4', 'c-multi', 'tok-expired-unused', 'h4', null, null, now() - interval '1 day'),
      ('t5', 'c-multi', 'tok-expired-acted', 'h5', now() - interval '40 days', now() - interval '39 days', now() - interval '1 day');
    insert into dpdp.consent_record (id, token_id, purpose_key, granted, notice_version_id, recorded_at) values
      ('r5a', 't5', 'trip', true, 'n1', now() - interval '39 days'), ('r5b', 't5', 'news', false, 'n1', now() - interval '39 days');
    update dpdp.consent_record set withdrawn_at = recorded_at where id = 'r5b';
  `)
}, 120_000)

describe('an existing campaign behaves as before', () => {
  test('the preview keeps its original keys and gains the new ones; a standard notice is built from what the system knows', async () => {
    const p = await preview('tok-legacy')
    expect(p).toMatchObject({ ok: true, orgName: 'Sunrise School', notice: { docKind: 'privacy', version: '1.0' }, alreadyAnswered: false, principalIsChild: false, canWithdraw: false, noticeSource: 'standard' })
    expect(p.purposes).toEqual([{ key: 'consent', label: 'Use of your personal data as described in this notice', answer: null }])
    expect(p.noticeText).toContain('Sunrise School asks for your consent')
    expect(p.noticeText).toContain('officer@sunrise.example')
    expect(p.noticeText).toContain('Data Protection Board of India')
    expect(p.noticeText).toContain('withdraw a Yes at any time, using this same link')
  })
  test('the ORIGINAL dpdp_parent_consent still records Yes, once, and the preview then shows it and allows withdrawal', async () => {
    expect(await j(`select public.dpdp_parent_consent('tok-legacy', 'yes') as r`)).toEqual({ ok: true, answer: 'yes' })
    expect((await j(`select public.dpdp_parent_consent('tok-legacy', 'no') as r`)).reason).toMatch(/already been used/)
    const p = await preview('tok-legacy')
    expect(p).toMatchObject({ alreadyAnswered: true, canWithdraw: true })
    expect(p.purposes[0].answer).toBe('yes')
  })
  test('an unknown token and an expired, unused token are refused exactly as before', async () => {
    expect((await preview('nope')).reason).toBe('This link is not valid or has expired')
    expect((await preview('tok-expired-unused')).reason).toBe('This link is not valid or has expired')
  })
})

describe('one answer per purpose, once', () => {
  test('every purpose must be answered Yes or No, and nothing extra is accepted', async () => {
    expect((await v2('tok-multi', { trip: 'yes' })).reason).toMatch(/answer Yes or No for each/)
    expect((await v2('tok-multi', { trip: 'yes', news: 'maybe' })).reason).toMatch(/answer Yes or No for each/)
    expect((await v2('tok-multi', { trip: 'yes', news: 'no', extra: 'yes' })).reason).toMatch(/not an answer/)
    expect(await q(`select 1 from dpdp.consent_record where token_id = 't2'`)).toEqual([])
  })
  test('Yes to one and No to the other is recorded per purpose, No as a refusal row', async () => {
    expect(await v2('tok-multi', { trip: 'yes', news: 'no' })).toEqual({ ok: true, recorded: 2 })
    const rows = await q<{ purpose_key: string; granted: boolean; withdrawn: boolean }>(`select purpose_key, granted, withdrawn_at is not null as withdrawn from dpdp.consent_record where token_id = 't2' order by purpose_key`)
    expect(rows).toEqual([{ purpose_key: 'news', granted: false, withdrawn: true }, { purpose_key: 'trip', granted: true, withdrawn: false }])
    expect((await v2('tok-multi', { trip: 'no', news: 'no' })).reason).toMatch(/already been used/)
  })
  test('the preview shows each current answer', async () => {
    const p = await preview('tok-multi')
    expect(p.purposes.map((x: { key: string; answer: string }) => [x.key, x.answer])).toEqual([['trip', 'yes'], ['news', 'no']])
    expect(p.canWithdraw).toBe(true)
  })
})

describe('a child: the parent or guardian answers', () => {
  test('uses the organisation\'s own notice text, and needs the name and the relationship', async () => {
    const p = await preview('tok-child')
    expect(p).toMatchObject({ principalIsChild: true, noticeSource: 'organisation', noticeText: "Sunrise School keeps your child's photos for one year." })
    expect((await v2('tok-child', { photos: 'yes' })).reason).toMatch(/name of the parent or legal guardian/)
    expect((await v2('tok-child', { photos: 'yes' }, { name: 'A', relation: 'parent' })).reason).toMatch(/name of the parent or legal guardian/)
    expect((await v2('tok-child', { photos: 'yes' }, { name: 'Meera Rao', relation: 'uncle' })).reason).toMatch(/parent or the legal guardian/)
    expect(await q(`select 1 from dpdp.consent_record where token_id = 't3'`)).toEqual([])
  })
  test('with both, the answer and the guardian are stored and shown', async () => {
    expect(await v2('tok-child', { photos: 'yes' }, { name: 'Meera Rao', relation: 'legal_guardian' })).toEqual({ ok: true, recorded: 1 })
    const p = await preview('tok-child')
    expect(p.guardian).toEqual({ name: 'Meera Rao', relation: 'legal_guardian' })
    expect((await q<{ n: string; r: string }>(`select guardian_name as n, guardian_relation as r from dpdp.consent_token where id = 't3'`))[0]).toEqual({ n: 'Meera Rao', r: 'legal_guardian' })
  })
  test('a campaign that is not for a child stores no guardian even if one is sent', async () => {
    await db.exec(`insert into dpdp.consent_token values ('t6', 'c-multi', 'tok-adult', 'h6', null, null, now() + interval '30 days')`)
    await v2('tok-adult', { trip: 'no', news: 'no' }, { name: 'Someone Else', relation: 'parent' })
    expect((await q<{ n: string | null }>(`select guardian_name as n from dpdp.consent_token where id = 't6'`))[0].n).toBeNull()
  })
})

describe('withdraw, with the same link', () => {
  test('a Yes is withdrawn as a NEW row (the Yes row is not edited), and the preview then says withdrawn', async () => {
    const before = await q<{ id: string; withdrawn_at: string | null }>(`select id, withdrawn_at::text from dpdp.consent_record where token_id = 't2' and purpose_key = 'trip'`)
    expect(await withdraw('tok-multi', 'trip')).toEqual({ ok: true, withdrawn: 'trip' })
    const rows = await q<{ granted: boolean; withdrawn_at: string | null }>(`select granted, withdrawn_at::text from dpdp.consent_record where token_id = 't2' and purpose_key = 'trip' order by recorded_at, id`)
    expect(rows.length).toBe(2)
    expect((await q<{ id: string; withdrawn_at: string | null }>(`select id, withdrawn_at::text from dpdp.consent_record where id = $1`, [before[0].id]))[0].withdrawn_at).toBeNull()
    expect(rows[1]).toMatchObject({ granted: false })
    expect(rows[1].withdrawn_at).not.toBeNull()
    expect((await preview('tok-multi')).purposes.find((x: { key: string }) => x.key === 'trip').answer).toBe('withdrawn')
    expect((await q<{ n: number }>(`select count(*)::int as n from dpdp.events_seen where kind = 'consent_withdrawn'`))[0].n).toBe(1)
  })
  test('withdrawing twice, withdrawing a No, or an item that is not on the link, is refused plainly and records nothing', async () => {
    expect((await withdraw('tok-multi', 'trip')).reason).toMatch(/nothing to withdraw for this item/)
    expect((await withdraw('tok-multi', 'news')).reason).toMatch(/nothing to withdraw for this item/)
    expect((await withdraw('tok-multi', 'nope')).reason).toMatch(/not one of the items/)
    expect((await withdraw('tok-unknown', 'trip')).reason).toMatch(/not valid/)
    expect((await q<{ n: number }>(`select count(*)::int as n from dpdp.consent_record where token_id = 't2'`))[0].n).toBe(3)
  })
  test('a link that was never answered has nothing to withdraw', async () => {
    await db.exec(`insert into dpdp.consent_token values ('t7', 'c-multi', 'tok-fresh', 'h7', null, null, now() + interval '30 days')`)
    expect((await withdraw('tok-fresh', 'trip')).reason).toMatch(/nothing to withdraw yet/)
  })
  test('works after the link has expired, with no new link; the expired link also still shows the person their answers', async () => {
    await db.exec(`insert into dpdp.consent_record (id, token_id, purpose_key, granted, notice_version_id) values ('r5c', 't5', 'trip', true, 'n1')`)
    // t5 answered earlier (trip yes at -39d, then this newer yes), link expired yesterday
    expect((await preview('tok-expired-acted')).ok).toBe(true)
    expect(await withdraw('tok-expired-acted', 'trip')).toEqual({ ok: true, withdrawn: 'trip' })
  })
  test('giving consent on an expired link is still refused', async () => {
    expect((await v2('tok-expired-unused', { trip: 'yes', news: 'yes' })).reason).toMatch(/expired/)
  })
})

describe('roll-back', () => {
  test('removes the new functions and the new columns, and leaves the original answer function in place', async () => {
    await db.exec(down)
    expect((await q<{ n: number }>(`select count(*)::int as n from pg_proc where proname in ('dpdp_parent_consent_v2', 'dpdp_consent_withdraw', 'consent_purposes', 'consent_notice_text')`))[0].n).toBe(0)
    expect((await q<{ n: number }>(`select count(*)::int as n from information_schema.columns where table_schema = 'dpdp' and column_name in ('purposes', 'principal_is_child', 'guardian_name', 'guardian_relation', 'guardian_recorded_at', 'body_text')`))[0].n).toBe(0)
    expect((await q<{ n: number }>(`select count(*)::int as n from pg_proc where proname = 'dpdp_parent_consent'`))[0].n).toBe(1)
  })
})
