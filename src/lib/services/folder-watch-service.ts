// PROJEXA-BUILD-002 WP-13 (register row AW-605): way 5, the software pulls from a connected mailbox or folder on its own.
//
// WHAT IT DOES. One scan of one connected source (a mailbox first, a Drive folder next) for one person:
//   1. reads the CURSOR stored for that source (where the last scan got to);
//   2. lists the files newer than the cursor, oldest first, and takes at most a few per run;
//   3. for each file the caps allow (an .xlsx, at most WORKBOOK_LIMITS.maxBytes, from an allowed sender when the schedule names any):
//      downloads it, and hands it to the WP-01/WP-02 reader as a JOB keyed by the file's sha256 (startExtractionJob and
//      runExtractionJob of document-extraction-service.ts, mode "prepare": the deterministic reader first, then the extraction, the
//      reconciliation gate, questions as a state). The same bytes twice are one job, because the ledger key is the hash;
//   4. records ONE PROPOSAL per file (a compliance.submissions row, source "scheduler_bridge", function create_project_from_document)
//      for a person to read and approve. Nothing in this file creates a project, a BOQ or any business record: the deps this file
//      passes to the extraction hold a createProject and a createBoq that throw, so a change that made it write would fail loudly;
//   5. advances the cursor past the file, and only after step 3's job row is durable and step 4's proposal is recorded.
//
// WHY THE CURSOR MOVES LAST. A crash between the job row and the cursor leaves the cursor behind the file. The next scan lists the
// file again, and the ledger answers that the job already exists (resume, duplicate, or still running), so no second job and no second
// model call is made; the proposal is recorded once (its key is the file hash); then the cursor moves. The cursor is therefore an
// optimisation and a bound on listing, never the thing that keeps a file from being read twice: the ledger is.
//
// THE CURSOR is { modifiedAt, ids }: the newest modification time handled, and the ids handled at exactly that time (two files can
// share a second). A file is new when it is later than modifiedAt, or at modifiedAt with an id not in ids. Files are handled in
// (modifiedAt, id) order and the cursor never moves past a file that was not handled, so an earlier file that could not be read yet
// (a job still running, the extraction not configured, the rate limit) holds the cursor and is tried again on the next scan.
// A file that fails for a reason other than those waits (a download error, an unknown fault) is tried MAX_ATTEMPTS times and then
// skipped, so one bad file cannot block a folder for ever.
//
// UNTRUSTED CONTENT. A file in a mailbox or a shared folder is written by someone else. It is read by the same guarded reader as an
// upload (size, zip signature, unpacked-size ceiling, hidden characters stripped, strict schema), and a hostile sheet is refused
// with a stable code and creates nothing. No file content, file name or sender goes to a log line here; the counts this returns are
// numbers only. The proposal carries the file's name (cleaned, 200 characters), counts, and the reconciliation STATUS, and no
// amount: the list of proposals is readable by people who may not see money.
//
// WHAT THIS FILE DOES NOT KNOW: how a mailbox or a Drive is read (a FolderSource does: folder-watch-connectors.ts for the real ones,
// __test-helpers__/fake-folder-source.ts for the tests), and where the cursor and the proposals are stored (a CursorStore and a
// ProposalStore do: folder-watch-store.ts). Nothing here opens a tenant transaction.
import { createHash } from "node:crypto"
import {
  runExtractionJob,
  startExtractionJob,
  type CreateFromDocumentDeps,
  type ExtractionJobStart,
  type ParkedState,
  type ProjectSourceLedger,
  type EdgeCaller,
} from "./document-extraction-service"
import { ServiceError } from "./service-error"
import { ExtractionRejectedError, WORKBOOK_LIMITS, cleanCellText, type ExtractionErrorCode } from "./document-extraction-schema"

export const FOLDER_WATCH_LIMITS = {
  /** Files handled in one run. The run is bounded by the bridge's time budget too. */
  maxFilesPerRun: 3,
  /** Files listed from the source in one run (the rest wait for the next run). */
  maxListed: 50,
  /** Attempts on one file that fails for a reason that is not a wait, before it is skipped. */
  maxAttempts: 3,
  maxFileBytes: WORKBOOK_LIMITS.maxBytes,
} as const

