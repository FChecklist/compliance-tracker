// R65 Part C Phase 2: vector embedding layer for compliance.memory_records
// (Phase 1: drizzle/0520_r65_partc_phase1_memory_schema.sql, schema only.
// Phase 2 migration: drizzle/0523_r65_partc_phase2_memory_embedding.sql,
// adds the `embedding vector(1536)` column + HNSW index this file writes
// to and searches -- see that migration's own header for the full
// reasoning behind the design choices below).
//
// Same raw-SQL `sql\`\`` + tx.execute() pgvector pattern already
// established by src/lib/services/assistant-memory-service.ts (Wave 77)
// and src/lib/services/instruction-execution-cache-service.ts (UMR-03):
// `tx: TenantDb` is a caller-supplied, already-open withTenantContext
// transaction (app_runtime role, real RLS) -- this file never opens its
// own tenant context or a second bypass connection for memory_records
// itself, so every memory_records/memory_sources/memory_versions read or
// write here is genuinely governed by Phase 1's own RLS policies (own org
// or global read; own org only for insert/update; memory_versions is
// insert-only for app_runtime at the DB level, not just by convention).
//
// The one deliberate exception is embedding storage/generation, which
// necessarily goes through src/lib/embeddings.ts's existing
// storeEmbedding() (as directed -- Phase 1's own migration header says a
// later phase should call into storeEmbedding()/findSimilar() rather than
// reimplementing vector search). storeEmbedding() is hardwired to its own
// dedicated connection (the bypass-RLS `db` export from "@/lib/db", the
// same "postgres" role compliance.embeddings' own RLS only grants
// service_role on -- app_runtime has no policy on that table at all, see
// drizzle/0003_enable_rls_exposed_compliance_tables.sql) and cannot join
// the caller's app_runtime transaction. Two consequences, both disclosed
// here rather than silently glossed over:
//   1. Writing a memory_records row and registering its embedding in
//      compliance.embeddings are NOT one atomic transaction -- they are
//      two real, sequential DB operations on two different connections.
//      If the process crashes between them, the memory_records row exists
//      with embedding still NULL (excluded from searchMemories() until a
//      future repair pass re-embeds it) and no orphaned compliance.embeddings
//      row is left behind either way, since storeEmbedding() runs first and
//      the memory_records.embedding UPDATE runs after it, not before.
//   2. Only ONE real embedding-provider call is made per write (inside
//      storeEmbedding() itself) -- the resulting vector is copied from
//      compliance.embeddings back onto memory_records.embedding via a
//      plain SQL read+write, never regenerated, so this never doubles the
//      real OpenRouter/Groq API cost per memory record.
import type { TenantDb } from "@/lib/db/tenant-scoped"
import { sql } from "drizzle-orm"
import { createId } from "@paralleldrive/cuid2"
import { createHash } from "crypto"
import { db } from "@/lib/db"
import { storeEmbedding, generateEmbedding } from "@/lib/embeddings"
import type { ActorCtx } from "@/lib/services/actor-context"

// ─── Types (mirrors the CHECK constraints in drizzle/0520's memory_records/
// memory_sources/memory_versions -- kept as plain string unions, not a
// pg enum, matching schema.ts's own comment on why every CHECK in this
// codebase lives in hand-written migration SQL rather than a Drizzle enum
// helper) ────────────────────────────────────────────────────────────────

// GLOBAL/INDUSTRY deliberately excluded from this type: Phase 1's own RLS
// makes writing those scope types an admin/service_role-only path (the
// INSERT/UPDATE policies' WITH CHECK org_id = compliance.current_org_id()
// can never be true when org_id IS NULL) -- createMemoryRecord() and
// supersedeMemoryRecord() below are the "ordinary org-scoped app request"
// path Phase 1's migration header describes, not that admin path, and
// guard against it explicitly rather than let it fail with an opaque RLS
// error deep inside a transaction.
// DEPARTMENT (R68 Phase 3, drizzle/0542) joins this list for the same
// reason ORGANIZATION/USER/etc do -- an ordinary org-scoped write, org_id
// NOT NULL, no admin/service_role path involved. It carries no dedicated
// column: scopeId is the department's compliance.departments id, the same
// polymorphic-pointer convention PROJECT/TASK/CONVERSATION/DOCUMENT already
// use (see schema.ts's own comment on memoryRecords.scopeId).
export type OrgScopedMemoryScopeType =
  | "ORGANIZATION"
  | "DEPARTMENT"
  | "USER"
  | "PROJECT"
  | "TASK"
  | "CONVERSATION"
  | "DOCUMENT"

export const ORG_SCOPED_MEMORY_SCOPE_TYPES: readonly OrgScopedMemoryScopeType[] = [
  "ORGANIZATION",
  "DEPARTMENT",
  "USER",
  "PROJECT",
  "TASK",
  "CONVERSATION",
  "DOCUMENT",
]

export type MemoryType =
  | "FACT"
  | "PREFERENCE"
  | "RULE"
  | "PROCEDURE"
  | "DECISION"
  | "CONTEXT"
  | "HISTORY"
  | "LESSON"
  | "PATTERN"
  | "WORKFLOW"
  | "TASK_RESULT"
  | "DOCUMENT_KNOWLEDGE"
  | "USER_INSTRUCTION"
  | "ORGANIZATION_INSTRUCTION"
  | "INDUSTRY_KNOWLEDGE"

export type ProvenanceType =
  | "USER_CONFIRMED"
  | "DATABASE_CONFIRMED"
  | "SYSTEM_DERIVED"
  | "AI_INFERRED"
  | "EXTERNAL_SOURCE"

export type LifecycleState = "TRANSIENT" | "CANDIDATE" | "CONFIRMED" | "ACTIVE" | "SUPERSEDED" | "ARCHIVED"

export type MemorySourceKind = "CONVERSATION" | "TASK" | "DOCUMENT" | "SHEET_ROW" | "MANUAL"

export type ChangedByType = "USER" | "SYSTEM" | "AI"

export type MemoryRecord = {
  id: string
  scopeType: string
  scopeId: string | null
  orgId: string | null
  userId: string | null
  industryId: string | null
  projectId: string | null
  taskId: string | null
  memoryType: string
  content: string
  contentHash: string
  confidence: number | null
  provenanceType: string
  lifecycleState: string
  sourceType: string | null
  sourceId: string | null
  registryRef: string | null
  metadata: Record<string, unknown>
  version: number
  supersededById: string | null
  // R68 Phase 3 (drizzle/0542): true only for a USER-scoped row marked
  // private to its owning user -- see this file's resolveMemoryScope()
  // section for the full CRR-234-derived reasoning. False for every
  // pre-existing row and every non-USER scope_type.
  isPersonal: boolean
  effectiveFrom: Date
  effectiveTo: Date | null
  createdAt: Date
  updatedAt: Date
}

type RawMemoryRecordRow = {
  id: string
  scope_type: string
  scope_id: string | null
  org_id: string | null
  user_id: string | null
  industry_id: string | null
  project_id: string | null
  task_id: string | null
  memory_type: string
  content: string
  content_hash: string
  confidence: string | number | null
  provenance_type: string
  lifecycle_state: string
  source_type: string | null
  source_id: string | null
  registry_ref: string | null
  metadata: Record<string, unknown>
  version: number
  superseded_by_id: string | null
  is_personal: boolean
  effective_from: Date
  effective_to: Date | null
  created_at: Date
  updated_at: Date
}

