// CRR P3-BRIDGE (2026-08-27), platform.crr_spec CRR-083: every ingest-
// pipeline failure (extract/chunk/embed) gets a durable, queryable
// compliance.crr_ingest_error row instead of a console.warn/console.error
// line that vanishes the moment the serverless invocation ends -- the same
// "no silent failure" discipline chunkAndEmbedSourceObject's own
// extract_status/extract_error write already applies to source_object,
// extended to the error DETAIL (stage/error_code/message), which
// source_object's single extract_error text column cannot hold a history
// of (a retry overwrites it). Reused by document-extraction-service.ts's
// chunk+embed bridge and by the CRR-090 catch-up worker, so both stage
// failures land in the same shape/table.
//
// compliance.crr_ingest_error.org_id is nullable (a failure can occur
// before an org is even resolved -- see schema.ts's own comment on the
// column), but every real caller in this codebase always has a concrete
// orgId by the time it can call this (chunkAndEmbedSourceObject's ctx.orgId,
// the catch-up worker's own source_object.org_id) -- required, not
// optional, here so a caller cannot accidentally omit it and produce a row
// only the service role can ever see again.
import { crrIngestError } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"

export type IngestStage = "extract" | "chunk" | "embed"

export type RecordIngestErrorInput = {
  orgId: string
  sourceObjectId?: string | null
  stage: IngestStage
  errorCode?: string | null
  message: string
}

/**
 * Records one ingest-pipeline failure as a real compliance.crr_ingest_error
 * row. Deliberately never throws itself -- a failure to write this audit
 * trail must never mask, replace, or interrupt the real error the caller is
 * already in the middle of handling/rethrowing (the one remaining
 * console.error below covers only THAT secondary, expected-to-be-rare
 * failure mode, not the original error CRR-083 is about surfacing).
 */
export async function recordIngestError(input: RecordIngestErrorInput): Promise<void> {
  try {
    await withTenantContext({ orgId: input.orgId }, (db) =>
      db.insert(crrIngestError).values({
        orgId: input.orgId,
        sourceObjectId: input.sourceObjectId ?? null,
        stage: input.stage,
        errorCode: input.errorCode ?? null,
        // Bounded so one pathological error (e.g. a stack trace concatenated
        // into a message) cannot grow this row unboundedly.
        errorMessage: input.message.slice(0, 4000),
      })
    )
  } catch (err) {
    console.error("recordIngestError: failed to write compliance.crr_ingest_error (original error is still rethrown by the caller)", err)
  }
}
