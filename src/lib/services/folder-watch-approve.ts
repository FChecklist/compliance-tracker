// PROJEXA-BUILD-002 WP-15 (register row AW-606, way 5): a person approves the proposal a folder scan prepared, and the project is made.
//
// WHY THIS EXISTS. A scan (folder-watch-service.ts) reads a workbook found in a connected mailbox or Drive folder, parks the job (the
// extraction is stored on the ledger row) and records ONE proposal (a compliance.submissions row, source "scheduler_bridge"). It keeps
// no bytes: the scan hands them to the reader and drops them. Finishing a job needs the bytes again (the create step re-reads the
// workbook to check the stored answer against it), so approval fetches the file again.
//
// THE DESIGN (owner decision D-1 was open; this is the option that adds no retention and no new table):
//   * the file is fetched AGAIN, from the same connected source, with the SCHEDULE OWNER'S OWN active connection. Nothing about the
//     file is kept anywhere between the scan and the approval;
//   * only the person whose proposal it is may approve it, because only their connection can read that mailbox or folder. A manager
//     sees the organisation's proposals in the list but cannot make a project out of someone else's mailbox;
//   * the bytes that come back must hash to the sha256 the proposal recorded. A Drive file edited after the scan, or a message that
//     is gone, is refused with `file_changed` and creates nothing: what the person approved is what is made;
//   * the project is then made by the SAME path as an upload, a chat attachment and an email (startExtractionJob and runExtractionJob
//     with the real createProject and createBoq). The parked job is finished from what it stored, so no second model call is made when
//     the job survived; the lead of the project and the creator of the BOQ are the approving person;
//   * one approval per proposal, decided by one conditional UPDATE (the claim, the same pattern as prepared-proposals.ts): two
//     overlapping approvals make one project. A claim is given back only when nothing was created.
//
// WHAT THIS FILE DOES NOT KNOW: how the source is opened (a `openSource` dep: folder-watch-connectors.ts for the real ones, the fake
// folder for the tests). It opens no tenant transaction inside another, and it writes no business record of its own: the project and
// the BOQ are written, and audited, by createProject and createBoq.
import { and, eq, inArray, sql } from "drizzle-orm"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { submissions } from "@/lib/db/schema"
import { PENDING_SUBMISSION_STATUSES } from "@/lib/pipeline/prepared-proposals"
import { ServiceError } from "./service-error"
import {
  runExtractionJob,
  startExtractionJob,
  type CreateFromDocumentDeps,
  type CreateFromDocumentInput,
} from "./document-extraction-service"
import { ExtractionRejectedError, ProjectCreatedUnlinkedError, ProjectCreatedWithoutBoqError, WORKBOOK_LIMITS, type ExtractionQuestion } from "./document-extraction-schema"
import { FolderSourceError, sha256Hex, type FolderFile, type FolderSource } from "./folder-watch-service"
import { FOLDER_PROPOSAL_FUNCTION_ID, SCHEDULER_SOURCE } from "./folder-watch-store"

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)

export type ApproveProposalInput = {
  orgId: string
  /** The approving person: a real compliance.users id. Must be the person the proposal belongs to. */
  person: { id: string }
  proposalId: string
  /** Replaces the product the schedule named. */
  productId?: string
  projectName?: string
  acknowledgeQuestions?: boolean
  acknowledgeShortfall?: boolean
}

export type ApproveProposalDeps<P extends { id: string }, B extends { id: string }> = CreateFromDocumentDeps<P, B> & {
  /** The source the proposal came from, opened with THIS person's own connection. Throws ServiceError(400) when not connected. */
  openSource(ctx: { orgId: string; actorId: string }, source: { kind: "mailbox" | "drive"; folderKey: string }): Promise<FolderSource>
}

export type ApproveProposalOutcome<P, B> =
  | { ok: true; duplicate: boolean; projectId: string; project: P | null; boq: B | null }
  | { ok: false; reason: "not_found" }
  /** the proposal belongs to someone else: only its owner's connection can read the file */
  | { ok: false; reason: "not_owner" }
  | { ok: false; reason: "already_decided"; status: string }
  /** another approval holds the claim and has not finished */
  | { ok: false; reason: "in_progress" }
  | { ok: false; reason: "product_required" }
  /** the person has not connected the mailbox or the Drive (or the connection is not active) */
  | { ok: false; reason: "not_connected" }
  /** the source could not hand the file over now (a stable word, never text from the source) */
  | { ok: false; reason: "source_unavailable"; code: string }
  /** the file fetched now is not the file the proposal recorded */
  | { ok: false; reason: "file_changed" }
  /** the job still has questions and the person has not acknowledged them: nothing was created */
  | { ok: false; reason: "needs_answers"; questions: ExtractionQuestion[] }
  /** the extraction refused the file or is busy: a stable code, nothing was created */
  | { ok: false; reason: "refused"; code: string; message: string; status: number; issues: string[]; retryAfterSeconds?: number }