export const XLSX_MIME_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
const ACCEPTED_MIME_TYPES: ReadonlySet<string> = new Set([XLSX_MIME_TYPE, "application/octet-stream", "application/zip", "application/x-zip-compressed"])

// ------------------------------------------------------------------------------------------------------------------- the source

export type FolderFile = {
  /** Stable id inside the source (a Drive file id, or "<message id>:<attachment id>" for a mailbox). */
  id: string
  name: string
  mimeType: string | null
  sizeBytes: number | null
  modifiedAt: Date
  /** The sender's address for a mailbox, lower case; null for a folder. */
  sender?: string | null
}

export type FolderSource = {
  kind: "mailbox" | "drive" | "test"
  /** Files modified after `after` (or all, when null), in any order; the scan sorts and filters again. */
  list(args: { after: Date | null; limit: number }): Promise<FolderFile[]>
  /** The file's bytes. Throws FolderSourceError; never returns more than maxBytes (the scan checks again). */
  download(file: FolderFile, maxBytes: number): Promise<Uint8Array>
}

/**
 * A read of the source that failed in a way the scan can name. `code` is a stable word, never text from the source; the status is 502
 * (the source, not the request, failed). A ServiceError, so a caller that already turns ServiceError into an answer needs no new case.
 */
export class FolderSourceError extends ServiceError {
  constructor(code: string, message: string) {
    super(message, 502, { code })
    this.name = "FolderSourceError"
  }
}

// ------------------------------------------------------------------------------------------------------------------- the cursor

export type FolderCursor = {
  v: 1
  /** ISO time of the newest file handled. */
  modifiedAt: string
  /** Ids handled at exactly that time. */
  ids: string[]
  /** The file that failed last time for a reason that is not a wait, and how many times. */
  stuck?: { id: string; attempts: number }
}

export type CursorStore = {
  read(key: string): Promise<FolderCursor | null>
  write(key: string, cursor: FolderCursor): Promise<void>
}

/** Later than the cursor: newer, or at the cursor's time with an id not yet handled. */
export function isNewerThanCursor(file: FolderFile, cursor: FolderCursor | null): boolean {
  if (!cursor) return true
  const at = file.modifiedAt.getTime()
  const seen = new Date(cursor.modifiedAt).getTime()
  if (at > seen) return true
  return at === seen && !cursor.ids.includes(file.id)
}

/** The cursor after `file` was handled. The files must be handled in (modifiedAt, id) order for this to be exact. */
export function advanceCursor(cursor: FolderCursor | null, file: FolderFile): FolderCursor {
  const at = file.modifiedAt.toISOString()
  if (cursor && cursor.modifiedAt === at) {
    return { v: 1, modifiedAt: at, ids: cursor.ids.includes(file.id) ? cursor.ids : [...cursor.ids, file.id] }
  }
  return { v: 1, modifiedAt: at, ids: [file.id] }
}

