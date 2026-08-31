// R63 (owner directive, 2026-08-29): per-user AI-delegation link. Deterministic,
// closed-ended contracts:
//   - a token resolves to exactly one (orgId, userId) or nothing (never
//     partial/ambiguous)
//   - a revoked token never resolves again, permanently
//   - generation is idempotent: one active link per user, never a second
//     live credential silently minted alongside an existing one
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { db, userAiLinks } from '@/lib/db'
import { and, eq } from 'drizzle-orm'

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
  const existing = await db.query.userAiLinks.findFirst({
    where: and(eq(userAiLinks.orgId, orgId), eq(userAiLinks.userId, userId), eq(userAiLinks.status, 'active')),
  })
  if (existing) return { token: existing.token, createdNow: false }

  const token = generateToken()
  await db.insert(userAiLinks).values({ orgId, userId, token, status: 'active' })
  return { token, createdNow: true }
}

/**
 * Resolves a token to its owning (orgId, userId), or null if the token
 * doesn't exist or was revoked -- a revoked token behaves identically to a
 * never-issued one, permanently. Updates lastUsedAt as a side effect
 * (best-effort, never blocks resolution on that write failing).
 */
export async function resolveAiLinkToken(token: string): Promise<AiLinkIdentity | null> {
  if (!token || token.length < 32) return null // fail fast on an obviously-malformed value, no DB round trip

  const row = await db.query.userAiLinks.findFirst({
    where: and(eq(userAiLinks.token, token), eq(userAiLinks.status, 'active')),
  })
  if (!row) return null

  db.update(userAiLinks).set({ lastUsedAt: new Date() }).where(eq(userAiLinks.id, row.id)).catch((err) => {
    console.error('[ai-links] lastUsedAt update failed (non-fatal):', err)
  })

  return { orgId: row.orgId, userId: row.userId }
}

/**
 * Revokes the user's current active link, permanently -- rotation is
 * "revoke, then getOrCreateUserAiLink() mints a fresh one" (two calls, not
 * a single atomic rotate, matching this codebase's own preference for
 * small explicit steps over one do-everything function).
 */
export async function revokeUserAiLink(orgId: string, userId: string): Promise<boolean> {
  const result = await db
    .update(userAiLinks)
    .set({ status: 'revoked', revokedAt: new Date() })
    .where(and(eq(userAiLinks.orgId, orgId), eq(userAiLinks.userId, userId), eq(userAiLinks.status, 'active')))
    .returning({ id: userAiLinks.id })
  return result.length > 0
}

/** Constant-time comparison guard for any call site that ends up comparing two token strings directly (defense in depth -- the primary lookup above is a DB equality query, not a string compare, so this is a fallback, not the main path). */
export function tokensEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}
