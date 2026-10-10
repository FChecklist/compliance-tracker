/// <reference types="bun-types" />
// DPDP single mailbox: offline proof of drizzle/0662_dpdp_single_mailbox_mail_log.sql on PGlite (real Postgres compiled to WASM).
// No live database is touched; nothing here needs .env.local.
//
// BASE: an empty database with the roles the Supabase baseline has (anon, authenticated, service_role, authenticator, app_runtime), an empty
// schema dpdp, and DELIBERATELY GENEROUS default privileges (schema dpdp: every new table to anon and authenticated, every new function to
// anon, authenticated and service_role; schema public: every new function to anon, authenticated and service_role, which is what Supabase
// does). The migration must strip all of it, so the assertions below prove it is self-sufficient and do not depend on the live project
// happening to have tight defaults.
//
// WHAT IS PROVEN, every assertion re-reading persisted state rather than trusting a returned message (R74-RULING-03):
//   1. before 0662 none of the objects exist; after it: three tables with the columns of the design, RLS on, the service_role bypass
//      policy and no policy for anyone else, and CHECKs whose class list and ref alphabet are the ones mail-taxonomy.ts defines;
//   2. anon, authenticated and PUBLIC hold no privilege on any of the three tables and cannot execute any public.dpdp_mail_* function
//      (a real call as each role is refused); service_role holds the four table privileges and EXECUTE on the six functions; the internal
//      ticket helper is executable by nobody; all seven functions are SECURITY DEFINER with an empty search_path;
//   3. ticket numbers: the right prefix for all eleven classes (K for the statutory-notice class `clock`), sequential per class and
//      independent across classes, per IST calendar year (the boundary is 18:30 UTC), growing past 9999 instead of truncating, and a
//      duplicate or a refused insert consumes no number;
//   4. dpdp_mail_insert_inbound stores every column it is given (re-read), computes due_at from the caller's day count, truncates to the
//      column caps, tolerates a blank sender and a malformed ref, refuses an unknown class and an absurd day count, and is idempotent per
//      (sender, Message-ID, content) case-insensitively while a different sender or a missing Message-ID gets its own ticket, and the
//      same sender's same Message-ID with a DIFFERENT subject or excerpt is a new ticket, noted, whose own retry is a duplicate of it;
//   5. ackDue: true only when wanted, not yet sent, fewer than 3 acknowledgements went to that sender in the last 24 hours AND fewer
//      than 30 went to anyone in the last hour (ackLimit says which limit held it back; the ticket is still created either way);
//      mark_ack / mark_notified set their time once, mark_ack moves open -> acknowledged and never reopens a closed ticket;
//      dpdp_mail_close closes a ticket once (FIRST CALL WINS: the time is the first call's; the note is the first non-blank one, and a
//      later call may add a note only when none was stored), never reopens, refuses every role but service_role and reports an unknown ticket;
//   6. dpdp_mail_log_outbound / dpdp_mail_lookup_outbound: normalised ids, a second call fills the provider id without erasing anything,
//      a ref reused for a different class or recipient is refused and the row is unchanged, lookup prefers the ref over a message id and
//      the newest of several message-id matches, and finds nothing rather than guessing;
//   7. running the file twice changes nothing; the journal entry exists and is newer than every other; the destructive-DDL citation is valid.
// NOT PROVEN HERE: two connections taking a ticket at the same instant. PGlite is one connection. The guarantee is by construction (one
// INSERT .. ON CONFLICT DO UPDATE on the (prefix, year) row takes that row's lock) and should be exercised on a real database once.
//
// Run: bun test --isolate src/lib/services/dpdp-single-mailbox-migration.pglite.test.ts
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { PGlite } from "@electric-sql/pglite"
import { MAIL_CLASSES, newRef, type MailClass } from "../../../supabase/functions/_shared/mail-taxonomy.ts"
import { findValidCitation } from "../../../scripts/check-ddl-authorization.mjs"

const REPO_ROOT = new URL("../../../", import.meta.url)
const read = (p: string) => readFileSync(new URL(p, REPO_ROOT), "utf8")
const TAG = "0662_dpdp_single_mailbox_mail_log"
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

const TABLES = ["mail_outbound", "mail_inbound", "mail_ticket_counter"] as const
const PUBLIC_FNS = [
  "dpdp_mail_log_outbound", "dpdp_mail_lookup_outbound", "dpdp_mail_insert_inbound", "dpdp_mail_mark_ack", "dpdp_mail_mark_notified", "dpdp_mail_close",
] as const

let pg: PGlite

/** One value as text. Give an expression, or `<expr> from <table> ...` (wrapped as a sub-select for you). */
async function scalar(sql: string): Promise<string | null> {
  const expr = !sql.trimStart().startsWith("(") && / from /i.test(sql) ? `(select ${sql})` : sql
  return (await pg.query<{ v: string | null }>(`select (${expr})::text as v`)).rows[0]?.v ?? null
}
async function rows<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await pg.query<T>(sql, params)).rows
}
function errorOf(e: unknown): { message: string; code: string } {
  const err = e as { message?: string; code?: string }
  return { message: err.message ?? String(e), code: err.code ?? "" }
}

// The named-argument cast for each parameter, so a JS null still has a type.
const CAST: Record<string, string> = {
  p_received_at: "::timestamptz", p_due_days: "::integer", p_message_ids: "::text[]", p_raw_forwarded: "::boolean", p_wants_ack: "::boolean",
}
/** Calls public.<fn>(named args) as service_role, the way the Edge Function does through PostgREST. */
async function rpc<T = Record<string, unknown> | null>(fn: string, args: Record<string, unknown>, role = "service_role"): Promise<T> {
  const keys = Object.keys(args)
  const list = keys.map((k, i) => `${k} => $${i + 1}${CAST[k] ?? "::text"}`).join(", ")
  await pg.exec(`SET ROLE ${role}`)
  try {
    return (await pg.query<{ r: T }>(`select public.${fn}(${list}) as r`, keys.map((k) => args[k]))).rows[0].r
  } finally {
    await pg.exec("RESET ROLE")
  }
}
async function rpcError(fn: string, args: Record<string, unknown>, role = "service_role"): Promise<{ message: string; code: string }> {
  try {
    await rpc(fn, args, role)
  } catch (e) {
    return errorOf(e)
  }
  throw new Error(`expected ${fn} to fail`)
}
async function execError(sql: string): Promise<{ message: string; code: string }> {
  try {
    await pg.exec(sql)
  } catch (e) {
    return errorOf(e)
  }
  throw new Error("expected this SQL to fail")
}

type Inserted = {
  id: string; ticketNo: string; class: MailClass; status: string; dueAt: string | null; duplicate: boolean; ackDue: boolean
  ackLimit: "sender" | "hourly" | null; operatorNotified: boolean; messageIdReused: boolean
}
let seq = 0
const insert = (over: Record<string, unknown> = {}) =>
  rpc<Inserted>("dpdp_mail_insert_inbound", {
    p_class: "grievance", p_from_addr: `sender${++seq}@example.test`, p_subject: "Subject", p_message_id: `<m${seq}@example.test>`, ...over,
  })
const inboundRow = async (ticket: string) => (await rows<Record<string, unknown>>("select * from dpdp.mail_inbound where ticket_no = $1", [ticket]))[0]
const outboundRow = async (ref: string) => (await rows<Record<string, unknown>>("select * from dpdp.mail_outbound where ref = $1", [ref]))[0]
const ref = () => newRef()

beforeAll(async () => {
  pg = await PGlite.create()
  await pg.exec(BASE_SQL)
}, 60_000)

afterAll(async () => {
  await pg?.close()
})

