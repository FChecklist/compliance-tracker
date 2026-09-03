/// <reference types="bun-types" />
// R67 F-17 (R-234) -- sibling test for the API-key audit queue.
//
// WHAT IS BEING PROVED. Every API-key request used to issue two extra
// statements on the shared max:5 `db` pool (an api_key_request_log INSERT and
// an api_keys.last_used_at UPDATE), neither of them read by the request itself.
// PROJEXA makes 7-22 such calls per page. The queue turns that into one
// multi-row INSERT per batch and one last_used_at write per key per minute --
// but only if four things hold, which is what these tests are:
//   1. many requests really do coalesce into ONE insert;
//   2. a failed audit write can never reach the caller;
//   3. the row's created_at is the REQUEST's time, not the flush's -- the
//      60 s rate-limit window is read off that column;
//   4. the rate limiter can still see what is queued, so buffering does not
//      open a free window at the start of every batch.
//
// HOW. createApiKeyAuditRecorder() takes its clock, its timer, its deferral
// primitive and both writes as dependencies, so the whole thing is driven
// deterministically with no database, no real timers and no mocked modules.
// The module-level recordApiKeyUse() is the same code with the production
// dependencies bound; the last describe block covers that binding separately.
import { describe, expect, mock, test } from "bun:test"
import type { ApiKeyAuditDeps, ApiKeyUse } from "./api-key-audit"

// `@/lib/db` is stubbed BEFORE the module under test is imported, so the
// module-level recorder's production dependencies are exercised without a
// database -- this repo's standing rule for .test.ts files (see
// api-key-auth.test.ts's own header). Without it, the last describe block below
// would try to open a real connection from whatever DATABASE_URL the machine
// happens to have.
const stubbedInserts: unknown[][] = []
const stubbedLastUsedWrites: unknown[] = []

await mock.module("@/lib/db", () => ({
  db: {
    insert: () => ({ values: async (rows: unknown[]) => { stubbedInserts.push(rows) } }),
    update: () => ({ set: (values: unknown) => ({ where: async () => { stubbedLastUsedWrites.push(values) } }) }),
  },
  apiKeys: { id: "id" },
  apiKeyRequestLog: {},
}))

const {
  createApiKeyAuditRecorder,
  FLUSH_INTERVAL_MS,
  LAST_USED_AT_THROTTLE_MS,
  MAX_BUFFERED_ROWS,
  recordApiKeyUse,
  flushApiKeyAuditNow,
  pendingApiKeyRequestCount,
} = await import("./api-key-audit")

type Harness = {
  recorder: ReturnType<typeof createApiKeyAuditRecorder>
  inserts: ApiKeyUse[][]
  lastUsedWrites: { apiKeyId: string; at: Date }[]
  errors: { stage: string; error: unknown }[]
  /** Runs everything queued by defer() -- production's after()/setImmediate. */
  runDeferred: () => Promise<void>
  /** Fires the 5 s flush timer, if one is armed. */
  fireTimer: () => Promise<void>
  timerArmed: () => boolean
  advance: (ms: number) => void
}

function harness(
  overrides: Partial<Pick<ApiKeyAuditDeps, "insertRequestLog" | "touchLastUsedAt">> = {}
): Harness {
  let clock = Date.parse("2026-09-03T10:00:00.000Z")
  const deferred: (() => void)[] = []
  let timerTask: (() => void) | null = null
  let timerDelay = 0

  const inserts: ApiKeyUse[][] = []
  const lastUsedWrites: { apiKeyId: string; at: Date }[] = []
  const errors: { stage: string; error: unknown }[] = []

  const recorder = createApiKeyAuditRecorder({
    now: () => clock,
    insertRequestLog: overrides.insertRequestLog ?? (async (rows) => { inserts.push(rows) }),
    touchLastUsedAt: overrides.touchLastUsedAt ?? (async (apiKeyId, at) => { lastUsedWrites.push({ apiKeyId, at }) }),
    defer: (task) => { deferred.push(task) },
    startTimer: (task, ms) => { timerTask = task; timerDelay = ms; return "timer" },
    cancelTimer: () => { timerTask = null },
    onError: (stage, error) => { errors.push({ stage, error }) },
  })

  return {
    recorder,
    inserts,
    lastUsedWrites,
    errors,
    runDeferred: async () => {
      const tasks = deferred.splice(0, deferred.length)
      for (const task of tasks) task()
      // Let the flush chain settle -- flush() is async but never awaited by
      // record(), which is the point of the whole design.
      await recorder.flushNow()
    },
    fireTimer: async () => {
      expect(timerDelay).toBe(FLUSH_INTERVAL_MS)
      const task = timerTask
      timerTask = null
      task?.()
      await recorder.flushNow()
    },
    timerArmed: () => timerTask !== null,
    advance: (ms) => { clock += ms },
  }
}

