// Area 15 (U-D27.B3.S1, "4 distinct invitation paths"): Path C from
// Requirement.docx -- "User Self-Registration via code -- user goes into
// Settings, enters a code given by the Master Admin, account gets
// activated." Built here as "enters the code during signup" per this
// dispatch's brief (the signup form, not a post-signup Settings screen --
// there is no authenticated pre-org-membership Settings surface to put it
// in anyway, since Settings itself requires an org). Third of the 4 paths
// to exist -- Master-Admin-direct-add (POST /api/users) and Secure Invite
// Link (invite-link-service.ts) already shipped.
//
// Deliberately NOT built this dispatch: Path D (peer-provided code, any
// existing user -- not just an admin -- can hand out a join code). Found
// in the same source paragraph, not ambiguous, but a genuinely different
// security surface (who may MINT a code) layered on the identical
// redemption mechanism below -- building it in the same pass would mean
// either two shallow paths or reusing this table with an unreviewed
// "any user can create these" permission change. Per the dispatch brief's
// explicit "build the ONE most clearly-specified, highest-value remaining
// path completely... rather than 2 shallow ones," Path D is deferred
// (see the PR description / implementation-log entry for the full note).
//
// Security properties, stated plainly for review (per dispatch brief):
//   - org-scoped + role-fixed at creation: identical posture to
//     org_invite_links -- never inferred from anything the redeemer sends.
//   - long-lived by default (expiresAt nullable, unlike the invite link's
//     7-day default) -- these codes are meant to be shared verbally/in a
//     doc and read out loud, not clicked, so they need to survive longer;
//     an admin can still set an expiry or revoke early.
//   - admin-only minting: only 'admin'/'manager' dbUser.role can create or
//     revoke a code (see api/join-codes/route.ts), same bar as invite
//     links -- this is what makes it "admin-code" and not "peer-code".
//   - real entropy despite being human-typeable: 12 characters from a
//     30-symbol alphabet (excludes 0/O/1/I/L/U to avoid transcription
//     errors when read aloud or handwritten) = 30^12 ≈ 5.3×10^17
//     possibilities (~59 bits) -- far more than the "8+ chars" floor the
//     brief names, formatted XXXX-XXXX-XXXX for readability.
//   - hashed at rest: only codeHash (SHA-256, same hashSHA256 as api-keys
//     and invite-link-service) is ever persisted -- the raw code is
//     returned to the creating admin exactly once, at creation.
//   - rate-limited: every preview/redemption attempt (success or failure)
//     is logged to org_join_code_attempts, keyed by requester IP.
//     checkJoinCodeRateLimit blocks further attempts from an IP once it
//     has RATE_LIMIT_MAX_FAILURES failed attempts inside
//     RATE_LIMIT_WINDOW_MINUTES -- checked BEFORE the code lookup runs, so
//     a blocked IP never even gets a valid/invalid signal. Honest
//     limitation, named rather than oversold: this is IP-keyed, not
//     code-keyed -- a distributed attacker rotating source IPs is not
//     stopped by this alone. Combined with the ~60-bit code space, the
//     realistic brute-force cost is still prohibitive (rate limiting turns
//     a fast online guess into a slow one; the entropy makes "slow" matter).
//   - redemption still requires a real Supabase Auth signup, exactly like
//     the invite link -- this mechanism only decides which ORG an
//     already-authenticating identity lands in, never authenticates by
//     itself.
import { db, organisations, orgJoinCodes, orgJoinCodeAttempts, users, aiAssistants } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { eq, desc, and, gte, sql } from "drizzle-orm"
import { randomBytes } from "crypto"
import { hashSHA256 } from "@/lib/api-keys"
import { canAssignSeat } from "@/lib/org-license-service"
import { INVITE_ROLES, isInviteRole, type InviteRole } from "@/lib/invite-link-service"

export { INVITE_ROLES, isInviteRole }
export type { InviteRole }

