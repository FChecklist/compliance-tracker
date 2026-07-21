// ARTICLE-050 (ai-os/RULES_ARTICLES_198.json): "Operational memory shall
// be separated from long-term knowledge." audit198 (2026-07-21) found
// this NOT_YET_BUILT -- zero keyword/phrase/CONSTITUTION.yaml signal --
// even though the separation already exists ARCHITECTURALLY in
// schema.ts (assistant_memories/task_capabilities/instruction_packages/
// platform_assets vs messages/conversations/activity_log/
// assistant_sessions): it was simply never DECLARED anywhere as an
// explicit, checkable contract, so nothing (including this audit) could
// confirm it mechanically.
//
// Per AI_ENGINEERING_POLICY.yaml's own always_prefer list ("metadata
// over hardcoding", "declarative_design over imperative_design"), the
// right-sized fix is NOT a new storage layer -- it is making the
// existing separation explicit, versioned metadata that both humans and
// future audits can check against, rather than tribal knowledge encoded
// only in scattered file-header comments.
//
// Two tiers:
//  - OPERATIONAL: transient/session-scoped state describing what IS
//    happening right now or just happened (a conversation turn, an
//    activity-log line, a running assistant session's live counters).
//    Rows are appended or mutated in place; nothing here carries
//    supersession/versioning semantics.
//  - LONG_TERM_KNOWLEDGE: durable, reusable, versioned facts and
//    capabilities the system has LEARNED and keeps using across
//    sessions (assistant semantic memory, task-capability classification
//    history, approved instruction packages, the platform-wide Universal
//    Metadata Registry). Every row here carries a real lifecycle field
//    (validFrom/validUntil temporal versioning, a version counter, or an
//    approved/status field) -- a structural difference from the
//    OPERATIONAL tier, not just a naming convention.
export type MemoryTier = "OPERATIONAL" | "LONG_TERM_KNOWLEDGE"

export type MemoryTierEntry = {
  /** Exact schema.ts table name (drizzle `.table(...)` first argument). */
  table: string
  tier: MemoryTier
  /** Service module that owns reads/writes to this table. */
  service: string
  /** Why this table belongs in this tier -- cites the real lifecycle field that makes the distinction structural, not cosmetic. */
  reason: string
}

export const MEMORY_TIER_REGISTRY: MemoryTierEntry[] = [
  // ---- OPERATIONAL: transient/session-scoped -----------------------------
  {
    table: "messages",
    tier: "OPERATIONAL",
    service: "conversation-service",
    reason: "Raw turn-by-turn chat log -- appended, never superseded or re-versioned.",
  },
  {
    table: "conversations",
    tier: "OPERATIONAL",
    service: "conversation-service",
    reason: "Session container with no lifecycle beyond open/closed; not a knowledge artifact itself.",
  },
  {
    table: "activity_log",
    tier: "OPERATIONAL",
    service: "activity-log-service",
    reason: "Append-only event stream (recordActivity()) -- immutable audit history, not reusable knowledge to act on later.",
  },
  {
    table: "assistant_sessions",
    tier: "OPERATIONAL",
    service: "assistant-service",
    reason: "Per-session runtime counters (taskCount, startedAt/endedAt) with no cross-session reuse.",
  },
  // ---- LONG_TERM_KNOWLEDGE: durable, versioned, reused across sessions ---
  {
    table: "assistant_memories",
    tier: "LONG_TERM_KNOWLEDGE",
    service: "assistant-memory-service",
    reason: "pgvector-backed semantic memory with validFrom/validUntil temporal-versioning (supersededByMemoryId) and is explicitly read back into future LLM calls (searchAssistantMemories()).",
  },
  {
    table: "task_capabilities",
    tier: "LONG_TERM_KNOWLEDGE",
    service: "capability-learning-service",
    reason: "Versioned (version, lastAuditedVersion), cross-session rolling classification history -- the substrate ARTICLE-052's structured-knowledge conversion (capability-audit-service.ts's closeImprovementLoop()) reads from and bumps.",
  },
  {
    table: "instruction_packages",
    tier: "LONG_TERM_KNOWLEDGE",
    service: "capability-learning-service",
    reason: "Approved (status/version/successRate), reusable AI-designed solutions -- ARTICLE-052's literal structured-knowledge conversion target: once approved, replaces a repeated LLM call with a deterministic replay (findApprovedPackage()).",
  },
  {
    table: "platform_assets",
    tier: "LONG_TERM_KNOWLEDGE",
    service: "asset-registry-service / capability-audit-service",
    reason: "Universal Metadata Registry -- closeImprovementLoop() promotes a closed capability here (registerClosedCapabilityAsUmrAsset()) so it stays discoverable platform-wide, permanently, independent of the session that produced it.",
  },
]

/** Returns the declared tier for a schema.ts table name, or null if the table is not yet classified in this registry. */
export function classifyMemoryTier(table: string): MemoryTier | null {
  return MEMORY_TIER_REGISTRY.find((e) => e.table === table)?.tier ?? null
}

/** All table names declared for one tier -- e.g. for a lint rule or a future audit that wants to enumerate "every long-term-knowledge table" without re-deriving the list by hand. */
export function tablesForTier(tier: MemoryTier): string[] {
  return MEMORY_TIER_REGISTRY.filter((e) => e.tier === tier).map((e) => e.table)
}
