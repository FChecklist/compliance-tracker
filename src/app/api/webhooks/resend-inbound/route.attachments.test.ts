/// <reference types="bun-types" />
// PROJEXA-BUILD-001 U-31, register row BR-413: the Resend inbound webhook reads attachments. A Svix-signed
// `email.received` delivery with 1 .xlsx attachment stores 1 row in compliance.inbound_email_attachments, linked to the
// inbound_email_messages row, counted by re-reading the database.
//
// WHAT IS REAL: the route (signature check, idempotency, alias resolution order, insert), src/lib/webhooks/
// resend-inbound-attachments.ts, drizzle's query builder and the schema.ts declarations, and the database: PGlite (real
// Postgres as WASM) built from the committed live snapshot scripts/verify/fixtures/0620_build001_inbound_email_attachments
// .base.sql plus drizzle/0620 itself, so the foreign key, the ON DELETE CASCADE and the 10 MB CHECK are the real ones.
// WHAT IS FAKED, and nothing else: the `resend` SDK (receiving.get and receiving.attachments.list answer fixtures),
// globalThis.fetch (it serves only the fixture's signed download URL and throws for any other URL, so no test can reach
// the network), the alias lookup, analyzeInboundEmail (it would call a model), db.query.users (the users table is not
// in this snapshot) and, from BUILD-002 WP-12, prepareEmailProposals() (it has its own test, email-attachment-intake.test.ts;
// here only what the route hands it is recorded). The sender check is REAL: compliance.users is added to the PGlite database with the
// five columns it reads, holding the fixture sender. No real key or secret is used: the Svix secret below is a test value.
//
// Run: bun test --isolate src/app/api/webhooks/resend-inbound/route.attachments.test.ts
import { afterAll, beforeAll, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import { createHmac } from "node:crypto"
import { readFileSync } from "node:fs"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"

process.env.DATABASE_URL ??= "postgresql://postgres:placeholder@localhost:5432/postgres"
process.env.APP_RUNTIME_DATABASE_URL ??= "postgresql://app_runtime:placeholder@localhost:5432/postgres"

import * as realDb from "@/lib/db"
import * as schema from "@/lib/db/schema"

const REPO_ROOT = new URL("../../../../../", import.meta.url)
const read = (p: string) => readFileSync(new URL(p, REPO_ROOT), "utf8")

// Built at run time from a plain phrase, so that no key-shaped literal sits in the file (the secret scanner flags one).
const SECRET = "whsec_" + Buffer.from("attachments-test-webhook-signing-phrase").toString("base64")
const ORG = "org-1"
const USER = "user-1"
const ALIAS = "asha@mail.veridian-aios.com"
const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
const DOWNLOAD_HOST = "https://attachments.resend.test/"
const MARKER = "U31-CELL-MARKER-7f3a9"
// An .xlsx is a zip: it starts with PK\x03\x04. The rest is filler carrying a marker the log checks look for.
const XLSX_BYTES = new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...Buffer.from(`${MARKER} `.repeat(64)), ...Array.from({ length: 512 }, (_, i) => (i * 37) % 256)])

// ─── the database ──────────────────────────────────────────────────────────
const pglite = await PGlite.create()
await pglite.exec(`
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE ROLE authenticator NOLOGIN; CREATE ROLE app_runtime NOLOGIN;
`)
await pglite.exec(read("scripts/verify/fixtures/0620_build001_inbound_email_attachments.base.sql"))
await pglite.exec(read("drizzle/0620_build001_inbound_email_attachments.sql"))
// WP-12: the table the sender check reads (see the header). The fixture sender is a member of ORG; the others are for the refusal tests.
await pglite.exec(`
CREATE TABLE compliance.users (id text PRIMARY KEY, email text NOT NULL, role text NOT NULL, org_id text, is_active boolean NOT NULL DEFAULT true);
INSERT INTO compliance.users (id, email, role, org_id) VALUES ('user-site', 'site@vendor.test', 'member', 'org-1');
INSERT INTO compliance.users (id, email, role, org_id) VALUES ('user-other-org', 'other@vendor.test', 'admin', 'org-2');
`)
const pgDb = drizzle(pglite, { schema })

