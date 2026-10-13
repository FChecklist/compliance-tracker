// DPDP online payment through Razorpay -- the Edge Function. Two endpoints, one deploy:
//
//   POST /dpdp-pay            the signed-in ORG OWNER asks to pay online. Creates a Razorpay ORDER (the same
//                             method as Corporate Tambola) and returns what the pay frame needs to open
//                             Razorpay's window. Nothing about a card ever reaches our site or database.
//   POST /dpdp-pay/verify     the browser reports the signed result; checked, then confirmed with Razorpay.
//   POST /dpdp-pay/webhook    Razorpay tells us a payment was captured. Signature-verified,
//                             amount/currency-checked, recorded once, then the existing
//                             dpdp_record_confirmed_payment flips the org active and creates
//                             the referral commission. A receipt email follows.
//
// Pure decisions (signature, event reading, amount/currency/idempotency, request bodies) are
// in logic.ts and unit-tested. This file only wires them to fetch and Supabase.
//
// DEPLOY: verify_jwt FALSE. The webhook is called by Razorpay, which cannot send a Supabase
// JWT, so the platform must not refuse it. The create endpoint does its own check: it forwards
// the caller's own Authorization header to the database, where dpdp_pay_begin resolves
// auth.jwt() and refuses anyone who is not an owner of that organisation.
//
// SECRETS (Edge function secrets, set by the Owner in the Supabase dashboard; none are in this
// repo and none are ever logged or echoed):
//   RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET   -- to create a Payment Link
//   RAZORPAY_WEBHOOK_SECRET                -- to verify a webhook
// Platform-injected: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY. Optional:
// RESEND_API_KEY / DPDP_EMAIL_FROM (the receipt; no key = the receipt is recorded as a dry run),
// APP_ORIGIN (where the customer returns to after paying; default https://dpdp.veridian-aios.com).
//
// WHEN KEYS ARE MISSING the function answers 503 {"error":"Online payment is not switched on
// yet","code":"not_enabled"} and the app falls back to the bank-transfer / "I have paid" path,
// which is unchanged. Nothing breaks before the Owner adds the keys.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2"
import { buildOutbound, foreignSenderWarning, logOutbound, resolveFrom } from "../_shared/mail-outbound.ts"
import { isDeliverableAddress, renderReceipt, sendViaResend } from "../_shared/billing-mail.ts"
import { CONSENT_REQUIRED_CODE } from "../_shared/terms.ts"
import {
  type AttemptFacts, type CapturedPayment, CONSENT_REQUIRED_BODY, RAZORPAY_API, basicAuthHeader, buildCentralOrderBody, buildCheckoutOptions, buildOrderBody, capturedFromRazorpay, corsHeadersFor, decideWebhook,
  httpStatusFor, parseCreateRequest, parseOrderResponse, parseVerifyRequest, parseWebhookEvent, razorpayConfigured, readTermsConsent, receiptFor, verifyCheckoutSignature,
  verifyWebhookSignature,
} from "./logic.ts"

const env = (k: string): string => Deno.env.get(k) ?? ""
const SUPABASE_URL = env("SUPABASE_URL")
const ANON_KEY = env("SUPABASE_ANON_KEY")
const SERVICE_ROLE_KEY = env("SUPABASE_SERVICE_ROLE_KEY")
const KEY_ID = env("RAZORPAY_KEY_ID")
const KEY_SECRET = env("RAZORPAY_KEY_SECRET")
const WEBHOOK_SECRET = env("RAZORPAY_WEBHOOK_SECRET")
const RESEND_API_KEY = env("RESEND_API_KEY")
const EMAIL_FROM = resolveFrom(env("DPDP_EMAIL_FROM"))
// Where Razorpay's window runs: a page of the website registered with Razorpay (IT Services by Rajat Agarwal). The same frame Corporate Tambola uses.
const PAY_HOP_URL = env("PAY_HOP_URL") || "https://itservices-rajat-agarwal.pages.dev/payframe/"
// Central payments: the website's key for IT Services' payment service (secret PAY_SERVICE_KEY). Unset, or the service unreachable = the order is opened directly with Razorpay as before.
const PAY_SERVICE_KEY = env("PAY_SERVICE_KEY")
const PAY_SERVICE_URL = (env("PAY_SERVICE_URL") || "https://itservices-rajat-agarwal.pages.dev").replace(/\/+$/, "")
const APP_ORIGIN = (env("APP_ORIGIN") || "https://dpdp.veridian-aios.com").replace(/\/+$/, "")
const SENDER_WARNING = foreignSenderWarning(EMAIL_FROM)
if (SENDER_WARNING) console.warn(SENDER_WARNING)

