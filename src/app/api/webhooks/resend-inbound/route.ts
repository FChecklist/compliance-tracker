import { NextRequest, NextResponse, after } from "next/server"
import { Resend } from "resend"
import { eq } from "drizzle-orm"
import { db, inboundEmailMessages, users } from "@/lib/db"
import { verifyResendSvixSignature } from "@/lib/webhooks/resend-svix-signature"
import { resolveEmailAlias } from "@/lib/services/email-alias-service"
import { analyzeInboundEmail } from "@/lib/services/email-intelligence-service"
import { storeInboundEmailAttachments } from "@/lib/webhooks/resend-inbound-attachments"
import { verifySender } from "@/lib/services/email-sender-check"
import { prepareEmailProposals } from "@/lib/services/email-attachment-intake"

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
//
// PROJEXA-BUILD-001 U-31 (BR-413): attachments are read too. Only after the
// signature is verified, the delivery is new (the idempotency check above
// the insert) and the inboundEmailMessages row exists, and only for a
// recipient that resolved to an organisation, the route asks
// storeInboundEmailAttachments() (src/lib/webhooks/resend-inbound-
// attachments.ts) to read each attachment through the same Resend client and
// store it in compliance.inbound_email_attachments (drizzle/0620). An
// attachment it cannot or may not store (over 10 MB, a failed download, a
// failed insert) is named in the message's processingError; the message
// itself is always kept and the route still answers 200.
//
// PROJEXA-BUILD-002 WP-12 (way 4, AW-604): two steps are added. (1) A SENDER CHECK before anything is stored, read or analysed: the From
// address must be an active member-or-above person of the organisation the alias resolved to (email-sender-check.ts). Any other sender is
// a recorded refusal on the message row (processingError names the reason and the address), and no attachment is downloaded, stored or
// read and the body is not sent to a model. (2) After the answer is prepared, the stored attachments of a verified sender are read by
// prepareEmailProposals() (email-attachment-intake.ts): each .xlsx becomes a job in the extraction ledger that a person
// approves; nothing is created from an email. That work runs after the response (next/server after()), because the model wait is up to
// about two minutes and Resend must get its 200 at once; maxDuration covers it. The receiving hostnames are the ones in
// ALLOWED_ALIAS_DOMAINS (email-alias-service.ts), which now match ai-os/projexa-build-001/DNS_RESEND_INBOUND_RECORDS.md.
export const maxDuration = 300

type ReceivedEmailEventData = {
  email_id: string
  created_at?: string
  from?: string
  to?: string[]
  subject?: string
  // metadata only (Resend's webhook never carries the bytes)
  attachments?: Array<{ id: string; filename?: string | null }>
}

