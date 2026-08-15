/// <reference types="bun-types" />
// VERIDIAN_Architecture_v2.0 phase_5, increment 3: real tests for the
// browser-sync engine -- offline queuing (with real same-entity
// coalescing), remote conflict resolution, delta sync, and the sync mutex.
// Exercised via injected transports (same env/factory-injection house
// style as every other file in this tier), since no real server is
// reachable in this test runtime.
import { describe, expect, test } from "bun:test"
import {
  coalesceQueuedChanges,
  OfflineQueue,
  pullDeltaSync,
  resolveConflict,
  syncQueue,
  SyncMutex,
  type PushChange,
  type QueuedChange,
  type ServerChangeOutcome,
} from "./sync-engine"

function change(overrides: Partial<QueuedChange> = {}): QueuedChange {
  return {
    entityType: "task",
    entityId: "t-1",
    operation: "update",
    payload: {},
    baseVersion: 1,
    queuedAt: 1000,
    ...overrides,
  }
}

describe("OfflineQueue -- real conflict scenario: two offline changes queued against the same record", () => {
  test("update + update to the same entity coalesces into ONE queued change with merged fields and the EARLIEST baseVersion", () => {
    const queue = new OfflineQueue()
    queue.enqueue(change({ payload: { status: "in_progress" }, baseVersion: 5, queuedAt: 1000 }))
    queue.enqueue(change({ payload: { title: "Renamed" }, baseVersion: 9, queuedAt: 2000 }))

    expect(queue.size).toBe(1)
    const [merged] = queue.list()
    expect(merged.payload).toEqual({ status: "in_progress", title: "Renamed" })
    expect(merged.baseVersion).toBe(5)
    expect(merged.operation).toBe("update")
  })

  test("a later field edit for the SAME field overwrites the earlier queued one (last local edit wins locally)", () => {
    const queue = new OfflineQueue()
    queue.enqueue(change({ payload: { status: "in_progress" } }))
    queue.enqueue(change({ payload: { status: "done" } }))
    expect(queue.list()[0].payload).toEqual({ status: "done" })
  })

  test("create + update coalesces to a single create with merged payload", () => {
    const queue = new OfflineQueue()
    queue.enqueue(change({ operation: "create", payload: { title: "New" }, baseVersion: null }))
    queue.enqueue(change({ operation: "update", payload: { status: "open" } }))
    const [merged] = queue.list()
    expect(merged.operation).toBe("create")
    expect(merged.payload).toEqual({ title: "New", status: "open" })
  })

  test("create + delete cancels out entirely (the create never reached the server)", () => {
    const queue = new OfflineQueue()
    queue.enqueue(change({ operation: "create", payload: { title: "New" }, baseVersion: null }))
    queue.enqueue(change({ operation: "delete", payload: {} }))
    expect(queue.size).toBe(0)
  })

  test("update + delete coalesces to a delete", () => {
    const queue = new OfflineQueue()
    queue.enqueue(change({ operation: "update", payload: { status: "done" }, baseVersion: 3 }))
    queue.enqueue(change({ operation: "delete", payload: {} }))
    const [merged] = queue.list()
    expect(merged.operation).toBe("delete")
    expect(merged.baseVersion).toBe(3)
  })

  test("delete + create resurrects as a fresh create with baseVersion reset", () => {
    const queue = new OfflineQueue()
    queue.enqueue(change({ operation: "delete", payload: {}, baseVersion: 4 }))
    queue.enqueue(change({ operation: "create", payload: { title: "Resurrected" }, baseVersion: null }))
    const [merged] = queue.list()
    expect(merged.operation).toBe("create")
    expect(merged.baseVersion).toBeNull()
  })

  test("changes to DIFFERENT entities never coalesce -- both stay queued independently", () => {
    const queue = new OfflineQueue()
    queue.enqueue(change({ entityId: "t-1", payload: { title: "A" } }))
    queue.enqueue(change({ entityId: "t-2", payload: { title: "B" } }))
    expect(queue.size).toBe(2)
  })
})

describe("coalesceQueuedChanges (pure function)", () => {
  test("is a pure function -- calling it directly matches OfflineQueue's real internal behavior", () => {
    const a = change({ payload: { x: 1 }, baseVersion: 1 })
    const b = change({ payload: { y: 2 }, baseVersion: 2 })
    expect(coalesceQueuedChanges(a, b)).toEqual({ ...b, payload: { x: 1, y: 2 }, baseVersion: 1 })
  })
})

describe("resolveConflict (real REMOTE conflict -- server version moved while offline)", () => {
  test("field-level merge: local edited fields win, untouched server fields are preserved", () => {
    const localChange = change({ payload: { status: "done" } })
    const outcome: Extract<ServerChangeOutcome, { status: "conflict" }> = {
      status: "conflict",
      serverVersion: 7,
      serverPayload: { status: "in_progress", title: "Server-renamed while offline" },
    }
    const resolution = resolveConflict(localChange, outcome)
    expect(resolution).toEqual({ kind: "merged", payload: { status: "done", title: "Server-renamed while offline" } })
  })

  test("a local delete cannot be auto-merged against a server-side conflict -- flagged for manual resolution", () => {
    const localChange = change({ operation: "delete" })
    const outcome: Extract<ServerChangeOutcome, { status: "conflict" }> = { status: "conflict", serverVersion: 7, serverPayload: { status: "in_progress" } }
    const resolution = resolveConflict(localChange, outcome)
    expect(resolution.kind).toBe("needs-manual-resolution")
  })
})

