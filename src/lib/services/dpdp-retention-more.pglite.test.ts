/// <reference types="bun-types" />
// drizzle/0761 and 0762 on PGlite (real Postgres as WASM; no live database touched), on top of 0724: the retention sweep now also covers the e-mail send log, the AI
// work-link call log (append-only, deletable only inside the sweep), ended AI links, the old AI read log and (only when a period is set) payment-proof files; and the
// e-mail send log keeps metadata only.
//   * the rules obey the live switch exactly like the 0724 rules: while live = false they only count;
//   * BILLING DATA IS NEVER DELETED: payments, attempts, ledger, subscriptions stay, also when an organisation is offboarded;
//   * the payment-proof file plan is EMPTY while payment_proof_days is null (the shipped setting);
//   * a call-log row cannot be deleted by anything except the sweep;
//   * record_email_send never stores a body, old bodies are cleared, a CHECK keeps it that way.
// Run: bun test --isolate src/lib/services/dpdp-retention-more.pglite.test.ts
import { beforeAll, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const read = (f: string) => readFileSync(new URL(`../../../drizzle/${f}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

let db: PGlite
const q = async <T = Record<string, unknown>>(sql: string, args: unknown[] = []) => (await db.query<T>(sql, args)).rows
const ids = async (sql: string) => (await q<{ id: string }>(sql)).map((r) => r.id)
const sweep = async (force = false) => (await q<{ r: any }>(`select public.dpdp_timer_retention_sweep($1) as r`, [force]))[0].r

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role app_runtime nologin; create role service_role nologin;
    create schema dpdp; create schema storage;
    create function public.dpdp__is_platform_admin() returns boolean language sql as $f$ select coalesce(current_setting('test.admin', true), '') = 'yes' $f$;
    create table dpdp.organisation (id text primary key, name text);
    create table dpdp.event (id text primary key, org_id text references dpdp.organisation (id), what text);
    create table dpdp.login_token (id text primary key, expires_at timestamp not null);
    create table dpdp.session (id text primary key, expires_at timestamp not null);
    create table dpdp.email_token (id text primary key, expires_at timestamp not null);
    create table dpdp.mail_outbound (id text primary key, sent_at timestamptz not null);
    create table dpdp.mail_inbound (id text primary key, closed_at timestamptz);
    create table dpdp.ai_link_seen (link_id text, kind text, value text, first_seen_at timestamp not null, primary key (link_id, kind, value));
    -- the tables 0761 adds rules for
    create table dpdp.email_send (id text primary key, org_id text, membership_id text, identity_id text, obligation_ids text[] not null default '{}', kind text, period_key text, to_email text, subject text, body_text text, resend_message_id text, status text, error text, created_at timestamptz not null default now(), sent_at timestamptz, list_unsubscribe_token_hash text);
    create table dpdp.ai_link_call (id text primary key, link_id text, org_id text, method text not null default 'GET', path text not null default '/', status integer, bytes integer, called_at timestamp not null, finished_at timestamp);
    create function dpdp.ai_link_call_guard() returns trigger language plpgsql as $f$ begin
      if tg_op = 'DELETE' then raise exception 'dpdp.ai_link_call is append-only' using errcode = '42501'; end if; return new; end $f$;
    create trigger ai_link_call_guard before update or delete on dpdp.ai_link_call for each row execute function dpdp.ai_link_call_guard();
    create table dpdp.ai_link (id text primary key, org_id text, created_at timestamp not null default now(), expires_at timestamp not null, revoked_at timestamp);
    create table dpdp.ai_link_read (id text primary key, link_id text, at timestamp not null);
    -- billing data (all have org_id)
    create table dpdp.payment (id text primary key, org_id text references dpdp.organisation (id), amount_paise integer);
    create table dpdp.payment_attempt (id text primary key, org_id text references dpdp.organisation (id), status text);
    create table dpdp.payment_ledger (id text primary key, org_id text references dpdp.organisation (id), note text);
    create table dpdp.subscription (id text primary key, org_id text references dpdp.organisation (id), self_declared_proof_path text);
    create table dpdp.aa_other (id text primary key, org_id text references dpdp.organisation (id));
    create table storage.objects (id serial primary key, bucket_id text, name text, created_at timestamptz not null default now());
    create function dpdp.new_opaque_token() returns text language sql as $f$ select 'raw' || replace(gen_random_uuid()::text, '-', '') $f$;
    create function dpdp.email_token_hash(t text) returns text language sql as $f$ select 'h:' || t $f$;

    insert into dpdp.organisation values ('orgA', 'Ended Co'), ('orgB', 'Live Co');
    insert into dpdp.payment values ('pay1', 'orgA', 49900); insert into dpdp.payment_attempt values ('pa1', 'orgA', 'paid');
    insert into dpdp.payment_ledger values ('pl1', 'orgA', 'x'); insert into dpdp.aa_other values ('o1', 'orgA');
    insert into dpdp.subscription values ('sub1', 'orgA', 'user1/orgA-old.png'), ('sub2', 'orgB', 'user2/orgB-new.png');

    insert into dpdp.email_send (id, org_id, kind, to_email, subject, status, created_at) values
      ('es-old', 'orgB', 'monday_digest', 'a@x.in', 's', 'sent', now() - interval '14 months'),
      ('es-new', 'orgB', 'monday_digest', 'a@x.in', 's', 'sent', now() - interval '6 months');
    insert into dpdp.ai_link_call (id, link_id, called_at) values
      ('c-old-link', 'L1', now() - interval '400 days'), ('c-recent-link', 'L1', now() - interval '100 days'),
      ('c-old-unknown', null, now() - interval '100 days'), ('c-recent-unknown', null, now() - interval '10 days');
    insert into dpdp.ai_link (id, org_id, expires_at, revoked_at) values
      ('L-expired-old', 'orgB', now() - interval '200 days', null),
      ('L-revoked-old', 'orgB', now() + interval '30 days', now() - interval '120 days'),
      ('L-expired-recent', 'orgB', now() - interval '10 days', null),
      ('L-active', 'orgB', now() + interval '20 days', null);
    insert into dpdp.ai_link_read values ('r-old', 'L-expired-old', now() - interval '150 days'), ('r-recent', 'L-active', now() - interval '5 days');
    insert into storage.objects (bucket_id, name, created_at) values
      ('dpdp-payment-proofs', 'user1/orgA-old.png', now() - interval '400 days'), ('dpdp-payment-proofs', 'user2/orgB-new.png', now() - interval '3 days'),
      ('other-bucket', 'keep.png', now() - interval '900 days');
  `)
  await db.exec(read('0724_dpdp_retention_sweep_and_offboarding.sql'))
  await db.exec(read('0761_dpdp_retention_more_tables.sql'))
}, 180_000)

