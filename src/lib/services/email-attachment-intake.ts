// PROJEXA-BUILD-002 WP-12 (register rows AW-604, AW-904): way 4, an email with a workbook attached becomes a PREPARED proposal that a person
// approves. Nothing here creates a project or a BOQ: an email never writes business data by itself (contract rule 5, PMD-05).
//
// THE PATH. The resend-inbound webhook has already checked the signature, resolved the recipient to an organisation and a person,
// verified the sender (email-sender-check.ts: an active member-or-above person of that organisation, no failed SPF/DKIM/DMARC verdict)
// and stored the attachments (resend-inbound-attachments.ts). It then schedules prepareEmailProposals() to run after its own answer,
// because reading a workbook and asking the model takes up to about two minutes and a webhook must answer at once.
//
// For each stored attachment (at most EMAIL_INTAKE_LIMITS.maxAttachmentsRead per message) this reads the file with the same code an
// upload uses: the WP-01 deterministic reader (readWorkbookDigest, through extractProjectFromDocument) and the WP-02 contract (the
// Edge Function's answer checked against the file, the reconciliation gate, the open questions), in mode "prepare". The result is a
// job in the organisation's extraction ledger (compliance.source_object, origin email) in state ready, or needs_answers when the
// file left questions. The ledger is keyed on the file's sha256, so the same workbook sent twice, or sent by email after it was
// uploaded, is one job and costs one model call at most. createProject() and createBoq() are passed to the run as functions that
// throw: even a defect in the run cannot create anything from an email.
//
// THE LIST AND THE APPROVAL. listOpenExtractionJobs() (document-extraction-service.ts) is the organisation's list of proposals that wait
// for a person, and GET /api/v1/projexa/projects/from-document?open=1 answers it; an upload made in prepare mode is on the same list.
// A person approves by posting the job id to that route (POST with `jobId` and the product instead of a file): loadEmailJobFile() below
// hands the route the stored attachment's bytes, and the route runs the ordinary create path, which finishes the parked job from what it
// stored with no second model call. That is the one place a project is created, and it is the person's call.
//
// THE FILE IS DATA. The attachment is untrusted. It is read as bytes by the deterministic reader and its cell text goes to the model only
// as the document to extract from; what the model answers is checked against the file, so a planted instruction cannot add a line, move
// a total or create anything. No note and no log line here carries file content: a note names the file (its base name), the reason and a
// stable code, never a cell, a line or a model answer. Type and size are checked before any read: only .xlsx that starts like a zip,
// at most WORKBOOK_LIMITS.maxBytes.
//
// Not done: a .pdf or .docx attachment is stored and named in a note as not read, because no deterministic reader for either exists yet.
import { and, asc, eq } from "drizzle-orm"
import { inboundEmailAttachments } from "@/lib/db/schema"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import {
  createDbProjectSourceLedger,
  createEdgeExtractCaller,
  getProjectSourceJob,
  runExtractionJob,
  startExtractionJob,
  type CreateFromDocumentDeps,
  type EdgeCaller,
  type JobVia,
  type ParkedState,
  type ProjectSourceLedger,
} from "@/lib/services/document-extraction-service"
import { ExtractionRejectedError, WORKBOOK_LIMITS } from "@/lib/services/document-extraction-schema"

export const EMAIL_INTAKE_LIMITS = {
  /** Attachments of one message that are turned into proposals; the rest are named in a note. Each read can wait up to 110 s for the model, so 2 fits the webhook's 300 s. */
  maxAttachmentsRead: 2,
  /** Attachment rows read from the database for one message. */
  maxAttachmentsListed: 20,
} as const

export type StoredAttachment = { id: string; fileName: string; contentType: string | null; sizeBytes: number; content: Uint8Array }

export type IntakeOutcome =
  | { attachmentId: string; fileName: string; result: "prepared"; state: ParkedState; jobId: string; questions: number }
  | { attachmentId: string; fileName: string; result: "already_prepared"; state: ParkedState; jobId: string }
  | { attachmentId: string; fileName: string; result: "already_created"; projectId: string }
  | { attachmentId: string; fileName: string; result: "not_read"; note: string }
  | { attachmentId: string; fileName: string; result: "refused"; code: string; note: string }

export type IntakeResult = { outcomes: IntakeOutcome[]; notes: string[] }

/** What the intake needs from outside, so a test can stand in for the database and the Edge Function. */
export type IntakeDeps = {
  loadAttachments: (ctx: { orgId: string; personId: string }, inboundMessageId: string) => Promise<StoredAttachment[]>
  callEdge: EdgeCaller
  ledgerFor: (ctx: { orgId: string; personId: string }) => ProjectSourceLedger
}