const FIXTURE_USER = { id: USER, name: "Asha M", email: "asha@example.test", role: "manager" }
// The route's db client, with the real query builders over PGlite. db.query.users answers the fixture person.
const testDb = {
  query: {
    inboundEmailMessages: pgDb.query.inboundEmailMessages,
    users: { findFirst: async () => FIXTURE_USER },
  },
  select: pgDb.select.bind(pgDb),
  insert: pgDb.insert.bind(pgDb),
  update: pgDb.update.bind(pgDb),
}

async function count(sql: string, params: unknown[] = []): Promise<number> {
  return (await pglite.query<{ n: number }>(sql, params)).rows[0].n
}
async function messageRow(emailId: string) {
  return (
    await pglite.query<{ id: string; org_id: string | null; processing_error: string | null; processed_at: Date | null }>(
      "select id, org_id, processing_error, processed_at from compliance.inbound_email_messages where resend_message_id = $1",
      [emailId]
    )
  ).rows
}
async function attachmentsOf(messageId: string) {
  return (
    await pglite.query<{ org_id: string; file_name: string; content_type: string | null; size_bytes: number; content: Uint8Array; resend_attachment_id: string | null }>(
      "select org_id, file_name, content_type, size_bytes, content, resend_attachment_id from compliance.inbound_email_attachments where inbound_message_id = $1 order by file_name",
      [messageId]
    )
  ).rows
}

// ─── Resend, fetch, alias, analysis ────────────────────────────────────────
type ListedAttachment = { id: string; filename?: string; size: number; content_type: string; content_disposition: "attachment" | "inline"; download_url: string; expires_at: string }
function listed(overrides: Partial<ListedAttachment> = {}): ListedAttachment {
  return {
    id: "att_1",
    filename: "BOQ-Villa21.xlsx",
    size: XLSX_BYTES.byteLength,
    content_type: XLSX_TYPE,
    content_disposition: "attachment",
    download_url: `${DOWNLOAD_HOST}signed/att_1?token=test`,
    expires_at: "2026-09-25T13:00:00.000Z",
    ...overrides,
  }
}

let listResult: { data: { object: "list"; has_more: boolean; data: ListedAttachment[] } | null; error: { message: string } | null }
let listCalls: string[] = []
let receivingGetResult: { data: Record<string, unknown> | null; error: { message: string } | null }
let downloads: string[] = []
let downloadResponse: (url: string) => Response
let resolveEmailAliasResult: { orgId: string; userId: string; aliasId: string } | null
let analyzeCalls = 0
let intakeCalls: Array<{ orgId: string; person: { id: string }; inboundMessageId: string }> = []

mock.module("@/lib/db", () => ({ ...realDb, db: testDb }))
mock.module("resend", () => ({
  Resend: class {
    emails = {
      receiving: {
        get: async (_id: string) => receivingGetResult,
        attachments: {
          list: async (opts: { emailId: string }) => {
            listCalls.push(opts.emailId)
            return listResult
          },
        },
      },
    }
  },
}))
mock.module("@/lib/services/email-alias-service", () => ({ resolveEmailAlias: async () => resolveEmailAliasResult }))
mock.module("@/lib/services/email-intelligence-service", () => ({
  analyzeInboundEmail: async () => {
    analyzeCalls++
    return { id: "item-1" }
  },
}))

mock.module("@/lib/services/email-attachment-intake", () => ({
  prepareEmailProposals: async (args: { orgId: string; person: { id: string }; inboundMessageId: string }) => {
    intakeCalls.push(args)
    return { outcomes: [], notes: [] }
  },
}))

const realFetch = globalThis.fetch
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
  if (!url.startsWith(DOWNLOAD_HOST)) throw new Error(`network access refused in this test: ${url}`)
  downloads.push(url)
  return downloadResponse(url)
}) as typeof fetch