function mapMemoryRecordRow(row: RawMemoryRecordRow): MemoryRecord {
  return {
    id: row.id,
    scopeType: row.scope_type,
    scopeId: row.scope_id,
    orgId: row.org_id,
    userId: row.user_id,
    industryId: row.industry_id,
    projectId: row.project_id,
    taskId: row.task_id,
    memoryType: row.memory_type,
    content: row.content,
    contentHash: row.content_hash,
    confidence: row.confidence === null || row.confidence === undefined ? null : Number(row.confidence),
    provenanceType: row.provenance_type,
    lifecycleState: row.lifecycle_state,
    sourceType: row.source_type,
    sourceId: row.source_id,
    registryRef: row.registry_ref,
    metadata: row.metadata ?? {},
    version: Number(row.version),
    supersededById: row.superseded_by_id,
    isPersonal: Boolean(row.is_personal),
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

// ─── Embedding generation + storage (shared by createMemoryRecord and
// supersedeMemoryRecord) ────────────────────────────────────────────────

const MEMORY_RECORD_ENTITY_TYPE = "memory_record"

/**
 * Generates (via storeEmbedding(), the existing embeddings.ts path -- not
 * reimplemented here) and persists the embedding for one memory_records
 * row, both in the shared compliance.embeddings registry (storeEmbedding's
 * own table) AND mirrored onto memory_records.embedding itself (this
 * phase's new column) so searchMemories() below can run a single,
 * scope_type/RLS-correct ANN query directly against compliance.memory_records
 * -- see drizzle/0523's header and this file's own header comment for why
 * findSimilar() alone cannot do that.
 *
 * Throws if no real embedding provider is configured (storeEmbedding's own
 * CRR-017 discipline: "no silent skip -- a missing embedding must look
 * like a failure to the caller, never like a successful, quietly-degraded
 * one"). Since this always runs inside the caller's own tx, that throw
 * rolls back the memory_records insert/update alongside it -- this
 * function deliberately does not swallow the error to make embedding
 * generation "best effort".
 */
async function embedAndMirror(tx: TenantDb, memoryRecordId: string, content: string, orgId: string): Promise<void> {
  await storeEmbedding(MEMORY_RECORD_ENTITY_TYPE, memoryRecordId, content, orgId)

  // Read the vector storeEmbedding() just generated back out of
  // compliance.embeddings -- a plain local DB read, NOT a second
  // embedding-provider call -- using the same bypass-RLS `db` connection
  // storeEmbedding()/findSimilar() themselves already use (app_runtime has
  // no RLS policy on compliance.embeddings at all, so this read cannot go
  // through `tx`).
  const rows = (await db.execute(sql`
    SELECT embedding::text AS embedding
    FROM compliance.embeddings
    WHERE entity_type = ${MEMORY_RECORD_ENTITY_TYPE} AND entity_id = ${memoryRecordId}
    ORDER BY created_at DESC
    LIMIT 1
  `)) as { embedding: string }[]

  const vectorText = rows[0]?.embedding
  if (!vectorText) {
    // Should not happen -- storeEmbedding() either threw already (no real
    // provider) or wrote the row. Fail loudly rather than silently leaving
    // memory_records.embedding NULL forever with no trace of why.
    throw new Error(
      `embedAndMirror: storeEmbedding() reported success for ${MEMORY_RECORD_ENTITY_TYPE}/${memoryRecordId} but no matching row was found in compliance.embeddings`
    )
  }

  await tx.execute(sql`
    UPDATE compliance.memory_records
    SET embedding = ${vectorText}::vector, updated_at = now()
    WHERE id = ${memoryRecordId}
  `)
}

// ─── createMemoryRecord ────────────────────────────────────────────────

export type CreateMemoryRecordInput = {
  scopeType: OrgScopedMemoryScopeType
  scopeId?: string | null
  userId?: string | null
  industryId?: string | null
  projectId?: string | null
  taskId?: string | null
  memoryType: MemoryType
  content: string
  confidence?: number | null
  provenanceType: ProvenanceType
  lifecycleState?: LifecycleState
  sourceType?: string | null
  sourceId?: string | null
  registryRef?: string | null
  metadata?: Record<string, unknown>
  // R68 Phase 3: only legal when scopeType is 'USER' -- see the
  // memory_records_personal_requires_user_scope_check CHECK constraint
  // (drizzle/0542) this input-level guard mirrors. Defaults to false
  // (org-visible, today's exact pre-existing behavior).
  isPersonal?: boolean
  // Optional provenance detail row (compliance.memory_sources) -- written
  // in the same tx as the memory_records row when supplied.
  source?: {
    sourceKind: MemorySourceKind
    conversationId?: string | null
    taskId?: string | null
    documentId?: string | null
    sheetRowRef?: string | null
  }
}

/**
 * Writes one compliance.memory_records row (plus an optional
 * compliance.memory_sources provenance row) for `orgId`, then generates
 * and stores its embedding -- see embedAndMirror()'s own header for the
 * two-connection/one-provider-call design this relies on.
 *
 * `tx` must already be inside a withTenantContext({ orgId, ... }, ...)
 * block for the SAME orgId passed here -- Phase 1's real RLS INSERT policy
 * (WITH CHECK org_id = compliance.current_org_id()) is what actually
 * enforces that the two agree, not this function.
 */
/**
 * R68 Phase 3 (drizzle/0542) input-level guards, split out of
 * createMemoryRecord() itself (and returning the resolved isPersonal
 * default, rather than leaving that `?? false` inline in the INSERT
 * below) so createMemoryRecord()'s own cyclomatic complexity stays under
 * this repo's ESLint budget:
 *  - a DEPARTMENT-scoped row is meaningless without knowing WHICH
 *    department -- scopeId is the polymorphic pointer that carries it
 *    (see OrgScopedMemoryScopeType's own comment), so this requires it
 *    rather than let a caller silently write an unaddressable department
 *    row that resolveMemoryScope() below can never match against any real
 *    department.
 *  - isPersonal mirrors the memory_records_personal_requires_user_scope_check
 *    CHECK constraint -- a clear application-level error instead of an
 *    opaque RLS/CHECK-violation deep inside the INSERT.
 */
function assertR68ScopeInputIsLegal(input: CreateMemoryRecordInput): boolean {
  if (input.scopeType === "DEPARTMENT" && !input.scopeId) {
    throw new Error("createMemoryRecord: DEPARTMENT-scoped memory requires scopeId (a compliance.departments id)")
  }
  if (input.isPersonal && (input.scopeType !== "USER" || !input.userId)) {
    throw new Error("createMemoryRecord: isPersonal is only legal for a USER-scoped memory with a userId")
  }
  return input.isPersonal ?? false
}

export async function createMemoryRecord(
  tx: TenantDb,
  orgId: string,
  input: CreateMemoryRecordInput
): Promise<MemoryRecord> {
  if (!orgId) {
    throw new Error("createMemoryRecord: orgId is required")
  }
  if (!ORG_SCOPED_MEMORY_SCOPE_TYPES.includes(input.scopeType)) {
    // Real guard, not just a type-level one -- a caller going through JS
    // (not TypeScript) could otherwise pass 'GLOBAL'/'INDUSTRY' and hit an
    // opaque RLS policy violation instead of this clear message. See this
    // file's own header for why that admin/service_role-only path isn't
    // built here.
    throw new Error(
      `createMemoryRecord: scopeType ${String(input.scopeType)} is not an ordinary org-scoped memory (GLOBAL/INDUSTRY memories are an admin/service_role-only path per Phase 1's RLS design, not supported by this function)`
    )
  }
  const isPersonal = assertR68ScopeInputIsLegal(input)
  const trimmedContent = input.content.trim()
  if (!trimmedContent) {
    throw new Error("createMemoryRecord: content must not be empty")
  }

  const id = createId()
  const contentHash = createHash("sha256").update(trimmedContent).digest("hex")
  const metadataJson = JSON.stringify(input.metadata ?? {})

  const inserted = (await tx.execute(sql`
    INSERT INTO compliance.memory_records
      (id, scope_type, scope_id, org_id, user_id, industry_id, project_id, task_id,
       memory_type, content, content_hash, confidence, provenance_type, lifecycle_state,
       source_type, source_id, registry_ref, metadata, version, is_personal)
    VALUES
      (${id}, ${input.scopeType}, ${input.scopeId ?? null}, ${orgId}, ${input.userId ?? null},
       ${input.industryId ?? null}, ${input.projectId ?? null}, ${input.taskId ?? null},
       ${input.memoryType}, ${trimmedContent}, ${contentHash}, ${input.confidence ?? null}::numeric,
       ${input.provenanceType}, ${input.lifecycleState ?? "CANDIDATE"}, ${input.sourceType ?? null},
       ${input.sourceId ?? null}, ${input.registryRef ?? null}, ${metadataJson}::jsonb, 1, ${isPersonal})
    RETURNING *
  `)) as RawMemoryRecordRow[]

  // Use the row the database actually returned (record.id) rather than the
  // pre-insert local `id`, from here on -- they are always the same value
  // in a real INSERT ... RETURNING round-trip, but treating the DB's own
  // echo as authoritative is the more defensive pattern.
  const record = mapMemoryRecordRow(inserted[0])

  if (input.source) {
    await tx.execute(sql`
      INSERT INTO compliance.memory_sources
        (id, memory_record_id, source_kind, conversation_id, task_id, document_id, sheet_row_ref)
      VALUES
        (${createId()}, ${record.id}, ${input.source.sourceKind}, ${input.source.conversationId ?? null},
         ${input.source.taskId ?? null}, ${input.source.documentId ?? null}, ${input.source.sheetRowRef ?? null})
    `)
  }

  await embedAndMirror(tx, record.id, trimmedContent, orgId)

  return record
}

// ─── searchMemories ─────────────────────────────────────────────────────

export type SearchMemoriesOptions = {
  // Additional narrowing on top of RLS's own "own org or global" boundary
  // -- omit for no extra filter.
  scopeType?: OrgScopedMemoryScopeType | "GLOBAL" | "INDUSTRY"
  memoryType?: MemoryType
  // Defaults to excluding ARCHIVED/SUPERSEDED rows (a superseded memory's
  // *content* is stale by definition -- callers that specifically want
  // history should read compliance.memory_versions or follow
  // superseded_by_id chains, not searchMemories()).
  includeArchivedAndSuperseded?: boolean
  limit?: number
  // R65 Part C Phase 3 addition (pipeline-wiring): when supplied, excludes
  // every OTHER user's own USER-scope memory from the result set --
  // ORGANIZATION/PROJECT/TASK/CONVERSATION/DOCUMENT/GLOBAL/INDUSTRY rows are
  // unaffected, this only narrows the USER scope_type case. Phase 1's RLS
  // enforces "own org or global" at the database level, which is the real,
  // non-negotiable multi-tenant boundary (directive §9) -- but two different
  // users in the SAME org both pass that check equally, so RLS alone cannot
  // stop teammate A's chat from surfacing teammate B's personal USER-scope
  // preference (e.g. "always address me as ma'am"). Omitting this option
  // (every pre-Phase-3 caller) keeps the exact prior behaviour.
  requestingUserId?: string | null
}

export type MemorySearchMatch = MemoryRecord & { score: number }

/**
 * Semantic similarity search over compliance.memory_records, scoped
 * entirely by the caller's own withTenantContext transaction: Phase 1's
 * real SELECT RLS policy (org_id = compliance.current_org_id() OR org_id
 * IS NULL) is what actually restricts results to "this org's own memories
 * plus every GLOBAL/INDUSTRY memory" -- this function adds no org filter
 * of its own, by design, so there is exactly one place ("own org or
 * global") that decision is made.
 *
 * Reuses generateEmbedding() (embeddings.ts) for the query vector -- not
 * findSimilar(), which has no entity_type filter and would mix memory
 * records with every other embedded entity type in the platform (see this
 * file's own header). Runs directly against memory_records.embedding
 * (Phase 2's new HNSW-indexed column) instead.
 */
export async function searchMemories(
  tx: TenantDb,
  query: string,
  options: SearchMemoriesOptions = {}
): Promise<MemorySearchMatch[]> {
  const trimmedQuery = query.trim()
  if (!trimmedQuery) return []

  const limit = options.limit ?? 10
  const queryVector = await generateEmbedding(trimmedQuery)
  const vectorStr = `[${queryVector.join(",")}]`

  const scopeTypeFilter = options.scopeType ? sql`AND scope_type = ${options.scopeType}` : sql``
  const memoryTypeFilter = options.memoryType ? sql`AND memory_type = ${options.memoryType}` : sql``
  const lifecycleFilter = options.includeArchivedAndSuperseded
    ? sql``
    : sql`AND lifecycle_state NOT IN ('ARCHIVED', 'SUPERSEDED')`
  // See SearchMemoriesOptions.requestingUserId's own comment: excludes a
  // DIFFERENT user's USER-scope rows, never this user's own, and never any
  // non-USER scope_type.
  const userScopeFilter = options.requestingUserId
    ? sql`AND (scope_type <> 'USER' OR user_id = ${options.requestingUserId})`
    : sql``

  const rows = (await tx.execute(sql`
    SELECT id, scope_type, scope_id, org_id, user_id, industry_id, project_id, task_id,
           memory_type, content, content_hash, confidence, provenance_type, lifecycle_state,
           source_type, source_id, registry_ref, metadata, version, superseded_by_id, is_personal,
           effective_from, effective_to, created_at, updated_at,
           1 - (embedding <=> ${vectorStr}::vector) AS score
    FROM compliance.memory_records
    WHERE embedding IS NOT NULL
      ${scopeTypeFilter}
      ${memoryTypeFilter}
      ${lifecycleFilter}
      ${userScopeFilter}
    ORDER BY embedding <=> ${vectorStr}::vector
    LIMIT ${limit}
  `)) as (RawMemoryRecordRow & { score: number })[]

  return rows.map((row) => ({ ...mapMemoryRecordRow(row), score: Number(row.score) }))
}

// ─── supersedeMemoryRecord ──────────────────────────────────────────────

export type SupersedeMemoryRecordChangedBy = {
  type: ChangedByType
  id?: string | null
  reason?: string | null
  // R68 Phase 1 (drizzle/0541_r68_phase1_bitemporal_enforcement.sql):
  // optional, persisted onto the memory_versions snapshot row this
  // function writes for the OLD content -- nullable/additive on that
  // table, so omitting both here is exactly the pre-R68 behavior (both
  // columns stay NULL). Only meaningful when the revision was itself
  // AI/LLM-driven; a USER or SYSTEM-originated change legitimately has
  // neither and should omit them.
  modelId?: string | null
  promptHash?: string | null
}

export type SupersedeMemoryRecordResult = {
  previous: MemoryRecord
  next: MemoryRecord
}

/**
 * Append-only supersession: never UPDATEs a memory_records row's content
 * in place. Instead:
 *   1. Snapshots the CURRENT (about-to-be-superseded) content of `oldId`
 *      into compliance.memory_versions (versionNumber = the old row's own
 *      `version`) -- append-only, matches memory_versions' own
 *      memory_versions_record_version_unique constraint and the fact that
 *      app_runtime has SELECT+INSERT only on that table, no UPDATE/DELETE.
 *   2. Inserts a brand-new compliance.memory_records row carrying the new
 *      content (same scope/org/user/etc as the old row, version =
 *      old.version + 1, lifecycle_state 'ACTIVE').
 *   3. Marks the OLD row lifecycle_state = 'SUPERSEDED', superseded_by_id
 *      = the new row's id, effective_to = now() -- the old row is never
 *      deleted, only pointed forward.
 *   4. Generates + stores the new row's embedding (same embedAndMirror()
 *      path as createMemoryRecord()).
 *
 * Throws if `oldId` cannot be found under RLS (unknown id, wrong org, or a
 * GLOBAL/INDUSTRY row -- see this file's own header on why that last case
 * is out of scope here), or if it has already been superseded.
 *
 * Byte-identical no-op (directive §16, "Unchanged content -> do NOT
 * re-embed... reduces embedding cost/unnecessary processing"): if
 * `newContent` (after trimming) hashes to the SAME content_hash the row
 * already has, this function performs ZERO writes -- no memory_versions
 * snapshot, no new memory_records row, no lifecycle_state change on the old
 * row, no embedAndMirror() call (i.e. no real embedding-provider call) --
 * and simply returns `{ previous, next: previous }`. A version bump and a
 * fresh embedding call both exist to represent a real content change; when
 * there isn't one, manufacturing either is exactly the "unnecessary
 * processing" §16 says to avoid, not a genuine supersession. This check
 * runs AFTER the not-found/already-superseded/GLOBAL guards above, which
 * still throw regardless of content -- a caller trying to "supersede" a row
 * that doesn't exist or is already terminal should not silently succeed
 * just because the content also happens to match.
 */
export async function supersedeMemoryRecord(
  tx: TenantDb,
  oldId: string,
  newContent: string,
  changedBy: SupersedeMemoryRecordChangedBy
): Promise<SupersedeMemoryRecordResult> {
  const trimmedContent = newContent.trim()
  if (!trimmedContent) {
    throw new Error("supersedeMemoryRecord: newContent must not be empty")
  }

  const existingRows = (await tx.execute(sql`
    SELECT * FROM compliance.memory_records WHERE id = ${oldId}
  `)) as RawMemoryRecordRow[]

  if (existingRows.length === 0) {
    // Either the id genuinely doesn't exist, or RLS filtered it out
    // (belongs to a different org) -- both look identical to the caller,
    // which is the correct fail-closed behavior (same reasoning
    // tenant-scoped.ts's own header gives for RLS in general).
    throw new Error(`supersedeMemoryRecord: memory_records row ${oldId} not found`)
  }
  const previous = mapMemoryRecordRow(existingRows[0])

  if (previous.lifecycleState === "SUPERSEDED" || previous.supersededById) {
    throw new Error(`supersedeMemoryRecord: memory_records row ${oldId} has already been superseded by ${previous.supersededById}`)
  }
  if (previous.orgId === null) {
    // GLOBAL/INDUSTRY row: the INSERT/UPDATE this function performs below
    // would fail Phase 1's own RLS WITH CHECK (org_id = current_org_id(),
    // never true for NULL) -- fail with a clear message up front instead
    // of a bare RLS-violation error partway through the transaction.
    throw new Error(
      `supersedeMemoryRecord: ${oldId} is a GLOBAL/INDUSTRY-scoped memory (org_id IS NULL) -- superseding it is an admin/service_role-only path per Phase 1's RLS design, not supported by this function`
    )
  }

  const newContentHash = createHash("sha256").update(trimmedContent).digest("hex")
  if (newContentHash === previous.contentHash) {
    // See this function's own docstring: a true no-op, not a degenerate
    // "supersede with unchanged content" case -- zero DB writes, zero
    // embedding-provider calls.
    return { previous, next: previous }
  }

  await tx.execute(sql`
    INSERT INTO compliance.memory_versions
      (id, memory_record_id, version_number, content_snapshot, content_hash, changed_by_type, changed_by_id, change_reason, model_id, prompt_hash)
    VALUES
      (${createId()}, ${oldId}, ${previous.version}, ${previous.content}, ${previous.contentHash},
       ${changedBy.type}, ${changedBy.id ?? null}, ${changedBy.reason ?? null}, ${changedBy.modelId ?? null}, ${changedBy.promptHash ?? null})
  `)

  const newId = createId()
  const metadataJson = JSON.stringify(previous.metadata ?? {})

  const insertedNewRows = (await tx.execute(sql`
    INSERT INTO compliance.memory_records
      (id, scope_type, scope_id, org_id, user_id, industry_id, project_id, task_id,
       memory_type, content, content_hash, confidence, provenance_type, lifecycle_state,
       source_type, source_id, registry_ref, metadata, version, is_personal)
    VALUES
      (${newId}, ${previous.scopeType}, ${previous.scopeId}, ${previous.orgId}, ${previous.userId},
       ${previous.industryId}, ${previous.projectId}, ${previous.taskId},
       ${previous.memoryType}, ${trimmedContent}, ${newContentHash}, ${previous.confidence}::numeric,
       ${previous.provenanceType}, 'ACTIVE', ${previous.sourceType},
       ${previous.sourceId}, ${previous.registryRef}, ${metadataJson}::jsonb, ${previous.version + 1}, ${previous.isPersonal})
    RETURNING *
  `)) as RawMemoryRecordRow[]
  // As in createMemoryRecord(): treat the DB's own RETURNING echo as
  // authoritative for the new row's id, not the pre-insert local `newId`.
  const next = mapMemoryRecordRow(insertedNewRows[0])

  await tx.execute(sql`
    UPDATE compliance.memory_records
    SET lifecycle_state = 'SUPERSEDED', superseded_by_id = ${next.id}, effective_to = now(), updated_at = now()
    WHERE id = ${oldId}
  `)
  previous.lifecycleState = "SUPERSEDED"
  previous.supersededById = next.id

  await embedAndMirror(tx, next.id, trimmedContent, previous.orgId)

  return { previous, next }
}

// ─── promoteMemoryRecord / archiveMemoryRecord ─────────────────────────
//
// Directive §29's own lifecycle diagram: TRANSIENT → CANDIDATE → CONFIRMED
// → ACTIVE → SUPERSEDED → ARCHIVED. createMemoryRecord() (default
// lifecycleState "CANDIDATE") and supersedeMemoryRecord() (the SUPERSEDED
// transition) already exist -- the two functions below close the
// remaining gap in the directive's own Phase 3 function list
// (`archive_memory()`, `promote_memory()`), which had not been built by
// any prior phase despite createMemoryRecord()/searchMemories() defaulting
// every fresh CANDIDATE row to being retrievable forever with no way to
// formally confirm, activate, or retire it.
//
// Directive §14 is the reason this matters, not just completeness: "AI-
// inferred info must NOT auto-become authoritative fact -- important info
// requires confirmation before promotion to durable org memory." Without
// promoteMemoryRecord(), there is no code path that ever represents that
// confirmation happening; without archiveMemoryRecord(), there is no way
// to retire a memory that was never superseded by new content but is
// simply no longer relevant (e.g. a rejected CANDIDATE, or an ACTIVE
// memory an admin/user decides to retract outright).
//
// Neither function re-embeds or changes `content`/`content_hash` -- a
// lifecycle-state change is not a content change, so directive §16 ("don't
// re-embed unchanged content") applies here just as much as it did to
// createMemoryRecord()/supersedeMemoryRecord()'s own embedding calls.
//
// Both functions are additive, real, and independently callable -- neither
// is wired into any chat/task/UI call site by this change. That wiring
// (e.g. a user explicitly confirming an AI-inferred preference, or a
// future Phase 12 Settings UI "Confirm"/"Archive" action) is out of scope
// here, the same incremental posture Phase 1 (schema-only) and Phase 2
// (embedding-layer-only) themselves shipped under before Phase 3 wired
// either of them into a real caller.

// Kept as its own exported name (not a bare alias re-export) so a reader
// of promoteMemoryRecord()/archiveMemoryRecord()'s signatures isn't left
// looking at a type named after a different function -- structurally
// identical to SupersedeMemoryRecordChangedBy (same {type, id?, reason?}
// audit shape) by design, not by coincidence.
export type MemoryLifecycleChangedBy = SupersedeMemoryRecordChangedBy

export type PromotableLifecycleState = "CANDIDATE" | "CONFIRMED" | "ACTIVE"

// The only legal single-step forward promotions this function will
// perform -- deliberately does NOT allow skipping a level (e.g.
// TRANSIENT -> ACTIVE, or CANDIDATE -> ACTIVE directly). A caller wanting
// CONFIRMED -> ACTIVE after starting at CANDIDATE must call this function
// twice, once per real transition -- matching the directive's own worked
// example (§29) of each stage being a distinct, separately-earned step
// ("AI guesses preference (CANDIDATE) -> user confirms (CONFIRMED) ->
// repeated successful use (ACTIVE)").
const LEGAL_PROMOTIONS: Partial<Record<LifecycleState, PromotableLifecycleState>> = {
  TRANSIENT: "CANDIDATE",
  CANDIDATE: "CONFIRMED",
  CONFIRMED: "ACTIVE",
}

/**
 * Appends one entry to `metadata.lifecycleHistory` (preserving every other
 * existing metadata key untouched) -- the audit trail for a lifecycle-only
 * change, since compliance.memory_versions (append-only content history,
 * NOT NULL content_snapshot/content_hash) is the wrong shape for a
 * transition that carries no new content. This is the same "traceable to
 * who/when/why" provenance directive §28 requires of content changes,
 * applied to state changes instead.
 */
function appendLifecycleHistory(
  metadata: Record<string, unknown>,
  entry: { from: string; to: string; changedBy: MemoryLifecycleChangedBy }
): string {
  const existing = Array.isArray(metadata.lifecycleHistory) ? metadata.lifecycleHistory : []
  const next = [
    ...existing,
    {
      from: entry.from,
      to: entry.to,
      changedByType: entry.changedBy.type,
      changedById: entry.changedBy.id ?? null,
      reason: entry.changedBy.reason ?? null,
      at: new Date().toISOString(),
    },
  ]
  return JSON.stringify({ ...metadata, lifecycleHistory: next })
}

/**
 * Fetches a memory_records row by id (same RLS-governed, fail-closed
 * lookup supersedeMemoryRecord() already uses) and guards against the
 * GLOBAL/INDUSTRY (org_id NULL) admin/service_role-only path -- shared by
 * promoteMemoryRecord() and archiveMemoryRecord() below so the same two
 * checks aren't duplicated in both.
 */
async function fetchOwnOrgMemoryRecordOrThrow(tx: TenantDb, id: string, callerName: string): Promise<MemoryRecord> {
  const rows = (await tx.execute(sql`SELECT * FROM compliance.memory_records WHERE id = ${id}`)) as RawMemoryRecordRow[]
  if (rows.length === 0) {
    // Either the id genuinely doesn't exist, or RLS filtered it out
    // (belongs to a different org) -- both look identical to the caller,
    // the correct fail-closed behavior (same reasoning as
    // supersedeMemoryRecord()'s own not-found case).
    throw new Error(`${callerName}: memory_records row ${id} not found`)
  }
  const record = mapMemoryRecordRow(rows[0])
  if (record.orgId === null) {
    throw new Error(
      `${callerName}: ${id} is a GLOBAL/INDUSTRY-scoped memory (org_id IS NULL) -- changing its lifecycle state is an admin/service_role-only path per Phase 1's RLS design, not supported by this function`
    )
  }
  return record
}

/**
 * Advances one memory_records row exactly one legal step along the
 * directive §29 lifecycle (TRANSIENT -> CANDIDATE -> CONFIRMED -> ACTIVE).
 * `toState` must match the single legal next state for the row's CURRENT
 * lifecycle_state -- this is a defensive, explicit contract (a caller
 * assuming the wrong current state gets a clear error, never a silent
 * "promoted to whatever came next") rather than an argument-less "advance
 * one step" call.
 *
 * Throws if the row cannot be found under RLS, is a GLOBAL/INDUSTRY row,
 * is already SUPERSEDED/ARCHIVED (terminal states with their own
 * dedicated functions -- supersedeMemoryRecord()/archiveMemoryRecord(),
 * not this one), or if `toState` does not match the one legal next step
 * from the row's actual current state.
 */
export async function promoteMemoryRecord(
  tx: TenantDb,
  id: string,
  toState: PromotableLifecycleState,
  changedBy: MemoryLifecycleChangedBy
): Promise<MemoryRecord> {
  const current = await fetchOwnOrgMemoryRecordOrThrow(tx, id, "promoteMemoryRecord")

  const legalNext = LEGAL_PROMOTIONS[current.lifecycleState as LifecycleState]
  if (!legalNext || legalNext !== toState) {
    throw new Error(
      legalNext
        ? `promoteMemoryRecord: ${id} is currently ${current.lifecycleState}; the only legal next state is ${legalNext}, not ${toState}`
        : `promoteMemoryRecord: ${id} is currently ${current.lifecycleState}, which has no further promotion (SUPERSEDED/ARCHIVED are terminal here, or the state is already the highest promotable one -- see supersedeMemoryRecord()/archiveMemoryRecord() for the transitions this function does not perform)`
    )
  }

  const metadataJson = appendLifecycleHistory(current.metadata, { from: current.lifecycleState, to: toState, changedBy })

  const updatedRows = (await tx.execute(sql`
    UPDATE compliance.memory_records
    SET lifecycle_state = ${toState}, metadata = ${metadataJson}::jsonb, updated_at = now()
    WHERE id = ${id}
    RETURNING *
  `)) as RawMemoryRecordRow[]

  return mapMemoryRecordRow(updatedRows[0])
}

/**
 * Retires a memory_records row permanently to lifecycle_state 'ARCHIVED' --
 * reachable from ANY other lifecycle state (unlike promoteMemoryRecord(),
 * which only allows one legal forward step). This is deliberate: a stale
 * CANDIDATE that turned out to be a bad AI inference, an ACTIVE memory a
 * user explicitly retracts, or a long-superseded row a retention policy
 * wants to retire are all legitimate archive operations, and none of them
 * have to pass through CONFIRMED/ACTIVE first.
 *
 * Sets `effective_to` to now() if it was not already set (a row
 * supersedeMemoryRecord() already marked SUPERSEDED keeps its original
 * effective_to from that transition, not a later archive-time one).
 *
 * Throws if the row cannot be found under RLS, is a GLOBAL/INDUSTRY row,
 * or is already ARCHIVED (idempotency guard -- archiving twice is a no-op
 * that should surface as a clear error, not silently succeed and rewrite
 * lifecycleHistory a second time).
 */
export async function archiveMemoryRecord(tx: TenantDb, id: string, changedBy: MemoryLifecycleChangedBy): Promise<MemoryRecord> {
  const current = await fetchOwnOrgMemoryRecordOrThrow(tx, id, "archiveMemoryRecord")

  if (current.lifecycleState === "ARCHIVED") {
    throw new Error(`archiveMemoryRecord: ${id} is already ARCHIVED`)
  }

  const metadataJson = appendLifecycleHistory(current.metadata, { from: current.lifecycleState, to: "ARCHIVED", changedBy })

  const updatedRows = (await tx.execute(sql`
    UPDATE compliance.memory_records
    SET lifecycle_state = 'ARCHIVED', metadata = ${metadataJson}::jsonb,
        effective_to = COALESCE(effective_to, now()), updated_at = now()
    WHERE id = ${id}
    RETURNING *
  `)) as RawMemoryRecordRow[]

  return mapMemoryRecordRow(updatedRows[0])
}

// ─── resolveMemoryScope (R68 Phase 3, IMG-013) ──────────────────────────
//
// THE ONE scope resolver. Zero memory/recall/scope DB routines existed
// before this (verified live via information_schema.routines against
// pcrjmlpuqsbocqfwoxod immediately before this migration/PR was written),
// so this is plain server-side TypeScript -- an application-server
// function, never a client -- not a Postgres routine; "server-side only"
// in the R68 directive means the former, not the latter (matches every
// other resolution/authorization function in this codebase, e.g.
// resolveActingUser()/requireRole(), which are also TS, not SQL).
//
// Precedence order, most specific wins: GLOBAL -> ORGANIZATION ->
// DEPARTMENT -> USER. This is the owner's 2026-09-03 v1 decision (exactly
// these four of the five img_spec levels; PRODUCT deferred, see
// drizzle/0542's own header) -- not a fifth, independently-invented
// resolution mechanism: it reuses memory_records.scope_type/scope_id (R-
// IMG-03's binding rule) and this codebase's own existing RBAC (ActorCtx)
// for "who is asking", exactly as directed. INDUSTRY/PROJECT/TASK/
// CONVERSATION/DOCUMENT scope_type rows are untouched by this resolver --
// they are a different axis (a specific project/task/conversation/
// document a memory was captured under, not an org-hierarchy tier) and
// were never part of the five-level v1 scope-level decision to begin with.
//
// AUTHORIZATION IS SERVER-SIDE ONLY: `actor` must be a real ActorCtx
// (resolveActingUser()'s own output, never a client-supplied org/
// department/user triple) -- this function reads the department id off
// `actor.dbUser.departmentId`, the DB-backed users row, not off any
// request body. Every row this function fetches is additionally governed
// by Phase 1's own RLS (own org or global; is_personal exclusion, drizzle/
// 0542) -- this function only ever NARROWS what RLS would return, it
// cannot widen it (CRR-234's rule: authorization lives in RLS, not here).

/** The four v1 scope levels, ordered least -> most specific. */
export const MEMORY_SCOPE_PRECEDENCE = ["GLOBAL", "ORGANIZATION", "DEPARTMENT", "USER"] as const
export type ResolvableMemoryScopeType = (typeof MEMORY_SCOPE_PRECEDENCE)[number]

const MEMORY_SCOPE_RANK: Record<ResolvableMemoryScopeType, number> = {
  GLOBAL: 0,
  ORGANIZATION: 1,
  DEPARTMENT: 2,
  USER: 3,
}

function isResolvableMemoryScopeType(scopeType: string): scopeType is ResolvableMemoryScopeType {
  return Object.prototype.hasOwnProperty.call(MEMORY_SCOPE_RANK, scopeType)
}

export type ResolvedMemoryRecord = MemoryRecord & { scopeRank: number }

export type ResolveMemoryScopeOptions = {
  memoryType?: MemoryType
  // Narrows to one specific registryRef's candidates across all four
  // levels -- omit to resolve every logical key the actor can see.
  registryRef?: string
  // Same default as searchMemories(): excludes ARCHIVED/SUPERSEDED rows
  // unless explicitly asked for.
  includeArchivedAndSuperseded?: boolean
}

/**
 * Groups already-fetched candidates by logical key (registryRef when set,
 * else `memoryType:<type>` -- registryRef is this schema's own closest
 * thing to a stable "what is this memory about" identifier, see
 * schema.ts's comment on memoryRecords.registryRef) and keeps, per key,
 * only the candidate with the highest scopeRank (ties broken by the most
 * recently updated row, so two rows written at the same scope level never
 * pick an arbitrary winner). Exported separately from resolveMemoryScope()
 * so the real most-specific-wins precedence logic is directly unit-
 * testable against a plain in-memory fixture, without needing a live
 * Postgres connection this sandbox/CI does not have (same reasoning as
 * every other DB-independent test in this repo).
 */
export function resolveMostSpecific(candidates: ResolvedMemoryRecord[]): ResolvedMemoryRecord[] {
  const byKey = new Map<string, ResolvedMemoryRecord>()
  for (const candidate of candidates) {
    const key = candidate.registryRef ?? `memoryType:${candidate.memoryType}`
    const existing = byKey.get(key)
    if (
      !existing ||
      candidate.scopeRank > existing.scopeRank ||
      (candidate.scopeRank === existing.scopeRank && candidate.updatedAt > existing.updatedAt)
    ) {
      byKey.set(key, candidate)
    }
  }
  return Array.from(byKey.values()).sort((a, b) => b.scopeRank - a.scopeRank)
}

/**
 * Fetches every memory_records candidate visible to `actor` at the four
 * v1 scope levels and returns the most-specific-wins result per logical
 * key (resolveMostSpecific() above).
 *
 * The WHERE clause below is a narrowing filter on top of RLS, not a
 * substitute for it: even if this function's own org/department/user
 * matching had a bug, Phase 1's real SELECT policy (org_id = current org
 * or NULL, AND NOT is_personal OR user_id = current user) is what a live
 * Postgres would still enforce underneath it. `tx` must already be inside
 * a withTenantContext({ orgId: actor.orgId, userId: actor.userId }, ...)
 * block for that RLS to see the right session GUCs at all -- same
 * contract every other function in this file already has.
 */
export async function resolveMemoryScope(
  tx: TenantDb,
  actor: ActorCtx,
  options: ResolveMemoryScopeOptions = {}
): Promise<ResolvedMemoryRecord[]> {
  // Only a real signed-in dashboard user carries a department (see
  // actor-context.ts: departmentId lives on `users`, not on the api-key
  // branch) -- a server-to-server (apiKey) caller resolves GLOBAL/
  // ORGANIZATION/USER only, which is the correct, conservative behavior:
  // there is no department to prefer for a caller that isn't a specific
  // department's member.
  const departmentId = actor.dbUser?.departmentId ?? null

  const memoryTypeFilter = options.memoryType ? sql`AND memory_type = ${options.memoryType}` : sql``
  const registryRefFilter = options.registryRef ? sql`AND registry_ref = ${options.registryRef}` : sql``
  const lifecycleFilter = options.includeArchivedAndSuperseded
    ? sql``
    : sql`AND lifecycle_state NOT IN ('ARCHIVED', 'SUPERSEDED')`

  const rows = (await tx.execute(sql`
    SELECT id, scope_type, scope_id, org_id, user_id, industry_id, project_id, task_id,
           memory_type, content, content_hash, confidence, provenance_type, lifecycle_state,
           source_type, source_id, registry_ref, metadata, version, superseded_by_id, is_personal,
           effective_from, effective_to, created_at, updated_at
    FROM compliance.memory_records
    WHERE (
      scope_type = 'GLOBAL'
      OR (scope_type = 'ORGANIZATION' AND org_id = ${actor.orgId})
      OR (scope_type = 'DEPARTMENT' AND org_id = ${actor.orgId} AND scope_id = ${departmentId})
      OR (scope_type = 'USER' AND org_id = ${actor.orgId} AND user_id = ${actor.userId})
    )
    ${memoryTypeFilter}
    ${registryRefFilter}
    ${lifecycleFilter}
  `)) as RawMemoryRecordRow[]

  const candidates: ResolvedMemoryRecord[] = rows.map(mapMemoryRecordRow).flatMap((record) => {
    // Defensive, not load-bearing: every branch of the WHERE clause above
    // only ever matches one of the four resolvable scope_types, so this
    // should never filter anything out in practice. Guards against a
    // future WHERE-clause edit widening the query without updating this
    // ranking table in lockstep.
    if (!isResolvableMemoryScopeType(record.scopeType)) return []
    return [{ ...record, scopeRank: MEMORY_SCOPE_RANK[record.scopeType] }]
  })

  return resolveMostSpecific(candidates)
}

// ─── R68 (Institutional Memory Graph) Phase 1: bitemporal enforcement ───
//
// DB-level enforcement (append-only guard trigger, SUPERSEDED-requires-
// pointer CHECK) lives entirely in drizzle/0541_r68_phase1_bitemporal_
// enforcement.sql -- see that migration's own header for the full design
// rationale, including the disclosed metadata-column deviation and the
// role-scoping (app_runtime only) that makes redactMemoryRecordLineage()
// below legal. Everything below is the two items that migration's own
// header says belong in TypeScript, not SQL: as-of recall (item 3) and
// erasure-as-redaction (item 5).

// A memory's full "lineage" is every compliance.memory_records row ever
// produced for the same logical fact by repeated supersedeMemoryRecord()
// calls -- NOT rows sharing this table's own `id` (each row has a
// distinct, permanent id), but the chain linked by superseded_by_id:
// root (v1) -> superseded_by_id -> v2 -> superseded_by_id -> v3 -> ...
// -> current (superseded_by_id IS NULL). Shared by getMemoryRecordAsOf()
// (item 3) and redactMemoryRecordLineage() (item 5) so lineage-walking
// logic exists in exactly one place.
//
// Deliberately generic over the executor (a bare `{ execute }` shape both
// TenantDb and the bypass-RLS `Db` type satisfy) rather than typed to
// TenantDb specifically: getMemoryRecordAsOf() walks via the caller's own
// RLS-governed `tx` (a read, same as searchMemories()), while
// redactMemoryRecordLineage() below walks via the bypass `db` connection
// (a write to `content`, which the append-only trigger blocks for
// app_runtime -- see that function's own header for why it cannot use
// `tx`). One walk implementation, two legitimately different connections.
type MemoryLineageExecutor = { execute: (query: unknown) => Promise<unknown> }

// Defends against a pathological/cyclic superseded_by_id chain (should be
// structurally impossible -- supersedeMemoryRecord() only ever points an
// OLD row forward to a brand-new id it just inserted -- but a walk with no
// bound is the wrong failure mode for a corrupted or adversarially-crafted
// chain to hit, an infinite loop, rather than a bounded, clearly-labeled
// error).
const MAX_MEMORY_LINEAGE_DEPTH = 1000

async function walkMemoryLineageIds(executor: MemoryLineageExecutor, id: string): Promise<string[]> {
  // Phase 1: walk backward to find the root (the row nothing else claims
  // to have superseded FROM, i.e. no other row's superseded_by_id points
  // at it).
  let rootId = id
  const backwardSeen = new Set<string>([id])
  for (let i = 0; i < MAX_MEMORY_LINEAGE_DEPTH; i++) {
    const rows = (await executor.execute(sql`
      SELECT id FROM compliance.memory_records WHERE superseded_by_id = ${rootId} LIMIT 1
    `)) as { id: string }[]
    if (rows.length === 0) break
    if (backwardSeen.has(rows[0].id)) {
      throw new Error(`walkMemoryLineageIds: cyclic superseded_by_id chain detected walking backward from ${id}`)
    }
    backwardSeen.add(rows[0].id)
    rootId = rows[0].id
  }

  // Phase 2: walk forward from the root, collecting every id in order.
  const ids: string[] = []
  const forwardSeen = new Set<string>()
  let cursor: string | null = rootId
  for (let i = 0; i < MAX_MEMORY_LINEAGE_DEPTH && cursor; i++) {
    if (forwardSeen.has(cursor)) {
      throw new Error(`walkMemoryLineageIds: cyclic superseded_by_id chain detected walking forward from ${rootId}`)
    }
    forwardSeen.add(cursor)
    const rows = (await executor.execute(sql`
      SELECT id, superseded_by_id FROM compliance.memory_records WHERE id = ${cursor}
    `)) as { id: string; superseded_by_id: string | null }[]
    if (rows.length === 0) break // cursor not found (or RLS-filtered, for the tx case) -- stop, do not fabricate a row
    ids.push(rows[0].id)
    cursor = rows[0].superseded_by_id
  }
  return ids
}

/**
 * The as-of recall function (R68 Phase 1 item 3): given any memory_records
 * row id belonging to a lineage and an instant in time, returns whichever
 * row in that lineage was the CURRENT/valid one at that instant --
 * `effective_from <= asOf AND (effective_to IS NULL OR effective_to > asOf)`
 * -- or null if the id doesn't exist (under RLS) or no row in the lineage
 * was effective at that instant (e.g. asOf predates the lineage's root
 * effective_from).
 *
 * Implemented as a TypeScript function over `tx` (real RLS, same as every
 * other read in this file), not a SQL function in the compliance schema --
 * this file's own established convention for memory_records reads is raw
 * sql``/tx.execute() wrapped in a named TS function (searchMemories(),
 * fetchOwnOrgMemoryRecordOrThrow()), never a stored SQL function; see
 * drizzle/0541's own header for this same reasoning.
 *
 * `id` may be ANY row in the lineage, not just its current head or its
 * original root -- callers naturally have "a" memory_records id (e.g. from
 * a prior search or a UI reference), not necessarily the newest or oldest
 * one, and the lineage walk above resolves whichever id is passed back to
 * the full chain either way.
 */
export async function getMemoryRecordAsOf(tx: TenantDb, id: string, asOf: Date): Promise<MemoryRecord | null> {
  const lineageIds = await walkMemoryLineageIds(tx as unknown as MemoryLineageExecutor, id)
  if (lineageIds.length === 0) return null

  const rows = (await tx.execute(sql`
    SELECT * FROM compliance.memory_records
    WHERE id = ANY(${lineageIds}::text[])
      AND effective_from <= ${asOf}
      AND (effective_to IS NULL OR effective_to > ${asOf})
    LIMIT 1
  `)) as RawMemoryRecordRow[]

  return rows[0] ? mapMemoryRecordRow(rows[0]) : null
}

// ─── redactMemoryRecordLineage (R68 Phase 1 item 5: erasure-as-redaction) ─

export type RedactMemoryLineageChangedBy = {
  type: ChangedByType
  id?: string | null
  reason?: string | null
}

export type RedactMemoryLineageResult = {
  recordsRedacted: number
  versionsRedacted: number
}

const MEMORY_REDACTION_PLACEHOLDER = "[REDACTED — content erased per right-to-erasure request]"
const MEMORY_REDACTION_CONTENT_HASH = createHash("sha256").update(MEMORY_REDACTION_PLACEHOLDER).digest("hex")

/**
 * Right-to-erasure redaction across an ENTIRE memory lineage (R68 Phase 1
 * item 5, R-IMG-05's explicit additional obligation for the Institutional
 * Memory Graph specifically): because compliance.memory_records/
 * memory_versions are append-only, an erasure request must redact content
 * on EVERY historical row -- every superseded compliance.memory_records
 * row in the lineage (walked via walkMemoryLineageIds(), both directions)
 * AND every compliance.memory_versions snapshot recorded for any of them
 * -- never just close the CURRENT row via effective_to. Closing a row
 * would leave the personal data fully intact in every already-superseded
 * memory_records row and every memory_versions snapshot, defeating the
 * erasure while appearing to satisfy it.
 *
 * Does not delete any row (doc_uid-style permanence, not GDPR/DPDP-style
 * hard delete) -- every matched row keeps its id/scope/timestamps/version
 * lineage intact, only `content`/`content_snapshot` and their matching
 * `content_hash` are replaced with a fixed redaction placeholder. This is
 * this codebase's own nearest existing precedent for a right-to-erasure
 * write: compliance.source_object's CRR-226 tombstone design (content
 * nulled, doc_uid/row survive -- content_erased_at/erased_by_id/
 * erasure_authority, see docs/CRR_SCHEMA.md) applied to memory_records'
 * own shape (which has no separate tombstone-timestamp columns of its own
 * -- the redaction is instead recorded into `metadata.erasure`, this
 * table's own existing append-only-respecting audit-trail slot, the same
 * one appendLifecycleHistory() above already uses for lifecycle changes).
 *
 * Disclosed gap against the originating directive: the directive describes
 * this as wiring into "CRR-201's existing erasure cascade" for that
 * function to call. No such function exists anywhere in this codebase --
 * searched for "CRR-201", "erasure cascade", "P10-DPDP", "eraseSubject"/
 * "runErasure"/"performErasure" and every plausible variant; the only real
 * erasure-shaped code in the whole repo is CRR-226's own tombstone COLUMNS
 * (source_object/document_chunk) plus recall.ts's read-time exclusion of
 * already-erased chunks -- there is no dispatcher/cascade function today
 * that this function could extend without forking a parallel structure
 * this codebase doesn't already have. This function is therefore written
 * standalone, following CRR-226's own tombstone-not-delete shape exactly, ready for a
 * future erasure-cascade dispatcher (whenever one is built) to call rather
 * than reimplementing memory_records-specific redaction itself -- see this
 * PR's own description for the same disclosure.
 *
 * Runs on the bypass-RLS `db` connection (src/lib/db/index.ts, the
 * `postgres` table-owner role), NOT the caller's own `tx` -- required
 * because drizzle/0541's append-only guard trigger blocks app_runtime from
 * ever changing `content`/`content_hash` on an existing memory_records row
 * (exactly the columns this function must rewrite), and because
 * memory_versions has no UPDATE grant to app_runtime at all (R65 Part C
 * Phase 1's own RLS: SELECT+INSERT only). Same "two connections, two
 * privilege levels, one narrow documented exception" shape embedAndMirror()
 * already established in this file for a different column, for the same
 * underlying reason -- app_runtime's own RLS/trigger surface was never
 * designed to permit this specific write, by design, and this function is
 * the one sanctioned channel around that for a genuine erasure request.
 *
 * `expectedOrgId`, when supplied, is a defense-in-depth check (this
 * function does not run inside a tenant `tx`, so it cannot lean on RLS the
 * way every other write in this file does): every row in the resolved
 * lineage must belong to that org, or this throws without writing
 * anything, rather than silently redacting a lineage that turned out to
 * belong to someone else's tenant.
 *
 * Throws if `id` cannot be found (no RLS involved on this bypass
 * connection -- "not found" here means the row genuinely does not exist).
 */
export async function redactMemoryRecordLineage(
  id: string,
  redactedBy: RedactMemoryLineageChangedBy,
  expectedOrgId?: string | null
): Promise<RedactMemoryLineageResult> {
  const lineageIds = await walkMemoryLineageIds(db as unknown as MemoryLineageExecutor, id)
  if (lineageIds.length === 0) {
    throw new Error(`redactMemoryRecordLineage: memory_records row ${id} not found`)
  }

  if (expectedOrgId) {
    const orgRows = (await db.execute(sql`
      SELECT DISTINCT org_id FROM compliance.memory_records WHERE id = ANY(${lineageIds}::text[])
    `)) as { org_id: string | null }[]
    const foreignOrgRow = orgRows.find((r) => r.org_id !== expectedOrgId)
    if (foreignOrgRow) {
      throw new Error(
        `redactMemoryRecordLineage: lineage rooted at ${id} contains a row with org_id ${foreignOrgRow.org_id}, not the expected ${expectedOrgId} -- refusing to redact`
      )
    }
  }

  const erasureEntryJson = JSON.stringify({
    erasedAt: new Date().toISOString(),
    erasedByType: redactedBy.type,
    erasedById: redactedBy.id ?? null,
    erasureReason: redactedBy.reason ?? null,
  })

  const updatedRecords = (await db.execute(sql`
    UPDATE compliance.memory_records
    SET content = ${MEMORY_REDACTION_PLACEHOLDER},
        content_hash = ${MEMORY_REDACTION_CONTENT_HASH},
        metadata = metadata || jsonb_build_object('erasure', ${erasureEntryJson}::jsonb),
        updated_at = now()
    WHERE id = ANY(${lineageIds}::text[])
    RETURNING id
  `)) as { id: string }[]

  const updatedVersions = (await db.execute(sql`
    UPDATE compliance.memory_versions
    SET content_snapshot = ${MEMORY_REDACTION_PLACEHOLDER},
        content_hash = ${MEMORY_REDACTION_CONTENT_HASH}
    WHERE memory_record_id = ANY(${lineageIds}::text[])
    RETURNING id
  `)) as { id: string }[]

  return { recordsRedacted: updatedRecords.length, versionsRedacted: updatedVersions.length }
}
