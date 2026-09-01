// CRR P3-BRIDGE (2026-08-27), platform.crr_spec CRR-090/CRR-091/CRR-092:
// a status-driven catch-up worker for compliance.source_object rows whose
// ingest pipeline (extract -> chunk -> embed, document-extraction-
// service.ts's chunkAndEmbedSourceObject) started but never reached
// EMBEDDED -- a Vercel invocation killed by maxDuration mid-batch, a
// transient provider outage, a process crash between chunking and
// embedding. Without this, such a row is stuck forever: nothing else in
// this codebase re-drives an existing source_object row (the upload route,
// CRR-084, only ever calls the extraction pipeline once, at upload time).
//
// Design note (raw text is never persisted): compliance.source_object has
// no column for the actual extracted text -- only char_count (a number).
// So "drive a row forward one stage" cannot mean "resume chunking with the
// text a prior attempt already extracted", because that text does not
// exist anywhere after the invocation that produced it exits. Instead this
// worker re-downloads the original bytes from storage and re-runs
// extraction every time it touches a row, then calls
// chunkAndEmbedSourceObject exactly as CRR-084's upload-route call site
// does (same function, ctx.sourceObjectId already set so it skips
// re-capturing). This is still real forward progress and still idempotent:
// extraction is deterministic (same bytes -> same text -> same chunks,
// same seq numbers), and storeChunkEmbeddingsBatch's own CRR-082
// resumability (a (source_object_id, seq) pre-check) means any chunk a
// prior attempt already embedded is skipped rather than re-embedded or
// re-inserted. A row that reaches EMBEDDED leaves the query below's own
// target set (extract_status IN ('PENDING','EXTRACTED','CHUNKED')) and is
// never touched again; a row whose mime type genuinely cannot be text-
// extracted (e.g. an image -- vision-sourced source_object rows are out of
// this pipeline's scope entirely, see chunkAndEmbedSourceObject's own
// header) is marked FAILED below on its first attempt so it stops being
// re-selected on every future run.
//
// CRR-091: same shared-secret (`CRON_SECRET`) pattern as every other
// /api/internal/*/run route in this codebase (see e.g. metric-alerts/run's
// isAuthorized) -- 401 without a valid `Authorization: Bearer <secret>`
// header, no user session involved (a cron invocation has none).
// CRR-092: scheduled via vercel.json's own crons array -- see that file's
// entry for this path and the chosen interval.
import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { and, asc, eq, inArray, isNull } from "drizzle-orm"
import { db, sourceObject } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { extractRawTextForMimeType, chunkAndEmbedSourceObject } from "@/lib/services/document-extraction-service"
import { recordIngestError } from "@/lib/crr/ingest-error"

// Not strictly this point's own what_to_do (CRR-089 names only
// src/app/api/documents/route.ts) but disclosed here for the same real
// reason: this route processes up to DEFAULT_LIMIT rows sequentially, each
// doing a real storage download + extraction + batched embedding call, and
// the platform default duration would make CRR-090/092 silently unable to
// finish a real backlog. Same Pro-plan-without-confirmed-Fluid-Compute
// reasoning as documents/route.ts's own maxDuration -- see that file's
// comment for what was and wasn't verified.
export const maxDuration = 300

const BUCKET = "compliance-documents"
// Bounded per run so one invocation cannot itself blow the route's own
// maxDuration -- a stuck backlog larger than this just gets finished across
// several cron intervals rather than in one call (CRR-092's own interval is
// short specifically so that's not a meaningful delay).
const DEFAULT_LIMIT = 20
const MAX_LIMIT = 100

const STUCK_STATUSES = ["PENDING", "EXTRACTED", "CHUNKED"] as const

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  return request.headers.get("authorization") === `Bearer ${secret}`
}

// Same service-role, requireAuth()-independent storage access pattern as
// src/app/api/documents/route.ts's own getStorageAdminClient() -- the
// bucket has no anon/authenticated storage policies at all, so this is the
// only kind of client that can read from it, and a scheduled worker has no
// user session to gate through requireAuth() in the first place.
function getStorageAdminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

type StuckRow = typeof sourceObject.$inferSelect

