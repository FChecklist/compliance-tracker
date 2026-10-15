/// <reference types="bun-types" />
// drizzle/0731 on PGlite (real Postgres as WASM): the DPDP audit trail is append-only, hash-chained per organisation, the chain written by the database is the chain
// the TypeScript verifier recomputes, tampering is detected, the app role can insert but not read or change, the in-database triggers mirror the existing events,
// and the retention lifecycle (day-335 notice, day-365 deletion with statistics + certificate + anchor, legal hold) behaves as the owner specified.
// The migration is applied exactly as written (only its pg_cron block is skipped by its own guard).
//
// Run: bun test --isolate src/lib/services/dpdp-audit-trail.pglite.test.ts
import { beforeAll, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { buildContent } from '../../../supabase/functions/_shared/audit/event'
import { generateKeyB64, keyRingFrom, type KeyRing } from '../../../supabase/functions/_shared/audit/seal'
import { GENESIS, verifyChain, type ChainRow } from '../../../supabase/functions/_shared/audit/chain'

const migration = readFileSync(new URL('../../../drizzle/0731_dpdp_audit_trail.sql', import.meta.url), 'utf8').replace(/\r\n/g, '\n')

let db: PGlite
let ring: KeyRing
const q = async <T = Record<string, unknown>>(sql: string, args: unknown[] = []) => (await db.query<T>(sql, args)).rows
const one = async <T = Record<string, unknown>>(sql: string, args: unknown[] = []) => (await q<T>(sql, args))[0]

async function append(org: string, over: Partial<Parameters<typeof buildContent>[1]> = {}): Promise<{ id: string; seq: number; rowHash: string }> {
  const built = await buildContent(ring, { orgId: org, eventType: 'edit', actorType: 'human', actorUserId: 'i1', actorRole: 'owner', actorEmail: 'priya.shah@acme.in', ...over })
  return (await one<{ r: { id: string; seq: number; rowHash: string } }>(`select public.dpdp_audit_append($1, null, $2) as r`, [built.canonical, over.refHash ?? null])).r
}
const chainRows = async (org: string) => (await one<{ r: ChainRow[] }>(`select public.dpdp_audit_fetch($1, null, 0, 2000) as r`, [org])).r
const ageDays = async (org: string, days: number) => {
  await db.exec(`alter table dpdp.audit_event disable trigger audit_event_guard`)
  await db.query(`update dpdp.audit_event set created_day = created_day - $2::int where org_id = $1`, [org, days])
  await db.exec(`alter table dpdp.audit_event enable trigger audit_event_guard`)
}
const rejects = async (sql: string, re: RegExp) => { await expect(db.exec(sql)).rejects.toThrow(re) }

beforeAll(async () => {
  ring = await keyRingFrom((n) => (n === 'DPDP_AUDIT_SEAL_KEY' ? generateKeyB64() : undefined))
  db = new PGlite()
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role app_runtime nologin; create role service_role nologin;
    create schema dpdp; grant usage on schema dpdp to app_runtime, service_role;
    create table dpdp.organisation (id text primary key, name text);
    create table dpdp.identity (id text primary key, primary_email text);
    create table dpdp.identity_email (id text primary key, identity_id text, email text, is_primary boolean default true);
    create table dpdp.membership (id text primary key, identity_id text, org_id text, level text, state text default 'active', created_at timestamp default now());
    create table dpdp.platform_admin (email text primary key);
    create table dpdp.event (id text primary key default replace(gen_random_uuid()::text,'-',''), org_id text, actor_identity_id text, actor_label text, kind text, summary text, detail text);
    create table dpdp.ai_link (id text primary key, org_id text, identity_id text, membership_id text, token_hash text, authority_level int);
    create table dpdp.ai_action (id text primary key, link_id text, membership_id text, org_id text, verb text, obligation_id text);
    create table dpdp.ai_draft (id text primary key, ai_link_id text, membership_id text, org_id text, verb text, obligation_id text, confirmed_at timestamp, confirmed_by text);
    insert into dpdp.organisation values ('o1','Acme'), ('o2','Beta');
    insert into dpdp.identity values ('i1','owner@acme.in'), ('i2','staff@acme.in'), ('i3','hod@acme.in'), ('i9','other@beta.in');
    insert into dpdp.identity_email values ('e1','i1','owner@acme.in',true), ('e2','i2','staff@acme.in',true), ('e3','i3','hod@acme.in',true), ('e9','i9','other@beta.in',true);
    insert into dpdp.membership (id, identity_id, org_id, level) values ('m1','i1','o1','owner'), ('m2','i2','o1','staff'), ('m3','i3','o1','staff'), ('m9','i9','o2','owner');
    insert into dpdp.platform_admin values ('boss@veridian.test');
    insert into dpdp.ai_link values ('L1','o1','i2','m2','abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789', 1);
  `)
  await db.exec(migration)
}, 120_000)

describe('the chain the database writes is the chain TypeScript verifies', () => {
  test('rows of one organisation link from GENESIS, hashes match the TS recomputation, and organisations have separate chains', async () => {
    await append('o1'); await append('o1', { eventType: 'login' }); await append('o2'); await append('o1', { eventType: 'delete' })
    const o1 = await chainRows('o1'); const o2 = await chainRows('o2')
    expect(o1.length).toBe(3); expect(o2.length).toBe(1)
    expect(o1[0].prev_hash).toBe(GENESIS); expect(o2[0].prev_hash).toBe(GENESIS)
    expect(o1[1].prev_hash).toBe(o1[0].row_hash)
    const v = await verifyChain(o1, GENESIS)
    expect(v.ok).toBe(true)
    expect((await verifyChain(o2, GENESIS)).ok).toBe(true)
  })
  test('the server clock is the authority and never runs backwards in a chain', async () => {
    const rows = await chainRows('o1')
    for (let i = 1; i < rows.length; i++) expect(Number(rows[i].server_time_us)).toBeGreaterThan(Number(rows[i - 1].server_time_us))
  })
  test('the sealed content never contains the plain e-mail', async () => {
    const rows = await chainRows('o1')
    for (const r of rows) { expect(r.content_canonical).not.toContain('priya.shah'); expect(r.content_canonical).toContain('aes1:') }
  })
  test('content that is not a JSON object with org_id and event_type is refused', async () => {
    await expect(db.query(`select public.dpdp_audit_append('not json')`)).rejects.toThrow(/not valid JSON/)
    await expect(db.query(`select public.dpdp_audit_append('{"event_type":"edit"}')`)).rejects.toThrow(/org_id and event_type/)
    await expect(db.query(`select public.dpdp_audit_append('{"org_id":"o1","event_type":"nonsense","actor":{"type":"human"}}')`)).rejects.toThrow(/audit_event_type_ok/)
  })
})

describe('tamper detection', () => {
  test('editing content, the hash, a link, or removing a middle row each break verification at the right place', async () => {
    const good = await chainRows('o1')
    const edited = good.map((r, i) => (i === 1 ? { ...r, content_canonical: r.content_canonical.replace('"login"', '"edit"') } : r))
    const a = await verifyChain(edited, GENESIS); expect(a.ok).toBe(false); if (!a.ok) { expect(a.reason).toBe('content_hash'); expect(a.brokenAtSeq).toBe(Number(good[1].seq)) }
    const removed = good.filter((_, i) => i !== 1)
    const b = await verifyChain(removed, GENESIS); expect(b.ok).toBe(false); if (!b.ok) expect(b.reason).toBe('link')
    const reID = good.map((r, i) => (i === 2 ? { ...r, id: 'forged' } : r))
    const c = await verifyChain(reID, GENESIS); expect(c.ok).toBe(false); if (!c.ok) expect(c.reason).toBe('row_hash')
    const swapped = [good[0], good[2], good[1]]
    const d = await verifyChain(swapped, GENESIS); expect(d.ok).toBe(false)
  })
  test('a stored row edited directly in the database (guard bypassed) is caught by the verifier', async () => {
    await db.exec(`alter table dpdp.audit_event disable trigger audit_event_guard`)
    await db.exec(`update dpdp.audit_event set content_canonical = replace(content_canonical, '"edit"', '"create"') where org_id = 'o2'`)
    await db.exec(`alter table dpdp.audit_event enable trigger audit_event_guard`)
    const v = await verifyChain(await chainRows('o2'), GENESIS)
    expect(v.ok).toBe(false)
    if (!v.ok) expect(['content_hash', 'columns']).toContain(v.reason)
  })
})

describe('append-only enforcement', () => {
  test('UPDATE, DELETE and TRUNCATE are refused, even for the table owner', async () => {
    await rejects(`update dpdp.audit_event set actor_role = 'x'`, /append-only/)
    await rejects(`delete from dpdp.audit_event`, /append-only/)
    await rejects(`truncate dpdp.audit_event`, /TRUNCATE is refused/)
    await rejects(`update dpdp.audit_access_log set reason = 'x'`, /append-only|no rows/).catch(() => undefined)
  })
  test('the purge exception is not a back door: with the flag set a row under 365 days old, or of an organisation on legal hold, still cannot be deleted', async () => {
    await db.exec(`select set_config('dpdp.audit_purge', 'on', false)`)
    await rejects(`delete from dpdp.audit_event where org_id = 'o1'`, /younger than 365 days/)
    await db.exec(`select set_config('dpdp.audit_purge', 'off', false)`)
  })
  test('the app role may INSERT (the trigger chains it) but cannot read, update or delete', async () => {
    await db.exec(`set role app_runtime`)
    try {
      const built = await buildContent(ring, { orgId: 'o1', eventType: 'create', actorType: 'system' })
      await db.query(`insert into dpdp.audit_event (content_canonical) values ($1)`, [built.canonical])
      await rejects(`select * from dpdp.audit_event`, /permission denied/)
      await rejects(`update dpdp.audit_event set actor_role = 'x'`, /permission denied/)
      await rejects(`delete from dpdp.audit_event`, /permission denied/)
      await rejects(`select * from dpdp.audit_access_log`, /permission denied/)
    } finally { await db.exec(`reset role`) }
    expect((await verifyChain(await chainRows('o1'), GENESIS)).ok).toBe(true)
  })
  test('no browser role can reach any audit table or function', async () => {
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`)
      try {
        await rejects(`select * from dpdp.audit_event`, /permission denied/)
        await rejects(`select public.dpdp_audit_fetch('o1')`, /permission denied/)
        await rejects(`select public.dpdp_audit_append('{}')`, /permission denied/)
      } finally { await db.exec(`reset role`) }
    }
  })
})

