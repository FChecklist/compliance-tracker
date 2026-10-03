// The device's own small database, behind a five-method interface so the logic above it is tested with an in-memory copy and the browser
// uses IndexedDB. Everything stored here belongs to ONE signed-in person on THIS device and is wiped on sign-out (copy-store.ts wipe()).
// Nothing in this file talks to a network: the whole point of the local copy is that the person's own machine does the work.

export interface Kv {
  get(key: string): Promise<unknown | undefined>
  set(key: string, value: unknown): Promise<void>
  del(key: string): Promise<void>
  keys(): Promise<string[]>
  clear(): Promise<void>
}

export function memoryKv(): Kv {
  const m = new Map<string, unknown>()
  return {
    async get(k) { return m.has(k) ? structuredClone(m.get(k)) : undefined },
    async set(k, v) { m.set(k, structuredClone(v)) },
    async del(k) { m.delete(k) },
    async keys() { return [...m.keys()] },
    async clear() { m.clear() },
  }
}

const DB = "veridian-dpdp-copy"
const STORE = "kv"

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => { req.result.createObjectStore(STORE) }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error("IndexedDB unavailable"))
  })
}

function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then((db) => new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode)
    const req = fn(tx.objectStore(STORE))
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"))
    tx.oncomplete = () => db.close()
    tx.onerror = () => db.close()
  }))
}

/** IndexedDB-backed store. Throws on first use if the browser has none (private mode in some browsers); callers treat that as "no local copy". */
export function idbKv(): Kv {
  return {
    get: (k) => run("readonly", (s) => s.get(k)),
    set: (k, v) => run("readwrite", (s) => s.put(v, k)).then(() => undefined),
    del: (k) => run("readwrite", (s) => s.delete(k)).then(() => undefined),
    keys: () => run("readonly", (s) => s.getAllKeys()).then((ks) => ks.map(String)),
    clear: () => run("readwrite", (s) => s.clear()).then(() => undefined),
  }
}
