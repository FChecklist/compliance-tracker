// Priority 8 (14-priority8-close-tree1-remaining-gaps.yaml, GAP-SESSION-
// LIMIT / U-D27.B1.S1): "max 2 concurrent sessions per license (1 laptop +
// 1 mobile)", exempted for VERIDIAN's own internal use/testing. Built
// directly by the Super Boss (not a subagent) -- this is called from
// auth-guard.ts's requireAuth(), the single central auth chokepoint every
// route in the app depends on.
//
// Deliberately safe design, stated once here rather than repeated at every
// call site: this module NEVER force-invalidates an existing live session.
// recordSessionAndCheckLimit() only ever returns a decision; the caller
// (auth-guard.ts) is the one that decides whether to block a brand-new
// session. An already-tracked session (one whose hash is already in the
// table) is never blocked by this check, even if the org is now over its
// limit for other reasons (e.g. the admin lowered maxConcurrentSessions) --
// only a genuinely NEW device attempting to establish a NEW session can be
// rejected. This avoids ever surprising a user with an unexpected logout.
import { createHash } from "node:crypto"
import { and, eq, gte } from "drizzle-orm"
import { db, userActiveSessions } from "@/lib/db"

const STALE_SESSION_WINDOW_MS = 30 * 24 * 60 * 60 * 1000 // 30 days -- sessions not seen in this window don't count toward the limit

export function hashSessionToken(accessToken: string): string {
  return createHash("sha256").update(accessToken).digest("hex")
}

// Best-effort only, per this module's own header -- a wrong guess here never
// blocks anything, it only affects the informational deviceLabel column.
export function classifyDeviceLabel(userAgent: string | null): "mobile" | "desktop" | "unknown" {
  if (!userAgent) return "unknown"
  return /mobile|android|iphone|ipad|ipod/i.test(userAgent) ? "mobile" : "desktop"
}

export type SessionLimitCheck =
  | { allowed: true; reason: "not_enforced" | "exempt" | "already_tracked" | "within_limit" }
  | { allowed: false; reason: "over_limit"; activeSessionCount: number; maxConcurrentSessions: number }

/**
 * Called once per request from requireAuth(), after the org/enforcement
 * flags are already known. Upserts this session's lastSeenAt (cheap,
 * indexed on user_id) and, ONLY for a session not seen before, checks
 * whether adding it would exceed the org's configured limit.
 */
export async function recordSessionAndCheckLimit(params: {
  userId: string
  orgId: string
  accessToken: string
  userAgent: string | null
  enforcementEnabled: boolean
  internalUseExempt: boolean
  maxConcurrentSessions: number
}): Promise<SessionLimitCheck> {
  if (!params.enforcementEnabled) return { allowed: true, reason: "not_enforced" }
  if (params.internalUseExempt) return { allowed: true, reason: "exempt" }

  const sessionTokenHash = hashSessionToken(params.accessToken)

  const existing = await db.query.userActiveSessions.findFirst({
    where: and(eq(userActiveSessions.userId, params.userId), eq(userActiveSessions.sessionTokenHash, sessionTokenHash)),
  })

  if (existing) {
    // Already-tracked session -- never blocked, just refresh lastSeenAt.
    await db.update(userActiveSessions).set({ lastSeenAt: new Date() }).where(eq(userActiveSessions.id, existing.id))
    return { allowed: true, reason: "already_tracked" }
  }

  // A genuinely new session for this user -- count how many OTHER sessions
  // are still recent enough to count as active before deciding whether this
  // one can be added.
  const staleCutoff = new Date(Date.now() - STALE_SESSION_WINDOW_MS)
  const activeSessions = await db.query.userActiveSessions.findMany({
    where: and(eq(userActiveSessions.userId, params.userId), gte(userActiveSessions.lastSeenAt, staleCutoff)),
    columns: { id: true },
  })

  if (activeSessions.length >= params.maxConcurrentSessions) {
    return { allowed: false, reason: "over_limit", activeSessionCount: activeSessions.length, maxConcurrentSessions: params.maxConcurrentSessions }
  }

  await db.insert(userActiveSessions).values({
    userId: params.userId,
    orgId: params.orgId,
    sessionTokenHash,
    deviceLabel: classifyDeviceLabel(params.userAgent),
    userAgent: params.userAgent,
  }).onConflictDoNothing()

  return { allowed: true, reason: "within_limit" }
}
