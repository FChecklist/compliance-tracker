// PROJEXA-BUILD-002 WP-13 (register row AW-605): where way 5 keeps its two small pieces of state, and the read of what it prepared.
//
// THE CURSOR of a connected source lives in compliance.source_object, the table that already holds the from-document ledger. No table
// is added (a new shared-database object needs a claim on main first, SHARED_BOUNDARY R1). A cursor row is a source_object row that
//   * has origin 'connector' and origin_ref 'projexa-folder-cursor:v1', so it is never a ledger row (the ledger reads origin_ref
//     'projexa-from-document:v1', and its hourly rate limit counts only that) and never a real capture;
//   * has a sha256 derived from (person, source, folder) under that prefix, so the partial unique index (org_id, sha256) WHERE
//     deleted_at IS NULL is what makes "one cursor per person and connected folder" a fact the database enforces, and lets the write
//     be one atomic upsert;
//   * has extract_status SKIPPED_UNSUPPORTED, which the catch-up worker never picks up, and no storage_path (no bytes);
//   * keeps the cursor in job_result (jsonb), the column the ledger uses for what a parked job keeps.
// Losing a cursor row costs nothing but a longer listing: a file already read is found again by its hash in the ledger.
//
// THE PROPOSAL is a compliance.submissions row, the store the approval list already reads (prepared-proposals.ts) and the scheduler
// bridge already writes: status in_progress, selected_chain { source: "scheduler_bridge", functionId: "create_project_from_document",
// params, note, scheduleId, contentSha256, jobId }, the schedule's owner as user_id, no project (none exists yet). One per file hash
// and organisation: the check and the insert share one transaction. It is NOT approvable from a project's list (there is no project,
// and create_project_from_document is not in S1_APPROVABLE_FUNCTION_IDS); the org-level list below is how a person finds it.
//
// Every function here opens its own tenant transaction and none is called from inside another.
import { createHash } from "node:crypto"
import { createId } from "@paralleldrive/cuid2"
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { products, sourceObject, submissions } from "@/lib/db/schema"
import { classifySubmission } from "@/lib/pipeline/classify"
import { functionLabel } from "@/lib/pipeline/function-registry"
import { PENDING_SUBMISSION_STATUSES, MAX_LISTED_PROPOSALS, NOTE_MAX_LENGTH } from "@/lib/pipeline/prepared-proposals"
import type { CursorStore, FolderCursor, ProposalDraft, ProposalStore } from "./folder-watch-service"

export const FOLDER_CURSOR_ORIGIN_REF = "projexa-folder-cursor:v1"
export const SCHEDULER_SOURCE = "scheduler_bridge"
export const FOLDER_PROPOSAL_FUNCTION_ID = "create_project_from_document"

const sha256Hex = (text: string): string => createHash("sha256").update(text).digest("hex")

/** The value stored in source_object.sha256 for one person's cursor on one connected folder. */
export function folderCursorKey(actorId: string, cursorKey: string): string {
  return sha256Hex(`${FOLDER_CURSOR_ORIGIN_REF}:${actorId}:${cursorKey}`)
}

/** A stored cursor, or null when what is stored is not the expected shape (read as "no cursor": the ledger still stops a repeat). */
export function readStoredCursor(value: unknown): FolderCursor | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null
  const v = value as Record<string, unknown>
  if (v.v !== 1 || typeof v.modifiedAt !== "string" || Number.isNaN(new Date(v.modifiedAt).getTime())) return null
  if (!Array.isArray(v.ids) || !v.ids.every((id) => typeof id === "string")) return null
  const stuck = v.stuck as Record<string, unknown> | undefined
  const validStuck = stuck && typeof stuck.id === "string" && typeof stuck.attempts === "number" ? { id: stuck.id, attempts: stuck.attempts } : undefined
  return { v: 1, modifiedAt: v.modifiedAt, ids: v.ids as string[], ...(validStuck ? { stuck: validStuck } : {}) }
}