function use(overrides: Partial<ApiKeyUse> = {}): ApiKeyUse {
  return {
    apiKeyId: "key-1",
    orgId: "org-1",
    route: "/api/v1/projexa/scope",
    method: "GET",
    wasRateLimited: false,
    at: new Date("2026-09-03T10:00:00.000Z"),
    ...overrides,
  }
}

describe("the queue coalesces a page's worth of requests into one write", () => {
  test("50 recordApiKeyUse() calls produce exactly one multi-row INSERT and one last_used_at UPDATE", async () => {
    // The acceptance case. 50 calls is roughly three PROJEXA page loads' worth
    // of API-key traffic; before this it was 50 INSERTs and 50 UPDATEs on a
    // five-connection pool.
    const h = harness()

    for (let i = 0; i < 50; i += 1) {
      await h.recorder.recordApiKeyUse(use({ route: `/api/v1/projexa/thing-${i}` }))
    }

    // Nothing has been written yet: record() never awaits a write.
    expect(h.inserts).toHaveLength(0)

    await h.runDeferred()

    expect(h.inserts).toHaveLength(1)
    expect(h.inserts[0]).toHaveLength(50)
    expect(h.lastUsedWrites).toHaveLength(1)
    expect(h.lastUsedWrites[0].apiKeyId).toBe("key-1")
    expect(h.recorder.pendingRowCount()).toBe(0)
  })

  test("each row keeps its own route and method -- the batch is not a summary", async () => {
    const h = harness()

    await h.recorder.recordApiKeyUse(use({ route: "/api/v1/projexa/permits", method: "GET" }))
    await h.recorder.recordApiKeyUse(use({ route: "/api/v1/projexa/tasks", method: "POST" }))
    await h.runDeferred()

    expect(h.inserts[0].map((r) => `${r.method} ${r.route}`)).toEqual([
      "GET /api/v1/projexa/permits",
      "POST /api/v1/projexa/tasks",
    ])
  })

  test("the row carries the REQUEST's time, not the flush's -- the rate-limit window is read off it", async () => {
    const h = harness()
    const requestedAt = new Date("2026-09-03T10:00:00.000Z")

    await h.recorder.recordApiKeyUse(use({ at: requestedAt }))
    h.advance(FLUSH_INTERVAL_MS)
    await h.runDeferred()

    expect(h.inserts[0][0].at).toEqual(requestedAt)
  })

  test("a second batch waits for the 5 s timer rather than writing per request", async () => {
    const h = harness()

    // First request after process start flushes promptly -- a fresh serverless
    // instance may serve one request and then freeze.
    await h.recorder.recordApiKeyUse(use())
    await h.runDeferred()
    expect(h.inserts).toHaveLength(1)

    await h.recorder.recordApiKeyUse(use())
    await h.recorder.recordApiKeyUse(use())
    expect(h.inserts).toHaveLength(1)
    expect(h.timerArmed()).toBe(true)

    await h.fireTimer()

    expect(h.inserts).toHaveLength(2)
    expect(h.inserts[1]).toHaveLength(2)
  })

  test("a burst past MAX_BUFFERED_ROWS does not wait for the timer", async () => {
    const h = harness()

    await h.recorder.recordApiKeyUse(use())
    await h.runDeferred() // consume the first-request flush
    expect(h.inserts).toHaveLength(1)

    for (let i = 0; i < MAX_BUFFERED_ROWS; i += 1) {
      await h.recorder.recordApiKeyUse(use())
    }
    await h.runDeferred()

    expect(h.inserts).toHaveLength(2)
    expect(h.inserts[1]).toHaveLength(MAX_BUFFERED_ROWS)
  })

  test("flushing an empty queue writes nothing", async () => {
    const h = harness()
    await h.recorder.flushNow()
    expect(h.inserts).toHaveLength(0)
    expect(h.lastUsedWrites).toHaveLength(0)
  })
})