describe("drizzle/0662 single-mailbox mail log on an empty dpdp schema (PGlite)", () => {
  test("1a. before 0662 none of the objects exist", async () => {
    for (const t of TABLES) expect(await scalar(`to_regclass('dpdp.${t}') is null`)).toBe("true")
    expect(await scalar("count(*) from pg_proc where proname like 'dpdp_mail_%' or proname = 'mail_next_ticket'")).toBe("0")
  })

  test("1b. 0662 adds the three tables with the designed columns, types and constraints", async () => {
    await pg.exec(FORWARD)
    const cols = async (t: string) =>
      (await rows<{ column_name: string; data_type: string; is_nullable: string }>(
        "select column_name, data_type, is_nullable from information_schema.columns where table_schema = 'dpdp' and table_name = $1 order by ordinal_position", [t],
      )).map((c) => `${c.column_name}:${c.data_type}:${c.is_nullable}`)

    expect(await cols("mail_inbound")).toEqual([
      "id:text:NO", "ticket_no:text:NO", "class:text:NO", "ref:text:YES", "from_addr:text:NO", "to_addr:text:YES", "subject:text:YES", "message_id:text:YES",
      "in_reply_to:text:YES", "references_hdr:text:YES", "received_at:timestamp with time zone:NO", "due_at:timestamp with time zone:YES", "status:text:NO",
      "ack_sent_at:timestamp with time zone:YES", "excerpt:text:YES", "classifier_reason:text:YES", "matched_outbound_ref:text:YES", "raw_forwarded:boolean:NO",
      "operator_notified_at:timestamp with time zone:YES", "created_at:timestamp with time zone:NO",
      "closed_at:timestamp with time zone:YES", "closed_note:text:YES",
    ])
    expect(await cols("mail_outbound")).toEqual([
      "id:text:NO", "ref:text:NO", "class:text:NO", "org_id:text:YES", "membership_id:text:YES", "provider_message_id:text:YES", "message_id_header:text:YES",
      "subject:text:YES", "to_addr:text:NO", "ticket_no:text:YES", "sent_at:timestamp with time zone:NO",
    ])
    expect(await cols("mail_ticket_counter")).toEqual(["prefix:text:NO", "year:integer:NO", "last_no:integer:NO"])

    // ticket_no is unique; ref on outbound is unique; the counter's key is (prefix, year).
    const unique = await rows<{ def: string }>(
      "select pg_get_indexdef(i.indexrelid) def from pg_index i join pg_class c on c.oid = i.indrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'dpdp' and i.indisunique",
    )
    const defs = unique.map((u) => u.def).join("\n")
    expect(defs).toContain("ON dpdp.mail_inbound USING btree (ticket_no)")
    expect(defs).toContain("ON dpdp.mail_outbound USING btree (ref)")
    expect(defs).toContain("ON dpdp.mail_ticket_counter USING btree (prefix, year)")
    expect(defs).toContain("(lower(from_addr), message_id) WHERE (message_id IS NOT NULL)")
  })

  test("1c. the class CHECKs list exactly mail-taxonomy.ts's classes; the ref CHECK accepts every newRef() and nothing else", async () => {
    for (const con of ["mail_outbound_class_check", "mail_inbound_class_check"]) {
      const def = (await rows<{ d: string }>("select pg_get_constraintdef(oid) d from pg_constraint where conname = $1", [con]))[0].d
      const listed = [...def.matchAll(/'([a-z_]+)'::text/g)].map((m) => m[1]).sort()
      expect(listed).toEqual([...MAIL_CLASSES].sort())
    }
    for (let i = 0; i < 200; i++) {
      const r = ref()
      await pg.exec(`INSERT INTO dpdp.mail_outbound (ref, class, to_addr) VALUES ('${r}', 'monday', 'a@example.test')`)
    }
    expect(await scalar("count(*) from dpdp.mail_outbound")).toBe("200")
    for (const bad of ["K3F9X2AB7Q", "k3f9x2ab7i", "k3f9x2ab7l", "k3f9x2ab7o", "k3f9x2ab7u", "short", "k3f9x2ab7qq", ""]) {
      expect((await execError(`INSERT INTO dpdp.mail_outbound (ref, class, to_addr) VALUES ('${bad}', 'monday', 'a@example.test')`)).message).toContain("mail_outbound_ref_check")
    }
    await pg.exec("DELETE FROM dpdp.mail_outbound")
  })

  test("1d. the row CHECKs refuse an unknown class, an unknown status, an excerpt over 4096 characters and a close note over 1000", async () => {
    const base = "INSERT INTO dpdp.mail_inbound (ticket_no, class, from_addr"
    expect((await execError(`${base}) VALUES ('X-1', 'spam', 'a@b.test')`)).message).toContain("mail_inbound_class_check")
    expect((await execError(`${base}, status) VALUES ('X-2', 'review', 'a@b.test', 'deleted')`)).message).toContain("mail_inbound_status_check")
    expect((await execError(`${base}, excerpt) VALUES ('X-3', 'review', 'a@b.test', repeat('x', 4097))`)).message).toContain("mail_inbound_excerpt_length_check")
    expect((await execError(`${base}, closed_note) VALUES ('X-5', 'review', 'a@b.test', repeat('x', 1001))`)).message).toContain("mail_inbound_closed_note_length_check")
    await pg.exec(`${base}, closed_note) VALUES ('X-6', 'clock', 'a@b.test', repeat('x', 1000))`)
    await pg.exec("DELETE FROM dpdp.mail_inbound WHERE ticket_no = 'X-6'")
    await pg.exec(`${base}, excerpt) VALUES ('X-4', 'review', 'a@b.test', repeat('x', 4096))`)
    expect((await execError(`${base}) VALUES ('X-4', 'review', 'c@d.test')`)).message).toContain("duplicate key")
    await pg.exec("DELETE FROM dpdp.mail_inbound")
  })

  test("2a. RLS is on for all three tables; only service_role has a policy", async () => {
    for (const t of TABLES) {
      expect(await scalar(`(select relrowsecurity from pg_class where oid = 'dpdp.${t}'::regclass)`)).toBe("true")
      const pol = await rows<{ policyname: string; roles: string; cmd: string }>("select policyname, roles::text roles, cmd from pg_policies where schemaname = 'dpdp' and tablename = $1", [t])
      expect(pol).toEqual([{ policyname: "service_role_bypass", roles: "{service_role}", cmd: "ALL" }])
    }
  })

  test("2b. anon, authenticated and PUBLIC hold nothing on the tables; service_role holds the four privileges", async () => {
    for (const t of TABLES) {
      const grants = await rows<{ grantee: string; priv: string }>(
        `select case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end grantee, a.privilege_type priv
         from pg_class c, aclexplode(c.relacl) a where c.oid = 'dpdp.${t}'::regclass`,
      )
      const by = new Map<string, string[]>()
      for (const g of grants) by.set(g.grantee, [...(by.get(g.grantee) ?? []), g.priv])
      expect([...by.keys()].filter((g) => g !== "service_role" && g !== "postgres" && g !== "pglite").sort()).toEqual([])
      expect([...(by.get("service_role") ?? [])].sort()).toEqual(["DELETE", "INSERT", "SELECT", "UPDATE"])
      for (const role of ["anon", "authenticated"]) {
        for (const priv of ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"]) {
          expect(await scalar(`has_table_privilege('${role}', 'dpdp.${t}', '${priv}')`)).toBe("false")
        }
      }
    }
  })

  test("2c. a real query against a table as anon or authenticated is refused", async () => {
    for (const role of ["anon", "authenticated"]) {
      await pg.exec(`SET ROLE ${role}`)
      try {
        for (const t of TABLES) {
          expect((await execError(`select count(*) from dpdp.${t}`)).message).toContain("permission denied")
        }
        expect((await execError("insert into dpdp.mail_inbound (ticket_no, class, from_addr) values ('Z-1', 'review', 'a@b.test')")).message).toContain("permission denied")
      } finally {
        await pg.exec("RESET ROLE")
      }
    }
  })

  test("2d. the six public functions: SECURITY DEFINER, empty search_path, EXECUTE for service_role only", async () => {
    for (const fn of PUBLIC_FNS) {
      const meta = await rows<{ prosecdef: boolean; config: string | null }>(
        "select p.prosecdef, array_to_string(p.proconfig, ',') config from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = $1", [fn],
      )
      expect(meta).toHaveLength(1)
      expect(meta[0].prosecdef).toBe(true)
      expect(meta[0].config).toBe('search_path=""')
      const acl = await rows<{ grantee: string }>(
        `select case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end grantee
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace, aclexplode(p.proacl) a where n.nspname = 'public' and p.proname = $1`, [fn],
      )
      const grantees = acl.map((a) => a.grantee).filter((g) => g !== "postgres" && g !== "pglite")
      expect(grantees).toEqual(["service_role"])
    }
  })

  test("2e. the internal ticket helper is SECURITY DEFINER and executable by nobody but its owner", async () => {
    const meta = await rows<{ prosecdef: boolean; config: string | null; acl: string | null }>(
      "select p.prosecdef, array_to_string(p.proconfig, ',') config, p.proacl::text acl from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'dpdp' and p.proname = 'mail_next_ticket'",
    )
    expect(meta).toHaveLength(1)
    expect(meta[0].prosecdef).toBe(true)
    expect(meta[0].config).toBe('search_path=""')
    for (const role of ["anon", "authenticated", "service_role", "app_runtime"]) {
      expect(await scalar(`has_function_privilege('${role}', 'dpdp.mail_next_ticket(text, timestamptz)', 'EXECUTE')`)).toBe("false")
    }
    await pg.exec("SET ROLE service_role")
    try {
      expect((await execError("select dpdp.mail_next_ticket('grievance')")).message).toContain("permission denied")
    } finally {
      await pg.exec("RESET ROLE")
    }
  })

  test("2f. a real call to each public function as anon, authenticated or app_runtime is refused, and writes nothing", async () => {
    const calls: Array<[string, Record<string, unknown>]> = [
      ["dpdp_mail_log_outbound", { p_ref: ref(), p_class: "monday", p_to_addr: "a@b.test" }],
      ["dpdp_mail_lookup_outbound", { p_ref: ref() }],
      ["dpdp_mail_insert_inbound", { p_class: "review", p_from_addr: "a@b.test", p_subject: "s", p_message_id: "<x@y>" }],
      ["dpdp_mail_mark_ack", { p_ticket_no: "R-2026-0001" }],
      ["dpdp_mail_mark_notified", { p_ticket_no: "R-2026-0001" }],
      ["dpdp_mail_close", { p_ticket_no: "R-2026-0001", p_note: "not yours to close" }],
    ]
    for (const role of ["anon", "authenticated", "app_runtime"]) {
      for (const [fn, args] of calls) {
        const e = await rpcError(fn, args, role)
        expect(e.message).toContain("permission denied for function")
      }
    }
    expect(await scalar("(select count(*) from dpdp.mail_inbound) + (select count(*) from dpdp.mail_outbound) + (select count(*) from dpdp.mail_ticket_counter)")).toBe("0")
  })
})