function compareFiles(a: FolderFile, b: FolderFile): number {
  const t = a.modifiedAt.getTime() - b.modifiedAt.getTime()
  if (t !== 0) return t
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

// ------------------------------------------------------------------------------------------------------------------- the proposal

export type ProposalDraft = {
  orgId: string
  /** The person the schedule runs as; the proposal is theirs. */
  ownerId: string
  scheduleId: string | null
  productId: string
  contentSha256: string
  /** The ledger row of the job (source_object.id). */
  jobId: string
  state: ParkedState
  fileName: string
  source: { kind: FolderSource["kind"]; folderKey: string; fileId: string }
  questionCount: number
  lineCount: number
  sheetCount: number
  /** matched, shortfall or none: a word, never an amount. */
  reconciliationStatus: string
}

export type ProposalStore = {
  /** One proposal per file hash and organisation: a second call for the same hash returns the first and creates nothing. */
  record(draft: ProposalDraft): Promise<{ id: string; created: boolean }>
}

// ------------------------------------------------------------------------------------------------------------------- the scan

export type ScanInput = {
  orgId: string
  /** A real compliance.users id: the schedule's owner. */
  actorId: string
  scheduleId?: string | null
  productId: string
  /** Names the connected folder inside its source (a Drive folder id, a mailbox label); part of the cursor key. */
  folderKey: string
  maxFiles?: number
  /** Lower-case addresses; when set, a mailbox file from anyone else is skipped. */
  allowedSenders?: readonly string[]
  /** Epoch milliseconds after which no new file is started. */
  deadlineAt?: number
  now?: () => number
}

export type ScanDeps = {
  source: FolderSource
  cursors: CursorStore
  proposals: ProposalStore
  ledger: ProjectSourceLedger
  callEdge: EdgeCaller
}

/** Numbers only (the bridge keeps them in last_result and the audit row). */
export type ScanCounts = {
  listed: number
  handled: number
  proposed: number
  alreadyProposed: number
  alreadyCreated: number
  skippedType: number
  skippedSize: number
  skippedSender: number
  refused: number
  waiting: number
  failed: number
  gaveUp: number
}

export type ScanResult = {
  counts: ScanCounts
  /** Why the scan stopped before the end of the list, when it did: a stable word. */
  stoppedBecause: null | "limit" | "deadline" | "waiting" | "failed"
  cursor: FolderCursor | null
}

export const sha256Hex = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex")

/** The codes that mean "not now" and cost no attempt: the extraction is not set up, is busy, or the hour's limit is used. */
const WAIT_CODES: ReadonlySet<ExtractionErrorCode> = new Set<ExtractionErrorCode>(["duplicate_in_progress", "extraction_rate_limited", "extraction_not_configured", "model_not_configured"])
/** Reasons a try again may work but that count as an attempt (the model answered nothing usable or the Edge Function failed). */
const RETRY_CODES: ReadonlySet<ExtractionErrorCode> = new Set<ExtractionErrorCode>(["extraction_unavailable"])

const emptyCounts = (): ScanCounts => ({ listed: 0, handled: 0, proposed: 0, alreadyProposed: 0, alreadyCreated: 0, skippedType: 0, skippedSize: 0, skippedSender: 0, refused: 0, waiting: 0, failed: 0, gaveUp: 0 })

function isXlsxName(name: string): boolean {
  return /\.xlsx$/i.test(name.trim())
}

/** The person-visible name: no control characters, no path, at most 200 characters. */
export function cleanFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name
  return cleanCellText(base, 200) || "workbook.xlsx"
}

function eligibility(file: FolderFile, input: ScanInput): "ok" | "type" | "size" | "sender" {
  if (!isXlsxName(file.name)) return "type"
  if (file.mimeType && !ACCEPTED_MIME_TYPES.has(file.mimeType.toLowerCase())) return "type"
  if (file.sizeBytes !== null && file.sizeBytes > FOLDER_WATCH_LIMITS.maxFileBytes) return "size"
  if (input.allowedSenders && input.allowedSenders.length > 0) {
    const sender = (file.sender ?? "").toLowerCase()
    if (!sender || !input.allowedSenders.includes(sender)) return "sender"
  }
  return "ok"
}

type Stored = { questions?: unknown; reconciliation?: unknown; stats?: unknown }
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)

/** Counts and status out of what a parked job stored. Defensive: a stored value that is not the expected shape reads as zeros. */
function summariseStored(result: unknown): { questionCount: number; lineCount: number; sheetCount: number; reconciliationStatus: string } {
  const stored: Stored = isObject(result) ? result : {}
  const stats = isObject(stored.stats) ? stored.stats : {}
  const recon = isObject(stored.reconciliation) ? stored.reconciliation : {}
  return {
    questionCount: Array.isArray(stored.questions) ? stored.questions.length : 0,
    lineCount: typeof stats.lines === "number" ? stats.lines : 0,
    sheetCount: typeof stats.sheets === "number" ? stats.sheets : 0,
    reconciliationStatus: typeof recon.status === "string" ? recon.status.slice(0, 40) : "none",
  }
}