type ProposalFacts = {
  ownerId: string
  status: string
  claimed: boolean
  chain: Record<string, unknown>
  source: { kind: "mailbox" | "drive"; folderKey: string; fileId: string }
  fileName: string
  contentSha256: string
  productId: string
}

async function readProposal(orgId: string, actorId: string, proposalId: string): Promise<ProposalFacts | null> {
  const [row] = await withTenantContext({ orgId, userId: actorId }, (db) =>
    db
      .select({ userId: submissions.userId, status: submissions.status, selectedChain: submissions.selectedChain })
      .from(submissions)
      .where(and(eq(submissions.id, proposalId), eq(submissions.orgId, orgId)))
      .limit(1),
  )
  if (!row || !isObject(row.selectedChain)) return null
  const chain = row.selectedChain
  if (chain.source !== SCHEDULER_SOURCE || chain.functionId !== FOLDER_PROPOSAL_FUNCTION_ID) return null
  const params = isObject(chain.params) ? chain.params : {}
  const kind = params.sourceKind
  if (kind !== "mailbox" && kind !== "drive") return null
  if (typeof params.sourceFolder !== "string" || typeof params.sourceFileId !== "string" || typeof chain.contentSha256 !== "string") return null
  return {
    ownerId: row.userId,
    status: row.status,
    claimed: typeof chain.claimedAt === "string",
    chain,
    source: { kind, folderKey: params.sourceFolder, fileId: params.sourceFileId },
    fileName: typeof params.fileName === "string" && params.fileName !== "" ? params.fileName : "workbook.xlsx",
    contentSha256: chain.contentSha256,
    productId: typeof params.productId === "string" ? params.productId : "",
  }
}

/** Claims one pending, unclaimed proposal: the single UPDATE that decides which of several overlapping approvals runs. */
async function claim(orgId: string, personId: string, proposalId: string): Promise<boolean> {
  const rows = await withTenantContext({ orgId, userId: personId }, (db) =>
    db
      .update(submissions)
      .set({ selectedChain: sql`${submissions.selectedChain} || ${JSON.stringify({ claimedAt: new Date().toISOString(), claimedBy: personId })}::jsonb` })
      .where(
        and(
          eq(submissions.id, proposalId),
          eq(submissions.orgId, orgId),
          inArray(submissions.status, [...PENDING_SUBMISSION_STATUSES]),
          sql`${submissions.selectedChain} ->> 'claimedAt' is null`,
        ),
      )
      .returning({ id: submissions.id }),
  )
  return rows.length === 1
}

/** Gives the claim back, only when nothing was created. Never throws: the caller is already answering. */
async function release(orgId: string, personId: string, proposalId: string, stored: Record<string, unknown>): Promise<void> {
  try {
    await withTenantContext({ orgId, userId: personId }, (db) =>
      db
        .update(submissions)
        .set({ selectedChain: stored })
        .where(and(eq(submissions.id, proposalId), eq(submissions.orgId, orgId), inArray(submissions.status, [...PENDING_SUBMISSION_STATUSES]))),
    )
  } catch (error) {
    console.error(`[folder-watch-approve] proposal=${proposalId} claim could not be released:`, error)
  }
}

/** Marks the proposal decided: done, linked to its project, with who approved it and what was made. */
async function markDone(orgId: string, personId: string, proposalId: string, made: { projectId: string; boqId: string | null }): Promise<void> {
  const patch = { approvedAt: new Date().toISOString(), approvedBy: personId, projectId: made.projectId, ...(made.boqId ? { boqId: made.boqId } : {}) }
  await withTenantContext({ orgId, userId: personId }, (db) =>
    db
      .update(submissions)
      .set({ status: "done", projectId: made.projectId, selectedChain: sql`${submissions.selectedChain} || ${JSON.stringify(patch)}::jsonb` })
      .where(and(eq(submissions.id, proposalId), eq(submissions.orgId, orgId))),
  )
}

/** The file, fetched again from the source the proposal names. */
async function fetchAgain(facts: ProposalFacts, source: FolderSource): Promise<Uint8Array> {
  const file: FolderFile = { id: facts.source.fileId, name: facts.fileName, mimeType: null, sizeBytes: null, modifiedAt: new Date(0) }
  const bytes = await source.download(file, WORKBOOK_LIMITS.maxBytes)
  if (bytes.byteLength > WORKBOOK_LIMITS.maxBytes) throw new FolderSourceError("file_too_large", "the download is larger than the limit")
  return bytes
}

