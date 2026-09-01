// R42 seq20 (M29 S1) -- create/lock/autosave/activate/discard, the draft
// lifecycle every OBJECT screen's Edit mode goes through (seq21 wires a real
// UI to this; this file is the mechanics, DB-backed, independent of any
// component).
//
// Lifecycle (M29): Edit -> copy active into screen_drafts + 15-min lock
// (extended on activity) -> autosave debounced ~2s (caller's job to debounce;
// this file just persists whatever payload arrives) -> Save = validate
// server-side (caller's job), write active, DELETE draft, release lock,
// RE-SELECT AND CONFIRM PERSISTENCE (E-52, caller's write + re-select) ->
// Cancel = confirm (UI) then discard -> LEAVE WITHOUT SAVING = draft kept.
import { and, eq, lt, or, isNull } from "drizzle-orm";
import { withTenantContext } from "@/lib/db/tenant-scoped";
import { screenDrafts } from "@/lib/db/schema";

const LOCK_DURATION_MS = 15 * 60 * 1000; // M29: "Lock timeout 15 min default"

export class DraftLockedError extends Error {
  constructor(public lockedUntil: Date) {
    super(`This is locked by another user until ${lockedUntil.toISOString()}`);
  }
}

export type StartDraftInput = {
  orgId: string;
  userId: string;
  functionId: string;
  objectId: string | null; // null = create mode
  initialPayload: Record<string, unknown>;
};

/**
 * Edit -> take (or extend) the lock and (re)write the draft payload.
 * *** THE DB, NOT THIS FUNCTION, IS WHAT ENFORCES "NEVER TWO DRAFTS ON ONE
 * ENTITY" *** -- screen_drafts_function_object_unique (the migration's own
 * partial unique index). This function's own pre-check below is a courtesy
 * (a clean 409/DraftLockedError instead of a raw 23505), not the real
 * safety mechanism.
 */
export async function startDraft(input: StartDraftInput) {
  return withTenantContext({ orgId: input.orgId, userId: input.userId }, async (db) => {
    if (input.objectId) {
      const existing = await db.query.screenDrafts.findFirst({
        where: and(eq(screenDrafts.functionId, input.functionId), eq(screenDrafts.objectId, input.objectId)),
      });
      if (existing) {
        const stillLocked = existing.lockExpiresAt && existing.lockExpiresAt.getTime() > Date.now();
        if (stillLocked && existing.userId !== input.userId) {
          throw new DraftLockedError(existing.lockExpiresAt!);
        }
        // Same user resuming, or an expired lock a new editor may take over.
        const [row] = await db
          .update(screenDrafts)
          .set({ userId: input.userId, payload: input.initialPayload, lockExpiresAt: new Date(Date.now() + LOCK_DURATION_MS), updatedAt: new Date() })
          .where(eq(screenDrafts.id, existing.id))
          .returning();
        return row;
      }
    }
    const [row] = await db
      .insert(screenDrafts)
      .values({
        orgId: input.orgId,
        userId: input.userId,
        functionId: input.functionId,
        objectId: input.objectId,
        payload: input.initialPayload,
        lockExpiresAt: new Date(Date.now() + LOCK_DURATION_MS),
      })
      .returning();
    return row;
  });
}

/** Autosave: persist the payload and extend the lock (caller debounces ~2s -- this function does no timing of its own). */
export async function autosaveDraft(ctx: { orgId: string; userId: string }, draftId: string, payload: Record<string, unknown>) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const [row] = await db
      .update(screenDrafts)
      .set({ payload, lockExpiresAt: new Date(Date.now() + LOCK_DURATION_MS), updatedAt: new Date() })
      .where(and(eq(screenDrafts.id, draftId), eq(screenDrafts.userId, ctx.userId)))
      .returning();
    return row ?? null;
  });
}

/**
 * Save: caller's writeActive() does the real server-side validate + write to
 * the active table (and its own RE-SELECT, E-52) -- this function's own job
 * is only to delete the draft and release the lock once that succeeds, never
 * before.
 */
export async function activateDraft<T>(ctx: { orgId: string; userId: string }, draftId: string, writeActive: (payload: Record<string, unknown>) => Promise<T>): Promise<T> {
  const draft = await withTenantContext({ orgId: ctx.orgId }, (db) => db.query.screenDrafts.findFirst({ where: eq(screenDrafts.id, draftId) }));
  if (!draft) throw new Error(`draft "${draftId}" not found`);

  const result = await writeActive(draft.payload as Record<string, unknown>);

  await withTenantContext({ orgId: ctx.orgId }, (db) => db.delete(screenDrafts).where(eq(screenDrafts.id, draftId)));
  return result;
}

/** Cancel: the confirmation itself is a UI concern (M29) -- this just discards once confirmed. */
export async function discardDraft(ctx: { orgId: string; userId: string }, draftId: string) {
  return withTenantContext({ orgId: ctx.orgId }, (db) => db.delete(screenDrafts).where(and(eq(screenDrafts.id, draftId), eq(screenDrafts.userId, ctx.userId))));
}

/** For the header message strip (M31): "This is locked by Suresh until 14:32." Null when unlocked or expired. */
export async function findActiveLock(orgId: string, functionId: string, objectId: string) {
  return withTenantContext({ orgId }, async (db) => {
    const row = await db.query.screenDrafts.findFirst({
      where: and(eq(screenDrafts.functionId, functionId), eq(screenDrafts.objectId, objectId)),
    });
    if (!row || !row.lockExpiresAt || row.lockExpiresAt.getTime() <= Date.now()) return null;
    return { userId: row.userId, lockExpiresAt: row.lockExpiresAt };
  });
}

/** GC (M29: "Stale drafts garbage-collected, SAP default 30 days") -- create-mode drafts (object_id null) with no activity in 30 days. Wired to a cron in a future seq if volume ever warrants it; exported now so it exists and is callable/testable ahead of that. */
export async function garbageCollectStaleDrafts(orgId: string) {
  const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
  return withTenantContext({ orgId }, (db) =>
    db.delete(screenDrafts).where(and(eq(screenDrafts.orgId, orgId), or(isNull(screenDrafts.lockExpiresAt), lt(screenDrafts.lockExpiresAt, new Date(Date.now() - THIRTY_DAYS_MS)))))
  );
}
