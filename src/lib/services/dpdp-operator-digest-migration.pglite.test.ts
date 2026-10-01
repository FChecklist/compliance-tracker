/// <reference types="bun-types" />
// DPDP single mailbox: offline proof of drizzle/0667_dpdp_operator_daily_digest.sql on PGlite (real Postgres compiled to WASM), applied on top of
// 0662 (the mail log it extends). The Edge Function half is proven in supabase/functions/dpdp-inbound-mail/operator-digest.test.ts against a fake
// of this contract; THIS file proves the contract itself in real SQL.
//
// What this proves:
//   1. 0667 adds exactly one column (dpdp.mail_inbound.digested_at, nullable) and two functions; nothing of 0662 changes.
//   2. dpdp_mail_digest_pending lists a ticket only if: class is not auto, status is not closed, digested_at is null, and it was recorded within the
//      window (and not in the future); it reports count + tickets (ticket, class, from, subject, receivedAt), oldest first, at most 200.
//   3. dpdp_mail_digest_mark sets digested_at once on exactly the tickets named; a second mark does not move the time; unknown / empty / null input is harmless;
//      after a mark those tickets are no longer pending; a ticket recorded after the list was read is NOT marked and is pending.
//   4. Only service_role can execute either function (anon / authenticated / app_runtime / PUBLIC cannot).
//   5. Running the file twice changes nothing; the cron block is a no-op without pg_cron / pg_net (as on PGlite); the journal entry exists and is the newest;
//      the destructive-DDL citation is valid; the cron call in the file is the 09:00 IST daily job.
// NOT PROVEN HERE: that pg_cron fires it, and the vault / pg_net request itself -- both need the live project (see dpdp-app/OPERATIONS.md, "Operator daily digest").
//
// Run: bun test --isolate ./src/lib/services/dpdp-operator-digest-migration.pglite.test.ts
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { PGlite } from "@electric-sql/pglite"
import { findValidCitation } from "../../../scripts/check-ddl-authorization.mjs"

const REPO_ROOT = new URL("../../../", import.meta.url)
const read = (p: string) => readFileSync(new URL(p, REPO_ROOT), "utf8")
const BASE_TAG = "0662_dpdp_single_mailbox_mail_log"
const TAG = "0667_dpdp_operator_daily_digest"
const BASE = read(`drizzle/${BASE_TAG}.sql`)
const FORWARD = read(`drizzle/${TAG}.sql`)

const BASE_SQL = `
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE ROLE authenticator NOLOGIN;
CREATE ROLE app_runtime NOLOGIN;
CREATE SCHEMA dpdp;
GRANT USAGE ON SCHEMA dpdp TO anon, authenticated, service_role, app_runtime;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role, app_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA dpdp GRANT ALL ON TABLES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA dpdp GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
`

type Pending = { count: number; tickets: Array<{ ticketNo: string; class: string; from: string; subject: string | null; receivedAt: string }> }

let pg: PGlite
const NOW = "2026-10-01T03:30:00Z"

async function rpc<T>(fn: string, sql: string, params: unknown[] = [], role = "service_role"): Promise<T> {
  await pg.exec(`SET ROLE ${role}`)
  try {
    return (await pg.query<{ r: T }>(`select public.${fn}(${sql}) as r`, params)).rows[0].r
  } finally {
    await pg.exec("RESET ROLE")
  }
}
const pending = (hours?: number, now = NOW) =>
  hours === undefined
    ? rpc<Pending>("dpdp_mail_digest_pending", "p_now => $1::timestamptz", [now])
    : rpc<Pending>("dpdp_mail_digest_pending", "p_now => $1::timestamptz, p_hours => $2::integer", [now, hours])
const mark = (nos: string[] | null) => rpc<{ ok: boolean; marked: number }>("dpdp_mail_digest_mark", "$1::text[]", [nos])

let seq = 0
/** A ticket recorded `hoursAgo` hours before NOW, through the real 0662 function, then its created_at is moved (the function stamps now()). */
async function ticket(cls: string, hoursAgo: number, over: { status?: string; subject?: string } = {}): Promise<string> {
  const n = ++seq
  const r = await rpc<{ ticketNo: string }>(
    "dpdp_mail_insert_inbound",
    "p_class => $1, p_from_addr => $2, p_subject => $3, p_message_id => $4",
    [cls, `sender${n}@example.test`, over.subject ?? `Subject ${n}`, `<m${n}@example.test>`],
  )
  const at = new Date(Date.parse(NOW) - hoursAgo * 3600_000).toISOString()
  await pg.query("update dpdp.mail_inbound set created_at = $2::timestamptz, received_at = $2::timestamptz, status = $3 where ticket_no = $1", [r.ticketNo, at, over.status ?? "open"])
  return r.ticketNo
}
const digestedAt = async (no: string) => (await pg.query<{ d: string | null }>("select digested_at::text as d from dpdp.mail_inbound where ticket_no = $1", [no])).rows[0].d