const { POST } = await import("./route")
const { storeInboundEmailAttachments, MAX_ATTACHMENT_BYTES } = await import("@/lib/webhooks/resend-inbound-attachments")

// ─── Svix signing (the algorithm resend-svix-signature.ts implements) ──────
function sign(id: string, timestamp: string, body: string, secret = SECRET): string {
  const secretBytes = Buffer.from(secret.replace(/^whsec_/, ""), "base64")
  return `v1,${createHmac("sha256", secretBytes).update(`${id}.${timestamp}.${body}`).digest("base64")}`
}
function signedRequest(body: string, secret = SECRET): Request {
  const svixId = "msg_test"
  const svixTimestamp = String(Math.floor(Date.now() / 1000))
  return new Request("http://localhost/api/webhooks/resend-inbound", {
    method: "POST",
    headers: { "content-type": "application/json", "svix-id": svixId, "svix-timestamp": svixTimestamp, "svix-signature": sign(svixId, svixTimestamp, body, secret) },
    body,
  })
}
/** A Resend `email.received` event: metadata only, one attachment listed by id and name. */
function receivedEvent(emailId: string, attachments: Array<{ id: string; filename: string }> = [{ id: "att_1", filename: "BOQ-Villa21.xlsx" }]): string {
  return JSON.stringify({
    type: "email.received",
    created_at: "2026-09-25T10:00:00.000Z",
    data: {
      email_id: emailId,
      created_at: "2026-09-25T10:00:00.000Z",
      from: "site@vendor.test",
      to: [ALIAS],
      subject: "BOQ for Villa 21",
      attachments: attachments.map((a) => ({ ...a, content_type: XLSX_TYPE, content_disposition: "attachment", content_id: null })),
    },
  })
}

let logged: string[] = []
let spies: Array<{ mockRestore: () => void }> = []
beforeEach(async () => {
  await pglite.exec("DELETE FROM compliance.inbound_email_messages")
  process.env.RESEND_WEBHOOK_SECRET = SECRET
  process.env.RESEND_API_KEY = "re_test_placeholder"
  listResult = { data: { object: "list", has_more: false, data: [listed()] }, error: null }
  listCalls = []
  receivingGetResult = {
    data: { from: "site@vendor.test", to: [ALIAS], subject: "BOQ for Villa 21", text: "Please find the BOQ attached.", html: null, attachments: [{ id: "att_1", filename: "BOQ-Villa21.xlsx", size: XLSX_BYTES.byteLength, content_type: XLSX_TYPE }] },
    error: null,
  }
  downloads = []
  downloadResponse = () => new Response(XLSX_BYTES, { status: 200, headers: { "content-type": XLSX_TYPE } })
  resolveEmailAliasResult = { orgId: ORG, userId: USER, aliasId: "alias-1" }
  analyzeCalls = 0
  intakeCalls = []
  logged = []
  spies = (["log", "info", "warn", "error"] as const).map((level) =>
    spyOn(console, level).mockImplementation((...args: unknown[]) => {
      logged.push(args.map((a) => (a instanceof Error ? `${a.name}: ${a.message}` : typeof a === "string" ? a : JSON.stringify(a))).join(" "))
    })
  )
})

afterAll(async () => {
  for (const s of spies) s.mockRestore()
  globalThis.fetch = realFetch
  await pglite.close()
})

function restoreLogs() {
  for (const s of spies) s.mockRestore()
  spies = []
}