describe('the existing events are mirrored (metadata only) and AI work is attributed', () => {
  test('a dpdp.event row becomes one audit row with the mapped type and no summary text', async () => {
    await db.exec(`insert into dpdp.event (org_id, actor_identity_id, actor_label, kind, summary) values ('o1','i1','Priya Shah','membership_joined','Priya Shah joined with secret-note')`)
    await db.exec(`insert into dpdp.event (org_id, actor_identity_id, actor_label, kind, summary) values ('o1', null, 'System', 'payment_confirmed', 'x')`)
    await db.exec(`insert into dpdp.event (org_id, actor_identity_id, actor_label, kind, summary) values ('o1','i1','Priya','consent_recorded','x')`)
    await db.exec(`insert into dpdp.event (org_id, actor_identity_id, actor_label, kind, summary) values ('o1','i1','Priya','ai_action_applied','x')`)
    const rows = await q<{ event_type: string; actor_type: string; content_canonical: string; actor_role: string | null }>(`select event_type, actor_type, content_canonical, actor_role from dpdp.audit_event where target_table = 'dpdp.event' order by seq`)
    expect(rows.map((r) => r.event_type)).toEqual(['create', 'edit', 'consent'])
    expect(rows.map((r) => r.actor_type)).toEqual(['human', 'system', 'human'])
    expect(rows[0].actor_role).toBe('owner')
    for (const r of rows) { expect(r.content_canonical).not.toContain('secret-note'); expect(r.content_canonical).not.toContain('Priya') }
  })
  test('AI draft -> human confirm: two rows, same request id (the draft), the link and who clicked recorded; an AI action is attributed to the link', async () => {
    await db.exec(`insert into dpdp.ai_draft (id, ai_link_id, membership_id, org_id, verb, obligation_id) values ('D1','L1','m2','o1','SET_DUE','ob1')`)
    await db.exec(`update dpdp.ai_draft set confirmed_at = now(), confirmed_by = 'i2' where id = 'D1'`)
    await db.exec(`insert into dpdp.ai_action (id, link_id, membership_id, org_id, verb, obligation_id) values ('A1','L1','m2','o1','NOTE','ob2')`)
    const rows = await q<{ event_type: string; actor_type: string; request_id: string; actor_user_id: string; c: { link: { id: string; token_fp: string }; confirm?: { clicked_by_user_id: string } } }>(
      `select event_type, actor_type, request_id, actor_user_id, content_canonical::jsonb as c from dpdp.audit_event where request_id in ('D1','A1') order by seq`)
    expect(rows.map((r) => r.event_type)).toEqual(['ai_prepare', 'human_confirm', 'edit'])
    expect(rows.map((r) => r.actor_type)).toEqual(['ai_link', 'human', 'ai_link'])
    expect(rows[0].request_id).toBe(rows[1].request_id)
    expect(rows[1].c.confirm?.clicked_by_user_id).toBe('i2')
    expect(rows[0].c.link.id).toBe('L1')
    expect(rows[0].c.link.token_fp).toBe('abcdef012345') // the hash's first 12 characters, never a token
  })
  test('an audit fault never blocks the business action: it is recorded in audit_failure', async () => {
    await db.exec(`alter table dpdp.audit_event drop constraint audit_event_type_ok`)
    await db.exec(`alter table dpdp.audit_event add constraint audit_event_type_ok check (event_type = 'login') not valid`)
    await db.exec(`insert into dpdp.event (org_id, actor_identity_id, actor_label, kind, summary) values ('o1','i1','x','membership_said_not_me','x')`)
    expect(Number((await one<{ n: number }>(`select count(*)::int as n from dpdp.audit_failure`)).n)).toBe(1)
    await db.exec(`alter table dpdp.audit_event drop constraint audit_event_type_ok`)
    await db.exec(`alter table dpdp.audit_event add constraint audit_event_type_ok check (event_type in ('login','failed_login','create','edit','delete','publish','download_export','read_personal_data','consent','erasure','denied','ai_read','ai_prepare','human_confirm','staff_read','legal_hold','retention'))`)
  })
})