/** Two notes for one processingError, either of them possibly absent. */
function joinNotes(...notes: Array<string | null | undefined>): string | null {
  const present = notes.filter((n): n is string => typeof n === "string" && n.length > 0)
  return present.length > 0 ? present.join("; ") : null
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

/**
 * U-31 (BR-413): the attachment step for a message row that already exists.
 * Returns the note it wrote to that row's processingError (what was not
 * stored, and why), or null when every attachment was stored. Never throws.
 */
async function storeAttachmentsOf(
  client: Resend,
  emailId: string,
  orgId: string,
  message: { id: string; processingError: string | null }
): Promise<string | null> {
  let note: string | null = null
  try {
    const step = await storeInboundEmailAttachments({
      db,
      attachmentsApi: client.emails.receiving.attachments,
      emailId,
      orgId,
      inboundMessageId: message.id,
    })
    console.info(
      `[resend-inbound-webhook] inboundEmailMessages row ${message.id}: ${step.stored} attachment(s) stored, ${step.alreadyStored} already stored, ${step.notes.length} not stored.`
    )
    note = joinNotes(...step.notes)
    if (note) {
      await db
        .update(inboundEmailMessages)
        .set({ processingError: joinNotes(message.processingError, note) })
        .where(eq(inboundEmailMessages.id, message.id))
    }
  } catch (err) {
    // storeInboundEmailAttachments() does not throw; this is the note's own
    // update failing. The message row stays; only the error's name is logged.
    console.error(
      `[resend-inbound-webhook] attachment note could not be written for inboundEmailMessages row ${message.id} (${err instanceof Error ? err.name : "unknown error"}).`
    )
  }
  return note
}

/**
 * Runs `work` after the response is sent. Outside a request (a unit test) next/server's after() throws; then the work starts at once and
 * is not waited for, so the answer is never held up by it. `work` never throws (runIntake catches everything).
 */
function scheduleAfterResponse(work: () => Promise<void>): void {
  try {
    after(work)
  } catch {
    void work()
  }
}

/**
 * WP-12: the intake for one verified message. Its notes (a file not read, a file refused) are added to the message row's processingError.
 * Never throws; only the error's name is logged, never a file's content.
 */
async function runIntake(args: { orgId: string; personId: string; messageId: string }): Promise<void> {
  try {
    const result = await prepareEmailProposals({ orgId: args.orgId, person: { id: args.personId }, inboundMessageId: args.messageId })
    const prepared = result.outcomes.filter((o) => o.result === "prepared" || o.result === "already_prepared").length
    console.info(`[resend-inbound-webhook] inboundEmailMessages row ${args.messageId}: ${prepared} proposal(s) prepared, ${result.notes.length} note(s).`)
    const note = joinNotes(...result.notes)
    if (note) {
      const row = await db.query.inboundEmailMessages.findFirst({ where: eq(inboundEmailMessages.id, args.messageId) })
      await db
        .update(inboundEmailMessages)
        .set({ processingError: joinNotes(row?.processingError, note) })
        .where(eq(inboundEmailMessages.id, args.messageId))
    }
  } catch (err) {
    console.error(`[resend-inbound-webhook] intake failed for inboundEmailMessages row ${args.messageId} (${err instanceof Error ? err.name : "unknown error"}).`)
  }
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
  // WP-12: the receiving server's own headers, when Resend returns them; the sender check reads the authentication verdict from them.
  let emailHeaders: Record<string, string> | null = null
  // U-31: whether the email has any attachment to read, from the webhook's own
  // metadata or from the full email below. No attachment, no attachment call.
  let hasAttachments = (eventData.attachments?.length ?? 0) > 0

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
      if ((full.attachments?.length ?? 0) > 0) hasAttachments = true
      emailHeaders = full.headers ?? null
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

  // WP-12: who sent it. An unknown or unverified sender is refused here: the refusal is recorded, and no attachment is downloaded,
  // stored or read, and the body is not analysed. Only a verified sender's message goes on.
  let sender: Awaited<ReturnType<typeof verifySender>> | null = null
  if (resolved) {
    sender = await verifySender(db, { orgId: resolved.orgId, fromAddress, headers: emailHeaders })
    if (!sender.ok) {
      await db.update(inboundEmailMessages).set({ processingError: joinNotes(inserted.processingError, sender.note) }).where(eq(inboundEmailMessages.id, inserted.id))
      console.warn(`[resend-inbound-webhook] inboundEmailMessages row ${inserted.id} refused (${sender.code}); nothing was stored or read.`)
      return NextResponse.json({ ok: true, id: inserted.id, processed: false, refused: sender.code })
    }
  }

  // U-31 (BR-413): the message row exists, so its attachments can be linked to
  // it. An organisation is required (inbound_email_attachments.org_id is NOT
  // NULL), so an unresolved recipient's attachments are not read.
  const attachmentNote =
    resolved && client && hasAttachments && sender?.ok ? await storeAttachmentsOf(client, emailId, resolved.orgId, inserted) : null

  // WP-12: prepare proposals from the stored attachments, after this answer.
  if (resolved && client && sender?.ok && hasAttachments) {
    const intake = { orgId: resolved.orgId, personId: sender.person.id, messageId: inserted.id }
    scheduleAfterResponse(() => runIntake(intake))
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
    // U-31: an attachment note written above is kept beside the failure.
    await db
      .update(inboundEmailMessages)
      .set({ processingError: attachmentNote ? `${attachmentNote}; ${message}` : message })
      .where(eq(inboundEmailMessages.id, inserted.id))
    console.error(`[resend-inbound-webhook] analyzeInboundEmail failed for inboundEmailMessages row ${inserted.id}:`, err)
    return NextResponse.json({ ok: true, id: inserted.id, processed: false, error: message })
  }

  return NextResponse.json({ ok: true, id: inserted.id, processed: true })
}