export function createDbCursorStore(ctx: { orgId: string; actorId: string }): CursorStore {
  const tenant = { orgId: ctx.orgId, userId: ctx.actorId }
  return {
    async read(key) {
      const [row] = await withTenantContext(tenant, (db) =>
        db
          .select({ jobResult: sourceObject.jobResult })
          .from(sourceObject)
          .where(and(eq(sourceObject.orgId, ctx.orgId), eq(sourceObject.sha256, folderCursorKey(ctx.actorId, key)), eq(sourceObject.originRef, FOLDER_CURSOR_ORIGIN_REF), isNull(sourceObject.deletedAt)))
          .limit(1),
      )
      return row ? readStoredCursor(row.jobResult) : null
    },
    async write(key, cursor) {
      await withTenantContext(tenant, (db) =>
        db
          .insert(sourceObject)
          .values({
            orgId: ctx.orgId,
            origin: "connector",
            originRef: FOLDER_CURSOR_ORIGIN_REF,
            mimeType: "application/json",
            byteSize: 0,
            storagePath: null,
            sha256: folderCursorKey(ctx.actorId, key),
            title: "Connected folder cursor",
            displayName: "Connected folder cursor",
            extractStatus: "SKIPPED_UNSUPPORTED",
            jobResult: cursor,
            createdById: ctx.actorId,
            docUid: createId(),
          })
          .onConflictDoUpdate({
            target: [sourceObject.orgId, sourceObject.sha256],
            targetWhere: isNull(sourceObject.deletedAt),
            set: { jobResult: cursor, updatedAt: sql`now()` },
          }),
      )
    },
  }
}

/** True when the product exists in the organisation (the approval will need it; a wrong id is better found at the first scan). */
export async function productExistsInOrg(ctx: { orgId: string; actorId: string }, productId: string): Promise<boolean> {
  const [row] = await withTenantContext({ orgId: ctx.orgId, userId: ctx.actorId }, (db) =>
    db.select({ id: products.id }).from(products).where(and(eq(products.id, productId), eq(products.orgId, ctx.orgId))).limit(1),
  )
  return !!row
}

function noteOf(draft: ProposalDraft): string {
  const where = draft.source.kind === "mailbox" ? "a connected mailbox" : draft.source.kind === "drive" ? "a connected Drive folder" : "a connected folder"
  const next = draft.state === "needs_answers" ? `${draft.questionCount} question${draft.questionCount === 1 ? "" : "s"} need an answer before the project can be made.` : "It is ready for you to approve."
  return `Found in ${where} by a schedule and read, not created. ${next} Nothing is created until a person approves it.`.slice(0, NOTE_MAX_LENGTH)
}

export function createDbProposalStore(ctx: { orgId: string; actorId: string }): ProposalStore {
  return {
    record: (draft) =>
      withTenantContext({ orgId: ctx.orgId, userId: ctx.actorId }, async (tx) => {
        const [existing] = await tx
          .select({ id: submissions.id })
          .from(submissions)
          .where(
            and(
              eq(submissions.orgId, ctx.orgId),
              sql`${submissions.selectedChain}->>'source' = ${SCHEDULER_SOURCE}`,
              sql`${submissions.selectedChain}->>'contentSha256' = ${draft.contentSha256}`,
            ),
          )
          .limit(1)
        if (existing) return { id: existing.id, created: false }
        const [row] = await tx
          .insert(submissions)
          .values({
            orgId: ctx.orgId,
            projectId: null,
            mode: "Projects",
            selectedChain: {
              source: SCHEDULER_SOURCE,
              functionId: FOLDER_PROPOSAL_FUNCTION_ID,
              params: {
                productId: draft.productId,
                fileName: draft.fileName,
                state: draft.state,
                questionCount: draft.questionCount,
                lineCount: draft.lineCount,
                sheetCount: draft.sheetCount,
                reconciliationStatus: draft.reconciliationStatus,
                sourceKind: draft.source.kind,
                sourceFolder: draft.source.folderKey,
                sourceFileId: draft.source.fileId,
              },
              note: noteOf(draft),
              scheduleId: draft.scheduleId,
              contentSha256: draft.contentSha256,
              jobId: draft.jobId,
            },
            rawInput: functionLabel(FOLDER_PROPOSAL_FUNCTION_ID).toLowerCase(),
            userId: draft.ownerId,
            status: "in_progress",
            classification: classifySubmission(["task"]),
          })
          .returning({ id: submissions.id })
        return { id: row.id, created: true }
      }),
  }
}