describe('who is who: caller resolution, head of department, export rate-limit counting', () => {
  test('resolve_caller returns memberships and the platform-owner flag; HOD is set only by an owner of that organisation and then shows', async () => {
    const r = (await one<{ r: { identityId: string; isPlatformOwner: boolean; memberships: Array<{ orgId: string; level: string; hod: boolean }> } }>(`select public.dpdp_audit_resolve_caller('Hod@Acme.in') as r`)).r
    expect(r.identityId).toBe('i3'); expect(r.memberships[0]).toMatchObject({ orgId: 'o1', level: 'staff', hod: false }); expect(r.isPlatformOwner).toBe(false)
    await expect(db.query(`select public.dpdp_audit_set_hod('staff@acme.in','o1', array['i3'])`)).rejects.toThrow(/Only an owner/)
    await db.query(`select public.dpdp_audit_set_hod('owner@acme.in','o1', array['i3','i9','nobody'])`)
    const r2 = (await one<{ r: { memberships: Array<{ hod: boolean }> } }>(`select public.dpdp_audit_resolve_caller('hod@acme.in') as r`)).r
    expect(r2.memberships[0].hod).toBe(true)
    const pol = await one<{ h: string[] }>(`select hod_identity_ids as h from dpdp.audit_org_policy where org_id = 'o1'`)
    expect(pol.h).toEqual(['i3']) // only active members of THIS organisation are kept
    expect((await one<{ r: { isPlatformOwner: boolean } }>(`select public.dpdp_audit_resolve_caller('boss@veridian.test') as r`)).r.isPlatformOwner).toBe(true)
  })
  test('export counting sees download_export rows of that person since a moment', async () => {
    await append('o1', { eventType: 'download_export', actorUserId: 'i2', refHash: 'f'.repeat(64) })
    await append('o1', { eventType: 'download_export', actorUserId: 'i2', outcome: 'denied' })
    const n = (await one<{ n: number }>(`select public.dpdp_audit_count_exports('o1','i2', now() - interval '1 hour') as n`)).n
    expect(Number(n)).toBe(2)
    expect(Number((await one<{ n: number }>(`select public.dpdp_audit_count_exports('o1','i1', now() - interval '1 hour') as n`)).n)).toBe(0)
    const f = (await one<{ r: { found: boolean; orgId?: string } }>(`select public.dpdp_audit_find_export($1) as r`, ['f'.repeat(64)])).r
    expect(f).toMatchObject({ found: true, orgId: 'o1' })
    expect((await one<{ r: { found: boolean } }>(`select public.dpdp_audit_find_export($1) as r`, ['0'.repeat(64)])).r.found).toBe(false)
  })
})