beforeAll(async () => {
  pg = await PGlite.create()
  await pg.exec(BASE_SQL)
  await pg.exec(BASE)
}, 60_000)

afterAll(async () => {
  await pg?.close()
})

describe("drizzle/0667 operator daily digest (PGlite, on top of 0662)", () => {
  test("1. adds one nullable column and two functions; 0662's objects are unchanged", async () => {
    const before = (await pg.query<{ column_name: string }>("select column_name from information_schema.columns where table_schema = 'dpdp' and table_name = 'mail_inbound' order by ordinal_position")).rows.map((r) => r.column_name)
    expect(before).not.toContain("digested_at")
    const fnsBefore = (await pg.query<{ n: string }>("select proname as n from pg_proc where proname like 'dpdp_mail_%' order by 1")).rows.map((r) => r.n)
    await pg.exec(FORWARD)
    const after = (await pg.query<{ column_name: string; is_nullable: string; data_type: string }>("select column_name, is_nullable, data_type from information_schema.columns where table_schema = 'dpdp' and table_name = 'mail_inbound' order by ordinal_position")).rows
    expect(after.map((r) => r.column_name)).toEqual([...before, "digested_at"])
    expect(after.at(-1)).toMatchObject({ column_name: "digested_at", is_nullable: "YES", data_type: "timestamp with time zone" })
    const fnsAfter = (await pg.query<{ n: string }>("select proname as n from pg_proc where proname like 'dpdp_mail_%' order by 1")).rows.map((r) => r.n)
    expect(fnsAfter).toEqual([...fnsBefore, "dpdp_mail_digest_mark", "dpdp_mail_digest_pending"].sort())
  })

  test("2a. an empty table gives count 0 and no tickets", async () => {
    expect(await pending()).toEqual({ count: 0, tickets: [] })
  })

  test("2b. lists non-auto, open, undigested tickets recorded inside the window, oldest first, with the fields the email needs", async () => {
    const older = await ticket("support", 20, { subject: "Older" })
    const newer = await ticket("sales", 2, { subject: "Newer" })
    const inside = await pending()
    expect(inside.count).toBe(2)
    expect(inside.tickets.map((t) => t.ticketNo)).toEqual([older, newer])
    expect(inside.tickets[0]).toMatchObject({ ticketNo: older, class: "support", subject: "Older" })
    expect(inside.tickets[0].from).toMatch(/^sender\d+@example\.test$/)
    expect(Date.parse(inside.tickets[0].receivedAt)).toBe(Date.parse(NOW) - 20 * 3600_000)
    expect(Object.keys(inside.tickets[0]).sort()).toEqual(["class", "from", "receivedAt", "subject", "ticketNo"])
  })

  test("2c. never lists auto, closed, already-digested, older-than-window or future tickets", async () => {
    const auto = await ticket("auto", 1)
    const closed = await ticket("monday", 1, { status: "closed" })
    const old = await ticket("partner", 26)
    const future = await ticket("invoice", -3)
    const done = await ticket("support", 3)
    await mark([done])
    const listed = (await pending()).tickets.map((t) => t.ticketNo)
    for (const hidden of [auto, closed, old, future, done]) expect(listed).not.toContain(hidden)
    // the window is a parameter: with 30 hours the 26-hour-old one is back; with 1 hour the 2-hour-old one is gone
    expect((await pending(30)).tickets.map((t) => t.ticketNo)).toContain(old)
    expect((await pending(1)).tickets.some((t) => t.subject === "Newer")).toBe(false)
  })

  test("2d. grievances and data requests are listed too (the digest is the day's complete roll-call)", async () => {
    const g = await ticket("grievance", 1)
    const d = await ticket("data_request", 1)
    const listed = (await pending()).tickets.map((t) => t.ticketNo)
    expect(listed).toContain(g)
    expect(listed).toContain(d)
  })

  test("3. mark sets digested_at once on exactly the named tickets; a repeat does not move it; bad input is harmless", async () => {
    const a = await ticket("support", 4)
    const b = await ticket("support", 4)
    const c = await ticket("support", 4)
    const first = await mark([a, b, "X-0000-0000"])
    expect(first).toEqual({ ok: true, marked: 2 })
    const stamp = await digestedAt(a)
    expect(stamp).not.toBeNull()
    expect(await digestedAt(b)).not.toBeNull()
    expect(await digestedAt(c)).toBeNull()
    await new Promise((r) => setTimeout(r, 15))
    await mark([a])
    expect(await digestedAt(a)).toBe(stamp)
    expect(await mark([])).toEqual({ ok: true, marked: 0 })
    expect(await mark(null)).toEqual({ ok: true, marked: 0 })
    const listed = (await pending()).tickets.map((t) => t.ticketNo)
    expect(listed).not.toContain(a)
    expect(listed).not.toContain(b)
    expect(listed).toContain(c) // not named => still pending
  })

  test("4. a ticket recorded after the list was read is not marked by marking the list, and is pending", async () => {
    const readList = (await pending()).tickets.map((t) => t.ticketNo)
    const late = await ticket("support", 0)
    await mark(readList)
    expect(await digestedAt(late)).toBeNull()
    expect((await pending()).tickets.map((t) => t.ticketNo)).toContain(late)
  })

  test("5. only service_role can execute either function", async () => {
    for (const role of ["anon", "authenticated", "app_runtime"]) {
      for (const sig of ["public.dpdp_mail_digest_pending(timestamptz, integer)", "public.dpdp_mail_digest_mark(text[])"]) {
        expect(((await pg.query<{ v: boolean }>(`select has_function_privilege('${role}', '${sig}', 'EXECUTE') as v`)).rows[0].v)).toBe(false)
      }
    }
    for (const sig of ["public.dpdp_mail_digest_pending(timestamptz, integer)", "public.dpdp_mail_digest_mark(text[])"]) {
      expect(((await pg.query<{ v: boolean }>(`select has_function_privilege('service_role', '${sig}', 'EXECUTE') as v`)).rows[0].v)).toBe(true)
    }
    await pg.exec("SET ROLE authenticated")
    try {
      await expect(pg.query("select public.dpdp_mail_digest_pending()")).rejects.toThrow(/permission denied/)
    } finally {
      await pg.exec("RESET ROLE")
    }
  })

  test("6. the pending function is read-only and the window is clamped to 1..168 hours", async () => {
    const x = await ticket("support", 100)
    const y = await ticket("support", 200)
    const fresh = await ticket("support", 0.5)
    const before = (await pg.query("select ticket_no, digested_at from dpdp.mail_inbound order by 1")).rows
    const wide = (await pending(1000)).tickets.map((t) => t.ticketNo)
    expect(wide).toContain(x) // 1000 is clamped to 168: 100 hours ago is inside
    expect(wide).not.toContain(y) // ... and 200 hours ago is outside
    const narrow = (await pending(0)).tickets.map((t) => t.ticketNo)
    expect(narrow).toContain(fresh) // 0 is clamped to 1 hour
    expect(narrow).not.toContain(x)
    expect((await pending((null as unknown as number))).tickets.map((t) => t.ticketNo)).toContain(fresh) // null = the default 25 hours
    expect((await pg.query("select ticket_no, digested_at from dpdp.mail_inbound order by 1")).rows).toEqual(before)
  })
})