// Excludes 0/O, 1/I/L, and U (to avoid V/U confusion when handwritten) --
// optimized for "read aloud over a phone call" and "handwritten on a
// whiteboard," the two use cases the source doc actually names ("code
// given by the Master Admin"). 30 symbols (22 letters + digits 2-9).
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789"
const CODE_LENGTH = 12
const CODE_GROUP_SIZE = 4

const RATE_LIMIT_WINDOW_MINUTES = 15
const RATE_LIMIT_MAX_FAILURES = 10

/**
 * Pure -- crypto.randomBytes rejection-sampled against CODE_ALPHABET's
 * length so every symbol has exactly equal probability (a naive `% 31`
 * would bias low values slightly; with 31 not a power of 2 the bias is
 * small but avoidable at negligible cost, so it's avoided).
 */
export function generateJoinCode(): string {
  const bytes = randomBytes(CODE_LENGTH * 2) // oversample, discard out-of-range bytes below
  let raw = ""
  let i = 0
  while (raw.length < CODE_LENGTH) {
    if (i >= bytes.length) throw new Error("generateJoinCode: exhausted random buffer -- statistically should never happen")
    const b = bytes[i]!
    i += 1
    const max = Math.floor(256 / CODE_ALPHABET.length) * CODE_ALPHABET.length
    if (b >= max) continue // reject, keeps every symbol equiprobable
    raw += CODE_ALPHABET[b % CODE_ALPHABET.length]
  }
  return formatJoinCode(raw)
}

/** Pure -- "ABCDEFGHJKMN" -> "ABCD-EFGH-JKMN". */
export function formatJoinCode(raw: string): string {
  const groups: string[] = []
  for (let i = 0; i < raw.length; i += CODE_GROUP_SIZE) groups.push(raw.slice(i, i + CODE_GROUP_SIZE))
  return groups.join("-")
}

/**
 * Pure -- canonicalizes user-typed input before hashing/lookup: uppercases,
 * strips whitespace/dashes. Tolerant of "abcd efgh jkmn", "abcd-efgh-jkmn",
 * "ABCDEFGHJKMN" all resolving to the same lookup key, since this is
 * transcribed by hand far more often than the invite link's clicked token.
 */
export function normalizeJoinCode(input: string): string {
  return input.toUpperCase().replace(/[\s-]/g, "")
}

export type JoinCodeRow = typeof orgJoinCodes.$inferSelect

export type JoinCodeStatus = "valid" | "expired" | "revoked"

/**
 * Pure -- mirrors invite-link-service.ts's evaluateInviteLinkStatus: takes
 * the row and "now" as plain data, no I/O, no clock of its own. No
 * "exhausted" state here (unlike the invite link) -- join codes are
 * reusable by design, redeemCount never gates anything.
 */
export function evaluateJoinCodeStatus(
  row: Pick<JoinCodeRow, "expiresAt" | "revokedAt">,
  now: Date
): JoinCodeStatus {
  if (row.revokedAt) return "revoked"
  if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) return "expired"
  return "valid"
}

export async function createJoinCode(params: {
  orgId: string
  role: InviteRole
  createdByUserId: string
  label?: string
  expiresInDays?: number | null
}): Promise<{ id: string; code: string; role: InviteRole; expiresAt: Date | null }> {
  const code = generateJoinCode()
  const normalized = normalizeJoinCode(code)
  const codeHash = await hashSHA256(normalized)
  const expiresAt = params.expiresInDays != null && params.expiresInDays > 0
    ? new Date(Date.now() + params.expiresInDays * 24 * 60 * 60 * 1000)
    : null

  const [row] = await withTenantContext({ orgId: params.orgId, userId: params.createdByUserId }, (tx) =>
    tx.insert(orgJoinCodes).values({
      orgId: params.orgId,
      role: params.role,
      codeHash,
      codePrefix: code.slice(0, CODE_GROUP_SIZE),
      label: params.label?.trim() || null,
      createdByUserId: params.createdByUserId,
      expiresAt,
    }).returning()
  )

  // The raw code is returned to the caller exactly once -- it is not
  // retrievable again after this call (only codeHash is stored), same
  // convention as createInviteLink()/generateApiKey().
  return { id: row.id, code, role: params.role, expiresAt }
}