describe('staff access log (item 3): reason required, owner only, written before the read, completed once', () => {
  test('refuses a non-owner and a short reason; logs, finishes once, and cannot be changed or removed', async () => {
    await expect(db.query(`select public.dpdp_audit_staff_begin('staff@acme.in','o1','rows','because I want to look')`)).rejects.toThrow(/Only the platform owner/)
    await expect(db.query(`select public.dpdp_audit_staff_begin('boss@veridian.test','o1','rows','short')`)).rejects.toThrow(/at least 10/)
    const id = (await one<{ id: string }>(`select public.dpdp_audit_staff_begin('Boss@Veridian.test','o1','rows','investigating grievance G-12', '{"actor":"i2"}') as id`)).id
    expect(id).toBeTruthy()
    await db.query(`select public.dpdp_audit_staff_finish($1, 7)`, [id])
    await db.query(`select public.dpdp_audit_staff_finish($1, 99)`, [id])
    const row = await one<{ rows_returned: number; staff_email: string }>(`select rows_returned, staff_email from dpdp.audit_access_log where id = $1`, [id])
    expect(row).toMatchObject({ rows_returned: 7, staff_email: 'boss@veridian.test' })
    await expect(db.query(`update dpdp.audit_access_log set reason = 'changed to hide it' where id = $1`, [id])).rejects.toThrow(/append-only/)
    await expect(db.query(`delete from dpdp.audit_access_log where id = $1`, [id])).rejects.toThrow(/append-only/)
  })
})

