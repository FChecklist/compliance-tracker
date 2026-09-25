// PROJEXA-BUILD-001 U-01b (2026-09-25): the one place a /api/v1/projexa route
// works out WHOSE role the construction financial redaction runs against.
// U-01 wrote this inside api/v1/projexa/assistant/route.ts; tasks/route.ts and
// submissions/route.ts reach the same pipeline with the same per-org API key
// and still passed `ctx.dbUser?.role ?? null` -- always null for that key, so
// every PROJEXA user, manager or not, got the figures redacted (and before
// U-01, shown). Moved here so all three routes apply one rule.
//
// U-01d (2026-09-25, PM decision D1): this REDACTS, it never REFUSES. U-01 and
// U-01b passed resolveActingUser()'s 400 USER_NOT_LINKED back to the caller
// when the named person mapped to no user. 22 of 114 PROJEXA users have no
// linked VERIDIAN user, so that turned their working requests into errors
// just for asking. The return type now carries a role and nothing else: every
// outcome that is not an active, resolved person reads as null, and null
// means the figures come back redacted while the request runs as before.
// resolveActingUser() itself is unchanged, and so is every other caller of it
// (tasks/route.ts's resolveActorUserId included) -- only this figure-visibility
// use of it is soft.
import {
  readActingUserEmail,
  readActingUserId,
  resolveActingUser,
  type CombinedAuthContext,
} from "@/lib/supabase/auth-guard"

/**
 * The role the construction figures are redacted against. Never an error.
 *
 * - Session caller: its own dbUser.role, unchanged.
 * - API-key caller that names the acting person (X-Acting-User /
 *   X-Acting-User-Email headers, or actorEmail in the body -- the D-05
 *   identity bridge): that person's role, via resolveActingUser(), the same
 *   mechanism dashboard/route.ts's resolveRoleForFinancialVisibility() uses.
 *   A named person who maps to no user, or to a deactivated one, gives null:
 *   the figures are redacted and the request still runs.
 * - API-key caller that names nobody: null, and the figures come back
 *   redacted. Not an error -- the request still gets its answer.
 */
export async function resolveFinancialRole(
  ctx: CombinedAuthContext,
  request: { headers: Headers },
  body: Record<string, unknown>
): Promise<string | null> {
  if (ctx.dbUser) return ctx.dbUser.role
  const actorId = readActingUserId(request)
  const bodyEmail = typeof body.actorEmail === "string" && body.actorEmail.trim() ? body.actorEmail.trim() : null
  const actorEmail = readActingUserEmail(request) ?? bodyEmail
  if (!actorId && !actorEmail) return null
  // resolveActingUser()'s error (USER_NOT_LINKED, USER_DEACTIVATED, a
  // deactivated actorEmail) is read here as "no known role", not returned.
  const { user } = await resolveActingUser(ctx, actorEmail, actorId)
  return user?.role ?? null
}
