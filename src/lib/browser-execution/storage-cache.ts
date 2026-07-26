// VERIDIAN_Architecture_v2.0 phase_5: engine-browser-storage +
// pipeline-input-acquisition's browser-cache-check sub-scope (full L0-L9
// cache hierarchy is phase_6_multi_level_cache_architecture -- this is
// only the single browser-side "have we already computed this exact
// machine-language output recently" check phase_5's own scope explicitly
// carves out). Keyed by phase_2's own CompiledPrompt.contentHash, so an
// identical raw input never re-runs any AI tier twice within the TTL.
//
// Split into pure logic (isFresh, below -- unit tested directly) and a
// storage backend chosen at call time: IndexedDB when available (every
// real browser), an in-memory Map otherwise (bun test/SSR/non-browser
// contexts) -- never throws if IndexedDB is unavailable, per this
// module's own fail-open design (a cache miss just means "run the tiers",
// never a hard error).
import type { BrowserExecutionOutcome } from "./types"

export const CACHE_TTL_MS = 10 * 60 * 1000 // 10 minutes -- long enough to dedupe rapid re-sends/retries, short enough that a stale local cache never meaningfully diverges from the server's own authoritative compile.
const DB_NAME = "veridian-browser-execution-cache"
const STORE_NAME = "outcomes"
const DB_VERSION = 1

export type CacheEntry = { outcome: BrowserExecutionOutcome; cachedAt: number }

/** Pure freshness check -- no I/O, fully unit-testable. */
export function isFresh(entry: CacheEntry, now: number, ttlMs: number = CACHE_TTL_MS): boolean {
  return now - entry.cachedAt < ttlMs
}

function hasIndexedDb(): boolean {
  return typeof indexedDB !== "undefined" && indexedDB !== null
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE_NAME)) req.result.createObjectStore(STORE_NAME)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

// In-memory fallback used whenever IndexedDB is unavailable (bun test,
// SSR, or a browser context with it disabled) -- deliberately module-scope
// (not per-instance), matching IndexedDB's own persistent-across-calls
// semantics within a single page/process lifetime.
let memoryFallback = new Map<string, CacheEntry>()

/** Test-only reset for the in-memory fallback (module-scope, so it otherwise persists across tests in the same process/file). Never called by production code. */
export function resetInMemoryCacheForTests(): void {
  memoryFallback = new Map<string, CacheEntry>()
}

/** Returns a cached outcome for contentHash if one exists and is still fresh; never throws. */
export async function getCachedOutcome(contentHash: string, now: number = Date.now()): Promise<BrowserExecutionOutcome | null> {
  try {
    if (!hasIndexedDb()) {
      const entry = memoryFallback.get(contentHash)
      return entry && isFresh(entry, now) ? entry.outcome : null
    }
    const db = await openDb()
    const entry = await new Promise<CacheEntry | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly")
      const req = tx.objectStore(STORE_NAME).get(contentHash)
      req.onsuccess = () => resolve(req.result as CacheEntry | undefined)
      req.onerror = () => reject(req.error)
    })
    db.close()
    return entry && isFresh(entry, now) ? entry.outcome : null
  } catch {
    return null // fail-open: a cache read error just means "run the tiers"
  }
}

/** Stores an outcome for contentHash; never throws (a failed write just means "no dedup next time," not a broken request). */
export async function putCachedOutcome(contentHash: string, outcome: BrowserExecutionOutcome, now: number = Date.now()): Promise<void> {
  const entry: CacheEntry = { outcome, cachedAt: now }
  try {
    if (!hasIndexedDb()) {
      memoryFallback.set(contentHash, entry)
      return
    }
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite")
      tx.objectStore(STORE_NAME).put(entry, contentHash)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    db.close()
  } catch {
    // fail-open, same rationale as getCachedOutcome
  }
}
