// PROJEXA-BUILD-002 WP-13 (register row AW-605): the scan_connected_folder job (see scheduled-jobs.ts for what a job is and why this
// one is in no registry). It checks who is asking and what the schedule says, opens the owner's own connected source, and runs ONE
// scan (folder-watch-service.ts scanConnectedFolder) with the real cursor store, proposal store and extraction ledger.
//
// PARAMS of the schedule (a JSON object; unknown keys are refused, so a typo is not silently ignored):
//   source          "mailbox" or "drive"                                       required
//   productId       the product the project will be made in                    required, must exist in the organisation
//   folderId        a Drive folder id                                          required for drive
//   label           a Gmail label (letters, digits, hyphen, underscore)        optional, mailbox only
//   allowedSenders  up to 20 e-mail addresses; a mailbox file from anyone else is skipped   optional, mailbox only
//   maxFiles        1 to 5, default 3                                          optional
//
// WHO MAY RUN IT. The owner must be a member or above (the rank that may create a project: the from-document route asks the same),
// because the proposals this job prepares are proposals of a project. The connection used is the OWNER'S OWN active connection for
// the toolkit; no connection id is taken from the params.
//
// WHAT THE ANSWER HOLDS: the numbers of ScanCounts and, when the scan stopped before the end of the list, one stop word (limit,
// deadline, waiting or failed). A source that is not connected, a bad param, a missing product, a role below member: a failure code
// and a reason word. No text from a file or a source is ever in it.
import { ServiceError } from "@/lib/services/compliance-service"
import { ROLE_RANK, type UserRole } from "@/lib/supabase/role-rank"
import { createDbProjectSourceLedger, createEdgeExtractCaller, type EdgeCaller, type ProjectSourceLedger } from "@/lib/services/document-extraction-service"
import { FolderSourceError, scanConnectedFolder, type CursorStore, type FolderSource, type ProposalStore, type ScanCounts } from "@/lib/services/folder-watch-service"
import { createDriveFolderSource, createMailboxSource, openConnectorRead } from "@/lib/services/folder-watch-connectors"
import { createDbCursorStore, createDbProposalStore, productExistsInOrg } from "@/lib/services/folder-watch-store"
import type { ScheduledJobContext, ScheduledJobReport } from "./scheduled-jobs"

const KNOWN_PARAMS: ReadonlySet<string> = new Set(["source", "productId", "folderId", "label", "allowedSenders", "maxFiles"])
const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/
const MAX_SENDERS = 20

export type ScanParams = {
  source: "mailbox" | "drive"
  productId: string
  folderKey: string
  folderId?: string
  label?: string
  allowedSenders?: string[]
  maxFiles?: number
}

/** The sender list of a mailbox schedule, lower-cased, or null when it is not a list of 1 to 20 e-mail addresses. */
function parseSenders(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_SENDERS) return null
  const senders: string[] = []
  for (const s of value) {
    if (typeof s !== "string" || s.length > 200 || !EMAIL.test(s.trim())) return null
    senders.push(s.trim().toLowerCase())
  }
  return senders
}

type ParseResult = { ok: true; value: ScanParams } | { ok: false; reason: string }

function parseDrive(params: Record<string, unknown>, productId: string, maxFiles: number | undefined): ParseResult {
  const { folderId, label, allowedSenders } = params
  if (typeof folderId !== "string" || folderId.trim() === "") return { ok: false, reason: "folder_required" }
  if (label !== undefined) return { ok: false, reason: "label_not_for_drive" }
  if (allowedSenders !== undefined) return { ok: false, reason: "senders_invalid" }
  return { ok: true, value: { source: "drive", productId, folderId: folderId.trim(), folderKey: folderId.trim(), ...(maxFiles !== undefined ? { maxFiles } : {}) } }
}

function parseMailbox(params: Record<string, unknown>, productId: string, maxFiles: number | undefined): ParseResult {
  const { folderId, label, allowedSenders } = params
  if (folderId !== undefined) return { ok: false, reason: "folder_not_for_mailbox" }
  if (label !== undefined && (typeof label !== "string" || label.trim() === "")) return { ok: false, reason: "label_invalid" }
  const senders = allowedSenders === undefined ? undefined : parseSenders(allowedSenders)
  if (senders === null) return { ok: false, reason: "senders_invalid" }
  return {
    ok: true,
    value: {
      source: "mailbox",
      productId,
      folderKey: typeof label === "string" ? label.trim() : "inbox",
      ...(typeof label === "string" ? { label: label.trim() } : {}),
      ...(senders ? { allowedSenders: senders } : {}),
      ...(maxFiles !== undefined ? { maxFiles } : {}),
    },
  }
}

