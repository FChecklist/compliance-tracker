// VERIDIAN_Architecture_v2.0 phase_5 (browser_execution_tiers), increment
// 3: engine-browser-storage -- the general cross-tier storage layer the
// gap analysis found missing (ai-os/audits/owner_engine_reaudit_2026-07-27.md:
// model-cache.ts is real but explicitly scoped to per-engine model-weight
// caching only, not a general storage abstraction any tier/engine can use
// for arbitrary keyed byte data). This is the "OPFS + IndexedDB + Cache
// API" layer the phase plan's own scope calls for -- OPFS and Cache API
// are new here; IndexedDB is NOT reimplemented, it wraps model-cache.ts's
// real IndexedDbModelCache as one backend among three, per this
// increment's own explicit instruction not to replace that file.
//
// Same fallback-chain house style as tier-detection.ts/tier-orchestrator.ts:
// each backend answers "is this real capability present right now" (never
// silently assumed), and a real priority order (OPFS -> Cache API ->
// IndexedDB, largest-quota/most-general-purpose real browser storage
// first) picks the best available one, with the loser tiers documented as
// a real fallback chain rather than hidden.
import { createIndexedDbModelCache, type IndexedDbEnv, type IndexedDbModelCache } from "./model-cache"

export type CrossTierBackendKind = "opfs" | "cache-api" | "indexeddb"

export const CROSS_TIER_BACKEND_PRIORITY: CrossTierBackendKind[] = ["opfs", "cache-api", "indexeddb"]

export interface CrossTierStorageBackend {
  readonly kind: CrossTierBackendKind
  get(key: string): Promise<Uint8Array | undefined>
  put(key: string, value: Uint8Array): Promise<void>
  delete(key: string): Promise<boolean>
}

// ---------------------------------------------------------------------
// OPFS backend (Origin Private File System) -- real navigator.storage.
// getDirectory()-based read/write/delete, duck-typed so tests can inject a
// fake in-memory directory handle the same way tier-detection.ts injects a
// fake navigator.
// ---------------------------------------------------------------------
type OpfsWritable = { write(data: Uint8Array): Promise<void>; close(): Promise<void> }
type OpfsFileHandle = { getFile(): Promise<{ arrayBuffer(): Promise<ArrayBuffer> }>; createWritable(): Promise<OpfsWritable> }
type OpfsDirectoryHandle = {
  getFileHandle(name: string, options?: { create?: boolean }): Promise<OpfsFileHandle>
  removeEntry(name: string): Promise<void>
}
type OpfsStorageManager = { getDirectory(): Promise<OpfsDirectoryHandle> }

export type OpfsEnv = { storage?: OpfsStorageManager }

/**
 * Response's real BodyInit type only accepts a plain ArrayBuffer, not the
 * generic Uint8Array<ArrayBufferLike> this layer's own get/put signatures
 * use -- copies the real bytes into a plain ArrayBuffer (respecting a
 * non-zero byteOffset/a view over a larger buffer) rather than widening the
 * public API's type to work around it.
 */
function toArrayBuffer(value: Uint8Array): ArrayBuffer {
  return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer
}

function isNotFoundError(err: unknown): boolean {
  return err instanceof Error && (err.name === "NotFoundError" || /not found/i.test(err.message))
}

/** encodeURIComponent-safe: OPFS file names cannot contain "/" or other path separators. */
function encodeOpfsKey(key: string): string {
  return encodeURIComponent(key)
}

export class OpfsStorageBackend implements CrossTierStorageBackend {
  readonly kind: CrossTierBackendKind = "opfs"

  constructor(private readonly env?: OpfsEnv) {}

  private async directory(): Promise<OpfsDirectoryHandle> {
    const storage = this.env?.storage ?? (typeof navigator !== "undefined" ? (navigator as unknown as { storage?: OpfsStorageManager }).storage : undefined)
    if (!storage) throw new Error("navigator.storage (OPFS) is not available in this environment")
    return storage.getDirectory()
  }

