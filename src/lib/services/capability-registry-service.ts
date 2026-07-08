// Wave 43 (VERIDIAN Capability Registry, PLATFORM_STRATEGY.md §24). A thin,
// typed wrapper over the already-existing, entity-agnostic embeddings.ts
// (built for compliance-item semantic search, nothing about it is
// compliance-specific) -- no new table. Scoped to the 3 entity types that
// actually matter for duplication-prevention: worker agents, automation
// rules, and modules. This is what VERI FDE (Wave 42) now checks before
// ever calling an LLM, closing the "don't re-derive the same context on
// every request" gap found by reading its own code one wave later.
import { storeEmbedding, findSimilar, deleteEmbedding } from "@/lib/embeddings"
import { db, embeddings } from "@/lib/db"
import { or, eq, isNull, and, inArray } from "drizzle-orm"

export const CAPABILITY_ENTITY_TYPES = ["worker_agent", "automation_rule", "module", "prompt_pattern"] as const
export type CapabilityEntityType = (typeof CAPABILITY_ENTITY_TYPES)[number]

function isCapabilityEntityType(value: string): value is CapabilityEntityType {
  return (CAPABILITY_ENTITY_TYPES as readonly string[]).includes(value)
}

// Formats a capability's full contract -- name/domain/description AND its
// input/output schema -- into one embeddable string, so the vector
// captures the contract, not just the prose description. This is why
// findSimilarCapabilities() can surface a real match even when the
// requester's wording differs from the capability's own description, as
// long as the underlying input/output shape overlaps.
export function buildCapabilityContent(fields: {
  name: string
  domain?: string | null
  description?: string | null
  inputSchema?: unknown
  outputSchema?: unknown
}): string {
  const parts = [fields.name, fields.domain || null, fields.description || null]
  if (fields.inputSchema && Object.keys(fields.inputSchema as object).length > 0) {
    parts.push(`Input: ${JSON.stringify(fields.inputSchema)}`)
  }
  if (fields.outputSchema && Object.keys(fields.outputSchema as object).length > 0) {
    parts.push(`Output: ${JSON.stringify(fields.outputSchema)}`)
  }
  return parts.filter(Boolean).join(" | ")
}

export async function indexCapability(
  entityType: CapabilityEntityType,
  entityId: string,
  content: string,
  orgId?: string | null
): Promise<void> {
  await storeEmbedding(entityType, entityId, content, orgId ?? undefined)
}

export async function removeCapabilityIndex(entityType: CapabilityEntityType, entityId: string): Promise<void> {
  await deleteEmbedding(entityType, entityId)
}

export type CapabilityMatch = { entityType: CapabilityEntityType; entityId: string; score: number; content: string }

// Gap closure, 2026-07-09 (AUDIT_2026-07-09.md): mirrors
// assistant-memory-service.ts's RELEVANCE_THRESHOLD. Without a floor, both
// functions below always return `limit` rows even when nothing in the
// index is actually related to the query (pgvector's <=> just returns the
// *closest* rows, not necessarily *close* ones) -- silently feeding VERI
// FDE's duplicate-check and the Prompt Directory's "similar patterns"
// surface a low-relevance match dressed up as a real one.
const RELEVANCE_THRESHOLD = 0.5

// Over-fetches from findSimilar() since it isn't type-filtered, then keeps
// only the 3 capability entity types and the requested limit.
export async function findSimilarCapabilities(query: string, orgId: string, limit = 10): Promise<CapabilityMatch[]> {
  const results = await findSimilar(query, orgId, limit * 3)
  return results
    .filter((r): r is CapabilityMatch => isCapabilityEntityType(r.entityType) && r.score > RELEVANCE_THRESHOLD)
    .slice(0, limit)
}

// Phase 2 of the Prompt Directory (backend only). Mirrors
// findSimilarCapabilities() but is scoped to the single 'prompt_pattern'
// entity type instead of all capability types, so the Prompt Directory can
// surface semantically similar existing patterns before a new one is
// authored. Same over-fetch-then-filter-then-slice shape as its sibling.
export async function findSimilarPromptPatterns(query: string, orgId: string, limit = 5): Promise<CapabilityMatch[]> {
  const results = await findSimilar(query, orgId, limit * 3)
  return results
    .filter((r): r is CapabilityMatch => r.entityType === "prompt_pattern" && r.score > RELEVANCE_THRESHOLD)
    .slice(0, limit)
}

// Phase 2 of the Prompt Directory (backend only). Mirrors indexCapability()
// but is hardcoded to the 'prompt_pattern' entity type, so prompt patterns
// flow into the same entity-agnostic embeddings backing store used by the
// rest of the Capability Registry -- no new table, no migration.
export async function indexPromptPattern(entityId: string, content: string, orgId?: string | null): Promise<void> {
  await storeEmbedding("prompt_pattern", entityId, content, orgId ?? undefined)
}

export type DuplicateCandidate = { a: CapabilityMatch; b: CapabilityMatch; score: number }

// On-demand audit, not a background job -- each row costs one real
// embedding-similarity search, so this is deliberately something an admin
// triggers (see /capability-registry page), not something that runs
// automatically and burns API calls unattended.
export async function auditDuplicateCapabilities(orgId: string, threshold = 0.92): Promise<DuplicateCandidate[]> {
  const rows = await db.query.embeddings.findMany({
    where: and(
      inArray(embeddings.entityType, [...CAPABILITY_ENTITY_TYPES]),
      or(eq(embeddings.orgId, orgId), isNull(embeddings.orgId))
    ),
  })

  const seen = new Set<string>()
  const duplicates: DuplicateCandidate[] = []

  for (const row of rows) {
    if (!row.content) continue
    const matches = await findSimilarCapabilities(row.content, orgId, 3)
    for (const match of matches) {
      if (match.entityId === row.entityId) continue
      const pairKey = [row.entityId, match.entityId].sort().join("::")
      if (seen.has(pairKey)) continue
      if (match.score >= threshold) {
        seen.add(pairKey)
        duplicates.push({
          a: { entityType: row.entityType as CapabilityEntityType, entityId: row.entityId, score: 1, content: row.content },
          b: match,
          score: match.score,
        })
      }
    }
  }

  return duplicates
}
