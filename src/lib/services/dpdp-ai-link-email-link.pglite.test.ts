/// <reference types="bun-types" />
// drizzle/0695 on PGlite (real Postgres as WASM): the e-mailed AI work link is its own short-lived row (48 h weekly, 24 h one-off), an expired
// link answers exactly like an unknown token, the person's persistent link is untouched, and the unfamiliar-use alert is decided as the owner
// asked: never for the first use, only for a new network prefix or tool, at most once per 24 hours per link.
// The function bodies are copied out of the migrations at run time.
//
// Run: bun test --isolate src/lib/services/dpdp-ai-link-email-link.pglite.test.ts
import { beforeAll, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const read = (f: string) => readFileSync(new URL(`../../../drizzle/${f}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const m0695 = read('0695_dpdp_ai_link_email_short_and_unfamiliar_use.sql')
const m0664 = read('0664_dpdp_email_ai_link_hardening.sql')
const grab = (sql: string, name: string) => {
  const m = sql.match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\n\\$\\$;`))
  if (!m) throw new Error(`${name} not found`)
  return m[0]
}

let db: PGlite
const q = async <T = Record<string, unknown>>(sql: string, args: unknown[] = []) => (await db.query<T>(sql, args)).rows
const note = async (tok: string, ip: string, ua: string) => (await q<{ r: Record<string, unknown> }>(`select public.dpdp_ai_link_note_use($1,$2,$3) as r`, [tok, ip, ua]))[0].r
const hash = (tok: string) => `encode(sha256(convert_to('${tok}','UTF8')),'hex')`

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create role service_role nologin; create role app_runtime nologin;
    create schema dpdp; create schema extensions;
    create function extensions.gen_random_bytes(n int) returns bytea language sql as $f$ select decode(md5(random()::text || clock_timestamp()::text) || md5(random()::text), 'hex') $f$;
    create table dpdp.organisation (id text primary key, name text);
    create table dpdp.identity (id text primary key, primary_email text);
    create table dpdp.membership (id text primary key, org_id text, identity_id text, state text default 'active');
    create table dpdp.ai_link (
      id text primary key, org_id text, identity_id text, membership_id text, token text, token_hash text, created_at timestamp, expires_at timestamp,
      revoked_at timestamp, read_count int default 0, authority_level int, hide_emails boolean default false, created_by_membership_id text, label text, call_count int default 0
    );
    -- the 0607 resolver's own logic (hash lookup; revoked, expired or unknown: one refusal)
    create function public.dpdp__ai_link_for_token(p_token text) returns dpdp.ai_link language plpgsql as $f$
    declare v_hash text := encode(sha256(convert_to(left(coalesce(p_token,''),256),'UTF8')),'hex'); v_l dpdp.ai_link; v_now timestamp := (clock_timestamp() at time zone 'UTC');
    begin
      select l.* into v_l from dpdp.ai_link l where l.token_hash = v_hash;
      if v_l.id is null or v_l.revoked_at is not null or v_l.expires_at <= v_now then raise exception 'This link has expired or was revoked' using errcode = '42501'; end if;
      return v_l;
    end $f$;
    create function public.dpdp__ai_link_warning_for(p_membership_id text) returns jsonb language sql as $f$ select '{"jobs":3,"people":2}'::jsonb $f$;
    create function public.dpdp__viewer_kind(p_membership_id text) returns text language sql as $f$ select 'owner'::text $f$;
    insert into dpdp.organisation values ('o1','Acme');
    insert into dpdp.identity values ('i1','owner@example.test');
    insert into dpdp.membership values ('m1','o1','i1','active');
  `)
  // 0695's own DDL and functions, straight from the migration (the mint, the table, the column, the alert decision) and 0664's finish step.
  await db.exec(m0695.replace(/grant update on table dpdp\.ai_link to service_role;/, '').replace(/revoke all on table[^;]*;/g, '').replace(/grant select, insert on table[^;]*;/g, '').replace(/revoke all on function[^;]*;/g, '').replace(/grant execute on function[^;]*;/g, ''))
  await db.exec(grab(m0664, 'dpdp_timer_finish_email_ai_link'))
}, 120_000)

describe('the e-mailed link is its own short-lived row', () => {
  test('weekly mail: 2 days = 48 hours; one-off: 1 day = 24 hours; 7 and 30 still allowed; anything else refused', async () => {
    for (const [days, hours] of [[2, 48], [1, 24], [7, 168], [30, 720]] as const) {
      const r = (await q<{ r: Record<string, unknown> }>(`select public.dpdp_timer_mint_email_ai_link('m1', 1, $1) as r`, [days]))[0].r
      expect(String(r.token)).toMatch(/^[0-9a-f]{64}$/)
      const row = (await q<{ h: number; label: string }>(`select extract(epoch from (expires_at - created_at))/3600 as h, label from dpdp.ai_link where id = $1`, [r.linkId]))[0]
      expect(Number(row.h)).toBe(hours)
      expect(row.label).toBe('Monday email')
    }
    for (const bad of [0, 3, 14, 90]) await expect(db.query(`select public.dpdp_timer_mint_email_ai_link('m1', 1, $1)`, [bad])).rejects.toThrow(/can last 1 day/)
  })
  test('the default is 48 hours', async () => {
    const r = (await q<{ r: Record<string, unknown> }>(`select public.dpdp_timer_mint_email_ai_link('m1') as r`))[0].r
    const row = (await q<{ h: number }>(`select extract(epoch from (expires_at - created_at))/3600 as h from dpdp.ai_link where id = $1`, [r.linkId]))[0]
    expect(Number(row.h)).toBe(48)
  })
  test('expiry boundary: a second before it the link answers; at and after it, the very same refusal an unknown token gets', async () => {
    const tok = 'b'.repeat(64)
    await db.exec(`insert into dpdp.ai_link (id, org_id, identity_id, membership_id, token_hash, created_at, expires_at, authority_level, label)
      values ('edge','o1','i1','m1', ${hash(tok)}, (clock_timestamp() at time zone 'UTC') - interval '2 days', (clock_timestamp() at time zone 'UTC') + interval '20 seconds', 1, 'Monday email')`)
    expect((await note(tok, '', 'x')).alert).toBe(false) // live
    await db.exec(`update dpdp.ai_link set expires_at = (clock_timestamp() at time zone 'UTC') - interval '1 second' where id = 'edge'`)
    let expired = ''
    await db.query(`select public.dpdp_ai_link_note_use($1,'','x')`, [tok]).catch((e: Error) => { expired = e.message })
    let unknown = ''
    await db.query(`select public.dpdp_ai_link_note_use($1,'','x')`, ['c'.repeat(64)]).catch((e: Error) => { unknown = e.message })
    expect(expired).toMatch(/expired or was revoked/)
    expect(expired).toBe(unknown)
  })
  test('a persistent link made on the AI Link page (another label, 30 days) is never retired by the e-mail finish step', async () => {
    await db.exec(`insert into dpdp.ai_link (id, org_id, identity_id, membership_id, token_hash, created_at, expires_at, authority_level, label)
      values ('persist','o1','i1','m1', ${hash('d'.repeat(64))}, (clock_timestamp() at time zone 'UTC'), (clock_timestamp() at time zone 'UTC') + interval '30 days', 1, 'My AI link')`)
    const fresh = (await q<{ r: Record<string, unknown> }>(`select public.dpdp_timer_mint_email_ai_link('m1', 1, 2) as r`))[0].r
    await q(`select public.dpdp_timer_finish_email_ai_link('m1', $1, true)`, [fresh.linkId])
    const rows = await q<{ id: string; revoked_at: string | null }>(`select id, revoked_at from dpdp.ai_link where id in ('persist', $1)`, [fresh.linkId])
    expect(rows.find((r) => r.id === 'persist')!.revoked_at).toBeNull()
    expect(rows.find((r) => r.id === fresh.linkId)!.revoked_at).toBeNull()
    expect((await note('d'.repeat(64), '', 'x')).alert).toBe(false) // still resolves
  })
})

describe('dpdp_ai_link_note_use: the unfamiliar-use alert decision', () => {
  const T = 'e'.repeat(64)
  beforeAll(async () => {
    await db.exec(`insert into dpdp.ai_link (id, org_id, identity_id, membership_id, token_hash, created_at, expires_at, authority_level, label)
      values ('alerty','o1','i1','m1', ${hash(T)}, (clock_timestamp() at time zone 'UTC'), (clock_timestamp() at time zone 'UTC') + interval '2 days', 1, 'Monday email')`)
  })
  test('the first ever use never alerts, and neither does the same network and tool again', async () => {
    expect((await note(T, '203.0.113', 'curl')).alert).toBe(false)
    expect((await note(T, '203.0.113', 'curl')).alert).toBe(false)
  })
  test('a new network prefix alerts once, to the link owner, with no link in the answer', async () => {
    const r = await note(T, '198.51.100', 'curl')
    expect(r).toMatchObject({ alert: true, to: 'owner@example.test', org: 'Acme', role: 'owner', newNetwork: true, newTool: false })
    expect(JSON.stringify(r)).not.toMatch(/[0-9a-f]{64}/)
    expect(JSON.stringify(r)).not.toContain('/ai/')
  })
  test('rate limit: another new tool inside 24 hours does not alert; after 24 hours it does', async () => {
    expect((await note(T, '198.51.100', 'Claude')).alert).toBe(false)
    await db.exec(`update dpdp.ai_link set unfamiliar_alert_at = (clock_timestamp() at time zone 'UTC') - interval '25 hours' where id = 'alerty'`)
    expect(await note(T, '198.51.100', 'Gemini')).toMatchObject({ alert: true, newTool: true, newNetwork: false })
    await db.exec(`update dpdp.ai_link set unfamiliar_alert_at = (clock_timestamp() at time zone 'UTC') - interval '23 hours' where id = 'alerty'`)
    expect((await note(T, '192.0.2', 'Grok')).alert).toBe(false)
  })
  test('nothing known about the caller means nothing to compare: no alert, nothing stored', async () => {
    const before = (await q<{ n: number }>(`select count(*)::int as n from dpdp.ai_link_seen`))[0].n
    expect((await note(T, '', '')).alert).toBe(false)
    expect((await q<{ n: number }>(`select count(*)::int as n from dpdp.ai_link_seen`))[0].n).toBe(before)
  })
})
