// R67 D-78 (audit R-294/R-295). "Is file storage actually usable on this
// server?" -- answered once, honestly, and cached.
//
// THE DEFECT. Every upload path in this repo (permits, drawings, documents,
// client-portal, voice memos) resolves its Supabase admin client the same way:
//
//   createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
//
// -- with two non-null assertions and no check. On a deployment where the
// service-role key is missing, or where the bucket has not been created, nothing
// says so until a user has picked a file, filled in a create form and pressed
// Save; the upload then fails and document-service.ts turns it into the flat
// sentence "Failed to upload file". The user is told their permit did not save.
// They are not told that no permit could ever have saved, which is the fact.
//
// This is the probe that lets the three PROJEXA upload SCREENS say so before the
// file is chosen. It is deliberately not a health check of Supabase generally:
// it answers exactly the two questions an upload depends on, in order, and stops
// at the first no.
//
//   1. Do the two env vars resolve? (no network call needed to know they don't)
//   2. Does the upload bucket exist and is it readable with that key?
//
// Cached for 60 s in module scope, per D-78's "checked once and cached 60 s".
// A warm serverless instance therefore makes at most one getBucket() call a
// minute no matter how many upload screens are opened.
import { createClient } from "@supabase/supabase-js"

/** The one bucket every document/permit/drawing upload in this repo writes to. */
export const UPLOAD_BUCKET = "compliance-documents"

const CACHE_TTL_MS = 60_000

export type StorageStatus = {
  /** true ONLY when the service-role key resolves AND the upload bucket exists. */
  storageConfigured: boolean
  /**
   * Which of the two checks failed, for the operator. Never rendered to an end
   * user -- the screens show one fixed sentence, because "which env var is
   * missing on the server" is not a fact a site engineer can act on.
   */
  reason: "ok" | "missing_env" | "bucket_unavailable"
  bucket: string
}

let cached: { at: number; value: StorageStatus } | null = null

/** Exported for tests: forget the memoised answer so the next call re-probes. */
export function resetStorageStatusCache(): void {
  cached = null
}

/**
 * Pure: the env half of the check, separated so it can be tested without a
 * network call and so the network call is never made when it could not
 * possibly succeed.
 */
export function storageEnvResolves(env: { url?: string; serviceRoleKey?: string }): boolean {
  return Boolean(env.url?.trim()) && Boolean(env.serviceRoleKey?.trim())
}

/**
 * Probes the bucket with the service-role key. Any failure -- a thrown error, a
 * Supabase error payload, or a missing bucket -- is `false`, never a throw: a
 * status probe that can take down the caller is worse than the condition it
 * reports on.
 */
export async function probeUploadBucket(
  url: string,
  serviceRoleKey: string,
  bucket: string = UPLOAD_BUCKET
): Promise<boolean> {
  try {
    const admin = createClient(url, serviceRoleKey)
    const { data, error } = await admin.storage.getBucket(bucket)
    if (error || !data) {
      console.error("storage-config: upload bucket unavailable:", error?.message ?? "no bucket returned")
      return false
    }
    return true
  } catch (err) {
    console.error("storage-config: upload bucket probe threw:", err instanceof Error ? err.message : err)
    return false
  }
}

export async function getStorageStatus(): Promise<StorageStatus> {
  const now = Date.now()
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.value

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  let value: StorageStatus
  if (!storageEnvResolves({ url, serviceRoleKey })) {
    value = { storageConfigured: false, reason: "missing_env", bucket: UPLOAD_BUCKET }
  } else {
    const ok = await probeUploadBucket(url!, serviceRoleKey!)
    value = ok
      ? { storageConfigured: true, reason: "ok", bucket: UPLOAD_BUCKET }
      : { storageConfigured: false, reason: "bucket_unavailable", bucket: UPLOAD_BUCKET }
  }

  cached = { at: now, value }
  return value
}
