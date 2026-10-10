/// <reference types="bun-types" />
// drizzle/0726 on PGlite (no live database touched): the Rule 7 fields on dpdp.breach are additive, the CERT-In (6 h) and customer (24 h) clocks are
// filled from became_aware_at, existing rows keep everything and gain the clocks, and the roll-back removes only what was added.
// Run: bun test --isolate src/lib/services/dpdp-breach-rule7.pglite.test.ts
import { beforeAll, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const read = (f: string) => readFileSync(new URL(`../../../drizzle/${f}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const up = read('0726_dpdp_breach_rule7_fields.sql')
const down = read('down/0726_dpdp_breach_rule7_fields.down.sql')

let db: PGlite
const q = async <T = Record<string, unknown>>(sql: string, args: unknown[] = []) => (await db.query<T>(sql, args)).rows

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create schema dpdp;
    create table dpdp.breach (
      id text primary key, org_id text not null, became_aware_at timestamp not null default now(), deadline_at timestamp not null,
      scope_person_count integer, board_notified_at timestamp, individuals_notified_at timestamp, state text not null default 'open'
    );
    insert into dpdp.breach (id, org_id, became_aware_at, deadline_at, scope_person_count) values ('old', 'o1', '2026-09-01 10:00', '2026-09-04 10:00', 12);
  `)
  await db.exec(up)
  await db.exec(up) // idempotent
}, 60_000)

describe('additive', () => {
  test('the existing row keeps everything it had and gains the two clocks', async () => {
    const r = (await q<Record<string, string | number | null>>(`select id, org_id, became_aware_at::text as aware, deadline_at::text as deadline, scope_person_count as n, state, cert_in_due_at::text as cert, customer_notice_due_at::text as cust from dpdp.breach where id = 'old'`))[0]
    expect(r).toEqual({ id: 'old', org_id: 'o1', aware: '2026-09-01 10:00:00', deadline: '2026-09-04 10:00:00', n: 12, state: 'open', cert: '2026-09-01 16:00:00', cust: '2026-09-02 10:00:00' })
  })
  test('all the Rule 7 columns exist and are nullable', async () => {
    const cols = (await q<{ column_name: string; is_nullable: string }>(`select column_name, is_nullable from information_schema.columns where table_schema = 'dpdp' and table_name = 'breach'`))
    const names = cols.map((c) => c.column_name)
    for (const c of ['description', 'nature', 'extent', 'occurred_at', 'location', 'likely_impact', 'board_detailed_at', 'board_broad_facts', 'board_circumstances', 'board_mitigation', 'board_cause_findings', 'board_remedial_steps', 'board_report_on_notices', 'individual_consequences', 'individual_mitigation', 'individual_safety_measures', 'individual_contact', 'cert_in_due_at', 'cert_in_reported_at', 'cert_in_reference', 'customer_notice_due_at', 'processor_notified_customer_at']) expect(names, c).toContain(c)
    expect(cols.filter((c) => !['id', 'org_id', 'became_aware_at', 'deadline_at', 'state'].includes(c.column_name)).every((c) => c.is_nullable === 'YES')).toBe(true)
  })
})

describe('the clocks', () => {
  test('a new breach gets 6 hours for CERT-In and 24 hours for the customer from became_aware_at', async () => {
    await db.exec(`insert into dpdp.breach (id, org_id, became_aware_at, deadline_at) values ('new', 'o2', '2026-10-05 08:30', '2026-10-08 08:30')`)
    const r = (await q<{ cert: string; cust: string }>(`select cert_in_due_at::text as cert, customer_notice_due_at::text as cust from dpdp.breach where id = 'new'`))[0]
    expect(r).toEqual({ cert: '2026-10-05 14:30:00', cust: '2026-10-06 08:30:00' })
  })
  test('a clock someone already set is not overwritten', async () => {
    await db.exec(`insert into dpdp.breach (id, org_id, became_aware_at, deadline_at, cert_in_due_at) values ('set', 'o3', '2026-10-05 08:30', '2026-10-08 08:30', '2026-10-05 09:00')`)
    expect((await q<{ c: string }>(`select cert_in_due_at::text as c from dpdp.breach where id = 'set'`))[0].c).toBe('2026-10-05 09:00:00')
  })
  test('the Rule 7 facts can be recorded and read back', async () => {
    await db.exec(`update dpdp.breach set nature = 'unauthorised access', extent = '12 people', cert_in_reference = 'CERTIN-1', cert_in_reported_at = now(), individual_contact = 'dpdp@veridian-aios.com' where id = 'new'`)
    expect((await q<{ n: string; r: string }>(`select nature as n, cert_in_reference as r from dpdp.breach where id = 'new'`))[0]).toEqual({ n: 'unauthorised access', r: 'CERTIN-1' })
  })
})

describe('roll-back', () => {
  test('removes the trigger and exactly the added columns', async () => {
    await db.exec(down)
    const names = (await q<{ column_name: string }>(`select column_name from information_schema.columns where table_schema = 'dpdp' and table_name = 'breach' order by ordinal_position`)).map((c) => c.column_name)
    expect(names).toEqual(['id', 'org_id', 'became_aware_at', 'deadline_at', 'scope_person_count', 'board_notified_at', 'individuals_notified_at', 'state'])
    expect((await q<{ n: number }>(`select count(*)::int as n from pg_proc where proname = 'breach_set_clocks'`))[0].n).toBe(0)
    expect((await q<{ n: number }>(`select count(*)::int as n from dpdp.breach`))[0].n).toBe(3)
  })
})
