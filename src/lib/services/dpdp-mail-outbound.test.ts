/// <reference types="bun-types" />
// DPDP single mailbox, OUTBOUND half: supabase/functions/_shared/mail-outbound.ts
// and the two Edge Functions that use it (dpdp-monday-email, dpdp-invoice-email).
//
// Three layers, none needing a database, a network, or Deno:
//   1. The pure helpers (From resolution, envelope, Resend body, uuid guard).
//   2. logOutbound against a fake RPC client -- above all that it can NEVER
//      throw or hang a send, whatever the database does.
//   3. The REAL index.ts of each function, loaded under bun with a stubbed
//      Deno global, a mocked npm:@supabase/supabase-js@2 and a stubbed fetch,
//      then driven through its real handler. This is the proof that what
//      actually goes to Resend carries From/Reply-To/subject prefix/headers,
//      that the unsubscribe mailto and the Reply-To share one ref, and that a
//      log failure cannot turn a delivered email into an error. (Deno itself is
//      not installed on the machine this was written on, so this is the closest
//      thing to running the functions that is available.)
//
// Not proven here, by construction: that Resend accepts a From on
// veridian-aios.com (the domain must be verified in Resend first), and that
// public.dpdp_mail_log_outbound exists (another worker's migration).
import { afterAll, afterEach, beforeAll, describe, expect, mock, spyOn, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import {
  DEFAULT_FROM, LOG_RPC, buildOutbound, foreignSenderWarning, logOutbound, resendPayload, resolveFrom, uuidOrNull,
} from "../../../supabase/functions/_shared/mail-outbound"
import { isValidRef, parseRecipient } from "../../../supabase/functions/_shared/mail-taxonomy"

const REF = "k3f9x2ab7q"
// dpdp ids are 32-hex text (replace(gen_random_uuid()::text, '-', '')); Postgres reads that as a uuid.
const ORG_ID = "0a1b2c3d4e5f60718293a4b5c6d7e8f9"
const MEMBERSHIP_ID = "f9e8d7c6b5a4938271605f4e3d2c1b0a"

describe("From, envelope and Resend body", () => {
  test("the default sender is the one public address", () => {
    expect(DEFAULT_FROM).toBe("VERIDIAN AI DPDP <dpdp@veridian-aios.com>")
    expect(resolveFrom(undefined)).toBe(DEFAULT_FROM)
    expect(resolveFrom("")).toBe(DEFAULT_FROM)
    expect(resolveFrom("   ")).toBe(DEFAULT_FROM)
    expect(resolveFrom(" Someone <x@veridian-aios.com> ")).toBe("Someone <x@veridian-aios.com>")
  })

  test("foreignSenderWarning fires for the old subdomain and unparseable values, not for the mailbox domain", () => {
    expect(foreignSenderWarning(DEFAULT_FROM)).toBeNull()
    expect(foreignSenderWarning("Other Name <billing@veridian-aios.com>")).toBeNull()
    expect(foreignSenderWarning("VERIDIAN AI DPDP <dpdp@send.veridian-aios.com>")).toContain("send.veridian-aios.com")
    expect(foreignSenderWarning("VERIDIAN AI DPDP <dpdp@send.veridian-aios.com>")).toContain("unset the DPDP_EMAIL_FROM secret")
    expect(foreignSenderWarning("nonsense")).toContain("could not be parsed")
  })

  test("buildOutbound: Reply-To carries class and ref, subject is prefixed once, X-Veridian headers stamped", () => {
    const out = buildOutbound("monday", "Acme: DPDP this week", { ref: REF })
    expect(out.from).toBe(DEFAULT_FROM)
    expect(out.reply_to).toBe(`dpdp+mon.${REF}@veridian-aios.com`)
    expect(out.subject).toBe("[VERIDIAN DPDP · Monday] Acme: DPDP this week")
    expect(out.headers).toEqual({ "X-Veridian-Class": "monday", "X-Veridian-Ref": REF })
    expect(parseRecipient(out.reply_to)).toEqual({ ours: true, cls: "monday", ref: REF })
    // Idempotent: a subject that already has the prefix is not stacked.
    expect(buildOutbound("monday", out.subject, { ref: REF }).subject).toBe(out.subject)
    // Invoice class gets its own tag and label.
    const inv = buildOutbound("invoice", "Your receipt", { ref: REF })
    expect(inv.reply_to).toBe(`dpdp+inv.${REF}@veridian-aios.com`)
    expect(inv.subject).toBe("[VERIDIAN DPDP · Invoice] Your receipt")
  })

  test("buildOutbound: caller headers survive, ours win a clash, a fresh valid ref is minted when none is given", () => {
    const out = buildOutbound("invoice", "s", { ref: REF, from: "  Custom <c@veridian-aios.com> ", headers: { "List-Unsubscribe": "<https://u>", "X-Veridian-Class": "forged" } })
    expect(out.from).toBe("Custom <c@veridian-aios.com>")
    expect(out.headers["List-Unsubscribe"]).toBe("<https://u>")
    expect(out.headers["X-Veridian-Class"]).toBe("invoice")
    const a = buildOutbound("monday", "s")
    const b = buildOutbound("monday", "s")
    expect(isValidRef(a.ref)).toBe(true)
    expect(a.ref).not.toBe(b.ref)
    expect(a.reply_to).toBe(`dpdp+mon.${a.ref}@veridian-aios.com`)
    expect(() => buildOutbound("monday", "s", { ref: "bad ref" })).toThrow()
  })

  test("resendPayload is the whole Resend body, with reply_to and headers", () => {
    const out = buildOutbound("monday", "Hello", { ref: REF, headers: { "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } })
    expect(resendPayload("p@client-org.in", out, { html: "<p>h</p>", text: "t" })).toEqual({
      from: DEFAULT_FROM,
      to: ["p@client-org.in"],
      reply_to: `dpdp+mon.${REF}@veridian-aios.com`,
      subject: "[VERIDIAN DPDP · Monday] Hello",
      html: "<p>h</p>",
      text: "t",
      headers: { "List-Unsubscribe-Post": "List-Unsubscribe=One-Click", "X-Veridian-Class": "monday", "X-Veridian-Ref": REF },
    })
  })

  test("uuidOrNull passes dashed and undashed uuids, turns anything else into null", () => {
    expect(uuidOrNull(ORG_ID)).toBe(ORG_ID)
    expect(uuidOrNull("0a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9")).toBe("0a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9")
    expect(uuidOrNull(` ${ORG_ID} `)).toBe(ORG_ID)
    for (const bad of ["", "org-1", "seed-membership", "0a1b2c3d4e5f60718293a4b5c6d7e8f", "zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz", null, undefined]) {
      expect(uuidOrNull(bad as string | null | undefined)).toBeNull()
    }
  })
})

describe("logOutbound never blocks or fails a send", () => {
  const entry = { ref: REF, cls: "monday" as const, to: " p@client-org.in ", subject: "[VERIDIAN DPDP · Monday] s", providerMessageId: "re_1", membershipId: MEMBERSHIP_ID, orgId: ORG_ID }
  let warn: ReturnType<typeof spyOn>
  afterEach(() => { warn?.mockRestore() })

  test("success: one RPC with the exact named arguments", async () => {
    const calls: Array<{ fn: string; args: unknown }> = []
    const ok = await logOutbound({ rpc: (fn, args) => { calls.push({ fn, args }); return Promise.resolve({ data: null, error: null }) } }, entry)
    expect(ok).toBe(true)
    expect(calls).toEqual([{
      fn: LOG_RPC,
      args: { p_ref: REF, p_class: "monday", p_to_addr: "p@client-org.in", p_subject: "[VERIDIAN DPDP · Monday] s", p_provider_message_id: "re_1", p_membership_id: MEMBERSHIP_ID, p_org_id: ORG_ID },
    }])
    expect(LOG_RPC).toBe("dpdp_mail_log_outbound")
  })

  test("missing provider id and missing ids go as null, not as junk", async () => {
    let args: Record<string, unknown> = {}
    await logOutbound({ rpc: (_fn, a) => { args = a; return Promise.resolve({ error: null }) } }, { ...entry, providerMessageId: "", membershipId: "seed-membership", orgId: undefined })
    expect(args.p_provider_message_id).toBeNull()
    expect(args.p_membership_id).toBeNull()
    expect(args.p_org_id).toBeNull()
    await logOutbound({ rpc: (_fn, a) => { args = a; return Promise.resolve({ error: null }) } }, { ...entry, providerMessageId: null })
    expect(args.p_provider_message_id).toBeNull()
  })

  test("an RPC error, a rejection and a synchronous throw all return false without throwing", async () => {
    warn = spyOn(console, "warn").mockImplementation(() => {})
    expect(await logOutbound({ rpc: () => Promise.resolve({ data: null, error: { message: "function public.dpdp_mail_log_outbound does not exist" } }) }, entry)).toBe(false)
    expect(await logOutbound({ rpc: () => Promise.reject(new Error("connection reset")) }, entry)).toBe(false)
    expect(await logOutbound({ rpc: () => { throw new Error("client exploded") } }, entry)).toBe(false)
    expect(warn).toHaveBeenCalledTimes(3)
    const first = String(warn.mock.calls[0][0])
    expect(first).toContain("the email WAS sent")
    expect(first).toContain(REF)
    expect(first).toContain("does not exist")
  })

  test("a database that never answers is given up on after the timeout", async () => {
    warn = spyOn(console, "warn").mockImplementation(() => {})
    const started = Date.now()
    const ok = await logOutbound({ rpc: () => new Promise(() => {}) }, entry, 40)
    expect(ok).toBe(false)
    expect(Date.now() - started).toBeLessThan(1500)
    expect(String(warn.mock.calls[0][0])).toContain("no answer within 40 ms")
  })

  test("a malformed ref never reaches the database", async () => {
    warn = spyOn(console, "warn").mockImplementation(() => {})
    let called = false
    const ok = await logOutbound({ rpc: () => { called = true; return Promise.resolve({ error: null }) } }, { ...entry, ref: "bad ref" })
    expect(ok).toBe(false)
    expect(called).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// The contract with the migration. Every fake client in this file accepts ANY
// argument name, so on their own they cannot notice a rename: the first version
// of logOutbound sent `p_to` while the migration's function takes `p_to_addr`,
// every test was green, and in production every log call would have been
// "function not found" (PostgREST matches an RPC by its exact named arguments).
// This reads the real SQL instead.
// ---------------------------------------------------------------------------
describe("logOutbound's arguments match the migration's dpdp_mail_log_outbound", () => {
  const drizzleDir = join(import.meta.dir, "../../../drizzle")
  const SIGNATURE = /create\s+(?:or\s+replace\s+)?function\s+public\.dpdp_mail_log_outbound\s*\(([\s\S]*?)\)\s*returns/i

  function loadFunction(): { file: string; sql: string; params: Array<{ name: string; hasDefault: boolean }> } {
    // Latest migration wins, the way a later CREATE OR REPLACE would.
    const files = readdirSync(drizzleDir).filter((f) => f.endsWith(".sql")).sort()
    let found: { file: string; sql: string; params: Array<{ name: string; hasDefault: boolean }> } | null = null
    for (const file of files) {
      const sql = readFileSync(join(drizzleDir, file), "utf8")
      const m = SIGNATURE.exec(sql)
      if (!m) continue
      const params = m[1].split(",").map((p) => p.trim()).filter(Boolean).map((p) => {
        const parsed = /^(p_\w+)\s+\S+(\s+default\s+[\s\S]+)?$/i.exec(p)
        if (!parsed) throw new Error(`cannot parse parameter "${p}" in ${file}`)
        return { name: parsed[1], hasDefault: Boolean(parsed[2]) }
      })
      found = { file, sql, params }
    }
    if (!found) throw new Error("no drizzle migration defines public.dpdp_mail_log_outbound")
    return found
  }

  async function sentArgs(): Promise<string[]> {
    let args: Record<string, unknown> = {}
    const ok = await logOutbound(
      { rpc: (_fn, a) => { args = a; return Promise.resolve({ error: null }) } },
      { ref: REF, cls: "monday", to: "p@client-org.in", subject: "s", providerMessageId: "re_1", membershipId: MEMBERSHIP_ID, orgId: ORG_ID },
    )
    expect(ok).toBe(true)
    return Object.keys(args)
  }

  test("every argument logOutbound sends is a parameter of the SQL function, and every required parameter is sent", async () => {
    const fn = loadFunction()
    const known = fn.params.map((p) => p.name)
    const sent = await sentArgs()
    expect(sent.filter((k) => !known.includes(k))).toEqual([])
    expect(fn.params.filter((p) => !p.hasDefault && !sent.includes(p.name)).map((p) => p.name)).toEqual([])
  })

  test("the migration grants the function to service_role only", () => {
    const { sql } = loadFunction()
    const grant = /grant\s+execute\s+on\s+function\s+public\.dpdp_mail_log_outbound\s*\([^)]*\)\s+to\s+([^;]+);/i.exec(sql)
    expect(grant).not.toBeNull()
    expect(grant![1].trim()).toBe("service_role")
    expect(/revoke\s+all\s+on\s+function\s+public\.dpdp_mail_log_outbound\s*\([^)]*\)\s+from\s+public\s*,\s*anon\s*,\s*authenticated/i.test(sql)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// The real Edge Function handlers.
// ---------------------------------------------------------------------------
type Call = { fn: string; args: Record<string, any> }
type RpcHandler = (args: Record<string, any>) => { data?: unknown; error?: { message: string } | null } | Promise<{ data?: unknown; error?: { message: string } | null }>
type FetchCall = { url: string; body: Record<string, any> }

const rpcCalls: Call[] = []
const fetchCalls: FetchCall[] = []
let rpcHandlers: Record<string, RpcHandler> = {}
let resendResponse: { status: number; body: unknown } = { status: 200, body: { id: "re_123" } }
let handlers: { invoice?: (req: Request) => Promise<Response>; monday?: (req: Request) => Promise<Response> } = {}
let serveTarget: "invoice" | "monday" = "invoice"
const realFetch = globalThis.fetch
const envMap: Record<string, string> = {
  SUPABASE_URL: "https://proj.supabase.co",
  SUPABASE_ANON_KEY: "anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  RESEND_API_KEY: "re_test_key",
  DPDP_TIMER_SECRET: "t".repeat(40),
}

function fakeClient() {
  return {
    rpc: async (fn: string, args: Record<string, any> = {}) => {
      rpcCalls.push({ fn, args })
      const h = rpcHandlers[fn]
      const r = h ? await h(args) : { data: null }
      return { data: r.data ?? null, error: r.error ?? null }
    },
    auth: { admin: { generateLink: async () => ({ data: { properties: { action_link: "https://proj.supabase.co/auth/v1/verify?token=abc" } }, error: null }) } },
  }
}

function callsTo(fn: string): Call[] {
  return rpcCalls.filter((c) => c.fn === fn)
}

function order(fn: string): number {
  return rpcCalls.findIndex((c) => c.fn === fn)
}

function resetWorld() {
  rpcCalls.length = 0
  fetchCalls.length = 0
  rpcHandlers = {}
  resendResponse = { status: 200, body: { id: "re_123" } }
}

beforeAll(async () => {
  ;(globalThis as any).Deno = {
    env: { get: (k: string) => envMap[k] },
    serve: (h: (req: Request) => Promise<Response>) => { handlers[serveTarget] = h },
  }
  mock.module("npm:@supabase/supabase-js@2", () => ({ createClient: () => fakeClient() }))
  globalThis.fetch = (async (input: unknown, init?: { body?: string }) => {
    fetchCalls.push({ url: String(input), body: JSON.parse(String(init?.body ?? "{}")) })
    return new Response(JSON.stringify(resendResponse.body), { status: resendResponse.status, headers: { "Content-Type": "application/json" } })
  }) as typeof fetch
  serveTarget = "invoice"
  await import("../../../supabase/functions/dpdp-invoice-email/index.ts")
  serveTarget = "monday"
  await import("../../../supabase/functions/dpdp-monday-email/index.ts")
})

afterAll(() => {
  globalThis.fetch = realFetch
  delete (globalThis as any).Deno
})

describe("dpdp-invoice-email, driven through its real handler", () => {
  const invoiceDetails = {
    paymentId: "pay1", orgId: ORG_ID, orgName: "Acme & Co", plan: "firm", interval: "month", amountPaise: 199900,
    periodStart: "2026-10-01", confirmedAt: "2026-09-29T05:00:00Z", confirmedNote: null,
    ownerMembershipId: MEMBERSHIP_ID, ownerIdentityId: "ident1", ownerEmail: "owner@client-org.in",
  }
  function wire() {
    rpcHandlers = {
      dpdp__is_platform_admin: () => ({ data: true }),
      dpdp_timer_invoice_details: () => ({ data: invoiceDetails }),
      dpdp_timer_record_email_send: () => ({ data: { id: "row1", unsubscribeToken: "u".repeat(32), duplicate: false } }),
      dpdp_timer_mark_email_send_result: () => ({ data: null }),
      dpdp_mail_log_outbound: () => ({ data: null }),
    }
  }
  const post = (body: unknown) => handlers.invoice!(new Request("https://proj.supabase.co/functions/v1/dpdp-invoice-email", {
    method: "POST", headers: { Authorization: "Bearer caller-jwt", "Content-Type": "application/json" }, body: JSON.stringify(body),
  }))

  test("a real send goes out from the single address with Reply-To, prefix, headers, and is logged", async () => {
    resetWorld(); wire()
    const res = await post({ paymentId: "pay1" })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, dryRun: false, duplicate: false, to: "owner@client-org.in", resendMessageId: "re_123" })

    expect(fetchCalls).toHaveLength(1)
    expect(fetchCalls[0].url).toBe("https://api.resend.com/emails")
    const sent = fetchCalls[0].body
    expect(sent.from).toBe("VERIDIAN AI DPDP <dpdp@veridian-aios.com>")
    expect(JSON.stringify(sent)).not.toContain("send.veridian-aios.com")
    expect(sent.to).toEqual(["owner@client-org.in"])
    expect(sent.subject).toBe("[VERIDIAN DPDP · Invoice] Your VERIDIAN receipt -- Acme & Co (Rs 1,999)")
    const ref = sent.headers["X-Veridian-Ref"]
    expect(isValidRef(ref)).toBe(true)
    expect(sent.headers["X-Veridian-Class"]).toBe("invoice")
    expect(sent.reply_to).toBe(`dpdp+inv.${ref}@veridian-aios.com`)
    expect(parseRecipient(sent.reply_to)).toEqual({ ours: true, cls: "invoice", ref })

    // The same prefixed subject is what dpdp.email_send recorded.
    expect(callsTo("dpdp_timer_record_email_send")[0].args.p_subject).toBe(sent.subject)

    // One log row, with the provider id and both ids, written after the send and before the 'sent' mark.
    const logs = callsTo("dpdp_mail_log_outbound")
    expect(logs).toHaveLength(1)
    expect(logs[0].args).toEqual({
      p_ref: ref, p_class: "invoice", p_to_addr: "owner@client-org.in", p_subject: sent.subject,
      p_provider_message_id: "re_123", p_membership_id: MEMBERSHIP_ID, p_org_id: ORG_ID,
    })
    expect(order("dpdp_timer_record_email_send")).toBeLessThan(order("dpdp_mail_log_outbound"))
    expect(order("dpdp_mail_log_outbound")).toBeLessThan(order("dpdp_timer_mark_email_send_result"))
  })

  test("a failing log write cannot fail or undo a delivered receipt", async () => {
    resetWorld(); wire()
    rpcHandlers.dpdp_mail_log_outbound = () => ({ error: { message: "function public.dpdp_mail_log_outbound(...) does not exist" } })
    const warn = spyOn(console, "warn").mockImplementation(() => {})
    try {
      const res = await post({ paymentId: "pay1" })
      expect(res.status).toBe(200)
      expect((await res.json() as { ok: boolean }).ok).toBe(true)
      expect(fetchCalls).toHaveLength(1)
      expect(callsTo("dpdp_timer_mark_email_send_result")[0].args).toMatchObject({ p_status: "sent", p_resend_message_id: "re_123" })
      expect(warn.mock.calls.some((c) => String(c[0]).includes("the email WAS sent"))).toBe(true)
    } finally { warn.mockRestore() }
  })

  test("dry run: prefixed subject returned and recorded, nothing sent, nothing logged", async () => {
    resetWorld(); wire()
    const res = await post({ paymentId: "pay1", dryRun: true })
    const body = await res.json() as { ok: boolean; dryRun: boolean; subject: string }
    expect(body.dryRun).toBe(true)
    expect(body.subject).toBe("[VERIDIAN DPDP · Invoice] Your VERIDIAN receipt -- Acme & Co (Rs 1,999)")
    expect(callsTo("dpdp_timer_record_email_send")[0].args).toMatchObject({ p_status: "dry_run", p_subject: body.subject })
    expect(fetchCalls).toHaveLength(0)
    expect(callsTo("dpdp_mail_log_outbound")).toHaveLength(0)
  })

  test("a duplicate payment sends and logs nothing", async () => {
    resetWorld(); wire()
    rpcHandlers.dpdp_timer_record_email_send = () => ({ data: { id: null, duplicate: true } })
    const res = await post({ paymentId: "pay1" })
    expect(await res.json()).toMatchObject({ ok: true, duplicate: true })
    expect(fetchCalls).toHaveLength(0)
    expect(callsTo("dpdp_mail_log_outbound")).toHaveLength(0)
  })

  test("a provider failure is a 502, marked failed, and logs nothing (no message left the building)", async () => {
    resetWorld(); wire()
    resendResponse = { status: 422, body: { message: "The veridian-aios.com domain is not verified" } }
    const res = await post({ paymentId: "pay1" })
    expect(res.status).toBe(502)
    expect(callsTo("dpdp_timer_mark_email_send_result")[0].args).toMatchObject({ p_status: "failed" })
    expect(callsTo("dpdp_mail_log_outbound")).toHaveLength(0)
  })
})

describe("dpdp-monday-email, driven through its real handler", () => {
  const digest = {
    membershipId: MEMBERSHIP_ID, identityId: "ident2", orgId: ORG_ID, orgName: "Acme & Co", orgProduct: "firm", email: "person@client-org.in",
    level: "staff", roleKind: "staff", weekKey: "2026-W40", today: "2026-09-28", unsubscribed: false, statutoryOnly: false,
    alreadySentThisWeek: false, owners: [{ membershipId: "mo", email: "owner@client-org.in" }], coordinators: [], escalatedToMe: [],
    jobs: [{
      obligationId: "ob1", key: "firm-04", what: "Write down where it is kept", part: 2, dueOn: "2026-10-05", daysLate: 0, late: false,
      requiredToday: false, isGroup: false, groupLabel: null, assigneeEmail: "person@client-org.in", isMine: true, stuck: false, outsideParty: false,
    }],
  }
  const UNSUB_TOKEN = "a".repeat(32)
  function wire() {
    rpcHandlers = {
      dpdp_timer_start_run: () => ({ data: "run1" }),
      dpdp_timer_finish_run: () => ({ data: null }),
      dpdp_timer_org_ids: () => ({ data: [ORG_ID] }),
      dpdp_timer_ensure_link_codes: () => ({ data: null }),
      dpdp_timer_build_monday_digests: () => ({ data: [digest] }),
      dpdp_timer_record_email_send: () => ({ data: { id: "row1", unsubscribeToken: UNSUB_TOKEN, duplicate: false } }),
      dpdp_timer_issue_action_tokens: () => ({ data: [{ obligationId: "ob1", done: "d".repeat(32), cannot: "c".repeat(32), neverHadAny: null }] }),
      dpdp_timer_mark_email_send_result: () => ({ data: null }),
      dpdp_mail_log_outbound: () => ({ data: null }),
    }
  }
  const post = (body: unknown) => handlers.monday!(new Request("https://proj.supabase.co/functions/v1/dpdp-monday-email", {
    method: "POST", headers: { Authorization: `Bearer ${envMap.DPDP_TIMER_SECRET}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
  }))

  test("a real digest goes out from the single address with Reply-To, prefix, X-Veridian headers, a same-ref unsubscribe mailto, and is logged", async () => {
    resetWorld(); wire()
    const res = await post({ job: "monday" })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ job: "monday", dryRun: false, sent: 1, failed: 0 })

    expect(fetchCalls).toHaveLength(1)
    const sent = fetchCalls[0].body
    expect(sent.from).toBe("VERIDIAN AI DPDP <dpdp@veridian-aios.com>")
    expect(JSON.stringify(sent)).not.toContain("send.veridian-aios.com")
    expect(sent.to).toEqual(["person@client-org.in"])
    expect(sent.subject.startsWith("[VERIDIAN DPDP · Monday] ")).toBe(true)
    expect(sent.subject.split("[VERIDIAN DPDP").length).toBe(2) // prefix once, not stacked
    const ref = sent.headers["X-Veridian-Ref"]
    expect(isValidRef(ref)).toBe(true)
    expect(sent.headers["X-Veridian-Class"]).toBe("monday")
    expect(sent.reply_to).toBe(`dpdp+mon.${ref}@veridian-aios.com`)

    // RFC 8058 one-click https POST target is untouched; the mailto is the new data-request address on the SAME ref, with no token.
    expect(sent.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click")
    expect(sent.headers["List-Unsubscribe"]).toBe(
      `<https://proj.supabase.co/functions/v1/dpdp-monday-email?action=unsubscribe&t=${UNSUB_TOKEN}>, <mailto:dpdp+dsr.${ref}@veridian-aios.com?subject=unsubscribe>`,
    )
    expect(sent.headers["List-Unsubscribe"]).not.toContain("unsubscribe@")

    // The prefixed subject is what dpdp.email_send recorded (queued record, before the send).
    expect(callsTo("dpdp_timer_record_email_send")[0].args).toMatchObject({ p_status: "queued", p_subject: sent.subject })

    const logs = callsTo("dpdp_mail_log_outbound")
    expect(logs).toHaveLength(1)
    expect(logs[0].args).toEqual({
      p_ref: ref, p_class: "monday", p_to_addr: "person@client-org.in", p_subject: sent.subject,
      p_provider_message_id: "re_123", p_membership_id: MEMBERSHIP_ID, p_org_id: ORG_ID,
    })
    expect(order("dpdp_timer_record_email_send")).toBeLessThan(order("dpdp_mail_log_outbound"))
    expect(order("dpdp_mail_log_outbound")).toBeLessThan(order("dpdp_timer_mark_email_send_result"))
  })

  test("every message gets its own ref", async () => {
    resetWorld(); wire()
    const second = { ...digest, membershipId: "1a1b1c1d1e1f10111213141516171819", email: "second@client-org.in" }
    rpcHandlers.dpdp_timer_build_monday_digests = () => ({ data: [digest, second] })
    await post({ job: "monday" })
    expect(fetchCalls).toHaveLength(2)
    const refs = fetchCalls.map((c) => c.body.headers["X-Veridian-Ref"])
    expect(new Set(refs).size).toBe(2)
    expect(callsTo("dpdp_mail_log_outbound").map((c) => c.args.p_ref).sort()).toEqual([...refs].sort())
  })

  test("a failing log write does not stop the digest from being marked sent", async () => {
    resetWorld(); wire()
    rpcHandlers.dpdp_mail_log_outbound = () => ({ error: { message: "permission denied for function dpdp_mail_log_outbound" } })
    const warn = spyOn(console, "warn").mockImplementation(() => {})
    try {
      const res = await post({ job: "monday" })
      expect(await res.json()).toMatchObject({ sent: 1, failed: 0 })
      expect(callsTo("dpdp_timer_mark_email_send_result")[0].args).toMatchObject({ p_status: "sent", p_resend_message_id: "re_123" })
    } finally { warn.mockRestore() }
  })

  test("dry run: the recorded subject carries the prefix, nothing is sent or logged", async () => {
    resetWorld(); wire()
    const res = await post({ job: "monday", dryRun: true })
    expect(await res.json()).toMatchObject({ dryRun: true, dry_run: 1, sent: 0 })
    const rec = callsTo("dpdp_timer_record_email_send")[0].args
    expect(rec.p_status).toBe("dry_run")
    expect(rec.p_subject.startsWith("[VERIDIAN DPDP · Monday] ")).toBe(true)
    expect(fetchCalls).toHaveLength(0)
    expect(callsTo("dpdp_mail_log_outbound")).toHaveLength(0)
  })

  test("a reserved test address is skipped: not sent, not logged", async () => {
    resetWorld(); wire()
    rpcHandlers.dpdp_timer_build_monday_digests = () => ({ data: [{ ...digest, email: "person@example.test" }] })
    const res = await post({ job: "monday" })
    expect(await res.json()).toMatchObject({ sent: 0, skipped: 1 })
    expect(fetchCalls).toHaveLength(0)
    expect(callsTo("dpdp_mail_log_outbound")).toHaveLength(0)
  })

  test("a provider failure marks the row failed and logs nothing", async () => {
    resetWorld(); wire()
    resendResponse = { status: 500, body: { message: "boom" } }
    const res = await post({ job: "monday" })
    expect(await res.json()).toMatchObject({ sent: 0, failed: 1 })
    expect(callsTo("dpdp_timer_mark_email_send_result")[0].args).toMatchObject({ p_status: "failed" })
    expect(callsTo("dpdp_mail_log_outbound")).toHaveLength(0)
  })
})
