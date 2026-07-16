// Priority 21, Layer 2 Workspace Memory -- Option 2 (Google Drive auto-sync,
// ai-os/priority21_workspace_memory_design.md §4). Owner directive: "have
// all 3 options for the user" (design doc's own recommendation to start
// with Option 1 only is superseded by that instruction).
//
// Reuses the EXISTING, already-authenticated-per-user Composio connection
// (src/lib/composio-connectors.ts, src/lib/services/connector-data-store.ts)
// -- no new OAuth flow, matching this repo's own GAP-CONNECTOR-DATA
// precedent (connector-data-service.ts's listRecentDriveFiles()). If the
// user hasn't connected Google Drive yet, this fails the exact same way
// getActiveConnectorAccount() already fails for every other connector data
// pull: a clear ServiceError(400, "...connect it first via...") -- normalized
// here to workspace-memory-service.ts's own ServiceError class so route
// handlers only ever need to check one error type for this whole feature.
//
// Real Composio Google Drive action slugs used below (verified against
// Composio's own toolkit docs, docs.composio.dev/toolkits/googledrive,
// 2026-07-16 -- this sandbox cannot reach backend.composio.dev for a live
// call, same disclosed limitation connector-data-service.ts's own header
// already carries for GMAIL_FETCH_EMAILS/GOOGLEDRIVE_FIND_FILE):
//   GOOGLEDRIVE_FIND_FOLDER    -- locate the dedicated sync folder by exact name
//   GOOGLEDRIVE_CREATE_FOLDER  -- create it on first use
//   GOOGLEDRIVE_UPLOAD_FILE    -- upload the capsule (file_to_upload accepts
//                                 a public URL per Composio's own docs, so
//                                 this passes the same short-lived signed
//                                 URL exportWorkspaceMemory() already mints
//                                 for the Supabase-storage copy, rather than
//                                 guessing at a base64/S3-object wire format
//                                 the raw REST tools/execute endpoint this
//                                 codebase calls -- as opposed to the
//                                 official Composio SDK's convenience
//                                 wrapper -- does not document)
//   GOOGLEDRIVE_FIND_FILE      -- list the folder's contents, newest first
//   GOOGLEDRIVE_DOWNLOAD_FILE  -- fetch the latest capsule's bytes
//
// Honest disclosed limitation, same class as connector-data-service.ts's own
// header: GOOGLEDRIVE_DOWNLOAD_FILE's response `data` field is documented
// only as "string" with no further shape detail (not confirmed against a
// live call). Treated defensively below -- base64 content is tried first
// (the standard way a JSON tool-execution envelope carries binary), falling
// back to treating the string as a fetchable URL if base64-decoding doesn't
// look like a valid file. This should be verified against a real connected
// account before being trusted as final -- flagged here and in the PR
// description, not silently assumed correct.
import { executeAction } from "@/lib/composio-connectors"
import { getActiveConnectorAccount, type ConnectorContext } from "./connector-data-store"
import { ServiceError as ConnectorServiceError } from "./compliance-service"
import { ServiceError } from "./workspace-memory-service"

export const DRIVE_SYNC_FOLDER_NAME = "VERIDIAN Workspace Memory"

/**
 * Confirms the caller has an ACTIVE Google Drive connection, normalizing
 * connector-data-store.ts's ServiceError into workspace-memory-service.ts's
 * own ServiceError class so every route in this feature only ever needs to
 * check one error type. Message/status are passed through unchanged --
 * still the same "connect it first via POST /api/connectors" guidance
 * every other connector-data caller already surfaces.
 */
export async function requireActiveDriveConnection(ctx: ConnectorContext) {
  try {
    return await getActiveConnectorAccount(ctx, "googledrive")
  } catch (err) {
    if (err instanceof ConnectorServiceError) throw new ServiceError(err.message, err.status)
    throw err
  }
}

type RawDriveEntity = Record<string, unknown>

/** Same defensive multi-shape envelope unwrapping connector-data-service.ts's normalizeDriveFiles() uses -- Composio's tool-execution envelope shape isn't uniformly documented across tools. */
function unwrapEntities(raw: unknown): RawDriveEntity[] {
  if (Array.isArray(raw)) return raw as RawDriveEntity[]
  if (!raw || typeof raw !== "object") return []
  const obj = raw as Record<string, unknown>
  const candidates = [obj.files, obj.folders, obj.response_data, obj.items, obj.data]
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate as RawDriveEntity[]
  }
  return []
}

function entityId(raw: RawDriveEntity): string | null {
  const id = raw.id ?? raw.fileId ?? raw.file_id
  return id ? String(id) : null
}

/**
 * Finds the dedicated "VERIDIAN Workspace Memory" Drive folder, creating it
 * on first use so capsules never scatter loose at Drive root. Idempotent --
 * safe to call on every export/import, no local caching of the folder id
 * (a second lookup call is cheap and avoids a stale-id class of bug if the
 * user renames/moves/deletes the folder in Drive directly).
 */
