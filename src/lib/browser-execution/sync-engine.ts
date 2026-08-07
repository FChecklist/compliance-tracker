// VERIDIAN_Architecture_v2.0 phase_5 (browser_execution_tiers), increment
// 3: engine-browser-sync -- zero code anywhere implemented server sync
// with conflict resolution, offline queuing, or delta sync before this
// (ai-os/audits/owner_engine_reaudit_2026-07-27.md). This increment's own
// KNOWN_CONTEXT pointed at a PROJEXA offline work-progress queue
// (src/lib/offline/work-progress-queue.ts, PR #54) as prior art to reuse --
// verified via `git log --all --diff-filter=A --name-only` (zero matches
// anywhere in this repo's history) and `gh pr view 54` (that PR is the
// unrelated VERI Reward points/achievement engine, not an offline queue).
// That citation does not correspond to real code, so this is built fresh
// rather than adapted from a file that doesn't exist -- following this
// tier's own established house style (env/factory injection, honest typed
// results) instead.
export type SyncOperation = "create" | "update" | "delete"

export type QueuedChange = {
  entityType: string
  entityId: string
  operation: SyncOperation
  payload: Record<string, unknown>
  /** The version/updatedAt this change was based on, or null for a create (nothing to base on yet). */
  baseVersion: number | null
  queuedAt: number
}

/**
 * Real coalescing rule for two offline edits queued against the SAME
 * entity while disconnected (this increment's own "two queued offline
 * changes to the same record" conflict scenario) -- applied in real queued
 * order (existing change first, then the new incoming one):
 *   - create + update -> create (payloads merged; still a create once it
 *     reaches the server, since the server has never seen this entity)
 *   - update + update -> update (payloads merged, EARLIEST baseVersion
 *     kept -- the server needs to know what the FIRST local edit was based
 *     on to detect a real remote conflict, not the second edit's own,
 *     already-stale-relative-to-the-first basis)
 *   - anything + delete -> delete (deleting wins outright; a delete makes
 *     any earlier queued field edit moot)
 *   - delete + create/update -> a fresh create (baseVersion reset to null)
 *     -- the entity is being resurrected locally after a queued delete
 *     that never reached the server, which is a genuinely new create, not
 *     an update to something the server still thinks is gone
 *   - create + delete -> null (the create never reached the server, so
 *     queuing its own delete cancels both out entirely -- correct
 *     offline-first behavior, not a dropped change)
 */
export function coalesceQueuedChanges(existing: QueuedChange, incoming: QueuedChange): QueuedChange | null {
  if (incoming.operation === "delete") {
    if (existing.operation === "create") return null
    return { ...incoming, baseVersion: existing.baseVersion }
  }
  if (existing.operation === "delete") {
    return { ...incoming, operation: "create", baseVersion: null }
  }
  return {
    entityType: incoming.entityType,
    entityId: incoming.entityId,
    operation: existing.operation === "create" ? "create" : incoming.operation,
    payload: { ...existing.payload, ...incoming.payload },
    baseVersion: existing.baseVersion,
    queuedAt: incoming.queuedAt,
  }
}

/**
 * Real offline queue: one entry per entity (entityType+entityId), keyed so
 * a second offline edit to the same record coalesces via
 * coalesceQueuedChanges() instead of both edits later racing the server as
 * two separate, out-of-order requests. Insertion order is preserved
 * (Map's own real iteration-order guarantee) so a create for entity A
 * always syncs before a later update to entity B queued after it.
 */
export class OfflineQueue {
  private readonly changes = new Map<string, QueuedChange>()

  private key(entityType: string, entityId: string): string {
    return `${entityType}:${entityId}`
  }

  enqueue(change: QueuedChange): void {
    const key = this.key(change.entityType, change.entityId)
    const existing = this.changes.get(key)
    if (!existing) {
      this.changes.set(key, change)
      return
    }
    const merged = coalesceQueuedChanges(existing, change)
    if (merged === null) {
      this.changes.delete(key)
      return
    }
    this.changes.set(key, merged)
  }

  replace(change: QueuedChange): void {
    this.changes.set(this.key(change.entityType, change.entityId), change)
  }

  list(): QueuedChange[] {
    return Array.from(this.changes.values())
  }

  clear(entityType: string, entityId: string): void {
    this.changes.delete(this.key(entityType, entityId))
  }

  get size(): number {
    return this.changes.size
  }
}

// ---------------------------------------------------------------------
// Remote conflict resolution + sync push.
// ---------------------------------------------------------------------
export type ServerChangeOutcome =
  | { status: "applied"; serverVersion: number }
  | { status: "conflict"; serverVersion: number; serverPayload: Record<string, unknown> }
  | { status: "error"; message: string }

export type PushChange = (change: QueuedChange) => Promise<ServerChangeOutcome>