describe("BR-413: a Svix-signed email.received with 1 .xlsx attachment stores 1 attachment linked to its message", () => {
  test("*** THE ROW: 1 attachment row, re-read from the database, linked to the inbound message row, bytes as sent ***", async () => {
    const res = await POST(signedRequest(receivedEvent("email_xlsx_1")) as never)
    restoreLogs()

    expect(res.status).toBe(200)
    const json = (await res.json()) as { ok: boolean; id: string; processed: boolean }
    expect(json).toMatchObject({ ok: true, processed: true })

    const [message] = await messageRow("email_xlsx_1")
    expect(message.id).toBe(json.id)
    expect(message.org_id).toBe(ORG)
    expect(message.processing_error).toBeNull()
    expect(message.processed_at).not.toBeNull()

    // Counted by re-reading the database.
    expect(await count("select count(*)::int n from compliance.inbound_email_attachments where inbound_message_id = $1", [message.id])).toBe(1)
    expect(await count("select count(*)::int n from compliance.inbound_email_attachments")).toBe(1)
    const [row] = await attachmentsOf(message.id)
    expect(row.org_id).toBe(ORG)
    expect(row.file_name).toBe("BOQ-Villa21.xlsx")
    expect(row.content_type).toBe(XLSX_TYPE)
    expect(row.size_bytes).toBe(XLSX_BYTES.byteLength)
    expect(row.resend_attachment_id).toBe("att_1")
    expect(Buffer.from(row.content).equals(Buffer.from(XLSX_BYTES))).toBe(true)

    // Read through Resend's attachments API once, and the file downloaded once from its signed URL.
    expect(listCalls).toEqual(["email_xlsx_1"])
    expect(downloads).toEqual([`${DOWNLOAD_HOST}signed/att_1?token=test`])
    // The message was still analysed as before.
    expect(analyzeCalls).toBe(1)
  })

  test("the same delivery twice stores the attachment once: the second is acknowledged as already processed", async () => {
    const body = receivedEvent("email_twice")
    const first = (await (await POST(signedRequest(body) as never)).json()) as { id: string }
    const second = await POST(signedRequest(body) as never)
    restoreLogs()

    expect(second.status).toBe(200)
    expect(await second.json()).toEqual({ ok: true, alreadyProcessed: true, id: first.id })
    expect(await count("select count(*)::int n from compliance.inbound_email_messages where resend_message_id = 'email_twice'")).toBe(1)
    expect(await count("select count(*)::int n from compliance.inbound_email_attachments where inbound_message_id = $1", [first.id])).toBe(1)
    expect(listCalls).toHaveLength(1)
    expect(downloads).toHaveLength(1)
  })

  test("a wrongly signed delivery: 403, and no message, no attachment, no call to Resend's attachments API, no download", async () => {
    const res = await POST(signedRequest(receivedEvent("email_forged"), "whsec_" + Buffer.from("not-the-secret").toString("base64")) as never)
    restoreLogs()

    expect(res.status).toBe(403)
    expect(await count("select count(*)::int n from compliance.inbound_email_messages")).toBe(0)
    expect(await count("select count(*)::int n from compliance.inbound_email_attachments")).toBe(0)
    expect(listCalls).toEqual([])
    expect(downloads).toEqual([])
  })

  test("an unresolved recipient: the message is kept with no organisation, and its attachments are not read", async () => {
    resolveEmailAliasResult = null
    const res = await POST(signedRequest(receivedEvent("email_unresolved")) as never)
    restoreLogs()

    expect(res.status).toBe(200)
    const [message] = await messageRow("email_unresolved")
    expect(message.org_id).toBeNull()
    expect(await count("select count(*)::int n from compliance.inbound_email_attachments")).toBe(0)
    expect(listCalls).toEqual([])
    expect(downloads).toEqual([])
  })

  test("an email with no attachment makes no attachment call and stores none", async () => {
    receivingGetResult = { data: { ...receivingGetResult.data!, attachments: [] }, error: null }
    const res = await POST(signedRequest(receivedEvent("email_plain", [])) as never)
    restoreLogs()

    expect(res.status).toBe(200)
    expect(listCalls).toEqual([])
    expect(await count("select count(*)::int n from compliance.inbound_email_attachments")).toBe(0)
    expect((await messageRow("email_plain"))[0].processing_error).toBeNull()
  })
})

