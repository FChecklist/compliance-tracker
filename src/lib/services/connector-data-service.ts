// GAP-CONNECTOR-DATA (D26.B2.S1, ai-os/STATUS-REPORT.md item 6): the
// confirmed, named gap this file closes -- all 18 OAuth connector toolkits
// built in src/lib/composio-connectors.ts were, until this wave, connect-
// STATUS only. The app could tell you "this org is connected to Gmail" but
// nothing anywhere ever pulled a single real message, file, or row through
// any of those connections. Direct grep of src/app/api/connectors/** before
// this wave confirmed it: only POST (initiate) and POST .../sync (poll
// status) existed -- no GET-real-data route, no code path that ever called
// Composio's tool-execution endpoint.
//
// Scope (per dispatch brief): the 2 highest-value toolkits with the clearest
// API surface via Composio's managed OAuth -- Gmail (recent messages) and
// Google Drive (recent files). Not all 18; the other 16 toolkits' data-pull
// is the same pattern applied again, deliberately left as follow-up rather
// than padding this pass with mechanical repetition.
//
// Each successful pull also writes a canonical row into connectorDocuments
// (schema.ts) and 2 entity_relationships edges via connector-data-store.ts
// -- the first real slice of the Business Digital Twin (D26.B4.S1, see that
// file's header). Digital Twin writes are best-effort and never block the
// data pull itself from returning to the caller.
//
// Honest disclosed limitation: the exact JSON shape of Composio's tool-
// execution response for GMAIL_FETCH_EMAILS / GOOGLEDRIVE_FIND_FILE was
// confirmed against Composio's public API docs (docs.composio.dev, "Execute
// tool" + the Gmail/Google Drive toolkit reference pages, 2026-07-12) but
// NOT against a live call -- this session's sandbox cannot reach
// backend.composio.dev any more than it can reach the Supabase pooler (see
// AGENTS.md dispatch constraints). The normalizers below (normalizeGmail
// Messages/normalizeDriveFiles) are therefore written defensively: they
// accept several plausible envelope/field-name shapes (snake_case AND
// camelCase, a top-level array OR a `messages`/`files`/`response_data`
// wrapper) and degrade to an empty/null field rather than throwing when a
// field is missing, instead of asserting one exact shape that might not
// survive first contact with the real API. This should be verified against
// a real connected account before being trusted as final -- flagged in the
// PR description, not silently assumed correct.
import { executeAction, type ConnectorToolkit } from "@/lib/composio-connectors"
import { getActiveConnectorAccount, upsertConnectorDocument, type ConnectorContext } from "./connector-data-store"
import { ServiceError } from "./compliance-service"

export { ServiceError }

const MAX_RESULTS_CAP = 50
const DEFAULT_MAX_RESULTS = 10

function clampMaxResults(requested: number | undefined): number {
  if (!requested || !Number.isFinite(requested) || requested < 1) return DEFAULT_MAX_RESULTS
  return Math.min(Math.floor(requested), MAX_RESULTS_CAP)
}

function parseTimestamp(value: unknown): Date | null {
  if (value === null || value === undefined || value === "") return null
  // Gmail's internalDate is epoch milliseconds as a string; Drive's
  // modifiedTime/createdTime are RFC3339 strings. `Number(value)` only
  // succeeds for the former (RFC3339 strings are NaN), so this one check
  // safely handles both without needing to know which source it came from.
  const asNumber = Number(value)
  const date = Number.isFinite(asNumber) && asNumber > 0 ? new Date(asNumber) : new Date(String(value))
  return Number.isNaN(date.getTime()) ? null : date
}

// ─── Gmail ──────────────────────────────────────────────────────────────

export type GmailMessageSummary = {
  externalId: string
  threadId: string | null
  subject: string | null
  snippet: string | null
  sentAt: Date | null
  labelIds: string[]
}

type RawGmailMessage = Record<string, unknown>

