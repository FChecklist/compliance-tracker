import { NextRequest, NextResponse } from "next/server"
import { Resend } from "resend"
import { eq } from "drizzle-orm"
import { db, inboundEmailMessages, users } from "@/lib/db"
import { verifyResendSvixSignature } from "@/lib/webhooks/resend-svix-signature"
import { resolveEmailAlias } from "@/lib/services/email-alias-service"
import { analyzeInboundEmail } from "@/lib/services/email-intelligence-service"

// R-C17 (platform.sumeet_requirements, Owner-initiated 2026-09-13,
// "Platform: Email Engine"). The real inbound-email trigger this
// codebase never had -- email-intelligence-service.ts's
// analyzeInboundEmail() own header comment confirmed "no inbound-email-
// ingestion trigger exists anywhere in this codebase today". This route is
// that trigger, wired to Resend Inbound (GA since late 2025, same provider
// this app already uses for outbound send, src/lib/email.ts).
//
// Auth model, and why this route does NOT call requireAuth(): same
// reasoning as src/app/api/webhooks/vercel-deployment/route.ts's own header
// comment -- this route is called by Resend itself, server-to-server, with
// no session cookie and no org API key. The real authentication boundary
// is the Svix signature check below (Resend delivers every webhook event
// Svix-signed; see src/lib/webhooks/resend-svix-signature.ts for the exact
// algorithm and why it's hand-implemented rather than via the `svix`
// package). An unsigned or wrongly-signed request is rejected (403) before
// a single byte of the payload is trusted.
//
// Resend's webhook delivers METADATA ONLY for `email.received` (from/to/
// subject/headers, no body/attachments) -- this handler calls Resend's own
// GET /emails/receiving/{id} (resend.emails.receiving.get(), already in the
// installed `resend` SDK, no separate HTTP client needed) to fetch the full
// email content before doing anything else with it.
//
// Recipient resolution (email-alias-service.ts's resolveEmailAlias()) is
// what turns an arbitrary inbound address into a real (orgId, userId) --
// see that file's header for why it can safely read across every org with
// no tenant context yet. A recipient that doesn't resolve to a known,
// active alias is NOT retried or bounced (this route always returns 200 so
// Resend never retry-storms an address that will never resolve) but IS
// written to inboundEmailMessages with userId/orgId null and a
// processingError note, so a misdirected or pre-provisioning delivery is a
// visible row for someone to investigate rather than a silently dropped
// webhook.
//
// STATUS: code-complete. 2026-09-13 (owner directive): the owner confirmed
// real, working email already exists on the root veridian-aios.com/
// projexa-ai.com domains, so per-user aliases were moved to the subdomain
// mail.veridian-aios.com (ALLOWED_ALIAS_DOMAINS in email-alias-service.ts)
// -- a domain's MX record routes ALL its mail to one place, so the root
// domain could not safely be used without hijacking existing mail. Two
// steps remain, both genuinely owner-only (not this route's job): (a)
// adding mail.veridian-aios.com as an Inbound domain in the Resend
// dashboard (an account-level action, needs Resend login), and (b) adding
// the MX record Resend then specifies to mail.veridian-aios.com's DNS
// (owner-authorized 2026-09-13 for the PM session to do directly in Vercel,
// scoped to exactly this one record -- see platform.claude_log for the
// exact ruling). See platform.sumeet_requirements row R-C17.

type ReceivedEmailEventData = {
  email_id: string
  created_at?: string
  from?: string
  to?: string[]
  subject?: string
}

type ResendInboundWebhookPayload = {
  type?: string
  created_at?: string
  data?: ReceivedEmailEventData
}

let resendClient: Resend | null = null
function getResendClient(): Resend | null {
  if (!process.env.RESEND_API_KEY) return null
  if (!resendClient) resendClient = new Resend(process.env.RESEND_API_KEY)
  return resendClient
}