describe("BR-413: the 10 MB cap -- an oversize attachment is skipped and recorded, never truncated, and the webhook still answers 200", () => {
  test("declared over 10 MB: not downloaded, not stored, named in processing_error; the message is kept and processed", async () => {
    listResult = { data: { object: "list", has_more: false, data: [listed({ size: MAX_ATTACHMENT_BYTES + 1 })] }, error: null }
    const res = await POST(signedRequest(receivedEvent("email_big_declared")) as never)
    restoreLogs()

    expect(res.status).toBe(200)
    expect(((await res.json()) as { processed: boolean }).processed).toBe(true)
    const [message] = await messageRow("email_big_declared")
    expect(message.processing_error).toContain('"BOQ-Villa21.xlsx"')
    expect(message.processing_error).toContain("10485760")
    expect(downloads).toEqual([])
    expect(await count("select count(*)::int n from compliance.inbound_email_attachments")).toBe(0)
  })

  test("declared small but the download runs past 10 MB: reading stops, nothing is stored (no truncated prefix)", async () => {
    listResult = { data: { object: "list", has_more: false, data: [listed({ size: 1024 })] }, error: null }
    const chunk = new Uint8Array(1024 * 1024).fill(0x41)
    let sent = 0
    downloadResponse = () =>
      new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            // 11 chunks of 1 MiB = 11534336 bytes, over 10485760.
            if (sent++ < 11) controller.enqueue(chunk)
            else controller.close()
          },
        }),
        { status: 200 }
      )
    const res = await POST(signedRequest(receivedEvent("email_big_streamed")) as never)
    restoreLogs()

    expect(res.status).toBe(200)
    const [message] = await messageRow("email_big_streamed")
    expect(message.processing_error).toContain('attachment "BOQ-Villa21.xlsx" not stored: over the 10485760-byte limit')
    expect(await count("select count(*)::int n from compliance.inbound_email_attachments")).toBe(0)
    // It stopped reading once over the cap rather than draining the whole body.
    expect(sent).toBeLessThanOrEqual(12)
  })

  test("exactly 10485760 bytes is stored whole", async () => {
    const exact = new Uint8Array(MAX_ATTACHMENT_BYTES).fill(0x42)
    listResult = { data: { object: "list", has_more: false, data: [listed({ size: exact.byteLength })] }, error: null }
    downloadResponse = () => new Response(exact, { status: 200 })
    const res = await POST(signedRequest(receivedEvent("email_exact")) as never)
    restoreLogs()

    expect(res.status).toBe(200)
    const [message] = await messageRow("email_exact")
    expect(message.processing_error).toBeNull()
    expect(await count("select count(*)::int n from compliance.inbound_email_attachments where size_bytes = 10485760 and octet_length(content) = 10485760")).toBe(1)
  })
})