// ---------------------------------------------------------------------------------------------------------- the list

/** What the proposals page shows of one proposal a schedule prepared. No amount, no file content, no parameter of a money-bearing function. */
export type SchedulerProposalView = {
  id: string
  functionId: string
  label: string
  /** The project it is about, or null for a proposal of a NEW project. */
  projectId: string | null
  preparedById: string
  createdAt: string
  note: string | null
  /** waiting_for_answers: the extraction has questions; waiting_for_approval: read and ready; other: a proposal of another function. */
  waitingOn: "answers" | "approval" | "other"
  /** Present for a folder proposal only. */
  folder: {
    jobId: string
    fileName: string
    state: "needs_answers" | "ready"
    questionCount: number
    lineCount: number
    sheetCount: number
    reconciliationStatus: string
    sourceKind: string
  } | null
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)
const str = (v: unknown, max = 200): string => (typeof v === "string" ? v.slice(0, max) : "")
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0)

/** One submissions row as a view, or null when it is not a scheduler proposal this list can describe. Pure. */
export function schedulerProposalFromRow(row: { id: string; projectId: string | null; userId: string; createdAt: Date | string; selectedChain: unknown }): SchedulerProposalView | null {
  const chain = row.selectedChain
  if (!isObject(chain) || chain.source !== SCHEDULER_SOURCE || typeof chain.functionId !== "string") return null
  const note = typeof chain.note === "string" && chain.note.trim() !== "" ? chain.note.trim().slice(0, NOTE_MAX_LENGTH) : null
  const base = { id: row.id, functionId: chain.functionId, label: functionLabel(chain.functionId), projectId: row.projectId, preparedById: row.userId, createdAt: new Date(row.createdAt).toISOString(), note }
  if (chain.functionId !== FOLDER_PROPOSAL_FUNCTION_ID) return { ...base, waitingOn: "other", folder: null }
  const p = isObject(chain.params) ? chain.params : {}
  const state = p.state === "needs_answers" ? "needs_answers" : "ready"
  return {
    ...base,
    waitingOn: state === "needs_answers" ? "answers" : "approval",
    folder: {
      jobId: str(chain.jobId, 80),
      fileName: str(p.fileName),
      state,
      questionCount: num(p.questionCount),
      lineCount: num(p.lineCount),
      sheetCount: num(p.sheetCount),
      reconciliationStatus: str(p.reconciliationStatus, 40),
      sourceKind: str(p.sourceKind, 20),
    },
  }
}

/**
 * The pending proposals a schedule prepared in this organisation, newest first, at most MAX_LISTED_PROPOSALS. `onlyFor` limits the
 * list to one person's own (a member sees theirs; the caller passes nothing for a manager, who sees the organisation's). Writes
 * nothing and asks no model. A proposal of a function other than the folder scan is listed by name and project only, never with its
 * parameters (a create_boq proposal holds rates).
 */
export async function listSchedulerProposals(ctx: { orgId: string; actorId: string }, options: { onlyFor?: string } = {}): Promise<SchedulerProposalView[]> {
  const rows = await withTenantContext({ orgId: ctx.orgId, userId: ctx.actorId }, (db) =>
    db
      .select({ id: submissions.id, projectId: submissions.projectId, userId: submissions.userId, createdAt: submissions.createdAt, selectedChain: submissions.selectedChain })
      .from(submissions)
      .where(
        and(
          eq(submissions.orgId, ctx.orgId),
          inArray(submissions.status, [...PENDING_SUBMISSION_STATUSES]),
          sql`${submissions.selectedChain}->>'source' = ${SCHEDULER_SOURCE}`,
          sql`${submissions.selectedChain}->>'claimedAt' is null`,
          ...(options.onlyFor ? [eq(submissions.userId, options.onlyFor)] : []),
        ),
      )
      .orderBy(desc(submissions.createdAt), desc(submissions.id))
      .limit(MAX_LISTED_PROPOSALS),
  )
  return rows.map(schedulerProposalFromRow).filter((v): v is SchedulerProposalView => v !== null)
}
