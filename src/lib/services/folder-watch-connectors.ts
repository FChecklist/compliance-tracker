// PROJEXA-BUILD-002 WP-13 (register row AW-605): the two real sources of the folder scan, a connected mailbox (Gmail) and a connected
// Drive folder, read through the Composio connector the person already connected (compliance.connector_accounts), and only through
// the read path of the CRR-158 scope gate (connector-data-service.ts runGatedRead): no write, edit or delete action is ever named here.
//
// HOW A READ IS MADE. openConnectorRead() finds the acting person's own ACTIVE connection for the toolkit (never a connection id a
// schedule names, so a schedule cannot read anyone else's mailbox) and returns one function, ConnectorRead. Each source takes that
// function as an argument, so the tests give it a fake and nothing here needs a network.
//
// UNVERIFIED AGAINST A LIVE ACCOUNT. Like connector-data-service.ts, the response shapes of GMAIL_FETCH_EMAILS,
// GMAIL_GET_ATTACHMENT, GOOGLEDRIVE_FIND_FILE and GOOGLEDRIVE_DOWNLOAD_FILE were written from Composio's public documentation and are
// read defensively (several field spellings, an envelope or a bare list). No call has been made against a real connected account
// (the owner connects Drive and the mailbox; OWNER_WAY5_STEPS.md). Two things are therefore deliberately narrow:
//   * a download is accepted only when the response carries the file's bytes as base64. A response that carries only an address to
//     fetch (a pre-signed URL) is refused with FolderSourceError("download_shape_unsupported"): the server does not fetch an address
//     it was handed, whoever handed it. If the live shape turns out to be a URL, that one function is what changes;
//   * the query is built only from values checked here (a Drive id of letters, digits, hyphen and underscore; a label of the same;
//     a time this file formats itself), never from text a schedule or a file supplies.
import { getActiveConnectorAccount, type ConnectorContext } from "./connector-data-store"
import { normalizeDriveFiles, normalizeGmailMessages, runGatedRead, toDriveFileSummary, toGmailMessageSummary } from "./connector-data-service"
import { FolderSourceError, type FolderFile, type FolderSource } from "./folder-watch-service"

export type ConnectorReadResult = { successful: boolean; data: unknown; error: string | null }
export type ConnectorRead = (actionSlug: string, args: Record<string, unknown>) => Promise<ConnectorReadResult>

/** The acting person's own ACTIVE connection for `toolkit`, as a read function. Throws ServiceError(400) when there is none. */
export async function openConnectorRead(ctx: ConnectorContext, toolkit: "gmail" | "googledrive"): Promise<ConnectorRead> {
  const connection = await getActiveConnectorAccount(ctx, toolkit)
  return async (actionSlug, args) => {
    const gated = await runGatedRead(ctx, toolkit, actionSlug, connection.composioConnectedAccountId, args)
    return { successful: gated.result.successful, data: gated.result.data, error: gated.result.error ?? null }
  }
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)
const DRIVE_ID = /^[A-Za-z0-9_-]{6,128}$/
const LABEL = /^[A-Za-z0-9_-]{1,64}$/

/** Base64 (or base64url) text to bytes, with the length checked BEFORE decoding. Null when it is not base64 or is too long. */
export function decodeBase64Bounded(text: string, maxBytes: number): Uint8Array | null {
  const compact = text.replace(/\s+/g, "")
  if (compact.length === 0 || compact.length > Math.ceil((maxBytes * 4) / 3) + 8) return null
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(compact)) return null
  return new Uint8Array(Buffer.from(compact.replace(/-/g, "+").replace(/_/g, "/"), "base64"))
}

const BASE64_FIELDS = ["content", "file_content", "content_base64", "base64", "data", "bytes"] as const

/** The file's bytes out of a download response, wherever the response nests them; a FolderSourceError when they are not there as base64. */
export function bytesFromDownload(data: unknown, maxBytes: number): Uint8Array {
  const holders: unknown[] = [data]
  if (isObject(data)) holders.push(data.file, data.response_data, data.data)
  for (const holder of holders) {
    if (!isObject(holder)) continue
    for (const field of BASE64_FIELDS) {
      const value = holder[field]
      if (typeof value !== "string") continue
      const bytes = decodeBase64Bounded(value, maxBytes)
      if (bytes) return bytes
      if (value.length > Math.ceil((maxBytes * 4) / 3) + 8) throw new FolderSourceError("file_too_large", "the download is larger than the limit")
    }
  }
  throw new FolderSourceError("download_shape_unsupported", "the download did not carry the file as base64")
}

function ensureOk(result: ConnectorReadResult, what: string): unknown {
  if (!result.successful) throw new FolderSourceError("source_read_failed", `${what} was refused by the connector`)
  return result.data
}

// ------------------------------------------------------------------------------------------------------------------- Drive