describe('0761: dry run by default, then live', () => {
  test('with live = false the new rules only count', async () => {
    expect((await q<{ live: boolean }>(`select live from dpdp.retention_setting where id = 1`))[0].live).toBe(false)
    const r = await sweep()
    expect(r.live).toBe(false)
    expect(r.counts).toMatchObject({ email_send: 1, ai_link_call: 2, ai_link_read: 1, ai_link: 2 })
    expect(await ids(`select id from dpdp.email_send order by id`)).toEqual(['es-new', 'es-old'])
    expect((await q(`select 1 from dpdp.ai_link_call`)).length).toBe(4)
    expect((await q(`select 1 from dpdp.ai_link`)).length).toBe(4)
  })

  test('live: the e-mail log keeps 13 months, the call log keeps a year (unknown-token calls 90 days), ended links go after 90 days, an active link never', async () => {
    await db.exec(`update dpdp.retention_setting set live = true where id = 1`)
    const r = await sweep()
    expect(r.live).toBe(true)
    expect(await ids(`select id from dpdp.email_send`)).toEqual(['es-new'])
    expect((await ids(`select id from dpdp.ai_link_call order by id`))).toEqual(['c-recent-link', 'c-recent-unknown'])
    expect((await ids(`select id from dpdp.ai_link order by id`))).toEqual(['L-active', 'L-expired-recent'])
    expect((await ids(`select id from dpdp.ai_link_read`))).toEqual(['r-recent'])
  })

  test('the second run finds nothing more', async () => {
    const r = await sweep()
    expect(r.counts).toMatchObject({ email_send: 0, ai_link_call: 0, ai_link_read: 0, ai_link: 0 })
  })

  test('the call log stays append-only for everything except the sweep (the setting is cleared again afterwards)', async () => {
    await expect(db.exec(`delete from dpdp.ai_link_call where id = 'c-recent-link'`)).rejects.toThrow(/append-only/)
    expect((await q<{ v: string }>(`select coalesce(current_setting('dpdp.retention_sweep', true), '') as v`))[0].v).not.toBe('on')
  })
})

