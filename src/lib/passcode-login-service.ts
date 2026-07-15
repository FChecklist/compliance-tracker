// Priority 14 Wave 2 (GAP-AUTH-REBUILD, Owner directive 2026-07-14/15 via
// AskUserQuestion): an ADDITIVE 4-digit return-login passcode, alongside
// the existing password/magic-link/Google-OAuth/SSO methods in
// src/app/login/login-form.tsx -- never a replacement. A user opts in from
// Settings (PasscodeSection.tsx) only once they already have a real
// compliance.users row -- first-time signup still requires one of the
// existing identity-proving methods (autoProvisionUser()'s
// stage0Token/inviteToken/orgJoinCode/default branches in auth-guard.ts).
// This file never creates a user or an org; it only authenticates an
// EXISTING one, so it composes with autoProvisionUser() by construction --
// nothing here runs before or instead of it.
//
// Security properties, stated plainly for review (matches this codebase's
// own established discipline, see org-join-code-service.ts's header):
//
//   - hashed at rest: only passcodeHash (bcrypt, cost 10 -- same library
//     and cost factor already used by src/app/api/users/route.ts and
//     src/db/seed.ts) is ever persisted. The raw 4-digit passcode is never
//     stored, logged, or returned by any route.
//   - honest limitation on hashing alone, named rather than oversold: a
//     4-digit passcode has only 10,000 possible values. bcrypt at cost 10
//     protects against casual inspection of a DB dump, but if
//     users.passcodeHash ever actually leaked, an OFFLINE attacker with
//     the hash could exhaust the full keyspace in well under a minute even
//     at that cost factor -- no hash algorithm changes that fact for a
//     4-digit input space. The real defense here is the ONLINE
//     rate-limiting below (which a leaked hash doesn't bypass, since
//     verifying it offline requires the hash itself, a much higher bar
//     than the online guess this feature actually exposes) plus this
//     being an opt-in, faster-login-only convenience whose blast radius is
//     explicitly capped by the "never a recovery mechanism" property
//     below.
//   - rate-limited, and DUAL-keyed (not IP-only): every attempt (success
//     or failure) is logged to passcode_login_attempts, keyed by both the
//     submitted email and the requester IP. checkPasscodeRateLimit blocks
//     further attempts once EITHER dimension's failure count inside
//     RATE_LIMIT_WINDOW_MINUTES crosses its limit --
//     RATE_LIMIT_MAX_FAILURES_PER_EMAIL (stricter, 5) is the primary
//     defense and survives an attacker rotating source IPs (unlike
//     org-join-code-service.ts's IP-only precedent, which is safe for its
//     own ~5.3x10^17-value keyspace but would NOT be enough for a 4-digit
//     code); RATE_LIMIT_MAX_FAILURES_PER_IP (looser, 20) is a secondary
//     defense against one source spraying guesses across many target
//     emails. Concretely: 5 failures/15min against one email means
//     exhausting the full 10,000-value keyspace against a single account
//     takes a minimum of (10000/5)*15 minutes =~ 20.8 days of continuous,
//     uninterrupted attempts -- and every one of those attempts is logged.
//   - NEVER a recovery/reset mechanism: setPasscode/removePasscode below
//     are only ever called from requireAuth()-gated Settings routes
//     (POST/DELETE /api/settings/passcode) -- there is no "forgot my
//     passcode" flow that uses the passcode itself to prove anything. A
//     user who forgets their passcode logs in the normal way (magic-link/
//     Google/password/SSO) and resets it from Settings, exactly like
//     every other account-recovery path in this codebase already works.
//     Passcode login (verifyPasscodeLogin below) never grants more than
//     the SAME session a magic-link click would -- it does not skip any
//     later auth-guard.ts check (isActive/revocation/session-limit all
//     still run on requireAuth(), unchanged, the next time the new session
//     hits an authenticated route).
//   - generic failure responses: user-not-found, passcode-not-enabled, and
//     wrong-passcode all return the identical `{ ok: false, reason:
//     "invalid" }` -- distinguishing them would leak account existence /
//     enrollment state to an unauthenticated caller, the same posture
//     org-join-code-service.ts's redemption path already takes for its own
//     pre-auth lookups.
import { db, users, passcodeLoginAttempts } from "@/lib/db"
import { eq, and, gte, sql } from "drizzle-orm"
import bcrypt from "bcryptjs"

export const PASSCODE_LENGTH = 4
const BCRYPT_COST = 10

const RATE_LIMIT_WINDOW_MINUTES = 15
const RATE_LIMIT_MAX_FAILURES_PER_EMAIL = 5
const RATE_LIMIT_MAX_FAILURES_PER_IP = 20

/** Pure -- exactly 4 digits, nothing else (no leading/trailing whitespace tolerated; callers trim before calling if needed). */
export function isValidPasscodeFormat(passcode: string): boolean {
  return /^\d{4}$/.test(passcode)
}

export async function hashPasscode(passcode: string): Promise<string> {
  return bcrypt.hash(passcode, BCRYPT_COST)
}

export async function verifyPasscodeHash(passcode: string, hash: string): Promise<boolean> {
  return bcrypt.compare(passcode, hash)
}

export type SetPasscodeResult = { ok: true } | { ok: false; reason: string }