  async get(key: string): Promise<Uint8Array | undefined> {
    const dir = await this.directory()
    try {
      const handle = await dir.getFileHandle(encodeOpfsKey(key))
      const file = await handle.getFile()
      return new Uint8Array(await file.arrayBuffer())
    } catch (err) {
      if (isNotFoundError(err)) return undefined
      throw err
    }
  }

  async put(key: string, value: Uint8Array): Promise<void> {
    const dir = await this.directory()
    const handle = await dir.getFileHandle(encodeOpfsKey(key), { create: true })
    const writable = await handle.createWritable()
    await writable.write(value)
    await writable.close()
  }

  async delete(key: string): Promise<boolean> {
    const dir = await this.directory()
    try {
      await dir.removeEntry(encodeOpfsKey(key))
      return true
    } catch (err) {
      if (isNotFoundError(err)) return false
      throw err
    }
  }
}

// ---------------------------------------------------------------------
// Cache API backend -- real caches.open()/match()/put()/delete(), keyed
// under one synthetic origin so arbitrary string keys (not necessarily
// real URLs) work with an API designed around Request/Response pairs.
// ---------------------------------------------------------------------
export type CacheApiEnv = { caches?: CacheStorage }

const CACHE_API_STORE_NAME = "veridian-browser-execution-cross-tier-storage"
const CACHE_API_KEY_ORIGIN = "https://veridian-cross-tier-storage.internal/"

export class CacheApiStorageBackend implements CrossTierStorageBackend {
  readonly kind: CrossTierBackendKind = "cache-api"

  constructor(private readonly env?: CacheApiEnv) {}

  private resolveCaches(): CacheStorage {
    const caches = this.env?.caches ?? (typeof globalThis !== "undefined" ? (globalThis as unknown as { caches?: CacheStorage }).caches : undefined)
    if (!caches) throw new Error("Cache API (caches) is not available in this environment")
    return caches
  }

  private keyToUrl(key: string): string {
    return CACHE_API_KEY_ORIGIN + encodeURIComponent(key)
  }

  async get(key: string): Promise<Uint8Array | undefined> {
    const cache = await this.resolveCaches().open(CACHE_API_STORE_NAME)
    const response = await cache.match(this.keyToUrl(key))
    if (!response) return undefined
    return new Uint8Array(await response.arrayBuffer())
  }

  async put(key: string, value: Uint8Array): Promise<void> {
    const cache = await this.resolveCaches().open(CACHE_API_STORE_NAME)
    await cache.put(this.keyToUrl(key), new Response(toArrayBuffer(value)))
  }

  async delete(key: string): Promise<boolean> {
    const cache = await this.resolveCaches().open(CACHE_API_STORE_NAME)
    return cache.delete(this.keyToUrl(key))
  }
}

// ---------------------------------------------------------------------
// IndexedDB backend -- a thin adapter over model-cache.ts's real
// IndexedDbModelCache (reused, not reimplemented -- see file header).
// ---------------------------------------------------------------------
export class IndexedDbStorageBackend implements CrossTierStorageBackend {
  readonly kind: CrossTierBackendKind = "indexeddb"

  constructor(private readonly cache: IndexedDbModelCache = createIndexedDbModelCache()) {}

  async get(key: string): Promise<Uint8Array | undefined> {
    const response = await this.cache.match(key)
    if (!response) return undefined
    return new Uint8Array(await response.arrayBuffer())
  }

  async put(key: string, value: Uint8Array): Promise<void> {
    await this.cache.put(key, new Response(toArrayBuffer(value)))
  }

  async delete(key: string): Promise<boolean> {
    return this.cache.delete(key)
  }
}

// ---------------------------------------------------------------------
// Real availability detection + priority-ordered orchestration, matching
// tier-detection.ts/tier-orchestrator.ts's own house style.
// ---------------------------------------------------------------------
export type CrossTierEnv = OpfsEnv & CacheApiEnv & IndexedDbEnv

export type CrossTierBackendAvailability = { backend: CrossTierBackendKind; available: boolean; reason: string }