/** Extracts the list of raw message objects out of whatever envelope Composio wraps GMAIL_FETCH_EMAILS's response in. Never throws -- an unrecognised shape returns an empty array. */
export function normalizeGmailMessages(raw: unknown): RawGmailMessage[] {
  if (Array.isArray(raw)) return raw as RawGmailMessage[]
  if (!raw || typeof raw !== "object") return []
  const obj = raw as Record<string, unknown>
  const candidates = [obj.messages, obj.response_data, obj.items, obj.data]
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate as RawGmailMessage[]
  }
  return []
}

/** Maps one raw Composio Gmail message object to our stable summary shape, defensively checking both the documented camelCase field names and plausible snake_case equivalents. */
export function toGmailMessageSummary(raw: RawGmailMessage): GmailMessageSummary {
  const externalId = String(raw.messageId ?? raw.message_id ?? raw.id ?? "")
  const threadIdRaw = raw.threadId ?? raw.thread_id
  const labelIdsRaw = raw.labelIds ?? raw.label_ids
  return {
    externalId,
    threadId: threadIdRaw ? String(threadIdRaw) : null,
    subject: raw.subject ? String(raw.subject) : null,
    snippet: raw.snippet ? String(raw.snippet) : null,
    sentAt: parseTimestamp(raw.internalDate ?? raw.internal_date),
    labelIds: Array.isArray(labelIdsRaw) ? labelIdsRaw.map(String) : [],
  }
}

/**
 * Pulls the caller's `maxResults` most recent Gmail messages through their
 * already-connected Gmail account -- REAL message data (subject/snippet/
 * timestamp), not connection status. Throws ServiceError(400) if the org/
 * user hasn't connected Gmail, or the connection isn't ACTIVE -- never
 * crashes on a missing connection.
 */
export async function listRecentGmailMessages(
  ctx: ConnectorContext,
  opts: { maxResults?: number; query?: string } = {}
): Promise<GmailMessageSummary[]> {
  const connection = await getActiveConnectorAccount(ctx, "gmail")
  const maxResults = clampMaxResults(opts.maxResults)

  const result = await executeAction<unknown>("GMAIL_FETCH_EMAILS", connection.composioConnectedAccountId, ctx.userId, {
    user_id: "me",
    max_results: maxResults,
    ...(opts.query ? { query: opts.query } : {}),
  })

  if (!result.successful) {
    throw new ServiceError(`Gmail fetch failed via Composio: ${result.error ?? "unknown error"}`, 502)
  }

  const messages = normalizeGmailMessages(result.data).map(toGmailMessageSummary).filter((m) => m.externalId)

  await persistGmailDocuments(ctx, connection.id, messages)

  return messages
}

async function persistGmailDocuments(ctx: ConnectorContext, connectorAccountId: string, messages: GmailMessageSummary[]) {
  for (const message of messages) {
    try {
      await upsertConnectorDocument(ctx, connectorAccountId, {
        toolkitSlug: "gmail",
        externalId: message.externalId,
        title: message.subject,
        sourceUrl: message.threadId ? `https://mail.google.com/mail/u/0/#all/${message.threadId}` : null,
        ownerId: null, // GMAIL_FETCH_EMAILS's list view doesn't include the sender header without include_payload=true -- left null rather than guessing
        lastModifiedAt: message.sentAt,
        metadata: { snippet: message.snippet, labelIds: message.labelIds, threadId: message.threadId },
      })
    } catch (err) {
      console.error(`connector-data-service: failed to persist digital-twin row for gmail message ${message.externalId}:`, err)
    }
  }
}

// ─── Google Drive ───────────────────────────────────────────────────────

export type DriveFileSummary = {
  externalId: string
  name: string | null
  mimeType: string | null
  webViewLink: string | null
  ownerEmail: string | null
  modifiedAt: Date | null
  sizeBytes: number | null
}

type RawDriveFile = Record<string, unknown>