describe("last_used_at is throttled to one write per key per minute", () => {
  test("two flushes inside the throttle window write it once", async () => {
    const h = harness()

    await h.recorder.recordApiKeyUse(use())
    await h.runDeferred()
    expect(h.lastUsedWrites).toHaveLength(1)

    h.advance(LAST_USED_AT_THROTTLE_MS - 1)
    await h.recorder.recordApiKeyUse(use())
    await h.fireTimer()

    expect(h.inserts).toHaveLength(2) // every request IS logged
    expect(h.lastUsedWrites).toHaveLength(1) // the "last used" date is not
  })

  test("once the window has passed it is written again", async () => {
    const h = harness()

    await h.recorder.recordApiKeyUse(use())
    await h.runDeferred()

    h.advance(LAST_USED_AT_THROTTLE_MS + 1)
    await h.recorder.recordApiKeyUse(use())
    await h.fireTimer()

    expect(h.lastUsedWrites).toHaveLength(2)
  })

  test("the throttle is per key, not global -- two keys in one batch both get written", async () => {
    const h = harness()

    await h.recorder.recordApiKeyUse(use({ apiKeyId: "key-a" }))
    await h.recorder.recordApiKeyUse(use({ apiKeyId: "key-b" }))
    await h.runDeferred()

    expect(h.lastUsedWrites.map((w) => w.apiKeyId).sort()).toEqual(["key-a", "key-b"])
  })

  test("it records the latest request time in the batch for that key, not the flush time", async () => {
    const h = harness()
    const earlier = new Date("2026-09-03T10:00:01.000Z")
    const later = new Date("2026-09-03T10:00:04.000Z")

    await h.recorder.recordApiKeyUse(use({ at: earlier }))
    await h.recorder.recordApiKeyUse(use({ at: later }))
    h.advance(60_000)
    await h.runDeferred()

    expect(h.lastUsedWrites[0].at).toEqual(later)
  })
})

describe("an audit write can never fail a customer's read", () => {
  test("a rejected INSERT does not propagate -- record() and flushNow() both resolve", async () => {
    const h = harness({
      insertRequestLog: async () => { throw new Error("pooler said no") },
    })

    await expect(h.recorder.recordApiKeyUse(use())).resolves.toBeUndefined()
    await expect(h.runDeferred()).resolves.toBeUndefined()

    expect(h.errors.map((e) => e.stage)).toContain("insert")
    // The failed batch is dropped, not retried forever into memory on a
    // runtime that can be frozen at any moment.
    expect(h.recorder.pendingRowCount()).toBe(0)
  })

  test("a rejected last_used_at UPDATE does not propagate, and the INSERT still happened", async () => {
    const h = harness({
      touchLastUsedAt: async () => { throw new Error("column locked") },
    })

    await h.recorder.recordApiKeyUse(use())
    await expect(h.runDeferred()).resolves.toBeUndefined()

    expect(h.inserts).toHaveLength(1)
    expect(h.errors.map((e) => e.stage)).toEqual(["last_used_at"])
  })

  test("a failed flush does not poison the queue -- the next batch still writes", async () => {
    let failNext = true
    const written: ApiKeyUse[][] = []
    const h = harness({
      insertRequestLog: async (rows) => {
        if (failNext) { failNext = false; throw new Error("transient") }
        written.push(rows)
      },
    })

    await h.recorder.recordApiKeyUse(use())
    await h.runDeferred()
    expect(written).toHaveLength(0)

    await h.recorder.recordApiKeyUse(use())
    await h.fireTimer()

    expect(written).toHaveLength(1)
  })
})