export async function listJoinCodes(orgId: string): Promise<JoinCodeRow[]> {
  return withTenantContext({ orgId }, (tx) =>
    tx.query.orgJoinCodes.findMany({
      where: eq(orgJoinCodes.orgId, orgId),
      orderBy: desc(orgJoinCodes.createdAt),
    })
  )
}

export async function revokeJoinCode(orgId: string, id: string, revokedByUserId: string): Promise<boolean> {
  const rows = await withTenantContext({ orgId, userId: revokedByUserId }, (tx) =>
    tx.update(orgJoinCodes)
      .set({ revokedAt: new Date(), revokedByUserId, updatedAt: new Date() })
      .where(eq(orgJoinCodes.id, id)) // org scoping enforced by RLS (app_runtime_tenant_isolation), not just this WHERE
      .returning({ id: orgJoinCodes.id })
  )
  return rows.length > 0
}

export type RateLimitCheck = { limited: false } | { limited: true; retryAfterSeconds: number }

/**
 * Counts failed attempts from `ipAddress` in the trailing window using the
 * raw (RLS-bypassing) db client -- same rationale as every other pre-auth
 * lookup in this file: no tenant context exists yet to scope by. Checked
 * BEFORE the code lookup in both previewJoinCode and
 * redeemJoinCodeAndProvisionUser, so a rate-limited IP gets the same
 * generic response whether or not the code it's trying even exists.
 */
export async function checkJoinCodeRateLimit(ipAddress: string): Promise<RateLimitCheck> {
  const cutoff = new Date(Date.now() - RATE_LIMIT_WINDOW_MINUTES * 60 * 1000)
  const [{ count }] = await db.select({ count: sql<number>`count(*)` })
    .from(orgJoinCodeAttempts)
    .where(and(
      eq(orgJoinCodeAttempts.ipAddress, ipAddress),
      eq(orgJoinCodeAttempts.wasSuccessful, false),
      gte(orgJoinCodeAttempts.createdAt, cutoff)
    ))

  if (Number(count) >= RATE_LIMIT_MAX_FAILURES) {
    return { limited: true, retryAfterSeconds: RATE_LIMIT_WINDOW_MINUTES * 60 }
  }
  return { limited: false }
}

async function recordAttempt(ipAddress: string, orgId: string | null, wasSuccessful: boolean): Promise<void> {
  // Fire-and-forget, matches api-key-auth.ts's request-log insert
  // convention -- never blocks the caller's response on this write.
  db.insert(orgJoinCodeAttempts).values({ ipAddress, orgId, wasSuccessful }).then(() => {})
}

export type JoinCodePreview =
  | { valid: true; orgName: string; role: InviteRole }
  | { valid: false; reason: "not_found" | JoinCodeStatus | "rate_limited" }

/**
 * Public preview -- called by the signup form as the user finishes typing a
 * code, before any Supabase Auth identity exists. Rate-limit-checked first:
 * a blocked IP gets `rate_limited` without a DB lookup ever running against
 * real code data.
 */
export async function previewJoinCode(rawInput: string, ipAddress: string): Promise<JoinCodePreview> {
  const rateLimit = await checkJoinCodeRateLimit(ipAddress)
  if (rateLimit.limited) return { valid: false, reason: "rate_limited" }

  const code = normalizeJoinCode(rawInput)
  if (code.length !== CODE_LENGTH) {
    await recordAttempt(ipAddress, null, false)
    return { valid: false, reason: "not_found" }
  }
  const codeHash = await hashSHA256(code)
  const row = await db.query.orgJoinCodes.findFirst({ where: eq(orgJoinCodes.codeHash, codeHash) })
  if (!row) {
    await recordAttempt(ipAddress, null, false)
    return { valid: false, reason: "not_found" }
  }

  const status = evaluateJoinCodeStatus(row, new Date())
  if (status !== "valid") {
    await recordAttempt(ipAddress, row.orgId, false)
    return { valid: false, reason: status }
  }

  await recordAttempt(ipAddress, row.orgId, true)
  const org = await db.query.organisations.findFirst({ where: eq(organisations.id, row.orgId), columns: { name: true } })
  return { valid: true, orgName: org?.name ?? "this organisation", role: row.role as InviteRole }
}

