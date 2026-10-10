// PROJEXA-BUILD-001 U-31 (register row BR-413, PM Gap 6 "email attachments
// discarded"). The attachment step of POST /api/webhooks/resend-inbound: after
// the inbound_email_messages row exists and its recipient resolved to an
// organisation, read the email's attachments from Resend and store each one in
// compliance.inbound_email_attachments (drizzle/0620).
//
// Resend's `email.received` webhook carries attachment METADATA only (id,
// filename, content type), never the bytes. The bytes come the same way the
// route already gets the body: through the installed `resend` SDK, here
// resend.emails.receiving.attachments.list(), which answers each attachment
// with a short-lived signed download_url and its size. The file is then
// fetched from that URL with a plain fetch(), exactly as the SDK itself does
// for the raw email in receiving.forward().
//
// Rules this step keeps, each one a register or brief requirement:
//   - 10 MB cap (MAX_ATTACHMENT_BYTES, the CHECK in drizzle/0620). An
//     attachment whose declared size, Content-Length or streamed length goes
//     over it is skipped and named in the returned notes, which the route
//     writes to the message's processing_error. It is never truncated: the
//     download stops and nothing is written for it.
//   - Idempotent per (inbound_message_id, resend_attachment_id): an
//     attachment already stored for this message is not downloaded again.
//   - The file name is stored as its base name only (no directory part), the
//     content type as Resend reports it. The file is stored as bytes and never
//     parsed or executed here (parsing an .xlsx into BOQ proposals is U-36/U-37).
//   - Nothing about the file's contents reaches a note or a log line. A failed
//     insert is reported by its SQLSTATE only: drizzle's DrizzleQueryError
//     message carries the query's bound parameters, which here include the
//     file bytes.
//   - It never throws. A failure is a note; the message row the route already
//     wrote is never lost because of an attachment.
//
// Kept out of route.ts for the reason resend-svix-signature.ts gives: a Next.js
// route file may only export its handlers and segment config.
import { and, eq } from "drizzle-orm"
import type { Resend } from "resend"
import { inboundEmailAttachments, type db as appDb } from "@/lib/db"

/** 10 MB, the limit drizzle/0620's CHECK enforces on size_bytes and octet_length(content). */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024

// Resend's list endpoint answers at most 100 items per page.
const LIST_LIMIT = 100
const DOWNLOAD_TIMEOUT_MS = 15_000

/** The one SDK call this step makes: resend.emails.receiving.attachments.list(). */
export type ReceivingAttachmentsApi = Pick<Resend["emails"]["receiving"]["attachments"], "list">

/** The two query builders this step uses, from the route's own db client. */
export type AttachmentDb = Pick<typeof appDb, "select" | "insert">

export type AttachmentStepOutcome = {
  stored: number
  alreadyStored: number
  /** one plain sentence per attachment (or listing problem) that was not stored; empty when all were */
  notes: string[]
}

/** The base name of a file name as the sender gave it: no directory part, no NUL (Postgres text cannot hold one). */
export function attachmentBaseName(name: string | null | undefined): string {
  const base = (name ?? "").replace(/\u0000/g, "").split(/[\\/]/).pop()?.trim() ?? ""
  return base === "" || base === "." || base === ".." ? "attachment" : base
}

/** The SQLSTATE of a failed query, never its message (see the header). */
function errorCode(err: unknown): string {
  const cause = (err as { cause?: { code?: unknown } } | null)?.cause
  const code = (err as { code?: unknown } | null)?.code ?? cause?.code
  return typeof code === "string" && code.length > 0 ? `SQLSTATE ${code}` : err instanceof Error ? err.name : "unknown error"
}

type ReadResult = { ok: true; bytes: Uint8Array } | { ok: false }

/** The response body, read up to `cap` bytes. Over the cap it stops reading and returns ok:false, never a prefix. */
async function readCapped(res: Response, cap: number): Promise<ReadResult> {
  const declared = Number(res.headers.get("content-length") ?? "")
  if (Number.isFinite(declared) && declared > cap) {
    await res.body?.cancel().catch(() => undefined)
    return { ok: false }
  }
  if (!res.body) {
    const whole = new Uint8Array(await res.arrayBuffer())
    return whole.byteLength > cap ? { ok: false } : { ok: true, bytes: whole }
  }
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > cap) {
      await reader.cancel().catch(() => undefined)
      return { ok: false }
    }
    chunks.push(value)
  }
  return { ok: true, bytes: Buffer.concat(chunks) }
}

export async function storeInboundEmailAttachments(args: {
  db: AttachmentDb
  attachmentsApi: ReceivingAttachmentsApi
  emailId: string
  orgId: string
  inboundMessageId: string
  fetchImpl?: typeof fetch
}): Promise<AttachmentStepOutcome> {
  const { db, attachmentsApi, emailId, orgId, inboundMessageId } = args
  const fetchImpl = args.fetchImpl ?? fetch
  const outcome: AttachmentStepOutcome = { stored: 0, alreadyStored: 0, notes: [] }

  let listed: Awaited<ReturnType<ReceivingAttachmentsApi["list"]>>
  try {
    listed = await attachmentsApi.list({ emailId, limit: LIST_LIMIT })
  } catch (err) {
    outcome.notes.push(`attachments could not be listed (${err instanceof Error ? err.name : "unknown error"})`)
    return outcome
  }
  if (listed.error || !listed.data) {
    outcome.notes.push(`attachments could not be listed: ${listed.error?.message ?? "resend.emails.receiving.attachments.list() returned no data"}`)
    return outcome
  }
  if (listed.data.has_more) {
    outcome.notes.push(`the email has more than ${LIST_LIMIT} attachments; only the first ${LIST_LIMIT} were read`)
  }

  for (const attachment of listed.data.data) {
    const fileName = attachmentBaseName(attachment.filename)
    try {
      const existing = await db
        .select({ id: inboundEmailAttachments.id })
        .from(inboundEmailAttachments)
        .where(and(eq(inboundEmailAttachments.inboundMessageId, inboundMessageId), eq(inboundEmailAttachments.resendAttachmentId, attachment.id)))
        .limit(1)
      if (existing.length > 0) {
        outcome.alreadyStored++
        continue
      }

      if (typeof attachment.size === "number" && attachment.size > MAX_ATTACHMENT_BYTES) {
        outcome.notes.push(`attachment "${fileName}" not stored: ${attachment.size} bytes is over the ${MAX_ATTACHMENT_BYTES}-byte limit`)
        continue
      }

      const res = await fetchImpl(attachment.download_url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) })
      if (!res.ok) {
        await res.body?.cancel().catch(() => undefined)
        outcome.notes.push(`attachment "${fileName}" not stored: download answered HTTP ${res.status}`)
        continue
      }
      const read = await readCapped(res, MAX_ATTACHMENT_BYTES)
      if (!read.ok) {
        outcome.notes.push(`attachment "${fileName}" not stored: over the ${MAX_ATTACHMENT_BYTES}-byte limit`)
        continue
      }

      await db.insert(inboundEmailAttachments).values({
        orgId,
        inboundMessageId,
        fileName,
        contentType: attachment.content_type ?? null,
        sizeBytes: read.bytes.byteLength,
        content: read.bytes,
        resendAttachmentId: attachment.id,
      })
      outcome.stored++
    } catch (err) {
      outcome.notes.push(`attachment "${fileName}" not stored (${errorCode(err)})`)
    }
  }
  return outcome
}
