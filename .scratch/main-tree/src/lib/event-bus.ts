// Phase 3 (Phase3_Design_by_Claude.md, event bus decision). A typed,
// in-process pub/sub for decoupling "something happened" from "who reacts
// to it" WITHIN one request's lifecycle -- deliberately NOT a durable
// cross-invocation queue. This app runs on Vercel serverless functions with
// no shared memory across invocations, so a real durable bus needs a
// backing table (outbox pattern) and a worker/poller -- that's genuinely
// out of scope for this pass (see design doc). Building a fake "durable"
// bus on an in-memory Map would silently drop events on every cold start,
// a worse failure mode than today's hand-wired direct function calls.
//
// Fault isolation matches webhook-deliver.ts's existing external-fan-out
// principle, applied internally: one throwing subscriber never breaks the
// publisher or any other subscriber.
//
// Add new event names to VeridianEventMap as real consumers need them --
// this file ships with zero production call sites wired in yet, on
// purpose. See design doc for why.
export type VeridianEventMap = {
  "task.created": { orgId: string; taskId: string }
  "loop.improvement_proposed": { loopId: string; improvementType: string; targetId: string | null }
}

type Handler<T> = (payload: T) => void | Promise<void>

const listeners = new Map<keyof VeridianEventMap, Set<Handler<unknown>>>()

export function subscribe<K extends keyof VeridianEventMap>(
  event: K,
  handler: Handler<VeridianEventMap[K]>
): () => void {
  const set = listeners.get(event) ?? new Set<Handler<unknown>>()
  set.add(handler as Handler<unknown>)
  listeners.set(event, set)
  return () => {
    set.delete(handler as Handler<unknown>)
  }
}

export async function publish<K extends keyof VeridianEventMap>(
  event: K,
  payload: VeridianEventMap[K]
): Promise<void> {
  const set = listeners.get(event)
  if (!set || set.size === 0) return
  await Promise.all(
    Array.from(set).map(async (handler) => {
      try {
        await handler(payload)
      } catch (err) {
        console.error(`[event-bus] subscriber to "${String(event)}" threw:`, err)
      }
    })
  )
}

// Test-only escape hatch -- clears all listeners between test cases so
// subscriptions from one test can't leak into another.
export function _clearAllListenersForTests(): void {
  listeners.clear()
}