/** Deps for the extraction that can never create anything: the scan only prepares. */
function prepareOnlyDeps(deps: ScanDeps): CreateFromDocumentDeps<{ id: string }, { id: string }> {
  const refuse = async (): Promise<never> => {
    throw new Error("the folder scan prepares a project and never creates one")
  }
  return { callEdge: deps.callEdge, ledger: deps.ledger, createProject: refuse, createBoq: refuse }
}

type FileOutcome =
  | { kind: "done"; counter: keyof ScanCounts }
  /** Not now, and no attempt is used. The scan stops here so the cursor does not pass the file. */
  | { kind: "wait" }
  /** Failed; counts one attempt against the file. */
  | { kind: "retry" }

/** Hands one downloaded, eligible file to the job and records its proposal. */
async function handleFile(file: FolderFile, bytes: Uint8Array, input: ScanInput, deps: ScanDeps): Promise<FileOutcome> {
  const contentSha256 = sha256Hex(bytes)
  const fileName = cleanFileName(file.name)
  const propose = async (jobId: string, state: ParkedState, stored: unknown): Promise<FileOutcome> => {
    const draft: ProposalDraft = {
      orgId: input.orgId,
      ownerId: input.actorId,
      scheduleId: input.scheduleId ?? null,
      productId: input.productId,
      contentSha256,
      jobId,
      state,
      fileName,
      source: { kind: deps.source.kind, folderKey: input.folderKey, fileId: file.id },
      ...summariseStored(stored),
    }
    const recorded = await deps.proposals.record(draft)
    return { kind: "done", counter: recorded.created ? "proposed" : "alreadyProposed" }
  }

  let start: ExtractionJobStart
  try {
    start = await startExtractionJob({ fileName, bytes }, { ledger: deps.ledger })
  } catch (err) {
    if (err instanceof ExtractionRejectedError) {
      if (WAIT_CODES.has(err.code)) return { kind: "wait" }
      if (RETRY_CODES.has(err.code)) return { kind: "retry" }
      // unsupported_file_type, workbook_unreadable, workbook_empty, workbook_too_large: the file itself is refused before any claim.
      return { kind: "done", counter: "refused" }
    }
    return { kind: "retry" }
  }

  if (start.kind === "duplicate") return { kind: "done", counter: "alreadyCreated" }
  if (start.kind === "resume") return propose(start.claimId, start.state, start.result)

  try {
    const run = await runExtractionJob(
      start,
      { orgId: input.orgId, actorId: input.actorId, productId: input.productId, fileName, bytes, mode: "prepare" },
      prepareOnlyDeps(deps),
    )
    if (!("pending" in run) || run.pending !== true) {
      // Cannot happen in prepare mode. Treated as a fault, not as a created project: this scan never creates one.
      return { kind: "retry" }
    }
    return propose(run.jobId, run.state, { questions: run.questions, reconciliation: run.reconciliation, stats: run.extraction })
  } catch (err) {
    if (err instanceof ExtractionRejectedError) {
      if (WAIT_CODES.has(err.code)) return { kind: "wait" }
      if (RETRY_CODES.has(err.code)) return { kind: "retry" }
      // The job was released with its reason (rejected). A file the reader or the reconciliation refuses is not tried again.
      return { kind: "done", counter: "refused" }
    }
    return { kind: "retry" }
  }
}

/**
 * One scan. Never throws for a file: a failing file is counted and stops the scan (a wait) or is retried on the next run. It does
 * throw when the source cannot be listed or the cursor cannot be read or written (nothing was lost: the next run starts again from
 * the stored cursor). The result is numbers and a stop word; it holds no file name.
 */
