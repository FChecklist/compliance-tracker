// Audit198 gap closure, 2026-07-21 (CACHING category -- RULE-076, RULE-077,
// ARTICLE-051, ARTICLE-053, ARTICLE-054, ARTICLE-055): a single,
// hand-verifiable place documenting WHICH cache layers exist in this
// codebase, their TTL/invalidation POLICY (not just each file's own ad hoc
// comment), and a lightweight structured hit/miss/invalidation event log +
// in-memory counters -- so "every cache layer shall be monitored, audited,
// measured, invalidated when required, and optimized continuously by
// software" (RULE-077) and "every cache hit and cache miss shall be
// logged" (ARTICLE-055) have one real, citable, software-only mechanism
// (zero AI involvement, per RULE-077's own text) instead of being
// scattered/implicit per file.
//
// Deliberately NOT a new cache store or a new persistence layer -- this
// module only (a) registers policy metadata about caches that already
// exist elsewhere in this codebase, and (b) records/logs events the
// existing caches already generate. CACHE_REGISTRY below is kept honest:
// a cache with no explicit invalidation hook yet is marked as such, not
// glossed over (see instruction-execution-cache's `notes`).
//
// The six cache types RULE-076 names, each with a real file behind it:
//   Browser cache    -> src/lib/browser-intent-cache.ts (client IndexedDB)
//   Application cache -> src/lib/services/instruction-execution-cache-service.ts
//   Server cache     -> src/lib/llm-response-cache.ts (DB-backed, per-org)
//   Metadata cache   -> src/lib/services/asset-registry-cache.ts
//   Workflow cache   -> src/lib/services/instruction-execution-cache-service.ts
//   AI provider cache -> src/lib/prompt-cache/* (Anthropic cache_control,
//                        see ai-os/CONSTITUTION.yaml CACHE-01..CACHE-04)

export type CacheScope = "per_org" | "per_process" | "client_browser" | "provider_managed"
export type CacheInvalidationMode = "explicit_function" | "ttl_expiry_only" | "provider_managed"

export type CacheGovernanceEntry = {
  name: string
  ruleType: "browser" | "application" | "server" | "metadata" | "workflow" | "ai_provider"
  file: string
  scope: CacheScope
  ttlMs: number | null
  invalidation: CacheInvalidationMode
  invalidationFn?: string
  owner: string
  eventLogged: boolean
  notes?: string
}

/**
 * Hand-verified inventory (2026-07-21, read directly against the real
 * files cited below before this list was written). Update this list in the
 * SAME PR as any change to a cache file's TTL/invalidation behavior --
 * mirrors ai-os/CONSTITUTION.yaml's own amendment_rule discipline.
 */
