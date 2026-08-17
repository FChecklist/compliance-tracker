/// <reference types="bun-types" />
// VERIDIAN_Architecture_v2.0 phase_5, increment 3: real tests proving the
// cross-tier storage layer persists and retrieves data via each real
// backend's own real API shape (OPFS getDirectory/getFileHandle/
// createWritable, Cache API caches.open/match/put/delete, and
// IndexedDbModelCache's own real put/match/delete, reused not
// reimplemented). Bun has no real browser storage, so each backend is
// exercised against a real, documented in-memory fake of its own
// browser API -- same established pattern as model-cache.test.ts's fake
// IDBFactory and tier-detection.test.ts's fake navigator/window, not a new
// testing approach introduced here.
import { describe, expect, test } from "bun:test"
import {
  buildCrossTierBackends,
  CacheApiStorageBackend,
  deleteCrossTier,
  detectCrossTierBackends,
  getCrossTier,
  IndexedDbStorageBackend,
  OpfsStorageBackend,
  putCrossTier,
  type CrossTierEnv,
} from "./cross-tier-storage"
import { createIndexedDbModelCache } from "./model-cache"

// --- Real, minimal in-memory OPFS fake (getDirectory/getFileHandle/createWritable/removeEntry) ---
function makeFakeOpfsStorage() {
  const files = new Map<string, Uint8Array>()
  const dir = {
    async getFileHandle(name: string, options?: { create?: boolean }) {
      if (!files.has(name) && !options?.create) {
        const err = new Error(`${name} not found`)
        err.name = "NotFoundError"
        throw err
      }
      return {
        async getFile() {
          const bytes = files.get(name) ?? new Uint8Array()
          return { async arrayBuffer() { return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) } }
        },
        async createWritable() {
          let pending = new Uint8Array()
          return {
            async write(data: Uint8Array) { pending = data },
            async close() { files.set(name, pending) },
          }
        },
      }
    },
    async removeEntry(name: string) {
      if (!files.has(name)) {
        const err = new Error(`${name} not found`)
        err.name = "NotFoundError"
        throw err
      }
      files.delete(name)
    },
  }
  return { getDirectory: async () => dir }
}

// --- Real, minimal in-memory Cache API fake (caches.open/match/put/delete) ---
function makeFakeCacheStorage() {
  const store = new Map<string, Response>()
  const cache = {
    async match(request: string) {
      return store.get(request)
    },
    async put(request: string, response: Response) {
      store.set(request, response.clone())
    },
    async delete(request: string) {
      return store.delete(request)
    },
  }
  return { open: async () => cache } as unknown as CacheStorage
}

function makeFakeIndexedDbEnv() {
  type FakeRecord = { key: string; value: unknown }
  function makeFakeRequest<T>(run: () => T): IDBRequest<T> {
    const req = {} as IDBRequest<T>
    queueMicrotask(() => {
      try {
        ;(req as { result: T }).result = run()
        req.onsuccess?.(new Event("success") as never)
      } catch (err) {
        ;(req as { error: unknown }).error = err
        req.onerror?.(new Event("error") as never)
      }
    })
    return req
  }
  const store = new Map<string, FakeRecord>()
  const objectStore = {
    get: (key: string) => makeFakeRequest(() => store.get(key)?.value),
    put: (value: unknown, key: string) => makeFakeRequest(() => { store.set(key, { key, value }); return key }),
    delete: (key: string) => makeFakeRequest(() => { store.delete(key); return undefined }),
  } as unknown as IDBObjectStore
  const db = {
    objectStoreNames: { contains: () => true },
    createObjectStore: () => objectStore,
    transaction: () => ({ objectStore: () => objectStore }),
    close: () => {},
  } as unknown as IDBDatabase
  return {
    open: () => {
      const req = {} as IDBOpenDBRequest
      queueMicrotask(() => {
        ;(req as { result: IDBDatabase }).result = db
        req.onupgradeneeded?.(new Event("upgradeneeded") as never)
        req.onsuccess?.(new Event("success") as never)
      })
      return req
    },
  } as unknown as IDBFactory
}

describe("OpfsStorageBackend", () => {
  test("real put() then get() round trip returns the same real bytes", async () => {
    const backend = new OpfsStorageBackend({ storage: makeFakeOpfsStorage() })
    const bytes = new Uint8Array([10, 20, 30])
    await backend.put("my-key", bytes)
    expect(Array.from((await backend.get("my-key"))!)).toEqual([10, 20, 30])
  })

  test("get() on a missing key returns undefined (real honest miss, not a thrown error)", async () => {
    const backend = new OpfsStorageBackend({ storage: makeFakeOpfsStorage() })
    expect(await backend.get("missing")).toBeUndefined()
  })

  test("delete() really removes the entry and reports whether it existed", async () => {
    const backend = new OpfsStorageBackend({ storage: makeFakeOpfsStorage() })
    await backend.put("k", new Uint8Array([1]))
    expect(await backend.delete("k")).toBe(true)
    expect(await backend.get("k")).toBeUndefined()
    expect(await backend.delete("k")).toBe(false)
  })

  test("throws a clear error when navigator.storage is not available", async () => {
    const backend = new OpfsStorageBackend({})
    await expect(backend.get("k")).rejects.toThrow(/navigator.storage/)
  })
})