describe("the rate limiter can still see what is queued", () => {
  test("pendingRequestCount counts unwritten rows for that key inside the window", async () => {
    const h = harness()
    const windowStart = new Date("2026-09-03T10:00:00.000Z")

    await h.recorder.recordApiKeyUse(use({ apiKeyId: "key-a", at: new Date("2026-09-03T10:00:10.000Z") }))
    await h.recorder.recordApiKeyUse(use({ apiKeyId: "key-a", at: new Date("2026-09-03T10:00:20.000Z") }))
    await h.recorder.recordApiKeyUse(use({ apiKeyId: "key-b", at: new Date("2026-09-03T10:00:20.000Z") }))

    expect(h.recorder.pendingRequestCount("key-a", windowStart)).toBe(2)
    expect(h.recorder.pendingRequestCount("key-b", windowStart)).toBe(1)
    expect(h.recorder.pendingRequestCount("key-c", windowStart)).toBe(0)
  })

  test("rows older than the window are not counted", async () => {
    const h = harness()

    await h.recorder.recordApiKeyUse(use({ at: new Date("2026-09-03T09:58:00.000Z") }))
    await h.recorder.recordApiKeyUse(use({ at: new Date("2026-09-03T10:00:30.000Z") }))

    expect(h.recorder.pendingRequestCount("key-1", new Date("2026-09-03T09:59:30.000Z"))).toBe(1)
  })

  test("a row that is mid-INSERT is still counted -- the window has no hole while the driver is working", async () => {
    // A driver call that is deliberately held open, plus a signal for when it
    // has actually started, so the assertion below lands in the window between
    // "left the buffer" and "reached the database" without guessing at
    // microtask turns.
    let release!: () => void
    let insertStarted!: () => void
    const insertHasStarted = new Promise<void>((resolve) => { insertStarted = resolve })
    const h = harness({
      insertRequestLog: () => new Promise<void>((resolve) => {
        release = resolve
        insertStarted()
      }),
    })
    const windowStart = new Date("2026-09-03T09:59:00.000Z")

    await h.recorder.recordApiKeyUse(use())
    const flushing = h.runDeferred()
    await insertHasStarted

    // The row has left the buffer and has not reached the database.
    expect(h.recorder.pendingRequestCount("key-1", windowStart)).toBe(1)
    expect(h.recorder.pendingRowCount()).toBe(1)

    release()
    await flushing

    expect(h.recorder.pendingRequestCount("key-1", windowStart)).toBe(0)
  })

  test("once flushed, the count drops to zero -- the DB is now the source", async () => {
    const h = harness()

    await h.recorder.recordApiKeyUse(use())
    await h.runDeferred()

    expect(h.recorder.pendingRequestCount("key-1", new Date("2026-09-03T09:59:00.000Z"))).toBe(0)
  })

  test("a rate-limited request is recorded too, exactly as the un-batched code did", async () => {
    const h = harness()

    await h.recorder.recordApiKeyUse(use({ wasRateLimited: true }))
    await h.runDeferred()

    expect(h.inserts[0][0].wasRateLimited).toBe(true)
  })
})

describe("the module-level recorder, bound to the production dependencies", () => {
  test("recordApiKeyUse buffers, flushApiKeyAuditNow writes one row set, and the request's own time is preserved", async () => {
    // This exercises the REAL default dependencies -- the drizzle insert/update
    // shapes, the after()/setImmediate deferral, the unref'd timer -- against a
    // stubbed db. It is what proves the wiring in defaultDeps(), which none of
    // the injected-dependency tests above touch.
    const requestedAt = new Date("2026-09-03T11:22:33.000Z")
    const windowStart = new Date("2026-09-03T11:22:00.000Z")

    await expect(recordApiKeyUse({
      apiKeyId: "key-live", orgId: "org-live", route: "/api/v1/projexa/projects", method: "GET",
      wasRateLimited: false, at: requestedAt,
    })).resolves.toBeUndefined()

    expect(pendingApiKeyRequestCount("key-live", windowStart)).toBe(1)

    await expect(flushApiKeyAuditNow()).resolves.toBeUndefined()

    expect(pendingApiKeyRequestCount("key-live", windowStart)).toBe(0)
    expect(stubbedInserts).toHaveLength(1)
    expect(stubbedInserts[0]).toEqual([{
      apiKeyId: "key-live",
      orgId: "org-live",
      route: "/api/v1/projexa/projects",
      method: "GET",
      wasRateLimited: false,
      // The mapping that matters most: created_at is the request's time, so the
      // 60 s rate-limit window and the usage analytics both read the truth.
      createdAt: requestedAt,
    }])
    expect(stubbedLastUsedWrites).toEqual([{ lastUsedAt: requestedAt }])
  })
})