async function markFailed(row: StuckRow, message: string): Promise<void> {
  // Named `tx`, not `db` -- this file also imports the top-level, cross-org
  // `db` from "@/lib/db" for runCatchUp's own scan, so a same-named
  // withTenantContext callback param here would shadow it.
  await withTenantContext({ orgId: row.orgId }, (tx) =>
    tx.update(sourceObject).set({ extractStatus: "FAILED", extractError: message }).where(eq(sourceObject.id, row.id))
  ).catch(() => {
    // Never let a failed status-write mask the real error already recorded
    // via recordIngestError below.
  })
}

async function driveOneForward(row: StuckRow): Promise<{ id: string; ok: boolean; error?: string }> {
  if (!row.storagePath) {
    const message = "source_object has no storage_path -- cannot re-download its bytes"
    await recordIngestError({ orgId: row.orgId, sourceObjectId: row.id, stage: "extract", message })
    await markFailed(row, message)
    return { id: row.id, ok: false, error: message }
  }
  if (!row.mimeType) {
    const message = "source_object has no mime_type -- cannot select an extraction path"
    await recordIngestError({ orgId: row.orgId, sourceObjectId: row.id, stage: "extract", message })
    await markFailed(row, message)
    return { id: row.id, ok: false, error: message }
  }

  let buffer: Buffer
  let rawText: string
  try {
    const admin = getStorageAdminClient()
    const { data, error } = await admin.storage.from(BUCKET).download(row.storagePath)
    if (error || !data) throw new Error(`storage download failed: ${error?.message ?? "no data returned"}`)
    buffer = Buffer.from(await data.arrayBuffer())
    rawText = await extractRawTextForMimeType(row.mimeType, buffer)
  } catch (err) {
    // Covers both a real download failure and an unsupported/unreadable
    // mime type (e.g. a vision-only image row -- see this file's own
    // header) -- either way, real progress requires marking FAILED so this
    // row leaves the "stuck" set instead of being retried every run
    // forever with the same outcome.
    const message = err instanceof Error ? err.message : String(err)
    await recordIngestError({ orgId: row.orgId, sourceObjectId: row.id, stage: "extract", message })
    await markFailed(row, message)
    return { id: row.id, ok: false, error: message }
  }

  try {
    await chunkAndEmbedSourceObject({
      orgId: row.orgId,
      mimeType: row.mimeType,
      buffer,
      rawText,
      sourceObjectId: row.id,
      businessObjectType: row.businessObjectType,
    })
    return { id: row.id, ok: true }
  } catch (err) {
    // chunkAndEmbedSourceObject's own catch blocks already recorded a real
    // compliance.crr_ingest_error row and left extract_status at the right
    // place (FAILED for a pre-chunk failure, CHUNKED -- not FAILED -- for
    // an embed-phase failure so the NEXT run resumes via CRR-082) -- no
    // duplicate handling needed here beyond surfacing it in this run's
    // response.
    const message = err instanceof Error ? err.message : String(err)
    return { id: row.id, ok: false, error: message }
  }
}

async function runCatchUp(limit: number) {
  // Cross-tenant by design -- this worker's whole job is finding stuck rows
  // across EVERY org, which withTenantContext (single-org-scoped by its own
  // RLS GUCs) cannot do. Uses the plain `db` export from "@/lib/db" (the
  // `postgres` role via DATABASE_URL, RLS-bypass -- same precedent as
  // embeddings.ts's raw client, see that file's own header) only for this
  // read; every actual WRITE below still goes through chunkAndEmbedSourceObject's
  // own withTenantContext calls, scoped to that row's real org_id.
  const stuck = await db.query.sourceObject.findMany({
    where: and(inArray(sourceObject.extractStatus, STUCK_STATUSES), isNull(sourceObject.deletedAt)),
    orderBy: asc(sourceObject.createdAt),
    limit,
  })

  const results: { id: string; ok: boolean; error?: string }[] = []
  for (const row of stuck) {
    results.push(await driveOneForward(row))
  }

  return {
    ranAt: new Date().toISOString(),
    scanned: stuck.length,
    succeeded: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  }
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const limitParam = Number(request.nextUrl.searchParams.get("limit"))
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, MAX_LIMIT) : DEFAULT_LIMIT

  try {
    return NextResponse.json(await runCatchUp(limit))
  } catch (error) {
    console.error("CRR-090 catch-up worker run failed:", error)
    return NextResponse.json({ error: "CRR-090 catch-up worker run failed" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  return GET(request)
}
