// CRR P3-BRIDGE (2026-08-27), platform.crr_spec CRR-078: the single capture
// entry point for every source_object origin (upload, connector, email,
// inapp, api) -- see schema.ts's sourceObject table comment for why this
// replaces the prior split across `documents` (uploads only),
// `connector_documents` (connector files only), and nowhere at all for
// email. Deliberately capture-only: no extraction, chunking or embedding
// happens here (CRR-079 wires document-extraction-service.ts to call this,
// then chunk/embed separately) -- capture must succeed and return fast even
// when a model or extractor is down, so coupling the two would make an
// upload fail because an unrelated extraction dependency was unavailable.
//
// Dedup contract: identical bytes captured twice for the same org (by
// sha256, scoped to non-deleted rows -- mirrors the DB's own partial unique
// index `source_object_org_sha256_unique` on (org_id, sha256) WHERE
// deleted_at IS NULL) return the SAME id and never upload a second copy to
// storage. The common sequential-recapture case (by far the normal path --
// the same connector file synced twice, the same email attachment forwarded
// twice) is short-circuited by a SELECT *before* any storage write happens,
// so it can never orphan an object on that path. A concurrent double-capture
// race (two requests hashing the same bytes at the same instant, both
// passing the SELECT before either commits) is still resolved correctly at
// the DB layer via ON CONFLICT ... DO NOTHING against that same partial
// index, so no duplicate row is ever created either way -- only in that
// narrow concurrent window does the losing call's already-uploaded object
// go unreferenced, which is the same accepted trade-off documented in
// app/api/documents/route.ts (an orphaned storage object with nothing
// pointing at it is harmless dangling storage; a row pointing at a
// nonexistent object would be worse, and true storage+DB atomicity isn't
// available here without 2PC).

import { createHash } from "node:crypto"
import { createId } from "@paralleldrive/cuid2"
import { createClient } from "@supabase/supabase-js"
import { and, eq, isNull } from "drizzle-orm"
import { sourceObject } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"

// Same bucket the pre-CRR upload path (app/api/documents/route.ts) already
// uses -- reusing it means every origin lands under the one bucket the
// storage policies actually cover, instead of each origin needing its own.
const BUCKET = "compliance-documents"

/** Mirrors schema.ts's sourceObjectOriginEnum values exactly. */
export type SourceObjectOrigin = "upload" | "connector" | "email" | "inapp" | "api"

export type CreateSourceObjectInput = {
  orgId: string
  clientId?: string | null
  origin: SourceObjectOrigin
  mimeType?: string | null
  bytes: Uint8Array
  title?: string | null
  linkedEntityType?: string | null
  linkedEntityId?: string | null
  businessObjectType?: string | null
  createdById?: string | null
}

// Only the one method this file actually calls -- narrow on purpose so
// capture.test.ts can pass a plain object literal as `deps.storageClient`
// instead of a real (or fully-shaped fake) SupabaseClient. The real
// getStorageAdminClient() below returns a full SupabaseClient, which
// structurally satisfies this narrower type.
export type SourceObjectStorageClient = {
  storage: {
    from(bucket: string): {
      upload(
        path: string,
        bytes: Uint8Array,
        options: { contentType: string; upsert: boolean }
      ): Promise<{ error: { message: string } | null }>
    }
  }
}

// service-role client, used ONLY server-side -- same pattern as
// app/api/documents/route.ts's getStorageAdminClient(): the bucket has no
// anon/authenticated storage policies at all, so this is the only kind of
// client that can ever touch it, and callers are trusted server code (an
// API route that already ran requireAuth(), a connector sync job, an email
// ingest worker), never a browser.
function getStorageAdminClient(): SourceObjectStorageClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120)
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex")
}