describe('billing data is never deleted', () => {
  test('the kept-tables list names every billing table', async () => {
    const kept = (await q<{ k: string[] }>(`select dpdp.retention_kept_tables() as k`))[0].k
    for (const t of ['payment', 'payment_attempt', 'payment_ledger', 'subscription', 'ledger_refund', 'ledger_payment_attempt', 'partner_payout', 'account_commission']) expect(kept).toContain(t)
  })
  test('offboarding an organisation removes its other data but leaves payments, attempts, the ledger and the subscription', async () => {
    await db.exec(`select set_config('test.admin', 'yes', false)`)
    await db.query(`select public.dpdp_operator_offboard_start('orgA')`)
    await db.query(`select public.dpdp_operator_offboard_export('orgA')`)
    await db.exec(`select set_config('test.admin', '', false)`)
    await db.exec(`update dpdp.org_offboarding set export_until = now() - interval '1 day' where org_id = 'orgA'`)
    const r = await sweep()
    expect(r.organisations[0]).toMatchObject({ orgId: 'orgA', live: true })
    expect(await ids(`select id from dpdp.aa_other`)).toEqual([])
    expect(await ids(`select id from dpdp.payment`)).toEqual(['pay1'])
    expect(await ids(`select id from dpdp.payment_attempt`)).toEqual(['pa1'])
    expect(await ids(`select id from dpdp.payment_ledger`)).toEqual(['pl1'])
    expect((await ids(`select id from dpdp.subscription order by id`))).toEqual(['sub1', 'sub2'])
    expect(await ids(`select id from dpdp.organisation order by id`)).toEqual(['orgA', 'orgB']) // the row the kept billing data points at stays
  })
})

describe('payment-proof files: no period, no deletion', () => {
  test('shipped setting: payment_proof_days is null and the plan is empty even though live = true', async () => {
    expect((await q<{ d: number | null }>(`select payment_proof_days as d from dpdp.retention_setting where id = 1`))[0].d).toBeNull()
    const p = (await q<{ p: any }>(`select public.dpdp_retention_proof_plan() as p`))[0].p
    expect(p).toMatchObject({ live: true, count: 0, names: [] })
  })
  test('with a period set and live: only the expired proof objects of the proof bucket are named; dry run names nothing but counts', async () => {
    await db.exec(`update dpdp.retention_setting set payment_proof_days = 180 where id = 1`)
    const live = (await q<{ p: any }>(`select public.dpdp_retention_proof_plan() as p`))[0].p
    expect(live).toMatchObject({ live: true, days: 180, count: 1, names: ['user1/orgA-old.png'] })
    const dry = (await q<{ p: any }>(`select public.dpdp_retention_proof_plan(true) as p`))[0].p
    expect(dry).toMatchObject({ live: false, count: 1, names: [] })
  })
  test('done: the path is forgotten only for removed files, and the count is written to the sweep book', async () => {
    const r = (await q<{ r: any }>(`select public.dpdp_retention_proof_done(array['user1/orgA-old.png'], true, 1) as r`))[0].r
    expect(r.counts).toMatchObject({ payment_proof_files: 1, payment_proof_paths_cleared: 1, payment_proof_files_past_period: 1 })
    expect((await q<{ p: string | null }>(`select self_declared_proof_path as p from dpdp.subscription where id = 'sub1'`))[0].p).toBeNull()
    expect((await q<{ p: string | null }>(`select self_declared_proof_path as p from dpdp.subscription where id = 'sub2'`))[0].p).toBe('user2/orgB-new.png')
    const dry = (await q<{ r: any }>(`select public.dpdp_retention_proof_done(array[]::text[], false, 3) as r`))[0].r
    expect(dry).toMatchObject({ live: false, counts: { payment_proof_files: 0, payment_proof_files_past_period: 3 } })
  })
  test('only service_role may run the sweep and the proof functions', async () => {
    for (const role of ['anon', 'authenticated', 'app_runtime']) {
      await db.exec(`set role ${role}`)
      await expect(db.query(`select public.dpdp_retention_proof_plan()`)).rejects.toThrow(/permission denied/)
      await expect(db.query(`select public.dpdp_timer_retention_sweep()`)).rejects.toThrow(/permission denied/)
      await db.exec(`reset role`)
    }
  })
})