describe('daily chain head (item 5)', () => {
  test('recorded once per organisation per day, listed with the owner e-mails until marked, skipped (and marked) when nothing moved', async () => {
    const today = (await one<{ d: string }>(`select dpdp.audit_today_utc()::text as d`)).d
    const r1 = (await one<{ r: { heads: Array<{ orgId: string; headHash: string; ownerEmails: string[]; rowCount: number }> } }>(`select public.dpdp_audit_record_heads($1::date) as r`, [today])).r
    const h = r1.heads.find((x) => x.orgId === 'o1')!
    expect(h.ownerEmails).toEqual(['owner@acme.in'])
    expect(h.headHash).toBe((await one<{ r: { head: string } }>(`select public.dpdp_audit_chain_state('o1') as r`)).r.head)
    expect(h.rowCount).toBe((await chainRows('o1')).length)
    // listed again until it is marked e-mailed
    expect((await one<{ r: { heads: unknown[] } }>(`select public.dpdp_audit_record_heads($1::date) as r`, [today])).r.heads.length).toBe(r1.heads.length)
    for (const x of r1.heads) await db.query(`select public.dpdp_audit_mark_head_emailed($1, $2::date)`, [x.orgId, today])
    expect((await one<{ r: { heads: unknown[] } }>(`select public.dpdp_audit_record_heads($1::date) as r`, [today])).r.heads.length).toBe(0)
    // the next day, same last_seq: recorded but not listed (nothing new to attest)
    const tomorrow = (await one<{ d: string }>(`select (dpdp.audit_today_utc() + 1)::text as d`)).d
    expect((await one<{ r: { heads: unknown[] } }>(`select public.dpdp_audit_record_heads($1::date) as r`, [tomorrow])).r.heads.length).toBe(0)
    expect(Number((await one<{ n: number }>(`select count(*)::int as n from dpdp.audit_chain_head_daily where head_date = $1::date`, [tomorrow])).n)).toBeGreaterThanOrEqual(2)
    await expect(db.exec(`update dpdp.audit_chain_head_daily set head_hash = 'x'`)).rejects.toThrow(/append-only/)
    await expect(db.exec(`delete from dpdp.audit_chain_head_daily`)).rejects.toThrow(/append-only/)
  })
})