/**
 * Captures one artefact from any origin into `compliance.source_object`.
 * Hashes `bytes`, uploads to the shared `compliance-documents` storage
 * bucket, and inserts a source_object row with extract_status=PENDING
 * (the column's own DB default -- never set explicitly here, so a schema
 * change to the default only has to happen in one place). Returns the row's
 * id.
 *
 * On sha256 conflict within the org (deleted_at IS NULL), returns the
 * existing id and does not re-upload -- see this file's header for the two
 * paths (pre-check SELECT, and the ON CONFLICT DB-level fallback) that
 * enforce this.
 *
 * Deliberately does NOT extract, chunk or embed -- see this file's header.
 *
 * `deps.storageClient` is test-only dependency injection (defaults to the
 * real service-role admin client) -- capture.test.ts passes a fake here
 * instead of mock.module()'ing "@supabase/supabase-js" itself, because that
 * module is imported unmocked, for real, by other unrelated test files
 * (org-branding-service.test.ts's real getPublicUrl() calls) that Bun's
 * mock.module leaks across test FILES within one run, not just within this
 * one. Discovered the hard way: an earlier version of this test globally
 * mocked "@supabase/supabase-js" and broke org-branding-service.test.ts in
 * CI even though that file never imports capture.ts or capture.test.ts.
 */
export async function createSourceObject(
  input: CreateSourceObjectInput,
  deps: { storageClient?: SourceObjectStorageClient } = {}
): Promise<string> {
  const sha256 = sha256Hex(input.bytes)

  return withTenantContext(
    {
      orgId: input.orgId,
      clientIds: input.clientId ? [input.clientId] : undefined,
      userId: input.createdById ?? undefined,
    },
    async (db) => {
      // Sequential-recapture short-circuit: check first, so storage.upload
      // never runs at all for the common "same bytes captured again" case.
      const [existing] = await db
        .select({ id: sourceObject.id })
        .from(sourceObject)
        .where(
          and(
            eq(sourceObject.orgId, input.orgId),
            eq(sourceObject.sha256, sha256),
            isNull(sourceObject.deletedAt)
          )
        )
        .limit(1)
      if (existing) return existing.id

      const objectPath = `${input.orgId}/${createId()}-${sanitizeFileName(input.title || "untitled")}`
      const admin = deps.storageClient ?? getStorageAdminClient()
      const { error: uploadError } = await admin.storage.from(BUCKET).upload(objectPath, input.bytes, {
        contentType: input.mimeType || "application/octet-stream",
        upsert: false,
      })
      if (uploadError) {
        throw new Error(`createSourceObject: storage upload failed: ${uploadError.message}`)
      }

      const [inserted] = await db
        .insert(sourceObject)
        .values({
          orgId: input.orgId,
          clientId: input.clientId ?? null,
          origin: input.origin,
          mimeType: input.mimeType ?? null,
          byteSize: input.bytes.byteLength,
          storagePath: objectPath,
          sha256,
          contentSha256: sha256,
          title: input.title ?? null,
          displayName: input.title ?? null,
          linkedEntityType: input.linkedEntityType ?? null,
          linkedEntityId: input.linkedEntityId ?? null,
          businessObjectType: input.businessObjectType ?? null,
          createdById: input.createdById ?? null,
          docUid: createId(),
        })
        // Race-condition fallback: two concurrent captures of identical
        // bytes can both pass the SELECT above before either commits its
        // INSERT. This target must match source_object_org_sha256_unique
        // exactly (org_id, sha256, WHERE deleted_at IS NULL) -- Postgres
        // requires an ON CONFLICT target to match a real index, partial
        // predicate included.
        .onConflictDoNothing({
          target: [sourceObject.orgId, sourceObject.sha256],
          where: isNull(sourceObject.deletedAt),
        })
        .returning({ id: sourceObject.id })

      if (inserted) return inserted.id

      // Lost the race -- some other concurrent call's row already exists.
      const [winner] = await db
        .select({ id: sourceObject.id })
        .from(sourceObject)
        .where(
          and(
            eq(sourceObject.orgId, input.orgId),
            eq(sourceObject.sha256, sha256),
            isNull(sourceObject.deletedAt)
          )
        )
        .limit(1)
      if (!winner) {
        // Unreachable in practice: onConflictDoNothing only suppresses the
        // insert when a conflicting row exists, so this re-select cannot
        // come back empty unless that row was deleted in the interim --
        // fail loudly rather than return an undefined id.
        throw new Error("createSourceObject: lost the insert race but found no existing row to return")
      }
      return winner.id
    }
  )
}
