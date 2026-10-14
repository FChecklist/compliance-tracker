// DPDP online payment (Razorpay) -- the PURE half of the dpdp-pay Edge Function.
//
// No Deno global, no network, no database, no clock: every decision the function makes
// about money lives here so bun can test it (src/lib/services/dpdp-pay-logic.test.ts) the
// same way dpdp-ai-link's router.ts is tested. index.ts only wires these to fetch and Supabase.
//
// WHAT RAZORPAY IS USED FOR (changed 2026-10-11, see the ORDER section below): an Order per attempt, paid in Razorpay's window inside the registered
// IT Services pay frame. (Before: a hosted Payment Link; the link builders remain for old links still in flight.) The customer
// pays on Razorpay's own window, so no card field, no Razorpay script and no card data ever
// touches our site or our database. We then LEARN that they paid from a signed webhook, never
// from the browser coming back (the browser can be closed, or forged).
//
// THE RULES THE FUNCTIONS BELOW ENFORCE
//   * A webhook is believed only if X-Razorpay-Signature equals HMAC-SHA256(RAW body, secret),
//     compared in constant time. An empty secret or empty signature is never a match.
//   * Only payment.captured / payment_link.paid / order.paid, and only for a payment whose own
//     status is "captured", can record money.
//   * A payment is recorded against OUR attempt row (found by the payment-link id, the order id
//     or the reference id we set), never against whatever org id a payload's notes claim.
//     Notes are only a cross-check: if they name a different org the payment is refused.
//   * The amount and currency must equal what we asked Razorpay for. Different -> refused.
//   * The same Razorpay payment id is recorded at most once, however many events or retries
//     carry it (payment.captured and payment_link.paid both fire for one payment).
//   * A second, different payment id for an attempt that is already paid is NOT recorded
//     automatically: it is flagged for the owner (it is real money that needs a human).

import { CONSENT_REQUIRED_CODE, CONSENT_REQUIRED_MESSAGE, TERMS_VERSION } from "../_shared/terms.ts"

export const RAZORPAY_API = "https://api.razorpay.com/v1"

/** Events that can record money. Anything else that is validly signed is acknowledged and ignored. */
export const SUPPORTED_EVENTS = ["payment.captured", "payment_link.paid", "order.paid"] as const
export type SupportedEvent = (typeof SUPPORTED_EVENTS)[number]

export type Interval = "month" | "year"

// ---------------------------------------------------------------------
// Signature
// ---------------------------------------------------------------------

/** Equal length and equal bytes, without stopping at the first difference. */
export function constantTimeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a)
  const eb = new TextEncoder().encode(b)
  if (ea.length !== eb.length) return false
  let diff = 0
  for (let i = 0; i < ea.length; i++) diff |= ea[i] ^ eb[i]
  return diff === 0
}

/** Lowercase hex of HMAC-SHA256(message, secret) -- what Razorpay puts in X-Razorpay-Signature. */
export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(message)))
  return Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join("")
}

/**
 * True only when `signature` is the HMAC of the RAW request body under `secret`. The body must be the exact
 * text Razorpay sent (not re-serialised JSON: one changed space changes the signature). An empty secret or an
 * empty signature is never valid -- a missing secret must not turn into "everything verifies".
 */
export async function verifyWebhookSignature(rawBody: string, signature: string | null | undefined, secret: string | null | undefined): Promise<boolean> {
  const s = (signature ?? "").trim().toLowerCase()
  if (!secret || !s || !/^[0-9a-f]{64}$/.test(s)) return false
  const expected = await hmacSha256Hex(secret, rawBody)
  return constantTimeEqual(expected, s)
}

// ---------------------------------------------------------------------
// Reading a webhook
// ---------------------------------------------------------------------

export type CapturedPayment = {
  /** X-Razorpay-Event-Id when present, else a stable key made from the event type and payment id. */
  eventId: string
  eventType: SupportedEvent
  paymentId: string
  orderId: string | null
  paymentLinkId: string | null
  referenceId: string | null
  amountPaise: number
  currency: string
  method: string | null
  /** The notes we put on the link/order (org_id, attempt_id, interval). A cross-check only, never the source of truth. */
  notes: { orgId: string | null; attemptId: string | null; interval: string | null }
}