/** The schedule's params as a ScanParams, or the reason word that names what is wrong. Pure. */
export function parseScanParams(params: Record<string, unknown>): ParseResult {
  for (const key of Object.keys(params)) if (!KNOWN_PARAMS.has(key)) return { ok: false, reason: "unknown_param" }
  const { source, productId, maxFiles } = params
  if (source !== "mailbox" && source !== "drive") return { ok: false, reason: "source_invalid" }
  if (typeof productId !== "string" || productId.trim() === "" || productId.length > 100) return { ok: false, reason: "product_required" }
  if (maxFiles !== undefined && (typeof maxFiles !== "number" || !Number.isInteger(maxFiles) || maxFiles < 1 || maxFiles > 5)) return { ok: false, reason: "max_files_invalid" }
  return source === "drive" ? parseDrive(params, productId.trim(), maxFiles) : parseMailbox(params, productId.trim(), maxFiles)
}

/** What the job reaches out to. The real ones by default; a test gives a fake source and in-memory stores. */
export type ScanJobDeps = {
  openSource(ctx: { orgId: string; actorId: string }, params: ScanParams): Promise<FolderSource>
  cursors(ctx: { orgId: string; actorId: string }): CursorStore
  proposals(ctx: { orgId: string; actorId: string }): ProposalStore
  ledger(ctx: { orgId: string; actorId: string }): ProjectSourceLedger
  callEdge(): EdgeCaller
  productExists(ctx: { orgId: string; actorId: string }, productId: string): Promise<boolean>
  now(): number
}

export const realScanJobDeps: ScanJobDeps = {
  async openSource(ctx, params) {
    const read = await openConnectorRead({ orgId: ctx.orgId, userId: ctx.actorId }, params.source === "mailbox" ? "gmail" : "googledrive")
    return params.source === "mailbox" ? createMailboxSource(read, { label: params.label }) : createDriveFolderSource(read, { folderId: params.folderId! })
  },
  cursors: (ctx) => createDbCursorStore(ctx),
  proposals: (ctx) => createDbProposalStore(ctx),
  ledger: (ctx) => createDbProjectSourceLedger(ctx),
  callEdge: () => createEdgeExtractCaller({ baseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL, secret: process.env.PROJEXA_DOCUMENT_EXTRACT_SECRET }),
  productExists: (ctx, productId) => productExistsInOrg(ctx, productId),
  now: () => Date.now(),
}

const MIN_ROLE_RANK = ROLE_RANK.member

const toNumbers = (counts: ScanCounts): Record<string, number> => ({ ...counts })

export async function runScanConnectedFolderJob(ctx: ScheduledJobContext, deps: ScanJobDeps = realScanJobDeps): Promise<ScheduledJobReport> {
  if ((ROLE_RANK[(ctx.owner.role ?? "") as UserRole] ?? 0) < MIN_ROLE_RANK) return { ok: false, code: "NOT_PERMITTED", reason: "role_below_member" }

  const parsed = parseScanParams(ctx.params)
  if (!parsed.ok) return { ok: false, code: "VALUE_REQUIRED", reason: parsed.reason }
  const params = parsed.value
  const actor = { orgId: ctx.orgId, actorId: ctx.owner.id }

  if (!(await deps.productExists(actor, params.productId))) return { ok: false, code: "RECORD_NOT_FOUND", reason: "product_not_found" }

  let source: FolderSource
  try {
    source = await deps.openSource(actor, params)
  } catch (err) {
    // A person who has not connected the toolkit (ServiceError 400), or a folder id / label that is not valid.
    if (err instanceof ServiceError && err.status === 400) return { ok: false, code: "REQUEST_REJECTED", reason: "not_connected" }
    if (err instanceof FolderSourceError) return { ok: false, code: "REQUEST_REJECTED", reason: err.code ?? "source_error" }
    throw err
  }

  try {
    const result = await scanConnectedFolder(
      {
        orgId: ctx.orgId,
        actorId: ctx.owner.id,
        scheduleId: ctx.scheduleId,
        productId: params.productId,
        folderKey: params.folderKey,
        maxFiles: params.maxFiles,
        allowedSenders: params.allowedSenders,
        deadlineAt: ctx.deadlineAt,
        now: deps.now,
      },
      { source, cursors: deps.cursors(actor), proposals: deps.proposals(actor), ledger: deps.ledger(actor), callEdge: deps.callEdge() },
    )
    return { ok: true, counts: toNumbers(result.counts), ...(result.stoppedBecause ? { stopped: result.stoppedBecause } : {}) }
  } catch (err) {
    // The source could not be listed, or the cursor could not be read or written. Nothing was lost: the next run starts again from the
    // stored cursor and the ledger stops a repeat. The reason is a word from the source's own stable set, never its message.
    if (err instanceof FolderSourceError) return { ok: false, code: "BACKEND_UNAVAILABLE", reason: err.code ?? "source_error" }
    if (err instanceof ServiceError) return { ok: false, code: "BACKEND_UNAVAILABLE", reason: "connector_error" }
    throw err
  }
}
