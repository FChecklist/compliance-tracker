/// <reference types="bun-types" />
// DPDP online payment (Razorpay): the pure half of supabase/functions/dpdp-pay (logic.ts).
// Every rule that decides whether money is booked is tested here, including the ways it must
// REFUSE: replayed event, bad signature, wrong amount, wrong currency, wrong org, second payment.
// No network, no database, no clock. The SQL half is proved against the live database in a
// rolled-back transaction (see dpdp-app/OPERATIONS.md, "Online payment (Razorpay)").
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import {
  type AttemptFacts, type CapturedPayment, SUPPORTED_EVENTS, basicAuthHeader, buildPaymentLinkBody, constantTimeEqual, corsHeadersFor, decideWebhook,
  hmacSha256Hex, httpStatusFor, parseCreateRequest, parseNotes, parsePaymentLinkResponse, parseWebhookEvent, razorpayConfigured, verifyWebhookSignature,
} from "../../../supabase/functions/dpdp-pay/logic"

const SECRET = "whsec_test_not_a_real_secret"

const payment = (over: Record<string, unknown> = {}) => ({
  id: "pay_Abc123", amount: 999900, currency: "INR", status: "captured", method: "upi", order_id: "order_Zzz1", notes: {}, ...over,
})
const linkEntity = (over: Record<string, unknown> = {}) => ({
  id: "plink_Xyz9", reference_id: "a".repeat(32), order_id: "order_Zzz1", amount: 999900, currency: "INR",
  notes: { org_id: "org1", attempt_id: "a".repeat(32), interval: "year" }, ...over,
})

const bodyPaid = (pay: Record<string, unknown> = payment(), link: Record<string, unknown> = linkEntity()) =>
  JSON.stringify({ entity: "event", event: "payment_link.paid", payload: { payment_link: { entity: link }, payment: { entity: pay }, order: { entity: { id: "order_Zzz1" } } } })
const bodyCaptured = (pay: Record<string, unknown> = payment()) => JSON.stringify({ entity: "event", event: "payment.captured", payload: { payment: { entity: pay } } })
const bodyOrderPaid = (pay: Record<string, unknown> = payment()) =>
  JSON.stringify({ entity: "event", event: "order.paid", payload: { order: { entity: { id: "order_Zzz1", notes: { org_id: "org1", attempt_id: "a".repeat(32) } } }, payment: { entity: pay } } })

const attempt = (over: Partial<AttemptFacts> = {}): AttemptFacts => ({ id: "a".repeat(32), orgId: "org1", status: "created", amountPaise: 999900, currency: "INR", razorpayPaymentId: null, ...over })
const captured = (over: Partial<CapturedPayment> = {}): CapturedPayment => {
  const p = parseWebhookEvent(bodyPaid(), "evt_1")
  if (p.kind !== "payment") throw new Error("fixture must parse")
  return { ...p.payment, ...over }
}

describe("signature", () => {
  test("a correct signature over the raw body verifies", async () => {
    const body = bodyPaid()
    expect(await verifyWebhookSignature(body, await hmacSha256Hex(SECRET, body), SECRET)).toBe(true)
  })
  test("matches an independently computed HMAC-SHA256 (node:crypto), so we are not testing our own mirror", async () => {
    const { createHmac } = await import("node:crypto")
    const body = '{"event":"payment.captured"}'
    expect(await hmacSha256Hex(SECRET, body)).toBe(createHmac("sha256", SECRET).update(body).digest("hex"))
  })
  test("a wrong signature is refused", async () => {
    expect(await verifyWebhookSignature(bodyPaid(), "0".repeat(64), SECRET)).toBe(false)
  })
  test("a signature made with a different secret is refused", async () => {
    const body = bodyPaid()
    expect(await verifyWebhookSignature(body, await hmacSha256Hex("another", body), SECRET)).toBe(false)
  })
  test("one changed character in the body breaks it (the RAW text is what is signed)", async () => {
    const body = bodyPaid()
    const sig = await hmacSha256Hex(SECRET, body)
    expect(await verifyWebhookSignature(body.replace("999900", "999901"), sig, SECRET)).toBe(false)
    expect(await verifyWebhookSignature(JSON.stringify(JSON.parse(body), null, 1), sig, SECRET)).toBe(false) // re-serialised JSON is not the same bytes
  })
  test("an empty or missing secret never verifies, even when the signature was made with the empty secret", async () => {
    const body = bodyPaid()
    const { createHmac } = await import("node:crypto")
    expect(await verifyWebhookSignature(body, createHmac("sha256", "").update(body).digest("hex"), "")).toBe(false)
    expect(await verifyWebhookSignature(body, await hmacSha256Hex(SECRET, body), undefined)).toBe(false)
    expect(await verifyWebhookSignature(body, await hmacSha256Hex(SECRET, body), null)).toBe(false)
  })
  test("an empty, missing or non-hex signature is refused", async () => {
    const body = bodyPaid()
    for (const s of ["", null, undefined, "zz".repeat(32), "abc", "0".repeat(63), "0".repeat(65)]) expect(await verifyWebhookSignature(body, s, SECRET)).toBe(false)
  })
  test("upper-case hex from a proxy is accepted (case is not part of the value)", async () => {
    const body = bodyPaid()
    expect(await verifyWebhookSignature(body, (await hmacSha256Hex(SECRET, body)).toUpperCase(), SECRET)).toBe(true)
  })
  test("constantTimeEqual: equal, different, different length", () => {
    expect(constantTimeEqual("abc", "abc")).toBe(true)
    expect(constantTimeEqual("abc", "abd")).toBe(false)
    expect(constantTimeEqual("abc", "abcd")).toBe(false)
  })
})