export function createDriveFolderSource(read: ConnectorRead, options: { folderId: string }): FolderSource {
  if (!DRIVE_ID.test(options.folderId)) throw new FolderSourceError("bad_folder", "the Drive folder id is not valid")
  const folderId = options.folderId
  return {
    kind: "drive",
    async list({ after, limit }) {
      const since = after ? ` and modifiedTime > '${after.toISOString()}'` : ""
      const data = ensureOk(
        await read("GOOGLEDRIVE_FIND_FILE", {
          q: `'${folderId}' in parents and trashed = false and mimeType != 'application/vnd.google-apps.folder'${since}`,
          orderBy: "modifiedTime asc",
          pageSize: Math.min(Math.max(Math.trunc(limit), 1), 100),
        }),
        "listing the folder",
      )
      const files: FolderFile[] = []
      for (const raw of normalizeDriveFiles(data)) {
        const f = toDriveFileSummary(raw)
        if (!f.externalId || !f.name || !f.modifiedAt) continue
        files.push({ id: f.externalId, name: f.name, mimeType: f.mimeType, sizeBytes: f.sizeBytes, modifiedAt: f.modifiedAt })
      }
      return files
    },
    async download(file, maxBytes) {
      const data = ensureOk(await read("GOOGLEDRIVE_DOWNLOAD_FILE", { file_id: file.id }), "the download")
      return bytesFromDownload(data, maxBytes)
    },
  }
}

// ------------------------------------------------------------------------------------------------------------------ mailbox

/** The bare address out of `Name <a@b.c>` or `a@b.c`, lower case; null when there is none. */
export function senderAddress(value: unknown): string | null {
  if (typeof value !== "string") return null
  const angled = /<([^<>\s]+@[^<>\s]+)>/.exec(value)
  const bare = angled ? angled[1] : /^\s*([^<>\s]+@[^<>\s]+)\s*$/.exec(value)?.[1]
  return bare ? bare.toLowerCase() : null
}

type RawAttachment = { name: string; mimeType: string | null; attachmentId: string; size: number | null }

function attachmentsOf(raw: Record<string, unknown>): RawAttachment[] {
  const list = raw.attachmentList ?? raw.attachments ?? raw.attachment_list
  if (!Array.isArray(list)) return []
  const out: RawAttachment[] = []
  for (const a of list) {
    if (!isObject(a)) continue
    const name = a.filename ?? a.fileName ?? a.file_name ?? a.name
    const id = a.attachmentId ?? a.attachment_id ?? a.id
    if (typeof name !== "string" || typeof id !== "string" || id === "") continue
    const size = a.size ?? a.sizeBytes
    out.push({ name, attachmentId: id, mimeType: typeof (a.mimeType ?? a.mime_type) === "string" ? String(a.mimeType ?? a.mime_type) : null, size: typeof size === "number" && Number.isFinite(size) ? size : null })
  }
  return out
}

/** The From header of a message that carries its payload headers, or undefined. */
function fromHeader(raw: Record<string, unknown>): string | undefined {
  const headers = isObject(raw.payload) ? raw.payload.headers : undefined
  if (!Array.isArray(headers)) return undefined
  for (const h of headers) {
    if (isObject(h) && typeof h.name === "string" && h.name.toLowerCase() === "from" && typeof h.value === "string") return h.value
  }
  return undefined
}

/** The files (xlsx attachments) of the messages a GMAIL_FETCH_EMAILS response holds. Pure. */
export function filesFromMessages(data: unknown): FolderFile[] {
  const files: FolderFile[] = []
  for (const raw of normalizeGmailMessages(data)) {
    const summary = toGmailMessageSummary(raw)
    if (!summary.externalId || !summary.sentAt) continue
    const sender = senderAddress(raw.sender ?? raw.from ?? fromHeader(raw))
    for (const a of attachmentsOf(raw)) {
      files.push({ id: `${summary.externalId}:${a.attachmentId}`, name: a.name, mimeType: a.mimeType, sizeBytes: a.size, modifiedAt: summary.sentAt, sender })
    }
  }
  return files
}

export function createMailboxSource(read: ConnectorRead, options: { label?: string } = {}): FolderSource {
  if (options.label !== undefined && !LABEL.test(options.label)) throw new FolderSourceError("bad_folder", "the mailbox label is not valid")
  const label = options.label
  return {
    kind: "mailbox",
    async list({ after, limit }) {
      // Gmail's after: is in whole seconds. One second earlier, so a message at the cursor's second is listed again and the scan's own
      // cursor test (time and id) drops it, instead of a message in the same second being missed.
      const since = after ? ` after:${Math.max(Math.floor(after.getTime() / 1000) - 1, 0)}` : ""
      const data = ensureOk(
        await read("GMAIL_FETCH_EMAILS", {
          user_id: "me",
          max_results: Math.min(Math.max(Math.trunc(limit), 1), 50),
          query: `has:attachment filename:xlsx${label ? ` label:${label}` : ""}${since}`,
          include_payload: true,
        }),
        "listing the mailbox",
      )
      return filesFromMessages(data)
    },
    async download(file, maxBytes) {
      const colon = file.id.indexOf(":")
      if (colon <= 0) throw new FolderSourceError("bad_file", "the attachment id is not valid")
      const messageId = file.id.slice(0, colon)
      const attachmentId = file.id.slice(colon + 1)
      const data = ensureOk(await read("GMAIL_GET_ATTACHMENT", { user_id: "me", message_id: messageId, attachment_id: attachmentId, file_name: file.name }), "the attachment download")
      return bytesFromDownload(data, maxBytes)
    },
  }
}