/** The real dependencies: the database through withTenantContext, the Edge Function from the server's environment, the email ledger. */
export function realIntakeDeps(): IntakeDeps {
  return {
    loadAttachments: (ctx, inboundMessageId) => loadStoredAttachments(ctx, inboundMessageId),
    callEdge: createEdgeExtractCaller({ baseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL, secret: process.env.PROJEXA_DOCUMENT_EXTRACT_SECRET }),
    ledgerFor: (ctx) => createDbProjectSourceLedger({ orgId: ctx.orgId, actorId: ctx.personId, origin: "email" }),
  }
}

/** The stored attachments of one message of this organisation, oldest first. Its own tenant transaction. */
export async function loadStoredAttachments(ctx: { orgId: string; personId: string }, inboundMessageId: string): Promise<StoredAttachment[]> {
  const rows = await withTenantContext({ orgId: ctx.orgId, userId: ctx.personId }, (db) =>
    db
      .select({
        id: inboundEmailAttachments.id,
        fileName: inboundEmailAttachments.fileName,
        contentType: inboundEmailAttachments.contentType,
        sizeBytes: inboundEmailAttachments.sizeBytes,
        content: inboundEmailAttachments.content,
      })
      .from(inboundEmailAttachments)
      .where(and(eq(inboundEmailAttachments.orgId, ctx.orgId), eq(inboundEmailAttachments.inboundMessageId, inboundMessageId)))
      .orderBy(asc(inboundEmailAttachments.createdAt), asc(inboundEmailAttachments.id))
      .limit(EMAIL_INTAKE_LIMITS.maxAttachmentsListed),
  )
  return rows
}

