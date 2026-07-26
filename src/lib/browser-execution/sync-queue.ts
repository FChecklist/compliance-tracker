// VERIDIAN_Architecture_v2.0 phase_5: engine-browser-sync. A small,
// real, in-memory-plus-localStorage retry queue for browser-computed
// outcomes whose server hand-off (the existing /api/tasks or
// /api/conversations/*/messages POST -- unchanged by this phase) failed,
// most commonly because the browser was offline. Not a general offline
// mode: VeriComposer's existing dispatch logic still owns the real
// request; this queue only remembers "this one didn't make it" and
// retries the same caller-supplied send function once the browser
// reports being back online.
export type SyncQueueEntry<T> = { id: string; payload: T; createdAt: number; attempts: number }

export function isOnline(): boolean {
  // Fail open (assume online) in any non-browser context (SSR, tests) --
  // this is a UX nicety for the real browser, not a correctness boundary.
  return typeof navigator === "undefined" || navigator.onLine !== false
}

const STORAGE_KEY = "veridian-browser-execution-sync-queue"

function readPersisted<T>(): SyncQueueEntry<T>[] {
  try {
    if (typeof localStorage === "undefined") return []
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as SyncQueueEntry<T>[]) : []
  } catch {
    return []
  }
}

function writePersisted<T>(entries: SyncQueueEntry<T>[]): void {
  try {
    if (typeof localStorage === "undefined") return
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
  } catch {
    // best-effort persistence only -- a write failure (quota, disabled
    // storage) just means the queue doesn't survive a page reload, never
    // a broken request.
  }
}

export class SyncQueue<T> {
  private queue: SyncQueueEntry<T>[]

  constructor(private readonly send: (payload: T) => Promise<boolean>) {
    this.queue = readPersisted<T>()
  }

  enqueue(id: string, payload: T, now: number = Date.now()): void {
    this.queue = [...this.queue.filter((e) => e.id !== id), { id, payload, createdAt: now, attempts: 0 }]
    writePersisted(this.queue)
  }

  size(): number {
    return this.queue.length
  }

  /** Attempts to flush every queued entry via `send`; entries that fail stay queued (with an incremented attempt count) for the next flush. Never throws -- a failed flush just leaves the queue as-is. */
  async flushAll(): Promise<{ flushed: number; remaining: number }> {
    if (!isOnline() || this.queue.length === 0) return { flushed: 0, remaining: this.queue.length }
    const remaining: SyncQueueEntry<T>[] = []
    let flushed = 0
    for (const entry of this.queue) {
      try {
        const ok = await this.send(entry.payload)
        if (ok) flushed++
        else remaining.push({ ...entry, attempts: entry.attempts + 1 })
      } catch {
        remaining.push({ ...entry, attempts: entry.attempts + 1 })
      }
    }
    this.queue = remaining
    writePersisted(this.queue)
    return { flushed, remaining: remaining.length }
  }
}
