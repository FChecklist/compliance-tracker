// VERIDIAN_Architecture_v2.0 phase_5 (browser_execution_tiers), increment 2,
// follow-up item 7: tier-local model-weight caching (IndexedDB) so repeat
// loads of a browser-execution-tier model don't re-download its weights.
//
// Explicit scope boundary (see this increment's own KNOWN_CONTEXT): this is
// engine-LOCAL plumbing for ONE engine's own weight cache, with zero
// cross-engine/cross-tier sharing contract. It is deliberately NOT
// phase_6's shared cache hierarchy (stack-storage-tier's full
// L1/L2/L3/OPFS design spanning multiple engines) -- if a future phase
// wants WebLLM and Transformers.js to share one physical cache budget,
// that unification is phase_6's own decision to make, not silently
// pre-built here.
//
// Two real, DIFFERENT caching stories, because the two libraries expose
// different native hooks (confirmed by reading each package's own
// type declarations, not assumed):
//   - WebLLM has a NATIVE `AppConfig.cacheBackend: "indexeddb"` flag (see
//     webllm-engine.ts's defaultWebLlmEngineFactory) -- no custom code
//     needed, so none is written here for it.
//   - Transformers.js (@huggingface/transformers) has NO native IndexedDB
//     option -- only `useBrowserCache` (Cache API), `useFSCache`
//     (Node only), and `useCustomCache`/`customCache` (bring-your-own
//     cache implementing `CacheInterface`: `match(request): Promise<
//     Response|undefined>` + `put(request, response): Promise<void>`,
//     confirmed via node_modules/@huggingface/transformers/types/utils/
//     cache.d.ts). This file is that real custom cache, backed by real
//     IndexedDB.
export type IndexedDbEnv = { indexedDB?: IDBFactory }

const DB_NAME = "veridian-browser-execution-model-cache"
const STORE_NAME = "model-weights"
const DB_VERSION = 1

function resolveIndexedDb(env?: IndexedDbEnv): IDBFactory {
  const idb = env?.indexedDB ?? (typeof indexedDB !== "undefined" ? indexedDB : undefined)
  if (!idb) throw new Error("indexedDB is not available in this environment")
  return idb
}

function openDb(env?: IndexedDbEnv): Promise<IDBDatabase> {
  const idb = resolveIndexedDb(env)
  return new Promise((resolve, reject) => {
    const req = idb.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE_NAME)) req.result.createObjectStore(STORE_NAME)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

type StoredEntry = { body: ArrayBuffer; headers: Record<string, string>; status: number; statusText: string }

function requestInStore<T>(store: IDBObjectStore, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = run(store)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/**
 * Real IndexedDB-backed implementation of Transformers.js's own
 * `CacheInterface` -- pass an instance of this to
 * `env.customCache`/`env.useCustomCache = true` (see transformers-engine.ts)
 * to make repeat pipeline() loads skip re-downloading model weights.
 * Takes an optional injected `indexedDB` (matching tier-detection.ts's own
 * env-injection pattern) so unit tests can exercise real
 * put/match/delete round trips without a real browser.
 */
export class IndexedDbModelCache {
  constructor(private readonly env?: IndexedDbEnv) {}

  async match(request: string): Promise<Response | undefined> {
    const db = await openDb(this.env)
    try {
      const tx = db.transaction(STORE_NAME, "readonly")
      const entry = await requestInStore<StoredEntry | undefined>(tx.objectStore(STORE_NAME), (store) => store.get(request))
      if (!entry) return undefined
      return new Response(entry.body, { status: entry.status, statusText: entry.statusText, headers: entry.headers })
    } finally {
      db.close()
    }
  }

  async put(request: string, response: Response): Promise<void> {
    const body = await response.clone().arrayBuffer()
    const headers: Record<string, string> = {}
    response.headers.forEach((value, key) => {
      headers[key] = value
    })
    const entry: StoredEntry = { body, headers, status: response.status, statusText: response.statusText }
    const db = await openDb(this.env)
    try {
      const tx = db.transaction(STORE_NAME, "readwrite")
      await requestInStore(tx.objectStore(STORE_NAME), (store) => store.put(entry, request))
    } finally {
      db.close()
    }
  }

  async delete(request: string): Promise<boolean> {
    const db = await openDb(this.env)
    try {
      const tx = db.transaction(STORE_NAME, "readwrite")
      const existing = await requestInStore<StoredEntry | undefined>(tx.objectStore(STORE_NAME), (store) => store.get(request))
      if (!existing) return false
      await requestInStore(tx.objectStore(STORE_NAME), (store) => store.delete(request))
      return true
    } finally {
      db.close()
    }
  }
}

export function createIndexedDbModelCache(env?: IndexedDbEnv): IndexedDbModelCache {
  return new IndexedDbModelCache(env)
}
