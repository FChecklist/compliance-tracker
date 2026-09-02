import { after } from "next/server"
import { eq } from "drizzle-orm"
import { db, apiKeys, apiKeyRequestLog } from "@/lib/db"

// R67 F-17 (R-234) -- TAKE THE TWO API-KEY AUDIT WRITES OFF THE REQUEST PATH.
//
// WHAT WAS ACTUALLY TRUE BEFORE THIS, stated precisely because the audit's
// wording ("pays ... before its read starts") overstates it: validateApiKey()
// did not AWAIT either write -- both were fire-and-forget `.then(() => {})`.
// What they did do is issue two more statements on the `db` pool for every
// single API-key request, concurrently with the request's own read. That pool
// is `max: 5` and it is shared by every route (src/lib/db/index.ts). Its own
// R43_EXEC_02 comment already names these exact two writes plus the key lookup
// as what serialised onto that pool and produced 504s on /vendors and
// /employees. PROJEXA makes 7-22 API-key calls per page, so the page was
// issuing 14-44 audit statements it never read the results of. That is the
// cost this removes: pool operations per request, not awaited milliseconds.
//
// THE SHAPE. One in-process queue. Rows accumulate and go out as ONE multi-row
// INSERT every FLUSH_INTERVAL_MS, or immediately once MAX_BUFFERED_ROWS have
// piled up. api_keys.last_used_at -- a column whose only consumer is a "Last
// used <date>" line in the settings UI (ApiKeySection.tsx) and the stale-key
// audit loop -- is written at most once per key per minute, because a
// per-request write of a per-minute-accurate value is pure waste.
//
// createdAt IS SET EXPLICITLY, NOT LEFT TO defaultNow(). The row is inserted up
// to five seconds after the request it describes. If the column defaulted, both
// the usage analytics and -- much worse -- the 60-second rate-limit window
// would be reading the FLUSH time as the request time. This is the one detail
// that makes buffering safe rather than subtly wrong.
//
// THE TRADEOFF, STATED. Between flushes the rows live only in this process. If
// a serverless instance is frozen or recycled with a batch buffered, those rows
// are lost -- at most one flush interval's worth of audit log, for one
// instance. That is the cost the item accepts in exchange for not putting two
// statements per request on a five-connection pool, and it is why the FIRST
// record after process start does not wait for the timer: the thin-traffic case
// (one request, then freeze) is the one where losing the row would actually be
// noticed, in the settings screen's "Last used" line.
//
// AND THE RATE LIMIT STILL COUNTS WHAT IS IN THE QUEUE. validateApiKey() counts
// rows in the trailing 60 s to enforce a key's limit. Buffering rows for five
// seconds would otherwise hand every key a five-second hole in which nothing it
// did had happened yet. pendingApiKeyRequestCount() exposes the queue's own
// unwritten rows so the check adds them to the DB count. Across instances the
// DB was always the only shared view, and that view now lags by up to one flush
// interval; within an instance the limit is exact.

/** One API-key request, as it will be written to compliance.api_key_request_log. */
export type ApiKeyUse = {
  apiKeyId: string
  orgId: string
  route: string
  method: string
  wasRateLimited: boolean
  /** When the request happened -- NOT when the row is flushed. */
  at: Date
}

export const FLUSH_INTERVAL_MS = 5_000
export const MAX_BUFFERED_ROWS = 100
export const LAST_USED_AT_THROTTLE_MS = 60_000

export type ApiKeyAuditDeps = {
  now: () => number
  insertRequestLog: (rows: ApiKeyUse[]) => Promise<unknown>
  touchLastUsedAt: (apiKeyId: string, at: Date) => Promise<unknown>
  /**
   * Runs `task` after the current turn -- Next's after() inside a request, so
   * the handler's response is sent first and the runtime still keeps the
   * function alive until the write finishes.
   */
  defer: (task: () => void) => void
  startTimer: (task: () => void, ms: number) => unknown
  cancelTimer: (handle: unknown) => void
  onError: (stage: "insert" | "last_used_at", error: unknown) => void
}

export type ApiKeyAuditRecorder = {
  /**
   * Buffers one request. Always resolves -- an audit write must never be able
   * to fail a caller's read, which is the whole reason this is a queue and not
   * an await.
   */
  recordApiKeyUse: (use: ApiKeyUse) => Promise<void>
  /** Writes everything buffered now. Always resolves. */
  flushNow: () => Promise<void>
  /** Buffered-but-unwritten rows for one key since `since`, for the rate limit. */
  pendingRequestCount: (apiKeyId: string, since: Date) => number
  /** Total rows waiting to be written, across all keys. */
  pendingRowCount: () => number
}