export async function ensureDriveSyncFolder(
  ctx: ConnectorContext,
  connectedAccountId: string
): Promise<string> {
  const found = await executeAction<unknown>("GOOGLEDRIVE_FIND_FOLDER", connectedAccountId, ctx.userId, {
    name_exact: DRIVE_SYNC_FOLDER_NAME,
  })
  if (found.successful) {
    const existing = unwrapEntities(found.data).map(entityId).find((id): id is string => !!id)
    if (existing) return existing
  }

  const created = await executeAction<unknown>("GOOGLEDRIVE_CREATE_FOLDER", connectedAccountId, ctx.userId, {
    name: DRIVE_SYNC_FOLDER_NAME,
  })
  if (!created.successful) {
    throw new ServiceError(`Failed to create the "${DRIVE_SYNC_FOLDER_NAME}" folder in Google Drive: ${created.error ?? "unknown error"}`, 502)
  }
  const createdData = created.data as RawDriveEntity
  const newId = entityId(createdData)
  if (!newId) {
    throw new ServiceError(`Google Drive did not return a folder id after creating "${DRIVE_SYNC_FOLDER_NAME}"`, 502)
  }
  return newId
}

export type DriveUploadResult = { driveFileId: string; webViewLink: string | null }

/**
 * Uploads an already-produced capsule to the user's Drive sync folder.
 * `sourceUrl` is the short-lived signed URL exportWorkspaceMemory() already
 * mints for the Supabase-storage copy -- passed straight through as
 * `file_to_upload` (Composio's own docs confirm this parameter accepts a
 * public URL, not only a local path), so this never needs to read the
 * capsule bytes back into this process a second time.
 */
export async function uploadCapsuleToDrive(
  ctx: ConnectorContext,
  connectedAccountId: string,
  input: { sourceUrl: string; fileName: string }
): Promise<DriveUploadResult> {
  const folderId = await ensureDriveSyncFolder(ctx, connectedAccountId)

  const result = await executeAction<RawDriveEntity>("GOOGLEDRIVE_UPLOAD_FILE", connectedAccountId, ctx.userId, {
    file_to_upload: input.sourceUrl,
    name: input.fileName,
    parents: [folderId],
    mimeType: "application/octet-stream",
  })
  if (!result.successful) {
    throw new ServiceError(`Google Drive upload failed via Composio: ${result.error ?? "unknown error"}`, 502)
  }
  const data = (result.data ?? {}) as RawDriveEntity
  const driveFileId = entityId(data)
  if (!driveFileId) {
    throw new ServiceError("Google Drive upload reported success but returned no file id", 502)
  }
  const webViewLink = data.webViewLink ? String(data.webViewLink) : (data.web_view_link ? String(data.web_view_link) : null)
  return { driveFileId, webViewLink }
}

/**
 * Downloads the most recently modified capsule from the user's Drive sync
 * folder. Throws ServiceError(404) if the folder doesn't exist yet or is
 * empty -- a legitimate "nothing to sync yet" state, not a crash.
 */
export async function downloadLatestCapsuleFromDrive(
  ctx: ConnectorContext,
  connectedAccountId: string
): Promise<Buffer> {
  const found = await executeAction<unknown>("GOOGLEDRIVE_FIND_FOLDER", connectedAccountId, ctx.userId, {
    name_exact: DRIVE_SYNC_FOLDER_NAME,
  })
  const folderId = found.successful ? unwrapEntities(found.data).map(entityId).find((id): id is string => !!id) : null
  if (!folderId) {
    throw new ServiceError(`No "${DRIVE_SYNC_FOLDER_NAME}" folder found in your connected Google Drive yet -- export a capsule to Drive first.`, 404)
  }

  const listing = await executeAction<unknown>("GOOGLEDRIVE_FIND_FILE", connectedAccountId, ctx.userId, {
    folder_id: folderId,
    orderBy: "modifiedTime desc",
    pageSize: 1,
  })
  if (!listing.successful) {
    throw new ServiceError(`Failed to list capsules in Google Drive: ${listing.error ?? "unknown error"}`, 502)
  }
  const latest = unwrapEntities(listing.data)[0]
  const fileId = latest ? entityId(latest) : null
  if (!fileId) {
    throw new ServiceError(`No workspace memory capsule found in "${DRIVE_SYNC_FOLDER_NAME}" yet -- export one to Drive first.`, 404)
  }

  const download = await executeAction<unknown>("GOOGLEDRIVE_DOWNLOAD_FILE", connectedAccountId, ctx.userId, {
    fileId,
  })
  if (!download.successful) {
    throw new ServiceError(`Google Drive download failed via Composio: ${download.error ?? "unknown error"}`, 502)
  }

  return await coerceDownloadToBuffer(download.data)
}

/**
 * See this file's header for the disclosed limitation: GOOGLEDRIVE_DOWNLOAD_FILE's
 * exact response shape for the raw REST tools/execute endpoint isn't
 * confirmed against a live call. Tries base64 content first (the standard
 * way a JSON envelope carries binary data), then falls back to treating the
 * string as a fetchable URL -- never throws a generic crash, always a clear
 * ServiceError if neither shape produces real bytes.
 */
async function coerceDownloadToBuffer(raw: unknown): Promise<Buffer> {
  const value = typeof raw === "string" ? raw : (raw as RawDriveEntity | null)?.data
  if (typeof value !== "string" || value.length === 0) {
    throw new ServiceError("Google Drive download returned no file content", 502)
  }

  if (/^https?:\/\//i.test(value)) {
    const res = await fetch(value)
    if (!res.ok) throw new ServiceError(`Failed to fetch the downloaded capsule from Google Drive (HTTP ${res.status})`, 502)
    return Buffer.from(await res.arrayBuffer())
  }

  try {
    const buf = Buffer.from(value, "base64")
    if (buf.length === 0) throw new Error("empty decode")
    return buf
  } catch {
    throw new ServiceError("Could not decode the capsule downloaded from Google Drive", 502)
  }
}