describe("BR-413: a failure to read an attachment never loses the message", () => {
  test("the download answers 500: the message is kept and processed, 0 attachments, processing_error names the file and the status", async () => {
    downloadResponse = () => new Response("upstream error", { status: 500 })
    const res = await POST(signedRequest(receivedEvent("email_dl_fail")) as never)
    restoreLogs()

    expect(res.status).toBe(200)
    const [message] = await messageRow("email_dl_fail")
    expect(message.processed_at).not.toBeNull()
    expect(message.processing_error).toBe('attachment "BOQ-Villa21.xlsx" not stored: download answered HTTP 500')
    expect(await count("select count(*)::int n from compliance.inbound_email_attachments")).toBe(0)
  })

  test("the attachment listing fails: the message is kept, 0 attachments, and the listing error is recorded", async () => {
    listResult = { data: null, error: { message: "rate_limit_exceeded" } }
    const res = await POST(signedRequest(receivedEvent("email_list_fail")) as never)
    restoreLogs()

    expect(res.status).toBe(200)
    const [message] = await messageRow("email_list_fail")
    expect(message.processing_error).toBe("attachments could not be listed: rate_limit_exceeded")
    expect(await count("select count(*)::int n from compliance.inbound_email_attachments")).toBe(0)
  })

  test("the insert is refused by the database: the message is kept, the note carries the SQLSTATE, and no log line or note carries the file", async () => {
    // A temporary constraint makes Postgres refuse this one insert. drizzle's error for it quotes every bound
    // parameter, the file bytes included, which is exactly what must not reach a note or a log line.
    await pglite.exec("ALTER TABLE compliance.inbound_email_attachments ADD CONSTRAINT t_refuse_one CHECK (resend_attachment_id IS DISTINCT FROM 'att_refused')")
    try {
      listResult = { data: { object: "list", has_more: false, data: [listed({ id: "att_refused" })] }, error: null }
      const res = await POST(signedRequest(receivedEvent("email_insert_fail")) as never)
      restoreLogs()

      expect(res.status).toBe(200)
      const [message] = await messageRow("email_insert_fail")
      expect(message.processing_error).toBe('attachment "BOQ-Villa21.xlsx" not stored (SQLSTATE 23514)')
      expect(await count("select count(*)::int n from compliance.inbound_email_attachments")).toBe(0)

      const forms = [MARKER, Buffer.from(XLSX_BYTES).toString("base64").slice(0, 40), Buffer.from(XLSX_BYTES).toString("hex").slice(0, 40), Array.from(XLSX_BYTES.slice(0, 24)).join(",")]
      for (const text of [...logged, message.processing_error ?? ""]) {
        for (const form of forms) expect(text.includes(form)).toBe(false)
      }
      expect(logged.length).toBeGreaterThan(0)
    } finally {
      await pglite.exec("ALTER TABLE compliance.inbound_email_attachments DROP CONSTRAINT t_refuse_one")
    }
  })

  test("a stored attachment's bytes never appear in a log line either", async () => {
    await POST(signedRequest(receivedEvent("email_log_check")) as never)
    restoreLogs()

    expect(await count("select count(*)::int n from compliance.inbound_email_attachments")).toBe(1)
    expect(logged.some((l) => l.includes("1 attachment(s) stored"))).toBe(true)
    for (const line of logged) expect(line.includes(MARKER)).toBe(false)
  })
})

describe("BR-413: what is stored for each attachment", () => {
  test("a file name with a directory part is stored as its base name; the content type as Resend gave it", async () => {
    listResult = {
      data: {
        object: "list",
        has_more: false,
        data: [
          listed({ id: "att_win", filename: "..\\..\\Users\\site\\BOQ Villa 21.xlsx", download_url: `${DOWNLOAD_HOST}signed/att_win` }),
          listed({ id: "att_nix", filename: "/etc/../reports/Progress.pdf", content_type: "application/pdf", download_url: `${DOWNLOAD_HOST}signed/att_nix` }),
        ],
      },
      error: null,
    }
    const res = await POST(signedRequest(receivedEvent("email_paths")) as never)
    restoreLogs()

    const { id } = (await res.json()) as { id: string }
    const rows = await attachmentsOf(id)
    expect(rows.map((r) => [r.file_name, r.content_type, r.resend_attachment_id])).toEqual([
      ["BOQ Villa 21.xlsx", XLSX_TYPE, "att_win"],
      ["Progress.pdf", "application/pdf", "att_nix"],
    ])
  })

  test("storeInboundEmailAttachments is idempotent per (message, Resend attachment id): a second run downloads and stores nothing", async () => {
    restoreLogs()
    await pglite.exec(`INSERT INTO compliance.inbound_email_messages (id, org_id, user_id, from_address, to_address, resend_message_id, received_at)
      VALUES ('msg-direct', '${ORG}', '${USER}', 'site@vendor.test', '${ALIAS}', 'email_direct', now())`)
    const args = {
      db: testDb as never,
      attachmentsApi: { list: async () => listResult } as never,
      emailId: "email_direct",
      orgId: ORG,
      inboundMessageId: "msg-direct",
    }

    expect(await storeInboundEmailAttachments(args)).toEqual({ stored: 1, alreadyStored: 0, notes: [] })
    expect(await storeInboundEmailAttachments(args)).toEqual({ stored: 0, alreadyStored: 1, notes: [] })

    expect(await count("select count(*)::int n from compliance.inbound_email_attachments where inbound_message_id = 'msg-direct'")).toBe(1)
    expect(downloads).toHaveLength(1)
  })
})