/** A file name as a note prints it: printable characters only, 120 at most. It is the sender's own text, so it is cut, never trusted. */
export function noteName(fileName: string): string {
  const cleaned = fileName.replace(/[\u0000-\u001f\u007f"]/g, "").trim()
  return cleaned.length > 120 ? `${cleaned.slice(0, 120)}...` : cleaned || "attachment"
}

const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04]

/** True for a name that ends in .xlsx and bytes that start like a zip. The content type Resend reports is not used: the sender writes it. */
export function looksLikeWorkbook(fileName: string, bytes: Uint8Array): boolean {
  return /\.xlsx$/i.test(fileName.trim()) && ZIP_MAGIC.every((b, i) => bytes[i] === b)
}

/** The ledger for one attachment: the email ledger, with the message and attachment written into a parked job's result (see JobVia). */
export function ledgerWithVia(base: ProjectSourceLedger, via: JobVia): ProjectSourceLedger {
  return {
    ...base,
    setState: (claimId, state, result) => {
      const parked = state === "needs_answers" || state === "ready"
      const withVia = parked && typeof result === "object" && result !== null ? { ...(result as Record<string, unknown>), via } : result
      return base.setState(claimId, state, withVia)
    },
  }
}

/** createProject() and createBoq() as this path passes them to the run: an email creates no project and no BOQ, so any call is a defect. */
const NO_CREATE: Pick<CreateFromDocumentDeps<{ id: string }, { id: string }>, "createProject" | "createBoq"> = {
  createProject: async () => {
    throw new Error("an email attachment never creates a project; it prepares a proposal")
  },
  createBoq: async () => {
    throw new Error("an email attachment never creates a BOQ; it prepares a proposal")
  },
}

/**
 * Turns the stored attachments of one message into prepared proposals. Never throws: a failure is an outcome and a note. `person` is the
 * verified sender (a real compliance.users id), recorded as the job's owner and as the attribution of the model call.
 */
export async function prepareEmailProposals(
  args: { orgId: string; person: { id: string }; inboundMessageId: string },
  deps: IntakeDeps = realIntakeDeps(),
): Promise<IntakeResult> {
  const result: IntakeResult = { outcomes: [], notes: [] }
  const ctx = { orgId: args.orgId, personId: args.person.id }

  let attachments: StoredAttachment[]
  try {
    attachments = await deps.loadAttachments(ctx, args.inboundMessageId)
  } catch (err) {
    result.notes.push(`stored attachments could not be read (${err instanceof Error ? err.name : "unknown error"})`)
    return result
  }

  let read = 0
  for (const attachment of attachments) {
    const name = noteName(attachment.fileName)
    if (!looksLikeWorkbook(attachment.fileName, attachment.content)) {
      const note = `attachment "${name}" was stored but not read: only .xlsx workbooks are read`
      result.outcomes.push({ attachmentId: attachment.id, fileName: name, result: "not_read", note })
      result.notes.push(note)
      continue
    }
    if (attachment.content.byteLength > WORKBOOK_LIMITS.maxBytes) {
      const note = `attachment "${name}" was stored but not read: over the ${WORKBOOK_LIMITS.maxBytes}-byte limit for a workbook`
      result.outcomes.push({ attachmentId: attachment.id, fileName: name, result: "not_read", note })
      result.notes.push(note)
      continue
    }
    if (read >= EMAIL_INTAKE_LIMITS.maxAttachmentsRead) {
      const note = `attachment "${name}" was stored but not read: only the first ${EMAIL_INTAKE_LIMITS.maxAttachmentsRead} workbooks of a message are read`
      result.outcomes.push({ attachmentId: attachment.id, fileName: name, result: "not_read", note })
      result.notes.push(note)
      continue
    }
    read++
    const outcome = await prepareOne(args, ctx, deps, attachment, name)
    result.outcomes.push(outcome)
    if (outcome.result === "refused") result.notes.push(outcome.note)
  }
  return result
}

async function prepareOne(
  args: { orgId: string; person: { id: string }; inboundMessageId: string },
  ctx: { orgId: string; personId: string },
  deps: IntakeDeps,
  attachment: StoredAttachment,
  name: string,
): Promise<IntakeOutcome> {
  const via: JobVia = { channel: "email", inboundMessageId: args.inboundMessageId, attachmentId: attachment.id }
  const ledger = ledgerWithVia(deps.ledgerFor(ctx), via)
  const input = {
    orgId: args.orgId,
    actorId: args.person.id,
    // Never read: the run stops at ready or needs_answers before it would create a project (see NO_CREATE).
    productId: "",
    fileName: attachment.fileName,
    bytes: attachment.content,
    mode: "prepare" as const,
  }
  const runDeps = { callEdge: deps.callEdge, ledger, ...NO_CREATE } as CreateFromDocumentDeps<{ id: string }, { id: string }>
  try {
    const start = await startExtractionJob(input, { ledger })
    if (start.kind === "duplicate") return { attachmentId: attachment.id, fileName: name, result: "already_created", projectId: start.projectId }
    // A parked job for this file already exists (this message came twice, or a person uploaded the file in prepare mode): it is the
    // proposal, and running it again would only repeat work.
    if (start.kind === "resume") return { attachmentId: attachment.id, fileName: name, result: "already_prepared", state: start.state, jobId: start.claimId }
    const run = await runExtractionJob(start, input, runDeps)
    if ("pending" in run && run.pending) {
      return { attachmentId: attachment.id, fileName: name, result: "prepared", state: run.state, jobId: run.jobId, questions: run.questions.length }
    }
    // Unreachable in prepare mode (a run either parks or throws). Recorded as a refusal rather than trusted.
    return { attachmentId: attachment.id, fileName: name, result: "refused", code: "unexpected_result", note: `attachment "${name}" produced no proposal (unexpected result)` }
  } catch (err) {
    const code = err instanceof ExtractionRejectedError ? err.code : "intake_failed"
    return { attachmentId: attachment.id, fileName: name, result: "refused", code, note: `attachment "${name}" produced no proposal (${code})` }
  }
}

/**
 * The stored file of an emailed job, for the route that approves it. Null unless the job is of this organisation, came from an email,
 * still waits for a person and its attachment is still stored. The bytes come from the row the job names, never from the request.
 */
export async function loadEmailJobFile(
  ctx: { orgId: string; actorId: string },
  jobId: string,
): Promise<{ fileName: string; bytes: Uint8Array; state: ParkedState } | null> {
  const job = await getProjectSourceJob(ctx, { jobId })
  if (!job || job.origin !== "email" || job.projectId) return null
  if (job.state !== "needs_answers" && job.state !== "ready") return null
  const via = job.via
  if (!via) return null
  const rows = await withTenantContext({ orgId: ctx.orgId, userId: ctx.actorId }, (db) =>
    db
      .select({ fileName: inboundEmailAttachments.fileName, content: inboundEmailAttachments.content })
      .from(inboundEmailAttachments)
      .where(
        and(
          eq(inboundEmailAttachments.orgId, ctx.orgId),
          eq(inboundEmailAttachments.id, via.attachmentId),
          eq(inboundEmailAttachments.inboundMessageId, via.inboundMessageId),
        ),
      )
      .limit(1),
  )
  const row = rows[0]
  return row ? { fileName: row.fileName, bytes: row.content, state: job.state } : null
}
