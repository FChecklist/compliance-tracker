// VERIDIAN Review Framework gap-closure (AI Model Lifecycle & Benchmarking,
// "Model deprecation/rollback process defined," 2026-08-15).
//
// Investigated first, see this PR's PROGRESS.md: orchestra-model-
// resolver.ts's ai_model_registry.status ('deprecated') and roster-
// overrides.ts's setRoleOverride/clearRoleOverride already make PER-ROW
// deprecation/rollback a DB action, not a git revert. mother-router.ts's
// rollbackPolicy() already exists for ai_routing_policies too (untouched
// here -- separate, already self-documented as dormant infrastructure,
// see that file's own header). None of those is a single "revert
// EVERYTHING to known-good code defaults, right now" switch: an operator
// dealing with a misbehaving model still has to find and individually
// clear every affected registry row / role override, or (for anything
// still only expressed in code) do a real git revert + deploy.
//
// This module is that switch. When active, orchestra-model-resolver.ts's
// getRoleModel() and roster-overrides.ts's resolveEffectiveModel() both
// skip their DB lookup entirely and return the hardcoded/static
// code-default model directly -- the same models that were live before
// ANY DB-driven override/registry entry existed. It does not delete or
// clear the underlying override/registry rows (those remain intact and
// resume taking effect the moment this flag is deactivated) -- it is a
// non-destructive, instantly reversible circuit breaker, not a rollback of
// the data itself.
//
// Append-only event log (ai_model_emergency_revert_log, schema.ts) --
// current state is derived as "was the most recent event an activation,"
// same posture as this codebase's other append-only audit tables
// (ai_routing_audit_log, activity_log). Short in-process TTL cache, same
// pattern as orchestra-model-resolver.ts's own roleRegistryCache /
// mother-router.ts's policyCache -- a flip is picked up on this process's
// next check once the TTL elapses, or immediately via
// invalidateEmergencyRevertCache(). Honest limitation, same class this
// codebase's other in-process caches already disclose: in a multi-instance
// deployment, invalidateEmergencyRevertCache() only clears the calling
// instance's own cache -- other running instances keep serving the
// pre-change state for up to CACHE_TTL_MS regardless.
import { db, aiModelEmergencyRevertLog } from "@/lib/db"
import { desc } from "drizzle-orm"

const CACHE_TTL_MS = 15_000 // short -- an emergency switch should propagate fast, not wait out a long TTL
let cached: { fetchedAt: number; active: boolean } | null = null

/** Forces the next isEmergencyRevertActive() check to re-read the DB instead of waiting out CACHE_TTL_MS. Call right after activate/deactivate so the SAME process's very next resolution reflects it immediately. */
export function invalidateEmergencyRevertCache(): void {
  cached = null
}

/**
 * Whether the platform-wide emergency revert is currently active. Fails
 * CLOSED to false (i.e. "not active, use normal DB-driven resolution") on
 * any DB error -- a transient hiccup reading this flag must never be the
 * reason every model resolution silently drops to the hardcoded fallback;
 * that would turn an availability blip into an unplanned mass model
 * downgrade, the opposite of this feature's own purpose.
 */
export async function isEmergencyRevertActive(): Promise<boolean> {
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.active

  try {
    const latest = await db.query.aiModelEmergencyRevertLog.findFirst({
      orderBy: desc(aiModelEmergencyRevertLog.createdAt),
    })
    const active = latest?.action === "activated"
    cached = { fetchedAt: Date.now(), active }
    return active
  } catch (err) {
    console.error("[ai-model-emergency-revert] failed to read ai_model_emergency_revert_log, failing CLOSED (treating as not active):", err)
    return false
  }
}

export type EmergencyRevertStatus = {
  active: boolean
  lastEvent: { action: string; triggeredByUserId: string | null; reason: string | null; createdAt: Date } | null
}

/** Read-only status for an admin surface: current active/inactive state plus the most recent event (whichever it was), so an admin can see who last flipped it and why. */
export async function getEmergencyRevertStatus(): Promise<EmergencyRevertStatus> {
  const latest = await db.query.aiModelEmergencyRevertLog.findFirst({
    orderBy: desc(aiModelEmergencyRevertLog.createdAt),
  })
  return {
    active: latest?.action === "activated",
    lastEvent: latest
      ? { action: latest.action, triggeredByUserId: latest.triggeredByUserId, reason: latest.reason, createdAt: latest.createdAt }
      : null,
  }
}

/** Activates the platform-wide emergency revert. Idempotent -- calling this again while already active just records another 'activated' event (a real, honest audit trail of every time an admin re-confirmed it), it does not error. */
export async function activateEmergencyRevert(triggeredByUserId: string, reason?: string): Promise<void> {
  await db.insert(aiModelEmergencyRevertLog).values({ action: "activated", triggeredByUserId, reason: reason ?? null })
  invalidateEmergencyRevertCache()
}

/** Deactivates the platform-wide emergency revert, returning model resolution to normal DB-driven (registry/override) behavior. */
export async function deactivateEmergencyRevert(triggeredByUserId: string, reason?: string): Promise<void> {
  await db.insert(aiModelEmergencyRevertLog).values({ action: "deactivated", triggeredByUserId, reason: reason ?? null })
  invalidateEmergencyRevertCache()
}