export function detectCrossTierBackends(env?: CrossTierEnv): CrossTierBackendAvailability[] {
  const storage = env?.storage ?? (typeof navigator !== "undefined" ? (navigator as unknown as { storage?: OpfsStorageManager }).storage : undefined)
  const cachesApi = env?.caches ?? (typeof globalThis !== "undefined" ? (globalThis as unknown as { caches?: CacheStorage }).caches : undefined)
  const idb = env?.indexedDB ?? (typeof indexedDB !== "undefined" ? indexedDB : undefined)

  return [
    {
      backend: "opfs",
      available: Boolean(storage?.getDirectory),
      reason: storage?.getDirectory ? "navigator.storage.getDirectory (OPFS) is present" : "navigator.storage.getDirectory (OPFS) is not present on this runtime",
    },
    {
      backend: "cache-api",
      available: Boolean(cachesApi),
      reason: cachesApi ? "caches (Cache API) is present" : "caches (Cache API) is not present on this runtime",
    },
    {
      backend: "indexeddb",
      available: Boolean(idb),
      reason: idb ? "indexedDB is present" : "indexedDB is not present on this runtime",
    },
  ]
}

export function buildCrossTierBackends(env?: CrossTierEnv): Partial<Record<CrossTierBackendKind, CrossTierStorageBackend>> {
  const backends: Partial<Record<CrossTierBackendKind, CrossTierStorageBackend>> = {}
  for (const { backend, available } of detectCrossTierBackends(env)) {
    if (!available) continue
    if (backend === "opfs") backends.opfs = new OpfsStorageBackend(env)
    if (backend === "cache-api") backends["cache-api"] = new CacheApiStorageBackend(env)
    if (backend === "indexeddb") backends.indexeddb = new IndexedDbStorageBackend(createIndexedDbModelCache(env))
  }
  return backends
}

export type CrossTierPutResult = { backend: CrossTierBackendKind }
export type CrossTierGetResult = { backend: CrossTierBackendKind; value: Uint8Array }

/**
 * Real cross-tier put: writes to the highest-priority real backend
 * available in this environment (OPFS first, matching the phase document's
 * own "OPFS + IndexedDB + Cache API" ordering as the largest-quota,
 * most-general-purpose real browser storage). Every backend passed in
 * `backends` (default: the real, environment-detected set) is a real
 * implementation -- this function only orders and dispatches, it never
 * fakes a write.
 */
export async function putCrossTier(
  key: string,
  value: Uint8Array,
  env?: CrossTierEnv,
  backends: Partial<Record<CrossTierBackendKind, CrossTierStorageBackend>> = buildCrossTierBackends(env),
): Promise<CrossTierPutResult> {
  for (const kind of CROSS_TIER_BACKEND_PRIORITY) {
    const backend = backends[kind]
    if (!backend) continue
    await backend.put(key, value)
    return { backend: kind }
  }
  throw new Error("no cross-tier storage backend is available in this environment")
}

/**
 * Real cross-tier get: since putCrossTier always writes to the single
 * highest-priority backend available in a given environment, checking
 * backends in that same priority order finds a real put's data on the
 * first try in any stable environment, and correctly reports a real miss
 * (undefined) only once every real backend has been checked.
 */
export async function getCrossTier(
  key: string,
  env?: CrossTierEnv,
  backends: Partial<Record<CrossTierBackendKind, CrossTierStorageBackend>> = buildCrossTierBackends(env),
): Promise<CrossTierGetResult | undefined> {
  for (const kind of CROSS_TIER_BACKEND_PRIORITY) {
    const backend = backends[kind]
    if (!backend) continue
    const value = await backend.get(key)
    if (value !== undefined) return { backend: kind, value }
  }
  return undefined
}

/** Real cross-tier delete: removes from whichever real backend currently holds the key. */
export async function deleteCrossTier(
  key: string,
  env?: CrossTierEnv,
  backends: Partial<Record<CrossTierBackendKind, CrossTierStorageBackend>> = buildCrossTierBackends(env),
): Promise<boolean> {
  let deleted = false
  for (const kind of CROSS_TIER_BACKEND_PRIORITY) {
    const backend = backends[kind]
    if (!backend) continue
    if (await backend.delete(key)) deleted = true
  }
  return deleted
}