export type ParsedWebhook =
  | { kind: "payment"; payment: CapturedPayment }
  /** Validly signed but not something that records money (another event type, or a payment that is not captured). Answer 200 so Razorpay stops retrying. */
  | { kind: "ignored"; reason: "unsupported_event" | "not_captured" }
  /** Not a webhook body we can read at all. Answer 400. */
  | { kind: "invalid"; reason: "bad_json" | "bad_shape" | "no_payment" | "bad_amount" }

type Json = Record<string, unknown>
const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v)
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null)

/** The notes object of an entity, with only the three keys we read, each only if it is a non-empty string. */
export function parseNotes(entity: unknown): CapturedPayment["notes"] {
  const n = isObj(entity) && isObj(entity.notes) ? entity.notes : {}
  return { orgId: str(n.org_id), attemptId: str(n.attempt_id), interval: str(n.interval) }
}

function mergeNotes(...parts: CapturedPayment["notes"][]): CapturedPayment["notes"] {
  const out: CapturedPayment["notes"] = { orgId: null, attemptId: null, interval: null }
  for (const p of parts) {
    out.orgId ??= p.orgId
    out.attemptId ??= p.attemptId
    out.interval ??= p.interval
  }
  return out
}

/** Reads a verified webhook body. Never throws. */
export function parseWebhookEvent(rawBody: string, eventIdHeader?: string | null): ParsedWebhook {
  let body: unknown
  try {
    body = JSON.parse(rawBody)
  } catch {
    return { kind: "invalid", reason: "bad_json" }
  }
  if (!isObj(body) || typeof body.event !== "string") return { kind: "invalid", reason: "bad_shape" }
  const eventType = body.event as string
  if (!(SUPPORTED_EVENTS as readonly string[]).includes(eventType)) return { kind: "ignored", reason: "unsupported_event" }
  const payload = isObj(body.payload) ? body.payload : null
  if (!payload) return { kind: "invalid", reason: "bad_shape" }

  const payEntity = isObj(payload.payment) && isObj(payload.payment.entity) ? payload.payment.entity : null
  const orderEntity = isObj(payload.order) && isObj(payload.order.entity) ? payload.order.entity : null
  const linkEntity = isObj(payload.payment_link) && isObj(payload.payment_link.entity) ? payload.payment_link.entity : null
  const paymentId = str(payEntity?.id)
  if (!payEntity || !paymentId) return { kind: "invalid", reason: "no_payment" }
  if (str(payEntity.status) !== "captured") return { kind: "ignored", reason: "not_captured" }

  const amount = payEntity.amount
  if (typeof amount !== "number" || !Number.isInteger(amount) || amount <= 0) return { kind: "invalid", reason: "bad_amount" }
  const currency = (str(payEntity.currency) ?? "").toUpperCase()

  const header = (eventIdHeader ?? "").trim()
  return {
    kind: "payment",
    payment: {
      eventId: header !== "" ? header.slice(0, 120) : `${eventType}:${paymentId}`,
      eventType: eventType as SupportedEvent,
      paymentId,
      orderId: str(payEntity.order_id) ?? str(orderEntity?.id) ?? str(linkEntity?.order_id),
      paymentLinkId: str(linkEntity?.id),
      referenceId: str(linkEntity?.reference_id),
      amountPaise: amount,
      currency,
      method: str(payEntity.method),
      notes: mergeNotes(parseNotes(linkEntity), parseNotes(orderEntity), parseNotes(payEntity)),
    },
  }
}

// ---------------------------------------------------------------------
// The decision
// ---------------------------------------------------------------------

/** What the database knows about the attempt a payment claims to belong to (dpdp_pay_attempt_lookup). */
export type AttemptFacts = {
  id: string
  orgId: string
  status: "created" | "paid" | "mismatch" | "expired" | "cancelled"
  amountPaise: number
  currency: string
  razorpayPaymentId: string | null
}

export type Decision =
  | { action: "record" }
  /** This exact Razorpay payment is already recorded: do nothing, answer 200. */
  | { action: "duplicate" }
  /** Another payment landed on an attempt that is already paid: real money, needs a human, never auto-recorded. */
  | { action: "flag"; reason: "attempt_already_paid" }
  | { action: "reject"; reason: "unknown_order" | "currency_mismatch" | "amount_mismatch" | "org_mismatch" }

/**
 * Whether to record a captured payment against the attempt we found for it. Order matters: "already recorded"
 * is checked first so a replay of a payment we accepted is a quiet duplicate even if something about the
 * attempt looks different now.
 */