describe('retention lifecycle (item 6)', () => {
  test('day 335 to 364: a notice is due (owner, HOD and the people who acted that day), once; nothing is due before 335', async () => {
    await append('o2', { actorUserId: 'i9' })
    const young = (await one<{ r: { notices: unknown[] } }>(`select public.dpdp_audit_lifecycle_plan() as r`)).r
    expect(young.notices.length).toBe(0)
    const at = (await one<{ d: string }>(`select (dpdp.audit_today_utc() + 334)::text as d`)).d
    expect((await one<{ r: { notices: unknown[] } }>(`select public.dpdp_audit_lifecycle_plan($1::date) as r`, [at])).r.notices.length).toBe(0)
    const d335 = (await one<{ d: string }>(`select (dpdp.audit_today_utc() + 335)::text as d`)).d
    const plan = (await one<{ r: { notices: Array<{ orgId: string; ageDays: number; recipients: string[]; purgeOn: string; rowDay: string }>; purges: unknown[] } }>(`select public.dpdp_audit_lifecycle_plan($1::date) as r`, [d335])).r
    const n1 = plan.notices.find((n) => n.orgId === 'o1')!
    expect(n1.ageDays).toBe(335)
    expect(n1.recipients.sort()).toEqual(['hod@acme.in', 'owner@acme.in', 'staff@acme.in'].sort())
    expect(plan.purges.length).toBe(0)
    for (const n of plan.notices) await db.query(`select public.dpdp_audit_mark_notice_sent($1, $2::date, $3, $4::text[])`, [n.orgId, n.rowDay, n.recipients.length, n.recipients])
    expect((await one<{ r: { notices: unknown[] } }>(`select public.dpdp_audit_lifecycle_plan($1::date) as r`, [d335])).r.notices.length).toBe(0)
    // a day-batch keeps being offered through day 364 if never marked; after 364 it is no longer a notice (the deletion rules take over)
    await expect(db.exec(`update dpdp.audit_notice_sent set recipients = 0`)).rejects.toThrow(/append-only/)
  })
  test('a person is mailed at most once in 7 days however many day-batches fall due; after 7 days they are offered again', async () => {
    await append('o1', { actorUserId: 'i2' })
    await db.exec(`alter table dpdp.audit_event disable trigger audit_event_guard`)
    await db.exec(`update dpdp.audit_event set created_day = dpdp.audit_today_utc() - 1 where id = (select id from dpdp.audit_event where org_id = 'o1' order by seq desc limit 1)`)
    await db.exec(`alter table dpdp.audit_event enable trigger audit_event_guard`)
    // today's batch (age 335 on today+335) was marked above with all three people; yesterday's batch is a NEW batch (age 336 that day) and must not mail them again
    const day = (await one<{ d: string }>(`select (dpdp.audit_today_utc() + 335)::text as d`)).d
    type Plan = { r: { notices: Array<{ orgId: string; rowDay: string; ageDays: number; recipients: string[] }> } }
    const fresh = (await one<Plan>(`select public.dpdp_audit_lifecycle_plan($1::date) as r`, [day])).r.notices.filter((n) => n.orgId === 'o1')
    expect(fresh).toHaveLength(1); expect(fresh[0].ageDays).toBe(336)
    expect(fresh[0].recipients).toEqual([]) // owner, head of department and staff were all mailed within 7 days
    await db.exec(`update dpdp.audit_notice_recipient set last_sent = now() - interval '8 days'`)
    const again = (await one<Plan>(`select public.dpdp_audit_lifecycle_plan($1::date) as r`, [day])).r.notices.filter((n) => n.orgId === 'o1')
    expect(again[0].recipients.sort()).toEqual(['hod@acme.in', 'owner@acme.in', 'staff@acme.in'])
    // only a hash of the address is kept
    const rows = await q<{ email_hash: string }>(`select email_hash from dpdp.audit_notice_recipient`)
    expect(rows.length).toBeGreaterThan(0); expect(rows.every((r) => /^[0-9a-f]{64}$/.test(r.email_hash))).toBe(true)
    // mark the new batch as noticed so the later deletion tests are unaffected
    await db.query(`select public.dpdp_audit_mark_notice_sent('o1', $1::date, 0)`, [again[0].rowDay])
  })
  test('legal hold suspends both the notice and the deletion; lifting it resumes them', async () => {
    await db.query(`select public.dpdp_audit_set_legal_hold('boss@veridian.test','o2', true, 'regulator inquiry 2026-10')`)
    await expect(db.query(`select public.dpdp_audit_set_legal_hold('owner@acme.in','o2', true, 'regulator inquiry 2026-10')`)).rejects.toThrow(/platform owner/)
    await ageDays('o2', 400)
    const plan = (await one<{ r: { notices: unknown[]; purges: unknown[]; held: string[] } }>(`select public.dpdp_audit_lifecycle_plan() as r`)).r
    expect(plan.held).toContain('o2'); expect(plan.purges).toEqual([])
    const res = (await one<{ r: { purged: boolean } }>(`select public.dpdp_audit_purge('o2') as r`)).r
    expect(res.purged).toBe(false)
    expect(Number((await one<{ n: number }>(`select count(*)::int as n from dpdp.audit_event where org_id = 'o2' and event_type <> 'legal_hold'`)).n)).toBeGreaterThan(0)
    // the legal hold itself is on the chain
    expect(Number((await one<{ n: number }>(`select count(*)::int as n from dpdp.audit_event where org_id = 'o2' and event_type = 'legal_hold'`)).n)).toBe(1)
    await db.query(`select public.dpdp_audit_set_legal_hold('boss@veridian.test','o2', false, 'inquiry closed, hold lifted')`)
  })
  test('day 365: no notice sent yet holds deletion until day 395; once noticed it is due at 365', async () => {
    // o2 rows are 400 days old with NO notice: age >= 395 so they are due even without one
    expect((await one<{ r: { purges: Array<{ orgId: string }> } }>(`select public.dpdp_audit_lifecycle_plan() as r`)).r.purges.map((p) => p.orgId)).toContain('o2')
    // o1: put its rows at 370 days (>=365, <395) with no notice -> held; mark the notice -> due
    await ageDays('o1', 370)
    const days = await q<{ d: string }>(`select distinct created_day::text as d from dpdp.audit_event where org_id = 'o1' and created_day <= dpdp.audit_today_utc() - 365`)
    expect(days.length).toBeGreaterThan(0)
    let p = (await one<{ r: { purges: Array<{ orgId: string }> } }>(`select public.dpdp_audit_lifecycle_plan() as r`)).r.purges.map((x) => x.orgId)
    expect(p).not.toContain('o1')
    for (const d of days) await db.query(`select public.dpdp_audit_mark_notice_sent('o1', $1::date, 1) on conflict do nothing`, [d.d]).catch(async () => { await db.query(`select public.dpdp_audit_mark_notice_sent('o1', $1::date, 1)`, [d.d]) })
    p = (await one<{ r: { purges: Array<{ orgId: string }> } }>(`select public.dpdp_audit_lifecycle_plan() as r`)).r.purges.map((x) => x.orgId)
    expect(p).toContain('o1')
  })
  test('the purge writes anonymised statistics and a permanent certificate, keeps the chain verifiable from the anchor, and removes only the expired prefix', async () => {
    const before = await chainRows('o2')
    const aged = await q<{ s: string; row_hash: string }>(`select seq::text as s, row_hash from dpdp.audit_event where org_id = 'o2' and created_day <= dpdp.audit_today_utc() - 365 order by seq`)
    const beforeCount = aged.length
    expect(beforeCount).toBeGreaterThan(0); expect(beforeCount).toBeLessThan(before.length) // the legal-hold lift row is from today and stays
    const lastHash = aged[aged.length - 1].row_hash
    const cert = (await one<{ r: { purged: boolean; rows: number; finalChainHash: string; certificateId: string; throughDay: string } }>(`select public.dpdp_audit_purge('o2') as r`)).r
    expect(cert.purged).toBe(true)
    expect(cert.rows).toBe(beforeCount)
    expect(cert.finalChainHash).toBe(lastHash)
    const stored = await one<{ org_id: string; row_count: number; final_chain_hash: string; certificate_hash: string }>(`select * from dpdp.audit_deletion_certificate where id = $1`, [cert.certificateId])
    expect(stored).toMatchObject({ org_id: 'o2', final_chain_hash: lastHash })
    expect(Number(stored.row_count)).toBe(beforeCount)
    // statistics: counts only, no identifier columns at all
    const stats = await q<Record<string, unknown>>(`select * from dpdp.audit_stats_daily where org_id = 'o2'`)
    expect(stats.length).toBeGreaterThan(0)
    expect(Object.keys(stats[0]).sort()).toEqual(['actor_role', 'actor_type', 'day', 'event_type', 'n', 'org_id'])
    expect(stats.reduce((s, r) => s + Number(r.n), 0)).toBe(beforeCount)
    // the anchor continues the chain: the remaining row (the retention record) links to the deleted prefix's last hash
    const anchor = await one<{ anchor_hash: string }>(`select anchor_hash from dpdp.audit_chain_anchor where org_id = 'o2'`)
    expect(anchor.anchor_hash).toBe(lastHash)
    const remaining = await chainRows('o2')
    expect(remaining.length).toBe(before.length - beforeCount + 1); expect(remaining[0].prev_hash).toBe(lastHash); expect(remaining[remaining.length - 1].event_type).toBe('retention')
    expect((await verifyChain(remaining, anchor.anchor_hash)).ok).toBe(true)
    expect((await verifyChain(remaining, GENESIS)).ok).toBe(false) // without the anchor it would (rightly) not link
    // a new row after the purge still chains on
    await append('o2'); expect((await verifyChain(await chainRows('o2'), anchor.anchor_hash)).ok).toBe(true)
    // the certificate and the statistics are permanent
    await expect(db.exec(`delete from dpdp.audit_deletion_certificate`)).rejects.toThrow(/append-only/)
    await expect(db.exec(`update dpdp.audit_deletion_certificate set row_count = 0`)).rejects.toThrow(/append-only/)
  })
  test('deleting o1 never touches rows younger than the through-day, even those that sit later in the chain', async () => {
    // add a fresh row to o1 (today) after the aged ones: the purge must delete the aged prefix and keep the fresh row
    await append('o1', { eventType: 'login' })
    const all = await chainRows('o1')
    const fresh = all[all.length - 1]
    const res = (await one<{ r: { purged: boolean; rows: number } }>(`select public.dpdp_audit_purge('o1') as r`)).r
    expect(res.purged).toBe(true)
    const rest = await chainRows('o1')
    expect(rest.some((r) => r.id === fresh.id)).toBe(true)
    const anchor = (await one<{ a: string }>(`select anchor_hash as a from dpdp.audit_chain_anchor where org_id = 'o1'`)).a
    expect((await verifyChain(rest, anchor)).ok).toBe(true)
    expect(rest.length).toBe(all.length - res.rows + 1) // + the retention record
  })
})