const NOT_ENABLED = "Online payment is not switched on yet"
const MAX_BODY_BYTES = 256 * 1024

function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...extra } })
}

const serviceClient = (): SupabaseClient => createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
const callerClient = (authHeader: string): SupabaseClient =>
  createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: authHeader } } })

// ---------------------------------------------------------------------
// POST /dpdp-pay -- the owner asks for a payment link
// ---------------------------------------------------------------------
async function createLink(req: Request, cors: Record<string, string>): Promise<Response> {
  if (!razorpayConfigured(KEY_ID, KEY_SECRET)) return json({ error: NOT_ENABLED, code: "not_enabled" }, 503, cors)
  const authHeader = req.headers.get("authorization") ?? ""
  if (!authHeader) return json({ error: "Sign in first" }, 401, cors)

  let body: unknown
  try {
    body = await req.json()
  } catch {
    body = {}
  }
  const parsed = parseCreateRequest(body)
  if (!parsed.ok) return json({ error: parsed.error }, 400, cors)

  // The K3 box: no ticked box for the CURRENT Terms version, no order. The database refuses the same way (drizzle/0748); this saves the round trip.
  const consent = readTermsConsent(body)
  if (!consent.given) return json(CONSENT_REQUIRED_BODY, 400, cors)

  // Owner check + price + attempt row + the recorded tick, all in the database under the caller's own JWT.
  const { data, error } = await callerClient(authHeader).rpc("dpdp_pay_begin", {
    p_interval: parsed.interval, ...(parsed.orgId ? { p_org_id: parsed.orgId } : {}), p_terms_version: consent.version, p_terms_accepted: consent.accepted,
  })
  if (error) {
    if ((error as { hint?: string }).hint === CONSENT_REQUIRED_CODE) return json(CONSENT_REQUIRED_BODY, 400, cors)
    const status = error.code === "42501" ? 403 : error.code === "22023" ? 400 : 500
    return json({ error: status === 500 ? "Could not start the payment" : error.message }, status, cors)
  }
  const a = data as { attemptId: string; orgId: string; orgName: string; plan?: string; variation?: string; interval: "year"; amountPaise: number; currency: string; ownerEmail: string | null }
  const plan = a.plan === "institution" ? "institution" : "firm"

  const sb = serviceClient()
  let order: ReturnType<typeof parseOrderResponse> = null
  if (PAY_SERVICE_KEY) {
    try {
      const res = await fetch(`${PAY_SERVICE_URL}/api/pay/order`, {
        method: "POST", headers: { "Content-Type": "application/json", "x-site-key": PAY_SERVICE_KEY }, signal: AbortSignal.timeout(6000),
        body: JSON.stringify(buildCentralOrderBody({ attemptId: a.attemptId, orgId: a.orgId, orgName: a.orgName, plan, variation: a.variation, interval: a.interval, amountPaise: a.amountPaise, currency: a.currency, ownerEmail: a.ownerEmail })),
      })
      const payload = (await res.json().catch(() => null)) as { orderId?: string } | null
      if (res.ok && payload?.orderId) order = parseOrderResponse({ id: payload.orderId })
      else console.warn(`dpdp-pay: central order refused with HTTP ${res.status}`)
    } catch (e) {
      console.warn(`dpdp-pay: central order unreachable: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  if (!order) try {
    const res = await fetch(`${RAZORPAY_API}/orders`, {
      method: "POST",
      headers: { Authorization: basicAuthHeader(KEY_ID, KEY_SECRET), "Content-Type": "application/json" },
      body: JSON.stringify(buildOrderBody({ attemptId: a.attemptId, orgId: a.orgId, orgName: a.orgName, plan, variation: a.variation, interval: a.interval, amountPaise: a.amountPaise, currency: a.currency })),
    })
    const payload = await res.json().catch(() => null)
    if (res.ok) order = parseOrderResponse(payload)
    else console.warn(`dpdp-pay: Razorpay refused an order with HTTP ${res.status}`) // status only: never the body, never a key
  } catch (e) {
    console.warn(`dpdp-pay: Razorpay call failed: ${e instanceof Error ? e.message : String(e)}`)
  }
  if (!order) {
    await sb.rpc("dpdp_pay_attempt_cancel", { p_attempt_id: a.attemptId })
    return json({ error: "Razorpay did not accept the request. Try again in a minute, or pay by bank transfer and press \"I have paid\"." }, 502, cors)
  }
  const { error: linkErr } = await sb.rpc("dpdp_pay_attempt_order", { p_attempt_id: a.attemptId, p_order_id: order.id, p_receipt: receiptFor(a.attemptId) })
  if (linkErr) {
    console.warn(`dpdp-pay: could not store the order for attempt ${a.attemptId}: ${linkErr.message}`)
    return json({ error: "Could not start the payment" }, 500, cors)
  }
  return json({
    ok: true, hop: PAY_HOP_URL, attemptId: a.attemptId, amountPaise: a.amountPaise, currency: a.currency,
    razorpay: buildCheckoutOptions({ keyId: KEY_ID, orderId: order.id, amountPaise: a.amountPaise, currency: a.currency, orgName: a.orgName, plan, variation: a.variation, interval: a.interval, ownerEmail: a.ownerEmail }),
  }, 200, cors)
}

/** Tell the central ledger (IT Services) about a verified payment. Best effort: it never blocks or fails the buyer; the central webhook records it too. */
async function reportToCentral(orderId: string, paymentId: string, signature: string): Promise<void> {
  if (!PAY_SERVICE_KEY) return
  try {
    await fetch(`${PAY_SERVICE_URL}/api/pay/verify`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-site-key": PAY_SERVICE_KEY }, signal: AbortSignal.timeout(4000),
      body: JSON.stringify({ site: "veridian-aios.com", razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signature }),
    })
  } catch { /* the central webhook records it */ }
}

// ---------------------------------------------------------------------
// POST /dpdp-pay/verify -- the browser reports Razorpay's signed result; we check it, then ask Razorpay
// ---------------------------------------------------------------------
async function verify(req: Request, cors: Record<string, string>): Promise<Response> {
  if (!razorpayConfigured(KEY_ID, KEY_SECRET)) return json({ error: NOT_ENABLED, code: "not_enabled" }, 503, cors)
  const raw = await req.text()
  if (raw.length > 4096) return json({ error: "Request too large" }, 413, cors)
  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    body = null
  }
  const v = parseVerifyRequest(body)
  if (!v.ok) return json({ error: "We could not match this payment." }, 400, cors)
  if (!(await verifyCheckoutSignature(v.orderId, v.paymentId, v.signature, KEY_SECRET))) {
    return json({ error: "The payment could not be verified. If money was taken, write to us with your payment ID." }, 400, cors)
  }
  // Ask Razorpay itself: the browser's word is never enough.
  let order: unknown
  let pay: unknown
  try {
    const get = async (path: string) => {
      const r = await fetch(`${RAZORPAY_API}${path}`, { headers: { Authorization: basicAuthHeader(KEY_ID, KEY_SECRET) } })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return await r.json()
    }
    ;[order, pay] = await Promise.all([get(`/orders/${v.orderId}`), get(`/payments/${v.paymentId}`)])
  } catch {
    return json({ error: "We could not reach the payment service to confirm. Your payment is safe; check again in a minute." }, 502, cors)
  }
  const outcome = capturedFromRazorpay(order, pay, v.orderId)
  if (outcome.kind === "mismatch") return json({ error: "The payment details did not match the order." }, 400, cors)
  if (outcome.kind === "pending") return json({ confirming: true }, 202, cors)
  if (outcome.kind === "failed") return json({ error: `The payment is ${outcome.status}. Nothing was charged to your order.` }, 402, cors)

  await reportToCentral(v.orderId, v.paymentId, v.signature)
  const r = await recordCaptured(outcome.payment)
  return json(r.body, r.status, cors)
}

// ---------------------------------------------------------------------
// POST /dpdp-pay/webhook -- Razorpay tells us a payment was captured
// ---------------------------------------------------------------------
async function webhook(req: Request): Promise<Response> {
  if (!WEBHOOK_SECRET) return json({ error: NOT_ENABLED, code: "not_enabled" }, 503)
  const declared = Number(req.headers.get("content-length") ?? "0")
  if (declared > MAX_BODY_BYTES) return json({ error: "Body too large" }, 413)
  const raw = await req.text() // the RAW text: the signature covers these exact bytes
  if (raw.length > MAX_BODY_BYTES) return json({ error: "Body too large" }, 413)

  if (!(await verifyWebhookSignature(raw, req.headers.get("x-razorpay-signature"), WEBHOOK_SECRET))) return json({ error: "Invalid signature" }, 401)

  const parsed = parseWebhookEvent(raw, req.headers.get("x-razorpay-event-id"))
  if (parsed.kind === "invalid") return json({ error: "Unreadable event", reason: parsed.reason }, 400)
  if (parsed.kind === "ignored") return json({ ok: true, ignored: parsed.reason })
  const p = parsed.payment

  const r = await recordCaptured(p)
  return json(r.body, r.status)
}

/** Books one captured payment against its attempt (shared by the webhook and /verify; idempotent per Razorpay payment id). */
async function recordCaptured(p: CapturedPayment): Promise<{ status: number; body: Record<string, unknown> }> {
  const sb = serviceClient()
  const { data: found, error: findErr } = await sb.rpc("dpdp_pay_attempt_lookup", {
    p_payment_link_id: p.paymentLinkId, p_order_id: p.orderId, p_reference_id: p.referenceId ?? p.notes.attemptId,
  })
  if (findErr) {
    console.warn(`dpdp-pay: attempt lookup failed: ${findErr.message}`)
    return { status: 500, body: { error: "Temporary problem, please retry" } } // Razorpay retries a non-2xx
  }
  const decision = decideWebhook(p, (found as AttemptFacts | null) ?? null)

  if (decision.action !== "record") {
    // Refusals and replays are logged (best effort) so the Owner can see money that arrived but was not booked.
    const outcome = decision.action === "duplicate" ? "duplicate" : decision.reason
    await sb.rpc("dpdp_pay_log_event", {
      p_event_id: p.eventId, p_event_type: p.eventType, p_payment_id: p.paymentId, p_attempt_id: (found as AttemptFacts | null)?.id ?? null, p_outcome: outcome,
    })
    return { status: httpStatusFor(decision), body: decision.action === "reject" ? { error: "Payment not recorded", reason: decision.reason } : { ok: true, recorded: false, outcome } }
  }

  const { data: done, error: confirmErr } = await sb.rpc("dpdp_pay_confirm", {
    p_event_id: p.eventId, p_event_type: p.eventType, p_payment_id: p.paymentId, p_payment_link_id: p.paymentLinkId, p_order_id: p.orderId,
    p_reference_id: p.referenceId ?? p.notes.attemptId, p_amount_paise: p.amountPaise, p_currency: p.currency, p_method: p.method,
  })
  if (confirmErr) {
    console.warn(`dpdp-pay: recording payment ${p.paymentId} failed: ${confirmErr.message}`)
    return { status: 500, body: { error: "Temporary problem, please retry" } }
  }
  const r = done as { ok: boolean; duplicate?: boolean; reason?: string; paymentId?: string }
  if (!r.ok) return { status: 400, body: { error: "Payment not recorded", reason: r.reason ?? "refused" } }
  if (r.duplicate || !r.paymentId) return { status: 200, body: { ok: true, recorded: false, outcome: "duplicate" } }

  await sendReceipt(sb, r.paymentId, p.paymentId)
  return { status: 200, body: { ok: true, recorded: true } }
}

/** Receipt for a payment just recorded. Best effort: it can never turn a recorded payment into a failed webhook. Idempotent per payment (same key dpdp-invoice-email uses). */
async function sendReceipt(sb: SupabaseClient, paymentId: string, razorpayPaymentId: string): Promise<void> {
  try {
    const { data: details } = await sb.rpc("dpdp_timer_invoice_details", { p_payment_id: paymentId })
    const d = details as {
      orgId: string; orgName: string; plan: "firm" | "institution"; interval: "month" | "year"; amountPaise: number; periodStart: string; confirmedAt: string
      ownerMembershipId: string | null; ownerIdentityId: string | null; ownerEmail: string | null
    } | null
    if (!d || !d.ownerEmail || !d.ownerMembershipId || !d.ownerIdentityId || !isDeliverableAddress(d.ownerEmail)) return
    const rendered = renderReceipt({ ...d, razorpayPaymentId })
    const out = buildOutbound("invoice", rendered.subject, { from: EMAIL_FROM })
    const dryRun = !RESEND_API_KEY
    const { data: rec, error: recErr } = await sb.rpc("dpdp_timer_record_email_send", {
      p_org_id: d.orgId, p_membership_id: d.ownerMembershipId, p_identity_id: d.ownerIdentityId, p_obligation_ids: [],
      p_kind: "invoice", p_period_key: paymentId, p_to_email: d.ownerEmail, p_subject: out.subject, p_status: dryRun ? "dry_run" : "queued", p_body_text: rendered.text,
    })
    if (recErr) return
    const row = rec as { id: string | null; duplicate?: boolean } | null
    if (dryRun || !row?.id || row.duplicate) return
    try {
      const messageId = await sendViaResend(RESEND_API_KEY, d.ownerEmail, out, rendered)
      await logOutbound(sb, { ref: out.ref, cls: "invoice", to: d.ownerEmail, subject: out.subject, providerMessageId: messageId || null, membershipId: d.ownerMembershipId, orgId: d.orgId })
      await sb.rpc("dpdp_timer_mark_email_send_result", { p_id: row.id, p_status: "sent", p_resend_message_id: messageId })
    } catch (e) {
      await sb.rpc("dpdp_timer_mark_email_send_result", { p_id: row.id, p_status: "failed", p_error: e instanceof Error ? e.message : String(e) })
    }
  } catch (e) {
    console.warn(`dpdp-pay: receipt for ${paymentId} failed: ${e instanceof Error ? e.message : String(e)}`)
  }
}

Deno.serve(async (req: Request) => {
  const cors = corsHeadersFor(req.headers.get("origin"), [APP_ORIGIN, "https://app.veridian-aios.com", "https://dpdp.veridian-aios.com", "https://veridian-aios.com"])
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors })
  if (req.method !== "POST") return json({ error: "POST only" }, 405, cors)
  const path = new URL(req.url).pathname.replace(/\/+$/, "")
  if (path.endsWith("/webhook")) return await webhook(req)
  if (path.endsWith("/verify")) return await verify(req, cors)
  return await createLink(req, cors)
})