describe("syncQueue", () => {
  test("real applied path: pushed change is cleared from the queue", async () => {
    const queue = new OfflineQueue()
    queue.enqueue(change({ entityId: "t-1" }))
    const pushChange: PushChange = async () => ({ status: "applied", serverVersion: 2 })

    const result = await syncQueue(queue, pushChange)

    expect(result.applied).toHaveLength(1)
    expect(queue.size).toBe(0)
  })

  test("real remote-conflict path: merged resolution is re-queued with the server's version as the new baseVersion", async () => {
    const queue = new OfflineQueue()
    queue.enqueue(change({ entityId: "t-1", payload: { status: "done" }, baseVersion: 1 }))
    const pushChange: PushChange = async () => ({
      status: "conflict",
      serverVersion: 9,
      serverPayload: { status: "in_progress", title: "Renamed on server" },
    })

    const result = await syncQueue(queue, pushChange)

    expect(result.conflicts).toHaveLength(1)
    expect(queue.size).toBe(1)
    const [requeued] = queue.list()
    expect(requeued.payload).toEqual({ status: "done", title: "Renamed on server" })
    expect(requeued.baseVersion).toBe(9)
  })

  test("real unresolvable-conflict path: local delete conflict leaves the original queued change untouched, not dropped", async () => {
    const queue = new OfflineQueue()
    queue.enqueue(change({ entityId: "t-1", operation: "delete" }))
    const pushChange: PushChange = async () => ({ status: "conflict", serverVersion: 9, serverPayload: { status: "in_progress" } })

    const result = await syncQueue(queue, pushChange)

    expect(result.conflicts[0].resolution.kind).toBe("needs-manual-resolution")
    expect(queue.size).toBe(1)
    expect(queue.list()[0].operation).toBe("delete")
  })

  test("real error path: transport error leaves the change queued for retry", async () => {
    const queue = new OfflineQueue()
    queue.enqueue(change({ entityId: "t-1" }))
    const pushChange: PushChange = async () => ({ status: "error", message: "network unreachable" })

    const result = await syncQueue(queue, pushChange)

    expect(result.errors).toHaveLength(1)
    expect(queue.size).toBe(1)
  })

  test("real FIFO order: multiple queued changes are pushed in insertion order", async () => {
    const queue = new OfflineQueue()
    queue.enqueue(change({ entityId: "t-1" }))
    queue.enqueue(change({ entityId: "t-2" }))
    const order: string[] = []
    const pushChange: PushChange = async (c) => {
      order.push(c.entityId)
      return { status: "applied", serverVersion: 1 }
    }
    await syncQueue(queue, pushChange)
    expect(order).toEqual(["t-1", "t-2"])
  })
})

describe("pullDeltaSync", () => {
  test("real delta pass: applies every real changed record and returns the next sync token", async () => {
    const applied: string[] = []
    const fetchDeltas = async (since: string | null) => {
      expect(since).toBe("token-1")
      return {
        deltas: [
          { entityType: "task", entityId: "t-1", payload: { title: "A" }, version: 2, updatedAt: 100 },
          { entityType: "task", entityId: "t-2", payload: { title: "B" }, version: 1, updatedAt: 200 },
        ],
        nextSyncToken: "token-2",
      }
    }
    const applyDelta = async (record: { entityId: string }) => {
      applied.push(record.entityId)
    }

    const result = await pullDeltaSync("token-1", fetchDeltas, applyDelta)

    expect(applied).toEqual(["t-1", "t-2"])
    expect(result.nextSyncToken).toBe("token-2")
    expect(result.applied).toHaveLength(2)
  })

  test("real first sync: since=null pulls a full initial delta set", async () => {
    const fetchDeltas = async (since: string | null) => {
      expect(since).toBeNull()
      return { deltas: [], nextSyncToken: "token-1" }
    }
    const result = await pullDeltaSync(null, fetchDeltas, async () => {})
    expect(result.applied).toEqual([])
    expect(result.nextSyncToken).toBe("token-1")
  })
})

describe("SyncMutex", () => {
  test("real serialization: a second run() does not start until the first has settled", async () => {
    const mutex = new SyncMutex()
    const order: string[] = []
    let releaseFirst: () => void = () => {}
    const firstStarted = new Promise<void>((resolve) => {
      mutex.run(async () => {
        order.push("first-start")
        resolve()
        await new Promise<void>((r) => { releaseFirst = r })
        order.push("first-end")
      })
    })
    await firstStarted
    const second = mutex.run(async () => {
      order.push("second-start")
    })
    // second must not have started yet -- first is still pending
    expect(order).toEqual(["first-start"])
    releaseFirst()
    await second
    expect(order).toEqual(["first-start", "first-end", "second-start"])
  })

  test("a rejected run() does not break the mutex chain for subsequent calls", async () => {
    const mutex = new SyncMutex()
    await expect(mutex.run(async () => { throw new Error("boom") })).rejects.toThrow("boom")
    expect(await mutex.run(async () => "recovered")).toBe("recovered")
  })
})