export type RedeemJoinCodeResult =
  | { ok: true; user: typeof users.$inferSelect }
  | { ok: false; reason: string }

/**
 * Redeems a join code and provisions the compliance.users row for the
 * invitee -- mirrors consumeInviteLinkAndProvisionUser's shape closely
 * (same seat-check-before-write ordering, same "no separate accept step,
 * isActive:true immediately" reasoning), with two real differences: no
 * atomic use-count race to guard (codes are reusable, not budgeted, so
 * there is no maxUses to race against), and a rate-limit check up front
 * since this is the one redemption path an attacker can attempt without
 * ever holding a valid credential of any kind.
 */
export async function redeemJoinCodeAndProvisionUser(
  rawInput: string,
  ipAddress: string,
  authUser: { id: string; email: string; fullName: string }
): Promise<RedeemJoinCodeResult> {
  const rateLimit = await checkJoinCodeRateLimit(ipAddress)
  if (rateLimit.limited) return { ok: false, reason: "Too many attempts. Please try again later." }

  const code = normalizeJoinCode(rawInput)
  if (code.length !== CODE_LENGTH) {
    await recordAttempt(ipAddress, null, false)
    return { ok: false, reason: "This join code is invalid." }
  }
  const codeHash = await hashSHA256(code)
  const row = await db.query.orgJoinCodes.findFirst({ where: eq(orgJoinCodes.codeHash, codeHash) })
  if (!row) {
    await recordAttempt(ipAddress, null, false)
    return { ok: false, reason: "This join code is invalid." }
  }

  const status = evaluateJoinCodeStatus(row, new Date())
  if (status !== "valid") {
    await recordAttempt(ipAddress, row.orgId, false)
    return { ok: false, reason: `This join code has ${status}.` }
  }

  const seatCheck = await canAssignSeat(row.orgId)
  if (!seatCheck.allowed) {
    await recordAttempt(ipAddress, row.orgId, false)
    return { ok: false, reason: seatCheck.reason }
  }

  if (!isInviteRole(row.role)) {
    // Defensive only -- createJoinCode only ever writes an INVITE_ROLES
    // value, this guards against a hand-edited DB row with a stale role.
    await recordAttempt(ipAddress, row.orgId, false)
    return { ok: false, reason: "This join code has an invalid role and cannot be redeemed." }
  }

  await recordAttempt(ipAddress, row.orgId, true)
  // Informational counter only -- fire-and-forget, nothing gates on it.
  db.update(orgJoinCodes).set({ redeemCount: sql`${orgJoinCodes.redeemCount} + 1`, updatedAt: new Date() })
    .where(eq(orgJoinCodes.id, row.id)).then(() => {})

  const [newUser] = await db.insert(users).values({
    name: authUser.fullName,
    email: authUser.email,
    passwordHash: "supabase-auth-managed", // legacy NOT NULL column, matches autoProvisionUser's normal-signup convention exactly
    role: row.role,
    orgId: row.orgId,
    authUserId: authUser.id,
    isActive: true, // seat check already gated this -- no separate accept step left after this point
  }).returning()

  // Wave 2 parity: every user gets 5 numbered AI Assistants, same as
  // direct-add, the invite link, and normal signup.
  await db.insert(aiAssistants).values(
    Array.from({ length: 5 }, (_, i) => ({
      userId: newUser.id,
      assistantNumber: i + 1,
      label: `Assistant ${i + 1}`,
    }))
  )

  return { ok: true, user: newUser }
}