/**
 * Sets/changes the caller's passcode. Only ever called from a
 * requireAuth()-gated route (POST /api/settings/passcode) -- userId must
 * come from an already-authenticated session, never from unauthenticated
 * input, so this can never be used to set a passcode on someone else's
 * account.
 */
export async function setPasscode(userId: string, passcode: string): Promise<SetPasscodeResult> {
  if (!isValidPasscodeFormat(passcode)) {
    return { ok: false, reason: "Passcode must be exactly 4 digits." }
  }
  const passcodeHash = await hashPasscode(passcode)
  await db.update(users).set({ passcodeHash, passcodeSetAt: new Date() }).where(eq(users.id, userId))
  return { ok: true }
}

/** Disables passcode login for this user -- same requireAuth()-gated-caller-only posture as setPasscode. */
export async function removePasscode(userId: string): Promise<void> {
  await db.update(users).set({ passcodeHash: null, passcodeSetAt: null }).where(eq(users.id, userId))
}

export type RateLimitCheck = { limited: false } | { limited: true; retryAfterSeconds: number }

/**
 * Checked BEFORE the user lookup in verifyPasscodeLogin, so a rate-limited
 * caller gets the same generic response whether or not the email even
 * resolves to a real account -- mirrors
 * org-join-code-service.ts's checkJoinCodeRateLimit ordering exactly.
 * Uses the raw (RLS-bypassing) db client deliberately: this runs before
 * any session/tenant context exists, same rationale as every other
 * pre-auth lookup in this codebase (see auth-guard.ts's autoProvisionUser
 * header).
 */
export async function checkPasscodeRateLimit(email: string, ipAddress: string): Promise<RateLimitCheck> {
  const cutoff = new Date(Date.now() - RATE_LIMIT_WINDOW_MINUTES * 60 * 1000)

  const [{ count: emailFailures }] = await db.select({ count: sql<number>`count(*)` })
    .from(passcodeLoginAttempts)
    .where(and(
      eq(passcodeLoginAttempts.email, email),
      eq(passcodeLoginAttempts.wasSuccessful, false),
      gte(passcodeLoginAttempts.createdAt, cutoff)
    ))
  if (Number(emailFailures) >= RATE_LIMIT_MAX_FAILURES_PER_EMAIL) {
    return { limited: true, retryAfterSeconds: RATE_LIMIT_WINDOW_MINUTES * 60 }
  }

  const [{ count: ipFailures }] = await db.select({ count: sql<number>`count(*)` })
    .from(passcodeLoginAttempts)
    .where(and(
      eq(passcodeLoginAttempts.ipAddress, ipAddress),
      eq(passcodeLoginAttempts.wasSuccessful, false),
      gte(passcodeLoginAttempts.createdAt, cutoff)
    ))
  if (Number(ipFailures) >= RATE_LIMIT_MAX_FAILURES_PER_IP) {
    return { limited: true, retryAfterSeconds: RATE_LIMIT_WINDOW_MINUTES * 60 }
  }

  return { limited: false }
}

/** Fire-and-forget, matches org-join-code-service.ts's recordAttempt -- never blocks the caller's response on this write. */
async function recordAttempt(email: string, ipAddress: string, wasSuccessful: boolean): Promise<void> {
  db.insert(passcodeLoginAttempts).values({ email, ipAddress, wasSuccessful }).then(() => {})
}

export type VerifyPasscodeLoginResult =
  | { ok: true; user: typeof users.$inferSelect }
  | { ok: false; reason: "rate_limited" | "invalid"; retryAfterSeconds?: number }

/**
 * Verifies email+passcode and returns the matched user row. Does NOT
 * establish a session itself -- the caller (POST /api/auth/passcode-login)
 * does that via supabaseAdmin.auth.admin.generateLink({type:"magiclink"})
 * + the existing /auth/callback PKCE exchange, the exact same
 * session-establishment mechanism
 * src/app/api/auth/sso/[orgSlug]/acs/route.ts already uses -- no new
 * session mechanism invented here.
 */
export async function verifyPasscodeLogin(email: string, passcode: string, ipAddress: string): Promise<VerifyPasscodeLoginResult> {
  const normalizedEmail = email.trim()

  const rateLimit = await checkPasscodeRateLimit(normalizedEmail, ipAddress)
  if (rateLimit.limited) {
    return { ok: false, reason: "rate_limited", retryAfterSeconds: rateLimit.retryAfterSeconds }
  }

  if (!isValidPasscodeFormat(passcode)) {
    await recordAttempt(normalizedEmail, ipAddress, false)
    return { ok: false, reason: "invalid" }
  }

  const user = await db.query.users.findFirst({ where: eq(users.email, normalizedEmail) })
  if (!user || !user.passcodeHash) {
    await recordAttempt(normalizedEmail, ipAddress, false)
    return { ok: false, reason: "invalid" }
  }

  const matches = await verifyPasscodeHash(passcode, user.passcodeHash)
  if (!matches) {
    await recordAttempt(normalizedEmail, ipAddress, false)
    return { ok: false, reason: "invalid" }
  }

  await recordAttempt(normalizedEmail, ipAddress, true)
  return { ok: true, user }
}