export const CACHE_REGISTRY: CacheGovernanceEntry[] = [
  {
    name: "llm-response-cache",
    ruleType: "server",
    file: "src/lib/llm-response-cache.ts",
    scope: "per_org",
    ttlMs: 24 * 60 * 60 * 1000,
    invalidation: "explicit_function",
    invalidationFn: "invalidateLlmResponseCache / invalidateAllLlmResponseCache / purgeExpiredLlmResponseCache",
    owner: "AI Platform",
    eventLogged: true,
    notes: "Opt-in per call site (callLLMCached/callLLMJsonCached) -- wired at src/app/api/ai/orchestrate/route.ts and src/lib/services/fde-service.ts as of this pass, not automatic at every AI invocation site in the codebase. See RULE-076/ARTICLE-053 gap note in CONSTITUTION.yaml CACHE-08.",
  },
  {
    name: "asset-registry-cache",
    ruleType: "metadata",
    file: "src/lib/services/asset-registry-cache.ts",
    scope: "per_process",
    ttlMs: 60_000,
    invalidation: "explicit_function",
    invalidationFn: "invalidateOrgCache / invalidateAllCaches",
    owner: "Platform Asset Registry",
    eventLogged: true,
  },
  {
    name: "instruction-execution-cache",
    ruleType: "workflow",
    file: "src/lib/services/instruction-execution-cache-service.ts",
    scope: "per_org",
    ttlMs: null,
    invalidation: "ttl_expiry_only",
    owner: "AI Orchestration (VERI FDE)",
    eventLogged: true,
    notes: "No explicit invalidation function exists (rows persist until manually pruned) -- recorded here honestly as an open item, not claimed otherwise. success_count/last_used_at give staleness signal but nothing auto-expires or auto-invalidates a stale mapping today.",
  },
  {
    name: "browser-intent-cache",
    ruleType: "browser",
    file: "src/lib/browser-intent-cache.ts",
    scope: "client_browser",
    ttlMs: null,
    invalidation: "explicit_function",
    invalidationFn: "deleteIntent / clearAllIntents / runExpirationSweep",
    owner: "AI Platform (VeriComposer / Intent Command Palette)",
    eventLogged: false,
    notes: "Client-side IndexedDB, runs in the browser process -- this module's counters (below) are server-process-scoped and cannot observe client-side hit/miss events. Recorded here for registry completeness, not claimed as event-logged.",
  },
  {
    name: "anthropic-prompt-cache",
    ruleType: "ai_provider",
    file: "src/lib/prompt-cache/compiler.ts, fingerprint.ts, metrics.ts",
    scope: "provider_managed",
    ttlMs: 5 * 60 * 1000,
    invalidation: "provider_managed",
    owner: "AI Platform",
    eventLogged: true,
    notes: "Metrics only (prompt_cache_metrics table) -- the actual cached content lives on Anthropic's own infrastructure, never stored by VERIDIAN. See ai-os/CONSTITUTION.yaml CACHE-01..CACHE-04 for the existing ENFORCED mechanism this registry cross-references rather than duplicates.",
  },
]

export function getCacheGovernanceRegistry(): CacheGovernanceEntry[] {
  return CACHE_REGISTRY
}

// ---------------------------------------------------------------------
// Structured hit/miss/invalidation event log + in-memory counters
// ---------------------------------------------------------------------

export type CacheEventOutcome = "hit" | "miss" | "invalidate" | "expire" | "write"

export type CacheEventCounters = {
  hits: number
  misses: number
  invalidations: number
  expires: number
  writes: number
}

const EMPTY_COUNTERS: CacheEventCounters = { hits: 0, misses: 0, invalidations: 0, expires: 0, writes: 0 }

// Process-level counters, same "survives across requests on a warm
// serverless instance, not a redistributed store" honesty already
// documented in asset-registry-cache.ts's own header -- this is
// observability, not a source of truth.
const counters = new Map<string, CacheEventCounters>()

function bump(cacheName: string, outcome: CacheEventOutcome): CacheEventCounters {
  const c = { ...(counters.get(cacheName) ?? EMPTY_COUNTERS) }
  if (outcome === "hit") c.hits++
  else if (outcome === "miss") c.misses++
  else if (outcome === "invalidate") c.invalidations++
  else if (outcome === "expire") c.expires++
  else if (outcome === "write") c.writes++
  counters.set(cacheName, c)
  return c
}

/**
 * The single, reusable per-cache-event logging function every cache layer
 * in CACHE_REGISTRY (marked eventLogged: true) calls on a real hit, miss,
 * invalidation, expiry, or write. Structured single-line JSON, machine-
 * parseable by any log aggregator -- consistent with this codebase's
 * existing src/instrumentation.ts pattern. Never throws (a logging
 * failure must never break the caller's real cache operation).
 */
export function logCacheEvent(cacheName: string, outcome: CacheEventOutcome, meta?: Record<string, unknown>): void {
  try {
    bump(cacheName, outcome)
    console.log(JSON.stringify({ type: "cache_event", cache: cacheName, outcome, ts: new Date().toISOString(), ...meta }))
  } catch {
    // logging must never break the real cache operation it is observing
  }
}

/** Observability -- the concrete evidence hit/miss logging is real, not just a claim, surfaced via GET /api/ai/cache/governance (veridian_admin-gated). */
export function getCacheEventStats(): Record<string, CacheEventCounters> {
  return Object.fromEntries(counters.entries())
}
