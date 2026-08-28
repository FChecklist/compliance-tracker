// CRR P3-BRIDGE, platform.crr_spec CRR-225: the recall/retrieval query layer
// over compliance.source_object + compliance.document_chunk.
//
// CRR-224 introduced supersession (source_object.is_current /
// supersedes_doc_uid / superseded_by_doc_uid) precisely so a superseded
// revision is never deleted -- its row, and every document_chunk row that
// points at it, survives. That guarantee is worthless if every read path
// still ranks five revisions of the same document together by default --
// this point's own why_to_do: "a search that returns five revisions of the
// same document by default is unusable; one that cannot reach the old
// revision is not a memory." So recall() below defaults to is_current =
// true, and only an explicit `asOf` or `includeSuperseded` option reaches
// the historical chain -- see buildRecallConditions()'s own doc comment for
// the exact mode-selection rule, and recall.test.ts for the CI test
// asserting both modes (this point's own closure_proof_sql is "n/a - CI
// test asserting both modes"; that test is this point's closure proof).
//
// Filtering happens once, at the SQL layer, inside the same
// withTenantContext(...) RLS-scoped transaction capture.ts/embed.ts's own
// P3 read/write paths already use -- there is no second, parallel retrieval
// path (e.g. a vector-similarity search over document_chunk.embedding)
// reading document_chunk in this codebase yet, so there is only one place
// this filter needs to be correct today. This point's own failure_points
// names exactly the bug that would exist if there were: "Default filter
// applied at the SQL layer but not the vector layer, so old chunks still
// surface" -- if a vector-search recall path is ever added on top of
// document_chunk.embedding, it must apply buildRecallConditions() (or an
// equivalent is_current-aware filter) too, not re-derive its own.
import { and, desc, eq, isNull, lte, type SQL } from "drizzle-orm"
import { documentChunk, sourceObject } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"

export type RecallOptions = {
  orgId: string
  /** Narrow to one document's own supersession chain; omit for an org-wide recall. */
  docUid?: string
  /**
   * Point-in-time recall: reach the chain as it stood at this moment
   * (source_objects that existed by `asOf`), including revisions since
   * superseded. An asOf query that still silently dropped superseded rows
   * could never show a past state truthfully, so setting this implies
   * includeSuperseded's effect too -- see recallIncludesHistory().
   */
  asOf?: Date
  /** Explicit override: return every revision (current and superseded), not just is_current=true. */
  includeSuperseded?: boolean
  limit?: number
  clientIds?: string[]
  userId?: string
}

export type RecallChunk = {
  chunkId: string
  sourceObjectId: string
  docUid: string
  isCurrent: boolean
  supersedesDocUid: string | null
  supersededByDocUid: string | null
  seq: number
  page: number | null
  content: string | null
  sourceCreatedAt: Date
}

const DEFAULT_LIMIT = 50

/**
 * True when this call reaches beyond the is_current-only default -- either
 * mode this point's own what_to_do names ("an explicit asOf or
 * includeSuperseded option"). Exported so the mode-selection decision is
 * directly assertable on its own, independent of the SQL/DB layers below.
 */
export function recallIncludesHistory(options: Pick<RecallOptions, "asOf" | "includeSuperseded">): boolean {
  return options.includeSuperseded === true || options.asOf !== undefined
}

/**
 * Builds the compliance.source_object WHERE condition for one recall()
 * call. Pure and DB-free -- recall.test.ts compiles this to real SQL via
 * drizzle-orm's own PgDialect (no live connection needed, nothing mocked)
 * and asserts on the compiled text/params directly. That is this point's
 * actual CI proof for "default excludes superseded revisions, explicit
 * override includes them":
 *   - default (no asOf, no includeSuperseded): includes an
 *     `"is_current" = true` clause.
 *   - includeSuperseded:true, or asOf set: omits that clause entirely, so
 *     every revision (current and superseded) that otherwise matches is
 *     returned.
 */
export function buildRecallConditions(options: RecallOptions): SQL {
  const conditions = [eq(sourceObject.orgId, options.orgId), isNull(sourceObject.deletedAt)]
  if (options.docUid) conditions.push(eq(sourceObject.docUid, options.docUid))
  if (!recallIncludesHistory(options)) conditions.push(eq(sourceObject.isCurrent, true))
  if (options.asOf) conditions.push(lte(sourceObject.createdAt, options.asOf))
  // Always >= 2 conditions (orgId + deletedAt IS NULL), so `and(...)` never
  // actually returns undefined here -- the assertion just satisfies
  // drizzle-orm's general (SQL | undefined) signature for the zero-args case.
  return and(...conditions)!
}

/**
 * Recalls document_chunk rows for an org, joined to their parent
 * source_object, newest source_object first. Defaults to is_current=true;
 * pass `asOf` or `includeSuperseded` to reach the historical chain instead
 * (see buildRecallConditions()). Also excludes chunks whose own content has
 * been erased (CRR-226's content_erased_at tombstone) regardless of mode --
 * erasure is unconditional, not a revision the caller can opt back into.
 */
export async function recall(options: RecallOptions): Promise<RecallChunk[]> {
  const limit = options.limit && options.limit > 0 ? options.limit : DEFAULT_LIMIT
  const condition = buildRecallConditions(options)

  return withTenantContext(
    { orgId: options.orgId, clientIds: options.clientIds, userId: options.userId },
    async (tx) => {
      const rows = await tx
        .select({
          chunkId: documentChunk.id,
          sourceObjectId: sourceObject.id,
          docUid: sourceObject.docUid,
          isCurrent: sourceObject.isCurrent,
          supersedesDocUid: sourceObject.supersedesDocUid,
          supersededByDocUid: sourceObject.supersededByDocUid,
          seq: documentChunk.seq,
          page: documentChunk.page,
          content: documentChunk.content,
          sourceCreatedAt: sourceObject.createdAt,
        })
        .from(documentChunk)
        .innerJoin(sourceObject, eq(documentChunk.sourceObjectId, sourceObject.id))
        .where(and(condition, isNull(documentChunk.contentErasedAt)))
        .orderBy(desc(sourceObject.createdAt), documentChunk.seq)
        .limit(limit)

      return rows
    }
  )
}
