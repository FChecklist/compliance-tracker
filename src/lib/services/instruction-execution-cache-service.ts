// UMR-03 gap closure (ai-os/CONSTITUTION.yaml, learning_and_umr): "every
// chat instruction (DMP+DCS+chat) is stored word-wise in the Universal
// Metadata Registry so a similar future instruction can be answered from
// what was already learned, not re-derived from scratch." The two real
// analogs this codebase already had -- embeddings.ts's embedding_cache
// (caches embedding VECTORS for exact-text reuse, not instruction->outcome
// mappings) and capability-registry-service.ts's findSimilarCapabilities()
// (matches a CAPABILITY's own description against a query, not "this exact
// instruction was already resolved to that capability once") -- both stop
// short of this. This file is that missing mapping: instruction text ->
// the capability/dynamic-chain it was previously resolved to, so a
// similarly-worded future instruction can reuse that resolution instead of
// running the embedding-over-capabilities search (and, below high
// confidence, a full LLM call) again from scratch.
//
// Same raw-SQL sql`` + db.execute() pgvector pattern assistant-memory-
// service.ts uses (Wave 77) -- RLS-respecting via the caller's own
// withTenantContext transaction, not a second bypass connection like
// embeddings.ts's older getRawClient() (that pattern predates tenant-
// scoped.ts and is deliberately not repeated here). Reuses
// generateEmbedding() from embeddings.ts rather than reimplementing
// embedding generation -- and since that function already has its own
// exact-text embedding_cache, re-embedding the same requestText that
// findSimilarCapabilities() just embedded moments earlier in the same
// request costs nothing extra.
import type { TenantDb } from "@/lib/db/tenant-scoped"
import { sql } from "drizzle-orm"
import { createHash } from "crypto"
import { generateEmbedding } from "@/lib/embeddings"
import type { CapabilityEntityType } from "./capability-registry-service"

// Same bar fde-service.ts's HIGH_CONFIDENCE_THRESHOLD uses for its own
// no-LLM-reasoning gate -- reused rather than introducing a second,
// independently-tuned number for what is functionally the same "confident
// enough to skip reasoning entirely" decision (Owner explicitly raised that
// one to 0.95 on 2026-07-10 -- see fde-service.ts's own comment).
const MATCH_THRESHOLD = 0.95

// Pure predicate (unit tested) -- kept separate from the DB round-trip in
// findPriorExecutionPath() so the actual confidence decision isn't only
// exercisable against a live database.
export function isHighConfidenceExecutionMatch(score: number): boolean {
  return score >= MATCH_THRESHOLD
}

export type ExecutionPathMatch = {
  resolvedCapabilityType: CapabilityEntityType
  resolvedCapabilityId: string
  resolvedLabel: string | null
  resolvedParamsShape: Record<string, unknown> | null
  score: number
}

type RawMatchRow = {
  id: string
  resolved_capability_type: string
  resolved_capability_id: string
  resolved_label: string | null
  resolved_params_shape: Record<string, unknown> | null
  score: number
}

/**
 * Embeds `instructionText` and looks for a previously-resolved instruction
 * close enough (cosine similarity >= MATCH_THRESHOLD) to reuse its
 * execution path instead of re-deriving one. Returns null on no match --
 * never throws (a cache miss/failure should always fall through to the
 * caller's normal resolution path, not break it).
 */
export async function findPriorExecutionPath(
  db: TenantDb,
  orgId: string,
  instructionText: string
): Promise<ExecutionPathMatch | null> {
  const trimmed = instructionText.trim()
  if (!trimmed) return null

  const queryVector = await generateEmbedding(trimmed)
  const vectorStr = `[${queryVector.join(",")}]`

  const rows = (await db.execute(sql`
    SELECT id, resolved_capability_type, resolved_capability_id, resolved_label, resolved_params_shape,
           1 - (embedding <=> ${vectorStr}::vector) as score
    FROM compliance.instruction_execution_cache
    WHERE (org_id = ${orgId} OR org_id IS NULL) AND resolved_capability_id IS NOT NULL
    ORDER BY embedding <=> ${vectorStr}::vector
    LIMIT 1
  `)) as RawMatchRow[]

  if (rows.length === 0) return null
  const row = rows[0]
  const score = Number(row.score)
  if (!isHighConfidenceExecutionMatch(score)) return null

  // Fire-and-forget usage bump -- same convention as embeddings.ts's
  // getCachedEmbedding(): freshness/count tracking must never block or fail
  // the caller's actual response.
  db.execute(sql`
    UPDATE compliance.instruction_execution_cache
    SET success_count = success_count + 1, last_used_at = NOW()
    WHERE id = ${row.id}
  `).catch(() => {})

  return {
    resolvedCapabilityType: row.resolved_capability_type as CapabilityEntityType,
    resolvedCapabilityId: row.resolved_capability_id,
    resolvedLabel: row.resolved_label,
    resolvedParamsShape: row.resolved_params_shape,
    score,
  }
}

/**
 * Persists an instruction -> resolved-execution-path mapping so a future,
 * similarly-worded instruction can be answered via findPriorExecutionPath()
 * instead of re-running the full resolution. Repeat-identical instruction
 * text (same org, same content hash, same resolved capability) bumps the
 * existing row's success_count rather than inserting a duplicate.
 */
export async function recordExecutionPath(
  db: TenantDb,
  orgId: string,
  instructionText: string,
  resolved: {
    capabilityType: CapabilityEntityType
    capabilityId: string
    label?: string | null
    paramsShape?: Record<string, unknown> | null
  }
): Promise<void> {
  const trimmed = instructionText.trim()
  if (!trimmed) return

  const contentHash = createHash("sha256").update(trimmed).digest("hex")

  const existing = (await db.execute(sql`
    SELECT id FROM compliance.instruction_execution_cache
    WHERE org_id = ${orgId} AND content_hash = ${contentHash} AND resolved_capability_id = ${resolved.capabilityId}
  `)) as { id: string }[]

  if (existing.length > 0) {
    await db.execute(sql`
      UPDATE compliance.instruction_execution_cache
      SET success_count = success_count + 1, last_used_at = NOW()
      WHERE id = ${existing[0].id}
    `)
    return
  }

  const vector = await generateEmbedding(trimmed)
  const vectorStr = `[${vector.join(",")}]`
  const paramsShapeJson = resolved.paramsShape ? JSON.stringify(resolved.paramsShape) : null

  await db.execute(sql`
    INSERT INTO compliance.instruction_execution_cache
      (id, org_id, instruction_text, content_hash, resolved_capability_type, resolved_capability_id, resolved_label, resolved_params_shape, embedding, success_count, last_used_at, created_at)
    VALUES (
      gen_random_uuid()::text, ${orgId}, ${trimmed}, ${contentHash},
      ${resolved.capabilityType}, ${resolved.capabilityId}, ${resolved.label ?? null},
      ${paramsShapeJson}::jsonb, ${vectorStr}::vector, 1, NOW(), NOW()
    )
  `)
}