describe("ticket numbers", () => {
  const PREFIX: Record<MailClass, string> = {
    grievance: "G", data_request: "D", review: "R", sales: "S", sales_chain: "T", invoice: "I", monday: "M", clock: "K", partner: "P", support: "H", auto: "A",
  }
  test("3a. every class gets its own prefix and its own counter: first ticket is P-<year>-0001, second 0002", async () => {
    const year = new Date().getUTCFullYear()
    for (const cls of MAIL_CLASSES) {
      const a = await insert({ p_class: cls })
      const b = await insert({ p_class: cls })
      expect(a.ticketNo).toBe(`${PREFIX[cls]}-${a.ticketNo.split("-")[1]}-0001`)
      expect(a.ticketNo.split("-")[1]).toBe(String(year))
      expect(b.ticketNo).toBe(`${PREFIX[cls]}-${year}-0002`)
      expect((await inboundRow(a.ticketNo)).class).toBe(cls)
    }
    expect(new Set(MAIL_CLASSES.map((c) => PREFIX[c])).size).toBe(11)
    expect(PREFIX.clock).toBe("K")
    expect(await scalar("count(*) from dpdp.mail_ticket_counter")).toBe("11")
  })

  test("3b. the year is the IST calendar year: 18:29:59 UTC on 31 Dec is still the old year, 18:30:00 UTC is the new one", async () => {
    const before = await insert({ p_class: "partner", p_received_at: "2030-12-31T18:29:59Z" })
    const after = await insert({ p_class: "partner", p_received_at: "2030-12-31T18:30:00Z" })
    const again = await insert({ p_class: "partner", p_received_at: "2031-06-01T00:00:00Z" })
    expect(before.ticketNo).toBe("P-2030-0001")
    expect(after.ticketNo).toBe("P-2031-0001")
    expect(again.ticketNo).toBe("P-2031-0002")
    const back = await insert({ p_class: "partner", p_received_at: "2030-07-01T00:00:00Z" })
    expect(back.ticketNo).toBe("P-2030-0002")
  })

  test("3c. past 9999 the number grows to five digits instead of being truncated", async () => {
    await pg.exec("INSERT INTO dpdp.mail_ticket_counter (prefix, year, last_no) VALUES ('H', 2040, 9998)")
    const a = await insert({ p_class: "support", p_received_at: "2040-03-01T00:00:00Z" })
    const b = await insert({ p_class: "support", p_received_at: "2040-03-01T00:00:00Z" })
    const c = await insert({ p_class: "support", p_received_at: "2040-03-01T00:00:00Z" })
    expect([a.ticketNo, b.ticketNo, c.ticketNo]).toEqual(["H-2040-9999", "H-2040-10000", "H-2040-10001"])
  })

  test("3d. a duplicate delivery and a refused insert consume no number", async () => {
    const first = await insert({ p_class: "invoice", p_from_addr: "gapless@example.test", p_message_id: "<gapless@example.test>" })
    const dup = await insert({ p_class: "invoice", p_from_addr: "gapless@example.test", p_message_id: "<gapless@example.test>" })
    expect(dup).toMatchObject({ ticketNo: first.ticketNo, duplicate: true })
    const refused = await rpcError("dpdp_mail_insert_inbound", { p_class: "invoice", p_from_addr: "x@example.test", p_subject: "s", p_message_id: "<r@x>", p_due_days: 0 })
    expect(refused.code).toBe("22023")
    const next = await insert({ p_class: "invoice" })
    const n = (t: string) => Number(t.split("-")[2])
    expect(n(next.ticketNo)).toBe(n(first.ticketNo) + 1)
    const counter = await scalar(`last_no from dpdp.mail_ticket_counter where prefix = 'I' and year = ${first.ticketNo.split("-")[1]}`)
    expect(Number(counter)).toBe(n(next.ticketNo))
  })
})

