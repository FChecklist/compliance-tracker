// Payment confirmation flow, part 3 -- sends the invoice the moment the
// Owner approves a payment (dpdp_owner_approve_payment). Deployed WITH
// JWT verification ON (unlike dpdp-monday-email, which is cron-driven):
// the caller is a real signed-in browser session, so Supabase itself
// refuses the request before this code runs if the bearer isn't a valid
// Supabase JWT. This function then independently re-checks that the
// caller is the platform admin -- using a client that carries the
// caller's OWN JWT, so dpdp__is_platform_admin() resolves auth.jwt() to
// the real caller, not to the service role -- before it will read or
// send anything. A payment can only be looked up by its own paymentId
// (never listed), and dpdp_owner_approve_payment already required admin
// to create that id in the first place, so this is defense in depth,
// not the only gate.
//
// DRY RUN: same convention as dpdp-monday-email -- no RESEND_API_KEY (or
// {"dryRun":true}) means the invoice is rendered and logged to
// dpdp.email_send as status 'dry_run', nothing is sent. Idempotent per
// payment: dpdp.email_send's (membership, kind, period_key) uniqueness
// means calling this twice for the same paymentId records but does not
// double-send (dpdp_timer_record_email_send's own duplicate check).
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2"

const env = (k: string): string => Deno.env.get(k) ?? ""
const SUPABASE_URL = env("SUPABASE_URL")
const ANON_KEY = env("SUPABASE_ANON_KEY")
const SERVICE_ROLE_KEY = env("SUPABASE_SERVICE_ROLE_KEY")
const RESEND_API_KEY = env("RESEND_API_KEY")
const EMAIL_FROM = env("DPDP_EMAIL_FROM") || "VERIDIAN AI DPDP <dpdp@send.veridian-aios.com>"

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
}

function serviceClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
}

function callerClient(authHeader: string): SupabaseClient {
  return createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authHeader } },
  })
}

type InvoiceDetails = {
  paymentId: string
  orgId: string
  orgName: string
  plan: "firm" | "institution"
  interval: "month" | "year"
  amountPaise: number
  periodStart: string
  confirmedAt: string
  confirmedNote: string | null
  ownerMembershipId: string | null
  ownerIdentityId: string | null
  ownerEmail: string | null
}

function rupees(paise: number): string {
  return `Rs ${(paise / 100).toLocaleString("en-IN")}`
}

function renderInvoice(d: InvoiceDetails): { subject: string; text: string; html: string } {
  const planLabel = d.plan === "institution" ? "Institution edition" : "Firm edition"
  const intervalLabel = d.interval === "year" ? "Yearly" : "Monthly"
  const subject = `Your VERIDIAN receipt -- ${d.orgName} (${rupees(d.amountPaise)})`
  const lines = [
    `Thank you -- your payment for ${d.orgName} is confirmed.`,
    ``,
    `Plan: ${planLabel}, ${intervalLabel}`,
    `Amount: ${rupees(d.amountPaise)}`,
    `Billing period start: ${d.periodStart}`,
    `Confirmed: ${new Date(d.confirmedAt).toLocaleDateString("en-IN")}`,
    d.confirmedNote ? `Note: ${d.confirmedNote}` : null,
    ``,
    `This is your receipt -- keep it for your records. Questions? Just reply to this email.`,
    ``,
    `-- VERIDIAN AI DPDP`,
  ].filter((l): l is string => l !== null)
  const text = lines.join("\n")
  const html = `<div style="font-family:sans-serif;max-width:480px">${lines.map((l) => l === "" ? "<br>" : `<p style="margin:4px 0">${l}</p>`).join("")}</div>`
  return { subject, text, html }
}

async function sendViaResend(to: string, rendered: { subject: string; text: string; html: string }): Promise<string> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: EMAIL_FROM, to: [to], subject: rendered.subject, html: rendered.html, text: rendered.text }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`Resend ${res.status}: ${JSON.stringify(body).slice(0, 300)}`)
  return String((body as { id?: string }).id ?? "")
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405)

  const authHeader = req.headers.get("authorization") ?? ""
  if (!authHeader) return json({ error: "Not signed in" }, 401)

  let body: { paymentId?: string; dryRun?: boolean }
  try {
    body = await req.json()
  } catch {
    return json({ error: "Invalid JSON body" }, 400)
  }
  const paymentId = String(body.paymentId ?? "").trim()
  if (!paymentId) return json({ error: "paymentId is required" }, 400)

  const caller = callerClient(authHeader)
  const { data: isAdmin, error: adminErr } = await caller.rpc("dpdp__is_platform_admin", {})
  if (adminErr) return json({ error: adminErr.message }, 401)
  if (isAdmin !== true) return json({ error: "Owner only" }, 403)

  const sb = serviceClient()
  const { data: details, error: detailsErr } = await sb.rpc("dpdp_timer_invoice_details", { p_payment_id: paymentId })
  if (detailsErr) return json({ error: detailsErr.message }, 500)
  const d = details as InvoiceDetails | null
  if (!d || !d.ownerEmail) return json({ error: "No such payment, or the organisation has no owner on file" }, 404)

  const rendered = renderInvoice(d)
  const dryRun = body.dryRun === true || !RESEND_API_KEY

  const { data: rec, error: recErr } = await sb.rpc("dpdp_timer_record_email_send", {
    p_org_id: d.orgId, p_membership_id: d.ownerMembershipId, p_identity_id: d.ownerIdentityId, p_obligation_ids: [],
    p_kind: "invoice", p_period_key: d.paymentId, p_to_email: d.ownerEmail, p_subject: rendered.subject,
    p_status: dryRun ? "dry_run" : "queued", p_body_text: rendered.text,
  })
  if (recErr) return json({ error: recErr.message }, 500)
  const rowId = (rec as { id: string | null } | null)?.id ?? null
  const duplicate = (rec as { duplicate?: boolean } | null)?.duplicate === true

  if (dryRun) return json({ ok: true, dryRun: true, duplicate, to: d.ownerEmail, subject: rendered.subject })
  if (duplicate) return json({ ok: true, dryRun: false, duplicate: true, to: d.ownerEmail })

  try {
    const messageId = await sendViaResend(d.ownerEmail, rendered)
    if (rowId) await sb.rpc("dpdp_timer_mark_email_send_result", { p_id: rowId, p_status: "sent", p_resend_message_id: messageId })
    return json({ ok: true, dryRun: false, duplicate: false, to: d.ownerEmail, resendMessageId: messageId })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    if (rowId) await sb.rpc("dpdp_timer_mark_email_send_result", { p_id: rowId, p_status: "failed", p_error: message })
    return json({ ok: false, error: message }, 502)
  }
})