export function decideWebhook(p: CapturedPayment, attempt: AttemptFacts | null): Decision {
  if (!attempt) return { action: "reject", reason: "unknown_order" }
  if (attempt.status === "paid") {
    return attempt.razorpayPaymentId === p.paymentId ? { action: "duplicate" } : { action: "flag", reason: "attempt_already_paid" }
  }
  if (p.notes.orgId && p.notes.orgId !== attempt.orgId) return { action: "reject", reason: "org_mismatch" }
  if (p.currency !== attempt.currency.toUpperCase()) return { action: "reject", reason: "currency_mismatch" }
  if (p.amountPaise !== attempt.amountPaise) return { action: "reject", reason: "amount_mismatch" }
  return { action: "record" }
}

/** HTTP answer for a decision (after the database call, if any, succeeded). 4xx only for what we refuse to believe. */
export function httpStatusFor(d: Decision): number {
  switch (d.action) {
    case "record":
    case "duplicate":
    case "flag":
      return 200
    case "reject":
      return d.reason === "unknown_order" ? 404 : 400
  }
}

// ---------------------------------------------------------------------
// Creating the payment link
// ---------------------------------------------------------------------

/** "Basic <base64(key_id:key_secret)>" for Razorpay's REST API. */
export function basicAuthHeader(keyId: string, keySecret: string): string {
  return "Basic " + btoa(`${keyId}:${keySecret}`)
}

export type LinkRequest = {
  attemptId: string
  orgId: string
  orgName: string
  interval: Interval
  amountPaise: number
  currency: string
  ownerEmail: string | null
  /** https URL the customer is sent back to after paying. Must be https for Razorpay. */
  callbackUrl: string
}

/** The JSON body for POST /v1/payment_links. reference_id is OUR attempt id: Razorpay echoes it back in the paid webhook. */
export function buildPaymentLinkBody(r: LinkRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {
    amount: r.amountPaise,
    currency: r.currency,
    accept_partial: false,
    reference_id: r.attemptId,
    description: `VERIDIAN DPDP ${r.interval === "year" ? "yearly" : "monthly"} plan -- ${r.orgName}`.slice(0, 2000),
    notify: { sms: false, email: false },
    reminder_enable: false,
    notes: { org_id: r.orgId, attempt_id: r.attemptId, interval: r.interval },
    callback_url: r.callbackUrl,
    callback_method: "get",
  }
  if (r.ownerEmail) body.customer = { email: r.ownerEmail }
  return body
}

// ---------------------------------------------------------------------
// Creating an ORDER (the method Corporate Tambola uses; replaces the Payment Link, 2026-10-11)
// ---------------------------------------------------------------------
//
// Owner decision: every product takes money the same way. The server creates a Razorpay ORDER (price fixed here, never by the browser); the
// Razorpay window runs inside the registered website's pay frame (IT Services by Rajat Agarwal, PAY_HOP_URL); the browser then only REPORTS
// the signed result, and /verify checks the signature AND asks Razorpay what really happened before anything is booked. The webhook stays as
// the backstop for a buyer who closes the tab.

/** Which product and which variation a payment is for. Written on the Razorpay order (notes + receipt) AND on our own attempt row, so any payment can be traced both ways. */
export const PRODUCT_CODE = "veridian_dpdp"
/** variation = the plan the buyer is on + the interval (the database writes it: dpdp_pay_begin). Falls back to edition_interval for an older database. */
export const productNotes = (plan: string, interval: string, variation?: string | null): { product: string; variation: string } => ({ product: PRODUCT_CODE, variation: (variation && variation.trim()) || `${plan}_${interval}` })

/** Receipt: "dpdp_" + our attempt id, at most 40 characters (Razorpay's limit). Starts with the product so a Razorpay export alone shows what each payment was for. */
export const receiptFor = (attemptId: string): string => `dpdp_${attemptId}`.slice(0, 40)

/** The id that ties Razorpay (A), the central ledger (B) and our own ledger (C) together for ONE website payment (= one "Pay online" press = one dpdp.payment_attempt row):
 *  "DPD-" + the receipt. The central service builds the same text from the payment_ref we send it (its SITE_CODES entry for veridian-aios.com), and the database column
 *  dpdp.payment_attempt.txn_id (drizzle/0749) is generated from the attempt id with the same recipe, so none of the three can drift. A bun test compares them. */
