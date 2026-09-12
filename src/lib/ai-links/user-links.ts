// R63 (owner directive, 2026-08-29): per-user AI-delegation link. Deterministic,
// closed-ended contracts:
//   - a token resolves to exactly one (orgId, userId) or nothing (never
//     partial/ambiguous)
//   - a revoked token never resolves again, permanently
//   - generation is idempotent: one active link per user, never a second
//     live credential silently minted alongside an existing one
//
// PM-T34 (2026-09-10, DOD-T4 live finding): platform.user_ai_links carried
// only `app_runtime_full_access FOR ALL TO app_runtime USING (true)` -- no
// org_id restriction at all, a live cross-tenant read (2 rows, 2 distinct
// orgs, each visible to the other's tenant context). Fixed two different
// ways for two different reasons, both required:
//   - getOrCreateUserAiLink/revokeUserAiLink now run inside
//     withTenantContext() so the new org-scoped RLS policy
//     (drizzle/<PM-T34-part2-index>) actually applies to them, same as
//     every other tenant-scoped write in this codebase.
//   - resolveAiLinkToken cannot be wrapped the same way: its whole job is
//     to look up (orgId, userId) FROM an opaque bearer token, with no org
//     context to set beforehand -- that is a category error, not an
//     unwrapped caller (an org-scoped policy would deny every MCP tool
//     call in the platform, permanently, for every user). It calls
//     platform.rpc_resolve_ai_link_token() instead, a narrow SECURITY
//     DEFINER function (same drizzle file) that does the exact-equality
//     token lookup, the status='active' revocation check, AND the
//     lastUsedAt touch in ONE atomic UPDATE...RETURNING -- closing a
//     separate, real bug found in the same review: the old lastUsedAt
//     touch was a bare-db, no-tenant-context, fire-and-forget UPDATE with
//     a swallowing .catch(), which an org-scoped policy would have denied
//     silently (nothing throws, nothing logs to a user, lastUsedAt just
//     quietly stops advancing for every token in the platform). Folding
//     the touch into the same SECURITY DEFINER function removes that
//     bare-db write from the path entirely instead of making its failure
//     prettier.
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { db, userAiLinks } from '@/lib/db'
import { withTenantContext } from '@/lib/db/tenant-scoped'
import { and, eq, sql } from 'drizzle-orm'

export interface AiLinkIdentity {
  readonly orgId: string
  readonly userId: string
}

/** 256-bit random, base64url. Never derived from user_id/email/timestamp -- guessing one must be as hard as guessing a random 32-byte value. */
function generateToken(): string {
  return randomBytes(32).toString('base64url')
}

/**
 * Idempotent: returns the existing active link if one exists, else mints a
 * new one. Never mints a second active link for the same user (enforced
 * by pipeline_level_models-style DB constraint AND checked here first).
 */
export async function getOrCreateUserAiLink(orgId: string, userId: string): Promise<{ token: string; createdNow: boolean }> {
  return withTenantContext({ orgId, userId }, async (tx) => {
    const existing = await tx.query.userAiLinks.findFirst({
      where: and(eq(userAiLinks.orgId, orgId), eq(userAiLinks.userId, userId), eq(userAiLinks.status, 'active')),
    })
    if (existing) return { token: existing.token, createdNow: false }

    const token = generateToken()
    await tx.insert(userAiLinks).values({ orgId, userId, token, status: 'active' })
    return { token, createdNow: true }
  })
}

/**
 * Resolves a token to its owning (orgId, userId), or null if the token
 * doesn't exist or was revoked -- a revoked token behaves identically to a
 * never-issued one, permanently. Updates lastUsedAt as a side effect,
 * atomically, inside the same SECURITY DEFINER call (see this file's own
 * header) -- no longer a separate best-effort write.
 *
 * Deliberately uses the plain, no-tenant-context `db` connection, not
 * withTenantContext(): there is no org to set as context before this
 * lookup runs, by design -- resolving that is the entire point of the
 * call.
 */
export async function resolveAiLinkToken(token: string): Promise<AiLinkIdentity | null> {
  if (!token || token.length < 32) return null // fail fast on an obviously-malformed value, no DB round trip

  const rows = (await db.execute(
    sql`SELECT * FROM platform.rpc_resolve_ai_link_token(${token}::text)`
  )) as { org_id: string; user_id: string }[]
  const row = rows[0]
  if (!row) return null

  return { orgId: row.org_id, userId: row.user_id }
}

/**
 * Revokes the user's current active link, permanently -- rotation is
 * "revoke, then getOrCreateUserAiLink() mints a fresh one" (two calls, not
 * a single atomic rotate, matching this codebase's own preference for
 * small explicit steps over one do-everything function).
 */
export async function revokeUserAiLink(orgId: string, userId: string): Promise<boolean> {
  return withTenantContext({ orgId, userId }, async (tx) => {
    const result = await tx
      .update(userAiLinks)
      .set({ status: 'revoked', revokedAt: new Date() })
      .where(and(eq(userAiLinks.orgId, orgId), eq(userAiLinks.userId, userId), eq(userAiLinks.status, 'active')))
      .returning({ id: userAiLinks.id })
    return result.length > 0
  })
}

/** Constant-time comparison guard for any call site that ends up comparing two token strings directly (defense in depth -- the primary lookup above is a DB equality query, not a string compare, so this is a fallback, not the main path). */
export function tokensEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}