describe("BUILD-002 WP-12 (AW-604): the sender is checked before anything is downloaded, stored, read or analysed", () => {
  test("*** a known member's email: the attachment is stored, then the intake is handed the organisation, the person and the message ***", async () => {
    const res = await POST(signedRequest(receivedEvent("email_known_sender")) as never)
    restoreLogs()
    expect(res.status).toBe(200)
    const { id } = (await res.json()) as { id: string }
    expect(await count("select count(*)::int n from compliance.inbound_email_attachments where inbound_message_id = $1", [id])).toBe(1)
    // The intake runs after the answer; give the detached call a turn.
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(intakeCalls).toEqual([{ orgId: ORG, person: { id: "user-site" }, inboundMessageId: id }])
    expect(analyzeCalls).toBe(1)
  })

  test("*** an unknown sender: refused and recorded; 0 attachment calls, 0 downloads, 0 rows stored, no analysis, no intake ***", async () => {
    receivingGetResult = { data: { ...receivingGetResult.data!, from: "stranger@nowhere.test" }, error: null }
    const res = await POST(signedRequest(receivedEvent("email_unknown_sender")) as never)
    restoreLogs()

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, processed: false, refused: "sender_not_a_user_of_this_organisation" })
    const [message] = await messageRow("email_unknown_sender")
    expect(message.org_id).toBe(ORG)
    expect(message.processing_error).toBe("message refused: stranger@nowhere.test is not an active person of this organisation")
    expect(message.processed_at).toBeNull()
    expect(listCalls).toEqual([])
    expect(downloads).toEqual([])
    expect(await count("select count(*)::int n from compliance.inbound_email_attachments")).toBe(0)
    expect(analyzeCalls).toBe(0)
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(intakeCalls).toEqual([])
  })

  test("a person of another organisation writing to this organisation's address is refused the same way", async () => {
    receivingGetResult = { data: { ...receivingGetResult.data!, from: "Other <other@vendor.test>" }, error: null }
    const res = await POST(signedRequest(receivedEvent("email_other_org")) as never)
    restoreLogs()
    expect(await res.json()).toMatchObject({ processed: false, refused: "sender_not_a_user_of_this_organisation" })
    expect(listCalls).toEqual([])
    expect(await count("select count(*)::int n from compliance.inbound_email_attachments")).toBe(0)
    expect(intakeCalls).toEqual([])
  })

  test("a known sender whose message failed the receiving server's DKIM check is refused before any attachment is read", async () => {
    receivingGetResult = { data: { ...receivingGetResult.data!, headers: { "Authentication-Results": "mx.resend.test; dkim=fail" } }, error: null }
    const res = await POST(signedRequest(receivedEvent("email_dkim_fail")) as never)
    restoreLogs()
    expect(await res.json()).toMatchObject({ processed: false, refused: "sender_authentication_failed" })
    const [message] = await messageRow("email_dkim_fail")
    expect(message.processing_error).toContain("failed SPF, DKIM or DMARC")
    expect(listCalls).toEqual([])
    expect(downloads).toEqual([])
    expect(await count("select count(*)::int n from compliance.inbound_email_attachments")).toBe(0)
    expect(analyzeCalls).toBe(0)
    expect(intakeCalls).toEqual([])
  })

  test("a known sender's email with no attachment does not start the intake", async () => {
    receivingGetResult = { data: { ...receivingGetResult.data!, attachments: [] }, error: null }
    const res = await POST(signedRequest(receivedEvent("email_known_plain", [])) as never)
    restoreLogs()
    expect(res.status).toBe(200)
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(intakeCalls).toEqual([])
    expect(analyzeCalls).toBe(1)
  })
})
