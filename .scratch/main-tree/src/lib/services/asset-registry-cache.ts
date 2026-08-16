// Priority 4 (09-priority4-umr-universal-tracker.yaml): the "compiled
// metadata cache" tier from the Owner's own reference architecture --
// "most requests never touch the database at all for metadata... resolved
// from memory, which is extremely fast."
//
// Deliberately in-process memory, NOT Redis. This codebase has no existing
// distributed cache or pub/sub (confirmed by grep: zero real redis/upstash
// hits, zero LISTEN/NOTIFY usage anywhere in src/) -- introducing Redis is
// a new paid infrastructure dependency and a real ops decision
// (provisioning, credentials, another moving part in production), the same
// class of decision DEC-09 already ruled Super Boss should not silently
// make. The Owner's own diagram lists "Application Memory Cache" ABOVE
// Redis and marks Redis "(optional)" -- this file builds the tier that is
// real, free, and immediately available; Redis stays a scoped, ready-to-
// add follow-on if traffic ever needs a cache shared across instances.
//
// Honest limitation, stated plainly rather than oversold: this cache is
// PER SERVERLESS INSTANCE, not global. Two concurrent Vercel function
// instances can each hold a slightly different cached view for up to
// CACHE_TTL_MS. That is an acceptable tradeoff at this system's real
// change velocity -- the Owner's own numbers put registry WRITES at
// roughly 20/day against ~790,000 reads/minute -- a bounded staleness
// window measured in tens of seconds is invisible at that ratio. A
// database trigger (compliance.auto_register_asset(), migration 0152)
// cannot call into this process's memory to invalidate it directly (no
// LISTEN/NOTIFY listener exists in a serverless function), so for
// trigger-driven writes, TTL expiry is the ONLY freshness mechanism --
// this file does not claim otherwise. For app-level writes
// (registerAsset()/updateAsset()/archiveAsset()), invalidateOrgCache() is
// called explicitly in the same process for immediate same-instance
// freshness, on a best-effort basis (a different warm instance handling
// the very next read still relies on TTL).
import { db, platformAssets } from "@/lib/db"
import { and, eq, isNull, or } from "drizzle-orm"

export type CachedAsset = typeof platformAssets.$inferSelect

// 60s: short enough that "5 new reports a day" scale metadata churn is
// never meaningfully stale to a human, long enough that a burst of
// concurrent requests (the Owner's own "thousands of simultaneous
// callers" scenario) shares one loaded set instead of each one re-querying
// Postgres.
export const CACHE_TTL_MS = 60_000

type CacheEntry = { loadedAt: number; assets: CachedAsset[] }

// A single process-level Map, not per-request state -- this is what makes
// it a real cache (survives across requests on a warm serverless
// instance) rather than a per-call optimization.
const orgCache = new Map<string, CacheEntry>()

// In-flight load promises, keyed the same as orgCache -- prevents the
// "thundering herd" case where N concurrent requests for the same
// (now-expired or never-loaded) org each independently fire the same
// Postgres query at once. The 2nd..Nth caller awaits the 1st caller's
// already-in-flight load instead of duplicating it.
const inFlightLoads = new Map<string, Promise<CachedAsset[]>>()

async function loadOrgAssets(orgId: string): Promise<CachedAsset[]> {
  // Only 'active' rows are cached -- draft/archived/deleted assets are a
  // rare lookup (moderation/audit screens, not the hot routing/search
  // path this cache exists to accelerate) and go straight to Postgres via
  // the existing indexed queries, uncached, deliberately.
  return db
    .select()
    .from(platformAssets)
    .where(and(or(eq(platformAssets.orgId, orgId), isNull(platformAssets.orgId)), eq(platformAssets.status, "active")))
}

function isFresh(entry: CacheEntry | undefined): entry is CacheEntry {
  return entry !== undefined && Date.now() - entry.loadedAt < CACHE_TTL_MS
}

// The one read entry point every cache-aware query function calls. Cache
// hit: synchronous-fast in-memory return. Cache miss or expired: loads
// once (deduplicated via inFlightLoads across concurrent callers), then
// serves from memory until the next expiry or explicit invalidation.
export async function getCachedOrgAssets(orgId: string): Promise<CachedAsset[]> {
  const existing = orgCache.get(orgId)
  if (isFresh(existing)) return existing.assets

  const inFlight = inFlightLoads.get(orgId)
  if (inFlight) return inFlight

  const loadPromise = loadOrgAssets(orgId)
    .then((assets) => {
      orgCache.set(orgId, { loadedAt: Date.now(), assets })
      return assets
    })
    .finally(() => {
      inFlightLoads.delete(orgId)
    })
  inFlightLoads.set(orgId, loadPromise)
  return loadPromise
}

// Called by registerAsset()/updateAsset()/archiveAsset() (app-level
// writes) right after a successful write, best-effort same-instance
// freshness. Safe to call even if orgId was never cached (no-op).
export function invalidateOrgCache(orgId: string | null | undefined): void {
  if (orgId === null || orgId === undefined) {
    // A platform-tier write (orgId IS NULL) is visible to every org's
    // cache entry (the OR isNull(orgId) clause in loadOrgAssets) -- there
    // is no single cache key that represents "just the platform tier," so
    // the only correct invalidation is clearing every entry. This is the
    // one case where a single write forces a full cache clear, and it is
    // intentional, not an oversight: platform-tier writes are the rarest
    // class of write in this system (worker_agents/computation_engines/
        // prompt_templates -- curated, not user-driven).
    orgCache.clear()
    return
  }
  orgCache.delete(orgId)
}

export function invalidateAllCaches(): void {
  orgCache.clear()
}

// Observability -- the concrete evidence for "is the cache actually doing
// anything," surfaced via GET /api/assets/cache/stats (requireAuth()-
// gated, admin-only) rather than left unverifiable.
export function getCacheStats(): { cachedOrgs: number; entries: Array<{ orgId: string; count: number; ageMs: number }> } {
  const now = Date.now()
  return {
    cachedOrgs: orgCache.size,
    entries: Array.from(orgCache.entries()).map(([orgId, entry]) => ({
      orgId,
      count: entry.assets.length,
      ageMs: now - entry.loadedAt,
    })),
  }
}