describe("parseWebhookEvent", () => {
  test("the three money events are exactly the supported set", () => {
    expect([...SUPPORTED_EVENTS]).toEqual(["payment.captured", "payment_link.paid", "order.paid"])
  })
  test("payment_link.paid carries link id, reference id, order id, amount, currency, method and our notes", () => {
    const r = parseWebhookEvent(bodyPaid(), "evt_abc")
    expect(r).toEqual({
      kind: "payment",
      payment: {
        eventId: "evt_abc", eventType: "payment_link.paid", paymentId: "pay_Abc123", orderId: "order_Zzz1", paymentLinkId: "plink_Xyz9", referenceId: "a".repeat(32),
        amountPaise: 999900, currency: "INR", method: "upi", notes: { orgId: "org1", attemptId: "a".repeat(32), interval: "year" },
      },
    })
  })
  test("payment.captured alone has only the order id (the attempt is found through it)", () => {
    const r = parseWebhookEvent(bodyCaptured(), "evt_2")
    expect(r.kind).toBe("payment")
    if (r.kind === "payment") {
      expect(r.payment.paymentLinkId).toBeNull()
      expect(r.payment.orderId).toBe("order_Zzz1")
      expect(r.payment.eventType).toBe("payment.captured")
    }
  })
  test("order.paid reads the payment and takes notes from the order", () => {
    const r = parseWebhookEvent(bodyOrderPaid(), "evt_3")
    expect(r.kind).toBe("payment")
    if (r.kind === "payment") expect(r.payment.notes.orgId).toBe("org1")
  })
  test("without the event-id header a stable key is made from event type and payment id (so a retry maps to the same key)", () => {
    const a = parseWebhookEvent(bodyCaptured(), null)
    const b = parseWebhookEvent(bodyCaptured(), "")
    expect(a.kind === "payment" && a.payment.eventId).toBe("payment.captured:pay_Abc123")
    expect(b.kind === "payment" && b.payment.eventId).toBe("payment.captured:pay_Abc123")
  })
  test("a payment that is not captured is acknowledged and ignored, never booked", () => {
    expect(parseWebhookEvent(bodyCaptured(payment({ status: "authorized" })), "e")).toEqual({ kind: "ignored", reason: "not_captured" })
    expect(parseWebhookEvent(bodyCaptured(payment({ status: "failed" })), "e")).toEqual({ kind: "ignored", reason: "not_captured" })
  })
  test("another event type, even validly signed, is ignored", () => {
    for (const event of ["payment.failed", "refund.processed", "payment_link.cancelled", "order.created", "payment.authorized"]) {
      expect(parseWebhookEvent(JSON.stringify({ event, payload: { payment: { entity: payment() } } }), "e")).toEqual({ kind: "ignored", reason: "unsupported_event" })
    }
  })
  test("unreadable bodies are invalid, never thrown", () => {
    expect(parseWebhookEvent("not json", "e")).toEqual({ kind: "invalid", reason: "bad_json" })
    expect(parseWebhookEvent("[]", "e")).toEqual({ kind: "invalid", reason: "bad_shape" })
    expect(parseWebhookEvent(JSON.stringify({ nope: 1 }), "e")).toEqual({ kind: "invalid", reason: "bad_shape" })
    expect(parseWebhookEvent(JSON.stringify({ event: "payment.captured" }), "e")).toEqual({ kind: "invalid", reason: "bad_shape" })
    expect(parseWebhookEvent(JSON.stringify({ event: "payment.captured", payload: {} }), "e")).toEqual({ kind: "invalid", reason: "no_payment" })
    expect(parseWebhookEvent(bodyCaptured(payment({ id: "" })), "e")).toEqual({ kind: "invalid", reason: "no_payment" })
  })
  test("the amount must be a positive whole number of paise", () => {
    for (const amount of ["999900", 0, -5, 9999.5, null, undefined]) {
      expect(parseWebhookEvent(bodyCaptured(payment({ amount })), "e")).toEqual({ kind: "invalid", reason: "bad_amount" })
    }
  })
  test("currency is upper-cased; notes ignore non-strings", () => {
    const r = parseWebhookEvent(bodyCaptured(payment({ currency: "inr" })), "e")
    expect(r.kind === "payment" && r.payment.currency).toBe("INR")
    expect(parseNotes({ notes: { org_id: 7, attempt_id: " x ", interval: "" } })).toEqual({ orgId: null, attemptId: "x", interval: null })
    expect(parseNotes(null)).toEqual({ orgId: null, attemptId: null, interval: null })
  })
})

