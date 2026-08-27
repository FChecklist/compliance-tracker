// Wave 43 (VERIDIAN Capability Registry, PLATFORM_STRATEGY.md §24). A thin,
// typed wrapper over the already-existing, entity-agnostic embeddings.ts
// (built for compliance-item semantic search, nothing about it is
// compliance-specific) -- no new table. Scoped to the entity types that
// actually matter for duplication-prevention: worker agents, automation
// rules, modules, prompt patterns, and (Wave 173, GAP-DYNAMIC-CHAIN-DEDUP)
// dynamic chains. This is what VERI FDE (Wave 42) now checks before
// ever calling an LLM, closing the "don't re-derive the same context on
// every request" gap found by reading its own code one wave later.
import { storeEmbedding, findSimilar, deleteEmbedding } from "@/lib/embeddings"
import { db, embeddings } from "@/lib/db"
import { or, eq, isNull, and, inArray } from "drizzle-orm"

// Wave 173 (GAP-DYNAMIC-CHAIN-DEDUP): dynamic_chain added as a 5th type,
// following the exact same pattern the other 4 already use -- indexed at
// creation time (task-service.ts's resolveDynamicChainId), backfillable
// (capability-backfill-service.ts), and covered by findSimilarCapabilities()/
// auditDuplicateCapabilities() below with zero code changes to either
// function (both are already generic over CAPABILITY_ENTITY_TYPES).
// VERIDIAN_Architecture_v2.0 phase_2 (2026-07-25, engine-prompt-similarity):
// `prompt_version` added as a 6th type, same pattern as Wave 173's
// dynamic_chain addition -- indexed at compile time
// (prompt-compiler/prompt-similarity.ts's indexCompiledPromptVersion, called
// from prompt-construction.ts's build path), and covered by
// findSimilarCapabilities()/auditDuplicateCapabilities() with zero code
// change to either (both are already generic over CAPABILITY_ENTITY_TYPES).
// Distinct from the pre-existing `prompt_pattern` type above (that one
// backs the separate, still-unwired "Prompt Directory" UI concept) --
// `prompt_version` indexes real compliance.prompt_versions rows by their
// compiled machine_prompt content, giving VERIDIAN_Architecture_v2.0's
// prompt-compiler pipeline real duplicate-detection/clustering via this
// same entity-agnostic embeddings store, per the gap analysis' own
// explicit reuse note (do not build a parallel embedding store for prompts).
export const CAPABILITY_ENTITY_TYPES = ["worker_agent", "automation_rule", "module", "prompt_pattern", "dynamic_chain", "prompt_version"] as const
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
  orgId: string
): Promise<void> {
  // CRR-018: orgId is mandatory on storeEmbedding now -- callers that mean
  // "platform-wide" (module, dynamic_chain rows with no tenant) must pass
  // PLATFORM_SCOPE_ORG_ID explicitly instead of null/undefined.
  await storeEmbedding(entityType, entityId, content, orgId)
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
// CRR-018: orgId tightened to required -- this function has zero callers
// today (grepped, 2026-08-25), so this is a pure type fix, no behavior change.
export async function indexPromptPattern(entityId: string, content: string, orgId: string): Promise<void> {
  await storeEmbedding("prompt_pattern", entityId, content, orgId)
}

// VERIDIAN_Architecture_v2.0 phase_2 (engine-prompt-similarity): mirrors
// findSimilarPromptPatterns()/indexPromptPattern() above but scoped to the
// `prompt_version` entity type -- see CAPABILITY_ENTITY_TYPES' own comment
// for why this is a distinct type from `prompt_pattern`. `content` should
// be the compiled machine_prompt (prompt-construction.ts's
// buildCompiledPrompt().machinePrompt), not the raw uncompiled template
// text, so similarity is computed over what the compiler actually produces.
export async function findSimilarPromptVersions(query: string, orgId: string, limit = 5): Promise<CapabilityMatch[]> {
  const results = await findSimilar(query, orgId, limit * 3)
  return results
    .filter((r): r is CapabilityMatch => r.entityType === "prompt_version" && r.score > RELEVANCE_THRESHOLD)
    .slice(0, limit)
}

// CRR-018: orgId tightened to required -- its one call chain
// (persist-compiled-prompt.ts -> indexCompiledPromptVersion -> here) already
// carries a required `orgId: string` end to end, so this is a pure type fix.
export async function indexPromptVersion(promptVersionId: string, machinePrompt: string, orgId: string): Promise<void> {
  await storeEmbedding("prompt_version", promptVersionId, machinePrompt, orgId)
}

// DMP-06 gap closure (CONSTITUTION.yaml, "Dynamic Chain Master Directory"):
// mirrors findSimilarPromptPatterns() above -- scoped to the single
// 'dynamic_chain' entity type instead of all capability types, so
// dynamic-chain-directory-service.ts's proposeDynamicChain() can check for
// a near-duplicate chain before ever creating a new one, the same way VERI
// FDE already checks findSimilarCapabilities() before proposing a new
// worker agent. Same over-fetch-then-filter-then-slice shape as its
// sibling, and the same RELEVANCE_THRESHOLD floor.
export async function findSimilarDynamicChains(orgId: string, description: string, domain?: string | null, limit = 5): Promise<CapabilityMatch[]> {
  const query = [domain, description].filter((v): v is string => Boolean(v?.trim())).join(" | ")
  if (!query.trim()) return []
  const results = await findSimilar(query, orgId, limit * 3)
  return results
    .filter((r): r is CapabilityMatch => r.entityType === "dynamic_chain" && r.score > RELEVANCE_THRESHOLD)
    .slice(0, limit)
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
