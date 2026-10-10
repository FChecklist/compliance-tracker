/// <reference types="bun-types" />
// O-2 (TEST-REPORT 2026-10-02): a reminder must not be mailed twice when Resend accepted it but a
// later step failed. Pure tests over deliverClaimedReminder + sendViaResend's Idempotency-Key, plus a
// scan that the daily function really goes through them.
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "bun:test"
import { deliverClaimedReminder, reminderIdempotencyKey, sendViaResend } from "../../../supabase/functions/_shared/billing-mail"
import { buildOutbound } from "../../../supabase/functions/_shared/mail-outbound"

describe("deliverClaimedReminder", () => {
  test("happy path: sends once, logs, marks sent", async () => {
    const calls: string[] = []
    const r = await deliverClaimedReminder({
      send: async () => { calls.push("send"); return "msg_1" },
      afterSend: async (id) => { calls.push("log:" + id) },
      markSent: async () => { calls.push("mark"); return true },
      markFailed: async () => { calls.push("failed") },
    })
    expect(r).toEqual({ status: "sent", markRecorded: true })
    expect(calls).toEqual(["send", "log:msg_1", "mark"])
  })

  test("a send that Resend refuses is 'failed' (tomorrow retries it)", async () => {
    const calls: string[] = []
    const r = await deliverClaimedReminder({
      send: async () => { throw new Error("Resend 422") },
      afterSend: async () => { calls.push("log") },
      markSent: async () => { calls.push("mark"); return true },
      markFailed: async (m) => { calls.push("failed:" + m) },
    })
    expect(r.status).toBe("failed")
    expect(calls).toEqual(["failed:Resend 422"])
  })

  test("mail accepted but the mail-log write throws: still 'sent', never 'failed'", async () => {
    const calls: string[] = []
    const r = await deliverClaimedReminder({
      send: async () => "msg_2",
      afterSend: async () => { throw new Error("db down") },
      markSent: async () => { calls.push("mark"); return true },
      markFailed: async () => { calls.push("failed") },
    })
    expect(r).toEqual({ status: "sent", markRecorded: true })
    expect(calls).toEqual(["mark"])
  })

  test("mail accepted but mark-sent fails twice then works: retried, recorded", async () => {
    let n = 0
    const r = await deliverClaimedReminder({
      send: async () => "msg_3",
      afterSend: async () => {},
      markSent: async () => ++n >= 3,
      markFailed: async () => { throw new Error("must not be called") },
    })
    expect(n).toBe(3)
    expect(r).toEqual({ status: "sent", markRecorded: true })
  })

  test("mail accepted but mark-sent never works: 'sent' (not failed), reported unrecorded, no failed mark", async () => {
    let failedCalled = false
    let n = 0
    const r = await deliverClaimedReminder({
      send: async () => "msg_4",
      afterSend: async () => {},
      markSent: async () => { n++; throw new Error("rpc down") },
      markFailed: async () => { failedCalled = true },
    })
    expect(n).toBe(3)
    expect(failedCalled).toBe(false)
    expect(r).toEqual({ status: "sent", markRecorded: false })
  })
})

describe("Idempotency-Key", () => {
  const realFetch = globalThis.fetch
  afterEach(() => { globalThis.fetch = realFetch })

  test("same org + reminder key -> same key; different -> different", () => {
    expect(reminderIdempotencyKey("o1", "trial3:2026-10-29")).toBe(reminderIdempotencyKey("o1", "trial3:2026-10-29"))
    expect(reminderIdempotencyKey("o1", "trial3:2026-10-29")).not.toBe(reminderIdempotencyKey("o2", "trial3:2026-10-29"))
    expect(reminderIdempotencyKey("o1", "trial3:2026-10-29")).not.toBe(reminderIdempotencyKey("o1", "trial0:2026-10-29"))
  })

  test("sendViaResend puts it on the request; without one there is no header", async () => {
    const seen: Array<Record<string, string>> = []
    // the Test/Live mail gate (drizzle/0735) asks the database first: LIVE, so the send goes on
    ;(globalThis as unknown as { Deno: unknown }).Deno = { env: { get: (k: string) => (k === "SUPABASE_URL" ? "https://x.test" : "service-key") } }
    globalThis.fetch = (async (u: unknown, init: { headers: Record<string, string> }) => {
      if (String(u).includes("/rpc/dpdp_mail_gate")) return new Response(JSON.stringify({ send: true, reason: "live", mode: "LIVE" }), { status: 200 })
      seen.push(init.headers)
      return new Response(JSON.stringify({ id: "re_1" }), { status: 200 })
    }) as unknown as typeof fetch
    const out = buildOutbound("sales_chain", "Subject", { from: "VERIDIAN AI DPDP <dpdp@veridian-aios.com>" })
    await sendViaResend("key", "a@b.in", out, { html: "<p>x</p>", text: "x" }, "k-1")
    await sendViaResend("key", "a@b.in", out, { html: "<p>x</p>", text: "x" })
    expect(seen[0]["Idempotency-Key"]).toBe("k-1")
    expect(seen[1]["Idempotency-Key"]).toBeUndefined()
  })
})

describe("dpdp-lifecycle-email goes through them", () => {
  const src = readFileSync(join(import.meta.dir, "../../../supabase/functions/dpdp-lifecycle-email/index.ts"), "utf8")
  test("uses deliverClaimedReminder with the idempotency key", () => {
    expect(src).toContain("deliverClaimedReminder(")
    expect(src).toContain("reminderIdempotencyKey(d.orgId, d.reminderKey)")
  })
})