describe("decideWebhook", () => {
  test("a matching payment on an open attempt is recorded", () => {
    expect(decideWebhook(captured(), attempt())).toEqual({ action: "record" })
  })
  test("REPLAY: the same payment id on an attempt already paid with it is a quiet duplicate", () => {
    expect(decideWebhook(captured(), attempt({ status: "paid", razorpayPaymentId: "pay_Abc123" }))).toEqual({ action: "duplicate" })
  })
  test("REPLAY wins over everything else: still a duplicate even if the replayed amount now looks wrong", () => {
    expect(decideWebhook(captured({ amountPaise: 1 }), attempt({ status: "paid", razorpayPaymentId: "pay_Abc123" }))).toEqual({ action: "duplicate" })
  })
  test("a DIFFERENT payment id on an attempt already paid is flagged for a human, not recorded", () => {
    expect(decideWebhook(captured({ paymentId: "pay_Other" }), attempt({ status: "paid", razorpayPaymentId: "pay_Abc123" }))).toEqual({ action: "flag", reason: "attempt_already_paid" })
  })
  test("WRONG AMOUNT is refused (less, more, off by one paise)", () => {
    for (const amountPaise of [99900, 1999800, 999899, 999901]) {
      expect(decideWebhook(captured({ amountPaise }), attempt())).toEqual({ action: "reject", reason: "amount_mismatch" })
    }
  })
  test("WRONG CURRENCY is refused, whatever the amount", () => {
    for (const currency of ["USD", "EUR", ""]) expect(decideWebhook(captured({ currency }), attempt())).toEqual({ action: "reject", reason: "currency_mismatch" })
  })
  test("no attempt found: unknown order, refused", () => {
    expect(decideWebhook(captured(), null)).toEqual({ action: "reject", reason: "unknown_order" })
  })
  test("notes naming a different organisation than our own attempt row are refused (notes never choose the org)", () => {
    expect(decideWebhook(captured({ notes: { orgId: "someone-else", attemptId: null, interval: null } }), attempt())).toEqual({ action: "reject", reason: "org_mismatch" })
  })
  test("absent notes are fine: the attempt row, not the notes, decides who is credited", () => {
    expect(decideWebhook(captured({ notes: { orgId: null, attemptId: null, interval: null } }), attempt())).toEqual({ action: "record" })
  })
  test("an attempt in 'mismatch', 'expired' or 'cancelled' can still be paid correctly later (money arrived)", () => {
    for (const status of ["mismatch", "expired", "cancelled"] as const) expect(decideWebhook(captured(), attempt({ status }))).toEqual({ action: "record" })
  })
  test("HTTP answers: booked/duplicate/flagged are 200 (Razorpay must stop retrying), refusals are 4xx", () => {
    expect(httpStatusFor({ action: "record" })).toBe(200)
    expect(httpStatusFor({ action: "duplicate" })).toBe(200)
    expect(httpStatusFor({ action: "flag", reason: "attempt_already_paid" })).toBe(200)
    expect(httpStatusFor({ action: "reject", reason: "amount_mismatch" })).toBe(400)
    expect(httpStatusFor({ action: "reject", reason: "currency_mismatch" })).toBe(400)
    expect(httpStatusFor({ action: "reject", reason: "org_mismatch" })).toBe(400)
    expect(httpStatusFor({ action: "reject", reason: "unknown_order" })).toBe(404)
  })
})