export const SITE_CODE = "DPD"
export const txnIdOf = (attemptId: string): string => `${SITE_CODE}-${receiptFor(attemptId)}`

export type OrderRequest = {
  attemptId: string
  orgId: string
  orgName: string
  plan: string
  variation?: string
  interval: Interval
  amountPaise: number
  currency: string
}

/** The JSON body for POST /v1/orders. Notes carry product + variation + our ids; they are a cross-check, our attempt row stays the source of truth. */
export function buildOrderBody(r: OrderRequest): Record<string, unknown> {
  return {
    amount: r.amountPaise,
    currency: r.currency,
    receipt: receiptFor(r.attemptId),
    notes: { ...productNotes(r.plan, r.interval, r.variation), site: CENTRAL_SITE, stream: "sales", txn_id: txnIdOf(r.attemptId), org_id: r.orgId, attempt_id: r.attemptId, interval: r.interval, plan: r.plan, organisation: r.orgName.slice(0, 80) },
  }
}

/** Central payments (owner order 2026-10-12): the order is opened through IT Services by Rajat Agarwal, so it lands in its ONE Razorpay ledger as
 *  razorpay / IT Services / veridian-aios.com / sales / <variation>. This builds the request to its POST /api/pay/order. */
export const CENTRAL_SITE = "veridian-aios.com"
export function buildCentralOrderBody(r: OrderRequest & { ownerEmail?: string | null }): Record<string, unknown> {
  const { variation } = productNotes(r.plan, r.interval, r.variation)
  return {
    site: CENTRAL_SITE, product: PRODUCT_CODE, plan: variation, amount_minor: r.amountPaise, currency: r.currency, payment_ref: receiptFor(r.attemptId), user: r.orgId,
    ...(r.ownerEmail ? { payer_email: r.ownerEmail } : {}),
    extra_notes: { org_id: r.orgId, attempt_id: r.attemptId, interval: r.interval, edition: r.plan, organisation: r.orgName.slice(0, 80) },
  }
}

export function parseOrderResponse(body: unknown): { id: string } | null {
  if (!isObj(body)) return null
  const id = str(body.id)
  return id && /^order_\w{6,40}$/.test(id) ? { id } : null
}

/** What the browser's Razorpay window needs. UPI first, as on the other products. */
export function buildCheckoutOptions(o: { keyId: string; orderId: string; amountPaise: number; currency: string; orgName: string; plan: string; variation?: string; interval: Interval; ownerEmail: string | null }): Record<string, unknown> {
  const edition = o.plan === "institution" ? "Institution" : "Firm"
  return {
    key: o.keyId,
    order_id: o.orderId,
    amount: o.amountPaise,
    currency: o.currency,
    name: "VERIDIAN DPDP",
    description: `${edition} plan, yearly | IT Services by Rajat Agarwal`,
    prefill: o.ownerEmail ? { email: o.ownerEmail } : {},
    notes: { ...productNotes(o.plan, o.interval, o.variation) },
    theme: { color: "#0E7C6E" },
    config: { display: { blocks: { upi: { name: "Pay with UPI", instruments: [{ method: "upi" }] }, other: { name: "Cards, net banking, wallets", instruments: [{ method: "card" }, { method: "netbanking" }, { method: "wallet" }] } }, sequence: ["block.upi", "block.other"], preferences: { show_default_blocks: false } } },
  }
}

/** The three fields Razorpay's window hands the browser. Anything else is refused before we spend a network call. */
export function parseVerifyRequest(body: unknown): { ok: true; orderId: string; paymentId: string; signature: string } | { ok: false } {
  if (!isObj(body)) return { ok: false }
  const orderId = str(body.razorpay_order_id) ?? ""
  const paymentId = str(body.razorpay_payment_id) ?? ""
  const signature = (str(body.razorpay_signature) ?? "").toLowerCase()
  if (!/^order_\w{6,40}$/.test(orderId) || !/^pay_\w{6,40}$/.test(paymentId) || !/^[0-9a-f]{64}$/.test(signature)) return { ok: false }
  return { ok: true, orderId, paymentId, signature }
}

/** Razorpay's checkout signature: HMAC-SHA256("order_id|payment_id", key secret). An empty secret never verifies. */
export async function verifyCheckoutSignature(orderId: string, paymentId: string, signature: string, keySecret: string | null | undefined): Promise<boolean> {
  if (!keySecret || !/^[0-9a-f]{64}$/.test(signature)) return false
  return constantTimeEqual(await hmacSha256Hex(keySecret, `${orderId}|${paymentId}`), signature)
}

