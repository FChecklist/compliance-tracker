/// <reference types="bun-types" />
// drizzle/0676: public.dpdp_ai_link_billing_notice(token) -- "has this link's organisation's free trial ended with nothing paid?".
// Offline on PGlite; the function body is copied out of the migration at run time. It only READS: a notice, never a lock.
//
// Run: bun test --isolate src/lib/services/dpdp-ai-link-billing-notice.pglite.test.ts
import { beforeAll, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const sql = readFileSync(new URL('../../../drizzle/0676_dpdp_claim_reject_and_ai_link_billing_notice.sql', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const fn = sql.match(/create or replace function public\.dpdp_ai_link_billing_notice\([\s\S]*?\n\$\$;/)?.[0]
if (!fn) throw new Error('dpdp_ai_link_billing_notice not found in 0676')

let db: PGlite
const notice = async (token: string) => (await db.query<{ r: Record<string, unknown> }>(`select public.dpdp_ai_link_billing_notice($1) as r`, [token])).rows[0].r

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create role service_role nologin; create role app_runtime nologin;
    create schema dpdp;
    create table dpdp.organisation (id text primary key);
    create table dpdp.membership (id text primary key, org_id text not null);
    create table dpdp.subscription (org_id text primary key, state text not null default 'trial', trial_ends_at timestamp);
    create table dpdp.ai_link (id text primary key, membership_id text not null);
    -- stand-in for drizzle/0607's resolver: unknown token -> the same refusal every dpdp_ai_link_* call gives
    create function public.dpdp__ai_link_for_token(p_token text) returns dpdp.ai_link language plpgsql as $f$
    declare v dpdp.ai_link; begin
      select * into v from dpdp.ai_link where id = p_token;
      if v.id is null then raise exception 'This link has expired or was revoked' using errcode = '42501'; end if;
      return v;
    end $f$;
    ${fn}
    revoke all on function public.dpdp_ai_link_billing_notice(text) from public;
    grant execute on function public.dpdp_ai_link_billing_notice(text) to service_role, app_runtime;
  `)
  const mk = async (id: string, state: string | null, endsIn: string | null) => {
    await db.query(`insert into dpdp.organisation (id) values ($1)`, [id])
    await db.query(`insert into dpdp.membership (id, org_id) values ($1, $2)`, [`m_${id}`, id])
    await db.query(`insert into dpdp.ai_link (id, membership_id) values ($1, $2)`, [`t_${id}`, `m_${id}`])
    if (state) await db.query(`insert into dpdp.subscription (org_id, state, trial_ends_at) values ($1, $2, ${endsIn ? `(clock_timestamp() at time zone 'UTC') + interval '${endsIn}'` : 'null'})`, [id, state])
  }
  await mk('live', 'trial', '10 days')
  await mk('ended', 'trial', '-2 days')
  await mk('claimed', 'awaiting_confirmation', '-2 days')
  await mk('paid', 'active', '-90 days')
  await mk('nosub', null, null)
  await mk('nodate', 'trial', null)
}, 120_000)

describe('dpdp_ai_link_billing_notice', () => {
  test('a trial that is still running: not ended', async () => {
    expect((await notice('t_live')).trialEnded).toBe(false)
  })
  test('a trial that ended with nothing paid: ended, with the date', async () => {
    const r = await notice('t_ended')
    expect(r.trialEnded).toBe(true)
    expect(r.state).toBe('trial')
    expect(String(r.trialEndsOn)).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
  test('a claim already made, a paid plan, no subscription row, no trial date: none of them is "payment pending"', async () => {
    for (const t of ['t_claimed', 't_paid', 't_nosub', 't_nodate']) expect((await notice(t)).trialEnded).toBe(false)
  })
  test('an unknown or revoked token is refused exactly as every other link call refuses it', async () => {
    await expect(db.query(`select public.dpdp_ai_link_billing_notice('nope')`)).rejects.toThrow(/expired or was revoked/)
  })
  test('it only reads: the subscription row is unchanged afterwards', async () => {
    const before = (await db.query(`select * from dpdp.subscription order by org_id`)).rows
    await notice('t_ended'); await notice('t_paid')
    expect((await db.query(`select * from dpdp.subscription order by org_id`)).rows).toEqual(before)
  })
})