describe("end to end through parse -> decide, the way index.ts does it", () => {
  const settle = async (body: string, att: AttemptFacts | null, sig?: string) => {
    if (!(await verifyWebhookSignature(body, sig ?? (await hmacSha256Hex(SECRET, body)), SECRET))) return "401"
    const p = parseWebhookEvent(body, "evt_e2e")
    if (p.kind === "invalid") return "400-unreadable"
    if (p.kind === "ignored") return `200-ignored-${p.reason}`
    const d = decideWebhook(p.payment, att)
    return `${httpStatusFor(d)}-${d.action}`
  }
  test("good payment -> 200 record; the same body again after it was booked -> 200 duplicate", async () => {
    expect(await settle(bodyPaid(), attempt())).toBe("200-record")
    expect(await settle(bodyPaid(), attempt({ status: "paid", razorpayPaymentId: "pay_Abc123" }))).toBe("200-duplicate")
  })
  test("bad signature -> 401 before anything is read", async () => {
    expect(await settle(bodyPaid(), attempt(), "f".repeat(64))).toBe("401")
  })
  test("amount 1 paise short -> 400; USD -> 400", async () => {
    expect(await settle(bodyPaid(payment({ amount: 999899 })), attempt())).toBe("400-reject")
    expect(await settle(bodyPaid(payment({ currency: "USD" })), attempt())).toBe("400-reject")
  })
  test("a failed payment event -> 200 ignored (no retry storm), nothing booked", async () => {
    expect(await settle(JSON.stringify({ event: "payment.failed", payload: { payment: { entity: payment({ status: "failed" }) } } }), attempt())).toBe("200-ignored-unsupported_event")
  })
})

describe("creating the payment link", () => {
  const req = { attemptId: "a".repeat(32), orgId: "org1", orgName: "Acme Associates", interval: "year" as const, amountPaise: 999900, currency: "INR", ownerEmail: "owner@acme.in", callbackUrl: "https://dpdp.veridian-aios.com/app/?payment=returned" }
  test("amount, currency and our attempt id go to Razorpay; the attempt id is the reference we get echoed back", () => {
    const b = buildPaymentLinkBody(req) as Record<string, unknown>
    expect(b.amount).toBe(999900)
    expect(b.currency).toBe("INR")
    expect(b.reference_id).toBe("a".repeat(32))
    expect(b.accept_partial).toBe(false)
    expect(b.notes).toEqual({ org_id: "org1", attempt_id: "a".repeat(32), interval: "year" })
    expect(b.callback_url).toBe(req.callbackUrl)
    expect((b.customer as { email: string }).email).toBe("owner@acme.in")
    expect(b.notify).toEqual({ sms: false, email: false })
  })
  test("no owner email -> no customer block; no card or key anywhere in the body", () => {
    const b = buildPaymentLinkBody({ ...req, ownerEmail: null })
    expect("customer" in b).toBe(false)
    expect(JSON.stringify(b)).not.toMatch(/card|secret|key/i)
  })
  test("response parsing needs an id and an https short_url", () => {
    expect(parsePaymentLinkResponse({ id: "plink_1", short_url: "https://rzp.io/i/abc", order_id: null })).toEqual({ id: "plink_1", shortUrl: "https://rzp.io/i/abc", orderId: null })
    expect(parsePaymentLinkResponse({ id: "plink_1", short_url: "http://rzp.io/i/abc" })).toBeNull()
    expect(parsePaymentLinkResponse({ id: "plink_1" })).toBeNull()
    expect(parsePaymentLinkResponse(null)).toBeNull()
    expect(parsePaymentLinkResponse({ error: { description: "bad" } })).toBeNull()
  })
  test("the request: yearly only, no amount accepted from the browser", () => {
    expect(parseCreateRequest({})).toEqual({ ok: true, interval: "year", orgId: null })
    expect(parseCreateRequest({ interval: "year", orgId: "org1" })).toEqual({ ok: true, interval: "year", orgId: "org1" })
    expect(parseCreateRequest({ interval: "month" }).ok).toBe(false)
    expect(parseCreateRequest(null).ok).toBe(false)
    const withAmount = parseCreateRequest({ interval: "year", amountPaise: 1 })
    expect(withAmount.ok && Object.keys(withAmount)).not.toContain("amountPaise")
  })
  test("Basic auth header and the 'keys present' check", () => {
    expect(basicAuthHeader("rzp_test_id", "sec")).toBe("Basic " + Buffer.from("rzp_test_id:sec").toString("base64"))
    expect(razorpayConfigured("id", "secret")).toBe(true)
    for (const [a, b] of [["", "x"], ["x", ""], [null, "x"], ["x", undefined], ["  ", "x"]] as const) expect(razorpayConfigured(a, b)).toBe(false)
  })
  test("CORS: only an allow-listed origin is echoed, never a wildcard", () => {
    const allowed = ["https://dpdp.veridian-aios.com", "https://veridian-aios.com/"]
    expect(corsHeadersFor("https://dpdp.veridian-aios.com", allowed)["Access-Control-Allow-Origin"]).toBe("https://dpdp.veridian-aios.com")
    expect(corsHeadersFor("https://veridian-aios.com", allowed)["Access-Control-Allow-Origin"]).toBe("https://veridian-aios.com")
    expect(corsHeadersFor("https://evil.example", allowed)["Access-Control-Allow-Origin"]).toBeUndefined()
    expect(corsHeadersFor(null, allowed)["Access-Control-Allow-Origin"]).toBeUndefined()
  })
})

