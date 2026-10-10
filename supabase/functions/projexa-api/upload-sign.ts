// PROJEXA FILE UPLOADS WITHOUT VERCEL: POST <projexa-api>/uploads/sign (contract: ai-os/audit37/UPLOAD_CONTRACT_2026-10-06.md; SQL: drizzle/0732).
//
// POST /uploads/sign   Authorization: Bearer <the person's own PROJEXA session token>
//   body {kind:"permit"|"drawing"|"document", projectId?:uuid, fileName:string, contentType:string, size:number}
//   200  {uploadUrl, method:"PUT", headers:{"content-type", "x-upsert":"false"}, externalUrl, expiresAt, maxBytes}
//   401 signed out | 400 {"error":"No organization"} | 403 read-only role | 413 too big | 415 type | 422 bad body | 429 > 200 signs/hour for the org | 5xx retryable
//
// TRUST CHAIN (same as /link-member): token verified (PROJEXA issuer only) -> organisation from the person's own `memberships` row (RLS, oldest first).
// The object path is <orgId>/<kind>/<random uuid>/<sanitised fileName>: the organisation part comes ONLY from that membership, never from the body,
// so organisation A can never obtain an upload address inside organisation B's folder. The bucket is public (owner decision), the path unguessable.
import type { SessionVerifier } from "../ai-work-link/session.ts"
import { ALLOWED_ORIGINS, RETRY_AFTER_SECONDS, type MembershipLookup } from "./handler.ts"

export const UPLOAD_SIGN_PATH_RE = /(^|\/)uploads\/sign\/?$/
export const UPLOAD_BUCKET = "projexa-files"
export const UPLOAD_MAX_FILE_BYTES = 52_428_800
export const UPLOAD_ORG_SIGNS_PER_HOUR = 200
export const UPLOAD_URL_TTL_SECONDS = 7200
/** Per-organisation total of stored bytes (Supabase Free Storage is 1 GB for the whole project, about 10 orgs). */
export const UPLOAD_ORG_QUOTA_BYTES = 104_857_600
export const FILE_NAME_MAX = 120
export const UPLOAD_KINDS = ["permit", "drawing", "document"] as const
export const ALLOWED_CONTENT_TYPES: ReadonlySet<string> = new Set([
  "application/pdf", "image/png", "image/jpeg", "image/webp", "image/gif", "image/heic",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/csv", "text/plain", "image/vnd.dwg", "application/acad", "application/x-dwg", "image/vnd.dxf", "application/dxf",
  "application/zip", "application/x-zip-compressed",
])
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type SignedUpload = { ok: true; signedUrl: string } | { ok: false }
export type UploadSignDeps = {
  session: SessionVerifier
  issuer: string
  membership: MembershipLookup
  /** Counts the org's signs in the last hour and records this one when under `limit` (public.projexa_upload_sign_reserve). */
  reserve: (orgId: string, limit: number) => Promise<{ ok: true; allowed: boolean } | { ok: false }>
  /** Bytes already stored under the org folder of the bucket (public.projexa_org_storage_used). Required in production; a failure answers 503 so the cap is never skipped. */
  orgUsage?: (orgId: string) => Promise<{ ok: true; bytes: number } | { ok: false }>
  /** Storage createSignedUploadUrl on the service role, for an object path inside the bucket. */
  sign: (objectPath: string) => Promise<SignedUpload>
  /** Public URL of an object path. */
  publicUrl: (objectPath: string) => string
  newId?: () => string
  now?: () => number
  allowedOrigins?: readonly string[]
  log?: (line: string) => void
}

/** Strips path separators and control characters, keeps the extension, at most FILE_NAME_MAX characters. Never empty. */
export function sanitizeFileName(raw: string): string {
  let s = raw.normalize("NFKC").replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g, "").replace(/[\\/]+/g, "_")
  s = s.replace(/[<>:"|?*#%&{}^`~\[\]]/g, "_").replace(/\s+/g, " ").trim().replace(/^\.+/, "").replace(/\.+$/, "")
  if (s === "") return "file"
  if (s.length > FILE_NAME_MAX) {
    const dot = s.lastIndexOf(".")
    const ext = dot > 0 && s.length - dot <= 10 ? s.slice(dot) : ""
    s = s.slice(0, FILE_NAME_MAX - ext.length) + ext
  }
  return s
}

function cors(req: Request, deps: UploadSignDeps): Record<string, string> {
  const origin = req.headers.get("origin")
  const h: Record<string, string> = {
    Vary: "Origin",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, content-type, accept, x-px-client",
    "Access-Control-Max-Age": "7200",
  }
  if (origin && (deps.allowedOrigins ?? ALLOWED_ORIGINS).includes(origin)) h["Access-Control-Allow-Origin"] = origin
  return h
}
function json(req: Request, deps: UploadSignDeps, status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { ...(status === 204 ? {} : { "Content-Type": "application/json" }), "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...cors(req, deps), ...extra },
  })
}
function log(deps: UploadSignDeps, line: string) {
  try {
    ;(deps.log ?? ((l: string) => console.error(l)))(`projexa-api: uploads/sign: ${line}`)
  } catch {
    // logging never breaks an answer
  }
}

export function isUploadSignRequest(req: Request): boolean {
  return UPLOAD_SIGN_PATH_RE.test(new URL(req.url).pathname)
}