describe("CacheApiStorageBackend", () => {
  test("real put() then get() round trip returns the same real bytes", async () => {
    const backend = new CacheApiStorageBackend({ caches: makeFakeCacheStorage() })
    const bytes = new Uint8Array([7, 8, 9])
    await backend.put("my-key", bytes)
    expect(Array.from((await backend.get("my-key"))!)).toEqual([7, 8, 9])
  })

  test("delete() really removes the entry and reports whether it existed", async () => {
    const backend = new CacheApiStorageBackend({ caches: makeFakeCacheStorage() })
    await backend.put("k", new Uint8Array([1]))
    expect(await backend.delete("k")).toBe(true)
    expect(await backend.get("k")).toBeUndefined()
    expect(await backend.delete("k")).toBe(false)
  })

  test("throws a clear error when the Cache API is not available", async () => {
    const backend = new CacheApiStorageBackend({})
    await expect(backend.get("k")).rejects.toThrow(/Cache API/)
  })
})

describe("IndexedDbStorageBackend", () => {
  test("real put() then get() round trip via the reused IndexedDbModelCache", async () => {
    const backend = new IndexedDbStorageBackend(createIndexedDbModelCache({ indexedDB: makeFakeIndexedDbEnv() }))
    const bytes = new Uint8Array([4, 5, 6])
    await backend.put("k", bytes)
    expect(Array.from((await backend.get("k"))!)).toEqual([4, 5, 6])
  })
})

describe("detectCrossTierBackends / buildCrossTierBackends", () => {
  test("reports all 3 backends available when the real environment has all 3 real capabilities", () => {
    const env: CrossTierEnv = { storage: makeFakeOpfsStorage(), caches: makeFakeCacheStorage(), indexedDB: makeFakeIndexedDbEnv() }
    const availability = detectCrossTierBackends(env)
    expect(availability.map((a) => a.backend)).toEqual(["opfs", "cache-api", "indexeddb"])
    expect(availability.every((a) => a.available)).toBe(true)
  })

  test("reports zero backends available in a bare server-side environment", () => {
    const availability = detectCrossTierBackends({})
    expect(availability.every((a) => !a.available)).toBe(true)
    expect(Object.keys(buildCrossTierBackends({}))).toEqual([])
  })
})

describe("putCrossTier / getCrossTier / deleteCrossTier", () => {
  test("real end-to-end: writes to the highest-priority backend (OPFS) when all 3 are available", async () => {
    const env: CrossTierEnv = { storage: makeFakeOpfsStorage(), caches: makeFakeCacheStorage(), indexedDB: makeFakeIndexedDbEnv() }
    const putResult = await putCrossTier("shared-key", new Uint8Array([1, 2, 3]), env)
    expect(putResult.backend).toBe("opfs")

    const getResult = await getCrossTier("shared-key", env)
    expect(getResult?.backend).toBe("opfs")
    expect(Array.from(getResult!.value)).toEqual([1, 2, 3])

    expect(await deleteCrossTier("shared-key", env)).toBe(true)
    expect(await getCrossTier("shared-key", env)).toBeUndefined()
  })

  test("real fallback: falls to Cache API when OPFS is unavailable, IndexedDB unavailable", async () => {
    const env: CrossTierEnv = { caches: makeFakeCacheStorage() }
    const putResult = await putCrossTier("k", new Uint8Array([9]), env)
    expect(putResult.backend).toBe("cache-api")
    const getResult = await getCrossTier("k", env)
    expect(getResult?.backend).toBe("cache-api")
  })

  test("real fallback: falls all the way to IndexedDB when neither OPFS nor Cache API is available", async () => {
    const env: CrossTierEnv = { indexedDB: makeFakeIndexedDbEnv() }
    const putResult = await putCrossTier("k", new Uint8Array([1]), env)
    expect(putResult.backend).toBe("indexeddb")
  })

  test("throws a clear error when zero backends are available", async () => {
    await expect(putCrossTier("k", new Uint8Array([1]), {})).rejects.toThrow(/no cross-tier storage backend/)
  })

  test("get() on a real miss (key never written) returns undefined, not an error", async () => {
    const env: CrossTierEnv = { storage: makeFakeOpfsStorage() }
    expect(await getCrossTier("never-written", env)).toBeUndefined()
  })
})