describe("the migration and the app agree", () => {
  const sql = readFileSync("drizzle/0673_dpdp_razorpay_sales_lifecycle.sql", "utf8")
  test("the first line is the DDL-authorization citation CI requires", () => {
    expect(sql.split("\n")[0]).toMatch(/^-- PRE-APPROVED-LIVE-DDL: Owner instruction in chat, 2026-10-01 -- "NEED TO INTEGRATE RAZORPAY/)
  })
  test("the server-side price equals the constants BillingPanel shows (one number, two places, kept equal by this test)", () => {
    const panel = readFileSync("dpdp-app/src/components/BillingPanel.tsx", "utf8")
    const year = Number(/YEARLY_PAISE\s*=\s*([\d_]+)/.exec(panel)?.[1]?.replace(/_/g, ""))
    const month = Number(/MONTHLY_PAISE\s*=\s*([\d_]+)/.exec(panel)?.[1]?.replace(/_/g, ""))
    expect(year).toBe(999900)
    expect(month).toBe(199900)
    expect(sql).toContain(`when p_plan in ('firm', 'institution') and p_interval = 'year' then ${year}`)
    expect(sql).toContain(`when p_plan in ('firm', 'institution') and p_interval = 'month' then ${month}`)
    expect(sql).toContain(`'yearPaise', ${year}`)
  })
  test("every function the Edge Functions call exists in the migration under that exact name", () => {
    const calls = ["dpdp_pay_begin", "dpdp_pay_attempt_link", "dpdp_pay_attempt_cancel", "dpdp_pay_attempt_lookup", "dpdp_pay_confirm", "dpdp_pay_log_event",
      "dpdp_sales_due_reminders", "dpdp_sales_reminder_claim", "dpdp_sales_reminder_mark", "dpdp_billing_prices"]
    for (const fn of calls) expect(sql).toContain(`create or replace function public.${fn}(`)
    const pay = readFileSync("supabase/functions/dpdp-pay/index.ts", "utf8") + readFileSync("supabase/functions/dpdp-lifecycle-email/index.ts", "utf8")
    for (const fn of calls) expect(pay).toContain(`"${fn}"`)
  })
  test("parameter names the functions send match the SQL (PostgREST matches by name; a wrong name is 'function not found')", () => {
    const pay = readFileSync("supabase/functions/dpdp-pay/index.ts", "utf8")
    for (const name of ["p_payment_link_id", "p_order_id", "p_reference_id", "p_event_id", "p_event_type", "p_payment_id", "p_amount_paise", "p_currency", "p_method", "p_attempt_id", "p_short_url", "p_outcome", "p_interval"]) {
      expect(pay).toContain(name)
      expect(sql).toContain(name)
    }
  })
  test("the journal registers 0673 with a later 'when' than every earlier entry", () => {
    const j = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")) as { entries: Array<{ idx: number; when: number; tag: string }> }
    const mine = j.entries.find((e) => e.tag === "0673_dpdp_razorpay_sales_lifecycle")
    expect(mine).toBeDefined()
    expect(Math.max(...j.entries.filter((e) => e.idx < mine!.idx).map((e) => e.when))).toBeLessThan(mine!.when)
  })
  test("no key, secret or token value is committed in the function sources", () => {
    for (const f of ["supabase/functions/dpdp-pay/index.ts", "supabase/functions/dpdp-pay/logic.ts", "supabase/functions/dpdp-lifecycle-email/index.ts"]) {
      expect(readFileSync(f, "utf8")).not.toMatch(/rzp_(live|test)_[A-Za-z0-9]{6,}/)
    }
  })
})