export async function POST(request: NextRequest) {
  const secret = process.env.RESEND_WEBHOOK_SECRET
  const svixId = request.headers.get("svix-id")
  const svixTimestamp = request.headers.get("svix-timestamp")
  const svixSignature = request.headers.get("svix-signature")
  // Signature is computed over the RAW body -- must read as text before any
  // JSON parsing, exactly like the Vercel webhook route's own precedent.
  const rawBody = await request.text()

  if (!secret) {
    // Fail closed: with no secret configured, no delivery can ever be
    // verified, so every delivery must be rejected rather than silently
    // trusted -- same posture as vercel-deployment/route.ts.
    console.error("[resend-inbound-webhook] RESEND_WEBHOOK_SECRET is not configured -- rejecting all deliveries (fail-closed).")
    return NextResponse.json({ error: "Webhook receiver not configured" }, { status: 500 })
  }

  if (!verifyResendSvixSignature(rawBody, { svixId, svixTimestamp, svixSignature }, secret)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 403 })
  }

  let payload: ResendInboundWebhookPayload
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const eventData = payload.data
  if (payload.type !== "email.received" || !eventData || !eventData.email_id) {
    // Acknowledged, not rejected -- a validly-signed delivery for an event
    // type this receiver doesn't act on must not cause Resend to retry or
    // eventually disable the webhook (same posture as vercel-deployment's
    // RECOGNIZED_EVENTS handling).
    return NextResponse.json({ ok: true, ignored: true, eventType: payload.type ?? null })
  }

  const emailId = eventData.email_id

  // Idempotency: Resend retries a non-2xx delivery -- a delivery already
  // recorded for this email id is acknowledged without reprocessing.
  const existing = await db.query.inboundEmailMessages.findFirst({ where: eq(inboundEmailMessages.resendMessageId, emailId) })
  if (existing) {
    return NextResponse.json({ ok: true, alreadyProcessed: true, id: existing.id })
  }

  let fromAddress = eventData.from ?? ""
  let toAddress = eventData.to?.[0] ?? ""
  let subject: string | null = eventData.subject ?? null
  let body: string | null = null
  let fetchError: string | null = null

  const client = getResendClient()
  if (!client) {
    fetchError = "RESEND_API_KEY not configured -- could not fetch full email content"
  } else {
    const { data: full, error } = await client.emails.receiving.get(emailId)
    if (error || !full) {
      fetchError = error?.message ?? "resend.emails.receiving.get() returned no data"
    } else {
      fromAddress = full.from || fromAddress
      toAddress = full.to?.[0] || toAddress
      subject = full.subject ?? subject
      body = full.text ?? full.html ?? null
    }
  }

  const resolved = toAddress ? await resolveEmailAlias(toAddress) : null
  const receivedAt = eventData.created_at ? new Date(eventData.created_at) : new Date()

  const [inserted] = await db
    .insert(inboundEmailMessages)
    .values({
      orgId: resolved?.orgId ?? null,
      userId: resolved?.userId ?? null,
      fromAddress,
      toAddress,
      subject,
      resendMessageId: emailId,
      receivedAt,
      processingError: fetchError ?? (resolved ? null : `No active alias found for recipient "${toAddress}"`),
    })
    .returning()

  if (!inserted) {
    return NextResponse.json({ error: "Failed to record inbound email" }, { status: 500 })
  }

  if (!resolved || fetchError) {
    console.warn(
      `[resend-inbound-webhook] inboundEmailMessages row ${inserted.id} recorded but NOT processed (${
        fetchError ? `fetch error: ${fetchError}` : "recipient did not resolve to a known alias"
      }).`
    )
    return NextResponse.json({ ok: true, id: inserted.id, processed: false })
  }

  try {
    const dbUser = await db.query.users.findFirst({ where: eq(users.id, resolved.userId) })
    if (!dbUser) throw new Error(`Resolved userId ${resolved.userId} has no users row`)
    await analyzeInboundEmail(
      { orgId: resolved.orgId, userId: resolved.userId, dbUser },
      { subject: subject ?? "(no subject)", body: body ?? "", senderEmail: fromAddress, receivedAt: receivedAt.toISOString() }
    )
    await db.update(inboundEmailMessages).set({ processedAt: new Date() }).where(eq(inboundEmailMessages.id, inserted.id))
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await db.update(inboundEmailMessages).set({ processingError: message }).where(eq(inboundEmailMessages.id, inserted.id))
    console.error(`[resend-inbound-webhook] analyzeInboundEmail failed for inboundEmailMessages row ${inserted.id}:`, err)
    return NextResponse.json({ ok: true, id: inserted.id, processed: false, error: message })
  }

  return NextResponse.json({ ok: true, id: inserted.id, processed: true })
}
