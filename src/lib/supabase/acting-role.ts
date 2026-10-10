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
//
// PROJEXA-BUILD-001 U-49 (BR-219): the same lookup now also names the PERSON
// the Level 1 provider gate compares (resolvePipelineActor). The gate used to
// see `ctx.dbUser?.id` or, for PROJEXA's per-org key, the key's own id -- never
// a person. One resolution serves both, so the gate and the money redaction
// can never disagree about who is asking. Not requireActingPerson(): that
// refuses a key call naming nobody with a 400, which U-01d D1 rules out for
// these pipeline routes; and not resolveOptionalActingPerson(): that reads the
// headers only, while PROJEXA's composer sends the person as a body actorEmail.
import {
  readActingUserEmail,
  readActingUserId,
  resolveActingUser,
  type CombinedAuthContext,
} from "@/lib/supabase/auth-guard"

/** The acting person behind a pipeline request, and the role their figures are redacted against. */
export type PipelineActor = {
  /** compliance.users id of an active person, or null when none resolves. Never an API key's id. */
  personId: string | null
  role: string | null
}

/**
 * Who is asking, never an error.
 *
 * - Session caller: its own dbUser, unchanged.
 * - API-key caller that names the acting person (X-Acting-User /
 *   X-Acting-User-Email headers, or actorEmail in the body -- the D-05
 *   identity bridge): that person, via resolveActingUser(), the same
 *   mechanism dashboard/route.ts's resolveRoleForFinancialVisibility() uses.
 *   A named person who maps to no user, or to a deactivated one, gives nulls:
 *   the figures are redacted, the provider gate refuses, the request still runs.
 * - API-key caller that names nobody: nulls, for the same reasons.
 */
export async function resolvePipelineActor(
  ctx: CombinedAuthContext,
  request: { headers: Headers },
  body: Record<string, unknown>
): Promise<PipelineActor> {
  if (ctx.dbUser) return { personId: ctx.dbUser.id, role: ctx.dbUser.role }
  const actorId = readActingUserId(request)
  const bodyEmail = typeof body.actorEmail === "string" && body.actorEmail.trim() ? body.actorEmail.trim() : null
  const actorEmail = readActingUserEmail(request) ?? bodyEmail
  if (!actorId && !actorEmail) return { personId: null, role: null }
  // resolveActingUser()'s error (USER_NOT_LINKED, USER_DEACTIVATED, a
  // deactivated actorEmail) is read here as "no known person", not returned.
  const { user } = await resolveActingUser(ctx, actorEmail, actorId)
  return { personId: user?.id ?? null, role: user?.role ?? null }
}

/** The role the construction figures are redacted against -- resolvePipelineActor's role. Never an error. */
export async function resolveFinancialRole(
  ctx: CombinedAuthContext,
  request: { headers: Headers },
  body: Record<string, unknown>
): Promise<string | null> {
  return (await resolvePipelineActor(ctx, request, body)).role
}