describe("dpdp_mail_insert_inbound", () => {
  test("4a. every column is stored as given, due_at is received_at plus the caller's days, and the returned shape is the contract", async () => {
    const outboundRef = ref()
    const tagRef = ref()
    const res = await rpc<Inserted>("dpdp_mail_insert_inbound", {
      p_class: "grievance", p_from_addr: "Asha@Example.Test", p_subject: "Complaint", p_message_id: "<Abc.123@Example.Test>",
      p_received_at: "2032-05-04T10:00:00Z", p_due_days: 90, p_ref: tagRef, p_to_addr: `dpdp+grv.${tagRef}@veridian-aios.com`,
      p_in_reply_to: "<sent-1@veridian-aios.com>", p_references_hdr: "<old@x> <sent-1@veridian-aios.com>", p_excerpt: "hello\nworld",
      p_classifier_reason: "tag:grv", p_matched_outbound_ref: outboundRef, p_raw_forwarded: true, p_wants_ack: true,
    })
    expect(res).toMatchObject({ class: "grievance", status: "open", duplicate: false, ackDue: true, operatorNotified: false })
    expect(res.ticketNo).toBe("G-2032-0001")
    expect(new Date(res.dueAt!).toISOString()).toBe("2032-08-02T10:00:00.000Z")

    const row = await inboundRow(res.ticketNo)
    expect(row).toMatchObject({
      ticket_no: "G-2032-0001", class: "grievance", ref: tagRef, from_addr: "Asha@Example.Test", to_addr: `dpdp+grv.${tagRef}@veridian-aios.com`,
      subject: "Complaint", message_id: "<Abc.123@Example.Test>", in_reply_to: "<sent-1@veridian-aios.com>", references_hdr: "<old@x> <sent-1@veridian-aios.com>",
      status: "open", ack_sent_at: null, excerpt: "hello\nworld", classifier_reason: "tag:grv", matched_outbound_ref: outboundRef, raw_forwarded: true,
      operator_notified_at: null,
    })
    expect(new Date(row.received_at as string).toISOString()).toBe("2032-05-04T10:00:00.000Z")
    expect(new Date(row.due_at as string).toISOString()).toBe("2032-08-02T10:00:00.000Z")
    expect(row.created_at).toBeTruthy()
    expect(Object.keys(res).sort()).toEqual(["ackDue", "ackLimit", "class", "dueAt", "duplicate", "id", "messageIdReused", "operatorNotified", "status", "ticketNo"])
    expect(res.ackLimit).toBeNull()
    expect(res.messageIdReused).toBe(false)
  })

  test("4b. no day count means no due date; 1 and 3650 days are accepted; 0, -1 and 3651 are refused", async () => {
    const none = await insert({ p_class: "sales", p_due_days: null })
    expect(none.dueAt).toBeNull()
    expect((await inboundRow(none.ticketNo)).due_at).toBeNull()
    for (const days of [1, 3650]) expect((await insert({ p_due_days: days })).dueAt).toBeTruthy()
    for (const days of [0, -1, 3651]) expect((await rpcError("dpdp_mail_insert_inbound", { p_class: "review", p_from_addr: "a@b.test", p_subject: "s", p_message_id: null, p_due_days: days })).code).toBe("22023")
  })

  test("4c. an unknown or missing class is refused and writes nothing", async () => {
    const before = await scalar("count(*) from dpdp.mail_inbound")
    for (const cls of ["spam", "", "GRIEVANCE", null]) {
      const e = await rpcError("dpdp_mail_insert_inbound", { p_class: cls, p_from_addr: "a@b.test", p_subject: "s", p_message_id: null })
      expect(e.code).toBe("22023")
    }
    expect(await scalar("count(*) from dpdp.mail_inbound")).toBe(before)
  })

  test("4d. long values are cut to their caps (excerpt 4096, subject 500, addresses 320, message id 998, references 8000, reason 500)", async () => {
    const res = await insert({
      p_class: "review", p_from_addr: `${"f".repeat(400)}@example.test`, p_to_addr: "t".repeat(400), p_subject: "s".repeat(900), p_message_id: `<${"m".repeat(1200)}>`,
      p_in_reply_to: "i".repeat(1200), p_references_hdr: "r".repeat(9000), p_excerpt: "e".repeat(9000), p_classifier_reason: "c".repeat(900),
    })
    const row = await inboundRow(res.ticketNo)
    expect((row.from_addr as string).length).toBe(320)
    expect((row.to_addr as string).length).toBe(320)
    expect((row.subject as string).length).toBe(500)
    expect((row.message_id as string).length).toBe(998)
    expect((row.in_reply_to as string).length).toBe(998)
    expect((row.references_hdr as string).length).toBe(8000)
    expect((row.excerpt as string).length).toBe(4096)
    expect((row.classifier_reason as string).length).toBe(500)
  })

  test("4e. a blank sender is kept as '(unknown sender)'; a malformed ref or matched ref is stored as null; nothing is refused", async () => {
    const res = await insert({ p_class: "review", p_from_addr: "   ", p_ref: "NOT-A-REF", p_matched_outbound_ref: "k3f9x2ab7i", p_message_id: null })
    const row = await inboundRow(res.ticketNo)
    expect(row).toMatchObject({ from_addr: "(unknown sender)", ref: null, matched_outbound_ref: null })
    const nulls = await rpc<Inserted>("dpdp_mail_insert_inbound", { p_class: "review", p_from_addr: null, p_subject: null, p_message_id: null })
    expect((await inboundRow(nulls.ticketNo)).from_addr).toBe("(unknown sender)")
  })

  test("4f. idempotent per (sender, Message-ID, content), sender compared case-insensitively; another sender, or no Message-ID, gets a new ticket", async () => {
    const a = await insert({ p_class: "sales", p_from_addr: "Dup@Example.Test", p_message_id: "<dup@example.test>", p_subject: "first", p_excerpt: "the same words" })
    const b = await insert({ p_class: "sales", p_from_addr: "dup@example.test", p_message_id: "<dup@example.test>", p_subject: "first", p_excerpt: "the same words" })
    expect(b).toMatchObject({ ticketNo: a.ticketNo, id: a.id, duplicate: true, messageIdReused: false })
    expect((await inboundRow(a.ticketNo)).subject).toBe("first")
    // A retry may even arrive classified differently (a rule changed), or with other bookkeeping: it is still the same message.
    const c = await insert({ p_class: "review", p_from_addr: "dup@example.test", p_message_id: "<dup@example.test>", p_subject: "first", p_excerpt: "the same words", p_classifier_reason: "other:rule", p_due_days: 30 })
    expect(c).toMatchObject({ ticketNo: a.ticketNo, duplicate: true, class: "sales", messageIdReused: false })
    const other = await insert({ p_class: "sales", p_from_addr: "other@example.test", p_message_id: "<dup@example.test>" })
    expect(other.duplicate).toBe(false)
    expect(other.ticketNo).not.toBe(a.ticketNo)
    const n1 = await insert({ p_class: "sales", p_from_addr: "nomid@example.test", p_message_id: null })
    const n2 = await insert({ p_class: "sales", p_from_addr: "nomid@example.test", p_message_id: null })
    const n3 = await insert({ p_class: "sales", p_from_addr: "nomid@example.test", p_message_id: "   " })
    expect(new Set([n1.ticketNo, n2.ticketNo, n3.ticketNo]).size).toBe(3)
    expect(await scalar("count(*) from dpdp.mail_inbound where lower(from_addr) = 'dup@example.test'")).toBe("1")
  })

  test("4g. a duplicate reports whether the operator was already told", async () => {
    const a = await insert({ p_class: "support", p_from_addr: "told@example.test", p_message_id: "<told@example.test>" })
    expect((await insert({ p_class: "support", p_from_addr: "told@example.test", p_message_id: "<told@example.test>" })).operatorNotified).toBe(false)
    await rpc("dpdp_mail_mark_notified", { p_ticket_no: a.ticketNo })
    expect((await insert({ p_class: "support", p_from_addr: "told@example.test", p_message_id: "<told@example.test>" })).operatorNotified).toBe(true)
  })

  // Owner decision (2026-09-29): a Message-ID is a claim by the SENDER. Reusing one for a message that says something else must not let a
  // later request pass as a retry of an earlier, harmless one (a legal request that never got its ticket, clock or acknowledgement).
  test("4h. the same sender's same Message-ID with DIFFERENT content is a new, noted ticket; a retry of either message is a duplicate of its own ticket", async () => {
    const from = "reuse@example.test"
    const mid = "<reuse@example.test>"
    const one = { p_class: "sales", p_from_addr: from, p_message_id: mid, p_subject: "Pricing", p_excerpt: "how much is it?", p_classifier_reason: 'keyword:sales:"pricing"' }
    const two = { p_class: "data_request", p_from_addr: "Reuse@Example.Test", p_message_id: mid, p_subject: "Pricing", p_excerpt: "Please delete my data.", p_classifier_reason: 'keyword:data_request:"delete my data"', p_due_days: 90, p_wants_ack: true }
    const first = await insert(one)
    expect(first).toMatchObject({ duplicate: false, messageIdReused: false })
    const second = await insert(two)
    expect(second).toMatchObject({ duplicate: false, messageIdReused: true, class: "data_request", ackDue: true })
    expect(second.ticketNo).not.toBe(first.ticketNo)
    expect(second.dueAt).toBeTruthy()

    // re-read both rows: the second is a real ticket of its own, the first is untouched
    const row2 = await inboundRow(second.ticketNo)
    expect(row2).toMatchObject({ class: "data_request", subject: "Pricing", excerpt: "Please delete my data.", status: "open" })
    expect(row2.classifier_reason).toBe('keyword:data_request:"delete my data"; same Message-ID, different content')
    expect(row2.message_id).toMatch(/^<reuse@example\.test>#[0-9a-f]{32}$/)
    expect(row2.due_at).toBeTruthy()
    expect(await inboundRow(first.ticketNo)).toMatchObject({ class: "sales", message_id: mid, excerpt: "how much is it?", classifier_reason: 'keyword:sales:"pricing"', due_at: null })

    // a retry of either one is a duplicate of ITS OWN ticket, and nothing new is created
    const retry1 = await insert(one)
    const retry2 = await insert(two)
    expect(retry1).toMatchObject({ ticketNo: first.ticketNo, duplicate: true, messageIdReused: false })
    expect(retry2).toMatchObject({ ticketNo: second.ticketNo, duplicate: true, messageIdReused: false, class: "data_request" })
    expect(await scalar("count(*) from dpdp.mail_inbound where lower(from_addr) = 'reuse@example.test'")).toBe("2")

    // a third, different message under the same id is a third ticket
    const third = await insert({ ...one, p_excerpt: "and a third thing" })
    expect(third).toMatchObject({ duplicate: false, messageIdReused: true })
    expect(new Set([first.ticketNo, second.ticketNo, third.ticketNo]).size).toBe(3)
    expect((await inboundRow(third.ticketNo)).classifier_reason).toBe('keyword:sales:"pricing"; same Message-ID, different content')

    // exactly one ticket number per distinct message: no gap left by a retry
    const n = (t: string) => Number(t.split("-")[2])
    const next = await insert({ p_class: "data_request" })
    expect(n(next.ticketNo)).toBe(n(second.ticketNo) + 1)
  })

  test("4i. a different subject alone, or a different excerpt alone, is different content; only a truncated-equal excerpt is the same", async () => {
    const base = { p_class: "support", p_from_addr: "content@example.test", p_message_id: "<content@example.test>", p_subject: "Help", p_excerpt: "e".repeat(5000) }
    const a = await insert(base)
    expect((await insert({ ...base, p_subject: "Help please" })).messageIdReused).toBe(true)
    expect((await insert({ ...base, p_excerpt: "f".repeat(5000) })).messageIdReused).toBe(true)
    // the stored excerpt is cut at 4096 (and the subject at 500), so text that differs only beyond the cut is the same message
    const beyond = await insert({ ...base, p_excerpt: "e".repeat(4096) + "z".repeat(904) })
    expect(beyond).toMatchObject({ ticketNo: a.ticketNo, duplicate: true, messageIdReused: false })
    const long = { ...base, p_message_id: "<content2@example.test>", p_subject: "s".repeat(700) }
    const b = await insert(long)
    expect(await insert({ ...long, p_subject: "s".repeat(500) + "t".repeat(200) })).toMatchObject({ ticketNo: b.ticketNo, duplicate: true })
    // null is not the empty string: a message with no excerpt and one with an empty excerpt are different content
    const n1 = await insert({ p_class: "support", p_from_addr: "nulls@example.test", p_message_id: "<n@example.test>", p_subject: "x", p_excerpt: null })
    expect(await insert({ p_class: "support", p_from_addr: "nulls@example.test", p_message_id: "<n@example.test>", p_subject: "x", p_excerpt: null })).toMatchObject({ ticketNo: n1.ticketNo, duplicate: true })
    expect((await insert({ p_class: "support", p_from_addr: "nulls@example.test", p_message_id: "<n@example.test>", p_subject: "x", p_excerpt: "" })).messageIdReused).toBe(true)
  })

  test("4j. the note survives a long or missing classifier reason: 500 characters at most, the note always last; a reason of 460+ characters loses its tail, not the note", async () => {
    const note = "same Message-ID, different content"
    const mid = "<longreason@example.test>"
    await insert({ p_class: "review", p_from_addr: "lr@example.test", p_message_id: mid, p_subject: "one", p_classifier_reason: null })
    const noReason = await insert({ p_class: "review", p_from_addr: "lr@example.test", p_message_id: mid, p_subject: "two", p_classifier_reason: null })
    expect((await inboundRow(noReason.ticketNo)).classifier_reason).toBe(note)
    const long = await insert({ p_class: "review", p_from_addr: "lr@example.test", p_message_id: mid, p_subject: "three", p_classifier_reason: "r".repeat(600) })
    const reason = (await inboundRow(long.ticketNo)).classifier_reason as string
    expect(reason.length).toBeLessThanOrEqual(500)
    expect(reason.endsWith(`; ${note}`)).toBe(true)
    expect(reason.startsWith("r".repeat(460))).toBe(true)
  })

  test("4k. the acknowledgement brakes still apply to the new ticket of a reused Message-ID", async () => {
    const from = "brake@example.test"
    for (let i = 0; i < 3; i++) {
      const t = await insert({ p_class: "grievance", p_from_addr: from, p_message_id: null, p_wants_ack: true })
      await rpc("dpdp_mail_mark_ack", { p_ticket_no: t.ticketNo })
    }
    const original = await insert({ p_class: "grievance", p_from_addr: from, p_message_id: "<brake@example.test>", p_subject: "a" })
    const reused = await insert({ p_class: "grievance", p_from_addr: from, p_message_id: "<brake@example.test>", p_subject: "b", p_wants_ack: true })
    expect(original.messageIdReused).toBe(false)
    expect(reused).toMatchObject({ messageIdReused: true, duplicate: false, ackDue: false, ackLimit: "sender" })
  })
})

describe("acknowledgement bookkeeping", () => {
  test("5a. ackDue is true only when wanted; it stays true on a retry until mark_ack, then false", async () => {
    const sender = "ackflow@example.test"
    expect((await insert({ p_from_addr: sender, p_message_id: "<w0@x>", p_wants_ack: false })).ackDue).toBe(false)
    const a = await insert({ p_from_addr: sender, p_message_id: "<w1@x>", p_wants_ack: true })
    expect(a.ackDue).toBe(true)
    expect((await insert({ p_from_addr: sender, p_message_id: "<w1@x>", p_wants_ack: true })).ackDue).toBe(true)
    const marked = await rpc<{ ok: boolean; status: string; ackSentAt: string }>("dpdp_mail_mark_ack", { p_ticket_no: a.ticketNo })
    expect(marked).toMatchObject({ ok: true, status: "acknowledged" })
    const row = await inboundRow(a.ticketNo)
    expect(row.status).toBe("acknowledged")
    expect(row.ack_sent_at).toBeTruthy()
    expect((await insert({ p_from_addr: sender, p_message_id: "<w1@x>", p_wants_ack: true })).ackDue).toBe(false)
  })

  test("5b. mark_ack is idempotent (the time is set once), never reopens a closed ticket, and reports an unknown ticket", async () => {
    const a = await insert({ p_from_addr: "ackidem@example.test" })
    await rpc("dpdp_mail_mark_ack", { p_ticket_no: a.ticketNo })
    const t1 = (await inboundRow(a.ticketNo)).ack_sent_at as string
    await pg.exec("SELECT pg_sleep(0.05)")
    await rpc("dpdp_mail_mark_ack", { p_ticket_no: a.ticketNo })
    expect(new Date((await inboundRow(a.ticketNo)).ack_sent_at as string).getTime()).toBe(new Date(t1).getTime())

    const closed = await insert({ p_from_addr: "closed@example.test" })
    await pg.exec(`UPDATE dpdp.mail_inbound SET status = 'closed' WHERE ticket_no = '${closed.ticketNo}'`)
    await rpc("dpdp_mail_mark_ack", { p_ticket_no: closed.ticketNo })
    const row = await inboundRow(closed.ticketNo)
    expect(row.status).toBe("closed")
    expect(row.ack_sent_at).toBeTruthy()

    expect(await rpc<{ ok: boolean }>("dpdp_mail_mark_ack", { p_ticket_no: "G-1999-0001" })).toEqual({ ok: false })
    expect(await rpc<{ ok: boolean }>("dpdp_mail_mark_notified", { p_ticket_no: "G-1999-0001" })).toEqual({ ok: false })
  })

  test("5c. mark_notified sets the time once and leaves the status alone", async () => {
    const a = await insert({ p_from_addr: "notify@example.test" })
    expect((await inboundRow(a.ticketNo)).operator_notified_at).toBeNull()
    const r1 = await rpc<{ ok: boolean; operatorNotifiedAt: string }>("dpdp_mail_mark_notified", { p_ticket_no: a.ticketNo })
    expect(r1.ok).toBe(true)
    const t1 = (await inboundRow(a.ticketNo)).operator_notified_at as string
    await pg.exec("SELECT pg_sleep(0.05)")
    await rpc("dpdp_mail_mark_notified", { p_ticket_no: a.ticketNo })
    const row = await inboundRow(a.ticketNo)
    expect(new Date(row.operator_notified_at as string).getTime()).toBe(new Date(t1).getTime())
    expect(row.status).toBe("open")
  })

  test("5d. after 3 acknowledgements to one sender in 24 hours the next ackDue is false; older ones and other senders do not count", async () => {
    const sender = "flood@example.test"
    const first = await insert({ p_from_addr: sender, p_message_id: "<f0@x>", p_wants_ack: true })
    for (let i = 1; i <= 3; i++) {
      const t = await insert({ p_from_addr: sender, p_message_id: `<f${i}@x>`, p_wants_ack: true })
      expect(t.ackDue).toBe(i <= 3)
      await rpc("dpdp_mail_mark_ack", { p_ticket_no: t.ticketNo })
    }
    // Three acknowledged in the last 24h: a fourth message is recorded, but not to be acknowledged.
    const fourth = await insert({ p_from_addr: sender, p_message_id: "<f4@x>", p_wants_ack: true })
    expect(fourth.ackDue).toBe(false)
    expect(fourth.ackLimit).toBe("sender")
    // The same limit holds regardless of the sender's letter case.
    expect((await insert({ p_from_addr: "FLOOD@Example.Test", p_message_id: "<f5@x>", p_wants_ack: true })).ackDue).toBe(false)
    // Another sender is unaffected.
    expect((await insert({ p_from_addr: "calm@example.test", p_message_id: "<c1@x>", p_wants_ack: true })).ackDue).toBe(true)
    // Acknowledgements older than 24 hours stop counting.
    await pg.exec(`UPDATE dpdp.mail_inbound SET ack_sent_at = now() - interval '25 hours' WHERE lower(from_addr) = 'flood@example.test' AND ack_sent_at IS NOT NULL`)
    expect((await insert({ p_from_addr: sender, p_message_id: "<f6@x>", p_wants_ack: true })).ackDue).toBe(true)
    expect(first.ticketNo).toBeTruthy()
  })

  test("5e. a global brake: once 30 acknowledgements went to ANYONE in the last hour, ackDue is false and ackLimit is 'hourly' -- the ticket is still created", async () => {
    // Earlier tests left acknowledged rows behind; push them out of the window so this test counts only its own.
    await pg.exec("UPDATE dpdp.mail_inbound SET ack_sent_at = now() - interval '3 hours' WHERE ack_sent_at IS NOT NULL")
    const ackOne = async (n: number) => {
      const t = await insert({ p_from_addr: `hourly${n}@example.test`, p_message_id: `<h${n}@x>`, p_wants_ack: true })
      expect(t.ackDue).toBe(true)
      await rpc("dpdp_mail_mark_ack", { p_ticket_no: t.ticketNo })
    }
    // 29 acknowledgements to 29 different senders: one more is still allowed.
    for (let n = 1; n <= 29; n++) await ackOne(n)
    const at29 = await insert({ p_from_addr: "hourly-n30@example.test", p_message_id: "<h30@x>", p_wants_ack: true })
    expect(at29).toMatchObject({ ackDue: true, ackLimit: null })
    await rpc("dpdp_mail_mark_ack", { p_ticket_no: at29.ticketNo })

    // The 30th is on record: the 31st sender, a stranger with no history, is not to be acknowledged.
    const over = await insert({ p_class: "data_request", p_from_addr: "stranger@example.test", p_message_id: "<h31@x>", p_wants_ack: true, p_due_days: 90 })
    expect(over).toMatchObject({ ackDue: false, ackLimit: "hourly", class: "data_request", duplicate: false, operatorNotified: false })
    // ... but the message is recorded, ticketed, due-dated and open, so the operator can still be told and can answer by hand.
    expect(await inboundRow(over.ticketNo)).toMatchObject({ class: "data_request", status: "open", from_addr: "stranger@example.test", ack_sent_at: null })
    expect((await inboundRow(over.ticketNo)).due_at).toBeTruthy()
    // A retried delivery of the same message is still that one ticket, still held back.
    expect(await insert({ p_class: "data_request", p_from_addr: "stranger@example.test", p_message_id: "<h31@x>", p_wants_ack: true, p_due_days: 90 })).toMatchObject({ ticketNo: over.ticketNo, duplicate: true, ackDue: false, ackLimit: "hourly" })
    // A message that did not ask for an acknowledgement has no limit to report.
    expect(await insert({ p_from_addr: "quiet@example.test", p_message_id: "<h32@x>", p_wants_ack: false })).toMatchObject({ ackDue: false, ackLimit: null })

    // The per-sender limit is reported as such when both hold.
    const flood = "hourly1@example.test"
    for (let i = 0; i < 2; i++) {
      const t = await insert({ p_from_addr: flood, p_message_id: `<again${i}@x>`, p_wants_ack: true })
      await pg.exec(`UPDATE dpdp.mail_inbound SET ack_sent_at = now() WHERE ticket_no = '${t.ticketNo}'`)
    }
    expect((await insert({ p_from_addr: flood, p_message_id: "<again9@x>", p_wants_ack: true })).ackLimit).toBe("sender")

    // Acknowledgements older than an hour stop counting: everything is allowed again.
    await pg.exec("UPDATE dpdp.mail_inbound SET ack_sent_at = now() - interval '61 minutes' WHERE ack_sent_at IS NOT NULL")
    expect(await insert({ p_from_addr: "stranger2@example.test", p_message_id: "<h33@x>", p_wants_ack: true })).toMatchObject({ ackDue: true, ackLimit: null })
    // Exactly at the edge, counted from scratch: 29 acknowledgements inside the window are under the brake, the 30th puts it over.
    await pg.exec("UPDATE dpdp.mail_inbound SET ack_sent_at = NULL")
    await pg.exec("INSERT INTO dpdp.mail_inbound (ticket_no, class, from_addr, ack_sent_at) SELECT 'Z-' || g, 'review', 'bulk' || g || '@example.test', now() - interval '5 minutes' FROM generate_series(1, 29) g")
    expect(await scalar("count(*) from dpdp.mail_inbound where ack_sent_at > now() - interval '1 hour'")).toBe("29")
    expect(await insert({ p_from_addr: "edge1@example.test", p_message_id: "<e1@x>", p_wants_ack: true })).toMatchObject({ ackDue: true, ackLimit: null })
    await pg.exec("INSERT INTO dpdp.mail_inbound (ticket_no, class, from_addr, ack_sent_at) VALUES ('Z-30', 'review', 'bulk30@example.test', now() - interval '59 minutes')")
    expect(await scalar("count(*) from dpdp.mail_inbound where ack_sent_at > now() - interval '1 hour'")).toBe("30")
    expect(await insert({ p_from_addr: "edge2@example.test", p_message_id: "<e2@x>", p_wants_ack: true })).toMatchObject({ ackDue: false, ackLimit: "hourly" })
    await pg.exec("DELETE FROM dpdp.mail_inbound WHERE ticket_no LIKE 'Z-%'")
  })
})

describe("dpdp_mail_close", () => {
  const close = (ticket: string, note?: string | null) => rpc<{ ok: boolean; status?: string; closedAt?: string; alreadyClosed?: boolean }>("dpdp_mail_close", note === undefined ? { p_ticket_no: ticket } : { p_ticket_no: ticket, p_note: note })

  test("5f. closes an open ticket: status closed, closed_at set, note stored -- re-read from the table", async () => {
    const t = await insert({ p_class: "grievance", p_from_addr: "close1@example.test", p_due_days: 90 })
    expect((await inboundRow(t.ticketNo)).status).toBe("open")
    const res = await close(t.ticketNo, "  Answered by phone on 30 Sep.  ")
    expect(res).toMatchObject({ ok: true, status: "closed", alreadyClosed: false })
    expect(res.closedAt).toBeTruthy()
    const row = await inboundRow(t.ticketNo)
    expect(row).toMatchObject({ status: "closed", closed_note: "Answered by phone on 30 Sep." })
    expect(new Date(row.closed_at as string).getTime()).toBe(new Date(res.closedAt as string).getTime())
    // Everything else about the ticket is untouched: the due date, the sender, the class.
    expect(row).toMatchObject({ class: "grievance", from_addr: "close1@example.test" })
    expect(row.due_at).toBeTruthy()
  })

  test("5g. idempotent: a second and third call change nothing (time and note stay the first call's) and say alreadyClosed", async () => {
    const t = await insert({ p_from_addr: "close2@example.test" })
    await close(t.ticketNo, "first note")
    const before = await inboundRow(t.ticketNo)
    await pg.exec("SELECT pg_sleep(0.05)")
    const again = await close(t.ticketNo, "second note")
    const third = await close(t.ticketNo)
    expect(again).toMatchObject({ ok: true, status: "closed", alreadyClosed: true })
    expect(third).toMatchObject({ ok: true, alreadyClosed: true })
    expect(await inboundRow(t.ticketNo)).toEqual(before)
  })

  test("5g2. FIRST CALL WINS: a later call may ADD a note only when none was stored; once a note is stored no later call changes it, and the time never moves", async () => {
    const t = await insert({ p_from_addr: "close2b@example.test" })
    await close(t.ticketNo)
    const first = await inboundRow(t.ticketNo)
    expect(first.closed_note).toBeNull()
    await pg.exec("SELECT pg_sleep(0.05)")
    const blank = await close(t.ticketNo, "   ")
    expect(blank).toMatchObject({ ok: true, alreadyClosed: true })
    expect((await inboundRow(t.ticketNo)).closed_note).toBeNull()
    const added = await close(t.ticketNo, "  Answered by phone.  ")
    expect(added).toMatchObject({ ok: true, alreadyClosed: true })
    const withNote = await inboundRow(t.ticketNo)
    expect(withNote.closed_note).toBe("Answered by phone.")
    expect(new Date(withNote.closed_at as string).getTime()).toBe(new Date(first.closed_at as string).getTime())
    await close(t.ticketNo, "A different note")
    await close(t.ticketNo)
    expect(await inboundRow(t.ticketNo)).toEqual(withNote)
  })

  test("5h. no note, a blank note and a note over 1000 characters: null, null, cut to 1000", async () => {
    const a = await insert({ p_from_addr: "close3@example.test" })
    await close(a.ticketNo)
    expect((await inboundRow(a.ticketNo)).closed_note).toBeNull()
    const b = await insert({ p_from_addr: "close4@example.test" })
    await close(b.ticketNo, "   ")
    expect((await inboundRow(b.ticketNo)).closed_note).toBeNull()
    const c = await insert({ p_from_addr: "close5@example.test" })
    await close(c.ticketNo, "n".repeat(2500))
    expect(((await inboundRow(c.ticketNo)).closed_note as string).length).toBe(1000)
  })

  test("5i. never reopens: a mark_ack, a retried delivery, a second insert and a late close all leave it closed", async () => {
    const t = await insert({ p_class: "data_request", p_from_addr: "close6@example.test", p_message_id: "<close6@x>", p_wants_ack: true })
    await close(t.ticketNo, "done")
    const closedAt = (await inboundRow(t.ticketNo)).closed_at as string
    await rpc("dpdp_mail_mark_ack", { p_ticket_no: t.ticketNo })
    expect((await inboundRow(t.ticketNo)).status).toBe("closed")
    const retry = await insert({ p_class: "data_request", p_from_addr: "close6@example.test", p_message_id: "<close6@x>", p_wants_ack: true })
    expect(retry).toMatchObject({ ticketNo: t.ticketNo, duplicate: true, status: "closed" })
    await rpc("dpdp_mail_mark_notified", { p_ticket_no: t.ticketNo })
    const row = await inboundRow(t.ticketNo)
    expect(row.status).toBe("closed")
    expect(new Date(row.closed_at as string).getTime()).toBe(new Date(closedAt).getTime())
  })

  test("5j. a ticket closed by hand (status set, no time) gets its time filled in; an unknown ticket answers ok:false and writes nothing", async () => {
    const t = await insert({ p_from_addr: "close7@example.test" })
    await pg.exec(`UPDATE dpdp.mail_inbound SET status = 'closed' WHERE ticket_no = '${t.ticketNo}'`)
    expect((await inboundRow(t.ticketNo)).closed_at).toBeNull()
    expect(await close(t.ticketNo, "by hand")).toMatchObject({ ok: true, alreadyClosed: true })
    const row = await inboundRow(t.ticketNo)
    expect(row.closed_at).toBeTruthy()
    expect(row.closed_note).toBe("by hand")

    const before = await scalar("count(*) from dpdp.mail_inbound where status = 'closed'")
    expect(await close("G-1999-0001", "x")).toEqual({ ok: false })
    expect(await close("", "x")).toEqual({ ok: false })
    expect(await scalar("count(*) from dpdp.mail_inbound where status = 'closed'")).toBe(before)
  })

  test("5k. only service_role may call it: anon, authenticated and app_runtime are refused and the ticket stays open", async () => {
    const t = await insert({ p_from_addr: "close8@example.test" })
    for (const role of ["anon", "authenticated", "app_runtime"]) {
      const e = await rpcError("dpdp_mail_close", { p_ticket_no: t.ticketNo, p_note: "hijack" }, role)
      expect(e.message).toContain("permission denied for function")
    }
    expect(await inboundRow(t.ticketNo)).toMatchObject({ status: "open", closed_at: null, closed_note: null })
  })
})

describe("dpdp_mail_log_outbound and dpdp_mail_lookup_outbound", () => {
  test("6a. a logged message is stored with normalised ids; a second call fills the provider id and changes nothing else", async () => {
    const r = ref()
    const first = await rpc<{ id: string; ref: string; class: string }>("dpdp_mail_log_outbound", {
      p_ref: r, p_class: "grievance", p_to_addr: "  Person@Example.Test ", p_subject: "We received your message", p_org_id: "org-1", p_membership_id: "mem-1", p_ticket_no: "G-2032-0001",
    })
    expect(first).toMatchObject({ ref: r, class: "grievance" })
    let row = await outboundRow(r)
    expect(row).toMatchObject({ ref: r, class: "grievance", to_addr: "Person@Example.Test", subject: "We received your message", org_id: "org-1", membership_id: "mem-1", ticket_no: "G-2032-0001", provider_message_id: null, message_id_header: null })
    expect(row.sent_at).toBeTruthy()

    const second = await rpc<{ id: string }>("dpdp_mail_log_outbound", { p_ref: r, p_class: "grievance", p_to_addr: "Person@Example.Test", p_provider_message_id: " <ABC-123-Def> ", p_message_id_header: "<Header.ID@Mail.Example>" })
    expect(second.id).toBe(first.id)
    row = await outboundRow(r)
    expect(row).toMatchObject({ provider_message_id: "abc-123-def", message_id_header: "header.id@mail.example", subject: "We received your message", ticket_no: "G-2032-0001", org_id: "org-1" })
    expect(await scalar(`count(*) from dpdp.mail_outbound where ref = '${r}'`)).toBe("1")

    // A later call with no ids must not erase the ones already stored.
    await rpc("dpdp_mail_log_outbound", { p_ref: r, p_class: "grievance", p_to_addr: "Person@Example.Test" })
    expect(await outboundRow(r)).toMatchObject({ provider_message_id: "abc-123-def", message_id_header: "header.id@mail.example" })
  })

  test("6b. a ref reused for a different class or a different recipient is refused and the row is unchanged", async () => {
    const r = ref()
    await rpc("dpdp_mail_log_outbound", { p_ref: r, p_class: "invoice", p_to_addr: "one@example.test", p_provider_message_id: "orig-id" })
    for (const args of [
      { p_ref: r, p_class: "monday", p_to_addr: "one@example.test", p_provider_message_id: "hijack" },
      { p_ref: r, p_class: "invoice", p_to_addr: "two@example.test", p_provider_message_id: "hijack" },
    ]) {
      const e = await rpcError("dpdp_mail_log_outbound", args)
      expect(e.code).toBe("23505")
      expect(e.message).toContain("already used by a different message")
    }
    expect(await outboundRow(r)).toMatchObject({ class: "invoice", to_addr: "one@example.test", provider_message_id: "orig-id" })
  })

  test("6a2. the statutory-notice class is a valid outbound class and round-trips through the lookup", async () => {
    const r = ref()
    await rpc("dpdp_mail_log_outbound", { p_ref: r, p_class: "clock", p_to_addr: "owner@example.test", p_subject: "[VERIDIAN DPDP · Statutory] 72-hour clock", p_provider_message_id: "prov-clk-1" })
    expect(await outboundRow(r)).toMatchObject({ class: "clock", to_addr: "owner@example.test" })
    expect(await rpc("dpdp_mail_lookup_outbound", { p_ref: r })).toMatchObject({ ref: r, class: "clock", matchedBy: "ref" })
    expect(await rpc("dpdp_mail_lookup_outbound", { p_message_ids: ["prov-clk-1"] })).toMatchObject({ ref: r, class: "clock", matchedBy: "message_id" })
  })

  test("6c. a bad ref, an unknown class or an empty recipient is refused", async () => {
    for (const args of [
      { p_ref: "short", p_class: "monday", p_to_addr: "a@b.test" },
      { p_ref: "K3F9X2AB7Q", p_class: "monday", p_to_addr: "a@b.test" },
      { p_ref: null, p_class: "monday", p_to_addr: "a@b.test" },
      { p_ref: ref(), p_class: "spam", p_to_addr: "a@b.test" },
      { p_ref: ref(), p_class: null, p_to_addr: "a@b.test" },
      { p_ref: ref(), p_class: "monday", p_to_addr: "   " },
      { p_ref: ref(), p_class: "monday", p_to_addr: null },
    ]) {
      expect((await rpcError("dpdp_mail_log_outbound", args)).code).toBe("22023")
    }
  })

  test("6d. lookup finds a row by ref, by provider id and by header id, and reports how", async () => {
    const r = ref()
    await rpc("dpdp_mail_log_outbound", { p_ref: r, p_class: "sales", p_to_addr: "lead@example.test", p_provider_message_id: "Provider-ID-1", p_message_id_header: "<Hdr-1@veridian-aios.com>", p_org_id: "org-9", p_membership_id: "mem-9", p_ticket_no: "S-2032-0003" })
    const byRef = await rpc<Record<string, unknown>>("dpdp_mail_lookup_outbound", { p_ref: r })
    expect(byRef).toMatchObject({ ref: r, class: "sales", ticketNo: "S-2032-0003", orgId: "org-9", membershipId: "mem-9", matchedBy: "ref" })
    expect(byRef!.sentAt).toBeTruthy()
    expect(await rpc("dpdp_mail_lookup_outbound", { p_message_ids: ["provider-id-1"] })).toMatchObject({ ref: r, matchedBy: "message_id" })
    expect(await rpc("dpdp_mail_lookup_outbound", { p_message_ids: ["nope", "hdr-1@veridian-aios.com"] })).toMatchObject({ ref: r, matchedBy: "message_id" })
    // The caller normalises: the un-normalised spelling is a miss, by design.
    expect(await rpc("dpdp_mail_lookup_outbound", { p_message_ids: ["Provider-ID-1"] })).toBeNull()
  })

  test("6e. the ref beats a message-id match; among message-id matches the newest wins; nothing matching is null, never a guess", async () => {
    const older = ref()
    const newer = ref()
    const mine = ref()
    await rpc("dpdp_mail_log_outbound", { p_ref: older, p_class: "invoice", p_to_addr: "a@example.test", p_provider_message_id: "shared-thread-id" })
    await pg.exec(`UPDATE dpdp.mail_outbound SET sent_at = now() - interval '1 day' WHERE ref = '${older}'`)
    await rpc("dpdp_mail_log_outbound", { p_ref: newer, p_class: "monday", p_to_addr: "a@example.test", p_provider_message_id: "shared-thread-id" })
    await rpc("dpdp_mail_log_outbound", { p_ref: mine, p_class: "support", p_to_addr: "b@example.test" })

    expect(await rpc("dpdp_mail_lookup_outbound", { p_message_ids: ["shared-thread-id"] })).toMatchObject({ ref: newer, class: "monday" })
    expect(await rpc("dpdp_mail_lookup_outbound", { p_ref: mine, p_message_ids: ["shared-thread-id"] })).toMatchObject({ ref: mine, class: "support", matchedBy: "ref" })
    expect(await rpc("dpdp_mail_lookup_outbound", { p_ref: ref() })).toBeNull()
    expect(await rpc("dpdp_mail_lookup_outbound", { p_message_ids: [] })).toBeNull()
    expect(await rpc("dpdp_mail_lookup_outbound", {})).toBeNull()
    expect(await rpc("dpdp_mail_lookup_outbound", { p_ref: null, p_message_ids: null })).toBeNull()
    expect(await rpc("dpdp_mail_lookup_outbound", { p_message_ids: ["unknown-1", "unknown-2"] })).toBeNull()
  })
})

describe("the file as a migration", () => {
  test("7a. running 0662 a second time changes nothing (tables, rows, policies, function definitions)", async () => {
    const snap = async () =>
      JSON.stringify({
        counts: await rows("select (select count(*) from dpdp.mail_inbound) i, (select count(*) from dpdp.mail_outbound) o, (select count(*) from dpdp.mail_ticket_counter) c"),
        policies: await rows("select tablename, policyname from pg_policies where schemaname = 'dpdp' order by 1, 2"),
        fns: await rows("select p.proname, md5(pg_get_functiondef(p.oid)) h, p.proacl::text acl from pg_proc p join pg_namespace n on n.oid = p.pronamespace where p.proname like 'dpdp_mail_%' or p.proname = 'mail_next_ticket' order by 1"),
        cols: await rows("select table_name, column_name, data_type from information_schema.columns where table_schema = 'dpdp' order by 1, ordinal_position"),
      })
    const before = await snap()
    await pg.exec(FORWARD)
    expect(await snap()).toBe(before)
  })

  test("7b. the journal registers it, after every earlier entry, with the next idx", async () => {
    const journal = JSON.parse(read("drizzle/meta/_journal.json")) as { entries: Array<{ idx: number; when: number; tag: string }> }
    const mine = journal.entries.filter((e) => e.tag === TAG)
    expect(mine).toHaveLength(1)
    // "earlier" = every entry numbered below this one; a later migration (0663 ...) is allowed to follow it.
    const others = journal.entries.filter((e) => e.tag !== TAG && e.tag < TAG)
    expect(mine[0].when).toBeGreaterThan(Math.max(...others.map((e) => e.when)))
    expect(mine[0].idx).toBe(Math.max(...others.map((e) => e.idx)) + 1)
    expect(journal.entries.filter((e) => e.tag.startsWith("0662_"))).toHaveLength(1)
  })

  test("7c. the destructive-DDL citation (GRANT / REVOKE / SECURITY DEFINER) is present and valid", () => {
    expect(findValidCitation(FORWARD)).not.toBeNull()
  })
})