export async function handleUploadSign(req: Request, deps: UploadSignDeps): Promise<Response> {
  const method = req.method.toUpperCase()
  if (method === "OPTIONS") return json(req, deps, 204, null)
  if (method !== "POST") return json(req, deps, 405, { error: "Method not allowed" }, { Allow: "POST, OPTIONS" })

  const m = (req.headers.get("authorization") ?? "").match(/^Bearer\s+(\S+)$/i)
  const token = m ? m[1] : null
  if (!token) return json(req, deps, 401, { error: "Unauthorized" })
  const verdict = await deps.session(token)
  if (!verdict.ok) {
    return verdict.reason === "unavailable"
      ? json(req, deps, 503, { error: "Sign-in could not be checked just now, please retry" }, { "Retry-After": String(RETRY_AFTER_SECONDS) })
      : json(req, deps, 401, { error: "Unauthorized" })
  }
  if (verdict.issuer !== deps.issuer) return json(req, deps, 401, { error: "Unauthorized" })

  let found = await deps.membership(token, verdict.sub)
  if (!found.ok) found = await deps.membership(token, verdict.sub)
  if (!found.ok) return json(req, deps, 503, { error: "Could not verify organization membership, please retry" }, { "Retry-After": String(RETRY_AFTER_SECONDS) })
  if (!found.row) return json(req, deps, 400, { error: "No organization" })
  const orgId = found.row.organization_id
  if (!UUID_RE.test(orgId)) return json(req, deps, 400, { error: "No organization" })
  if ((found.row.role ?? "").trim().toLowerCase() === "client_viewer") return json(req, deps, 403, { error: "Forbidden" })

  let body: Record<string, unknown>
  try {
    const raw = await req.text()
    if (raw.length > 8192) return json(req, deps, 422, { error: "Invalid body" })
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return json(req, deps, 422, { error: "Invalid body" })
    body = parsed as Record<string, unknown>
  } catch {
    return json(req, deps, 422, { error: "Invalid body" })
  }
  const { kind, projectId, fileName, contentType, size } = body
  if (typeof kind !== "string" || !(UPLOAD_KINDS as readonly string[]).includes(kind)) return json(req, deps, 422, { error: "kind must be permit, drawing or document" })
  if (projectId !== undefined && projectId !== null && (typeof projectId !== "string" || !UUID_RE.test(projectId))) return json(req, deps, 422, { error: "projectId must be a uuid" })
  if (typeof fileName !== "string" || fileName.trim() === "") return json(req, deps, 422, { error: "fileName is required" })
  if (typeof contentType !== "string" || contentType.trim() === "") return json(req, deps, 422, { error: "contentType is required" })
  if (typeof size !== "number" || !Number.isInteger(size) || size < 1) return json(req, deps, 422, { error: "size must be a whole number of bytes, at least 1" })
  if (size > UPLOAD_MAX_FILE_BYTES) return json(req, deps, 413, { error: "File too large", maxBytes: UPLOAD_MAX_FILE_BYTES })
  const ct = contentType.split(";")[0].trim().toLowerCase()
  if (!ALLOWED_CONTENT_TYPES.has(ct)) return json(req, deps, 415, { error: "File type not allowed" })

  // Per-organisation storage cap (100 MB). Checked before the hourly reserve so a refused request does not use up a rate-limit slot.
  if (deps.orgUsage) {
    let used: Awaited<ReturnType<NonNullable<UploadSignDeps["orgUsage"]>>>
    try {
      used = await deps.orgUsage(orgId)
    } catch {
      used = { ok: false }
    }
    if (!used.ok) return json(req, deps, 503, { error: "Could not prepare the upload just now, please retry" }, { "Retry-After": String(RETRY_AFTER_SECONDS) })
    if (used.bytes + size > UPLOAD_ORG_QUOTA_BYTES) {
      return json(req, deps, 413, {
        error: "Your organisation has used its 100 MB of file storage. Remove old files or ask your administrator to raise the limit.",
        code: "ORG_QUOTA",
        orgQuotaBytes: UPLOAD_ORG_QUOTA_BYTES,
        usedBytes: used.bytes,
      })
    }
  }

  let reserved: Awaited<ReturnType<UploadSignDeps["reserve"]>>
  try {
    reserved = await deps.reserve(orgId, UPLOAD_ORG_SIGNS_PER_HOUR)
  } catch {
    reserved = { ok: false }
  }
  if (!reserved.ok) return json(req, deps, 503, { error: "Could not prepare the upload just now, please retry" }, { "Retry-After": String(RETRY_AFTER_SECONDS) })
  if (!reserved.allowed) return json(req, deps, 429, { error: "Too many uploads this hour" }, { "Retry-After": "300" })

  const id = (deps.newId ?? (() => crypto.randomUUID()))()
  const objectPath = `${orgId}/${kind}/${id}/${sanitizeFileName(fileName)}`
  let signed: SignedUpload
  try {
    signed = await deps.sign(objectPath)
  } catch {
    signed = { ok: false }
  }
  if (!signed.ok) {
    log(deps, "sign failed -> 503")
    return json(req, deps, 503, { error: "Could not prepare the upload just now, please retry" }, { "Retry-After": String(RETRY_AFTER_SECONDS) })
  }
  const now = (deps.now ?? Date.now)()
  log(deps, `-> 200 ${kind}`)
  return json(req, deps, 200, {
    uploadUrl: signed.signedUrl,
    method: "PUT",
    headers: { "content-type": ct, "x-upsert": "false" },
    externalUrl: deps.publicUrl(objectPath),
    expiresAt: new Date(now + UPLOAD_URL_TTL_SECONDS * 1000).toISOString(),
    maxBytes: UPLOAD_MAX_FILE_BYTES,
  })
}

export function publicObjectUrl(supabaseUrl: string, objectPath: string): string {
  return `${supabaseUrl.replace(/\/+$/, "")}/storage/v1/object/public/${UPLOAD_BUCKET}/${objectPath.split("/").map(encodeURIComponent).join("/")}`
}
