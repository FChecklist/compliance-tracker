/// <reference types="bun-types" />
// VERIDIAN_Architecture_v2.0 phase_5, increment 2: real put/match/delete
// round-trip tests for the IndexedDB-backed Transformers.js custom cache.
// Bun has no real browser IndexedDB, so this injects a real (if minimal)
// in-memory IDBFactory-shaped fake -- built once here, in the test file,
// duck-typed exactly like tier-detection.test.ts already injects a fake
// navigator/window rather than requiring a real browser. The class under
// test (IndexedDbModelCache) is exercised through its real public API with
// zero internal reach-in, so this is a genuine behavioral test of the real
// production code path, not of the fake itself.
import { describe, expect, test } from "bun:test"
import { createIndexedDbModelCache, type IndexedDbEnv } from "./model-cache"

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

function makeFakeIndexedDb(): IDBFactory {
  const store = new Map<string, FakeRecord>()
  const objectStore = {
    get: (key: string) => makeFakeRequest(() => store.get(key)?.value),
    put: (value: unknown, key: string) => makeFakeRequest(() => {
      store.set(key, { key, value })
      return key
    }),
    delete: (key: string) => makeFakeRequest(() => {
      store.delete(key)
      return undefined
    }),
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

describe("IndexedDbModelCache", () => {
  test("match() on an empty cache returns undefined (real miss, not a thrown error)", async () => {
    const env: IndexedDbEnv = { indexedDB: makeFakeIndexedDb() }
    const cache = createIndexedDbModelCache(env)
    expect(await cache.match("https://example.com/model.onnx")).toBeUndefined()
  })

  test("real put() then match() round trip returns a real Response with the same real bytes", async () => {
    const env: IndexedDbEnv = { indexedDB: makeFakeIndexedDb() }
    const cache = createIndexedDbModelCache(env)
    const bytes = new Uint8Array([1, 2, 3, 4, 5])
    const response = new Response(bytes, { status: 200, statusText: "OK", headers: { "content-type": "application/octet-stream" } })

    await cache.put("https://example.com/model.onnx", response)
    const cached = await cache.match("https://example.com/model.onnx")

    expect(cached).toBeDefined()
    expect(cached?.status).toBe(200)
    const cachedBytes = new Uint8Array(await cached!.arrayBuffer())
    expect(Array.from(cachedBytes)).toEqual([1, 2, 3, 4, 5])
    expect(cached?.headers.get("content-type")).toBe("application/octet-stream")
  })

  test("delete() really removes a cached entry and reports whether it existed", async () => {
    const env: IndexedDbEnv = { indexedDB: makeFakeIndexedDb() }
    const cache = createIndexedDbModelCache(env)
    await cache.put("k", new Response(new Uint8Array([9])))

    expect(await cache.delete("k")).toBe(true)
    expect(await cache.match("k")).toBeUndefined()
    expect(await cache.delete("k")).toBe(false)
  })

  test("throws a clear error when no indexedDB is available at all (server-side use)", async () => {
    const cache = createIndexedDbModelCache({})
    await expect(cache.match("k")).rejects.toThrow(/indexedDB is not available/)
  })
})