describe("the file as a migration", () => {
  test("7a. running 0667 a second time changes nothing", async () => {
    const snapshot = async () => ({
      cols: (await pg.query("select column_name from information_schema.columns where table_schema = 'dpdp' and table_name = 'mail_inbound' order by 1")).rows,
      fns: (await pg.query("select proname, pg_get_functiondef(oid) as def from pg_proc where proname like 'dpdp_mail_digest_%' order by 1")).rows,
      idx: (await pg.query("select indexname from pg_indexes where schemaname = 'dpdp' and tablename = 'mail_inbound' order by 1")).rows,
      rows: (await pg.query("select ticket_no, digested_at from dpdp.mail_inbound order by 1")).rows,
    })
    const a = await snapshot()
    await pg.exec(FORWARD)
    expect(await snapshot()).toEqual(a)
    expect(a.idx.map((r) => (r as { indexname: string }).indexname)).toContain("dpdp_mail_inbound_undigested_idx")
  })

  test("7b. the journal registers it with the next idx and a newer timestamp than every earlier entry", () => {
    const journal = JSON.parse(read("drizzle/meta/_journal.json")) as { entries: Array<{ idx: number; when: number; tag: string }> }
    const mine = journal.entries.filter((e) => e.tag === TAG)
    expect(mine).toHaveLength(1)
    const others = journal.entries.filter((e) => e.tag !== TAG && e.tag < TAG)
    expect(mine[0].when).toBeGreaterThan(Math.max(...others.map((e) => e.when)))
    expect(mine[0].idx).toBe(Math.max(...others.map((e) => e.idx)) + 1)
  })

  test("7c. the destructive-DDL citation (GRANT / REVOKE / SECURITY DEFINER) is present and valid", () => {
    expect(findValidCitation(FORWARD)).not.toBeNull()
  })

  test("7d. the cron job is named dpdp-operator-digest, runs daily at 03:30 UTC (09:00 IST), posts the operator_digest job to dpdp-inbound-mail with the Vault timer secret, and is a no-op without pg_cron / pg_net", () => {
    expect(FORWARD).toContain("'dpdp-operator-digest'")
    expect(FORWARD).toContain("'30 3 * * *'")
    expect(FORWARD).toContain(`'{"job":"operator_digest"}'::jsonb`)
    expect(FORWARD).toContain("'dpdp-monday-email', 'dpdp-inbound-mail'")
    expect(FORWARD).toContain("name = 'dpdp_timer_secret'")
    expect(FORWARD).toContain("extname = 'pg_cron'")
    expect(FORWARD).toContain("extname = 'pg_net'")
  })
})