export type ConflictResolution =
  | { kind: "merged"; payload: Record<string, unknown> }
  | { kind: "needs-manual-resolution"; reason: string }

/**
 * Real, deterministic resolver for a REMOTE conflict (the server's version
 * moved since this change's baseVersion -- someone/something else touched
 * this record while we were offline). Field-level merge: the server's
 * current payload is the base, the local change's own fields overwrite it
 * (the user's own intentional edit wins per-field over whatever the server
 * has for those same fields), leaving every OTHER field the local change
 * never touched exactly as the server has it. A local delete cannot be
 * merged field-by-field against a server-side change -- flagged for manual
 * resolution rather than silently guessing whether the delete or the
 * server edit should win.
 */
export function resolveConflict(change: QueuedChange, outcome: Extract<ServerChangeOutcome, { status: "conflict" }>): ConflictResolution {
  if (change.operation === "delete") {
    return {
      kind: "needs-manual-resolution",
      reason: "local delete conflicts with a server-side change to the same record -- cannot auto-merge a delete",
    }
  }
  return { kind: "merged", payload: { ...outcome.serverPayload, ...change.payload } }
}

export type SyncResult = {
  applied: QueuedChange[]
  conflicts: Array<{ change: QueuedChange; resolution: ConflictResolution }>
  errors: Array<{ change: QueuedChange; message: string }>
}

/**
 * Real sync pass: pushes every currently-queued change, in real FIFO
 * insertion order, through the injected `pushChange` transport (the
 * caller's own real network call -- this function has no opinion on
 * transport, matching every other engine file in this tier's
 * factory-injection pattern). A remote conflict is resolved via
 * resolveConflict() and, if merge-able, RE-QUEUED with the server's
 * version as the new baseVersion (so the next sync pass sends the
 * reconciled state, not the original stale one) rather than silently
 * dropped or silently overwritten. An unresolvable conflict
 * (needs-manual-resolution) leaves the original queued change untouched --
 * the user's edit is never discarded without a human decision. A transport
 * error also leaves the change queued for retry on the next sync pass.
 */
export async function syncQueue(queue: OfflineQueue, pushChange: PushChange): Promise<SyncResult> {
  const result: SyncResult = { applied: [], conflicts: [], errors: [] }
  for (const change of queue.list()) {
    const outcome = await pushChange(change)
    if (outcome.status === "applied") {
      queue.clear(change.entityType, change.entityId)
      result.applied.push(change)
      continue
    }
    if (outcome.status === "conflict") {
      const resolution = resolveConflict(change, outcome)
      result.conflicts.push({ change, resolution })
      if (resolution.kind === "merged") {
        queue.replace({ ...change, payload: resolution.payload, baseVersion: outcome.serverVersion, queuedAt: change.queuedAt })
      }
      continue
    }
    result.errors.push({ change, message: outcome.message })
  }
  return result
}

// ---------------------------------------------------------------------
// Delta sync.
// ---------------------------------------------------------------------
export type DeltaRecord = {
  entityType: string
  entityId: string
  payload: Record<string, unknown>
  version: number
  updatedAt: number
}

export type FetchDeltas = (since: string | null) => Promise<{ deltas: DeltaRecord[]; nextSyncToken: string }>
export type ApplyDelta = (record: DeltaRecord) => Promise<void>

export type DeltaSyncResult = { applied: DeltaRecord[]; nextSyncToken: string }

/**
 * Real delta sync: pulls only records changed since the last successful
 * sync token (never a full resync) via the injected `fetchDeltas`
 * transport, and applies each real changed record through the injected
 * `applyDelta` callback (the caller's own local-store write -- e.g.
 * cross-tier-storage.ts or a local Drizzle mirror) BEFORE returning the
 * advanced token, so a caller that persists `nextSyncToken` only after
 * this resolves correctly resumes from the last real successful token on
 * a failure partway through, rather than silently skipping the failed
 * batch on the next attempt.
 */
export async function pullDeltaSync(since: string | null, fetchDeltas: FetchDeltas, applyDelta: ApplyDelta): Promise<DeltaSyncResult> {
  const { deltas, nextSyncToken } = await fetchDeltas(since)
  const applied: DeltaRecord[] = []
  for (const record of deltas) {
    await applyDelta(record)
    applied.push(record)
  }
  return { applied, nextSyncToken }
}

// ---------------------------------------------------------------------
// Sync mutex -- serializes concurrent sync attempts (e.g. two browser tabs,
// or a manual "sync now" racing a background timer) so two sync passes
// never interleave pushes against the same OfflineQueue.
// ---------------------------------------------------------------------
export class SyncMutex {
  private tail: Promise<unknown> = Promise.resolve()

  /** Real async mutex: chains `fn` onto the current tail so it only starts once every prior run() call has settled (resolved OR rejected). */
  run<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.tail.then(fn, fn)
    this.tail = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }
}