/** Extracts the list of raw file objects out of whatever envelope Composio wraps GOOGLEDRIVE_FIND_FILE's response in. Never throws -- an unrecognised shape returns an empty array. */
export function normalizeDriveFiles(raw: unknown): RawDriveFile[] {
  if (Array.isArray(raw)) return raw as RawDriveFile[]
  if (!raw || typeof raw !== "object") return []
  const obj = raw as Record<string, unknown>
  const candidates = [obj.files, obj.response_data, obj.items, obj.data]
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate as RawDriveFile[]
  }
  return []
}

/** Maps one raw Composio Drive file object to our stable summary shape. owners is documented as an array of {emailAddress, displayName}; only the first owner's email is kept (Drive files can have multiple owners in Shared Drives, out of scope for this summary). */
export function toDriveFileSummary(raw: RawDriveFile): DriveFileSummary {
  const externalId = String(raw.id ?? raw.fileId ?? raw.file_id ?? "")
  const owners = raw.owners
  const firstOwnerEmail = Array.isArray(owners) && owners.length > 0 && owners[0] && typeof owners[0] === "object"
    ? ((owners[0] as Record<string, unknown>).emailAddress ?? (owners[0] as Record<string, unknown>).email_address ?? null)
    : null
  const size = raw.size ?? raw.quotaBytesUsed
  return {
    externalId,
    name: raw.name ? String(raw.name) : null,
    mimeType: raw.mimeType ? String(raw.mimeType) : (raw.mime_type ? String(raw.mime_type) : null),
    webViewLink: raw.webViewLink ? String(raw.webViewLink) : (raw.web_view_link ? String(raw.web_view_link) : null),
    ownerEmail: firstOwnerEmail ? String(firstOwnerEmail) : null,
    modifiedAt: parseTimestamp(raw.modifiedTime ?? raw.modified_time),
    sizeBytes: size !== undefined && size !== null && !Number.isNaN(Number(size)) ? Number(size) : null,
  }
}

/**
 * Pulls the caller's `maxResults` most recently modified Google Drive files
 * through their already-connected Drive account -- REAL file metadata (name/
 * mimeType/link/owner/modified time), not connection status. Throws
 * ServiceError(400) if the org/user hasn't connected Google Drive, or the
 * connection isn't ACTIVE -- never crashes on a missing connection.
 */
export async function listRecentDriveFiles(
  ctx: ConnectorContext,
  opts: { maxResults?: number } = {}
): Promise<DriveFileSummary[]> {
  const connection = await getActiveConnectorAccount(ctx, "googledrive")
  const maxResults = clampMaxResults(opts.maxResults)

  const result = await executeAction<unknown>("GOOGLEDRIVE_FIND_FILE", connection.composioConnectedAccountId, ctx.userId, {
    orderBy: "modifiedTime desc",
    pageSize: maxResults,
  })

  if (!result.successful) {
    throw new ServiceError(`Google Drive fetch failed via Composio: ${result.error ?? "unknown error"}`, 502)
  }

  const files = normalizeDriveFiles(result.data).map(toDriveFileSummary).filter((f) => f.externalId)

  await persistDriveDocuments(ctx, connection.id, files)

  return files
}

async function persistDriveDocuments(ctx: ConnectorContext, connectorAccountId: string, files: DriveFileSummary[]) {
  for (const file of files) {
    try {
      await upsertConnectorDocument(ctx, connectorAccountId, {
        toolkitSlug: "googledrive",
        externalId: file.externalId,
        title: file.name,
        sourceUrl: file.webViewLink,
        ownerId: file.ownerEmail,
        lastModifiedAt: file.modifiedAt,
        metadata: { mimeType: file.mimeType, sizeBytes: file.sizeBytes },
      })
    } catch (err) {
      console.error(`connector-data-service: failed to persist digital-twin row for drive file ${file.externalId}:`, err)
    }
  }
}

// Re-exported so callers/tests can check "is this toolkit even one this
// service knows how to pull data for" without importing composio-connectors
// separately. Deliberately narrower than the full ConnectorToolkit union --
// only the 2 toolkits this pass actually implements.
export const SUPPORTED_DATA_PULL_TOOLKITS: readonly ConnectorToolkit[] = ["gmail", "googledrive"]
