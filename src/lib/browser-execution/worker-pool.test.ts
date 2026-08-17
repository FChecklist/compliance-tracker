/// <reference types="bun-types" />
// VERIDIAN_Architecture_v2.0 phase_5, increment 2: real worker-pool
// coordination tests. Uses real Bun `Worker` instances (Bun can run a .ts
// worker file directly) against the real worker-pool-test-worker.ts file,
// not a same-thread fake -- exercising real postMessage/onmessage and real
// SharedArrayBuffer/Atomics coordination end to end, not just type-checked.
import { describe, expect, test } from "bun:test"
import { WorkerPool, recommendPoolSize, type PoolWorker } from "./worker-pool"

const WORKER_URL = new URL("./worker-pool-test-worker.ts", import.meta.url)

function realWorkerFactory(): PoolWorker {
  return new Worker(WORKER_URL) as unknown as PoolWorker
}

describe("WorkerPool (real Bun workers)", () => {
  test("dispatches a single task to a real worker and resolves with its real reply", async () => {
    const pool = new WorkerPool<{ n: number; delayMs: number }, { doubled: number }>(1, realWorkerFactory)
    try {
      const result = await pool.run({ n: 21, delayMs: 5 })
      expect(result).toEqual({ doubled: 42 })
    } finally {
      pool.terminate()
    }
  })

  test("real pool-of-2: two concurrent tasks land on two distinct workers (both busy at once, proven via the real SharedArrayBuffer slot snapshot)", async () => {
    const pool = new WorkerPool<{ n: number; delayMs: number }, { doubled: number }>(2, realWorkerFactory)
    try {
      const p1 = pool.run({ n: 1, delayMs: 60 })
      const p2 = pool.run({ n: 2, delayMs: 60 })
      // Give both dispatches a tick to land before either resolves.
      await new Promise((r) => setTimeout(r, 10))
      expect(pool.snapshotBusySlots()).toEqual([true, true])
      const [r1, r2] = await Promise.all([p1, p2])
      expect(r1).toEqual({ doubled: 2 })
      expect(r2).toEqual({ doubled: 4 })
      expect(pool.snapshotBusySlots()).toEqual([false, false])
    } finally {
      pool.terminate()
    }
  })

  test("real queueing: a 3rd task waits for a free slot on a pool of size 2, then really runs once one frees up", async () => {
    const pool = new WorkerPool<{ n: number; delayMs: number }, { doubled: number }>(2, realWorkerFactory)
    try {
      const results: number[] = []
      const tasks = [
        pool.run({ n: 1, delayMs: 20 }).then((r) => results.push(r.doubled)),
        pool.run({ n: 2, delayMs: 20 }).then((r) => results.push(r.doubled)),
        pool.run({ n: 3, delayMs: 5 }).then((r) => results.push(r.doubled)),
      ]
      await Promise.all(tasks)
      expect(results.sort()).toEqual([2, 4, 6])
    } finally {
      pool.terminate()
    }
  })
})

describe("recommendPoolSize", () => {
  test("leaves one core for the main thread and caps at the default of 4", () => {
    expect(recommendPoolSize({ navigator: { hardwareConcurrency: 8 } })).toBe(4)
    expect(recommendPoolSize({ navigator: { hardwareConcurrency: 3 } })).toBe(2)
  })
  test("falls back to 1 when hardwareConcurrency is unreported", () => {
    expect(recommendPoolSize({})).toBe(1)
  })
  test("respects a custom cap", () => {
    expect(recommendPoolSize({ navigator: { hardwareConcurrency: 32 } }, 8)).toBe(8)
  })
})