/**
 * Approves one proposal a folder scan prepared. Nothing is created until every check has passed; a check that fails gives the
 * claim back and leaves the proposal pending so the person can try again (connect the source, answer the questions).
 */
export async function approveFolderProposal<P extends { id: string }, B extends { id: string }>(
  input: ApproveProposalInput,
  deps: ApproveProposalDeps<P, B>,
): Promise<ApproveProposalOutcome<P, B>> {
  const facts = await readProposal(input.orgId, input.person.id, input.proposalId)
  if (!facts) return { ok: false, reason: "not_found" }
  if (facts.ownerId !== input.person.id) return { ok: false, reason: "not_owner" }
  if (!(PENDING_SUBMISSION_STATUSES as readonly string[]).includes(facts.status)) return { ok: false, reason: "already_decided", status: facts.status }
  if (facts.claimed) return { ok: false, reason: "in_progress" }
  const productId = (input.productId ?? facts.productId).trim()
  if (!productId) return { ok: false, reason: "product_required" }

  if (!(await claim(input.orgId, input.person.id, input.proposalId))) {
    const now = await readProposal(input.orgId, input.person.id, input.proposalId)
    if (!now) return { ok: false, reason: "not_found" }
    return (PENDING_SUBMISSION_STATUSES as readonly string[]).includes(now.status) ? { ok: false, reason: "in_progress" } : { ok: false, reason: "already_decided", status: now.status }
  }
  const giveBack = () => release(input.orgId, input.person.id, input.proposalId, facts.chain)

  let bytes: Uint8Array
  try {
    const source = await deps.openSource({ orgId: input.orgId, actorId: input.person.id }, { kind: facts.source.kind, folderKey: facts.source.folderKey })
    bytes = await fetchAgain(facts, source)
  } catch (err) {
    await giveBack()
    if (err instanceof FolderSourceError) return { ok: false, reason: "source_unavailable", code: err.code ?? "source_error" }
    if (err instanceof ServiceError && err.status === 400) return { ok: false, reason: "not_connected" }
    if (err instanceof ServiceError) return { ok: false, reason: "source_unavailable", code: "connector_error" }
    throw err
  }
  if (sha256Hex(bytes) !== facts.contentSha256) {
    await giveBack()
    return { ok: false, reason: "file_changed" }
  }

  const job: CreateFromDocumentInput = {
    orgId: input.orgId,
    actorId: input.person.id,
    productId,
    fileName: facts.fileName,
    bytes,
    mode: "create",
    ...(input.projectName?.trim() ? { projectName: input.projectName.trim() } : {}),
    acknowledgeQuestions: input.acknowledgeQuestions === true,
    acknowledgeShortfall: input.acknowledgeShortfall === true,
  }

  try {
    const start = await startExtractionJob(job, deps)
    if (start.kind === "duplicate") {
      // The same file already made a project (another way got there first): the proposal is answered by that project, nothing new is made.
      await markDone(input.orgId, input.person.id, input.proposalId, { projectId: start.projectId, boqId: null })
      return { ok: true, duplicate: true, projectId: start.projectId, project: null, boq: null }
    }
    const run = await runExtractionJob(start, job, deps)
    if (run.duplicate) {
      await markDone(input.orgId, input.person.id, input.proposalId, { projectId: run.projectId, boqId: null })
      return { ok: true, duplicate: true, projectId: run.projectId, project: null, boq: null }
    }
    if (run.pending) {
      await giveBack()
      return { ok: false, reason: "needs_answers", questions: run.questions }
    }
    await markDone(input.orgId, input.person.id, input.proposalId, { projectId: run.projectId, boqId: run.boq.id })
    return { ok: true, duplicate: false, projectId: run.projectId, project: run.project, boq: run.boq }
  } catch (err) {
    if (err instanceof ProjectCreatedWithoutBoqError || err instanceof ProjectCreatedUnlinkedError) {
      // A project exists: the claim stays (a retry could make a second one) and the proposal is linked to it so it is not listed again.
      await markDone(input.orgId, input.person.id, input.proposalId, { projectId: err.projectId, boqId: null }).catch(() => undefined)
      throw err
    }
    await giveBack()
    if (err instanceof ExtractionRejectedError) {
      return { ok: false, reason: "refused", code: err.code, message: err.message, status: err.status, issues: err.issues, ...(err.retryAfterSeconds ? { retryAfterSeconds: err.retryAfterSeconds } : {}) }
    }
    throw err
  }
}