export type VerifyOutcome =
  | { kind: "payment"; payment: CapturedPayment }
  /** Razorpay has not captured it (yet). 202 = ask again shortly; 402 = failed. */
  | { kind: "pending" }
  | { kind: "failed"; status: string }
  | { kind: "mismatch" }

/** Builds a CapturedPayment from what Razorpay itself says about the order and payment (never from what the browser said). */
export function capturedFromRazorpay(order: unknown, pay: unknown, orderId: string): VerifyOutcome {
  if (!isObj(order) || !isObj(pay)) return { kind: "mismatch" }
  const paymentId = str(pay.id)
  if (!paymentId || str(pay.order_id) !== orderId || str(order.id) !== orderId) return { kind: "mismatch" }
  if (typeof pay.amount !== "number" || !Number.isInteger(pay.amount) || pay.amount !== order.amount) return { kind: "mismatch" }
  const status = str(pay.status) ?? ""
  if (status === "created") return { kind: "pending" }
  if (status !== "captured") return { kind: "failed", status }
  return {
    kind: "payment",
    payment: {
      eventId: `verify:${paymentId}`,
      eventType: "order.paid",
      paymentId,
      orderId,
      paymentLinkId: null,
      referenceId: null,
      amountPaise: pay.amount,
      currency: (str(pay.currency) ?? "").toUpperCase(),
      method: str(pay.method),
      notes: mergeNotes(parseNotes(order), parseNotes(pay)),
    },
  }
}

/** The fields we keep from Razorpay's answer, or null if it did not give a usable link. */
export function parsePaymentLinkResponse(body: unknown): { id: string; shortUrl: string; orderId: string | null } | null {
  if (!isObj(body)) return null
  const id = str(body.id)
  const shortUrl = str(body.short_url)
  if (!id || !shortUrl || !/^https:\/\//.test(shortUrl)) return null
  return { id, shortUrl, orderId: str(body.order_id) }
}

/** What the caller may ask for. Online payment is the yearly plan only (the one plan actually sold). */
export function parseCreateRequest(body: unknown): { ok: true; interval: Interval; orgId: string | null } | { ok: false; error: string } {
  if (!isObj(body)) return { ok: false, error: "Send a JSON body" }
  const interval = body.interval ?? "year"
  if (interval !== "year") return { ok: false, error: "Online payment is for the yearly plan" }
  const orgId = str(body.orgId)
  return { ok: true, interval: "year", orgId }
}

/**
 * The K3 box ("I agree to the Terms and the Refund Policy.") as the request carries it. `given` is true only for the CURRENT Terms version
 * AND a boolean true: anything else (missing, "true" as a string, an older version) is not a tick. The database re-checks the same two
 * things and is the authority; this early refusal just saves a Razorpay round trip and gives the browser the same sentence and code.
 */
export function readTermsConsent(body: unknown): { version: string | null; accepted: boolean; given: boolean } {
  const o = isObj(body) ? body : {}
  const version = typeof o.termsVersion === "string" ? o.termsVersion : null
  const accepted = o.termsAccepted === true
  return { version, accepted, given: accepted && version === TERMS_VERSION }
}

/** The refusal body for a payment request without the tick: HTTP 400, this sentence, this code. */
export const CONSENT_REQUIRED_BODY = { error: CONSENT_REQUIRED_MESSAGE, code: CONSENT_REQUIRED_CODE } as const

/** Razorpay credentials present? Both halves, non-empty. Webhook secret is checked separately (it is not needed to create a link). */
export function razorpayConfigured(keyId: string | null | undefined, keySecret: string | null | undefined): boolean {
  return !!(keyId && keyId.trim() && keySecret && keySecret.trim())
}

/** CORS headers for the create endpoint: the caller's Origin is echoed only if it is on the allow-list, never "*". The webhook needs none. */
export function corsHeadersFor(origin: string | null | undefined, allowed: readonly string[]): Record<string, string> {
  const base: Record<string, string> = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  }
  const o = (origin ?? "").trim().replace(/\/+$/, "")
  if (o && allowed.some((a) => a.replace(/\/+$/, "") === o)) base["Access-Control-Allow-Origin"] = o
  return base
}

export function rupeesLabel(paise: number): string {
  return `Rs ${(paise / 100).toLocaleString("en-IN")}`
}