export function createApiKeyAuditRecorder(deps: ApiKeyAuditDeps): ApiKeyAuditRecorder {
  // Waiting to be written.
  const buffered: ApiKeyUse[] = []
  // Handed to the driver, not yet acknowledged. Tracked separately so a row
  // that is mid-INSERT is still visible to the rate limit -- otherwise the
  // window would have a hole exactly as wide as one round trip.
  const inFlight: ApiKeyUse[] = []
  const lastUsedAtWrittenAt = new Map<string, number>()

  let timer: unknown = null
  let deferPending = false
  let anyFlushScheduledYet = false
  // Serialises flushes: two concurrent multi-row INSERTs would put two more
  // statements on the pool this item exists to relieve.
  let flushChain: Promise<void> = Promise.resolve()

  function cancelTimerIfArmed(): void {
    if (timer === null) return
    deps.cancelTimer(timer)
    timer = null
  }

  function armTimer(): void {
    if (timer !== null) return
    timer = deps.startTimer(() => {
      timer = null
      void flush()
    }, FLUSH_INTERVAL_MS)
  }

  function scheduleImmediateFlush(): void {
    if (deferPending) return
    deferPending = true
    deps.defer(() => {
      deferPending = false
      void flush()
    })
  }

  function latestAtFor(batch: ApiKeyUse[], apiKeyId: string): Date {
    let latest = 0
    for (const row of batch) {
      if (row.apiKeyId !== apiKeyId) continue
      const t = row.at.getTime()
      if (t > latest) latest = t
    }
    return new Date(latest)
  }

  async function flushOnce(): Promise<void> {
    if (buffered.length === 0) return
    cancelTimerIfArmed()

    const batch = buffered.splice(0, buffered.length)
    inFlight.push(...batch)

    try {
      await deps.insertRequestLog(batch)
    } catch (error) {
      // Swallowed on purpose: a lost audit row is a smaller failure than a
      // failed customer request. The rows in this batch are dropped -- retrying
      // them would mean an unbounded in-memory queue on a serverless runtime
      // that can be frozen at any moment.
      deps.onError("insert", error)
    } finally {
      for (const row of batch) {
        const index = inFlight.indexOf(row)
        if (index !== -1) inFlight.splice(index, 1)
      }
    }

    const now = deps.now()
    const handled = new Set<string>()
    for (const row of batch) {
      if (handled.has(row.apiKeyId)) continue
      handled.add(row.apiKeyId)

      const writtenAt = lastUsedAtWrittenAt.get(row.apiKeyId)
      if (writtenAt !== undefined && now - writtenAt < LAST_USED_AT_THROTTLE_MS) continue
      // Recorded before the await, so a slow write cannot let a second one
      // through behind it.
      lastUsedAtWrittenAt.set(row.apiKeyId, now)

      try {
        await deps.touchLastUsedAt(row.apiKeyId, latestAtFor(batch, row.apiKeyId))
      } catch (error) {
        deps.onError("last_used_at", error)
      }
    }
  }

  function flush(): Promise<void> {
    flushChain = flushChain.then(flushOnce, flushOnce)
    return flushChain
  }

  return {
    async recordApiKeyUse(use: ApiKeyUse): Promise<void> {
      buffered.push(use)

      // The first request after process start does not wait for the timer: a
      // freshly deployed serverless instance may serve exactly one request and
      // then be frozen, and "this key has never been used" would be a lie the
      // settings screen shows for as long as traffic stays thin.
      if (!anyFlushScheduledYet || buffered.length >= MAX_BUFFERED_ROWS) {
        anyFlushScheduledYet = true
        scheduleImmediateFlush()
        return
      }

      armTimer()
    },

    flushNow(): Promise<void> {
      return flush()
    },

    pendingRequestCount(apiKeyId: string, since: Date): number {
      const cutoff = since.getTime()
      let count = 0
      for (const row of buffered) {
        if (row.apiKeyId === apiKeyId && row.at.getTime() >= cutoff) count += 1
      }
      for (const row of inFlight) {
        if (row.apiKeyId === apiKeyId && row.at.getTime() >= cutoff) count += 1
      }
      return count
    },

    pendingRowCount(): number {
      return buffered.length + inFlight.length
    },
  }
}

function deferOffTheHotPath(task: () => void): void {
  try {
    // Inside a request, this is the correct primitive: the response is sent
    // first and the runtime is still kept alive until the callback finishes,
    // which a bare setImmediate does not guarantee on a serverless platform.
    after(task)
    return
  } catch {
    // after() is only callable within a request scope (a background flush
    // triggered by the timer is not one, nor is a test or a script).
  }
  setImmediate(task)
}

function defaultDeps(): ApiKeyAuditDeps {
  return {
    now: () => Date.now(),
    insertRequestLog: async (rows) => {
      await db.insert(apiKeyRequestLog).values(
        rows.map((row) => ({
          apiKeyId: row.apiKeyId,
          orgId: row.orgId,
          route: row.route,
          method: row.method,
          wasRateLimited: row.wasRateLimited,
          // The request's own time. See this file's header.
          createdAt: row.at,
        }))
      )
    },
    touchLastUsedAt: async (apiKeyId, at) => {
      await db.update(apiKeys).set({ lastUsedAt: at }).where(eq(apiKeys.id, apiKeyId))
    },
    defer: deferOffTheHotPath,
    startTimer: (task, ms) => {
      const handle = setTimeout(task, ms)
      // Never hold a process open for an audit row: a CLI script or a test run
      // must be able to exit with a pending flush.
      ;(handle as unknown as { unref?: () => void }).unref?.()
      return handle
    },
    cancelTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    onError: (stage, error) => {
      console.error(`[api-key-audit] ${stage} write failed (non-fatal, rows dropped):`, error)
    },
  }
}

let defaultRecorder: ApiKeyAuditRecorder | null = null
function getDefaultRecorder(): ApiKeyAuditRecorder {
  if (!defaultRecorder) defaultRecorder = createApiKeyAuditRecorder(defaultDeps())
  return defaultRecorder
}

/** Records one API-key request for audit. Never throws, never blocks a read. */
export function recordApiKeyUse(use: ApiKeyUse): Promise<void> {
  return getDefaultRecorder().recordApiKeyUse(use)
}

/** Flushes the queue immediately. Never throws. */
export function flushApiKeyAuditNow(): Promise<void> {
  return getDefaultRecorder().flushNow()
}

/**
 * Requests for `apiKeyId` since `since` that are queued but not yet in the
 * database. The rate limiter adds this to its own DB count so buffering cannot
 * widen the window it enforces.
 */
export function pendingApiKeyRequestCount(apiKeyId: string, since: Date): number {
  return getDefaultRecorder().pendingRequestCount(apiKeyId, since)
}