export async function scanConnectedFolder(input: ScanInput, deps: ScanDeps): Promise<ScanResult> {
  const now = input.now ?? Date.now
  const cursorKey = `${deps.source.kind}:${input.folderKey}`
  const maxFiles = Math.min(Math.max(Math.trunc(input.maxFiles ?? FOLDER_WATCH_LIMITS.maxFilesPerRun), 1), 10)
  const counts = emptyCounts()

  let cursor = await deps.cursors.read(cursorKey)
  const listed = await deps.source.list({ after: cursor ? new Date(cursor.modifiedAt) : null, limit: FOLDER_WATCH_LIMITS.maxListed })

  // The source is not trusted to order or to filter: sort, drop what the cursor has passed, drop repeats, bound.
  const seen = new Set<string>()
  const files = listed
    .filter((f) => f && typeof f.id === "string" && f.id !== "" && f.modifiedAt instanceof Date && !Number.isNaN(f.modifiedAt.getTime()))
    .filter((f) => isNewerThanCursor(f, cursor))
    .filter((f) => (seen.has(f.id) ? false : (seen.add(f.id), true)))
    .sort(compareFiles)
    .slice(0, FOLDER_WATCH_LIMITS.maxListed)
  counts.listed = files.length

  let stoppedBecause: ScanResult["stoppedBecause"] = null
  for (const file of files) {
    const stop = stopWord(counts.handled, maxFiles, input.deadlineAt, now)
    if (stop) {
      stoppedBecause = stop
      break
    }

    // A file the caps refuse is never downloaded and is not a job: it is counted, and the cursor moves past it for good.
    const gate = eligibility(file, input)
    if (gate !== "ok") {
      counts[gate === "type" ? "skippedType" : gate === "size" ? "skippedSize" : "skippedSender"]++
      cursor = await moveOn(cursorKey, cursor, file, deps)
      continue
    }

    let outcome: FileOutcome
    try {
      const bytes = await deps.source.download(file, FOLDER_WATCH_LIMITS.maxFileBytes)
      if (bytes.byteLength > FOLDER_WATCH_LIMITS.maxFileBytes) {
        counts.skippedSize++
        cursor = await moveOn(cursorKey, cursor, file, deps)
        continue
      }
      outcome = await handleFile(file, bytes, input, deps)
    } catch (err) {
      // A source that could not hand the file over (or a fault inside the job): one attempt used, the file stays ahead of the cursor.
      outcome = err instanceof FolderSourceError && err.code === "not_connected" ? { kind: "wait" } : { kind: "retry" }
    }

    if (outcome.kind === "wait") {
      counts.waiting++
      stoppedBecause = "waiting"
      break
    }
    if (outcome.kind === "retry") {
      const attempts = cursor?.stuck?.id === file.id ? cursor.stuck.attempts + 1 : 1
      if (attempts >= FOLDER_WATCH_LIMITS.maxAttempts) {
        counts.gaveUp++
        counts.handled++
        cursor = await moveOn(cursorKey, cursor, file, deps)
        continue
      }
      counts.failed++
      stoppedBecause = "failed"
      cursor = await noteAttempt(cursorKey, cursor, file, attempts, deps)
      break
    }

    counts[outcome.counter]++
    counts.handled++
    // The job row is durable and the proposal is recorded (handleFile returned done): only now does the cursor move.
    cursor = await moveOn(cursorKey, cursor, file, deps)
  }

  return { counts, stoppedBecause, cursor }
}

/** Why the scan must start no further file: the run limit, or the deadline. Null when it may go on. */
function stopWord(handled: number, maxFiles: number, deadlineAt: number | undefined, now: () => number): "limit" | "deadline" | null {
  if (handled >= maxFiles) return "limit"
  if (deadlineAt !== undefined && now() >= deadlineAt) return "deadline"
  return null
}

/** Records that `file` failed `attempts` times, without moving the cursor. */
async function noteAttempt(key: string, cursor: FolderCursor | null, file: FolderFile, attempts: number, deps: ScanDeps): Promise<FolderCursor> {
  const base: FolderCursor = cursor ?? { v: 1, modifiedAt: new Date(0).toISOString(), ids: [] }
  const next: FolderCursor = { ...base, stuck: { id: file.id, attempts } }
  await deps.cursors.write(key, next)
  return next
}

async function moveOn(key: string, cursor: FolderCursor | null, file: FolderFile, deps: ScanDeps): Promise<FolderCursor> {
  const next = advanceCursor(cursor, file)
  await deps.cursors.write(key, next)
  return next
}