describe('0762: the e-mail log keeps metadata only', () => {
  test('a legacy dry-run body is cleared by the migration, and no body can be stored afterwards', async () => {
    await db.exec(`insert into dpdp.email_send (id, org_id, kind, to_email, subject, body_text, status) values ('es-legacy', 'orgB', 'monday_digest', 'a@x.in', 's', 'FULL BODY WITH A NAME', 'dry_run')`)
    await db.exec(read('0762_dpdp_email_send_metadata_only.sql'))
    expect((await q<{ b: string | null }>(`select body_text as b from dpdp.email_send where id = 'es-legacy'`))[0].b).toBeNull()
    await expect(db.exec(`insert into dpdp.email_send (id, org_id, kind, to_email, subject, body_text, status) values ('es-x', 'orgB', 'monday_digest', 'a@x.in', 's', 'body', 'sent')`)).rejects.toThrow(/email_send_no_body/)
  })
  test('record_email_send stores the metadata and drops the body, for a dry run as well', async () => {
    const r = (await q<{ r: any }>(`select dpdp.record_email_send('orgB', 'm1', 'i1', array[]::text[], 'monday_digest', '2026-W42', 'a@x.in', 'Subject', 'dry_run', 'FULL BODY') as r`))[0].r
    expect(r.duplicate).toBe(false)
    const row = (await q<{ body_text: string | null; status: string; subject: string }>(`select body_text, status, subject from dpdp.email_send where id = $1`, [r.id]))[0]
    expect(row).toEqual({ body_text: null, status: 'dry_run', subject: 'Subject' })
  })
  test('the roll-back restores the old function and drops the check', async () => {
    await db.exec(read('down/0762_dpdp_email_send_metadata_only.down.sql'))
    const r = (await q<{ r: any }>(`select dpdp.record_email_send('orgB', 'm1', 'i1', array[]::text[], 'monday_digest', '2026-W43', 'a@x.in', 'Subject', 'dry_run', 'BODY AGAIN') as r`))[0].r
    expect((await q<{ b: string }>(`select body_text as b from dpdp.email_send where id = $1`, [r.id]))[0].b).toBe('BODY AGAIN')
  })
})

describe('0761 roll-back', () => {
  test('restores the 0724 sweep, the original guard and the short kept list', async () => {
    await db.exec(read('down/0761_dpdp_retention_more_tables.down.sql'))
    const r = await sweep()
    expect(Object.keys(r.counts).sort()).toEqual(['ai_link_seen', 'email_token', 'login_token', 'mail_inbound_closed', 'mail_outbound', 'session'])
    expect((await q<{ k: string[] }>(`select dpdp.retention_kept_tables() as k`))[0].k).not.toContain('payment')
    expect((await q(`select 1 from information_schema.columns where table_schema = 'dpdp' and table_name = 'retention_setting' and column_name = 'email_send_days'`)).length).toBe(0)
  })
})
