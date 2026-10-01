// DPDP online payment through Razorpay -- the Edge Function. Two endpoints, one deploy:
//
//   POST /dpdp-pay            the signed-in ORG OWNER asks to pay online. Returns the URL of a
//                             Razorpay-hosted Payment Link; the browser goes there. Nothing
//                             about a card ever reaches our site or database.
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
import {
  type AttemptFacts, RAZORPAY_API, basicAuthHeader, buildPaymentLinkBody, corsHeadersFor, decideWebhook, httpStatusFor, parseCreateRequest,
  parsePaymentLinkResponse, parseWebhookEvent, razorpayConfigured, verifyWebhookSignature,
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

  // Owner check + price + attempt row, all in the database under the caller's own JWT.
  const { data, error } = await callerClient(authHeader).rpc("dpdp_pay_begin", { p_interval: parsed.interval, ...(parsed.orgId ? { p_org_id: parsed.orgId } : {}) })
  if (error) {
    const status = error.code === "42501" ? 403 : error.code === "22023" ? 400 : 500
    return json({ error: status === 500 ? "Could not start the payment" : error.message }, status, cors)
  }
  const a = data as { attemptId: string; orgId: string; orgName: string; interval: "year"; amountPaise: number; currency: string; ownerEmail: string | null }

  const sb = serviceClient()
  let link: ReturnType<typeof parsePaymentLinkResponse> = null
  try {
    const res = await fetch(`${RAZORPAY_API}/payment_links`, {
      method: "POST",
      headers: { Authorization: basicAuthHeader(KEY_ID, KEY_SECRET), "Content-Type": "application/json" },
      body: JSON.stringify(buildPaymentLinkBody({
        attemptId: a.attemptId, orgId: a.orgId, orgName: a.orgName, interval: a.interval, amountPaise: a.amountPaise, currency: a.currency,
        ownerEmail: a.ownerEmail, callbackUrl: `${APP_ORIGIN}/app/?payment=returned`,
      })),
    })
    const payload = await res.json().catch(() => null)
    if (res.ok) link = parsePaymentLinkResponse(payload)
    else console.warn(`dpdp-pay: Razorpay refused a payment link with HTTP ${res.status}`) // status only: never the body, never a key
  } catch (e) {
    console.warn(`dpdp-pay: Razorpay call failed: ${e instanceof Error ? e.message : String(e)}`)
  }
  if (!link) {
    await sb.rpc("dpdp_pay_attempt_cancel", { p_attempt_id: a.attemptId })
    return json({ error: "Razorpay did not accept the request. Try again in a minute, or pay by bank transfer and press \"I have paid\"." }, 502, cors)
  }
  const { error: linkErr } = await sb.rpc("dpdp_pay_attempt_link", { p_attempt_id: a.attemptId, p_payment_link_id: link.id, p_short_url: link.shortUrl, p_order_id: link.orderId })
  if (linkErr) {
    console.warn(`dpdp-pay: could not store the payment link for attempt ${a.attemptId}: ${linkErr.message}`)
    return json({ error: "Could not start the payment" }, 500, cors)
  }
  return json({ ok: true, url: link.shortUrl, attemptId: a.attemptId, amountPaise: a.amountPaise, currency: a.currency }, 200, cors)
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

  const sb = serviceClient()
  const { data: found, error: findErr } = await sb.rpc("dpdp_pay_attempt_lookup", {
    p_payment_link_id: p.paymentLinkId, p_order_id: p.orderId, p_reference_id: p.referenceId ?? p.notes.attemptId,
  })
  if (findErr) {
    console.warn(`dpdp-pay: attempt lookup failed: ${findErr.message}`)
    return json({ error: "Temporary problem, please retry" }, 500) // Razorpay retries a non-2xx
  }
  const decision = decideWebhook(p, (found as AttemptFacts | null) ?? null)

  if (decision.action !== "record") {
    // Refusals and replays are logged (best effort) so the Owner can see money that arrived but was not booked.
    const outcome = decision.action === "duplicate" ? "duplicate" : decision.reason
    await sb.rpc("dpdp_pay_log_event", {
      p_event_id: p.eventId, p_event_type: p.eventType, p_payment_id: p.paymentId, p_attempt_id: (found as AttemptFacts | null)?.id ?? null, p_outcome: outcome,
    })
    return json(decision.action === "reject" ? { error: "Payment not recorded", reason: decision.reason } : { ok: true, recorded: false, outcome }, httpStatusFor(decision))
  }

  const { data: done, error: confirmErr } = await sb.rpc("dpdp_pay_confirm", {
    p_event_id: p.eventId, p_event_type: p.eventType, p_payment_id: p.paymentId, p_payment_link_id: p.paymentLinkId, p_order_id: p.orderId,
    p_reference_id: p.referenceId ?? p.notes.attemptId, p_amount_paise: p.amountPaise, p_currency: p.currency, p_method: p.method,
  })
  if (confirmErr) {
    console.warn(`dpdp-pay: recording payment ${p.paymentId} failed: ${confirmErr.message}`)
    return json({ error: "Temporary problem, please retry" }, 500)
  }
  const r = done as { ok: boolean; duplicate?: boolean; reason?: string; paymentId?: string }
  if (!r.ok) return json({ error: "Payment not recorded", reason: r.reason ?? "refused" }, 400)
  if (r.duplicate || !r.paymentId) return json({ ok: true, recorded: false, outcome: "duplicate" })

  await sendReceipt(sb, r.paymentId, p.paymentId)
  return json({ ok: true, recorded: true })
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
  return await createLink(req, cors)
})
